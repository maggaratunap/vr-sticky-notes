/* VR Sticky Notes - visuals
   Lighting, reflections, shadows and procedural materials for the hall.
   Everything is generated in the browser (no image downloads) and tuned to stay
   smooth on phones and standalone headsets:
   - image-based lighting from a small generated studio environment (reflections on
     floors, pedestals and uploaded models)
   - one soft "sun" shadow that is only re-rendered when something moves
   - canvas textures for concrete, plaster, oak, felt and fake ambient occlusion
   "Fast" graphics turns shadows off for older phones. */
(function () {
  'use strict';
  const THREE = AFRAME.THREE;

  // ---------- quality ----------
  const params = new URLSearchParams(location.search);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  let quality = params.get('quality') || store.get('vsn.gfx') || 'detailed';
  if (quality !== 'fast') quality = 'detailed';
  const isMobile = AFRAME.utils.device.isMobile() || AFRAME.utils.device.isMobileVR();

  // ---------- small helpers ----------
  function rng(seed) { // mulberry32: same textures for everyone
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function grain(g, w, h, amount, rand) {
    const d = g.getImageData(0, 0, w, h); const a = d.data;
    for (let i = 0; i < a.length; i += 4) { const n = (rand() - 0.5) * amount; a[i] += n; a[i + 1] += n; a[i + 2] += n; }
    g.putImageData(d, 0, 0);
  }
  // draw a soft blob that wraps around the edges, so textures tile seamlessly
  function blob(g, S, x, y, r, rgb, alpha) {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      const cx = x + dx, cy = y + dy;
      if (cx + r < 0 || cx - r > S || cy + r < 0 || cy - r > S) continue;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `rgba(${rgb},${alpha})`); gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  function tex(c, repeatX, repeatY, srgb) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX || 1, repeatY || 1);
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = isMobile ? 2 : 4;
    return t;
  }

  // ---------- procedural textures (cached) ----------
  const cache = {};
  const T = {
    // polished concrete, one 4 m x 4 m slab per tile with saw-cut joints
    concrete() {
      if (cache.concrete) return cache.concrete;
      const S = 1024, c = canvas(S, S), g = c.getContext('2d'), r = rng(11);
      g.fillStyle = '#cfd3d5'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 260; i++) {
        const light = r() > 0.5;
        blob(g, S, r() * S, r() * S, 40 + r() * 200, light ? '255,255,255' : '96,102,110', 0.012 + r() * 0.022);
      }
      for (let i = 0; i < 9000; i++) {
        const dark = r() > 0.35;
        g.fillStyle = dark ? `rgba(92,97,104,${0.18 + r() * 0.3})` : `rgba(255,255,255,${0.2 + r() * 0.3})`;
        const s = r() < 0.9 ? 1 : 2;
        g.fillRect(r() * S, r() * S, s, s);
      }
      grain(g, S, S, 9, r);
      g.fillStyle = 'rgba(70,76,82,0.55)'; g.fillRect(0, 0, S, 2); g.fillRect(0, 0, 2, S);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 2, S, 1); g.fillRect(2, 0, 1, S);
      return (cache.concrete = c);
    },
    // fine plaster for walls and ceiling
    plaster() {
      if (cache.plaster) return cache.plaster;
      const S = 512, c = canvas(S, S), g = c.getContext('2d'), r = rng(23);
      g.fillStyle = '#eff0ee'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 90; i++) blob(g, S, r() * S, r() * S, 30 + r() * 120, r() > 0.5 ? '255,255,255' : '150,155,160', 0.025);
      grain(g, S, S, 7, r);
      return (cache.plaster = c);
    },
    // pale oak planks for booth floors (planks run along the texture's v axis)
    oak() {
      if (cache.oak) return cache.oak;
      const S = 1024, c = canvas(S, S), g = c.getContext('2d'), r = rng(37);
      const planks = 14, pw = S / planks;
      const wrapRect = (x, y, w, h) => { for (const off of [-S, 0, S]) g.fillRect(x, y + off, w, h); };
      for (let p = 0; p < planks; p++) {
        let y = -r() * S * 0.6;
        let remaining = S;
        while (remaining > 0.5) {
          let len = Math.min(remaining, S * (0.45 + r() * 0.5));
          if (remaining - len < S * 0.2) len = remaining;
          const tone = 196 + r() * 26;
          g.fillStyle = `rgb(${tone + 22},${tone + 4},${tone - 26})`;
          wrapRect(p * pw, y, pw, len);
          for (let k = 0; k < 18; k++) { // grain
            g.strokeStyle = `rgba(120,85,45,${0.05 + r() * 0.09})`; g.lineWidth = 0.6 + r() * 1.2;
            const gx = p * pw + 2 + r() * (pw - 4);
            for (const off of [-S, 0, S]) {
              g.beginPath(); g.moveTo(gx, y + off);
              for (let t = 0; t <= 1.0001; t += 0.1) g.lineTo(gx + Math.sin(t * 6 + k) * 2.2, y + off + t * len);
              g.stroke();
            }
          }
          g.fillStyle = 'rgba(90,64,38,0.45)'; wrapRect(p * pw, y + len - 1, pw, 2);
          y += len; remaining -= len;
        }
        g.fillStyle = 'rgba(90,64,38,0.5)'; g.fillRect(p * pw, 0, 1.5, S);
      }
      grain(g, S, S, 8, r);
      return (cache.oak = c);
    },
    // grey felt for pin boards
    felt() {
      if (cache.felt) return cache.felt;
      const S = 256, c = canvas(S, S), g = c.getContext('2d'), r = rng(41);
      g.fillStyle = '#e3e6e8'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 2600; i++) {
        g.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(80,86,94,0.16)';
        const x = r() * S, y = r() * S, a = r() * Math.PI;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3); g.stroke();
      }
      grain(g, S, S, 14, r);
      return (cache.felt = c);
    },
    // booth back wall: soft falloff with three pools of light from the track lights
    boothWall() {
      if (cache.boothWall) return cache.boothWall;
      const W = 512, H = 320, c = canvas(W, H), g = c.getContext('2d');
      const v = g.createLinearGradient(0, 0, 0, H);
      v.addColorStop(0, '#f6f6f4'); v.addColorStop(1, '#dfe0de');
      g.fillStyle = v; g.fillRect(0, 0, W, H);
      return (cache.boothWall = c);
    },
    boothGlow() {
      if (cache.boothGlow) return cache.boothGlow;
      const W = 512, H = 320, c = canvas(W, H), g = c.getContext('2d');
      g.fillStyle = '#5a5a58'; g.fillRect(0, 0, W, H);
      for (const fx of [1 / 6, 1 / 2, 5 / 6]) {
        g.save(); g.translate(W * fx, 0); g.scale(1, 1.9);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.2);
        gr.addColorStop(0, 'rgba(255,248,236,0.95)'); gr.addColorStop(0.55, 'rgba(255,248,236,0.35)'); gr.addColorStop(1, 'rgba(255,248,236,0)');
        g.fillStyle = gr; g.fillRect(-W * 0.2, 0, W * 0.4, H);
        g.restore();
      }
      return (cache.boothGlow = c);
    },
    // fake ambient occlusion: dark at v=0 fading out
    aoStrip() {
      if (cache.aoStrip) return cache.aoStrip;
      const c = canvas(4, 128), g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, 'rgba(20,24,30,0.42)'); gr.addColorStop(0.35, 'rgba(20,24,30,0.16)'); gr.addColorStop(1, 'rgba(20,24,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
      return (cache.aoStrip = c);
    },
    // soft round contact shadow
    contact() {
      if (cache.contact) return cache.contact;
      const S = 256, c = canvas(S, S), g = c.getContext('2d');
      const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
      gr.addColorStop(0, 'rgba(20,24,30,0.45)'); gr.addColorStop(1, 'rgba(20,24,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      return (cache.contact = c);
    },
    // ceiling cut-outs for skylights (white = solid, black = open)
    ceilingAlpha(openings, half) {
      const S = 512, c = canvas(S, S), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
      g.fillStyle = '#000';
      const px = (m) => ((m + half) / (half * 2)) * S;
      for (const o of openings) g.fillRect(px(o.x0), S - px(o.z1), px(o.x1) - px(o.x0), px(o.z1) - px(o.z0));
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace;
      return t;
    }
  };

  // ---------- materials ----------
  function std(opts) { return new THREE.MeshStandardMaterial(opts); }
  const decalCache = new Map();
  function decal(canvasEl, opacity) {
    const key = canvasEl.width + 'x' + canvasEl.height + ':' + (canvasEl.__id || (canvasEl.__id = Math.random().toString(36).slice(2))) + ':' + opacity;
    if (decalCache.has(key)) return decalCache.get(key);
    const m = new THREE.MeshBasicMaterial({
      map: tex(canvasEl), transparent: true, depthWrite: false, toneMapped: false, opacity: opacity == null ? 1 : opacity,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    decalCache.set(key, m);
    return m;
  }

  // Merge every static mesh under a group into one mesh per material, so the whole hall
  // draws in a dozen calls instead of a hundred or more (matters most on standalone headsets).
  function mergeStatic(group) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const buckets = new Map();
    const parts = [];
    group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry && o.geometry.attributes.position) parts.push(o); });
    for (const o of parts) {
      const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0);
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, list: [] });
      buckets.get(key).list.push({ g: o.geometry, m: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
      o.parent.remove(o);
    }
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    for (const b of buckets.values()) {
      let verts = 0, idx = 0;
      for (const p of b.list) { verts += p.g.attributes.position.count; idx += p.g.index ? p.g.index.count : p.g.attributes.position.count; }
      const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
      const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
      let vo = 0, io = 0;
      for (const p of b.list) {
        const P = p.g.attributes.position, N = p.g.attributes.normal, U = p.g.attributes.uv;
        nm.getNormalMatrix(p.m);
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(p.m); pos.set([v.x, v.y, v.z], (vo + i) * 3);
          if (N) { n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([n.x, n.y, n.z], (vo + i) * 3); }
          if (U) uv.set([U.getX(i), U.getY(i)], (vo + i) * 2);
        }
        if (p.g.index) { const a = p.g.index.array; for (let i = 0; i < a.length; i++) index[io++] = a[i] + vo; }
        else for (let i = 0; i < P.count; i++) index[io++] = vo + i;
        vo += P.count;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      if (b.mat.transparent) mesh.renderOrder = 1;
      group.add(mesh);
    }
    // drop the now-empty helper groups
    [...group.children].forEach((c) => { if (c.isGroup && c.children.length === 0) group.remove(c); });
    refreshShadows();
  }

  // ---------- environment lighting ----------
  // A tiny studio: grey room, a big soft skylight, two side strips and a warm floor bounce.
  function buildEnvironment(renderer) {
    const env = new THREE.Scene();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color('#a9adb1'), side: THREE.BackSide }));
    room.scale.set(30, 10, 30); room.position.y = 5; env.add(room);
    const glow = (hex, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
    const panel = (mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(box, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); env.add(m); };
    panel(glow('#f2f6fb', 4.5), 0, 9.9, 0, 10, 0.1, 22);     // skylight
    panel(glow('#ffffff', 3.5), -14.9, 5, 0, 0.1, 3, 18);     // side strips
    panel(glow('#ffffff', 3.5), 14.9, 5, 0, 0.1, 3, 18);
    panel(glow('#fff1df', 1.6), 0, 0.05, 0, 24, 0.1, 24);     // floor bounce
    panel(glow('#ffffff', 2.2), 0, 5, -14.9, 14, 4, 0.1);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(env, 0.035);
    pm.dispose();
    env.traverse((o) => { if (o.material) o.material.dispose(); });
    box.dispose();
    return rt.texture;
  }

  // ---------- setup ----------
  let sun = null;
  let sceneEl = null;
  let envTex = null;
  function setup(scene) {
    sceneEl = scene;
    const renderer = scene.renderer;
    renderer.toneMapping = THREE.NeutralToneMapping || THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 2 : 1.75));
    try {
      envTex = buildEnvironment(renderer);
      scene.object3D.environment = envTex;
      if ('environmentIntensity' in scene.object3D) scene.object3D.environmentIntensity = 0.5;
    } catch (e) { console.warn('environment lighting unavailable', e); }

    // the "sun": a soft key light from high up, casting the only real-time shadows
    sun = new THREE.DirectionalLight(0xfffaf2, 1.15);
    sun.position.set(-7, 16, 6);
    sun.target.position.set(0, 0, 0);
    const sm = isMobile ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 2, far: 40 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.object3D.add(sun);
    scene.object3D.add(sun.target);
    renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.shadow.radius = 3;
    renderer.shadowMap.autoUpdate = false;
    applyQuality();
  }

  function applyQuality() {
    if (!sceneEl || !sun) return;
    const on = quality === 'detailed';
    const r = sceneEl.renderer;
    r.shadowMap.enabled = on;
    sun.castShadow = on;
    // Fast: no reflections either; brighter sky fill makes up for the missing bounce light
    sceneEl.object3D.environment = on ? envTex : null;
    const hemi = document.querySelector('[light]');
    if (hemi && hemi.getAttribute('light').type === 'hemisphere') hemi.setAttribute('light', 'intensity', on ? 0.5 : 1.15);
    sceneEl.object3D.traverse((o) => {
      const m = o.material;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((mm) => { mm.needsUpdate = true; });
    });
    refreshShadows();
  }

  // The shadow map is only redrawn when something changes (cheap on headsets).
  let shadowTimer = null;
  function refreshShadows() {
    if (!sceneEl || !sceneEl.renderer) return;
    sceneEl.renderer.shadowMap.needsUpdate = true;
    clearTimeout(shadowTimer);
    shadowTimer = setTimeout(() => { if (sceneEl.renderer) sceneEl.renderer.shadowMap.needsUpdate = true; }, 400);
  }

  // Make everything under an object cast and/or receive the sun's shadow.
  function shadows(obj3d, cast, receive) {
    obj3d.traverse((o) => { if (o.isMesh) { o.castShadow = !!cast; o.receiveShadow = !!receive; } });
    refreshShadows();
  }

  // Keep UI and documents exactly the colours they were drawn with (no tone mapping).
  function untoned(el) {
    const apply = () => {
      const mesh = el.getObject3D('mesh');
      if (!mesh) return false;
      mesh.traverse((o) => {
        if (!o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.toneMapped = false; m.needsUpdate = true; });
      });
      return true;
    };
    if (!apply()) el.addEventListener('object3dset', apply);
  }

  function setQuality(q) {
    quality = q === 'fast' ? 'fast' : 'detailed';
    store.set('vsn.gfx', quality);
    applyQuality();
  }

  window.VSNLook = {
    THREE, T, tex, std, decal, mergeStatic, setup, refreshShadows, shadows, untoned, setQuality,
    get quality() { return quality; }, isMobile
  };
})();
