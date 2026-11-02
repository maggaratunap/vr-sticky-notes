import { shortcutPosition, shortcutTarget } from '../../lib/room-shortcuts.ts';
import { validateDeck, readPresentation, validCamera } from '../../lib/presentation.ts';
import { bucket } from '../../db/storage.mjs';
import { getDb } from '../../db/index.ts';
import { rooms, assets, notes, peers, signals, guests, audioPackets, roomShortcuts } from '../../db/schema.ts';
import { eq, and, gt, lt, ne, desc, sql, isNull, asc, or } from 'drizzle-orm';
export const dynamic = 'force-dynamic';
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
const valid = (s: unknown, max = 100) => typeof s === 'string' && s.length > 0 && s.length <= max;
async function handle(req: Request) {
    try {
        const url = new URL(req.url);
        const path = url.pathname.split('/').filter(Boolean).slice(1);
        const db = getDb();
        const now = Date.now();
        const signedIn:null = null;
        const write = req.method !== 'GET';
        if (write) {
            const origin = req.headers.get('origin');
            if (origin && new URL(origin).origin !== url.origin)
                return json({ error: 'This action must be made from Pinspace.' }, 403);
        }
        const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), v => v.toString(16).padStart(2, '0')).join('');
        if (path[0] === 'guest' && path.length === 1 && req.method === 'POST') {
            const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip');
            const ipHash = ip ? await hash(ip) : null;
            if (ipHash) {
                const recent = await db.select({ count: sql<number> `count(*)` }).from(guests).where(and(eq(guests.ipHash, ipHash), gt(guests.created, now - 3600000))).get();
                if ((recent?.count || 0) > 500)
                    return json({ error: 'Too many guest sessions. Please try again later.' }, 429);
            }
            const token = crypto.randomUUID() + crypto.randomUUID();
            await db.insert(guests).values({ id: crypto.randomUUID(), tokenHash: await hash(token), ipHash, created: now });
            return json({ token });
        }
        let owner: string | null = null;
        const token = req.headers.get('x-pinspace-session');
        if (token && token.length < 200) {
            const g = await db.select().from(guests).where(eq(guests.tokenHash, await hash(token))).get();
            owner = g?.id || null;
        }
        if (write && !owner)
            return json({ error: 'Your guest session expired. Reload and try again.' }, 401);
        if (path[0] === 'lounge' && req.method === 'GET') {
            await db.insert(rooms).values({ id: 'session-lounge', title: 'Session space', created: 0, publicRoom: 1 }).onConflictDoNothing();
            return json({ id: 'session-lounge' });
        }
        if (path[0] === 'rooms' && path.length === 1 && req.method === 'GET') {
            const list = await db.select({ id: rooms.id, title: rooms.title, created: rooms.created, portalPosition: rooms.portalPosition, live: sql<boolean> `(${rooms.presenterSeen} > ${now - 15000} and json_extract(${rooms.presentationState}, '$.live')=1)`, slides: sql<number> `coalesce(json_array_length(${rooms.presentationDeck}),0)`, canManage: sql<boolean> `${rooms.owner} = ${owner || ''}`,
                models: sql<number> `(select count(*) from assets where assets.room = ${rooms.id} and assets.kind = 'glb' and assets.removed_at is null)`,
                documents: sql<number> `(select count(*) from assets where assets.room = ${rooms.id} and assets.kind = 'pdf' and assets.removed_at is null)`,
                notes: sql<number> `(select count(*) from notes where notes.room = ${rooms.id} and notes.removed_at is null and (notes.asset is null or exists (select 1 from assets where assets.id=notes.asset and assets.removed_at is null)))`,
                people: sql<number> `(select count(*) from peers where peers.room = ${rooms.id} and peers.seen > ${now - 20000})`
            }).from(rooms).where(and(eq(rooms.publicRoom, 1), isNull(rooms.removedAt), ne(rooms.id, 'session-lounge'))).orderBy(desc(rooms.created)).limit(200);
            return json({ rooms: list });
        }
        if (path[0] === 'rooms' && path.length === 1 && req.method === 'POST') {
            const recent = await db.select({ count: sql<number> `count(*)` }).from(rooms).where(and(eq(rooms.owner, owner!), gt(rooms.created, now - 86400000))).get();
            if ((recent?.count || 0) >= 20)
                return json({ error: 'You can create up to 20 rooms per day.' }, 429);
            const b: any = await req.json();
            const title = typeof b.title === 'string' ? b.title.trim() : '';
            if (!valid(title, 100))
                return json({ error: 'Give your room a name (up to 100 characters).' }, 400);
            const id = crypto.randomUUID().slice(0, 8);
            const count = await db.select({ count: sql<number> `count(*)` }).from(rooms).where(ne(rooms.id, 'session-lounge')).get();
            const i = count?.count || 0;
            const position = [((i % 5) - 2) * 4, 1.5, -6 - Math.floor(i / 5) * 4];
            await db.insert(rooms).values({ id, title, created: now, publicRoom: 1, owner: owner!, portalPosition: JSON.stringify(position) });
            return json({ id });
        }
        // Existing private rooms never enter the public directory. The original note
        // author can still open a legacy review while signed in to their account.
        const canRead = async (r: any) => {
            if (r.publicRoom === 1)
                return true;
            if (!signedIn)
                return false;
            const first = await db.select({ owner: notes.owner }).from(notes).where(eq(notes.room, r.id)).limit(1).get();
            return first?.owner === signedIn;
        };
        if (path[0] === 'asset' && path[1] && req.method === 'GET') {
            const a = await db.select().from(assets).where(eq(assets.id, path[1])).get();
            if (!a || a.removedAt)
                return json({ error: 'File not found' }, 404);
            const parent = await db.select().from(rooms).where(eq(rooms.id, a.room)).get();
            if (!parent || parent.removedAt || !await canRead(parent))
                return json({ error: 'File not found' }, 404);
            const obj = await bucket.get(a.id);
            if (!obj)
                return json({ error: 'File unavailable' }, 404);
            return new Response(obj.body as unknown as BodyInit, { headers: { 'Content-Type': a.kind === 'pdf' ? 'application/pdf' : 'model/gltf-binary', 'Content-Length': String(a.size), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        }
        if (path[0] !== 'rooms' || !path[1])
            return json({ error: 'Unknown route' }, 404);
        const room = path[1];
        const r = await db.select().from(rooms).where(eq(rooms.id, room)).get();
        if (!r || (r.removedAt && !(req.method === 'POST' && path[2] === 'restore')) || !await canRead(r))
            return json({ error: 'Room not found. Create a public room or check your room code.' }, 404);
        if (path.length === 2 && req.method === 'DELETE') {
            if (r.owner !== owner)
                return json({ error: 'Only the room creator can remove this room.' }, 403);
            await db.update(rooms).set({ removedAt: now }).where(eq(rooms.id, room));
            await db.delete(audioPackets).where(eq(audioPackets.room, room));
            return json({ ok: true });
        }
        if (path[2] === 'restore' && req.method === 'POST') {
            if (r.owner !== owner)
                return json({ error: 'Only the room creator can restore this room.' }, 403);
            await db.update(rooms).set({ removedAt: null }).where(eq(rooms.id, room));
            return json({ ok: true });
        }
        if (path[2] === 'shortcuts') {
            if (r.owner !== owner)
                return json({ error: 'Only the room creator can add, move or remove shortcuts.' }, 403);
            if (path.length === 3 && req.method === 'POST') {
                const b: any = await req.json();
                let target: string, position: number[];
                try {
                    target = shortcutTarget(b.target, room);
                    position = shortcutPosition(b.position);
                }
                catch (e) {
                    return json({ error: (e as Error).message }, 400);
                }
                const destination = await db.select().from(rooms).where(and(eq(rooms.id, target), eq(rooms.publicRoom, 1), isNull(rooms.removedAt))).get();
                if (!destination)
                    return json({ error: 'Destination room is unavailable.' }, 404);
                const existing = await db.select().from(roomShortcuts).where(and(eq(roomShortcuts.room, room), eq(roomShortcuts.target, target))).get();
                if (existing && !existing.removedAt)
                    return json({ error: 'This room already has that shortcut. Use Move here to reposition it.' }, 409);
                const count = await db.select({ count: sql<number> `count(*)` }).from(roomShortcuts).where(and(eq(roomShortcuts.room, room), isNull(roomShortcuts.removedAt))).get();
                if ((count?.count || 0) >= 20)
                    return json({ error: 'A room can contain up to 20 shortcuts.' }, 400);
                const id = existing?.id || crypto.randomUUID();
                await db.insert(roomShortcuts).values({ id, room, target, position: JSON.stringify(position), created: now }).onConflictDoUpdate({ target: [roomShortcuts.room, roomShortcuts.target], set: { removedAt: null, position: JSON.stringify(position) } });
                return json({ id });
            }
            const item = await db.select().from(roomShortcuts).where(and(eq(roomShortcuts.id, path[3] || ''), eq(roomShortcuts.room, room))).get();
            if (!item)
                return json({ error: 'Shortcut not found.' }, 404);
            if (req.method === 'DELETE' && path.length === 4) {
                await db.update(roomShortcuts).set({ removedAt: now }).where(eq(roomShortcuts.id, item.id));
                return json({ ok: true });
            }
            if (req.method === 'PATCH' && path.length === 4 && !item.removedAt) {
                let position;
                try {
                    position = shortcutPosition((await req.json() as any).position);
                }
                catch (e) {
                    return json({ error: (e as Error).message }, 400);
                }
                await db.update(roomShortcuts).set({ position: JSON.stringify(position) }).where(eq(roomShortcuts.id, item.id));
                return json({ ok: true });
            }
            if (req.method === 'POST' && path[4] === 'restore') {
                const target = await db.select().from(rooms).where(and(eq(rooms.id, item.target), eq(rooms.publicRoom, 1), isNull(rooms.removedAt))).get();
                if (!target)
                    return json({ error: 'Restore the destination room before its shortcut.' }, 400);
                const count = await db.select({ count: sql<number> `count(*)` }).from(roomShortcuts).where(and(eq(roomShortcuts.room, room), isNull(roomShortcuts.removedAt))).get();
                if (item.removedAt && (count?.count || 0) >= 20)
                    return json({ error: 'A room can contain up to 20 shortcuts.' }, 400);
                await db.update(roomShortcuts).set({ removedAt: null }).where(eq(roomShortcuts.id, item.id));
                return json({ ok: true });
            }
            return json({ error: 'Unknown shortcut action.' }, 404);
        }
        if (path.length === 2 && req.method === 'GET') {
            const [a, n, p, shortcuts] = await Promise.all([db.select().from(assets).where(and(eq(assets.room, room), isNull(assets.removedAt))), db.select().from(notes).where(and(eq(notes.room, room), isNull(notes.removedAt))), db.select({ id: peers.id, name: peers.name, pose: peers.pose, mic: peers.mic }).from(peers).where(and(eq(peers.room, room), gt(peers.seen, now - 20000))), db.select({ id: roomShortcuts.id, target: roomShortcuts.target, title: rooms.title, position: roomShortcuts.position }).from(roomShortcuts).innerJoin(rooms, eq(roomShortcuts.target, rooms.id)).where(and(eq(roomShortcuts.room, room), isNull(roomShortcuts.removedAt), isNull(rooms.removedAt), eq(rooms.publicRoom, 1)))]);
            const { presentationDeck, presentationState, ...publicRoom } = r;
            return json({ shortcuts: shortcuts.map(x => ({ ...x, canManage: r.owner === owner })), presentation: readPresentation(r, r.owner === owner, a, now), room: { ...publicRoom, canManage: r.owner === owner }, assets: a.map(x => ({ ...x, canManage: r.owner === owner || x.owner === owner })), notes: n.filter(x => !x.asset || a.some(f => f.id === x.asset)).map(x => ({ ...x, canManage: r.owner === owner || x.owner === owner })), peers: p });
        }
        if (path[2] === 'presentation' && req.method === 'POST') {
            if (r.owner !== owner)
                return json({ error: 'Only the room creator can edit or control this presentation.' }, 403);
            const b: any = await req.json();
            const currentFiles = await db.select({ id: assets.id, kind: assets.kind }).from(assets).where(and(eq(assets.room, room), isNull(assets.removedAt)));
            const current = readPresentation(r, true, currentFiles, now);
            let state = current.state;
            if (b.action === 'save') {
                if (!Number.isInteger(b.revision) || b.revision !== r.presentationRevision)
                    return json({ error: 'The outline changed in another tab. Reset your edits and try again.' }, 409);
                let deck;
                try {
                    deck = validateDeck(b.deck, currentFiles);
                }
                catch (e) {
                    return json({ error: (e as Error).message }, 400);
                }
                if (state.slideId && !deck.some(s => s.id === state.slideId))
                    state = { ...state, slideId: deck[0]?.id || null, view: deck[0]?.camera || null, updated: now };
                if (!deck.length)
                    state = { ...state, live: false };
                const saved = await db.update(rooms).set({ presentationDeck: JSON.stringify(deck), presentationRevision: r.presentationRevision + 1, presentationState: JSON.stringify(state) }).where(and(eq(rooms.id, room), eq(rooms.presentationRevision, b.revision))).returning({id:rooms.id});
                if (!saved.length)
                    return json({ error: 'The outline changed in another tab. Reset your edits and try again.' }, 409);
                return json({ ok: true });
            }
            if (b.action === 'start') {
                if (!current.deck.length)
                    return json({ error: 'Add a model view or PDF page before presenting.' }, 400);
                const host = await db.select().from(peers).where(and(eq(peers.id, b.peer || ''), eq(peers.owner, owner!), eq(peers.room, room))).get();
                if (!host)
                    return json({ error: 'Wait until you have joined this room, then try again.' }, 400);
                const slide = current.deck.find(s => s.id === b.slideId) || current.deck[0];
                state = { live: true, slideId: slide.id, presenterName: valid(b.name, 50) ? b.name : 'Presenter', presenterPeer: b.peer, startedAt: now, updated: now, view: slide.camera };
                await db.update(rooms).set({ presentationState: JSON.stringify(state), presenterSeen: now }).where(eq(rooms.id, room));
                return json({ ok: true });
            }
            if (b.action === 'stop') {
                await db.update(rooms).set({ presentationState: JSON.stringify({ ...state, live: false, updated: now }) }).where(eq(rooms.id, room));
                return json({ ok: true });
            }
            if (b.action === 'go') {
                const slide = current.deck.find(s => s.id === b.slideId);
                if (!slide)
                    return json({ error: 'Slide not found in this presentation.' }, 404);
                await db.update(rooms).set({ presentationState: JSON.stringify({ ...state, slideId: slide.id, view: slide.camera, updated: now }) }).where(eq(rooms.id, room));
                return json({ ok: true });
            }
            if (b.action === 'view') {
                if (!state.live || state.presenterPeer !== b.peer || !validCamera(b.view))
                    return json({ error: 'The live presenter must supply a valid camera view.' }, 400);
                if (current.deck.find(s => s.id === state.slideId)?.kind !== 'model')
                    return json({ error: 'Camera updates apply to model slides.' }, 400);
                await db.update(rooms).set({ presentationState: sql `json_set(${rooms.presentationState}, '$.view', json(${JSON.stringify(b.view)}), '$.updated', ${now})` }).where(and(eq(rooms.id, room), sql `json_extract(${rooms.presentationState}, '$.live')=1`, sql `json_extract(${rooms.presentationState}, '$.presenterPeer')=${b.peer}`, sql `json_extract(${rooms.presentationState}, '$.slideId')=${state.slideId}`));
                return json({ ok: true });
            }
            return json({ error: 'Unknown presentation action' }, 400);
        }
        if ((path[2] === 'assets' || path[2] === 'notes') && path[3] && (req.method === 'DELETE' || (req.method === 'POST' && path[4] === 'restore'))) {
            const table = path[2] === 'assets' ? assets : notes;
            const item = await db.select().from(table).where(and(eq(table.id, path[3]), eq(table.room, room))).get();
            if (!item)
                return json({ error: 'Object not found' }, 404);
            if (item.owner !== owner && r.owner !== owner)
                return json({ error: 'Only the uploader/author or room creator can remove this object.' }, 403);
            await db.update(table).set({ removedAt: req.method === 'DELETE' ? now : null }).where(eq(table.id, path[3]));
            return json({ ok: true });
        }
        if (path[2] === 'assets' && req.method === 'POST') {
            const quota = await db.select({ count: sql<number> `count(*)`, bytes: sql<number> `coalesce(sum(size),0)` }).from(assets).where(eq(assets.room, room)).get();
            if ((quota?.count || 0) >= 30 || (quota?.bytes || 0) > 400 * 1024 * 1024)
                return json({ error: 'This room has reached its file storage limit. Create a new room.' }, 413);
            const length = Number(req.headers.get('content-length') || 0);
            if (length > 40 * 1024 * 1024)
                return json({ error: 'File limit is 40 MB. Optimize the model first.' }, 413);
            const f = await req.formData();
            const file = f.get('file');
            if (!(file instanceof File) || !file.size || file.size > 40 * 1024 * 1024)
                return json({ error: 'Choose a GLB or PDF up to 40 MB.' }, 400);
            const ext = file.name.toLowerCase().split('.').pop();
            if (!['glb', 'pdf'].includes(ext!))
                return json({ error: 'Use a self-contained .glb model or .pdf document.' }, 400);
            const magic = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
            if (ext === 'glb' ? !magic.startsWith('glTF') : !magic.startsWith('%PDF-'))
                return json({ error: 'The file contents do not match its extension.' }, 400);
            const id = crypto.randomUUID();
            await bucket.put(id, file.stream());
            await db.insert(assets).values({ id, room, name: file.name.slice(0, 160), kind: ext!, size: file.size, created: now, owner: owner! });
            return json({ id });
        }
        if (path[2] === 'notes' && req.method === 'POST') {
            const recent = await db.select({ count: sql<number> `count(*)` }).from(notes).where(and(eq(notes.owner, owner!), gt(notes.created, now - 60000))).get();
            if ((recent?.count || 0) >= 30)
                return json({ error: 'Please wait a moment before adding another note.' }, 429);
            const b: any = await req.json();
            if (!valid(b.body, 1200) || !valid(b.author, 50) || !Array.isArray(b.position) || b.position.length !== 3 || !b.position.every((x: unknown) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e6))
                return json({ error: 'Enter a note (1–1,200 characters) and valid position.' }, 400);
            if (b.asset && !await db.select().from(assets).where(and(eq(assets.id, b.asset), eq(assets.room, room), isNull(assets.removedAt))).get())
                return json({ error: 'Model not found in this room' }, 400);
            const id = crypto.randomUUID();
            await db.insert(notes).values({ id, room, owner: owner!, author: b.author, body: b.body, color: ['yellow', 'mint', 'pink'].includes(b.color) ? b.color : 'yellow', position: JSON.stringify(b.position), asset: b.asset || null, created: now });
            return json({ id });
        }
        if (path[2] === 'notes' && path[3] && req.method === 'PATCH') {
            const b: any = await req.json();
            await db.update(notes).set({ resolved: b.resolved ? 1 : 0 }).where(and(eq(notes.id, path[3]), eq(notes.room, room)));
            return json({ ok: true });
        }
        if (path[2] === 'presence' && req.method === 'POST') {
            const b: any = await req.json();
            if (!valid(b.id, 60) || !valid(b.name, 50))
                return json({ error: 'Invalid participant' }, 400);
            const existing = await db.select().from(peers).where(eq(peers.id, b.id)).get();
            if (existing && existing.owner !== owner)
                return json({ error: 'Participant identity mismatch' }, 403);
            if (existing && existing.room !== room)
                await db.delete(audioPackets).where(and(eq(audioPackets.room, existing.room), eq(audioPackets.sender, b.id)));
            const pose = Array.isArray(b.pose) && b.pose.length === 3 && b.pose.every(Number.isFinite) ? JSON.stringify(b.pose) : '[0,1.6,8]';
            await db.insert(peers).values({ id: b.id, room, owner: owner!, name: b.name, pose, mic: b.mic === 2 ? 2 : b.mic ? 1 : 0, seen: now }).onConflictDoUpdate({ target: peers.id, set: { room, name: b.name, pose, mic: b.mic === 2 ? 2 : b.mic ? 1 : 0, seen: now } });
            try {
                const presenting = JSON.parse(r.presentationState || 'null');
                if (presenting?.live && presenting.presenterPeer === b.id && r.owner === owner)
                    await db.update(rooms).set({ presenterSeen: now }).where(eq(rooms.id, room));
            }
            catch { }
            const incoming = await db.select().from(signals).where(and(eq(signals.room, room), eq(signals.receiver, b.id), gt(signals.created, now - 60000)));
            // Acknowledge only after client processing; redelivery is safe using signal IDs.
            if (Array.isArray(b.ack))
                for (const id of b.ack.slice(0, 100))
                    await db.delete(signals).where(and(eq(signals.id, id), eq(signals.receiver, b.id)));
            await db.delete(signals).where(lt(signals.created, now - 120000));
            await db.delete(peers).where(lt(peers.seen, now - 120000));
            return json({ signals: incoming });
        }
        if (path[2] === 'signal' && req.method === 'POST') {
            const b: any = await req.json();
            const from = await db.select().from(peers).where(and(eq(peers.id, b.from), eq(peers.room, room), eq(peers.owner, owner!))).get();
            const to = await db.select().from(peers).where(and(eq(peers.id, b.to), eq(peers.room, room))).get();
            if (!from || !to || JSON.stringify(b.data).length > 40000)
                return json({ error: 'Invalid signal' }, 400);
            await db.insert(signals).values({ id: crypto.randomUUID(), room, sender: b.from, receiver: b.to, payload: JSON.stringify(b.data), created: now });
            return json({ ok: true });
        }
        if (path[2] === 'audio') {
            if (!owner)
                return json({ error: 'Join audio before receiving live voice.' }, 401);
            await db.delete(audioPackets).where(lt(audioPackets.created, now - 5000));
            if (req.method === 'POST') {
                const b: any = await req.json();
                const participant = await db.select().from(peers).where(and(eq(peers.id, b.from || ''), eq(peers.room, room), eq(peers.owner, owner))).get();
                if (!participant)
                    return json({ error: 'Join the room before transmitting.' }, 403);
                if (typeof b.data !== 'string' || b.data.length > 11000 || !/^[A-Za-z0-9+/]+=*$/.test(b.data) || !Number.isSafeInteger(b.seq) || b.seq < 0)
                    return json({ error: 'Invalid audio packet' }, 400);
                let length = 0;
                try {
                    length = atob(b.data).length;
                }
                catch {
                    return json({ error: 'Invalid audio encoding' }, 400);
                }
                if (length !== 8000)
                    return json({ error: 'Expected 250 ms of 16 kHz mono PCM' }, 400);
                const rate = await db.select({ count: sql<number> `count(*)` }).from(audioPackets).where(and(eq(audioPackets.sender, b.from), gt(audioPackets.created, now - 1000))).get();
                if ((rate?.count || 0) >= 6)
                    return json({ error: 'Audio sender is sending too fast' }, 429);
                await db.insert(audioPackets).values({ room, sender: b.from, seq: b.seq, data: b.data, created: now }).onConflictDoNothing();
                return json({ ok: true });
            }
            if (req.method === 'GET') {
                const id = url.searchParams.get('peer') || '';
                const participant = await db.select().from(peers).where(and(eq(peers.id, id), eq(peers.room, room), eq(peers.owner, owner))).get();
                if (!participant)
                    return json({ error: 'Join the room before receiving live voice.' }, 403);
                const cursor = Number(url.searchParams.get('after') || 0);
                if (!Number.isSafeInteger(cursor) || cursor < 0)
                    return json({ error: 'Invalid audio cursor' }, 400);
                const packets = await db.select().from(audioPackets).where(and(eq(audioPackets.room, room), gt(audioPackets.id, cursor), gt(audioPackets.created, now - 1500))).orderBy(asc(audioPackets.id)).limit(48);
                return json({ packets });
            }
            if (req.method === 'DELETE') {
                const b: any = await req.json();
                const participant = await db.select().from(peers).where(and(eq(peers.id, b.from || ''), eq(peers.room, room), eq(peers.owner, owner))).get();
                if (participant)
                    await db.delete(audioPackets).where(and(eq(audioPackets.room, room), eq(audioPackets.sender, participant.id)));
                return json({ ok: true });
            }
        }
        if (path[2] === 'leave' && req.method === 'POST') {
            const b: any = await req.json();
            const p = await db.select().from(peers).where(and(eq(peers.id, b.id), eq(peers.owner, owner!), eq(peers.room, room))).get();
            if (p) {
                await db.delete(audioPackets).where(and(eq(audioPackets.room, room), eq(audioPackets.sender, p.id)));
                await db.delete(peers).where(eq(peers.id, p.id));
            }
            return json({ ok: true });
        }
        if (path[2] === 'ice' && req.method === 'GET') {
            if (!owner)
                return json({ error: 'Join this room before starting audio.' }, 401);
            const e = process.env;
            return json({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }, ...(e.TURN_URL && e.TURN_USERNAME && e.TURN_CREDENTIAL ? [{ urls: e.TURN_URL, username: e.TURN_USERNAME, credential: e.TURN_CREDENTIAL }] : [])], relayConfigured: !!e.TURN_URL });
        }
        return json({ error: 'Unknown action' }, 404);
    }
    catch (e) {
        console.error('Pinspace API request failed');
        return json({ error: 'The workspace could not complete this action. Please try again.' }, 500);
    }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
