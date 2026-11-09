/* VR Sticky Notes - client
   Rooms, presence, sticky notes, shared 3D models and PDF documents, and voice chat (WebRTC mesh). */
(function () {
  'use strict';

  const THREE = AFRAME.THREE;
  const $ = (s) => document.querySelector(s);
  const scene = $('#scene');
  const params = new URLSearchParams(location.search);

  // ---------------- small utils ----------------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  const randHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
  const cleanSlug = (r) => String(r || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtMB = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const ago = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(ts).toLocaleDateString();
  };
  function el(tag, attrs, parent) {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  function wrapLines(text, width) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (let word of para.split(/\s+/)) {
        while (word.length > width) {
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, width)); word = word.slice(width);
        }
        if (!word) continue;
        if (!line) line = word;
        else if ((line + ' ' + word).length <= width) line += ' ' + word;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    while (out.length > 1 && out[out.length - 1] === '') out.pop();
    return out;
  }
  // 3D text uses a Latin-only font: replace characters it cannot draw.
  const font3d = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E\n]/g, '?');

  // ---------------- state ----------------
  const device = AFRAME.utils.device;
  const DEVICE = device.isMobileVR() ? 'headset' : device.isMobile() ? 'phone' : 'desktop';
  let ROOM = cleanSlug(params.get('room'));
  const ADMIN = params.get('admin') || '';
  let KEY = store.get('vsn.key');
  if (!KEY) { KEY = randHex(16); store.set('vsn.key', KEY); }

  let config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    noteColors: ['#ffe066', '#ff9ebb', '#a8e06c', '#8fd3fe', '#ffb870', '#d7b8ff'],
    userColors: ['#e4572e', '#2e86ab', '#3bb273', '#f3a712', '#8e44ad', '#e84393', '#16a085', '#d35400'],
    maxText: 280, maxModelMB: 80, maxPdfMB: 40
  };

  const me = { id: null, name: '', color: '', muted: true, isAdmin: false };
  let roomInfo = { slug: ROOM, name: ROOM, desc: '', mine: false };
  const peers = new Map(); // id -> { info, el, pc, transceiver, pending, audio }
  const notes = new Map(); // id -> { data, el }
  const items = new Map(); // id -> { data, root, inner, content, size, ... }
  let ws = null;
  let joined = false;
  let reconnectDelay = 1000;
  let lastNoteColor = store.get('vsn.noteColor') || config.noteColors[0];
  const justUploaded = new Set();

  // ---------------- toast ----------------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
    if (scene.is('vr-mode')) vrToast(msg, ms);
  }
  let vrToastTimer;
  function vrToast(msg, ms = 2200) {
    const t = $('#vrToast');
    t.setAttribute('text', { value: font3d(msg) });
    t.setAttribute('visible', true);
    clearTimeout(vrToastTimer);
    vrToastTimer = setTimeout(() => t.setAttribute('visible', false), ms);
  }

  // ---------------- lobby & rooms ----------------
  function swatches(container, colors, current, onPick, square) {
    container.innerHTML = '';
    colors.forEach((c) => {
      const b = el('button', { type: 'button', class: 'swatch' + (square ? ' square' : ''), 'aria-label': 'Color ' + c, 'aria-pressed': String(c === current) }, container);
      b.style.background = c;
      b.addEventListener('click', () => {
        container.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        onPick(c);
      });
    });
  }

  async function loadConfig() {
    try {
      const r = await fetch('/api/config', { cache: 'no-store' });
      if (r.ok) Object.assign(config, await r.json());
    } catch (e) { /* defaults */ }
    if (!config.noteColors.includes(lastNoteColor)) lastNoteColor = config.noteColors[0];
  }

  let roomList = [];
  let selectedRoom = null; // { slug, name, desc, ... }

  function roomMeta(r) {
    const bits = [];
    bits.push(r.online ? `${r.online} here now` : 'nobody here');
    bits.push(`${r.notes || 0} note${r.notes === 1 ? '' : 's'}`);
    if (r.items) bits.push(`${r.items} file${r.items === 1 ? '' : 's'}`);
    if (r.unlisted) bits.push('unlisted');
    return bits.join(' · ');
  }

  function renderRoomList() {
    const box = $('#roomList');
    box.innerHTML = '';
    const list = [...roomList];
    if (selectedRoom && !list.some((r) => r.slug === selectedRoom.slug)) list.unshift(selectedRoom);
    if (!list.length) { el('p', { class: 'fine' }, box).textContent = 'No rooms yet. Create one.'; return; }
    for (const r of list) {
      const b = el('button', { type: 'button', class: 'room-row', role: 'option', 'aria-selected': String(!!selectedRoom && selectedRoom.slug === r.slug) }, box);
      el('b', {}, b).textContent = r.name;
      if (r.desc) el('span', { class: 'desc' }, b).textContent = r.desc;
      el('span', { class: 'meta' }, b).textContent = roomMeta(r);
      b.addEventListener('click', () => { selectedRoom = r; renderRoomList(); updateJoinLabels(); });
    }
  }

  function updateJoinLabels() {
    $('#joinMic').disabled = !selectedRoom || !window.RTCPeerConnection || !navigator.mediaDevices;
    $('#joinMuted').disabled = !selectedRoom;
  }

  async function loadRooms() {
    try {
      const r = await fetch('/api/rooms', { cache: 'no-store' });
      roomList = (await r.json()).rooms || [];
    } catch (e) { roomList = []; }
    if (ROOM && (!selectedRoom || selectedRoom.slug !== ROOM)) {
      selectedRoom = roomList.find((r) => r.slug === ROOM) || null;
      if (!selectedRoom) {
        try {
          const r = await fetch(`/api/rooms/${encodeURIComponent(ROOM)}`, { cache: 'no-store' });
          if (r.ok) selectedRoom = (await r.json()).room;
        } catch (e) { /* ignore */ }
      }
      if (!selectedRoom) selectedRoom = { slug: ROOM, name: ROOM, desc: 'New room (will be created when you join)', unlisted: true, online: 0, notes: 0, items: 0 };
    }
    if (!selectedRoom) selectedRoom = roomList.find((r) => r.slug === 'main') || roomList[0] || null;
    renderRoomList();
    updateJoinLabels();
  }

  function initLobby() {
    $('#nameInput').value = store.get('vsn.name') || '';
    loadAvatar();
    $('#customizeBtn').addEventListener('click', openAvatarEditor);

    $('#newRoomBtn').addEventListener('click', () => { $('#createRoom').hidden = false; $('#roomName').focus(); });
    $('#cancelRoom').addEventListener('click', () => { $('#createRoom').hidden = true; });
    $('#createRoom').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#createRoom button[type=submit]');
      btn.disabled = true;
      try {
        const r = await fetch('/api/rooms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: $('#roomName').value, desc: $('#roomDesc').value, unlisted: $('#roomUnlisted').checked, key: KEY })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Could not create the room.');
        selectedRoom = data.room;
        $('#createRoom').hidden = true;
        $('#createRoom').reset();
        $('#lobbyMsg').textContent = `Room "${data.room.name}" created. Its link: ${location.origin}/?room=${data.room.slug}`;
        await loadRooms();
      } catch (err) {
        $('#lobbyMsg').textContent = err.message;
      } finally { btn.disabled = false; }
    });

    const go = (withMic) => join(withMic).catch((e) => { console.error(e); $('#lobbyMsg').textContent = 'Could not join: ' + e.message; });
    $('#joinMic').addEventListener('click', () => go(true));
    $('#joinMuted').addEventListener('click', () => go(false));
    if (!window.RTCPeerConnection || !navigator.mediaDevices) {
      $('#lobbyMsg').textContent = 'Voice chat needs a secure (https) page and a browser with microphone support.';
    }
    loadRooms();
  }

  async function join(withMic) {
    if (!selectedRoom) return;
    me.name = $('#nameInput').value.trim().slice(0, 24) || 'Guest ' + Math.floor(Math.random() * 90 + 10);
    store.set('vsn.name', me.name);
    saveAvatarLocal();
    ROOM = selectedRoom.slug;
    const u = new URL(location.href); u.searchParams.set('room', ROOM); history.replaceState(null, '', u);
    unlockAudio();
    if (TOUCH_UI && gyroOn) requestGyroPermission(); // must come straight from the Join tap on iPhone
    if (withMic) {
      $('#lobbyMsg').textContent = 'Asking for microphone access...';
      const ok = await startMic();
      me.muted = !ok;
      if (!ok) toast('Microphone unavailable. You joined muted.');
    } else me.muted = true;
    $('#lobby').hidden = true;
    $('#hud').hidden = false;
    $('#roomLabel').textContent = selectedRoom.name;
    joined = true;
    updateMicUI();
    placeAtSpawn();
    setupTouchControls();
    connect();
    startPoseLoop();
    if (TOUCH_UI) toast('Left stick to move. Right stick or turn your phone to look around. Tap a board, model or PDF to interact.', 5200);
    else if (DEVICE === 'desktop') toast('Drag to look, WASD to move. Click a board, model or PDF to leave a note.', 4200);
    else toast('Press VR to enter. Point and pull the trigger to leave a note.', 4200);
  }

  // ---------------- networking ----------------
  function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(ROOM)}`);
    ws.onopen = () => {
      reconnectDelay = 1000;
      send({ type: 'hello', name: me.name, color: me.avatar.shirt, avatar: me.avatar, device: DEVICE, muted: me.muted, key: KEY, admin: ADMIN || undefined });
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      try { handle(m); } catch (e) { console.error('handler error', m.type, e); }
    };
    ws.onclose = () => {
      for (const id of [...peers.keys()]) removePeer(id);
      updatePeopleCount();
      if (!joined) return;
      toast('Connection lost. Reconnecting...');
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    };
  }

  function handle(m) {
    switch (m.type) {
      case 'welcome': {
        me.id = m.id;
        me.isAdmin = !!m.isAdmin;
        roomInfo = m.room;
        $('#roomLabel').textContent = roomInfo.name;
        $('#roomTitle3d').setAttribute('text', { value: font3d(roomInfo.name).toUpperCase().slice(0, 34) });
        document.title = `${roomInfo.name} - VR Sticky Notes`;
        for (const id of [...notes.keys()]) removeNote(id);
        const incoming = new Set(m.items.map((i) => i.id));
        for (const id of [...items.keys()]) if (!incoming.has(id)) removeItem(id);
        m.items.forEach(addItem);
        m.notes.forEach(addNote);
        m.peers.forEach((p) => { addPeer(p); if (me.id < p.id) callPeer(p.id); });
        updatePeopleCount();
        toast(m.peers.length ? `Joined "${roomInfo.name}" with ${m.peers.length} other${m.peers.length > 1 ? 's' : ''}` : `Joined "${roomInfo.name}". Use Invite to bring others.`);
        break;
      }
      case 'peer-join':
        addPeer(m.peer);
        if (me.id < m.peer.id) callPeer(m.peer.id);
        updatePeopleCount();
        toast(`${m.peer.name} joined`);
        break;
      case 'peer-leave': {
        const p = peers.get(m.id);
        if (p) toast(`${p.info.name} left`);
        removePeer(m.id);
        updatePeopleCount();
        break;
      }
      case 'peer-update': updatePeer(m.peer); break;
      case 'pose': {
        const p = peers.get(m.id);
        if (p) {
          p.info.p = m.p; p.info.q = m.q;
          const c = p.el.components && p.el.components['avatar-lerp'];
          if (c) c.setTarget(m.p, m.q);
        }
        break;
      }
      case 'speaking': {
        const p = peers.get(m.id);
        if (p) p.el.querySelector('.av-ring').setAttribute('visible', !!m.on);
        break;
      }
      case 'note-add': addNote(m.note); break;
      case 'note-update': updateNote(m.note); break;
      case 'note-delete': removeNote(m.id); break;
      case 'item-add':
        addItem(m.item);
        if (!m.item.mine) toast(`${m.item.author} added "${m.item.name}"`);
        break;
      case 'item-update': updateItem(m.item); break;
      case 'item-replace':
        if (!m.item.mine && !justUploaded.has(m.item.id)) toast(`${m.item.updatedBy || 'Someone'} replaced "${m.item.name}"`);
        replaceItem(m.item);
        break;
      case 'item-delete': removeItem(m.id); break;
      case 'signal': handleSignal(m.from, m.data); break;
      case 'room-deleted':
        joined = false;
        toast('This room was deleted. Returning to the room list...', 3000);
        setTimeout(() => { location.href = '/'; }, 2500);
        break;
      case 'error': toast(m.message || 'Something went wrong', 4000); if (m.code === 'room_full') joined = false; break;
      default: break;
    }
  }

  let poseTimer;
  function startPoseLoop() {
    const cam = $('#cam').object3D;
    const p = new THREE.Vector3(); const q = new THREE.Quaternion();
    let last = ''; let lastSent = 0;
    clearInterval(poseTimer);
    poseTimer = setInterval(() => {
      if (!me.id) return;
      cam.getWorldPosition(p); cam.getWorldQuaternion(q);
      const pa = p.toArray().map((v) => +v.toFixed(3));
      const qa = q.toArray().map((v) => +v.toFixed(3));
      const key = pa.join() + qa.join();
      const now = Date.now();
      if (key !== last || now - lastSent > 3000) { send({ type: 'pose', p: pa, q: qa }); last = key; lastSent = now; }
      updateVolumes(p);
    }, 100);
  }

  // ---------------- avatars ----------------
  // Choices (the server checks them too): shirt colour, skin tone, head shape, headwear,
  // eyewear and a hi-vis vest.
  const AV = {
    skin: ['#f6d7b8', '#e8b98f', '#c98f62', '#a46a3f', '#7a4a2a', '#4f2f1c'],
    head: [['round', 'Round'], ['square', 'Square']],
    hat: [['none', 'None'], ['hardhat-yellow', 'Hard hat, yellow'], ['hardhat-white', 'Hard hat, white'], ['hardhat-orange', 'Hard hat, orange'], ['cap', 'Cap'], ['beanie', 'Beanie'], ['headphones', 'Headphones']],
    eyes: [['none', 'None'], ['glasses', 'Glasses'], ['safety', 'Safety glasses']]
  };
  const HAT_COLORS = { 'hardhat-yellow': '#f5c400', 'hardhat-white': '#f2f2ee', 'hardhat-orange': '#f36f21' };
  const VEST = '#cdf23a';
  function defaultAvatar() {
    return { shirt: config.userColors[Math.floor(Math.random() * config.userColors.length)], skin: AV.skin[1], head: 'round', hat: 'none', eyes: 'none', vest: false };
  }
  function cleanAvatar(a) {
    const d = defaultAvatar();
    a = a && typeof a === 'object' ? a : {};
    const has = (list, v) => list.some((x) => (Array.isArray(x) ? x[0] : x) === v);
    return {
      shirt: config.userColors.includes(a.shirt) ? a.shirt : d.shirt,
      skin: has(AV.skin, a.skin) ? a.skin : d.skin,
      head: has(AV.head, a.head) ? a.head : 'round',
      hat: has(AV.hat, a.hat) ? a.hat : 'none',
      eyes: has(AV.eyes, a.eyes) ? a.eyes : 'none',
      vest: a.vest === true
    };
  }
  function loadAvatar() {
    let saved = null;
    try { saved = JSON.parse(store.get('vsn.avatar') || 'null'); } catch (e) { /* ignore */ }
    if (!saved) { const old = store.get('vsn.color'); if (old) saved = { shirt: old }; }
    me.avatar = cleanAvatar(saved);
    me.color = me.avatar.shirt;
    renderAvatarSvg($('#lobbyAvatar'), me.avatar);
  }
  function saveAvatarLocal() { store.set('vsn.avatar', JSON.stringify(me.avatar)); }

  // 2D preview (lobby and editor)
  function renderAvatarSvg(container, a) {
    if (!container) return;
    const hat = a.hat, sq = a.head === 'square';
    const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const c = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`; };
    let s = '<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg">';
    s += '<ellipse cx="60" cy="144" rx="34" ry="4" fill="rgba(38,43,51,.15)"/>';
    s += `<path d="M28 142 L34 92 Q60 78 86 92 L92 142 Z" fill="${a.shirt}"/>`;
    if (a.vest) s += `<path d="M34 96 Q60 84 86 96 L89 130 L31 130 Z" fill="${VEST}"/><rect x="31.5" y="106" width="57" height="4" fill="#e6e9ec"/><rect x="31" y="118" width="58" height="4" fill="#e6e9ec"/><path d="M60 88 L60 130" stroke="${shade(VEST, 0.75)}" stroke-width="2"/>`;
    s += `<rect x="53" y="76" width="14" height="12" rx="3" fill="${shade(a.skin, 0.9)}"/>`;
    s += sq ? `<rect x="36" y="30" width="48" height="50" rx="10" fill="${a.skin}"/>` : `<circle cx="60" cy="54" r="26" fill="${a.skin}"/>`;
    s += '<circle cx="51" cy="56" r="3.2" fill="#262b33"/><circle cx="69" cy="56" r="3.2" fill="#262b33"/>';
    if (a.eyes === 'glasses') s += '<g fill="none" stroke="#262b33" stroke-width="2.2"><circle cx="51" cy="56" r="7"/><circle cx="69" cy="56" r="7"/><path d="M58 56 h4"/></g>';
    if (a.eyes === 'safety') s += '<rect x="40" y="49" width="40" height="14" rx="6" fill="rgba(140,200,240,.55)" stroke="#262b33" stroke-width="2"/>';
    const top = sq ? 30 : 28;
    if (HAT_COLORS[hat]) { const c = HAT_COLORS[hat]; s += `<path d="M34 ${top + 16} Q34 ${top - 8} 60 ${top - 9} Q86 ${top - 8} 86 ${top + 16} Z" fill="${c}"/><rect x="28" y="${top + 13}" width="64" height="6" rx="3" fill="${shade(c, 0.88)}"/><rect x="57" y="${top - 8}" width="6" height="22" rx="3" fill="${shade(c, 0.9)}"/>`; }
    if (hat === 'cap') s += `<path d="M36 ${top + 14} Q36 ${top - 6} 60 ${top - 6} Q84 ${top - 6} 84 ${top + 14} Z" fill="${shade(a.shirt, 0.8)}"/><path d="M62 ${top + 10} L96 ${top + 14} L94 ${top + 18} L62 ${top + 16} Z" fill="${shade(a.shirt, 0.65)}"/>`;
    if (hat === 'beanie') s += `<path d="M36 ${top + 12} Q36 ${top - 14} 60 ${top - 14} Q84 ${top - 14} 84 ${top + 12} Z" fill="${shade(a.shirt, 0.75)}"/><rect x="34" y="${top + 8}" width="52" height="9" rx="4" fill="${shade(a.shirt, 0.6)}"/>`;
    if (hat === 'headphones') s += `<path d="M34 54 Q34 ${top - 6} 60 ${top - 6} Q86 ${top - 6} 86 54" fill="none" stroke="#262b33" stroke-width="4"/><rect x="27" y="47" width="10" height="18" rx="4" fill="#262b33"/><rect x="83" y="47" width="10" height="18" rx="4" fill="#262b33"/>`;
    s += '</svg>';
    container.innerHTML = s;
  }

  // 3D avatar (three.js meshes under the head and body entities)
  const avMats = new Map();
  function avMat(color, opts) {
    const key = color + JSON.stringify(opts || {});
    if (!avMats.has(key)) avMats.set(key, new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0 }, opts || {})));
    return avMats.get(key);
  }
  const AVG = {
    sphere: new THREE.SphereGeometry(1, 24, 16),
    dome: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
    torso: new THREE.CylinderGeometry(0.17, 0.15, 0.55, 24),
    vest: new THREE.CylinderGeometry(0.178, 0.158, 0.44, 24, 1, true),
    ring: new THREE.TorusGeometry(1, 0.06, 8, 32),
    band: new THREE.TorusGeometry(0.17, 0.012, 8, 24, Math.PI)
  };
  function avMesh(parent, geo, mat, pos, scale, rot) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    parent.add(m);
    return m;
  }
  function buildAvatar(p) {
    const a = cleanAvatar(p.info.avatar || { shirt: p.info.color });
    const key = JSON.stringify(a);
    if (p.avatarKey === key) return;
    p.avatarKey = key;
    const head = p.el.querySelector('.av-head').object3D;
    const body = p.el.querySelector('.av-body').object3D;
    [head, body].forEach((g) => { [...g.children].forEach((c) => { if (c.userData.av) g.remove(c); }); });
    const H = new THREE.Group(); H.userData.av = true; head.add(H);
    const B = new THREE.Group(); B.userData.av = true; body.add(B);
    const skin = avMat(a.skin), shirt = avMat(a.shirt, { roughness: 0.8 }), dark = avMat('#262b33', { roughness: 0.4 });
    const sq = a.head === 'square';
    // head and face (the face looks along -z, the way the person is looking)
    if (sq) avMesh(H, AVG.box, skin, [0, 0, 0], [0.27, 0.29, 0.27]);
    else avMesh(H, AVG.sphere, skin, [0, 0, 0], [0.155, 0.16, 0.155]);
    const fz = sq ? -0.137 : -0.138;
    for (const x of [-0.05, 0.05]) avMesh(H, AVG.sphere, dark, [x, 0.02, fz], [0.022, 0.024, 0.012]);
    if (a.eyes === 'glasses') {
      for (const x of [-0.05, 0.05]) avMesh(H, AVG.ring, dark, [x, 0.02, fz - 0.008], [0.038, 0.038, 0.038]);
      avMesh(H, AVG.box, dark, [0, 0.022, fz - 0.008], [0.03, 0.006, 0.006]);
    } else if (a.eyes === 'safety') {
      avMesh(H, AVG.box, avMat('#8cc8f0', { transparent: true, opacity: 0.55, roughness: 0.1 }), [0, 0.02, fz - 0.012], [0.25, 0.07, 0.015]);
      avMesh(H, AVG.box, dark, [0, 0.058, fz - 0.012], [0.25, 0.01, 0.018]);
    }
    const top = sq ? 0.145 : 0.04;
    if (HAT_COLORS[a.hat]) {
      const hm = avMat(HAT_COLORS[a.hat], { roughness: 0.35 });
      avMesh(H, AVG.dome, hm, [0, top, 0], sq ? [0.19, 0.12, 0.19] : [0.17, 0.15, 0.17]);
      avMesh(H, AVG.cyl, hm, [0, top + 0.004, 0], sq ? [0.23, 0.012, 0.23] : [0.21, 0.012, 0.21]);
      avMesh(H, AVG.box, hm, [0, top + (sq ? 0.11 : 0.13), 0], [0.035, 0.035, sq ? 0.3 : 0.28]);
    } else if (a.hat === 'cap') {
      const cm = avMat(a.shirt, { roughness: 0.8 });
      avMesh(H, AVG.dome, cm, [0, top, 0], sq ? [0.15, 0.08, 0.15] : [0.162, 0.13, 0.162]);
      avMesh(H, AVG.box, cm, [0, top + 0.005, -0.17], [0.17, 0.012, 0.13]);
    } else if (a.hat === 'beanie') {
      const bm = avMat(a.shirt, { roughness: 0.95 });
      avMesh(H, AVG.dome, bm, [0, top, 0], sq ? [0.15, 0.12, 0.15] : [0.165, 0.19, 0.165]);
      avMesh(H, AVG.ring, bm, [0, top + 0.01, 0], sq ? [0.15, 0.15, 0.4] : [0.16, 0.16, 0.45], [Math.PI / 2, 0, 0]);
    } else if (a.hat === 'headphones') {
      const band = avMesh(H, AVG.band, dark, [0, 0.01, 0], sq ? [1.05, 1, 1] : [1, 1, 1]);
      band.rotation.set(0, 0, 0);
      for (const x of [-0.165, 0.165]) avMesh(H, AVG.cyl, dark, [x * (sq ? 1.05 : 1), 0.01, 0], [0.05, 0.04, 0.05], [0, 0, Math.PI / 2]);
    }
    // neck, shoulders, body, optional vest
    avMesh(B, AVG.cyl, skin, [0, -0.2, 0], [0.055, 0.1, 0.055]);
    avMesh(B, AVG.sphere, shirt, [0, -0.25, 0], [0.17, 0.08, 0.15]);
    avMesh(B, AVG.torso, shirt, [0, -0.52, 0]);
    if (a.vest) {
      const vm = avMat(VEST, { roughness: 0.6, emissive: new THREE.Color(VEST), emissiveIntensity: 0.25, side: THREE.DoubleSide });
      avMesh(B, AVG.vest, vm, [0, -0.5, 0]);
      const stripe = avMat('#e6e9ec', { roughness: 0.2, metalness: 0.5 });
      for (const y of [-0.45, -0.6]) avMesh(B, AVG.ring, stripe, [0, y, 0], [0.172, 0.172, 0.2], [Math.PI / 2, 0, 0]);
    }
    p.el.querySelector('.av-tag').object3D.position.y = a.hat === 'none' ? 0.34 : 0.4;
  }

  function addPeer(info) {
    if (peers.has(info.id)) { updatePeer(info); return; }
    const root = el('a-entity', { 'avatar-lerp': '' }, $('#avatars'));
    root.object3D.position.fromArray(info.p || [0, 1.6, 0]);
    el('a-entity', { class: 'av-head' }, root);
    el('a-entity', { class: 'av-body' }, root);
    const tag = el('a-entity', { class: 'av-tag', billboard: '', position: '0 0.36 0' }, root);
    const bg = el('a-plane', { class: 'av-tagbg', width: 0.6, height: 0.11 }, tag);
    bg.setAttribute('material', { color: '#1b1f27', shader: 'flat', opacity: 0.8, transparent: true });
    const name = el('a-entity', { class: 'av-name', position: '0 0 0.002' }, tag);
    name.setAttribute('text', { value: '', align: 'center', color: '#ffffff', width: 0.9, wrapCount: 22 });
    const ring = el('a-ring', { class: 'av-ring', 'radius-inner': 0.2, 'radius-outer': 0.235, visible: false, billboard: '' }, root);
    ring.setAttribute('material', { color: '#3bd17a', shader: 'flat', side: 'double' });
    peers.set(info.id, { info: { ...info }, el: root, pc: null, transceiver: null, pending: [], audio: null, avatarKey: null });
    updatePeer(info);
    root.addEventListener('loaded', () => {
      const cur = peers.get(info.id);
      if (cur && cur.info.p && cur.info.q) root.components['avatar-lerp'].setTarget(cur.info.p, cur.info.q);
    }, { once: true });
  }

  function updatePeer(info) {
    const p = peers.get(info.id);
    if (!p) return;
    Object.assign(p.info, info);
    buildAvatar(p);
    const label = font3d(p.info.name + (p.info.muted ? '  (muted)' : ''));
    p.el.querySelector('.av-name').setAttribute('text', { value: label });
    p.el.querySelector('.av-tagbg').setAttribute('width', Math.max(0.3, label.length * 0.034 + 0.08));
    if (p.info.muted) p.el.querySelector('.av-ring').setAttribute('visible', false);
    refreshPanel('people');
  }

  // Editor (lobby and in the room)
  let avDraft = null;
  function openAvatarEditor() {
    avDraft = Object.assign({}, me.avatar);
    const draw = () => {
      renderAvatarSvg($('#avatarPreview'), avDraft);
      const pick = (box, list, key) => {
        box.innerHTML = '';
        list.forEach(([v, label]) => {
          const b = el('button', { type: 'button', 'aria-pressed': String(avDraft[key] === v) }, box);
          b.textContent = label;
          b.onclick = () => { avDraft[key] = v; draw(); };
        });
      };
      pick($('#avHead'), AV.head, 'head');
      pick($('#avHat'), AV.hat, 'hat');
      pick($('#avEyes'), AV.eyes, 'eyes');
      $('#avVest').checked = !!avDraft.vest;
    };
    swatches($('#avShirt'), config.userColors, avDraft.shirt, (c) => { avDraft.shirt = c; renderAvatarSvg($('#avatarPreview'), avDraft); });
    swatches($('#avSkin'), AV.skin, avDraft.skin, (c) => { avDraft.skin = c; renderAvatarSvg($('#avatarPreview'), avDraft); });
    $('#avVest').onchange = () => { avDraft.vest = $('#avVest').checked; renderAvatarSvg($('#avatarPreview'), avDraft); };
    draw();
    openSheet('#avatarSheet');
  }
  $('#avSave').addEventListener('click', () => {
    me.avatar = cleanAvatar(avDraft);
    me.color = me.avatar.shirt;
    saveAvatarLocal();
    renderAvatarSvg($('#lobbyAvatar'), me.avatar);
    closeSheet('#avatarSheet');
    if (joined) { send({ type: 'profile', avatar: me.avatar }); toast('Avatar saved. Everyone here sees the new look.'); refreshPanel('people'); }
  });

  function removePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    if (p.pc) try { p.pc.close(); } catch (e) { /* ignore */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
    peers.delete(id);
    refreshPanel('people');
  }

  function updatePeopleCount() { $('#peopleCount').textContent = String(peers.size + 1); }

  // ---------------- voice (WebRTC mesh) ----------------
  let audioCtx = null;
  let localStream = null;
  let localTrack = null;
  const blockedAudio = new Set();

  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* no web audio */ }
    blockedAudio.forEach((a) => a.play().then(() => blockedAudio.delete(a)).catch(() => {}));
  }
  ['pointerdown', 'keydown', 'touchend'].forEach((t) => window.addEventListener(t, () => { if (blockedAudio.size) unlockAudio(); }, { passive: true }));

  async function startMic() {
    if (localTrack) return true;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { console.warn('mic error', e); return false; }
    localTrack = localStream.getAudioTracks()[0];
    localTrack.enabled = !me.muted;
    for (const p of peers.values()) if (p.transceiver) p.transceiver.sender.replaceTrack(localTrack).catch(() => {});
    startSpeakingDetector();
    return true;
  }

  async function setMuted(muted) {
    if (!muted && !localTrack) {
      const ok = await startMic();
      if (!ok) { toast('Microphone blocked. Allow it in your browser settings.', 4000); return; }
    }
    me.muted = muted;
    if (localTrack) localTrack.enabled = !muted;
    send({ type: 'profile', muted });
    updateMicUI();
    if (muted) sendSpeaking(false);
    if (scene.is('vr-mode')) vrToast(muted ? 'Mic off' : 'Mic on', 1200);
  }

  function updateMicUI() {
    const b = $('#micBtn');
    b.classList.toggle('on', !me.muted);
    b.classList.toggle('off', me.muted);
    b.setAttribute('aria-label', me.muted ? 'Unmute microphone' : 'Mute microphone');
    const lbl = $('#micLbl');
    if (lbl) lbl.textContent = me.muted ? 'Muted' : 'Mic on';
    b.setAttribute('aria-pressed', String(!me.muted));
  }

  let speaking = false;
  function sendSpeaking(on) {
    if (on === speaking) return;
    speaking = on;
    $('#micMeter').classList.toggle('active', on);
    send({ type: 'speaking', on });
  }
  function startSpeakingDetector() {
    if (!audioCtx || !localStream) return;
    try {
      const src = audioCtx.createMediaStreamSource(localStream);
      const an = audioCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let loudUntil = 0;
      setInterval(() => {
        if (me.muted) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        if (Math.sqrt(sum / buf.length) > 0.035) loudUntil = Date.now() + 350;
        sendSpeaking(Date.now() < loudUntil);
      }, 90);
    } catch (e) { /* analyser not available */ }
  }

  function getPC(id) {
    const peer = peers.get(id);
    if (!peer) return null;
    if (peer.pc) return peer.pc;
    const pc = new RTCPeerConnection({ iceServers: config.iceServers });
    peer.pc = pc;
    pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'signal', to: id, data: { candidate: e.candidate.toJSON() } }); };
    pc.ontrack = (e) => attachAudio(id, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && me.id < id) {
        try { pc.restartIce(); } catch (e) { /* older browser */ }
        makeOffer(id, true);
      }
    };
    return pc;
  }

  async function callPeer(id) {
    if (!window.RTCPeerConnection) return;
    const pc = getPC(id);
    if (!pc) return;
    const peer = peers.get(id);
    peer.transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    if (localTrack) await peer.transceiver.sender.replaceTrack(localTrack);
    await makeOffer(id);
  }

  async function makeOffer(id, iceRestart) {
    const pc = getPC(id);
    if (!pc) return;
    try {
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await pc.setLocalDescription(offer);
      send({ type: 'signal', to: id, data: { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } } });
    } catch (e) { console.warn('offer failed', e); }
  }

  async function handleSignal(from, data) {
    if (!window.RTCPeerConnection) return;
    const peer = peers.get(from);
    if (!peer) return;
    const pc = getPC(from);
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const tr = pc.getTransceivers().find((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
          if (tr) {
            tr.direction = 'sendrecv';
            peer.transceiver = tr;
            if (localTrack) await tr.sender.replaceTrack(localTrack);
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: 'signal', to: from, data: { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } } });
        }
        const queued = peer.pending.splice(0);
        for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pending.push(data.candidate);
      }
    } catch (e) { console.warn('signal error', e); }
  }

  function attachAudio(id, stream) {
    const peer = peers.get(id);
    if (!peer) return;
    if (!peer.audio) peer.audio = el('audio', { autoplay: '', playsinline: '' }, $('#audioBin'));
    peer.audio.srcObject = stream;
    peer.audio.play().catch(() => blockedAudio.add(peer.audio));
  }

  function updateVolumes(myPos) {
    for (const p of peers.values()) {
      const pos = p.el.object3D.position;
      const d = Math.hypot(pos.x - myPos.x, pos.z - myPos.z);
      // hide an avatar you are standing inside, so it doesn't block your view
      p.el.object3D.visible = d > 0.55 || Math.abs(pos.y - myPos.y) > 0.8;
      if (!p.audio) continue;
      try { p.audio.volume = d < 2.5 ? 1 : Math.max(0.15, 1 - (d - 2.5) / 14); } catch (e) { /* iOS */ }
    }
  }

  // Arrive at the hall entrance facing in. The spot is slightly random so people joining
  // together don't stand inside each other.
  function placeAtSpawn() {
    const rig = $('#rig').object3D;
    rig.position.set(+(Math.random() * 2.4 - 1.2).toFixed(2), 0, +(20.4 + Math.random() * 1.4).toFixed(2));
    rig.rotation.set(0, 0, 0);
  }

  // ---------------- the exhibition hall ----------------
  // 48 x 48 m hall with 15 booths: 5 along the left wall (1-5, front to back), 5 along the back
  // wall (6-10, left to right) and 5 along the right wall (11-15, back to front). Every booth
  // holds one model on a plinth and two PDFs on stands. A free-standing notice wall sits in the
  // middle of the hall, facing the entrance.
  const HALL = { half: 24, wallH: 8 };
  const C3D = { concrete: '#d4d8db', inlay: '#c7ccd0', plaster: '#f2f3f1', panel: '#f8f9f8', steel: '#8a929c', graphite: '#262b33', felt: '#dde1e4', blueprint: '#2f6fc4' };
  const BOOTH_W = 6, BOOTH_D = 4.2, PLINTH = { r: 1.05, h: 0.25, z: 2.55 };
  const BOOTHS = [];
  [16, 8, 0, -8, -16].forEach((z) => BOOTHS.push({ n: BOOTHS.length + 1, x: -HALL.half + 0.12, z, ry: 90 }));
  [-16, -8, 0, 8, 16].forEach((x) => BOOTHS.push({ n: BOOTHS.length + 1, x, z: -HALL.half + 0.12, ry: 0 }));
  [-16, -8, 0, 8, 16].forEach((z) => BOOTHS.push({ n: BOOTHS.length + 1, x: HALL.half - 0.12, z, ry: -90 }));
  const SLOT = {
    pdf1: { x: -1.8, z: 0.75, ry: 12, label: 'PDF 1' },
    pdf2: { x: 1.8, z: 0.75, ry: -12, label: 'PDF 2' },
    model: { x: 0, z: PLINTH.z, y: PLINTH.h, ry: 0, label: 'Model' }
  };

  // World position and rotation of a slot inside a booth.
  function slotPlacement(boothN, slot) {
    const b = BOOTHS[boothN - 1]; const sl = SLOT[slot];
    if (!b || !sl) return null;
    const a = THREE.MathUtils.degToRad(b.ry);
    const x = b.x + sl.x * Math.cos(a) + sl.z * Math.sin(a);
    const z = b.z - sl.x * Math.sin(a) + sl.z * Math.cos(a);
    return { p: [+x.toFixed(3), sl.y || 0, +z.toFixed(3)], ry: ((b.ry + sl.ry) % 360 + 360) % 360, s: slot === 'model' ? undefined : 1 };
  }
  // What is in a booth right now: { model, pdf1, pdf2 } (records or undefined)
  function boothContents(n) {
    const out = {};
    for (const rec of items.values()) if (rec.data.booth === n && rec.data.slot) out[rec.data.slot] = rec;
    return out;
  }
  function freeSlot(n, kind) {
    const c = boothContents(n);
    return (kind === 'pdf' ? ['pdf1', 'pdf2'] : ['model']).find((sl) => !c[sl]) || null;
  }
  function nearestBooth(filterFn) {
    const cam = scene.camera ? scene.camera.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    let best = null, bd = Infinity;
    for (const b of BOOTHS) {
      if (filterFn && !filterFn(b)) continue;
      const d = Math.hypot(b.x - cam.x, b.z - cam.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  // Which booth an object belongs to (or null for free-standing objects and doorways).
  function exhibitOf(d) {
    if (!d || !d.booth || !BOOTHS[d.booth - 1]) return null;
    return { booth: BOOTHS[d.booth - 1], slot: d.slot };
  }
  // Scale that makes a model fit on its plinth (or null if it already fits).
  function fitPatchFor(rec) {
    if (rec.data.kind !== 'model' || !rec.size) return null;
    const foot = Math.max(rec.size.x, rec.size.z), hgt = rec.size.y;
    const s = Math.min(2.0 / foot, 2.6 / Math.max(hgt, 0.01));
    if (Math.abs(s - (rec.data.s || 1)) < 0.001) return null;
    return +s.toPrecision(4);
  }
  // Put an object back on its spot in its booth.
  function resetToSlot(id) {
    const rec = items.get(id);
    if (!rec || !rec.data.booth) return;
    const sp = slotPlacement(rec.data.booth, rec.data.slot);
    if (!sp) return;
    const patch = { p: sp.p, ry: sp.ry };
    if (rec.data.kind === 'model') { const fit = fitPatchFor(rec); if (fit) patch.s = fit; }
    itemPatch(id, patch);
  }

  // Booth signs show the booth number and what is on display; the "+ Add file" sign shows
  // only while the booth still has room.
  function updateBoothLabels() {
    for (const b of BOOTHS) {
      if (!b.label) continue;
      const c = boothContents(b.n);
      const main = c.model || c.pdf1 || c.pdf2;
      const text = main ? `${b.n}  ${font3d(itemTitle(main.data)).toUpperCase().slice(0, 26)}` : `BOOTH ${b.n}`;
      if (b.labelText !== text) { b.label.setAttribute('text', { value: text }); b.labelText = text; }
      if (b.plaque) {
        const needModel = !c.model, needPdf = !c.pdf1 || !c.pdf2;
        const label = needModel && needPdf ? '+ Add model or PDF' : needModel ? '+ Add model' : needPdf ? '+ Add PDF' : '';
        const show = !!label;
        if (b.plaqueText !== label) {
          b.plaqueText = label;
          b.plaque.setAttribute('visible', show);
          b.plaque.classList.toggle('clickable', show);
          if (show) b.plaque.setAttribute('text', { value: label });
          refreshRaycasters();
        }
      }
    }
  }

  function buildVenue() {
    const root = $('#venue');
    if (!root || root.children.length || root.__built) return;
    root.__built = true;
    const L = window.VSNLook;
    const H = HALL.half, WH = HALL.wallH;
    // Decoration is plain three.js (fast); only surfaces you can click are A-Frame entities.
    const deco = new THREE.Group();
    root.object3D.add(deco);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    const add = (geo, mat, pos, scale, rot, cast, receive, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(pos[0], pos[1], pos[2]);
      if (scale) m.scale.set(scale[0], scale[1], scale[2]);
      if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      m.castShadow = !!cast; m.receiveShadow = !!receive;
      (parent || deco).add(m);
      return m;
    };
    const floorDecal = (canvasEl, x, z, w, d, rotY, opacity, y, parent) =>
      add(planeGeo, L.decal(canvasEl, opacity), [x, y || 0.012, z], [w, d, 1], [-Math.PI / 2, 0, rotY || 0], false, false, parent);
    // An interactive surface: an A-Frame entity (so it can be clicked and pinned) holding our own
    // textured mesh. Using a plain entity keeps A-Frame from replacing the material.
    const surface = (parent, pos, w, h, d, mat, cls, cast, geo, rotY) => {
      const e = el('a-entity', { position: pos }, parent);
      if (rotY) e.setAttribute('rotation', `0 ${rotY} 0`);
      if (cls) e.className = cls;
      const mesh = new THREE.Mesh(geo || boxGeo, mat);
      if (!geo) mesh.scale.set(w, h, d);
      mesh.castShadow = !!cast; mesh.receiveShadow = true;
      e.setObject3D('mesh', mesh);
      return e;
    };
    const txt = (parent, pos, value, width, color, wrap, rotY) => {
      const t = el('a-entity', { position: pos }, parent);
      if (rotY) t.setAttribute('rotation', `0 ${rotY} 0`);
      t.setAttribute('text', { value, align: 'center', color: color || '#ffffff', width, wrapCount: wrap || 24 });
      return t;
    };

    // materials
    const M = {
      concrete: L.std({ map: L.tex(L.T.concrete(), 48 / 4, 48 / 4), roughness: 0.3, metalness: 0 }),
      plaster: L.std({ map: L.tex(L.T.plaster(), 16, 2.6), roughness: 0.92, emissive: new THREE.Color('#eef0ef'), emissiveIntensity: 0.38 }),
      plasterSm: L.std({ map: L.tex(L.T.plaster(), 6, 2.6), roughness: 0.92, emissive: new THREE.Color('#eef0ef'), emissiveIntensity: 0.38 }),
      graphite: L.std({ color: C3D.graphite, roughness: 0.45, metalness: 0.1 }),
      steel: L.std({ color: '#9aa2ab', roughness: 0.32, metalness: 0.85 }),
      felt: L.std({ map: L.tex(L.T.felt(), 6, 2.4), roughness: 1, emissive: new THREE.Color('#dfe2e4'), emissiveIntensity: 0.3 }),
      feltSm: L.std({ map: L.tex(L.T.felt(), 3.2, 2.4), roughness: 1, emissive: new THREE.Color('#dfe2e4'), emissiveIntensity: 0.3 }),
      oak: L.std({ map: L.tex(L.T.oak(), BOOTH_W / 2.2, BOOTH_D / 2.2), roughness: 0.48 }),
      boothWall: L.std({ map: L.tex(L.T.boothWall()), emissiveMap: L.tex(L.T.boothGlow()), emissive: new THREE.Color('#fff6e8'), emissiveIntensity: 0.62, roughness: 0.9 }),
      side: L.std({ color: '#f1f2f1', roughness: 0.85, emissive: new THREE.Color('#eceeed'), emissiveIntensity: 0.3 }),
      blue: new THREE.MeshBasicMaterial({ color: C3D.blueprint, toneMapped: false }),
      led: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      white: L.std({ color: '#f7f7f6', roughness: 0.22, metalness: 0 }),
      mat: L.std({ color: '#2a2f37', roughness: 1 })
    };

    // floor, aisle lines in front of the booths, entrance mat
    add(planeGeo, M.concrete, [0, 0.004, 0], [2 * H, 2 * H, 1], [-Math.PI / 2, 0, 0], false, true);
    const lineM = L.std({ color: '#8f979f', roughness: 0.4, metalness: 0.7 });
    const edge = H - BOOTH_D - 0.75;
    add(planeGeo, lineM, [-edge, 0.007, 0.75], [0.05, 2 * edge + 1.5, 1], [-Math.PI / 2, 0, 0], false, true);
    add(planeGeo, lineM, [edge, 0.007, 0.75], [0.05, 2 * edge + 1.5, 1], [-Math.PI / 2, 0, 0], false, true);
    add(planeGeo, lineM, [0, 0.007, -edge], [2 * edge, 0.05, 1], [-Math.PI / 2, 0, 0], false, true);
    add(planeGeo, M.mat, [0, 0.008, H - 1.4], [7, 2.8, 1], [-Math.PI / 2, 0, 0], false, true);

    // walls (the front wall has an 8 m entrance) with a soft shadow line along their base
    add(boxGeo, M.plaster, [0, WH / 2, -H], [2 * H, WH, 0.2], null, false, true);
    add(boxGeo, M.plaster, [-H, WH / 2, 0], [0.2, WH, 2 * H], null, false, true);
    add(boxGeo, M.plaster, [H, WH / 2, 0], [0.2, WH, 2 * H], null, false, true);
    add(boxGeo, M.plasterSm, [-14, WH / 2, H], [20, WH, 0.2], null, false, true);
    add(boxGeo, M.plasterSm, [14, WH / 2, H], [20, WH, 0.2], null, false, true);
    add(boxGeo, M.plasterSm, [0, WH - 1.5, H], [8, 3, 0.2], null, false, true);
    add(boxGeo, M.steel, [0, WH - 3, H - 0.12], [8.1, 0.12, 0.08]);
    const ao = L.T.aoStrip();
    floorDecal(ao, 0, -H + 0.65, 2 * H, 1.2, 0);
    floorDecal(ao, -H + 0.65, 0, 2 * H, 1.2, Math.PI / 2);
    floorDecal(ao, H - 0.65, 0, 2 * H, 1.2, -Math.PI / 2);
    floorDecal(ao, -14, H - 0.65, 20, 1.2, Math.PI);
    floorDecal(ao, 14, H - 0.65, 20, 1.2, Math.PI);

    // ceiling with nine skylights, steel trusses and linear pendant lights
    const openings = [];
    for (const cx of [-12, 0, 12]) for (const cz of [-12, 0, 12]) openings.push({ x0: cx - 3.5, x1: cx + 3.5, z0: cz - 2.5, z1: cz + 2.5 });
    const ceilMat = L.std({ map: L.tex(L.T.plaster(), 12, 12), alphaMap: L.T.ceilingAlpha(openings, H), alphaTest: 0.5, roughness: 0.95, side: THREE.FrontSide, emissive: new THREE.Color('#d3d6d9'), emissiveIntensity: 0.75 });
    add(planeGeo, ceilMat, [0, WH, 0], [2 * H, 2 * H, 1], [Math.PI / 2, 0, 0]);
    for (const o of openings) {
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, dz = o.z1 - o.z0;
      add(boxGeo, M.steel, [cx, WH - 0.05, o.z0], [7.1, 0.1, 0.1]);
      add(boxGeo, M.steel, [cx, WH - 0.05, o.z1], [7.1, 0.1, 0.1]);
      for (const dx of [-3.5, -1.75, 0, 1.75, 3.5]) add(boxGeo, M.steel, [cx + dx, WH - 0.05, cz], [0.06, 0.08, dz]);
    }
    for (const z of [-18, -6, 6, 18]) add(boxGeo, M.steel, [0, WH - 0.4, z], [2 * H, 0.14, 0.14]);
    for (const x of [-18, -6, 6, 18]) add(boxGeo, M.steel, [x, WH - 0.4, 0], [0.1, 0.1, 2 * H]);
    for (const x of [-6.2, 6.2]) {
      for (const z of [-15, -5, 5, 15]) {
        add(boxGeo, M.graphite, [x, 6.4, z], [0.12, 0.07, 6]);
        add(boxGeo, M.led, [x, 6.36, z], [0.07, 0.012, 5.9]);
        for (const dz of [-2.6, 2.6]) add(boxGeo, M.graphite, [x, 7.2, z + dz], [0.012, 1.6, 0.012]);
      }
    }

    // free-standing notice wall in the middle of the hall: notice board facing the entrance,
    // Questions and Ideas on the back
    const NZ = 7;
    add(boxGeo, M.graphite, [0, 1.9, NZ], [10.4, 3.8, 0.3], null, true, true);
    add(boxGeo, M.graphite, [0, 4.25, NZ], [10.4, 0.9, 0.34], null, true);
    add(boxGeo, M.blue, [0, 3.77, NZ + 0.18], [10.4, 0.04, 0.02]);
    add(boxGeo, M.blue, [0, 3.77, NZ - 0.18], [10.4, 0.04, 0.02]);
    const title = el('a-entity', { id: 'roomTitle3d', position: `0 4.25 ${NZ + 0.18}` }, root);
    title.setAttribute('text', { value: 'EXHIBITION HALL', align: 'center', color: '#ffffff', width: 9, wrapCount: 30 });
    const nb = surface(root, `0 1.85 ${NZ + 0.17}`, 9.6, 3.1, 0.04, M.felt, 'clickable pinnable');
    nb.id = 'noticeBoard';
    txt(root, `0 3.55 ${NZ + 0.2}`, 'Notice board', 4.5, C3D.graphite, 24);
    for (const [x, name] of [[2.45, 'Questions'], [-2.45, 'Ideas']]) {
      surface(root, `${x} 1.85 ${NZ - 0.17}`, 4.6, 3.1, 0.04, M.feltSm, 'clickable pinnable');
      txt(root, `${x} 3.55 ${NZ - 0.2}`, name, 3.6, C3D.graphite, 18, 180);
    }
    txt(root, `0 4.25 ${NZ - 0.18}`, 'Questions and ideas', 7, '#ffffff', 30, 180);
    floorDecal(L.T.contact(), 0, NZ, 13, 3.4, 0, 0.75, 0.011);

    // booths: oak floor, lit back wall, side panels, sign, three track lights, a plinth for the
    // model, and a "+ Add file" sign at the entrance of the booth
    const trackHeads = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.065, 0.16, 12), M.graphite, BOOTHS.length * 3);
    const tmp = new THREE.Object3D();
    const plinthGeo = new THREE.CylinderGeometry(PLINTH.r, PLINTH.r, PLINTH.h, 64);
    const ringGeo = new THREE.TorusGeometry(PLINTH.r, 0.016, 8, 96);
    const aoM = L.decal(ao, 0.9);
    BOOTHS.forEach((b, i) => {
      const g = el('a-entity', { position: `${b.x} 0 ${b.z}`, rotation: `0 ${b.ry} 0`, class: 'booth' }, root);
      g.dataset.booth = String(b.n);
      const gd = new THREE.Group();
      gd.position.set(b.x, 0, b.z); gd.rotation.y = THREE.MathUtils.degToRad(b.ry);
      deco.add(gd);
      const put = (geo, mat, pos, scale, rot, cast, receive) => add(geo, mat, pos, scale, rot, cast, receive, gd);
      surface(g, '0 1.5 0.05', BOOTH_W, 3.0, 0.1, M.boothWall, 'clickable pinnable', true);
      put(boxGeo, M.graphite, [0, 3.32, 0.1], [BOOTH_W + 0.2, 0.5, 0.18], null, true);
      put(boxGeo, M.blue, [0, 3.06, 0.2], [BOOTH_W + 0.2, 0.035, 0.012]);
      b.label = txt(g, '0 3.32 0.2', `BOOTH ${b.n}`, BOOTH_W - 0.6, '#ffffff', 30);
      b.labelText = `BOOTH ${b.n}`;
      for (const sx of [-BOOTH_W / 2, BOOTH_W / 2]) put(boxGeo, M.side, [sx, 1.25, BOOTH_D / 2], [0.05, 2.5, BOOTH_D], null, true, true);
      put(planeGeo, M.oak, [0, 0.01, BOOTH_D / 2], [BOOTH_W - 0.05, BOOTH_D, 1], [-Math.PI / 2, 0, 0], false, true);
      put(planeGeo, aoM, [0, 0.014, 0.4], [BOOTH_W - 0.1, 0.6, 1], [-Math.PI / 2, 0, 0]);
      // plinth for the model (you can step onto it)
      const pl = surface(g, `0 ${PLINTH.h / 2} ${PLINTH.z}`, 0, 0, 0, M.white, 'clickable floor', true, plinthGeo);
      pl.addEventListener('click', onFloorClick);
      put(ringGeo, M.blue, [0, PLINTH.h, PLINTH.z], null, [Math.PI / 2, 0, 0]);
      floorDecal(L.T.contact(), 0, PLINTH.z, 3, 3, 0, 0.6, 0.013, gd);
      [-2, 0, 2].forEach((tx, k) => {
        tmp.position.set(tx, 3.0, 0.38); tmp.rotation.set(-0.5, 0, 0); tmp.updateMatrix();
        const m4 = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().compose(gd.position, gd.quaternion, new THREE.Vector3(1, 1, 1)), tmp.matrix);
        trackHeads.setMatrixAt(i * 3 + k, m4);
      });
      // "+ Add file" sign on a slim post at the booth entrance
      put(boxGeo, M.steel, [BOOTH_W / 2 - 0.45, 0.55, BOOTH_D - 0.15], [0.04, 1.1, 0.04], null, true);
      b.plaque = vrButton(g, '+ Add model or PDF', BOOTH_W / 2 - 0.45, 1.18, 0.86, 0.17, () => openUploadForBooth(b.n),
        { color: '#2f6fc4', hover: '#4d8fe0', charSize: 0.05 });
      b.plaque.setAttribute('position', `${BOOTH_W / 2 - 0.45} 1.18 ${BOOTH_D - 0.12}`);
      b.plaqueText = '+ Add model or PDF';
    });
    trackHeads.instanceMatrix.needsUpdate = true;
    deco.add(trackHeads);
    L.mergeStatic(deco);
    updateBoothLabels();
  }

  // Tap / click / aim at the floor or a plinth to walk there.
  function onFloorClick(e) {
    if (fromDrag(e)) return;
    if (TOUCH_UI && !scene.is('vr-mode')) return; // phones and tablets move with the sticks
    const hit = e.detail && e.detail.intersection;
    if (hit) $('#rig').components['rig-move'].glideTo(hit.point.x, hit.point.z, hit.point.y);
  }

  function openUploadForBooth(n) {
    if (scene.is('vr-mode')) return vrToast('Take off the headset to upload files (or use a phone or computer).', 3000);
    openUpload({ booth: n });
  }
  // ---------------- shared objects: models & PDFs ----------------
  const PDF_W = 1.6;   // panel width in metres at scale 1
  const PDF_BASE = 0.55; // height of the panel's lower edge

  function itemTitle(it) { return it.name || (it.kind === 'pdf' ? 'Document' : 'Model'); }

  function addItem(it) {
    if (items.has(it.id)) { updateItem(it); return; }
    const root = el('a-entity', { class: 'item' }, $('#items'));
    const inner = el('a-entity', { class: 'item-inner' }, root);
    const rec = { data: { ...it }, root, inner, content: null, size: null, pages: 0, doc: null, textures: new Map(), renderToken: 0 };
    items.set(it.id, rec);
    applyItemTransform(rec);

    if (it.kind === 'model') {
      const content = el('a-entity', { class: 'clickable item-surface' }, inner);
      rec.content = content;
      content.addEventListener('model-loaded', () => onModelLoaded(rec));
      content.addEventListener('model-error', () => toast(`Could not load "${itemTitle(it)}".`, 5000));
      if (it.fmt === 'obj') content.setAttribute('obj-model', { obj: `url(${it.url})` });
      else content.setAttribute('gltf-model', `url(${it.url})`);
      content.addEventListener('click', (e) => onSurfaceClick(e, it.id));
    } else if (it.kind === 'portal') {
      buildPortal(rec);
    } else {
      buildPdfPanel(rec);
    }
    updateBoothLabels();
    refreshPanel('objects');
  }

  // A new file for an existing object: rebuild it in place and keep its sticky notes.
  function replaceItem(it) {
    const cur = items.get(it.id);
    if (cur && cur.data.url === it.url) { updateItem(it); return; } // already showing this file
    const keep = [...notes.values()].filter((n) => n.data.on === it.id).map((n) => n.data);
    const wasMenu = menuItemId === it.id;
    removeItem(it.id);
    addItem(it);
    keep.forEach(addNote);
    if (wasMenu) closeItemMenu();
  }

  function applyItemTransform(rec) {
    const d = rec.data;
    rec.root.object3D.position.fromArray(d.p);
    rec.root.object3D.rotation.set(0, THREE.MathUtils.degToRad(d.ry || 0), 0);
    rec.inner.object3D.scale.setScalar(d.s || 1);
    for (const n of notes.values()) if (n.data.on === d.id) n.el.object3D.scale.setScalar(1 / (d.s || 1));
    if (window.VSNLook) VSNLook.refreshShadows();
  }

  function updateItem(patch) {
    const rec = items.get(patch.id);
    if (!rec) return;
    const pageChanged = patch.page != null && patch.page !== rec.data.page;
    Object.assign(rec.data, patch);
    applyItemTransform(rec);
    if (rec.data.kind === 'pdf' && pageChanged) { showPdfPage(rec); updatePdfNoteVisibility(rec); }
    updateBoothLabels();
    if (adjustId === patch.id) { syncAdjustUI(); refreshSelection(); }
    refreshPanel('objects');
  }

  function removeItem(id) {
    const rec = items.get(id);
    if (!rec) return;
    for (const [nid, n] of [...notes]) if (n.data.on === id) removeNote(nid);
    rec.textures.forEach((t) => t.dispose());
    if (rec.doc) rec.doc.destroy().catch(() => {});
    if (rec.root.parentNode) rec.root.parentNode.removeChild(rec.root);
    items.delete(id);
    if (menuItemId === id) closeItemMenu();
    if (adjustId === id) { if (!$('#adjust').hidden) $('#adjust').hidden = true; closeAdjust(); }
    if (selection && selection.id === id) selectItem(null);
    if (window.VSNLook) VSNLook.refreshShadows();
    updateBoothLabels();
    refreshPanel('objects');
  }

  function castShadow(e, receive) {
    if (!window.VSNLook) return;
    const apply = () => { const m = e.getObject3D('mesh'); if (!m) return false; VSNLook.shadows(m, true, !!receive); return true; };
    if (!apply()) e.addEventListener('object3dset', apply);
  }

  function refreshRaycasters() {
    document.querySelectorAll('[raycaster]').forEach((r) => {
      const c = r.components && r.components.raycaster;
      if (c) try { c.refreshObjects(); } catch (e) { /* not ready */ }
    });
    const sc = scene.components && scene.components.raycaster;
    if (sc) try { sc.refreshObjects(); } catch (e) { /* not ready */ }
  }

  // Re-centre a model so its footprint centre sits on the item origin and its base on the floor.
  // Exported Revit models often sit far from the origin, at survey coordinates.
  function onModelLoaded(rec) {
    const mesh = rec.content.getObject3D('mesh');
    if (!mesh) return;
    mesh.position.set(0, 0, 0);
    rec.root.object3D.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const inv = new THREE.Matrix4().copy(rec.content.object3D.matrixWorld).invert();
    mesh.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      box.union(b);
    });
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    mesh.position.set(-c.x, -box.min.y, -c.z);
    rec.size = box.getSize(new THREE.Vector3());
    rec.content.object3D.updateMatrixWorld(true);
    if (window.VSNLook) VSNLook.shadows(mesh, true, true);
    refreshRaycasters();
    refreshSelection();
    if (adjustId === rec.data.id) syncAdjustUI();

    if (justUploaded.has(rec.data.id)) {
      justUploaded.delete(rec.data.id);
      const maxDim = Math.max(rec.size.x, rec.size.y, rec.size.z);
      const fit = exhibitOf(rec.data) ? fitPatchFor(rec) : null;
      if (fit && Math.abs(fit - 1) > 0.02) {
        itemPatch(rec.data.id, { s: fit });
        toast(fit < 1 ? 'Model scaled to fit its booth. Click it and choose Adjust for real size (1:1).' : `"${itemTitle(rec.data)}" is ready.`, 6000);
      } else if (!exhibitOf(rec.data) && (maxDim > 18 || maxDim < 0.3)) {
        send({ type: 'item-update', id: rec.data.id, s: +(6 / maxDim).toPrecision(4) });
        toast(maxDim > 18 ? 'Large model: scaled down to fit the room. Use "1:1" in Objects for real size.' : 'Small model: scaled up to be visible. Use "1:1" in Objects for real size.', 6000);
      } else toast(`"${itemTitle(rec.data)}" is ready.`);
    }
    refreshPanel('objects');
  }

  function buildPdfPanel(rec) {
    const it = rec.data;
    const h = PDF_W * 1.294; // A4/Letter portrait until the real page size is known
    const panel = el('a-plane', { class: 'clickable item-surface pdf-page', width: PDF_W, height: h, position: `0 ${PDF_BASE + h / 2} 0` }, rec.inner);
    panel.setAttribute('material', { shader: 'flat', color: '#ffffff', side: 'double' });
    rec.content = panel;
    if (window.VSNLook) VSNLook.untoned(panel);
    panel.addEventListener('click', (e) => onSurfaceClick(e, it.id));
    const back = el('a-box', { class: 'pdf-back', width: PDF_W + 0.06, height: h + 0.06, depth: 0.03, position: `0 ${PDF_BASE + h / 2} -0.02` }, rec.inner);
    back.setAttribute('material', { color: '#262b33', roughness: 0.45, metalness: 0.1 });
    castShadow(back);
    const stand = el('a-box', { class: 'pdf-stand', width: 0.05, height: PDF_BASE, depth: 0.05, position: `0 ${PDF_BASE / 2} -0.05` }, rec.inner);
    stand.setAttribute('material', { color: '#9aa2ab', roughness: 0.3, metalness: 0.85 });
    castShadow(stand);
    const foot = el('a-cylinder', { radius: 0.28, height: 0.02, position: '0 0.01 -0.05', 'segments-radial': 40 }, rec.inner);
    foot.setAttribute('material', { color: '#262b33', roughness: 0.4, metalness: 0.2 });
    castShadow(foot);
    const title = el('a-entity', { class: 'pdf-title', position: `0 ${PDF_BASE + h + 0.08} 0` }, rec.inner);
    title.setAttribute('text', { value: font3d(itemTitle(it)), align: 'center', color: '#1b1f27', width: 1.6, wrapCount: 36 });
    // page controls (work with mouse, touch, laser and gaze)
    const ctl = el('a-entity', { class: 'pdf-controls', position: `0 ${PDF_BASE - 0.09} 0.02` }, rec.inner);
    rec.ctl = ctl;
    vrButton(ctl, '< Prev', -0.5, 0, 0.36, 0.11, () => turnPage(it.id, -1), { charSize: 0.045 });
    rec.pageLabel = el('a-entity', { position: '0 0 0.004' }, ctl);
    rec.pageLabel.setAttribute('text', { value: 'Loading...', align: 'center', color: '#1b1f27', width: 0.9, wrapCount: 14 });
    vrButton(ctl, 'Next >', 0.5, 0, 0.36, 0.11, () => turnPage(it.id, 1), { charSize: 0.045 });
    loadPdf(rec);
  }

  // ---------------- room shortcuts (portals) ----------------
  function buildPortal(rec) {
    const it = rec.data;
    const frame = (w, h, d, x, y) => {
      const b = el('a-box', { width: w, height: h, depth: d, position: `${x} ${y} 0` }, rec.inner);
      b.setAttribute('material', { color: '#262b33', roughness: 0.45, metalness: 0.1 });
      castShadow(b);
    };
    frame(0.12, 2.36, 0.14, -0.66, 1.18);
    frame(0.12, 2.36, 0.14, 0.66, 1.18);
    frame(1.44, 0.14, 0.14, 0, 2.35);
    const door = el('a-plane', { class: 'clickable item-surface portal-surface', width: 1.2, height: 2.24, position: '0 1.12 0' }, rec.inner);
    door.setAttribute('material', { shader: 'flat', color: '#4d8fe0', opacity: 0.78, transparent: true, side: 'double' });
    door.setAttribute('animation__glow', { property: 'material.opacity', from: 0.62, to: 0.9, dur: 1400, dir: 'alternate', loop: true, easing: 'easeInOutSine' });
    door.addEventListener('mouseenter', () => door.setAttribute('material', 'color', '#86b4ef'));
    door.addEventListener('mouseleave', () => door.setAttribute('material', 'color', '#4d8fe0'));
    door.addEventListener('click', (e) => { e.stopPropagation(); if (!fromDrag(e)) enterPortal(it.id); });
    rec.content = door;
    const sign = el('a-entity', { position: '0 2.62 0' }, rec.inner);
    sign.setAttribute('geometry', { primitive: 'plane', width: 1.6, height: 0.3 });
    sign.setAttribute('material', { color: '#1b1f27', shader: 'flat', side: 'double' });
    rec.portalLabel = el('a-entity', { position: '0 0 0.005' }, sign);
    rec.portalLabel.setAttribute('text', { value: font3d(it.name).slice(0, 40), align: 'center', color: '#ffffff', width: 1.5, wrapCount: 22 });
    const hint = el('a-entity', { position: '0 1.12 0.01' }, rec.inner);
    hint.setAttribute('text', { value: 'Enter room', align: 'center', color: '#ffffff', width: 1.2, wrapCount: 14 });
    rec.size = new THREE.Vector3(1.44, 2.77, 0.14);
  }

  async function enterPortal(id) {
    const rec = items.get(id);
    if (!rec || !joined) return;
    const target = rec.data.target;
    try {
      const r = await fetch(`/api/rooms/${encodeURIComponent(target)}`, { cache: 'no-store' });
      if (!r.ok) return toast('That room no longer exists.', 3500);
      const info = (await r.json()).room;
      toast(`Going to "${info.name}"...`, 1800);
      switchRoom(info.slug, info.name);
    } catch (e) { toast('Could not reach that room. Check your connection.', 3500); }
  }

  // Leave this room and join another without reloading the page, so VR stays on.
  function switchRoom(slug, name) {
    ['#composer', '#detail', '#panel', '#upload'].forEach((s) => { if (!$(s).hidden) closeSheet(s); });
    closeVrKeyboard(); closeVrPanel(); hideGhost();
    const old = ws;
    ws = null;
    if (old) { old.onclose = null; old.onmessage = null; try { old.close(); } catch (e) { /* ignore */ } }
    for (const id of [...peers.keys()]) removePeer(id);
    for (const id of [...notes.keys()]) removeNote(id);
    for (const id of [...items.keys()]) removeItem(id);
    sendSpeaking(false);
    speaking = false;
    me.id = null;
    ROOM = slug;
    roomInfo = { slug, name: name || slug, desc: '', mine: false };
    $('#roomLabel').textContent = roomInfo.name;
    updatePeopleCount();
    const u = new URL(location.href); u.searchParams.set('room', slug); history.replaceState(null, '', u);
    placeAtSpawn();
    reconnectDelay = 1000;
    connect();
  }

  function showShortcut() {
    openPanel('shortcut', 'Add a room shortcut', (body) => {
      el('p', { class: 'fine' }, body).textContent = 'Creates a doorway in front of you. Anyone can walk through it to the other room, even in VR. A doorway back is added in the new room.';
      const form = el('form', { class: 'create' }, body);
      const name = el('input', { maxlength: '40', placeholder: 'New room name, e.g. Level 2 MEP review', required: '' }, form);
      const desc = el('input', { maxlength: '140', placeholder: 'Short description (optional)' }, form);
      const lab = el('label', { class: 'check' }, form);
      const unl = el('input', { type: 'checkbox' }, lab);
      lab.appendChild(document.createTextNode(' Unlisted (only reachable by link or doorway)'));
      const go = el('button', { type: 'submit', class: 'btn primary' }, form);
      go.textContent = 'Create room and doorway';
      const msg = el('p', { class: 'fine' }, body);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        go.disabled = true;
        try {
          const r = await fetch('/api/rooms', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.value, desc: desc.value, unlisted: unl.checked, key: KEY, returnTo: ROOM, author: me.name })
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || 'Could not create the room.');
          placePortal(data.room.slug);
          closeSheet('#panel');
          toast(`Room "${data.room.name}" created. Its doorway is in front of you.`, 4000);
        } catch (err) { msg.textContent = err.message; go.disabled = false; }
      });

      el('h4', {}, body).textContent = 'Or link a room that already exists';
      const list = el('div', { class: 'room-list' }, body);
      el('p', { class: 'fine' }, list).textContent = 'Loading rooms...';
      fetch('/api/rooms', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
        list.innerHTML = '';
        const rooms = (d.rooms || []).filter((r) => r.slug !== ROOM);
        if (!rooms.length) { el('p', { class: 'fine' }, list).textContent = 'No other rooms yet.'; return; }
        for (const r of rooms) {
          const b = el('button', { type: 'button', class: 'room-row' }, list);
          el('b', {}, b).textContent = r.name;
          el('span', { class: 'meta' }, b).textContent = `Add a doorway to this room · ${roomMeta(r)}`;
          b.onclick = () => { placePortal(r.slug); closeSheet('#panel'); toast(`Doorway to "${r.name}" placed in front of you.`); };
        }
      }).catch(() => { list.innerHTML = ''; el('p', { class: 'fine' }, list).textContent = 'Could not load rooms.'; });
    });
  }

  function placePortal(target) {
    const f = viewerFrame(2.6);
    send({ type: 'portal-add', target, p: f.p, ry: f.ry });
  }

  function layoutPdf(rec, aspect) {
    const h = PDF_W * aspect;
    const y = PDF_BASE + h / 2;
    rec.content.setAttribute('height', h);
    rec.content.setAttribute('position', `0 ${y} 0`);
    const back = rec.inner.querySelector('.pdf-back');
    back.setAttribute('height', h + 0.06);
    back.setAttribute('position', `0 ${y} -0.02`);
    rec.inner.querySelector('.pdf-title').setAttribute('position', `0 ${PDF_BASE + h + 0.08} 0`);
    rec.size = new THREE.Vector3(PDF_W, PDF_BASE + h, 0.1);
    if (window.VSNLook) VSNLook.refreshShadows();
  }

  let pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('/vendor/pdfjs/legacy/build/pdf.min.mjs').then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/legacy/build/pdf.worker.min.mjs';
        return lib;
      });
    }
    return pdfjsPromise;
  }

  async function loadPdf(rec) {
    try {
      const lib = await loadPdfjs();
      rec.doc = await lib.getDocument({ url: rec.data.url, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
      rec.pages = rec.doc.numPages;
      await showPdfPage(rec);
      updatePdfNoteVisibility(rec);
      if (justUploaded.has(rec.data.id)) {
        justUploaded.delete(rec.data.id);
        // In a booth: make the document as big as the booth allows, staying below the booth sign.
        const where = exhibitOf(rec.data);
        const tex = rec.textures.get(rec.data.page || 1);
        if (where && where.booth && tex) {
          const s = +Math.min(1.15, 2.85 / (PDF_BASE + PDF_W * tex.userData.aspect)).toFixed(3);
          if (Math.abs(s - (rec.data.s || 1)) > 0.01) itemPatch(rec.data.id, { s });
        }
        toast(`"${itemTitle(rec.data)}" is ready (${rec.pages} page${rec.pages > 1 ? 's' : ''}).`);
      }
      refreshPanel('objects');
    } catch (e) {
      console.warn('pdf error', e);
      rec.pageLabel && rec.pageLabel.setAttribute('text', { value: 'Could not open PDF' });
    }
  }

  async function showPdfPage(rec) {
    if (!rec.doc) return;
    const pg = clamp(rec.data.page || 1, 1, rec.pages);
    const token = ++rec.renderToken;
    rec.pageLabel.setAttribute('text', { value: `${pg} / ${rec.pages}` });
    let tex = rec.textures.get(pg);
    let aspect;
    if (!tex) {
      const page = await rec.doc.getPage(pg);
      const vp1 = page.getViewport({ scale: 1 });
      const maxPx = DEVICE === 'desktop' ? 2048 : 1600;
      const scale = Math.min(maxPx / vp1.width, maxPx / vp1.height);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.userData.aspect = canvas.height / canvas.width;
      rec.textures.set(pg, tex);
      if (rec.textures.size > 6) { // keep memory low on phones and headsets
        const oldest = rec.textures.keys().next().value;
        if (oldest !== pg) { rec.textures.get(oldest).dispose(); rec.textures.delete(oldest); }
      }
    }
    if (token !== rec.renderToken) return;
    aspect = tex.userData.aspect;
    layoutPdf(rec, aspect);
    const mesh = rec.content.getObject3D('mesh');
    if (!mesh) { rec.content.addEventListener('loaded', () => showPdfPage(rec), { once: true }); return; }
    {
      mesh.material.map = tex;
      mesh.material.color.set('#ffffff');
      mesh.material.needsUpdate = true;
    }
  }

  function turnPage(id, delta) {
    const rec = items.get(id);
    if (!rec || !rec.pages) return;
    const pg = clamp((rec.data.page || 1) + delta, 1, rec.pages);
    if (pg === rec.data.page) return;
    updateItem({ id, page: pg }); // show right away, server confirms to everyone
    send({ type: 'item-update', id, page: pg });
  }

  function updatePdfNoteVisibility(rec) {
    for (const n of notes.values()) {
      if (n.data.on === rec.data.id) n.el.setAttribute('visible', !n.data.pg || n.data.pg === rec.data.page);
    }
  }

  // Item manipulation helpers (Objects panel)
  function viewerFrame(dist) {
    const cam = scene.camera;
    const pos = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const p = pos.clone().addScaledVector(dir, dist);
    // rotate so the item's front (+Z) faces the viewer
    const ry = THREE.MathUtils.radToDeg(Math.atan2(-dir.x, -dir.z));
    return { p: [+p.x.toFixed(3), 0, +p.z.toFixed(3)], ry: +ry.toFixed(1), cam: pos, dir };
  }
  function itemPatch(id, patch) {
    updateItem({ id, ...patch });
    send({ type: 'item-update', id, ...patch });
  }
  function bringHere(id) {
    const rec = items.get(id);
    if (!rec) return;
    const r = rec.size ? Math.max(rec.size.x, rec.size.z) * (rec.data.s || 1) : 2;
    const f = viewerFrame(Math.max(2.2, r / 2 + 1.5));
    itemPatch(id, { p: f.p, ry: f.ry });
  }
  function goTo(id) {
    const rec = items.get(id);
    if (!rec) return;
    const d = rec.data;
    const r = rec.size ? Math.max(rec.size.x, rec.size.z) * (d.s || 1) : 2;
    const ang = THREE.MathUtils.degToRad(d.ry || 0);
    const dist = Math.max(2.2, r / 2 + 1.5);
    const mover = $('#rig').components['rig-move'];
    // turn to face the object, then walk to a spot in front of it
    const f = scene.camera.getWorldDirection(new THREE.Vector3());
    const delta = THREE.MathUtils.radToDeg(Math.atan2(-Math.sin(ang), -Math.cos(ang)) - Math.atan2(f.x, f.z));
    mover.snapTurn(((delta % 360) + 540) % 360 - 180);
    mover.glideTo(d.p[0] + Math.sin(ang) * dist, d.p[2] + Math.cos(ang) * dist);
  }
  function deleteItem(id) {
    const rec = items.get(id);
    if (!rec) return;
    if (confirm(`Delete "${itemTitle(rec.data)}" and its sticky notes for everyone?`)) send({ type: 'item-delete', id });
  }

  // ---------------- uploads ----------------
  let uploadFile = null;
  let uploadXhr = null;
  // Upload into a booth slot (1 model + 2 PDFs per booth), or replace an existing object.
  let uploadMode = null; // { booth } or { replace: id }
  let boothPicked = false; // true once the viewer chose a booth (or came from a booth's sign)
  function boothSummary(n) {
    const c = boothContents(n);
    const pdfs = (c.pdf1 ? 1 : 0) + (c.pdf2 ? 1 : 0);
    return `Booth ${n}: ${c.model ? 'model added' : 'no model'}, ${pdfs} of 2 PDFs`;
  }
  function fillBoothSelect(selected) {
    const sel = $('#uploadBooth');
    sel.innerHTML = '';
    for (const b of BOOTHS) {
      const o = el('option', { value: String(b.n) }, sel);
      o.textContent = boothSummary(b.n);
      const c = boothContents(b.n);
      if (c.model && c.pdf1 && c.pdf2) o.textContent += ' (full)';
    }
    sel.value = String(selected);
  }
  function uploadKind(f) { return f && f.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'model'; }
  function updateUploadHint() {
    const msg = $('#uploadMsg');
    if (uploadMode && uploadMode.replace) return;
    const n = Number($('#uploadBooth').value);
    if (!uploadFile) { msg.textContent = `Each booth holds 1 model and 2 PDFs. Max ${config.maxModelMB} MB for models, ${config.maxPdfMB} MB for PDFs.`; return; }
    const kind = uploadKind(uploadFile);
    const slot = freeSlot(n, kind);
    if (!slot) {
      msg.textContent = kind === 'pdf' ? `Booth ${n} already has two PDFs. Pick another booth, or replace one of them from its menu.` : `Booth ${n} already has a model. Pick another booth, or replace it from its menu.`;
      $('#uploadGo').disabled = true;
      return;
    }
    msg.textContent = `Goes into booth ${n} as ${SLOT[slot].label}.` + (uploadFile.size > 30 * 1048576 && kind === 'model' ? ' Large model: it may load slowly on phones and headsets.' : '');
    $('#uploadGo').disabled = false;
  }
  function openUpload(opts) {
    opts = opts || {};
    uploadFile = null;
    $('#uploadForm').reset();
    $('#dropZone').classList.remove('has-file');
    $('#uploadProgress').hidden = true;
    $('#uploadGo').disabled = true;
    const replacing = opts.replace && items.get(opts.replace);
    uploadMode = replacing ? { replace: opts.replace } : { booth: opts.booth };
    boothPicked = !!opts.booth;
    $('#boothField').hidden = !!replacing;
    if (replacing) {
      const d = replacing.data;
      $('#uploadTitle').textContent = `Replace "${itemTitle(d)}"`;
      $('#uploadGo').textContent = 'Replace';
      $('#fileInput').setAttribute('accept', d.kind === 'pdf' ? '.pdf,application/pdf' : '.glb,.gltf,.obj,model/gltf-binary');
      $('#dropLabel').innerHTML = '';
      el('b', {}, $('#dropLabel')).textContent = d.kind === 'pdf' ? 'Choose the new PDF' : 'Choose the new model';
      el('br', {}, $('#dropLabel'));
      el('span', { class: 'fine' }, $('#dropLabel')).textContent = d.kind === 'pdf' ? '.pdf' : '.glb, .gltf or .obj';
      $('#uploadMsg').textContent = 'It keeps its place in the booth and its sticky notes.';
    } else {
      $('#uploadTitle').textContent = 'Add a model or PDF';
      $('#uploadGo').textContent = 'Upload to booth';
      $('#fileInput').setAttribute('accept', '.glb,.gltf,.obj,.pdf,model/gltf-binary,application/pdf');
      $('#dropLabel').innerHTML = '<b>Choose a file</b><br><span class="fine">.glb, .gltf or .obj models, or a .pdf</span>';
      const start = opts.booth || (nearestBooth((b) => freeSlot(b.n, 'model') || freeSlot(b.n, 'pdf')) || BOOTHS[0]).n;
      fillBoothSelect(start);
      updateUploadHint();
    }
    openSheet('#upload');
  }
  $('#uploadBooth').addEventListener('change', () => { boothPicked = true; updateUploadHint(); });
  // If the viewer didn't pick a booth, move to the nearest one with room for this kind of file.
  function autoPickBooth() {
    if (boothPicked || !uploadFile || (uploadMode && uploadMode.replace)) return;
    const kind = uploadKind(uploadFile);
    if (freeSlot(Number($('#uploadBooth').value), kind)) return;
    const b = nearestBooth((bb) => freeSlot(bb.n, kind));
    if (b) $('#uploadBooth').value = String(b.n);
  }
  $('#fileInput').addEventListener('change', () => {
    const f = $('#fileInput').files[0];
    uploadFile = null;
    $('#uploadGo').disabled = true;
    if (!f) return;
    const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const isPdf = ext === '.pdf';
    if (!['.glb', '.gltf', '.obj', '.pdf'].includes(ext)) {
      $('#uploadMsg').textContent = ext === '.fbx' || ext === '.rvt' || ext === '.ifc'
        ? `${ext.toUpperCase()} files can't be shown directly. Convert to .glb first (see the tips below).`
        : 'Please choose a .glb, .gltf, .obj or .pdf file.';
      return;
    }
    const rep = uploadMode && uploadMode.replace ? items.get(uploadMode.replace) : null;
    if (rep && (rep.data.kind === 'pdf') !== isPdf) { $('#uploadMsg').textContent = rep.data.kind === 'pdf' ? 'Replace a PDF with another PDF.' : 'Replace a model with another model (.glb, .gltf or .obj).'; return; }
    const limit = (isPdf ? config.maxPdfMB : config.maxModelMB) * 1048576;
    if (f.size > limit) { $('#uploadMsg').textContent = `This file is ${fmtMB(f.size)}. The limit is ${fmtMB(limit)}.`; return; }
    uploadFile = f;
    $('#dropZone').classList.add('has-file');
    $('#dropLabel').innerHTML = '';
    const b = el('b', {}, $('#dropLabel')); b.textContent = f.name;
    el('br', {}, $('#dropLabel'));
    el('span', { class: 'fine' }, $('#dropLabel')).textContent = `${isPdf ? 'PDF document' : '3D model'} · ${fmtMB(f.size)} · tap to change`;
    if (rep) { $('#uploadMsg').textContent = 'It keeps its place in the booth and its sticky notes.'; $('#uploadGo').disabled = false; }
    else { autoPickBooth(); updateUploadHint(); }
  });
  $('#uploadForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!uploadFile || uploadXhr) return;
    const kind = uploadKind(uploadFile);
    const q = new URLSearchParams({ name: uploadFile.name });
    if (uploadMode && uploadMode.replace) {
      q.set('replace', uploadMode.replace);
    } else {
      const n = Number($('#uploadBooth').value);
      const slot = freeSlot(n, kind);
      if (!slot) return updateUploadHint();
      const sp = slotPlacement(n, slot);
      q.set('booth', String(n)); q.set('slot', slot);
      q.set('p', sp.p.join(',')); q.set('ry', String(sp.ry));
      if (sp.s) q.set('s', String(sp.s));
    }
    const xhr = new XMLHttpRequest();
    uploadXhr = xhr;
    xhr.open('POST', `/api/rooms/${encodeURIComponent(ROOM)}/upload?${q}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Client-Key', KEY);
    xhr.setRequestHeader('X-Client-Name', encodeURIComponent(me.name));
    if (ADMIN) xhr.setRequestHeader('X-Admin-Key', ADMIN);
    $('#uploadProgress').hidden = false;
    $('#uploadGo').disabled = true;
    const bar = $('#uploadProgress div');
    bar.style.width = '0%';
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) { bar.style.width = `${Math.round(ev.loaded / ev.total * 100)}%`; $('#uploadMsg').textContent = `Uploading... ${Math.round(ev.loaded / ev.total * 100)}%`; } };
    xhr.onload = () => {
      uploadXhr = null;
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (err) { /* ignore */ }
      if ((xhr.status === 201 || xhr.status === 200) && data.item) {
        justUploaded.add(data.item.id);
        if (xhr.status === 200) replaceItem(data.item); else addItem(data.item);
        closeSheet('#upload');
        const where = exhibitOf(data.item);
        toast(xhr.status === 200 ? `Replaced. Loading "${data.item.name}"...` : where ? `Uploaded. "${data.item.name}" is going into booth ${where.booth.n}...` : `Uploaded. Loading "${data.item.name}"...`);
      } else {
        $('#uploadMsg').textContent = data.error || `Upload failed (${xhr.status}).`;
        $('#uploadGo').disabled = false;
      }
    };
    xhr.onerror = () => { uploadXhr = null; $('#uploadMsg').textContent = 'Upload failed. Check your connection and try again.'; $('#uploadGo').disabled = false; };
    xhr.send(uploadFile);
  });

  // ---------------- sticky notes ----------------
  const NOTE_W = 0.3;
  const WRAP = 20;
  const LINE_H = 0.0285;
  const MAX_LINES = 9;

  function noteLayout(text) {
    let lines = wrapLines(font3d(text), WRAP);
    if (lines.length > MAX_LINES) { lines = lines.slice(0, MAX_LINES); lines[MAX_LINES - 1] = lines[MAX_LINES - 1].slice(0, WRAP - 3) + '...'; }
    const h = Math.max(NOTE_W, 0.075 + lines.length * LINE_H + 0.04);
    return { value: lines.join('\n'), h };
  }

  function addNote(n) {
    if (notes.has(n.id)) { updateNote(n); return; }
    const item = n.on ? items.get(n.on) : null;
    if (n.on && !item) return; // its object was removed
    const root = el('a-entity', { class: 'note' }, item ? item.inner : $('#notes'));
    root.object3D.position.fromArray(n.p);
    root.object3D.quaternion.fromArray(n.q);
    if (item) root.object3D.scale.setScalar(1 / (item.data.s || 1));
    const tilt = el('a-entity', { rotation: `0 0 ${((parseInt(n.id.slice(0, 2), 16) / 255) - 0.5) * 6}` }, root);
    const paper = el('a-box', { class: 'clickable note-paper', depth: 0.006, width: NOTE_W }, tilt);
    paper.setAttribute('material', { roughness: 1, color: n.color });
    const body = el('a-entity', { class: 'note-text' }, tilt);
    body.setAttribute('text', { value: '', color: '#1d1d1f', width: NOTE_W - 0.04, wrapCount: WRAP + 2, align: 'left', anchor: 'center', baseline: 'top' });
    const meta = el('a-entity', { class: 'note-meta' }, tilt);
    meta.setAttribute('text', { value: '', color: '#4b4b4b', width: NOTE_W - 0.04, wrapCount: 34, align: 'left', anchor: 'center', baseline: 'bottom' });
    const pin = el('a-sphere', { class: 'note-pin', radius: 0.011 }, tilt);
    pin.setAttribute('material', { color: '#c0392b', roughness: 0.4 });
    paper.addEventListener('click', (e) => { e.stopPropagation(); if (!fromDrag(e)) openNote(n.id); });
    notes.set(n.id, { data: n, el: root });
    renderNote(n.id);
    if (item && item.data.kind === 'pdf') root.setAttribute('visible', !n.pg || n.pg === item.data.page);
    root.setAttribute('animation__in', { property: 'scale', from: '0.2 0.2 0.2', to: root.object3D.scale.toArray().join(' '), dur: 260, easing: 'easeOutBack' });
    refreshPanel('people');
  }

  function renderNote(id) {
    const rec = notes.get(id);
    const n = rec.data;
    const { value, h } = noteLayout(n.text);
    const paper = rec.el.querySelector('.note-paper');
    paper.setAttribute('height', h);
    paper.setAttribute('material', 'color', n.color);
    const pad = 0.02;
    rec.el.querySelector('.note-text').setAttribute('text', { value });
    rec.el.querySelector('.note-text').setAttribute('position', `0 ${h / 2 - pad - 0.012} 0.0045`);
    rec.el.querySelector('.note-meta').setAttribute('text', { value: font3d(`${n.author}${n.votes ? `   +${n.votes}` : ''}`) });
    rec.el.querySelector('.note-meta').setAttribute('position', `0 ${-h / 2 + pad * 0.8} 0.0045`);
    rec.el.querySelector('.note-pin').setAttribute('position', `0 ${h / 2 - 0.016} 0.006`);
  }

  function updateNote(n) {
    const rec = notes.get(n.id);
    if (!rec) return addNote(n);
    rec.data = n;
    renderNote(n.id);
    if (openNoteId === n.id) { if (!$('#detail').hidden) fillDetail(n); if (vrPanel) openNote(n.id); }
  }

  function removeNote(id) {
    const rec = notes.get(id);
    if (!rec) return;
    if (rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
    notes.delete(id);
    if (openNoteId === id) { closeSheet('#detail'); closeVrPanel(); openNoteId = null; }
  }

  // Ray hit -> note position & orientation flush with the surface (world space).
  const _n = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const ORIGIN = new THREE.Vector3();
  function placementFromHit(hit) {
    if (!hit || !hit.face) return null;
    _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
    const cam = scene.camera;
    if (cam) {
      const toCam = cam.getWorldPosition(new THREE.Vector3()).sub(hit.point);
      if (toCam.dot(_n) < 0) _n.negate();
    }
    const up = Math.abs(_n.y) > 0.98 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    _m.lookAt(_n, ORIGIN, up);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m);
    const p = hit.point.clone().addScaledVector(_n, 0.012);
    return { p, q };
  }
  const arr = (v, d) => v.toArray().map((x) => +x.toFixed(d));

  // Convert a world placement into the local frame of an object, so notes move with it.
  function toItemLocal(itemId, place) {
    const rec = items.get(itemId);
    const inner = rec.inner.object3D;
    inner.updateMatrixWorld(true);
    const lp = inner.worldToLocal(place.p.clone());
    const wq = inner.getWorldQuaternion(new THREE.Quaternion());
    const lq = wq.invert().multiply(place.q);
    return { p: arr(lp, 4), q: arr(lq, 4) };
  }

  let ghost = null;
  function showGhost(place, color) {
    hideGhost();
    ghost = el('a-box', { width: NOTE_W, height: NOTE_W, depth: 0.004 }, $('#notes'));
    ghost.setAttribute('material', { color, opacity: 0.55, transparent: true });
    ghost.object3D.position.copy(place.p);
    ghost.object3D.quaternion.copy(place.q);
  }
  function hideGhost() { if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost); ghost = null; }

  function onSurfaceClick(e, itemId) {
    if (e.stopPropagation) e.stopPropagation();
    if (fromDrag(e) || !joined) return;
    const hit = e.detail && e.detail.intersection;
    const place = placementFromHit(hit);
    if (!place) return;
    if (itemId && items.has(itemId)) return openItemMenu(itemId, place);
    startNoteAt(place, itemId);
  }

  // ---------------- object menu & adjust ----------------
  let menuItemId = null;
  let menuPlace = null;
  let adjustId = null;
  let selection = null; // outline around the object being worked on
  const canManage = (d) => !!(d && (d.mine || me.isAdmin || roomInfo.mine));

  function selectItem(id) {
    if (selection) { scene.object3D.remove(selection.helper); selection = null; }
    const rec = id && items.get(id);
    if (!rec) return;
    const helper = new THREE.BoxHelper(rec.inner.object3D, 0x2f6fc4);
    helper.material.depthTest = false; helper.material.transparent = true; helper.material.opacity = 0.9; helper.material.toneMapped = false;
    helper.renderOrder = 5;
    scene.object3D.add(helper);
    selection = { id, helper };
  }
  function refreshSelection() { if (selection) { const rec = items.get(selection.id); if (rec) selection.helper.setFromObject(rec.inner.object3D); else selectItem(null); } }

  function describeItem(d) {
    const kind = d.kind === 'pdf' ? 'PDF' : '3D model';
    const where = d.booth ? `Booth ${d.booth}` : 'In the hall';
    return `${kind} · ${where} · added by ${d.author}`;
  }

  function openItemMenu(id, place) {
    const rec = items.get(id);
    if (!rec) return;
    ['#adjust', '#detail', '#composer'].forEach((sel) => { if (!$(sel).hidden) closeSheet(sel); });
    menuItemId = id; menuPlace = place;
    selectItem(id);
    showGhost(place, lastNoteColor);
    if (scene.is('vr-mode')) return openVrItemMenu(id);
    const d = rec.data;
    $('#menuTitle').textContent = itemTitle(d);
    $('#menuMeta').textContent = describeItem(d);
    const manage = canManage(d);
    $('#menuReplaceLbl').textContent = d.kind === 'pdf' ? 'Replace with a new PDF' : 'Replace with a new model';
    $('#menuRemoveLbl').textContent = d.kind === 'pdf' ? 'Remove PDF' : 'Remove model';
    $('#menuReplace').disabled = !manage;
    $('#menuRemove').disabled = !manage;
    $('#menuHint').textContent = manage ? '' : 'Only the person who uploaded it, the room creator, or the admin can replace or remove it.';
    openSheet('#itemMenu');
  }
  function closeItemMenu(keepGhost) {
    if (!$('#itemMenu').hidden) { $('#itemMenu').hidden = true; syncSheetState(); }
    closeVrPanel();
    if (!keepGhost) hideGhost();
    if (!adjustId) selectItem(null);
    menuItemId = null;
  }
  $('#menuNote').addEventListener('click', () => {
    const id = menuItemId, place = menuPlace;
    closeItemMenu(true);
    if (id && place) startNoteAt(place, id);
  });
  $('#menuAdjust').addEventListener('click', () => { const id = menuItemId; closeItemMenu(); openAdjust(id); });
  $('#menuReplace').addEventListener('click', () => { const id = menuItemId; closeItemMenu(); openUpload({ replace: id }); });
  $('#menuRemove').addEventListener('click', () => { const id = menuItemId; closeItemMenu(); deleteItem(id); });

  // Adjust: everything goes through itemPatch (applied here at once, sent to everyone throttled)
  let adjustTimer = null; let adjustPending = null;
  function adjustPatch(id, patch, immediate) {
    updateItem({ id, ...patch });
    refreshSelection();
    adjustPending = Object.assign(adjustPending || { id }, patch);
    if (immediate) { clearTimeout(adjustTimer); adjustTimer = null; flushAdjust(); return; }
    if (!adjustTimer) adjustTimer = setTimeout(() => { adjustTimer = null; flushAdjust(); }, 90);
  }
  function flushAdjust() { if (adjustPending) { send({ type: 'item-update', ...adjustPending }); adjustPending = null; } }

  const SCALE_RANGE = { model: [-2.7, 0.7], pdf: [-0.5, 0.5] }; // log10 of the scale
  function scaleText(rec) {
    const d = rec.data, s = d.s || 1;
    if (d.kind === 'pdf') return `${Math.round(s * 100)}%`;
    const ratio = Math.abs(s - 1) < 1e-3 ? 'Real size' : s < 1 ? `1:${+(1 / s).toPrecision(3)}` : `${+s.toPrecision(3)}x`;
    return rec.size ? `${ratio} · ${(rec.size.x * s).toFixed(1)} x ${(rec.size.z * s).toFixed(1)} x ${(rec.size.y * s).toFixed(1)} m` : ratio;
  }
  function syncAdjustUI() {
    const rec = adjustId && items.get(adjustId);
    if (!rec || $('#adjust').hidden) return;
    const d = rec.data;
    const r = SCALE_RANGE[d.kind] || SCALE_RANGE.model;
    const sl = $('#adjScale');
    sl.min = r[0]; sl.max = r[1];
    if (document.activeElement !== sl) sl.value = Math.log10(d.s || 1);
    $('#adjScaleVal').textContent = scaleText(rec);
    if (document.activeElement !== $('#adjRot')) $('#adjRot').value = Math.round(d.ry || 0) % 360;
    $('#adjRotVal').textContent = `${Math.round(d.ry || 0) % 360}°`;
    $('#adjScaleChips').hidden = d.kind !== 'model';
    $('#adjReset').hidden = !d.booth;
  }
  // On phones the panel covers the lower half of the screen: turn the view so the object
  // sits in the upper half, where it stays visible while you adjust it.
  function frameAboveSheet(id) {
    const rec = items.get(id);
    if (!rec || window.innerWidth >= 640 || scene.is('vr-mode')) return;
    const box = new THREE.Box3().setFromObject(rec.inner.object3D);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const cam = scene.camera.getWorldPosition(new THREE.Vector3());
    const d = c.sub(cam);
    const lc = $('#cam').components['look-controls'];
    if (!lc) return;
    const fov = THREE.MathUtils.degToRad(scene.camera.fov || 80);
    lc.yawObject.rotation.y = Math.atan2(-d.x, -d.z) - $('#rig').object3D.rotation.y;
    lc.pitchObject.rotation.x = Math.atan2(d.y, Math.hypot(d.x, d.z)) - fov * 0.24;
  }
  function openAdjust(id) {
    const rec = items.get(id);
    if (!rec) return;
    adjustId = id;
    selectItem(id);
    if (scene.is('vr-mode')) return openVrAdjust(id);
    $('#adjustTitle').textContent = `Adjust "${itemTitle(rec.data)}"`;
    openSheet('#adjust');
    syncAdjustUI();
    frameAboveSheet(id);
  }
  function closeAdjust() {
    flushAdjust();
    adjustId = null;
    selectItem(null);
    closeVrPanel();
  }
  function moveRelative(id, dir, step) {
    const rec = items.get(id);
    if (!rec) return;
    const f = scene.camera.getWorldDirection(new THREE.Vector3()); f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const p = rec.data.p.slice();
    if (dir === 'f') { p[0] += f.x * step; p[2] += f.z * step; }
    if (dir === 'b') { p[0] -= f.x * step; p[2] -= f.z * step; }
    if (dir === 'r') { p[0] += r.x * step; p[2] += r.z * step; }
    if (dir === 'l') { p[0] -= r.x * step; p[2] -= r.z * step; }
    if (dir === 'u') p[1] += step;
    if (dir === 'd') p[1] = Math.max(0, p[1] - step);
    adjustPatch(id, { p: p.map((v) => +v.toFixed(3)) });
  }
  function adjustAction(act) {
    const id = adjustId;
    const rec = id && items.get(id);
    if (!rec) return;
    const d = rec.data;
    const r = SCALE_RANGE[d.kind] || SCALE_RANGE.model;
    const clampS = (v) => +Math.min(10 ** r[1], Math.max(10 ** r[0], v)).toPrecision(5);
    if (act === 's-') adjustPatch(id, { s: clampS((d.s || 1) / 1.1) });
    else if (act === 's+') adjustPatch(id, { s: clampS((d.s || 1) * 1.1) });
    else if (act === 's1') adjustPatch(id, { s: 1 }, true);
    else if (act === 'sfit') { const fit = fitPatchFor(rec); adjustPatch(id, { s: fit || d.s || 1 }, true); }
    else if (act === 'r-') adjustPatch(id, { ry: ((Math.round(d.ry || 0) + 15) % 360 + 360) % 360 });
    else if (act === 'r+') adjustPatch(id, { ry: ((Math.round(d.ry || 0) - 15) % 360 + 360) % 360 });
    else if (act.startsWith('m-')) moveRelative(id, act.slice(2), 0.1);
    else if (act === 'reset') { resetToSlot(id); refreshSelection(); }
    else if (act === 'here') { bringHere(id); refreshSelection(); }
    syncAdjustUI();
  }
  // buttons: tap for one step, hold to keep going
  $('#adjust').querySelectorAll('[data-act]').forEach((b) => {
    const act = b.dataset.act;
    const repeatable = /^(s-|s\+|r-|r\+|m-)/.test(act);
    let t1 = null, t2 = null;
    const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; b.classList.remove('held'); flushAdjust(); };
    if (!repeatable) { b.addEventListener('click', () => adjustAction(act)); return; }
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('held');
      adjustAction(act);
      t1 = setTimeout(() => { t2 = setInterval(() => adjustAction(act), 70); }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => b.addEventListener(t, stop));
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); adjustAction(act); } });
  });
  $('#adjScale').addEventListener('input', (e) => { if (adjustId) { adjustPatch(adjustId, { s: +(10 ** Number(e.target.value)).toPrecision(5) }); syncAdjustUI(); } });
  $('#adjScale').addEventListener('change', flushAdjust);
  $('#adjRot').addEventListener('input', (e) => { if (adjustId) { adjustPatch(adjustId, { ry: Number(e.target.value) }); syncAdjustUI(); } });
  $('#adjRot').addEventListener('change', flushAdjust);

  function startNoteAt(place, itemId) {
    const opts = { mode: 'new', world: place };
    if (itemId && items.has(itemId)) {
      const local = toItemLocal(itemId, place);
      opts.note = { on: itemId, p: local.p, q: local.q };
      const rec = items.get(itemId);
      if (rec.data.kind === 'pdf') opts.note.pg = rec.data.page || 1;
    } else {
      opts.note = { p: arr(place.p, 3), q: arr(place.q, 4) };
    }
    compose(opts);
  }

  function compose(opts) {
    if (opts.world) showGhost(opts.world, lastNoteColor);
    if (scene.is('vr-mode')) openVrKeyboard(opts);
    else openComposer(opts);
  }

  function submitNote(opts, text, color) {
    text = text.trim();
    hideGhost();
    if (!text) return;
    lastNoteColor = color; store.set('vsn.noteColor', color);
    if (opts.mode === 'edit') send({ type: 'note-update', id: opts.id, text, color });
    else send({ type: 'note-add', note: { ...opts.note, text, color } });
  }

  // ---------------- HTML sheets ----------------
  function openComposer(opts) {
    const current = opts.mode === 'edit' ? notes.get(opts.id).data : null;
    let color = current ? current.color : lastNoteColor;
    $('#composerTitle').textContent = current ? 'Edit sticky note' : (opts.note && opts.note.pg ? `New sticky note on page ${opts.note.pg}` : 'New sticky note');
    const ta = $('#noteText');
    ta.value = current ? current.text : '';
    ta.maxLength = config.maxText;
    const count = () => { $('#charCount').textContent = `${ta.value.length}/${config.maxText}`; ta.style.background = color + '55'; };
    ta.oninput = count;
    swatches($('#noteColors'), config.noteColors, color, (c) => { color = c; count(); if (ghost) ghost.setAttribute('material', 'color', c); }, true);
    $('#composerForm').onsubmit = (e) => { e.preventDefault(); closeSheet('#composer', true); submitNote(opts, ta.value, color); };
    count();
    openSheet('#composer');
    setTimeout(() => ta.focus(), 60);
  }

  let openNoteId = null;
  function openNote(id) {
    const rec = notes.get(id);
    if (!rec) return;
    openNoteId = id;
    if (scene.is('vr-mode')) return openVrPanel(rec.data);
    fillDetail(rec.data);
    openSheet('#detail');
  }
  function noteWhere(n) {
    if (!n.on) return '';
    const it = items.get(n.on);
    if (!it) return '';
    return ` · on ${itemTitle(it.data)}${n.pg ? `, page ${n.pg}` : ''}`;
  }
  function fillDetail(n) {
    const paper = $('#detailPaper');
    paper.textContent = n.text;
    paper.style.background = n.color;
    $('#detailMeta').textContent = `${n.author} · ${ago(n.ts)}${n.updated ? ' · edited' : ''}${noteWhere(n)}`;
    $('#voteBtn').textContent = `${n.voted ? 'Voted' : '+1'}${n.votes ? ` (${n.votes})` : ''}`;
    $('#voteBtn').classList.toggle('primary', !!n.voted);
    $('#editBtn').hidden = !n.mine;
    $('#deleteBtn').hidden = !(n.mine || me.isAdmin);
    $('#voteBtn').onclick = () => send({ type: 'note-vote', id: n.id });
    $('#editBtn').onclick = () => { closeSheet('#detail'); compose({ mode: 'edit', id: n.id }); };
    $('#deleteBtn').onclick = () => { if (confirm('Delete this sticky note for everyone?')) { send({ type: 'note-delete', id: n.id }); closeSheet('#detail'); } };
  }

  function syncSheetState() { document.body.classList.toggle('sheet-open', !!document.querySelector('.sheet-wrap:not([hidden])')); }
  function openSheet(sel) { $(sel).hidden = false; syncSheetState(); }
  function closeSheet(sel, keepGhost) {
    $(sel).hidden = true;
    if (sel === '#composer' && !keepGhost) hideGhost();
    if (sel === '#detail') openNoteId = null;
    if (sel === '#panel') $('#panel').dataset.kind = '';
    if (sel === '#upload' && uploadXhr) { uploadXhr.abort(); uploadXhr = null; }
    if (sel === '#itemMenu') closeItemMenu(keepGhost);
    if (sel === '#adjust') closeAdjust();
    syncSheetState();
  }
  document.querySelectorAll('.sheet-wrap').forEach((w) => {
    w.addEventListener('click', (e) => { if (e.target === w || e.target.closest('[data-close]')) closeSheet('#' + w.id); });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ['#composer', '#detail', '#panel', '#upload', '#itemMenu', '#adjust', '#avatarSheet'].forEach((s) => { if (!$(s).hidden) closeSheet(s); });
  });

  const panelBuilders = {};
  function openPanel(kind, title, build) {
    const panel = $('#panel');
    panel.dataset.kind = kind;
    panelBuilders[kind] = { title, build };
    $('#panelTitle').textContent = title;
    const body = $('#panelBody');
    body.className = '';
    body.innerHTML = '';
    build(body);
    openSheet('#panel');
  }
  function refreshPanel(kind) {
    const panel = $('#panel');
    if (panel.hidden || panel.dataset.kind !== kind) return;
    const b = panelBuilders[kind];
    const body = $('#panelBody');
    const scroll = panel.querySelector('.sheet').scrollTop;
    body.innerHTML = '';
    b.build(body);
    panel.querySelector('.sheet').scrollTop = scroll;
  }

  function showPeople() {
    openPanel('people', roomInfo.name, (body) => {
      if (roomInfo.desc) el('p', { class: 'fine' }, body).textContent = roomInfo.desc;
      const ul = el('ul', { class: 'people' }, body);
      const row = (name, color, tag) => {
        const li = el('li', {}, ul);
        el('span', { class: 'av' }, li).style.background = color;
        el('span', {}, li).textContent = name;
        el('span', { class: 'tag' }, li).textContent = tag;
      };
      row(me.name + ' (you)', me.avatar.shirt, `${DEVICE} · ${me.muted ? 'muted' : 'mic on'}`);
      for (const p of peers.values()) row(p.info.name, p.info.color, `${p.info.device} · ${p.info.muted ? 'muted' : 'mic on'}`);
      el('p', { class: 'fine' }, body).textContent = `${notes.size} sticky note${notes.size === 1 ? '' : 's'} and ${items.size} object${items.size === 1 ? '' : 's'} in this room.`;
      if (window.VSNLook) {
        const gfx = el('div', { class: 'gfx' }, body);
        el('span', { class: 'label' }, gfx).textContent = 'Graphics';
        const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Graphics quality' }, gfx);
        [['detailed', 'Detailed'], ['fast', 'Fast']].forEach(([q, label]) => {
          const b = el('button', { type: 'button', 'aria-pressed': String(VSNLook.quality === q) }, seg);
          b.textContent = label;
          b.onclick = () => { VSNLook.setQuality(q); refreshPanel('people'); toast(q === 'fast' ? 'Fast graphics: shadows and reflections off for smoother motion on older devices.' : 'Detailed graphics: shadows and reflections on.'); };
        });
      }
      const actions = el('div', { class: 'actions' }, body);
      const av = el('button', { class: 'btn', type: 'button' }, actions);
      av.textContent = 'Customize avatar';
      av.onclick = openAvatarEditor;
      const a = el('a', { class: 'btn', href: `/api/rooms/${encodeURIComponent(ROOM)}/notes.csv`, download: '' }, actions);
      a.textContent = 'Download notes (CSV)';
      a.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;text-decoration:none';
      const leave = el('button', { class: 'btn', type: 'button' }, actions);
      leave.textContent = 'Switch room';
      leave.onclick = () => { joined = false; location.href = '/'; };
      if (roomInfo.mine || me.isAdmin) {
        const del = el('button', { class: 'btn danger', type: 'button' }, actions);
        del.textContent = 'Delete room';
        del.onclick = async () => {
          if (!confirm(`Delete the room "${roomInfo.name}" with all its notes and files? This cannot be undone.`)) return;
          const r = await fetch(`/api/rooms/${encodeURIComponent(ROOM)}`, { method: 'DELETE', headers: { 'X-Client-Key': KEY, 'X-Admin-Key': ADMIN } });
          if (!r.ok) toast((await r.json().catch(() => ({}))).error || 'Could not delete the room.', 4000);
        };
      }
    });
  }

  function showObjects() {
    openPanel('objects', 'Objects in this room', (body) => {
      if (!items.size) {
        el('p', { class: 'empty' }, body).textContent = 'Nothing uploaded yet. Each of the 15 booths holds 1 model and 2 PDFs. Use "+ Add" at a booth or the button below.';
      }
      const ul = el('ul', { class: 'objs' }, body);
      const order = [...items.values()].sort((a, b) => (a.data.booth || 99) - (b.data.booth || 99) || String(a.data.slot).localeCompare(String(b.data.slot)));
      for (const rec of order) {
        const d = rec.data;
        const li = el('li', {}, ul);
        const head = el('div', { class: 'head' }, li);
        el('b', {}, head).textContent = itemTitle(d);
        let info;
        if (d.kind === 'portal') info = 'Doorway to another room';
        else if (d.kind === 'pdf') info = `PDF · ${rec.pages ? `page ${d.page} of ${rec.pages}` : 'loading'}`;
        else if (rec.size) {
          const s = d.s || 1;
          info = `3D model · ${(rec.size.x * s).toFixed(1)} x ${(rec.size.z * s).toFixed(1)} x ${(rec.size.y * s).toFixed(1)} m · ${Math.abs(s - 1) < 1e-4 ? 'real scale' : `scale ${s < 1 ? '1:' + +(1 / s).toPrecision(3) : s.toPrecision(3) + 'x'}`}`;
        } else info = '3D model · loading';
        el('span', { class: 'meta' }, head).textContent = d.booth ? `Booth ${d.booth}` : d.author;
        el('div', { class: 'meta' }, li).textContent = d.kind === 'portal' ? info : `${info} · ${fmtMB(d.size || 0)} · ${d.author}`;
        const tools = el('div', { class: 'tools' }, li);
        const tool = (label, fn, cls, aria) => { const b = el('button', { type: 'button', class: cls || '', 'aria-label': aria || label }, tools); b.textContent = label; b.onclick = fn; return b; };
        if (d.kind === 'portal') tool('Enter room', () => enterPortal(d.id));
        tool('Go to', () => { closeSheet('#panel'); goTo(d.id); });
        if (d.kind !== 'portal') tool('Move, rotate or resize', () => { closeSheet('#panel'); openAdjust(d.id); });
        else tool('Bring here', () => { bringHere(d.id); });
        if (d.kind === 'pdf') { tool('Prev page', () => turnPage(d.id, -1)); tool('Next page', () => turnPage(d.id, 1)); }
        if (canManage(d) && d.kind !== 'portal') tool('Replace', () => { closeSheet('#panel'); openUpload({ replace: d.id }); });
        if (canManage(d)) tool('Remove', () => deleteItem(d.id), 'danger');
      }
      const actions = el('div', { class: 'actions' }, body);
      actions.style.marginTop = '14px';
      const add = el('button', { class: 'btn primary', type: 'button' }, actions);
      add.textContent = 'Upload a model or PDF';
      add.onclick = () => { closeSheet('#panel'); openUpload(); };
      const portal = el('button', { class: 'btn', type: 'button' }, actions);
      portal.textContent = 'Add room shortcut';
      portal.onclick = showShortcut;
    });
  }

  function showShare() {
    const link = `${location.origin}/?room=${encodeURIComponent(ROOM)}`;
    openPanel('share', 'Invite people', (body) => {
      el('p', { class: 'fine' }, body).textContent = `Anyone with this link can join "${roomInfo.name}" from a computer, phone, or VR headset browser.`;
      const box = el('div', { class: 'linkbox' }, body);
      const input = el('input', { readonly: '', value: link }, box);
      const copy = el('button', { class: 'btn', type: 'button' }, box);
      copy.textContent = 'Copy';
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(link); } catch (e) { input.select(); document.execCommand && document.execCommand('copy'); }
        copy.textContent = 'Copied';
      };
      if (navigator.share) {
        const s = el('button', { class: 'btn primary', type: 'button' }, body);
        s.textContent = 'Share...';
        s.style.width = '100%';
        s.onclick = () => navigator.share({ title: `Join "${roomInfo.name}" in VR Sticky Notes`, url: link }).catch(() => {});
      }
    });
  }

  function showHelp() {
    openPanel('help', 'Controls', (body) => {
      body.className = 'panel-text';
      body.innerHTML = `
        <h4>Leave a note</h4><p>Tap, click, point at, or gaze at a pin board, a model, or a PDF page. Notes on a model move with it. Notes on a PDF belong to the page they were placed on. Tap a note to vote (+1), edit, or delete it.</p>
        <h4>Models and documents</h4><p>Use the upload button to add a .glb, .gltf or .obj model, or a PDF. Open <b>Objects</b> to move, turn, resize or delete them. Turn PDF pages with the buttons under the page.</p>
        <h4>Move</h4><p>Phone and tablet: left stick to move, right stick to look around, or turn your phone to look (the phone button at the top switches this off). Computer: WASD or arrow keys, drag to look, Q / E to turn. Headset: left stick walks, right stick turns, or point at the floor and pull the trigger.</p>
        <h4>Talk</h4><p>Use the mic button (or A / X on a Quest controller). Voices are louder when people stand closer. A green ring shows who is talking.</p>
        <h4>Fly</h4><p>Press <b>Fly</b> to float freely: you move in the direction you look, including up and down. Computer: WASD, Space to rise, Shift to sink, F to toggle. Phone: the left stick flies where you look, hold the arrow buttons to rise or sink. Headset: left stick flies where you look, right stick up / down rises and sinks, B or Y toggles. Cardboard: turn Fly on before entering VR, then aim at the sky and press the button. On a computer or in VR, click or aim at the floor to land; turning Fly off always brings you down.</p>
        <h4>Room shortcuts</h4><p>In <b>Objects</b>, choose <b>Add room shortcut</b> to create a new room (or link an existing one). A doorway appears in front of you. Go through it by tapping, clicking, or pointing at it. You stay in VR when you switch rooms.</p>
        <h4>VR</h4><p>Press the VR button at the bottom right. In Cardboard, aim the ring in the middle of your view and press the Cardboard button: on the floor to walk there, on a surface to leave a note, or on a button or doorway to use it. Turn by turning your head.</p>`;
    });
  }

  // Ignore the click that ends a drag-to-look.
  let downAt = null; let dragged = false;
  window.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; dragged = false; }, true);
  window.addEventListener('pointermove', (e) => { if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) dragged = true; }, true);
  window.addEventListener('pointerup', () => { downAt = null; }, true);
  function fromDrag(e) {
    const c = e && e.detail && e.detail.cursorEl;
    return dragged && (!c || c === scene);
  }

  // "+" button: note wherever the centre of the screen points.
  const centerRay = new THREE.Raycaster();
  function addAtCenter() {
    const targets = [];
    document.querySelectorAll('.pinnable, .item-surface:not(.portal-surface)').forEach((n) => { if (n.object3D && n.getAttribute('visible') !== false) targets.push(n.object3D); });
    centerRay.setFromCamera({ x: 0, y: 0 }, scene.camera);
    centerRay.far = 80;
    const hit = centerRay.intersectObjects(targets, true)[0];
    if (!hit) {
      $('#crosshair').classList.add('show');
      setTimeout(() => $('#crosshair').classList.remove('show'), 2500);
      return toast('Aim the centre of the screen at a board, model or PDF, then press + again. Or just tap it.', 3500);
    }
    let itemId = null;
    for (const [id, rec] of items) {
      let o = hit.object; let found = false;
      while (o) { if (o === rec.root.object3D) { found = true; break; } o = o.parent; }
      if (found) { itemId = id; break; }
    }
    const place = placementFromHit(hit);
    if (place) startNoteAt(place, itemId);
  }

  // ---------------- VR keyboard & note panel ----------------
  let vrKb = null; let vrPanel = null;

  function inFrontOfViewer(entity, dist, dy) {
    const cam = scene.camera;
    const pos = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const p = pos.clone().addScaledVector(dir, dist);
    p.y = pos.y + dy;
    entity.object3D.position.copy(p);
    entity.object3D.lookAt(pos.x, p.y, pos.z);
  }

  // A flat 3D button. Its label is sized to fit inside the button: charSize is the width of
  // one character in metres, and long labels shrink so they never spill past the edges.
  function vrButton(parent, label, x, y, w, h, onClick, opts) {
    opts = opts || {};
    const base = opts.color || '#363c47';
    const b = el('a-entity', { class: 'clickable', position: `${x} ${y} 0.004` }, parent);
    b.setAttribute('geometry', { primitive: 'plane', width: w, height: h });
    b.setAttribute('material', { color: base, shader: 'flat' });
    const tw = w * 0.88;
    const charSize = Math.min(opts.charSize || 0.028, h * 0.55);
    const wrap = Math.max(String(label).length + 1, Math.round(tw / charSize), 2);
    b.setAttribute('text', { value: label, align: 'center', anchor: 'center', baseline: 'center', color: opts.textColor || '#ffffff', width: tw, wrapCount: wrap, zOffset: 0.002 });
    if (window.VSNLook) VSNLook.untoned(b);
    b.addEventListener('mouseenter', () => b.setAttribute('material', 'color', opts.hover || '#2f6fc4'));
    b.addEventListener('mouseleave', () => b.setAttribute('material', 'color', base));
    b.addEventListener('click', (e) => { e.stopPropagation(); if (!fromDrag(e)) onClick(b); });
    return b;
  }

  // New 3D buttons must be added to the pointers' target lists before they can be hit.
  function refreshPointersSoon() {
    setTimeout(refreshRaycasters, 30);
    setTimeout(refreshRaycasters, 250);
  }

  function openVrKeyboard(opts) {
    closeVrKeyboard(true); closeVrPanel();
    const current = opts.mode === 'edit' ? notes.get(opts.id).data : null;
    let text = current ? current.text : '';
    let color = current ? current.color : lastNoteColor;
    let shift = !text;

    const root = el('a-entity', { class: 'vr-keyboard' }, $('#vrLayer'));
    vrKb = root;
    inFrontOfViewer(root, 1.0, -0.2);
    const bg = el('a-entity', { position: '0 0.065 -0.002' }, root);
    bg.setAttribute('geometry', { primitive: 'plane', width: 1.04, height: 0.93 });
    bg.setAttribute('material', { color: '#262b33', shader: 'flat', opacity: 0.94, transparent: true });
    const title = el('a-entity', { position: '-0.49 0.475 0.003' }, root);
    title.setAttribute('text', { value: current ? 'Edit sticky note' : 'New sticky note', color: '#ffffff', width: 0.6, wrapCount: 24, anchor: 'left' });
    const preview = el('a-entity', { position: '0 0.375 0.003' }, root);
    preview.setAttribute('geometry', { primitive: 'plane', width: 0.98, height: 0.13 });
    preview.setAttribute('material', { color, shader: 'flat' });
    preview.setAttribute('text', { value: '', color: '#1d1d1f', width: 0.93, wrapCount: 40, align: 'left', anchor: 'center', baseline: 'center', zOffset: 0.002 });
    const showText = () => {
      preview.setAttribute('text', { value: wrapLines(font3d(text) + '_', 38).slice(-3).join('\n') });
      preview.setAttribute('material', 'color', color);
      if (ghost) ghost.setAttribute('material', 'color', color);
    };
    const add = (s) => { if (text.length + s.length <= config.maxText) text += s; showText(); };

    // quick phrases (fastest way to comment, especially in Cardboard)
    ['Looks good', 'Question:', 'Clash here', 'Needs change'].forEach((ph, i) => vrButton(root, ph, -0.3675 + i * 0.245, 0.255, 0.235, 0.07, () => {
      add((text && !/\s$/.test(text) ? ' ' : '') + ph); shift = false; refreshKeys();
    }, { color: '#2b3e5c', hover: '#2f6fc4', charSize: 0.02 }));

    // letter keys: 8.5 cm squares
    const KEY = 0.085, PITCH = 0.095;
    const rows = ['1234567890', 'qwertyuiop', "asdfghjkl'", 'zxcvbnm,.?'];
    const letterKeys = [];
    rows.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        const k = vrButton(root, ch, -0.4275 + c * PITCH, 0.15 - r * PITCH, KEY, KEY, () => {
          add(shift ? ch.toUpperCase() : ch);
          if (shift) { shift = false; refreshKeys(); }
        }, { charSize: 0.04 });
        if (/[a-z]/.test(ch)) letterKeys.push({ k, ch });
      });
    });
    const refreshKeys = () => letterKeys.forEach(({ k, ch }) => k.setAttribute('text', { value: shift ? ch.toUpperCase() : ch }));

    const by = 0.15 - 4 * PITCH;
    vrButton(root, 'Shift', -0.38, by, 0.18, KEY, () => { shift = !shift; refreshKeys(); }, { charSize: 0.03 });
    vrButton(root, 'space', -0.055, by, 0.45, KEY, () => add(' '), { charSize: 0.03 });
    vrButton(root, '!', 0.2225, by, KEY, KEY, () => add('!'), { charSize: 0.04 });
    vrButton(root, 'Delete', 0.3725, by, 0.195, KEY, () => { text = text.slice(0, -1); showText(); }, { color: '#5b3439', hover: '#b4373f', charSize: 0.028 });

    const cy = by - 0.105;
    config.noteColors.forEach((c, i) => vrButton(root, '', -0.44 + i * 0.07, cy, 0.06, 0.06, () => { color = c; showText(); }, { color: c, hover: c }));
    vrButton(root, 'Cancel', 0.08, cy, 0.17, 0.075, () => closeVrKeyboard(), { charSize: 0.028 });
    vrButton(root, 'Post', 0.33, cy, 0.24, 0.075, () => { closeVrKeyboard(true); submitNote(opts, text, color); }, { color: '#2f6fc4', hover: '#4d8fe0', textColor: '#ffffff', charSize: 0.034 });

    refreshKeys();
    showText();
    refreshPointersSoon();
  }
  function closeVrKeyboard(keepGhost) {
    if (vrKb && vrKb.parentNode) vrKb.parentNode.removeChild(vrKb);
    vrKb = null;
    if (!keepGhost) hideGhost();
  }

  function openVrPanel(n) {
    closeVrPanel(); closeVrKeyboard();
    openNoteId = n.id;
    const root = el('a-entity', { class: 'vr-panel' }, $('#vrLayer'));
    vrPanel = root;
    inFrontOfViewer(root, 1.0, -0.1);
    const W = 0.8;
    const LH = 0.042;
    const lines = wrapLines(font3d(n.text), 30).slice(0, 10);
    const paperH = lines.length * LH + 0.06;
    const total = paperH + 0.22;
    const bg = el('a-entity', { position: '0 0 -0.002' }, root);
    bg.setAttribute('geometry', { primitive: 'plane', width: W + 0.06, height: total });
    bg.setAttribute('material', { color: '#262b33', shader: 'flat', opacity: 0.94, transparent: true });
    const top = total / 2;
    const paper = el('a-entity', { position: `0 ${top - 0.03 - paperH / 2} 0.003` }, root);
    paper.setAttribute('geometry', { primitive: 'plane', width: W, height: paperH });
    paper.setAttribute('material', { color: n.color, shader: 'flat' });
    paper.setAttribute('text', { value: lines.join('\n'), color: '#1d1d1f', width: W - 0.06, wrapCount: 32, align: 'left', anchor: 'center', baseline: 'center', zOffset: 0.002 });
    const meta = el('a-entity', { position: `${-W / 2} ${top - 0.03 - paperH - 0.04} 0.003` }, root);
    meta.setAttribute('text', { value: font3d(`${n.author} - ${ago(n.ts)}`), color: '#c9ced8', width: 0.6, wrapCount: 34, anchor: 'left' });
    const y = -top + 0.06;
    const btns = [[`${n.voted ? 'Voted' : '+1'}${n.votes ? ` (${n.votes})` : ''}`, () => send({ type: 'note-vote', id: n.id })]];
    if (n.mine) btns.push(['Edit', () => { closeVrPanel(); compose({ mode: 'edit', id: n.id }); }]);
    if (n.mine || me.isAdmin) btns.push(['Delete', () => { closeVrPanel(); send({ type: 'note-delete', id: n.id }); }]);
    btns.push(['Close', () => closeVrPanel()]);
    const gap = 0.015;
    const w = (W - gap * (btns.length - 1)) / btns.length;
    btns.forEach(([label, fn], i) => vrButton(root, label, -W / 2 + w / 2 + i * (w + gap), y, w, 0.08, fn, { charSize: 0.03 }));
    refreshPointersSoon();
  }
  // Object menu in VR: same choices as on screen (replacing a file needs a phone or computer)
  function vrPanelBase(width, height, title, subtitle, low) {
    closeVrPanel(); closeVrKeyboard(true);
    const root = el('a-entity', { class: 'vr-panel' }, $('#vrLayer'));
    vrPanel = root;
    if (low) { // off to the right, angled toward you, so the object stays in view
      const cam = scene.camera;
      const pos = cam.getWorldPosition(new THREE.Vector3());
      const dir = cam.getWorldDirection(new THREE.Vector3()); dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      const p = pos.clone().addScaledVector(dir, 0.72).addScaledVector(right, 0.5);
      p.y = pos.y - 0.3;
      root.object3D.position.copy(p);
      root.object3D.lookAt(pos.x, p.y, pos.z);
      root.object3D.rotateX(-0.35);
    }
    else inFrontOfViewer(root, 1.0, -0.18);
    const bg = el('a-entity', { position: '0 0 -0.002' }, root);
    bg.setAttribute('geometry', { primitive: 'plane', width, height });
    bg.setAttribute('material', { color: '#262b33', shader: 'flat', opacity: 0.94, transparent: true });
    if (window.VSNLook) VSNLook.untoned(bg);
    const t = el('a-entity', { position: `${-width / 2 + 0.04} ${height / 2 - 0.05} 0.003` }, root);
    t.setAttribute('text', { value: font3d(title).slice(0, 40), color: '#ffffff', width: width * 0.9, wrapCount: 30, anchor: 'left' });
    if (subtitle) {
      const st = el('a-entity', { position: `${-width / 2 + 0.04} ${height / 2 - 0.1} 0.003` }, root);
      st.setAttribute('text', { value: font3d(subtitle).slice(0, 60), color: '#aeb5bf', width: width * 0.9, wrapCount: 48, anchor: 'left' });
    }
    return root;
  }
  function openVrItemMenu(id) {
    const rec = items.get(id);
    if (!rec) return;
    const d = rec.data, manage = canManage(d);
    const W = 0.62;
    const root = vrPanelBase(W, 0.5, itemTitle(d), describeItem(d));
    const btn = (label, y, fn, opts) => vrButton(root, label, 0, y, W - 0.08, 0.075, fn, Object.assign({ charSize: 0.028 }, opts || {}));
    btn('Add sticky note here', 0.07, () => { const p = menuPlace; closeItemMenu(true); if (p) startNoteAt(p, id); }, { color: '#2f6fc4', hover: '#4d8fe0' });
    btn('Move, rotate or resize', -0.02, () => { closeItemMenu(); openAdjust(id); });
    btn(manage ? (d.kind === 'pdf' ? 'Remove PDF' : 'Remove model') : 'Remove (uploader only)', -0.11, () => { if (!manage) return vrToast('Only the uploader, room creator or admin can remove it.'); closeItemMenu(); send({ type: 'item-delete', id }); }, manage ? { color: '#5b3439', hover: '#b4373f' } : { color: '#30353e', hover: '#30353e' });
    btn('Close', -0.2, () => closeItemMenu());
    refreshPointersSoon();
  }
  function openVrAdjust(id) {
    const rec = items.get(id);
    if (!rec) return;
    const W = 0.78;
    const root = vrPanelBase(W, 0.56, `Adjust ${itemTitle(rec.data)}`, 'Size, rotation and position', true);
    const row = (label, y) => { const t = el('a-entity', { position: `${-W / 2 + 0.04} ${y} 0.003` }, root); t.setAttribute('text', { value: label, color: '#aeb5bf', width: 0.5, wrapCount: 20, anchor: 'left' }); };
    const b = (label, x, y, w, act) => vrButton(root, label, x, y, w, 0.07, () => adjustAction(act), { charSize: 0.026 });
    row('Size', 0.12);
    b('Smaller', -0.14, 0.12, 0.13, 's-'); b('Bigger', 0.0, 0.12, 0.13, 's+');
    if (rec.data.kind === 'model') { b('1:1', 0.14, 0.12, 0.1, 's1'); b('Fit', 0.27, 0.12, 0.1, 'sfit'); }
    row('Turn', 0.03);
    b('Turn left', -0.14, 0.03, 0.13, 'r-'); b('Turn right', 0.0, 0.03, 0.13, 'r+');
    if (rec.data.booth) b('Booth spot', 0.2, 0.03, 0.24, 'reset');
    row('Move', -0.06);
    b('Left', -0.17, -0.06, 0.1, 'm-l'); b('Right', -0.06, -0.06, 0.1, 'm-r'); b('Away', 0.05, -0.06, 0.1, 'm-f'); b('Closer', 0.16, -0.06, 0.1, 'm-b');
    b('Up', 0.27, -0.06, 0.08, 'm-u'); b('Down', 0.27, -0.145, 0.08, 'm-d');
    vrButton(root, 'Done', -0.1, -0.21, 0.3, 0.07, () => closeAdjust(), { color: '#2f6fc4', hover: '#4d8fe0', charSize: 0.03 });
    refreshPointersSoon();
  }

  function closeVrPanel() {
    if (vrPanel && vrPanel.parentNode) vrPanel.parentNode.removeChild(vrPanel);
    vrPanel = null;
  }

  // ---------------- VR mode switching ----------------
  function setHandRays(on) { ['#leftHand', '#rightHand'].forEach((s) => $(s).setAttribute('raycaster', 'enabled', on)); }
  ['#leftHand', '#rightHand'].forEach((s) => {
    const hand = $(s);
    hand.addEventListener('controllerconnected', () => { if (scene.is('vr-mode')) hand.setAttribute('raycaster', 'enabled', true); });
    ['abuttondown', 'xbuttondown'].forEach((ev) => hand.addEventListener(ev, () => setMuted(!me.muted)));
  });
  // ---------------- fly mode ----------------
  let flying = false;
  const mover = () => $('#rig').components['rig-move'];
  function setFly(on) {
    flying = on;
    $('#rig').setAttribute('rig-move', 'fly', on);
    $('#flyBtn').setAttribute('aria-pressed', String(on));
    $('#flyPad').hidden = !on;
    if (!on && mover()) mover().setVertical(0);
    let msg;
    if (!on) msg = 'Landing. Fly mode off.';
    else if (scene.is('vr-mode') && gazeMode) msg = 'Flying: aim up or ahead and press the button to fly there. Aim at the floor to land.';
    else if (scene.is('vr-mode') || DEVICE === 'headset') msg = 'Flying: left stick moves where you look, right stick up/down rises and sinks. B or Y to land.';
    else if (TOUCH_UI) msg = 'Flying: the left stick moves you where you look. Hold the arrows to rise or sink. Turn Fly off to land.';
    else msg = 'Flying: WASD moves where you look, Space rises, Shift sinks, click the floor to land. F toggles flying.';
    toast(msg, on ? 5000 : 1800);
  }
  $('#flyBtn').addEventListener('click', (e) => { setFly(!flying); e.currentTarget.blur(); });
  [['#flyUp', 1], ['#flyDown', -1]].forEach(([sel, dir]) => {
    const b = $(sel);
    const start = (e) => { e.preventDefault(); b.classList.add('held'); if (mover()) mover().setVertical(dir); };
    const stop = () => { b.classList.remove('held'); if (mover()) mover().setVertical(0); };
    b.addEventListener('pointerdown', start);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => b.addEventListener(t, stop));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && joined && !e.repeat && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) setFly(!flying);
  });
  ['#leftHand', '#rightHand'].forEach((s) => ['bbuttondown', 'ybuttondown'].forEach((ev) => $(s).addEventListener(ev, () => setFly(!flying))));

  // ---------------- dual sticks (phones and tablets, outside VR) ----------------
  // Left stick moves, right stick looks around; turning the phone (gyroscope) also looks around.
  // Tap-to-walk is off on these devices, so taps only ever select boards, notes, models and PDFs.
  const TOUCH_UI = DEVICE === 'phone' || (DEVICE !== 'headset' && window.matchMedia && matchMedia('(pointer: coarse)').matches);
  function makeStick(elStick, onMove) {
    const knob = elStick.querySelector('.joy-knob');
    const R = 40; // how far the knob can travel, in px
    let pid = null, cx = 0, cy = 0;
    const move = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      onMove(dx / R, dy / R);
    };
    const release = () => { pid = null; knob.style.transform = ''; elStick.classList.remove('active'); onMove(0, 0); };
    elStick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pid = e.pointerId;
      try { elStick.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      const r = elStick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      elStick.classList.add('active');
      move(e);
    });
    elStick.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => elStick.addEventListener(t, (e) => { if (e.pointerId === pid) release(); }));
    elStick.addEventListener('contextmenu', (e) => e.preventDefault());
    return { release };
  }
  const moveStick = makeStick($('#joystick'), (x, y) => { if (mover()) mover().setJoystick(x, y); });
  const lookStick = makeStick($('#lookStick'), (x, y) => { if (mover()) mover().setLook(x, y); });
  function showJoystick(on) {
    $('#joystick').hidden = !on;
    $('#lookStick').hidden = !on;
    document.body.classList.toggle('has-joystick', on);
    if (!on) { moveStick.release(); lookStick.release(); }
  }

  // Gyroscope: on by default; iPhones need permission, asked when you press Join.
  let gyroOn = store.get('vsn.gyro') !== 'off';
  async function requestGyroPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE || typeof DOE.requestPermission !== 'function') return true; // Android and others
    try {
      const r = await DOE.requestPermission();
      if (r === 'granted') { scene.emit('deviceorientationpermissiongranted'); return true; }
    } catch (e) { /* the user said no, or it was not a tap */ }
    return false;
  }
  function setGyro(on) {
    gyroOn = on;
    store.set('vsn.gyro', on ? 'on' : 'off');
    $('#cam').setAttribute('look-controls', 'magicWindowTrackingEnabled', on);
    $('#gyroBtn').setAttribute('aria-pressed', String(on));
    $('#gyroBtn').setAttribute('aria-label', on ? 'Turn off looking by turning your phone' : 'Look around by turning your phone');
  }
  function setupTouchControls() {
    if (!TOUCH_UI) return;
    $('#cam').setAttribute('look-controls', 'touchEnabled', false); // looking is the right stick and the gyroscope
    $('#gyroBtn').hidden = false;
    setGyro(gyroOn);
    showJoystick(true);
  }
  $('#gyroBtn').addEventListener('click', async () => {
    if (!gyroOn) await requestGyroPermission();
    setGyro(!gyroOn);
    toast(gyroOn ? 'Gyroscope on: turn your phone to look around.' : 'Gyroscope off: use the right stick to look around.');
  });

  // Flying on a phone or computer: tap or click empty sky to fly toward it.
  const skyRay = new THREE.Raycaster();
  function onSkyTap(e) {
    if (!flying || !joined || dragged || scene.is('vr-mode') || TOUCH_UI) return;
    const cur = scene.components.cursor;
    if (cur && cur.intersectedEl) return; // a surface, note or button handles its own tap
    const rect = scene.canvas.getBoundingClientRect();
    skyRay.setFromCamera({ x: ((e.clientX - rect.left) / rect.width) * 2 - 1, y: -((e.clientY - rect.top) / rect.height) * 2 + 1 }, scene.camera);
    mover().flyToward(skyRay.ray.direction, 4);
  }
  if (scene.canvas) scene.canvas.addEventListener('click', onSkyTap);
  else scene.addEventListener('loaded', () => scene.canvas.addEventListener('click', onSkyTap), { once: true });

  // Cardboard: the ring in the middle of your view is the pointer. Pressing the Cardboard
  // button (which taps the screen) selects whatever it points at: the floor to walk there,
  // a surface to leave a note, a note, or a button.
  let gazeMode = false;
  let lastGazeSelect = 0;
  function gazeSelect() {
    if (!gazeMode) return;
    const now = Date.now();
    if (now - lastGazeSelect < 300) return; // one press can arrive as both an XR and a touch event
    lastGazeSelect = now;
    const gaze = $('#gaze');
    gaze.emit('gazeselect', null, false);
    const rc = gaze.components.raycaster;
    if (!rc) return;
    rc.checkIntersections && rc.checkIntersections();
    const target = rc.intersectedEls[0];
    if (!target) {
      // aiming at empty sky while flying: fly that way
      if (flying) mover().flyToward(scene.camera.getWorldDirection(new THREE.Vector3()), 4);
      return;
    }
    target.emit('click', { intersection: rc.getIntersection(target), cursorEl: gaze });
  }
  function onXrSelect() { gazeSelect(); }
  function setGazeMode(on) {
    gazeMode = on;
    const gaze = $('#gaze');
    gaze.setAttribute('visible', on);
    gaze.setAttribute('raycaster', 'enabled', on);
    const session = scene.xrSession;
    if (session) {
      session.removeEventListener('select', onXrSelect);
      if (on) session.addEventListener('select', onXrSelect);
    }
  }
  if (scene.canvas) scene.canvas.addEventListener('touchend', gazeSelect);
  else scene.addEventListener('loaded', () => scene.canvas.addEventListener('touchend', gazeSelect), { once: true });

  scene.addEventListener('enter-vr', () => {
    showJoystick(false);
    const useGaze = DEVICE === 'phone';
    setGazeMode(useGaze);
    setHandRays(!useGaze);
    ['#composer', '#detail', '#panel', '#upload', '#itemMenu', '#adjust', '#avatarSheet'].forEach((s) => { if (!$(s).hidden) closeSheet(s); });
    if (useGaze) vrToast('Aim the ring and press the Cardboard button', 3500);
    else vrToast(me.muted ? 'Mic off - press A or X to talk' : 'Mic on', 2500);
  });
  scene.addEventListener('exit-vr', () => {
    if (TOUCH_UI && joined) showJoystick(true);
    setGazeMode(false);
    setHandRays(false);
    closeVrKeyboard(); closeVrPanel();
  });

  // ---------------- scene wiring ----------------
  // Soft sky: deeper blue overhead fading into the hazy horizon (matches the fog colour).
  function paintSky() {
    const sky = $('#sky');
    const mesh = sky && sky.getObject3D('mesh');
    if (!mesh) return;
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 512;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#79b5e5');
    grad.addColorStop(0.32, '#a9d6f6');
    grad.addColorStop(0.5, '#e3eef6');
    grad.addColorStop(1, '#e3eef6');
    g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    mesh.material.map = tex;
    mesh.material.color.set('#ffffff');
    mesh.material.toneMapped = false;
    mesh.material.needsUpdate = true;
  }

  function wireScene() {
    if (window.VSNLook) VSNLook.setup(scene);
    paintSky();
    buildVenue(); // build the hall first so its boards and pedestals get wired below
    document.querySelectorAll('.pinnable').forEach((n) => n.addEventListener('click', (e) => onSurfaceClick(e, null)));
    // Floor and pedestals: tap / click / aim there to walk to that spot (and step onto it).
    $('#floor').addEventListener('click', onFloorClick);
    refreshRaycasters();
  }

  $('#micBtn').addEventListener('click', () => setMuted(!me.muted));
  $('#addBtn').addEventListener('click', addAtCenter);
  $('#uploadBtn').addEventListener('click', openUpload);
  $('#objectsBtn').addEventListener('click', showObjects);
  $('#shareBtn').addEventListener('click', showShare);
  $('#peopleBtn').addEventListener('click', showPeople);
  $('#helpBtn').addEventListener('click', showHelp);
  window.addEventListener('pagehide', () => { joined = false; if (ws) ws.close(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

  async function boot() {
    await loadConfig();
    initLobby();
    if (scene.hasLoaded) wireScene(); else scene.addEventListener('loaded', wireScene, { once: true });
  }
  boot();

  window.vsn = { me, peers, notes, items, get room() { return ROOM; } };
})();
