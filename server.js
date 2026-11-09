// VR Sticky Notes server
// - Room directory (create / list / delete rooms)
// - Shared objects per room: uploaded 3D models (GLB, glTF, OBJ) and PDF documents
// - Sticky notes per room (on boards, on models, or on a PDF page), saved to disk
// - Avatar pose relay and WebRTC signaling relay for voice chat

'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const env = process.env;
const PORT = Number(env.PORT) || 3000;
const DATA_DIR = env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_KEY = env.ADMIN_KEY || '';
const MAX_NOTES_PER_ROOM = Number(env.MAX_NOTES_PER_ROOM) || 500;
const MAX_USERS_PER_ROOM = Number(env.MAX_USERS_PER_ROOM) || 16;
const MAX_ITEMS_PER_ROOM = Number(env.MAX_ITEMS_PER_ROOM) || 60;
const BOOTH_COUNT = 15; // each booth holds 1 model and 2 PDFs
const SLOTS = { model: ['model'], pdf: ['pdf1', 'pdf2'] };
const MAX_ROOMS = Number(env.MAX_ROOMS) || 200;
const MB = 1024 * 1024;
const MAX_MODEL_BYTES = (Number(env.MAX_MODEL_MB) || 80) * MB;
const MAX_PDF_BYTES = (Number(env.MAX_PDF_MB) || 40) * MB;
const MAX_ROOM_BYTES = (Number(env.MAX_ROOM_MB) || 500) * MB;
const MAX_TEXT = 280;

let ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
if (env.ICE_SERVERS) {
  try { ICE_SERVERS = JSON.parse(env.ICE_SERVERS); } catch (e) { console.warn('ICE_SERVERS is not valid JSON, using default STUN'); }
}

const NOTE_COLORS = ['#ffe066', '#ff9ebb', '#a8e06c', '#8fd3fe', '#ffb870', '#d7b8ff'];
const USER_COLORS = ['#e4572e', '#2e86ab', '#3bb273', '#f3a712', '#8e44ad', '#e84393', '#16a085', '#d35400'];
const FORMATS = { '.glb': 'model', '.gltf': 'model', '.obj': 'model', '.pdf': 'pdf' };
// Avatar choices (everything a viewer can pick; anything else is ignored)
const AVATAR = {
  skin: ['#f6d7b8', '#e8b98f', '#c98f62', '#a46a3f', '#7a4a2a', '#4f2f1c'],
  head: ['round', 'square'],
  hat: ['none', 'hardhat-yellow', 'hardhat-white', 'hardhat-orange', 'cap', 'beanie', 'headphones'],
  eyes: ['none', 'glasses', 'safety'],
  vest: [true, false]
};
function cleanAvatar(a, fallbackShirt) {
  a = a && typeof a === 'object' ? a : {};
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  return {
    shirt: pick(a.shirt, USER_COLORS, fallbackShirt),
    skin: pick(a.skin, AVATAR.skin, AVATAR.skin[1]),
    head: pick(a.head, AVATAR.head, 'round'),
    hat: pick(a.hat, AVATAR.hat, 'none'),
    eyes: pick(a.eyes, AVATAR.eyes, 'none'),
    vest: a.vest === true
  };
}
const ROOMS_DIR = path.join(DATA_DIR, 'rooms');
const REGISTRY_FILE = path.join(DATA_DIR, 'rooms.json');

fs.mkdirSync(ROOMS_DIR, { recursive: true });

// ---------- helpers ----------
const cleanSlug = (r) => String(r || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
const cleanText = (s, max) => String(s == null ? '' : s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .trim().slice(0, max);
const num = (v, lim) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim) ? v : null;
const vec = (a, n, lim) => (Array.isArray(a) && a.length === n && a.every((v) => num(v, lim) !== null)) ? a.map((v) => Math.round(v * 10000) / 10000) : null;
const pickColor = (c, list, fallback) => (list.includes(c) ? c : fallback);
const newId = () => crypto.randomBytes(6).toString('hex');
const safeEq = (a, b) => {
  if (!a || !b) return false;
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const isAdmin = (k) => !!(ADMIN_KEY && safeEq(k, ADMIN_KEY));

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  return fsp.writeFile(tmp, JSON.stringify(data)).then(() => fsp.rename(tmp, file))
    .catch((e) => console.error('save failed', file, e.message));
}

// ---------- room registry ----------
const registry = new Map(); // slug -> { slug, name, desc, unlisted, createdAt, creatorKey }
try {
  for (const r of JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'))) registry.set(r.slug, r);
} catch (e) { /* first start */ }
if (!registry.has('main')) {
  registry.set('main', { slug: 'main', name: 'Main hall', desc: 'Open room for everyone.', unlisted: false, createdAt: Date.now(), creatorKey: '' });
}
let registryTimer = null;
function saveRegistry() {
  clearTimeout(registryTimer);
  registryTimer = setTimeout(() => writeJsonAtomic(REGISTRY_FILE, [...registry.values()]), 300);
}
saveRegistry();

function uniqueSlug(name) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'room';
  let slug = base; let i = 2;
  while (registry.has(slug)) slug = `${base}-${i++}`;
  return slug;
}

// ---------- live rooms ----------
const rooms = new Map(); // slug -> { slug, clients, notes, items, saveTimer }
const roomDir = (slug) => path.join(ROOMS_DIR, slug);
const filesDir = (slug) => path.join(roomDir(slug), 'files');

function getRoom(slug) {
  let room = rooms.get(slug);
  if (room) return room;
  room = { slug, clients: new Map(), notes: new Map(), items: new Map(), saveTimer: null };
  try {
    const st = JSON.parse(fs.readFileSync(path.join(roomDir(slug), 'state.json'), 'utf8'));
    for (const n of st.notes || []) room.notes.set(n.id, n);
    for (const it of st.items || []) room.items.set(it.id, it);
  } catch (e) { /* new room */ }
  rooms.set(slug, room);
  return room;
}

function scheduleSave(room) {
  clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(async () => {
    room.saveTimer = null;
    if (!registry.has(room.slug)) return;
    await fsp.mkdir(roomDir(room.slug), { recursive: true });
    await writeJsonAtomic(path.join(roomDir(room.slug), 'state.json'), { notes: [...room.notes.values()], items: [...room.items.values()] });
  }, 400);
}

// The uploader, the person who created the room, and the admin can replace or remove an object.
function canManage(slug, it, key, admin) {
  if (admin) return true;
  if (it.authorKey && key && it.authorKey === key) return true;
  const reg = registry.get(slug);
  return !!(reg && reg.creatorKey && key && reg.creatorKey === key);
}
function slotTaken(room, booth, slot, exceptId) {
  for (const it of room.items.values()) if (it.id !== exceptId && it.booth === booth && it.slot === slot) return true;
  return false;
}

function roomBytes(room) {
  let b = 0;
  for (const it of room.items.values()) b += it.size || 0;
  return b;
}

function roomSummary(r) {
  const live = getRoom(r.slug);
  return { slug: r.slug, name: r.name, desc: r.desc, unlisted: !!r.unlisted, createdAt: r.createdAt, online: live.clients.size, notes: live.notes.size, items: live.items.size };
}

// ---------- messaging ----------
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const [id, ws] of room.clients) if (id !== exceptId && ws.readyState === 1) ws.send(data);
}
function publicPeer(ws) {
  const u = ws.user;
  return { id: u.id, name: u.name, color: u.avatar.shirt, avatar: u.avatar, device: u.device, muted: u.muted, cam: !!u.cam, p: u.p, q: u.q };
}
function noteFor(key, admin, n) {
  const { authorKey, votes, ...rest } = n;
  return { ...rest, votes: votes.length, mine: authorKey === key, voted: votes.includes(key) };
}
function itemFor(key, slug, it) {
  const { authorKey, file, ...rest } = it;
  if (it.kind === 'portal' && registry.has(it.target)) rest.name = registry.get(it.target).name;
  return { ...rest, url: file ? `/files/${slug}/${file}` : null, mine: authorKey === key };
}

// A room shortcut ("portal") is an object with no file that takes people to another room.
function makePortal(target, p, ry, author, authorKey) {
  const reg = registry.get(target);
  return {
    id: newId(), kind: 'portal', fmt: 'portal', target, name: reg ? reg.name : target, file: null, size: 0,
    p, ry, s: 1, page: 1, author, authorKey, ts: Date.now()
  };
}

// When a room is deleted, remove shortcuts pointing to it from every other room.
function removePortalsTo(slug) {
  for (const other of registry.keys()) {
    if (other === slug) continue;
    const room = getRoom(other);
    let changed = false;
    for (const [id, it] of room.items) {
      if (it.kind === 'portal' && it.target === slug) {
        room.items.delete(id);
        broadcast(room, { type: 'item-delete', id });
        changed = true;
      }
    }
    if (changed) scheduleSave(room);
  }
}
function sendNoteToAll(room, n, type) {
  for (const ws of room.clients.values()) send(ws, { type, note: noteFor(ws.user.key, ws.user.isAdmin, n) });
}
function sendItemToAll(room, it, type) {
  for (const ws of room.clients.values()) send(ws, { type, item: itemFor(ws.user.key, room.slug, it) });
}

// ---------- HTTP ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
const AFRAME_FILE = path.join(__dirname, 'node_modules', 'aframe', 'dist', 'aframe-v1.8.0.min.js');
const PDFJS_DIR = path.join(__dirname, 'node_modules', 'pdfjs-dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.obj': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.ico': 'image/x-icon'
};

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache || 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(file).pipe(res);
  });
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Check that an uploaded file really is what its extension says.
async function validateUpload(file, ext) {
  const fh = await fsp.open(file, 'r');
  const head = Buffer.alloc(2048);
  const { bytesRead } = await fh.read(head, 0, 2048, 0);
  await fh.close();
  const h = head.subarray(0, bytesRead);
  if (ext === '.glb') return h.subarray(0, 4).toString('latin1') === 'glTF' ? null : 'This is not a valid .glb file.';
  if (ext === '.pdf') return h.indexOf('%PDF') >= 0 && h.indexOf('%PDF') < 1024 ? null : 'This is not a valid PDF.';
  if (ext === '.obj') {
    if (h.includes(0)) return 'This .obj file looks binary. Export OBJ as text.';
    return /^\s*(v|vn|vt|f|o|g|mtllib|usemtl|#)\s/m.test(h.toString('utf8')) ? null : 'This is not a valid .obj file.';
  }
  if (ext === '.gltf') {
    let g;
    try { g = JSON.parse(await fsp.readFile(file, 'utf8')); } catch (e) { return 'This .gltf file is not valid JSON.'; }
    const uris = [...(g.buffers || []), ...(g.images || [])].map((b) => b.uri).filter(Boolean);
    if (uris.some((u) => !String(u).startsWith('data:'))) return 'This .gltf uses separate .bin/texture files. Export or convert it as a single .glb file instead.';
    return null;
  }
  return 'Unsupported file type.';
}

async function handleUpload(req, res, slug, url) {
  if (!registry.has(slug)) return json(res, 404, { error: 'Room not found.' });
  const room = getRoom(slug);
  const key = cleanText(req.headers['x-client-key'], 64);
  const author = cleanText(decodeURIComponent(req.headers['x-client-name'] || ''), 24) || 'Guest';
  const name = cleanText(url.searchParams.get('name'), 80) || 'upload';
  const ext = path.extname(name).toLowerCase();
  const kind = FORMATS[ext];
  if (!key) return json(res, 400, { error: 'Missing client key.' });
  if (!kind) return json(res, 415, { error: 'Supported files: .glb, .gltf (embedded), .obj, .pdf' });
  const limit = kind === 'pdf' ? MAX_PDF_BYTES : MAX_MODEL_BYTES;
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > limit) return json(res, 413, { error: `File is too large. Limit is ${Math.round(limit / MB)} MB.` });

  // Replacing an existing object keeps its booth, place and sticky notes.
  const replaceId = url.searchParams.get('replace');
  let target = null;
  let booth = null, slot = null;
  if (replaceId) {
    target = room.items.get(replaceId);
    if (!target || target.kind === 'portal') return json(res, 404, { error: 'That object no longer exists.' });
    if (!canManage(slug, target, key, isAdmin(req.headers['x-admin-key']))) return json(res, 403, { error: 'Only the person who uploaded it, the room creator, or the admin can replace it.' });
    if (target.kind !== kind) return json(res, 415, { error: target.kind === 'pdf' ? 'Replace a PDF with another PDF.' : 'Replace a model with another model (.glb, .gltf or .obj).' });
  } else {
    if (room.items.size >= MAX_ITEMS_PER_ROOM) return json(res, 409, { error: 'This room has reached its object limit.' });
    // Every upload goes into a booth slot: 1 model and 2 PDFs per booth.
    const b = Math.floor(Number(url.searchParams.get('booth')));
    const wanted = url.searchParams.get('slot');
    const order = b >= 1 && b <= BOOTH_COUNT ? [b] : Array.from({ length: BOOTH_COUNT }, (_, i) => i + 1);
    for (const bb of order) {
      const options = SLOTS[kind].filter((sl) => !wanted || sl === wanted);
      const free = options.find((sl) => !slotTaken(room, bb, sl));
      if (free) { booth = bb; slot = free; break; }
    }
    if (!booth) {
      const what = kind === 'pdf' ? 'two PDFs' : 'a model';
      return json(res, 409, { error: order.length === 1 ? `Booth ${order[0]} already has ${what}. Replace or remove one first, or pick another booth.` : `Every booth already has ${what}. Replace or remove one first.` });
    }
  }
  if (roomBytes(room) + declared > MAX_ROOM_BYTES) return json(res, 413, { error: 'This room is out of storage space. Delete an object first.' });

  const id = newId();
  const fileName = id + ext;
  await fsp.mkdir(filesDir(slug), { recursive: true });
  const dest = path.join(filesDir(slug), fileName);
  const tmp = dest + '.part';
  let size = 0; let aborted = false;
  const out = fs.createWriteStream(tmp);
  req.on('data', (c) => {
    size += c.length;
    if (size > limit && !aborted) {
      aborted = true;
      out.destroy(); req.unpipe(out);
      fsp.unlink(tmp).catch(() => {});
      json(res, 413, { error: `File is too large. Limit is ${Math.round(limit / MB)} MB.` });
      req.resume();
    }
  });
  req.pipe(out);
  out.on('finish', async () => {
    if (aborted) return;
    try {
      if (size === 0) throw new Error('The file is empty.');
      const problem = await validateUpload(tmp, ext);
      if (problem) throw new Error(problem);
      await fsp.rename(tmp, dest);
    } catch (e) {
      fsp.unlink(tmp).catch(() => {});
      return json(res, 422, { error: e.message });
    }
    const cleanName = name.replace(/\.[^.]+$/, '').slice(0, 60);
    if (target) {
      const oldFile = target.file;
      Object.assign(target, { fmt: ext.slice(1), name: cleanName, file: fileName, size, s: 1, page: 1, updated: Date.now(), updatedBy: author });
      if (oldFile && oldFile !== fileName) fsp.unlink(path.join(filesDir(slug), oldFile)).catch(() => {});
      scheduleSave(room);
      sendItemToAll(room, target, 'item-replace');
      return json(res, 200, { item: itemFor(key, slug, target) });
    }
    const p = vec((url.searchParams.get('p') || '').split(',').map(Number), 3, 80) || [0, 0, 0];
    const ry = num(Number(url.searchParams.get('ry')), 360) || 0;
    const s0 = num(Number(url.searchParams.get('s')), 20);
    const item = {
      id, kind, fmt: ext.slice(1), name: cleanName, file: fileName, size, booth, slot,
      p, ry, s: s0 && s0 >= 0.05 ? s0 : 1, page: 1, author, authorKey: key, ts: Date.now()
    };
    room.items.set(id, item);
    scheduleSave(room);
    sendItemToAll(room, item, 'item-add');
    json(res, 201, { item: itemFor(key, slug, item) });
  });
  out.on('error', () => { if (!aborted) json(res, 500, { error: 'Could not save the file.' }); });
}

async function deleteRoom(slug) {
  const room = rooms.get(slug);
  registry.delete(slug);
  saveRegistry();
  if (room) {
    clearTimeout(room.saveTimer);
    for (const ws of room.clients.values()) { send(ws, { type: 'room-deleted' }); ws.close(); }
    rooms.delete(slug);
  }
  removePortalsTo(slug);
  await fsp.rm(roomDir(slug), { recursive: true, force: true });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  const m = req.method;

  try {
    if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }

    if (p === '/api/config') {
      return json(res, 200, {
        iceServers: ICE_SERVERS, noteColors: NOTE_COLORS, userColors: USER_COLORS, maxText: MAX_TEXT,
        maxModelMB: MAX_MODEL_BYTES / MB, maxPdfMB: MAX_PDF_BYTES / MB, booths: BOOTH_COUNT, avatar: AVATAR
      });
    }

    if (p === '/api/rooms' && m === 'GET') {
      const list = [...registry.values()].filter((r) => !r.unlisted).map(roomSummary)
        .sort((a, b) => (b.online - a.online) || (a.slug === 'main' ? -1 : b.slug === 'main' ? 1 : b.createdAt - a.createdAt));
      return json(res, 200, { rooms: list });
    }

    if (p === '/api/rooms' && m === 'POST') {
      const body = await readJsonBody(req).catch(() => null);
      if (!body) return json(res, 400, { error: 'Bad request.' });
      const name = cleanText(body.name, 40);
      if (!name) return json(res, 400, { error: 'Give the room a name.' });
      if (registry.size >= MAX_ROOMS) return json(res, 409, { error: 'The room limit has been reached.' });
      const slug = uniqueSlug(name);
      const r = { slug, name, desc: cleanText(body.desc, 140), unlisted: !!body.unlisted, createdAt: Date.now(), creatorKey: cleanText(body.key, 64) };
      registry.set(slug, r);
      saveRegistry();
      // Created from inside another room: put a way back in the new room, beside the arrival spot.
      const from = cleanSlug(body.returnTo);
      if (from && from !== slug && registry.has(from)) {
        const room = getRoom(slug);
        const back = makePortal(from, [3.5, 0, 6], -90, cleanText(body.author, 24) || 'Guest', r.creatorKey);
        room.items.set(back.id, back);
        scheduleSave(room);
      }
      return json(res, 201, { room: roomSummary(r) });
    }

    const roomRoute = p.match(/^\/api\/rooms\/([a-z0-9_-]{1,40})(\/[a-z.]+)?$/);
    if (roomRoute) {
      const slug = roomRoute[1]; const sub = roomRoute[2] || '';
      const reg = registry.get(slug);
      if (!sub && m === 'GET') return reg ? json(res, 200, { room: roomSummary(reg) }) : json(res, 404, { error: 'Room not found.' });
      if (!sub && m === 'DELETE') {
        if (!reg) return json(res, 404, { error: 'Room not found.' });
        const key = req.headers['x-client-key']; const admin = req.headers['x-admin-key'];
        if (slug === 'main' && !isAdmin(admin)) return json(res, 403, { error: 'Only the admin can delete the main room.' });
        if (!isAdmin(admin) && !(reg.creatorKey && safeEq(key, reg.creatorKey))) return json(res, 403, { error: 'Only the person who created this room (or the admin) can delete it.' });
        await deleteRoom(slug);
        return json(res, 200, { ok: true });
      }
      if (sub === '/upload' && m === 'POST') return handleUpload(req, res, slug, url);
      if (sub === '/notes.csv' && m === 'GET') {
        const room = getRoom(slug);
        const rows = [['id', 'text', 'author', 'color', 'votes', 'booth', 'placed_on', 'pdf_page', 'created_utc', 'updated_utc', 'x', 'y', 'z']];
        for (const n of room.notes.values()) {
          const it = n.on ? room.items.get(n.on) : null;
          rows.push([n.id, n.text, n.author, n.color, n.votes.length, it && it.booth ? it.booth : '', it ? it.name : 'room', n.pg || '',
            new Date(n.ts).toISOString(), n.updated ? new Date(n.updated).toISOString() : '', n.p[0], n.p[1], n.p[2]]);
        }
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="notes-${slug}.csv"` });
        return res.end('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
      }
    }

    const fileRoute = p.match(/^\/files\/([a-z0-9_-]{1,40})\/([a-f0-9]{12}\.(glb|gltf|obj|pdf))$/);
    if (fileRoute) return serveFile(res, path.join(filesDir(fileRoute[1]), fileRoute[2]), 'public, max-age=31536000, immutable');

    if (p === '/vendor/aframe.min.js') return serveFile(res, AFRAME_FILE, 'public, max-age=86400');
    if (p.startsWith('/vendor/pdfjs/')) {
      const rel = p.slice('/vendor/pdfjs/'.length);
      if (!/^(legacy\/build\/pdf(\.worker)?\.min\.mjs|cmaps\/[\w.-]+|standard_fonts\/[\w.-]+)$/.test(rel)) { res.writeHead(404); return res.end(); }
      return serveFile(res, path.join(PDFJS_DIR, rel), 'public, max-age=86400');
    }

    if (m !== 'GET' && m !== 'HEAD') { res.writeHead(405); return res.end(); }
    const file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    return serveFile(res, file);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Server error.' });
  }
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const slug = cleanSlug(url.searchParams.get('room')) || 'main';
  if (!registry.has(slug)) {
    // A link to a room nobody created yet: create it as an unlisted room.
    if (registry.size >= MAX_ROOMS) { send(ws, { type: 'error', code: 'no_room', message: 'Room not found.' }); return ws.close(); }
    registry.set(slug, { slug, name: slug, desc: '', unlisted: true, createdAt: Date.now(), creatorKey: '' });
    saveRegistry();
  }
  const room = getRoom(slug);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.type !== 'string') return;
    if (!rooms.has(slug)) return; // room was deleted

    if (!ws.user) {
      if (m.type !== 'hello') return;
      if (room.clients.size >= MAX_USERS_PER_ROOM) {
        send(ws, { type: 'error', code: 'room_full', message: `This room is full (${MAX_USERS_PER_ROOM} people). Try another room.` });
        return ws.close();
      }
      const id = newId();
      const key = cleanText(m.key, 64) || newId();
      ws.user = {
        id, key,
        name: cleanText(m.name, 24) || 'Guest',
        avatar: cleanAvatar(m.avatar, pickColor(m.color, USER_COLORS, USER_COLORS[room.clients.size % USER_COLORS.length])),
        device: cleanText(m.device, 12) || 'desktop',
        muted: m.muted !== false,
        cam: m.cam === true,
        isAdmin: isAdmin(m.admin),
        p: [0, 1.6, 4], q: [0, 0, 0, 1]
      };
      room.clients.set(id, ws);
      const reg = registry.get(slug);
      send(ws, {
        type: 'welcome', id, isAdmin: ws.user.isAdmin,
        room: { slug, name: reg.name, desc: reg.desc, unlisted: !!reg.unlisted, mine: !!(reg.creatorKey && reg.creatorKey === key) },
        peers: [...room.clients.values()].filter((c) => c !== ws).map(publicPeer),
        items: [...room.items.values()].map((it) => itemFor(key, slug, it)),
        notes: [...room.notes.values()].map((n) => noteFor(key, ws.user.isAdmin, n))
      });
      broadcast(room, { type: 'peer-join', peer: publicPeer(ws) }, id);
      return;
    }

    const u = ws.user;
    switch (m.type) {
      case 'pose': {
        const pp = vec(m.p, 3, 500); const q = vec(m.q, 4, 2);
        if (!pp || !q) return;
        u.p = pp; u.q = q;
        broadcast(room, { type: 'pose', id: u.id, p: pp, q }, u.id);
        break;
      }
      case 'profile': {
        if (typeof m.muted === 'boolean') u.muted = m.muted;
        if (typeof m.cam === 'boolean') u.cam = m.cam;
        if (m.name != null) u.name = cleanText(m.name, 24) || u.name;
        if (m.avatar != null) u.avatar = cleanAvatar(m.avatar, u.avatar.shirt);
        broadcast(room, { type: 'peer-update', peer: publicPeer(ws) }, u.id);
        break;
      }
      case 'speaking':
        broadcast(room, { type: 'speaking', id: u.id, on: !!m.on }, u.id);
        break;

      case 'note-add': {
        const n = m.note || {};
        const text = cleanText(n.text, MAX_TEXT);
        const pp = vec(n.p, 3, 5000); const q = vec(n.q, 4, 2);
        if (!text || !pp || !q) return;
        const on = n.on && room.items.has(n.on) ? n.on : null;
        if (room.notes.size >= MAX_NOTES_PER_ROOM) return send(ws, { type: 'error', code: 'too_many_notes', message: 'This room has reached its note limit.' });
        const note = {
          id: newId(), text, p: pp, q, on,
          pg: on && room.items.get(on).kind === 'pdf' ? Math.max(1, Math.min(10000, Math.floor(Number(n.pg) || 1))) : null,
          color: pickColor(n.color, NOTE_COLORS, NOTE_COLORS[0]),
          author: u.name, authorKey: u.key, ts: Date.now(), updated: 0, votes: []
        };
        room.notes.set(note.id, note);
        scheduleSave(room);
        sendNoteToAll(room, note, 'note-add');
        break;
      }
      case 'note-update': {
        const note = room.notes.get(m.id);
        if (!note || (note.authorKey !== u.key && !u.isAdmin)) return;
        if (m.text != null) { const t = cleanText(m.text, MAX_TEXT); if (t) note.text = t; }
        if (m.color != null) note.color = pickColor(m.color, NOTE_COLORS, note.color);
        note.updated = Date.now();
        scheduleSave(room);
        sendNoteToAll(room, note, 'note-update');
        break;
      }
      case 'note-vote': {
        const note = room.notes.get(m.id);
        if (!note) return;
        const i = note.votes.indexOf(u.key);
        if (i >= 0) note.votes.splice(i, 1); else note.votes.push(u.key);
        scheduleSave(room);
        sendNoteToAll(room, note, 'note-update');
        break;
      }
      case 'note-delete': {
        const note = room.notes.get(m.id);
        if (!note || (note.authorKey !== u.key && !u.isAdmin)) return;
        room.notes.delete(note.id);
        scheduleSave(room);
        broadcast(room, { type: 'note-delete', id: note.id });
        break;
      }

      // Shared objects: anyone in the room can move, turn, resize, or flip pages.
      case 'item-update': {
        const it = room.items.get(m.id);
        if (!it) return;
        const pp = vec(m.p, 3, 80); if (pp) it.p = pp;
        const ry = num(m.ry, 100000); if (ry !== null) it.ry = ((ry % 360) + 360) % 360;
        const s = num(m.s, 1000); if (s !== null && s >= 0.0005) it.s = Math.round(s * 100000) / 100000;
        const pg = num(m.page, 10000); if (pg !== null && pg >= 1) it.page = Math.floor(pg);
        scheduleSave(room);
        broadcast(room, { type: 'item-update', item: { id: it.id, p: it.p, ry: it.ry, s: it.s, page: it.page, by: u.name } });
        break;
      }
      case 'portal-add': {
        const target = cleanSlug(m.target);
        if (!target || target === slug || !registry.has(target)) return send(ws, { type: 'error', message: 'That room does not exist.' });
        if (room.items.size >= MAX_ITEMS_PER_ROOM) return send(ws, { type: 'error', message: 'This room has reached its object limit.' });
        const pp = vec(m.p, 3, 50) || [0, 0, 0];
        const ry = num(m.ry, 360) || 0;
        const portal = makePortal(target, pp, ry, u.name, u.key);
        room.items.set(portal.id, portal);
        scheduleSave(room);
        sendItemToAll(room, portal, 'item-add');
        break;
      }
      case 'item-delete': {
        const it = room.items.get(m.id);
        if (!it || !canManage(slug, it, u.key, u.isAdmin)) return send(ws, { type: 'error', message: 'Only the person who uploaded it, the room creator, or the admin can remove it.' });
        room.items.delete(it.id);
        for (const [nid, n] of room.notes) if (n.on === it.id) room.notes.delete(nid);
        if (it.file) fsp.unlink(path.join(filesDir(slug), it.file)).catch(() => {});
        scheduleSave(room);
        broadcast(room, { type: 'item-delete', id: it.id });
        break;
      }

      case 'signal': {
        const target = room.clients.get(m.to);
        if (!target || !m.data) return;
        send(target, { type: 'signal', from: u.id, data: m.data });
        break;
      }
      default: break;
    }
  });

  ws.on('close', () => {
    if (!ws.user) return;
    room.clients.delete(ws.user.id);
    broadcast(room, { type: 'peer-leave', id: ws.user.id });
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 30000);

server.listen(PORT, () => console.log(`VR Sticky Notes running on http://localhost:${PORT}`));
