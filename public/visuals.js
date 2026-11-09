/* VR Sticky Notes - visuals
   Lighting, reflections, shadows and procedural materials for the hall.
   Everything is generated in the browser (no image downloads) and tuned to stay
   smooth on phones and standalone headsets:
   - image-based lighting from a small generated studio environment (reflections on
     floors, pedestals and uploaded models)
   - one soft "sun" shadow that is only re-rendered when something moves
   - canvas textures for shop concrete, concrete block, translucent wall panels, roof deck,
     ducts, oak, felt and fake ambient occlusion
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
    // ---- Kemper Hall high bay ----
    // sealed shop concrete, warm and mottled, one 6 m x 6 m pour per tile with saw-cut joints
    shopConcrete() {
      if (cache.shopConcrete) return cache.shopConcrete;
      const S = 1024, c = canvas(S, S), g = c.getContext('2d'), r = rng(53);
      g.fillStyle = '#c2b8a7'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 340; i++) {
        const k = r();
        blob(g, S, r() * S, r() * S, 30 + r() * 230, k > 0.55 ? '232,226,214' : k > 0.2 ? '158,146,126' : '128,116,98', 0.025 + r() * 0.05);
      }
      for (let i = 0; i < 160; i++) { // faint trowel marks
        g.strokeStyle = `rgba(255,250,240,${0.025 + r() * 0.05})`; g.lineWidth = 1 + r() * 2;
        const x = 60 + r() * (S - 120), y = 60 + r() * (S - 120), rad = 25 + r() * 60, a = r() * 6.28;
        g.beginPath(); g.arc(x, y, rad, a, a + 0.5 + r() * 0.9); g.stroke();
      }
      for (let i = 0; i < 8000; i++) {
        g.fillStyle = r() > 0.5 ? `rgba(92,84,72,${0.12 + r() * 0.25})` : `rgba(255,252,244,${0.12 + r() * 0.25})`;
        g.fillRect(r() * S, r() * S, 1, 1);
      }
      grain(g, S, S, 7, r);
      g.fillStyle = 'rgba(78,70,58,0.6)'; g.fillRect(0, 0, S, 2); g.fillRect(0, 0, 2, S);
      g.fillStyle = 'rgba(255,250,240,0.25)'; g.fillRect(0, 2, S, 1); g.fillRect(2, 0, 1, S);
      return (cache.shopConcrete = c);
    },
    // light grey ground-face concrete block, running bond: 3.2 m x 3.2 m per tile (8 x 16 blocks)
    cmu() {
      if (cache.cmu) return cache.cmu;
      const S = 1024, c = canvas(S, S), g = c.getContext('2d'), r = rng(61);
      g.fillStyle = '#b9b8b2'; g.fillRect(0, 0, S, S);
      const bw = 128, bh = 64, m = 4;
      for (let row = 0; row < 16; row++) {
        const off = row % 2 ? bw / 2 : 0;
        const tones = Array.from({ length: 8 }, () => 210 + r() * 16);
        for (let k = -1; k < 8; k++) {
          const t = tones[(k + 8) % 8];
          g.fillStyle = `rgb(${t | 0},${t | 0},${(t - 5) | 0})`;
          g.fillRect(k * bw + off + m / 2, row * bh + m / 2, bw - m, bh - m);
          g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(k * bw + off + m / 2, row * bh + m / 2, bw - m, 1.5);
        }
      }
      for (let i = 0; i < 30000; i++) {
        g.fillStyle = r() > 0.5 ? `rgba(118,116,108,${0.12 + r() * 0.22})` : `rgba(255,255,250,${0.15 + r() * 0.2})`;
        g.fillRect(r() * S, r() * S, r() > 0.85 ? 2 : 1, 1);
      }
      grain(g, S, S, 6, r);
      return (cache.cmu = c);
    },
    // translucent insulated wall panels (daylight glows through): 2.4 m x 2.4 m per tile
    polycarb() {
      if (cache.polycarb) return cache.polycarb;
      const S = 512, c = canvas(S, S), g = c.getContext('2d'), r = rng(67);
      g.fillStyle = '#e6ecef'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 40; i++) blob(g, S, r() * S, r() * S, 60 + r() * 160, '255,255,255', 0.1);
      for (let x = 0; x < S; x += 6) { g.fillStyle = 'rgba(160,176,188,0.16)'; g.fillRect(x, 0, 1, S); }
      g.fillStyle = 'rgba(150,160,168,0.85)'; g.fillRect(0, 0, 5, S); g.fillRect(S / 2, 0, 5, S);
      g.fillStyle = 'rgba(128,136,142,0.5)'; g.fillRect(0, S - 8, S, 8);
      return (cache.polycarb = c);
    },
    // bar joist web (zig-zag diagonals between the chords): one 1.2 m panel per tile, white on clear
    trussWeb() {
      if (cache.trussWeb) return cache.trussWeb;
      const W = 128, H = 84, c = canvas(W, H), g = c.getContext('2d');
      g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.lineCap = 'butt';
      g.beginPath(); g.moveTo(-W / 2, 0); g.lineTo(0, H); g.lineTo(W / 2, 0); g.lineTo(W, H); g.lineTo(W * 1.5, 0); g.stroke();
      return (cache.trussWeb = c);
    },
    // corrugated metal roof deck seen from below: one 0.3 m flute per tile
    deck() {
      if (cache.deck) return cache.deck;
      const c = canvas(64, 8), g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 64, 0);
      gr.addColorStop(0, '#f0f1f1'); gr.addColorStop(0.3, '#f6f7f7'); gr.addColorStop(0.45, '#c9cdd1');
      gr.addColorStop(0.55, '#c9cdd1'); gr.addColorStop(0.7, '#e7e9ea'); gr.addColorStop(1, '#f0f1f1');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 8);
      return (cache.deck = c);
    },
    // light blue spiral duct: one turn of the seam per 1.2 m
    duct() {
      if (cache.duct) return cache.duct;
      const S = 128, c = canvas(S, S), g = c.getContext('2d');
      g.fillStyle = '#b7d2e3'; g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(70,100,125,0.55)'; g.lineWidth = 3;
      for (const o of [-S, 0, S]) { g.beginPath(); g.moveTo(o, 0); g.lineTo(o + S, S); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1.5;
      for (const o of [-S, 0, S]) { g.beginPath(); g.moveTo(o + 4, 0); g.lineTo(o + S + 4, S); g.stroke(); }
      return (cache.duct = c);
    },
    // sectional overhead garage door, 10 m x 7.6 m, with a row of windows
    garageDoor() {
      if (cache.garageDoor) return cache.garageDoor;
      const W = 640, H = 486, c = canvas(W, H), g = c.getContext('2d'), r = rng(71);
      const n = 13, sh = H / n;
      for (let i = 0; i < n; i++) {
        const y = i * sh;
        g.fillStyle = '#d4d7da'; g.fillRect(0, y, W, sh);
        for (const f of [0.33, 0.66]) {
          g.fillStyle = 'rgba(120,128,136,0.35)'; g.fillRect(0, y + sh * f, W, 1.5);
          g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(0, y + sh * f + 1.5, W, 1);
        }
        g.fillStyle = 'rgba(70,76,84,0.75)'; g.fillRect(0, y + sh - 2, W, 2);
        if (i === 3) { // windows
          const ww = W / 10;
          for (let k = 0; k < 10; k++) {
            const x0 = k * ww + 10, y0 = y + 6, w = ww - 20, h = sh - 13;
            const gr = g.createLinearGradient(0, y0, 0, y0 + h);
            gr.addColorStop(0, '#dcebf6'); gr.addColorStop(0.6, '#b9d3e6'); gr.addColorStop(1, '#8fae8a');
            g.fillStyle = '#3d434a'; g.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
            g.fillStyle = gr; g.fillRect(x0, y0, w, h);
          }
        }
      }
      g.fillStyle = '#23272c'; g.fillRect(0, H - 5, W, 5);
      grain(g, W, H, 5, r);
      return (cache.garageDoor = c);
    },
    // the lit lab behind the mezzanine window
    labWindow() {
      if (cache.labWindow) return cache.labWindow;
      const W = 1024, H = 256, c = canvas(W, H), g = c.getContext('2d'), r = rng(73);
      const poly = (pts, fill) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
      const hz = H * 0.5, bx0 = W * 0.2, bx1 = W * 0.8, by1 = H * 0.8;
      poly([[0, 0], [W, 0], [bx1, hz], [bx0, hz]], '#c9ced4');           // ceiling
      poly([[0, 0], [bx0, hz], [bx0, by1], [0, H]], '#9da4ad');            // side walls
      poly([[W, 0], [bx1, hz], [bx1, by1], [W, H]], '#9da4ad');
      poly([[bx0, hz], [bx1, hz], [bx1, by1], [bx0, by1]], '#b4bac1');    // back wall
      poly([[0, H], [bx0, by1], [bx1, by1], [W, H]], '#6f747a');           // floor
      for (let k = 0; k < 6; k++) {                                        // rows of linear lights
        const t = k / 6, e = Math.pow(t, 0.75);
        const y = e * hz * 0.94 + 6, half = (W / 2) * (1 - e * 0.6), th = 10 - e * 7;
        for (const f of [-0.6, 0, 0.6]) {
          const cx = W / 2 + f * half, len = half * 0.42;
          g.fillStyle = '#ffffff'; g.fillRect(cx - len / 2, y, len, th);
        }
      }
      for (let k = 0; k < 7; k++) {                                        // benches and screens
        const x = 60 + k * 140 + r() * 30;
        g.fillStyle = '#3c4148'; g.fillRect(x, H * 0.8, 110, 9);
        g.fillStyle = '#23272d'; g.fillRect(x + 20 + r() * 40, H * 0.8 - 30, 44, 28);
      }
      const gl = g.createLinearGradient(0, 0, W, H);                      // glass sheen
      gl.addColorStop(0.2, 'rgba(255,255,255,0)'); gl.addColorStop(0.35, 'rgba(255,255,255,0.12)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.fillStyle = gl; g.fillRect(0, 0, W, H);
      return (cache.labWindow = c);
    },
    // aluminium storefront door pair with daylight outside
    storefront() {
      if (cache.storefront) return cache.storefront;
      const W = 256, H = 320, c = canvas(W, H), g = c.getContext('2d');
      g.fillStyle = '#3b4047'; g.fillRect(0, 0, W, H);
      for (const x0 of [12, W / 2 + 4]) {
        const w = W / 2 - 16, y0 = 12, h = H - 30;
        const gr = g.createLinearGradient(0, y0, 0, y0 + h);
        gr.addColorStop(0, '#d8e9f5'); gr.addColorStop(0.55, '#b8d2e4'); gr.addColorStop(0.62, '#8fae86'); gr.addColorStop(1, '#a7a59c');
        g.fillStyle = gr; g.fillRect(x0, y0, w, h);
        g.fillStyle = '#c4c9ce'; g.fillRect(x0 + 6, H * 0.52, w - 12, 6);
      }
      return (cache.storefront = c);
    },
    exitSign() {
      if (cache.exitSign) return cache.exitSign;
      const c = canvas(128, 56), g = c.getContext('2d');
      g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, 128, 56);
      g.fillStyle = '#e0261b'; g.font = 'bold 40px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('EXIT', 64, 30);
      return (cache.exitSign = c);
    },
    // rolling tool chest front: drawers with silver pulls
    toolChest() {
      if (cache.toolChest) return cache.toolChest;
      const S = 256, c = canvas(S, S), g = c.getContext('2d');
      g.fillStyle = '#1f2226'; g.fillRect(0, 0, S, S);
      const rows = [0.16, 0.12, 0.12, 0.12, 0.16, 0.16, 0.16];
      let y = 6;
      for (const f of rows) {
        const h = f * (S - 12);
        g.fillStyle = '#2b2f34'; g.fillRect(6, y + 2, S - 12, h - 4);
        g.fillStyle = '#c9ced3'; g.fillRect(16, y + 5, S - 32, 3);
        y += h;
      }
      return (cache.toolChest = c);
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
  // A tiny high bay: glowing translucent wall on one side, block wall on the other, a grid of
  // high-bay lights overhead and a warm bounce from the concrete floor.
  function buildEnvironment(renderer) {
    const env = new THREE.Scene();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color('#a8a59f'), side: THREE.BackSide }));
    room.scale.set(30, 12, 30); room.position.y = 6; env.add(room);
    const glow = (hex, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
    const panel = (mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(box, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); env.add(m); };
    panel(glow('#f4f8fb', 3.4), -14.9, 6.6, 0, 0.1, 9, 28);   // translucent wall
    panel(glow('#ffffff', 1.1), 14.9, 5, 0, 0.1, 6, 26);      // light block wall
    panel(glow('#f4f8fb', 2.6), 0, 10.5, -14.9, 28, 2.6, 0.1); // clerestory
    const lamp = glow('#ffffff', 7);
    for (const x of [-9, -3, 3, 9]) for (const z of [-9, -3, 3, 9]) panel(lamp, x, 9.4, z, 0.7, 0.05, 0.7);
    panel(glow('#f3e5cf', 1.5), 0, 0.05, 0, 26, 0.1, 26);     // floor bounce
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
    sun.position.set(-10, 24, 9);
    sun.target.position.set(0, 0, 0);
    const sm = isMobile ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 2, far: 60 });
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
