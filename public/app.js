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
    me.color = store.get('vsn.color');
    if (!config.userColors.includes(me.color)) me.color = config.userColors[Math.floor(Math.random() * config.userColors.length)];
    swatches($('#userColors'), config.userColors, me.color, (c) => { me.color = c; });

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
    store.set('vsn.color', me.color);
    ROOM = selectedRoom.slug;
    const u = new URL(location.href); u.searchParams.set('room', ROOM); history.replaceState(null, '', u);
    unlockAudio();
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
    connect();
    startPoseLoop();
    if (DEVICE === 'phone') toast('Tap the floor to walk. Tap a board, model or PDF to leave a note.', 4200);
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
      send({ type: 'hello', name: me.name, color: me.color, device: DEVICE, muted: me.muted, key: KEY, admin: ADMIN || undefined });
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
  function addPeer(info) {
    if (peers.has(info.id)) { updatePeer(info); return; }
    const root = el('a-entity', { 'avatar-lerp': '' }, $('#avatars'));
    root.object3D.position.fromArray(info.p || [0, 1.6, 0]);
    const head = el('a-entity', { class: 'av-head' }, root);
    const sphere = el('a-sphere', { class: 'av-color', radius: 0.16 }, head);
    sphere.setAttribute('material', { color: info.color, roughness: 0.6 });
    const visor = el('a-box', { width: 0.22, height: 0.08, depth: 0.06, position: '0 0.02 -0.14' }, head);
    visor.setAttribute('material', { color: '#1b1f27', roughness: 0.3 });
    const body = el('a-entity', { class: 'av-body' }, root);
    const cyl = el('a-cylinder', { class: 'av-color', radius: 0.17, height: 0.62, position: '0 -0.55 0' }, body);
    cyl.setAttribute('material', { color: info.color, roughness: 0.8 });
    const tag = el('a-entity', { billboard: '', position: '0 0.36 0' }, root);
    const bg = el('a-plane', { class: 'av-tagbg', width: 0.6, height: 0.11 }, tag);
    bg.setAttribute('material', { color: '#1b1f27', shader: 'flat', opacity: 0.8, transparent: true });
    const name = el('a-entity', { class: 'av-name', position: '0 0 0.002' }, tag);
    name.setAttribute('text', { value: '', align: 'center', color: '#ffffff', width: 0.9, wrapCount: 22 });
    const ring = el('a-ring', { class: 'av-ring', 'radius-inner': 0.2, 'radius-outer': 0.235, visible: false, billboard: '' }, root);
    ring.setAttribute('material', { color: '#3bd17a', shader: 'flat', side: 'double' });
    peers.set(info.id, { info: { ...info }, el: root, pc: null, transceiver: null, pending: [], audio: null });
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
    p.el.querySelectorAll('.av-color').forEach((e) => e.setAttribute('material', 'color', p.info.color));
    const label = font3d(p.info.name + (p.info.muted ? '  (muted)' : ''));
    p.el.querySelector('.av-name').setAttribute('text', { value: label });
    p.el.querySelector('.av-tagbg').setAttribute('width', Math.max(0.3, label.length * 0.034 + 0.08));
    if (p.info.muted) p.el.querySelector('.av-ring').setAttribute('visible', false);
    refreshPanel('people');
  }

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

  // Arrive in the centre aisle behind the benches, facing the stage. The spot is slightly random
  // so people joining together don't stand inside each other.
  function placeAtSpawn() {
    const rig = $('#rig').object3D;
    rig.position.set(+(Math.random() * 1.6 - 0.8).toFixed(2), 0, +(7 + Math.random() * 1.5).toFixed(2));
    rig.rotation.set(0, 0, 0);
  }

  // ---------------- the stage ----------------
  // Stage top is 0.5 m high, 14 m wide, from z = -10 to -5.2. Uploads go here, facing the audience.
  const STAGE = { y: 0.5, front: -5.2, back: -10, half: 7 };
  function isOnStage(d) {
    return d && Math.abs(d.p[1] - STAGE.y) < 0.05 && d.p[2] < STAGE.front && d.p[2] > STAGE.back && Math.abs(d.p[0]) < STAGE.half;
  }
  // Find a free spot on stage. PDFs stand left and right of centre; models take the middle first.
  function stageSpot(kind, excludeId) {
    const slots = kind === 'model' ? [0, -4.3, 4.3] : [-4.3, 4.3, 0, -2.2, 2.2];
    const taken = [...items.values()].filter((r) => r.data.id !== excludeId && isOnStage(r.data));
    for (const x of slots) {
      if (!taken.some((r) => Math.abs(r.data.p[0] - x) < 1.9)) {
        return { p: [x, STAGE.y, kind === 'model' ? -7.4 : -8.3], ry: 0, s: kind === 'pdf' ? 1.8 : undefined };
      }
    }
    return null;
  }
  function putOnStage(id) {
    const rec = items.get(id);
    if (!rec) return;
    const spot = stageSpot(rec.data.kind, id);
    if (!spot) return toast('The stage is full. Move or delete something on it first.', 3500);
    const patch = { p: spot.p, ry: spot.ry };
    if (spot.s && (rec.data.s || 1) < spot.s) patch.s = spot.s;
    if (rec.data.kind === 'model' && rec.size) {
      const maxDim = Math.max(rec.size.x, rec.size.z) * (rec.data.s || 1);
      if (maxDim > 5) patch.s = +(4.5 / Math.max(rec.size.x, rec.size.z)).toPrecision(4);
    }
    itemPatch(id, patch);
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
    refreshPanel('objects');
  }

  function applyItemTransform(rec) {
    const d = rec.data;
    rec.root.object3D.position.fromArray(d.p);
    rec.root.object3D.rotation.set(0, THREE.MathUtils.degToRad(d.ry || 0), 0);
    rec.inner.object3D.scale.setScalar(d.s || 1);
    for (const n of notes.values()) if (n.data.on === d.id) n.el.object3D.scale.setScalar(1 / (d.s || 1));
  }

  function updateItem(patch) {
    const rec = items.get(patch.id);
    if (!rec) return;
    const pageChanged = patch.page != null && patch.page !== rec.data.page;
    Object.assign(rec.data, patch);
    applyItemTransform(rec);
    if (rec.data.kind === 'pdf' && pageChanged) { showPdfPage(rec); updatePdfNoteVisibility(rec); }
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
    refreshPanel('objects');
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
    refreshRaycasters();

    if (justUploaded.has(rec.data.id)) {
      justUploaded.delete(rec.data.id);
      const maxDim = Math.max(rec.size.x, rec.size.y, rec.size.z);
      const footprint = Math.max(rec.size.x, rec.size.z);
      if (isOnStage(rec.data) && footprint > 5) {
        send({ type: 'item-update', id: rec.data.id, s: +(4.5 / footprint).toPrecision(4) });
        toast('Model resized to fit on the stage. Use "1:1" in Objects for real size.', 6000);
      } else if (maxDim > 18 || maxDim < 0.3) {
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
    panel.addEventListener('click', (e) => onSurfaceClick(e, it.id));
    const back = el('a-box', { class: 'pdf-back', width: PDF_W + 0.06, height: h + 0.06, depth: 0.03, position: `0 ${PDF_BASE + h / 2} -0.02` }, rec.inner);
    back.setAttribute('material', { color: '#2b2f38', roughness: 0.8 });
    const stand = el('a-box', { class: 'pdf-stand', width: 0.06, height: PDF_BASE, depth: 0.06, position: `0 ${PDF_BASE / 2} -0.05` }, rec.inner);
    stand.setAttribute('material', { color: '#2b2f38' });
    el('a-cylinder', { radius: 0.28, height: 0.02, position: '0 0.01 -0.05', color: '#2b2f38' }, rec.inner);
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
      b.setAttribute('material', { color: '#2b2f38', roughness: 0.6 });
    };
    frame(0.12, 2.36, 0.14, -0.66, 1.18);
    frame(0.12, 2.36, 0.14, 0.66, 1.18);
    frame(1.44, 0.14, 0.14, 0, 2.35);
    const door = el('a-plane', { class: 'clickable item-surface portal-surface', width: 1.2, height: 2.24, position: '0 1.12 0' }, rec.inner);
    door.setAttribute('material', { shader: 'flat', color: '#4fb3f6', opacity: 0.78, transparent: true, side: 'double' });
    door.setAttribute('animation__glow', { property: 'material.opacity', from: 0.62, to: 0.9, dur: 1400, dir: 'alternate', loop: true, easing: 'easeInOutSine' });
    door.addEventListener('mouseenter', () => door.setAttribute('material', 'color', '#86ccff'));
    door.addEventListener('mouseleave', () => door.setAttribute('material', 'color', '#4fb3f6'));
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
      if (justUploaded.has(rec.data.id)) { justUploaded.delete(rec.data.id); toast(`"${itemTitle(rec.data)}" is ready (${rec.pages} page${rec.pages > 1 ? 's' : ''}).`); }
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
  function openUpload() {
    uploadFile = null;
    $('#uploadForm').reset();
    $('#dropZone').classList.remove('has-file');
    $('#dropLabel').innerHTML = '<b>Choose a file</b><br><span class="fine">.glb, .gltf, .obj (3D models) or .pdf</span>';
    $('#uploadMsg').textContent = `Max ${config.maxModelMB} MB for models, ${config.maxPdfMB} MB for PDFs. Everyone in the room will see it.`;
    $('#uploadProgress').hidden = true;
    $('#uploadGo').disabled = true;
    openSheet('#upload');
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
    const limit = (isPdf ? config.maxPdfMB : config.maxModelMB) * 1048576;
    if (f.size > limit) { $('#uploadMsg').textContent = `This file is ${fmtMB(f.size)}. The limit is ${fmtMB(limit)}.`; return; }
    uploadFile = f;
    $('#dropZone').classList.add('has-file');
    $('#dropLabel').innerHTML = '';
    const b = el('b', {}, $('#dropLabel')); b.textContent = f.name;
    el('br', {}, $('#dropLabel'));
    el('span', { class: 'fine' }, $('#dropLabel')).textContent = `${isPdf ? 'PDF document' : '3D model'} · ${fmtMB(f.size)} · tap to change`;
    $('#uploadMsg').textContent = f.size > 30 * 1048576 && !isPdf ? 'Large model: it may load slowly on phones and headsets.' : '';
    $('#uploadGo').disabled = false;
  });
  $('#uploadForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!uploadFile || uploadXhr) return;
    const isPdf = uploadFile.name.toLowerCase().endsWith('.pdf');
    const spot = stageSpot(isPdf ? 'pdf' : 'model');
    const f = spot || viewerFrame(isPdf ? 2.4 : 3);
    const q = new URLSearchParams({ name: uploadFile.name, p: f.p.join(','), ry: String(f.ry) });
    if (spot && spot.s) q.set('s', String(spot.s));
    const xhr = new XMLHttpRequest();
    uploadXhr = xhr;
    xhr.open('POST', `/api/rooms/${encodeURIComponent(ROOM)}/upload?${q}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Client-Key', KEY);
    xhr.setRequestHeader('X-Client-Name', encodeURIComponent(me.name));
    $('#uploadProgress').hidden = false;
    $('#uploadGo').disabled = true;
    const bar = $('#uploadProgress div');
    bar.style.width = '0%';
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) { bar.style.width = `${Math.round(ev.loaded / ev.total * 100)}%`; $('#uploadMsg').textContent = `Uploading... ${Math.round(ev.loaded / ev.total * 100)}%`; } };
    xhr.onload = () => {
      uploadXhr = null;
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (err) { /* ignore */ }
      if (xhr.status === 201 && data.item) {
        justUploaded.add(data.item.id);
        addItem(data.item);
        closeSheet('#upload');
        toast(isOnStage(data.item) ? `Uploaded. "${data.item.name}" is going on the stage...` : `Uploaded. Loading "${data.item.name}" in front of you...`);
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
    startNoteAt(place, itemId);
  }

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

  function openSheet(sel) { $(sel).hidden = false; }
  function closeSheet(sel, keepGhost) {
    $(sel).hidden = true;
    if (sel === '#composer' && !keepGhost) hideGhost();
    if (sel === '#detail') openNoteId = null;
    if (sel === '#panel') $('#panel').dataset.kind = '';
    if (sel === '#upload' && uploadXhr) { uploadXhr.abort(); uploadXhr = null; }
  }
  document.querySelectorAll('.sheet-wrap').forEach((w) => {
    w.addEventListener('click', (e) => { if (e.target === w || e.target.closest('[data-close]')) closeSheet('#' + w.id); });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ['#composer', '#detail', '#panel', '#upload'].forEach((s) => { if (!$(s).hidden) closeSheet(s); });
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
      row(me.name + ' (you)', me.color, `${DEVICE} · ${me.muted ? 'muted' : 'mic on'}`);
      for (const p of peers.values()) row(p.info.name, p.info.color, `${p.info.device} · ${p.info.muted ? 'muted' : 'mic on'}`);
      el('p', { class: 'fine' }, body).textContent = `${notes.size} sticky note${notes.size === 1 ? '' : 's'} and ${items.size} object${items.size === 1 ? '' : 's'} in this room.`;
      const actions = el('div', { class: 'actions' }, body);
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
        el('p', { class: 'empty' }, body).textContent = 'Nothing uploaded yet. Add a 3D model (.glb, .gltf, .obj) or a PDF and everyone here will see it.';
      }
      const ul = el('ul', { class: 'objs' }, body);
      for (const rec of items.values()) {
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
        el('span', { class: 'meta' }, head).textContent = d.author;
        el('div', { class: 'meta' }, li).textContent = d.kind === 'portal' ? info : `${info} · ${fmtMB(d.size || 0)}`;
        const tools = el('div', { class: 'tools' }, li);
        const tool = (label, fn, cls, aria) => { const b = el('button', { type: 'button', class: cls || '', 'aria-label': aria || label }, tools); b.textContent = label; b.onclick = fn; return b; };
        if (d.kind === 'portal') tool('Enter room', () => enterPortal(d.id));
        tool('Go to', () => { closeSheet('#panel'); goTo(d.id); });
        tool('Bring here', () => { bringHere(d.id); });
        if (d.kind !== 'portal' && !isOnStage(d)) tool('Put on stage', () => putOnStage(d.id));
        tool('Turn left', () => itemPatch(d.id, { ry: ((d.ry || 0) + 15) % 360 }));
        tool('Turn right', () => itemPatch(d.id, { ry: ((d.ry || 0) + 345) % 360 }));
        tool('Smaller', () => itemPatch(d.id, { s: +((d.s || 1) / 1.25).toPrecision(5) }));
        tool('Bigger', () => itemPatch(d.id, { s: +((d.s || 1) * 1.25).toPrecision(5) }));
        if (d.kind === 'model') {
          tool('1:1', () => itemPatch(d.id, { s: 1 }), '', 'Real scale');
          tool('Fit 6 m', () => { if (rec.size) itemPatch(d.id, { s: +(6 / Math.max(rec.size.x, rec.size.y, rec.size.z)).toPrecision(4) }); }, '', 'Fit to 6 metres');
        } else if (d.kind === 'pdf') {
          tool('Prev page', () => turnPage(d.id, -1));
          tool('Next page', () => turnPage(d.id, 1));
        }
        if (d.mine || me.isAdmin) tool('Delete', () => deleteItem(d.id), 'danger');
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
        <h4>Move</h4><p>Phone: tap the floor to walk, drag or turn your phone to look. Computer: WASD or arrow keys, drag to look, Q / E to turn. Headset: left stick walks, right stick turns, or point at the floor and pull the trigger.</p>
        <h4>Talk</h4><p>Use the mic button (or A / X on a Quest controller). Voices are louder when people stand closer. A green ring shows who is talking.</p>
        <h4>Fly</h4><p>Press <b>Fly</b> to float freely: you move in the direction you look, including up and down. Computer: WASD, Space to rise, Shift to sink, F to toggle. Phone: tap the sky to fly toward it, hold the arrow buttons to rise or sink. Headset: left stick flies where you look, right stick up / down rises and sinks, B or Y toggles. Cardboard: turn Fly on before entering VR, then aim at the sky and press the button. Tap or aim at the floor to land; turning Fly off brings you down.</p>
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
    const base = opts.color || '#3a4252';
    const b = el('a-entity', { class: 'clickable', position: `${x} ${y} 0.004` }, parent);
    b.setAttribute('geometry', { primitive: 'plane', width: w, height: h });
    b.setAttribute('material', { color: base, shader: 'flat' });
    const tw = w * 0.88;
    const charSize = Math.min(opts.charSize || 0.028, h * 0.55);
    const wrap = Math.max(String(label).length + 1, Math.round(tw / charSize), 2);
    b.setAttribute('text', { value: label, align: 'center', anchor: 'center', baseline: 'center', color: opts.textColor || '#ffffff', width: tw, wrapCount: wrap, zOffset: 0.002 });
    b.addEventListener('mouseenter', () => b.setAttribute('material', 'color', opts.hover || '#5c6880'));
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
    bg.setAttribute('material', { color: '#1b1f27', shader: 'flat', opacity: 0.95, transparent: true });
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
    }, { color: '#2c3a33', hover: '#3f5a4a', charSize: 0.02 }));

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
    vrButton(root, 'Delete', 0.3725, by, 0.195, KEY, () => { text = text.slice(0, -1); showText(); }, { color: '#5a3a3a', hover: '#7a4a4a', charSize: 0.028 });

    const cy = by - 0.105;
    config.noteColors.forEach((c, i) => vrButton(root, '', -0.44 + i * 0.07, cy, 0.06, 0.06, () => { color = c; showText(); }, { color: c, hover: c }));
    vrButton(root, 'Cancel', 0.08, cy, 0.17, 0.075, () => closeVrKeyboard(), { charSize: 0.028 });
    vrButton(root, 'Post', 0.33, cy, 0.24, 0.075, () => { closeVrKeyboard(true); submitNote(opts, text, color); }, { color: '#f2b705', hover: '#ffd24a', textColor: '#1b1f27', charSize: 0.034 });

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
    bg.setAttribute('material', { color: '#1b1f27', shader: 'flat', opacity: 0.95, transparent: true });
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
    else if (DEVICE === 'phone') msg = 'Flying: tap the sky to fly toward it, hold the arrows to rise or sink, tap the floor to land.';
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

  // Flying on a phone or computer: tap or click empty sky to fly toward it.
  const skyRay = new THREE.Raycaster();
  function onSkyTap(e) {
    if (!flying || !joined || dragged || scene.is('vr-mode')) return;
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
    const useGaze = DEVICE === 'phone';
    setGazeMode(useGaze);
    setHandRays(!useGaze);
    ['#composer', '#detail', '#panel', '#upload'].forEach((s) => { if (!$(s).hidden) closeSheet(s); });
    if (useGaze) vrToast('Aim the ring and press the Cardboard button', 3500);
    else vrToast(me.muted ? 'Mic off - press A or X to talk' : 'Mic on', 2500);
  });
  scene.addEventListener('exit-vr', () => {
    setGazeMode(false);
    setHandRays(false);
    closeVrKeyboard(); closeVrPanel();
  });

  // ---------------- scene wiring ----------------
  function wireScene() {
    document.querySelectorAll('.pinnable').forEach((n) => n.addEventListener('click', (e) => onSurfaceClick(e, null)));
    // Floor, steps and stage: tap / click / aim there to walk to that spot (and onto the stage).
    document.querySelectorAll('.floor').forEach((f) => f.addEventListener('click', (e) => {
      if (fromDrag(e)) return;
      const hit = e.detail && e.detail.intersection;
      if (hit) $('#rig').components['rig-move'].glideTo(hit.point.x, hit.point.z, hit.point.y);
    }));
    buildSeating();
  }

  // Audience benches: 4 rows on each side of a centre aisle, facing the stage.
  function buildSeating() {
    const root = $('#seating');
    if (!root || root.children.length) return;
    for (const z of [-2.6, -0.6, 1.4, 3.4]) {
      for (const x of [-3.7, 3.7]) {
        const seat = el('a-box', { position: `${x} 0.22 ${z}`, width: 5, height: 0.44, depth: 0.55 }, root);
        seat.setAttribute('material', { color: '#2f3a4a', roughness: 0.9 });
        const back = el('a-box', { position: `${x} 0.72 ${z + 0.26}`, width: 5, height: 0.56, depth: 0.08 }, root);
        back.setAttribute('material', { color: '#243041', roughness: 0.9 });
      }
    }
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
