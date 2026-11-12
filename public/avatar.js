/* VR Sticky Notes - avatars.
 * A human-proportioned figure: shaped head with a face, hair, neck, torso, arms with hands,
 * legs and shoes. Each figure is a handful of merged, vertex-coloured meshes (head, eyes,
 * mouth, torso, two arms, two legs), so it costs about 9 draw calls and ~3,000 triangles.
 * The origin is the person's eye point; the face looks along -z.
 * components.js (avatar-lerp) animates the parts: walking, blinking, talking.
 */
(function () {
  'use strict';
  const THREE = AFRAME.THREE;

  const OPTIONS = {
    skin: ['#f6d7b8', '#e8b98f', '#c98f62', '#a46a3f', '#7a4a2a', '#4f2f1c'],
    hair: [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long'], ['bun', 'Bun'], ['ponytail', 'Ponytail'], ['curly', 'Curly'], ['none', 'Bald']],
    hairColor: ['#1b1a1c', '#3b2a20', '#6b4a2f', '#a9783f', '#d8b673', '#9c3f22', '#8f9094', '#e6e3dc'],
    pants: ['#34425a', '#23262d', '#5c6670', '#6f6a5c', '#b9a47c'],
    hat: [['none', 'None'], ['hardhat-yellow', 'Hard hat, yellow'], ['hardhat-white', 'Hard hat, white'], ['hardhat-orange', 'Hard hat, orange'], ['cap', 'Cap'], ['beanie', 'Beanie'], ['headphones', 'Headphones'], ['headscarf', 'Headscarf']],
    eyes: [['none', 'None'], ['glasses', 'Glasses'], ['safety', 'Safety glasses']]
  };
  const HAT_COLORS = { 'hardhat-yellow': '#f5c400', 'hardhat-white': '#f2f2ee', 'hardhat-orange': '#f36f21' };
  const VEST = '#cdf23a';
  const DARK = '#22252b';
  const HEAD_SCALE = 1.1;

  // ---- colour helpers (sRGB hex in, 'rgb()' out) ----
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function shade(hex, k) { return 'rgb(' + rgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',') + ')'; }
  function mix(a, b, t) { const A = rgb(a), B = rgb(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')'; }
  const lipOf = (skin) => mix(skin, '#a8413f', 0.5);
  const browOf = (a) => (a.hair === 'none' ? mix(a.skin, '#2a211c', 0.7) : shade(a.hairColor, a.hairColor === '#e6e3dc' || a.hairColor === '#8f9094' ? 0.75 : 0.8));
  const scarfOf = (a) => shade(a.shirt, 0.78);

  // ---- shared base shapes ----
  const G = {
    sph: new THREE.SphereGeometry(1, 12, 8),
    lo: new THREE.SphereGeometry(1, 8, 5),
    tiny: new THREE.SphereGeometry(1, 6, 4),
    disc: new THREE.CircleGeometry(1, 10).rotateY(Math.PI), // faces forward (-z)
    dome: new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    band: new THREE.SphereGeometry(1, 14, 1, 0, Math.PI * 2, Math.PI * 0.37, Math.PI * 0.13),
    wrap: new THREE.SphereGeometry(1, 12, 8, Math.PI * 1.5 + 0.95, Math.PI * 2 - 1.9), // sphere with the face left open
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
    tube: new THREE.CylinderGeometry(1, 1, 1, 12, 1, true),
    rim: new THREE.TorusGeometry(1, 0.1, 4, 12),
    collar: new THREE.TorusGeometry(1, 0.2, 4, 10),
    arch: new THREE.TorusGeometry(0.094, 0.007, 5, 14, Math.PI)
  };
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
  G.head = lathe([[0, -0.112], [0.028, -0.11], [0.048, -0.098], [0.063, -0.075], [0.072, -0.04], [0.077, 0], [0.079, 0.035], [0.077, 0.070], [0.066, 0.098], [0.045, 0.116], [0.020, 0.124], [0, 0.126]], 16);
  G.torso = lathe([[0, -0.75], [0.136, -0.75], [0.142, -0.70], [0.14, -0.62], [0.134, -0.54], [0.144, -0.44], [0.157, -0.34], [0.163, -0.27], [0.152, -0.235], [0.11, -0.208], [0.058, -0.195], [0, -0.192]], 14);
  G.vest = lathe([[0.153, -0.61], [0.144, -0.54], [0.152, -0.44], [0.162, -0.34], [0.166, -0.27], [0.156, -0.232], [0.116, -0.204], [0.078, -0.198]], 14);
  const tapers = new Map();
  function taper(rTop, rBot, seg) {
    const k = rTop + '|' + rBot + '|' + seg;
    if (!tapers.has(k)) tapers.set(k, new THREE.CylinderGeometry(rTop, rBot, 1, seg, 1, seg < 6));
    return tapers.get(k);
  }

  // ---- a part: shapes placed and coloured, then merged into one mesh ----
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();
  const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
  function Part() { this.items = []; }
  Part.prototype.add = function (geo, color, pos, scale, rot) {
    _q.setFromEuler(_e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0));
    const m = new THREE.Matrix4().compose(_p.fromArray(pos), _q, scale ? _s.fromArray(scale) : _s.set(1, 1, 1));
    this.items.push({ geo, color, m });
    return this;
  };
  // a tapered limb from a (top) to b (bottom)
  Part.prototype.limb = function (color, a, b, rA, rB, seg) {
    _d.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const len = _d.length();
    _q.setFromUnitVectors(_up, _d.normalize());
    const m = new THREE.Matrix4().compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, len, 1));
    this.items.push({ geo: taper(rA, rB, seg || 8), color, m });
    return this;
  };
  Part.prototype.geometry = function () {
    let verts = 0, idx = 0;
    for (const it of this.items) { verts += it.geo.attributes.position.count; idx += it.geo.index.count; }
    const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
    const index = new Uint16Array(idx);
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    let vo = 0, io = 0;
    for (const it of this.items) {
      const P = it.geo.attributes.position, N = it.geo.attributes.normal;
      nm.getNormalMatrix(it.m);
      _c.set(it.color); // converted to linear, which is what vertex colours expect
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(it.m); pos.set([v.x, v.y, v.z], (vo + i) * 3);
        n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([n.x, n.y, n.z], (vo + i) * 3);
        col.set([_c.r, _c.g, _c.b], (vo + i) * 3);
      }
      const a = it.geo.index.array;
      for (let i = 0; i < a.length; i++) index[io++] = a[i] + vo;
      vo += P.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    return g;
  };

  // One material for every avatar. Standalone headsets get the cheaper lighting model.
  let bodyMat = null, lensMat = null, shadowMat = null;
  function materials() {
    if (bodyMat) return;
    const light = AFRAME.utils.device.isMobileVR();
    bodyMat = light ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
    lensMat = new THREE.MeshBasicMaterial({ color: '#9fd0f0', transparent: true, opacity: 0.2, depthWrite: false });
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)'); grad.addColorStop(0.6, 'rgba(0,0,0,0.22)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }
  const shadowGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);

  function build(a) {
    materials();
    const skin = a.skin, hair = a.hairColor, dark = DARK;
    const hat = a.hat, scarf = hat === 'headscarf';
    const covered = !!HAT_COLORS[hat] || hat === 'cap' || hat === 'beanie';
    let top = 0.132;

    // ----- head -----
    const H = new Part();
    H.add(G.head, skin, [0, 0, 0.012], [1, 1, 1.2]);
    for (const s of [-1, 1]) {
      H.add(G.lo, shade(skin, 0.94), [s * 0.078, -0.012, 0.022], [0.009, 0.024, 0.014]);            // ear
      H.add(G.tiny, browOf(a), [s * 0.032, 0.031, -0.0735], [0.017, 0.0034, 0.005], [0, -s * 0.35, -s * 0.05]); // brow
      H.add(G.tiny, mix(skin, '#2a211c', 0.55), [s * 0.031, 0.0118, -0.0722], [0.019, 0.0022, 0.0055], [0, -s * 0.3, 0]); // lash line
      H.add(G.tiny, shade(skin, 0.97), [s * 0.0095, -0.038, -0.082], [0.006, 0.0055, 0.006]);          // nostril wing
    }
    H.add(G.lo, skin, [0, -0.016, -0.083], [0.008, 0.021, 0.0105]);                                 // nose bridge
    H.add(G.lo, shade(skin, 0.98), [0, -0.034, -0.088], [0.0115, 0.0095, 0.0115]);                  // nose tip
    H.add(G.lo, skin, [0, -0.098, -0.04], [0.022, 0.012, 0.012]);                                   // chin

    // hair
    if (!scarf && a.hair !== 'none') {
      let style = a.hair;
      if (covered && style === 'curly') style = 'short';
      H.add(G.dome, hair, [0, 0.036, 0.016], [0.086, 0.098, 0.108], [0.38, 0, 0]);                 // top, with a hairline
      if (style === 'medium' || style === 'long') H.add(G.sph, hair, [0, -0.03, 0.04], [0.092, 0.105, 0.085]);
      else H.add(G.sph, hair, [0, -0.015, 0.044], [0.083, 0.07, 0.07]);
      if (style === 'long') H.add(G.sph, hair, [0, -0.13, 0.075], [0.095, 0.19, 0.06]);
      if (style === 'bun') { if (covered) H.add(G.lo, hair, [0, -0.03, 0.118], [0.036, 0.036, 0.036]); else { H.add(G.sph, hair, [0, 0.088, 0.106], [0.042, 0.04, 0.042]); top = 0.14; } }
      if (style === 'ponytail') { H.add(G.lo, hair, [0, 0.052, 0.12], [0.026, 0.026, 0.026]); H.add(G.sph, hair, [0, -0.03, 0.14], [0.03, 0.1, 0.034], [-0.22, 0, 0]); }
      if (style === 'curly') { H.add(G.sph, hair, [0, 0.06, 0.03], [0.102, 0.095, 0.108]); top = 0.158; }
    }

    // headwear
    if (HAT_COLORS[hat]) {
      const c = HAT_COLORS[hat];
      H.add(G.dome, c, [0, 0.062, 0.014], [0.104, 0.088, 0.122]);
      H.add(G.cyl, shade(c, 0.93), [0, 0.064, 0.006], [0.113, 0.008, 0.133]);
      H.add(G.cyl, shade(c, 0.93), [0, 0.064, -0.1], [0.082, 0.008, 0.062]);
      H.add(G.dome, shade(c, 0.9), [0, 0.062, 0.014], [0.017, 0.094, 0.126]);
      top = 0.158;
    } else if (hat === 'cap') {
      const c = shade(a.shirt, 0.8);
      H.add(G.dome, c, [0, 0.058, 0.015], [0.092, 0.08, 0.112]);
      H.add(G.sph, shade(a.shirt, 0.66), [0, 0.06, -0.125], [0.068, 0.006, 0.07], [0.12, 0, 0]);
      H.add(G.lo, shade(a.shirt, 0.66), [0, 0.138, 0.015], [0.01, 0.005, 0.01]);
      top = 0.142;
    } else if (hat === 'beanie') {
      H.add(G.dome, shade(a.shirt, 0.8), [0, 0.03, 0.016], [0.091, 0.108, 0.113], [0.3, 0, 0]);
      H.add(G.band, shade(a.shirt, 0.62), [0, 0.03, 0.016], [0.096, 0.108, 0.118], [0.3, 0, 0]);
      top = 0.142;
    } else if (hat === 'headphones') {
      H.add(G.arch, dark, [0, -0.005, 0.02], [1, 1.5, 1]);
      for (const s of [-1, 1]) H.add(G.cyl, dark, [s * 0.092, -0.008, 0.02], [0.033, 0.024, 0.033], [0, 0, Math.PI / 2]);
      top = 0.142;
    } else if (scarf) {
      const c = scarfOf(a);
      H.add(G.dome, c, [0, 0.03, 0.016], [0.09, 0.103, 0.112], [0.3, 0, 0]);
      H.add(G.wrap, c, [0, -0.02, 0.02], [0.092, 0.135, 0.108]);
      H.add(G.sph, c, [0, -0.122, 0], [0.068, 0.034, 0.07]);
      top = 0.14;
    }

    // eyewear
    if (a.eyes === 'glasses') {
      for (const s of [-1, 1]) {
        H.add(G.rim, dark, [s * 0.031, 0, -0.084], [0.021, 0.021, 0.021]);
        H.limb(dark, [s * 0.052, 0.003, -0.082], [s * 0.081, 0.002, 0.02], 0.0022, 0.0022, 4);
      }
      H.add(G.box, dark, [0, 0.004, -0.085], [0.022, 0.004, 0.004]);
    } else if (a.eyes === 'safety') {
      H.add(G.box, dark, [0, 0.021, -0.087], [0.136, 0.006, 0.008]);
      for (const s of [-1, 1]) H.limb(dark, [s * 0.066, 0.016, -0.084], [s * 0.081, 0.004, 0.02], 0.003, 0.003, 4);
    }

    const head = new THREE.Group();
    head.userData.av = true;
    head.scale.setScalar(HEAD_SCALE); // a touch larger than life, so faces read at a distance
    head.add(new THREE.Mesh(H.geometry(), bodyMat));

    // eyes (their own mesh so they can blink)
    const E = new Part();
    for (const s of [-1, 1]) {
      E.add(G.lo, '#f4f1ec', [s * 0.031, 0, -0.071], [0.0175, 0.0115, 0.006], [0, -s * 0.3, 0]);
      E.add(G.disc, '#4a3222', [s * 0.0305, 0, -0.0771], [0.0086, 0.0086, 1], [0, -s * 0.3, 0]);
      E.add(G.disc, '#101012', [s * 0.0303, 0, -0.0774], [0.0042, 0.0042, 1], [0, -s * 0.3, 0]);
      E.add(G.disc, '#ffffff', [s * 0.0303 + 0.003, 0.003, -0.0777], [0.0015, 0.0015, 1], [0, -s * 0.3, 0]);
    }
    const eyes = new THREE.Mesh(E.geometry(), bodyMat);
    head.add(eyes);

    // mouth (its own mesh so it can open while talking)
    const Mo = new Part();
    const lip = lipOf(skin), smile = [[-0.024, 0.0045, 0.006], [-0.013, -0.0012, 0.0015], [0, -0.003, 0], [0.013, -0.0012, 0.0015], [0.024, 0.0045, 0.006]];
    for (let i = 0; i < 4; i++) Mo.limb(lip, smile[i], smile[i + 1], 0.0032, 0.0032, 5);
    for (let i = 1; i < 4; i++) Mo.add(G.tiny, lip, smile[i], [0.0032, 0.0032, 0.0032]);
    Mo.add(G.tiny, '#3a1716', [0, -0.0012, 0.0012], [0.014, 0.0011, 0.0036]);
    const mouth = new THREE.Mesh(Mo.geometry(), bodyMat);
    mouth.position.set(0, -0.07, -0.068);
    head.add(mouth);

    if (a.eyes === 'safety') {
      const lens = new THREE.Mesh(G.box, lensMat);
      lens.position.set(0, 0, -0.087); lens.scale.set(0.132, 0.04, 0.003);
      head.add(lens);
    }

    // ----- body -----
    const body = new THREE.Group();
    body.userData.av = true;
    const T = new Part();
    T.add(G.torso, a.shirt, [0, 0, 0], [1, 1, 0.62]);
    T.limb(shade(skin, 0.96), [0, -0.085, 0.018], [0, -0.2, 0.012], 0.043, 0.05);                   // neck
    T.add(G.collar, shade(a.shirt, 0.86), [0, -0.197, 0.012], [0.054, 0.054, 0.05], [Math.PI / 2, 0, 0]);
    T.add(G.lo, a.pants, [0, -0.765, 0], [0.132, 0.07, 0.084]);                                    // hips
    if (a.vest) {
      T.add(G.vest, VEST, [0, 0, 0], [1, 1, 0.64]);
      T.add(G.tube, '#e9ecef', [0, -0.5, 0], [0.156, 0.03, 0.1]);
      T.add(G.tube, '#e9ecef', [0, -0.375, 0], [0.167, 0.03, 0.107]);
    }
    if (scarf) T.limb(scarfOf(a), [0, -0.1, 0.014], [0, -0.24, 0.012], 0.062, 0.118);
    body.add(new THREE.Mesh(T.geometry(), bodyMat));

    // arms: short sleeves, bare forearms, hands. Hinged at the shoulder.
    const A = new Part();
    A.add(G.lo, a.shirt, [0, -0.012, 0], [0.047, 0.05, 0.05]);
    A.limb(a.shirt, [0, -0.02, 0], [0, -0.15, 0.002], 0.046, 0.043);
    A.limb(skin, [0, -0.1, 0], [0, -0.29, 0.005], 0.04, 0.035);
    A.add(G.tiny, skin, [0, -0.29, 0.005], [0.035, 0.035, 0.035]);
    A.limb(skin, [0, -0.29, 0.005], [0, -0.53, -0.035], 0.034, 0.025);
    A.add(G.lo, skin, [0, -0.582, -0.044], [0.016, 0.046, 0.031], [-0.15, 0, 0]);
    A.add(G.tiny, skin, [0, -0.562, -0.07], [0.009, 0.022, 0.011], [-0.4, 0, 0]);
    const armGeo = A.geometry();
    const arm = (s) => { const m = new THREE.Mesh(armGeo, bodyMat); m.position.set(s * 0.172, -0.262, 0); m.rotation.z = s * 0.1; body.add(m); return m; };
    const armL = arm(-1), armR = arm(1);

    // legs: trousers and shoes. Hinged at the hip.
    const L = new Part();
    L.limb(a.pants, [0, 0.02, 0], [0, -0.4, 0], 0.078, 0.056);
    L.add(G.tiny, a.pants, [0, -0.4, 0], [0.055, 0.055, 0.055]);
    L.limb(a.pants, [0, -0.4, 0], [0, -0.775, 0.005], 0.054, 0.042);
    L.add(G.lo, '#2a2d33', [0, -0.797, -0.035], [0.048, 0.034, 0.105]);
    L.add(G.box, '#dcdcd8', [0, -0.824, -0.035], [0.088, 0.013, 0.198]);
    const legGeo = L.geometry();
    const leg = (s) => { const m = new THREE.Mesh(legGeo, bodyMat); m.position.set(s * 0.082, -0.77, 0); body.add(m); return m; };
    const legL = leg(-1), legR = leg(1);

    // soft contact shadow on the floor
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.userData.av = true;
    shadow.renderOrder = 1;

    top *= HEAD_SCALE;
    return { head, body, shadow, top, parts: { body, eyes, mouth, armL, armR, legL, legR, shadow } };
  }

  // free what build() made (materials and base shapes are shared and stay)
  function dispose(obj) {
    obj.traverse((o) => { if (o.isMesh && o.geometry !== shadowGeo && o.geometry !== G.box) o.geometry.dispose(); });
  }

  // ---- 2D portrait for the lobby and the editor ----
  function svg(container, a) {
    if (!container) return;
    const sk = a.skin, hc = a.hairColor, hat = a.hat, scarf = hat === 'headscarf';
    const covered = !!HAT_COLORS[hat] || hat === 'cap' || hat === 'beanie';
    const hairOn = !scarf && a.hair !== 'none';
    const style = covered && a.hair === 'curly' ? 'short' : a.hair;
    const face = 'M38 50 Q38 26 60 26 Q82 26 82 50 Q82 70 72 79 Q60 87 48 79 Q38 70 38 50 Z';
    const sc = scarfOf(a);
    let s = '<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg">';
    // hair behind the head
    if (hairOn) {
      if (style === 'long') s += `<path d="M34 50 Q33 22 60 22 Q87 22 86 50 L90 112 Q60 122 30 112 Z" fill="${hc}"/>`;
      if (style === 'medium') s += `<path d="M34 50 Q33 22 60 22 Q87 22 86 50 L87 84 Q87 90 80 90 L40 90 Q33 90 33 84 Z" fill="${hc}"/>`;
      if (style === 'curly') s += `<circle cx="60" cy="44" r="31" fill="${hc}"/>`;
      if (style === 'bun' && !covered) s += `<circle cx="60" cy="19" r="10" fill="${hc}"/>`;
      if (style === 'ponytail') s += `<path d="M80 34 Q100 40 95 82 Q89 70 82 56 Z" fill="${hc}"/>`;
    }
    if (scarf) s += `<path d="M32 54 Q31 19 60 19 Q89 19 88 54 Q89 90 80 104 L40 104 Q31 90 32 54 Z" fill="${sc}"/>`;
    // shoulders and shirt
    s += `<path d="M18 150 L22 122 Q24 106 42 101 L52 97 L68 97 L78 101 Q96 106 98 122 L102 150 Z" fill="${a.shirt}"/>`;
    if (a.vest) s += `<path d="M34 104 L50 98 L60 112 L70 98 L86 104 L90 150 L30 150 Z" fill="${VEST}"/><rect x="31" y="126" width="58" height="5" fill="#e9ecef"/><rect x="30.5" y="139" width="59" height="5" fill="#e9ecef"/>`;
    s += `<path d="M52 78 L52 97 Q60 104 68 97 L68 78 Z" fill="${shade(sk, 0.88)}"/>`;
    if (scarf) s += `<path d="M44 86 Q60 96 76 86 L84 106 Q60 114 36 106 Z" fill="${sc}"/>`;
    // head
    s += `<ellipse cx="38" cy="57" rx="4" ry="7" fill="${shade(sk, 0.92)}"/><ellipse cx="82" cy="57" rx="4" ry="7" fill="${shade(sk, 0.92)}"/>`;
    s += `<path d="${face}" fill="${sk}"/>`;
    if (hairOn) s += `<path d="M38 50 Q36 23 60 22 Q84 23 82 50 Q79 37 60 36 Q41 37 38 50 Z" fill="${hc}"/>`;
    s += `<g fill="none" stroke="${browOf(a)}" stroke-width="2.2" stroke-linecap="round"><path d="M46 48.5 q5 -3 10 -0.5"/><path d="M64 48 q5 -2.5 10 0.5"/></g>`;
    for (const x of [51, 69]) s += `<ellipse cx="${x}" cy="55" rx="4.6" ry="3" fill="#f4f1ec"/><circle cx="${x}" cy="55" r="2.4" fill="#4a3222"/><circle cx="${x}" cy="55" r="1" fill="#101012"/>`;
    s += `<path d="M60.5 57 q-3.5 9 -1.5 11 q1.5 1 3.5 0" fill="none" stroke="${shade(sk, 0.72)}" stroke-width="1.5" stroke-linecap="round"/>`;
    s += `<path d="M53 73 q7 4 14 0" fill="none" stroke="${lipOf(sk)}" stroke-width="2.4" stroke-linecap="round"/>`;
    if (scarf) s += `<path fill-rule="evenodd" d="M32 54 Q31 19 60 19 Q89 19 88 54 Q89 80 76 90 Q60 98 44 90 Q31 80 32 54 Z M43 53 Q43 35 60 35 Q77 35 77 53 Q77 68 70 76 Q60 83 50 76 Q43 68 43 53 Z" fill="${sc}"/>`;
    // eyewear
    if (a.eyes === 'glasses') s += '<g fill="none" stroke="#22252b" stroke-width="2"><circle cx="51" cy="55" r="7"/><circle cx="69" cy="55" r="7"/><path d="M58 55 h4"/></g>';
    if (a.eyes === 'safety') s += '<rect x="41" y="48" width="38" height="14" rx="6" fill="rgba(150,205,240,.5)" stroke="#22252b" stroke-width="1.8"/>';
    // headwear
    if (HAT_COLORS[hat]) { const c = HAT_COLORS[hat]; s += `<path d="M35 43 Q35 16 60 15 Q85 16 85 43 Z" fill="${c}"/><rect x="29" y="40" width="62" height="6" rx="3" fill="${shade(c, 0.88)}"/><rect x="57" y="15" width="6" height="26" rx="3" fill="${shade(c, 0.9)}"/>`; }
    if (hat === 'cap') s += `<path d="M37 43 Q37 19 60 19 Q83 19 83 43 Z" fill="${shade(a.shirt, 0.8)}"/><path d="M60 39 L97 42 Q98 47 93 47 L60 45 Z" fill="${shade(a.shirt, 0.66)}"/>`;
    if (hat === 'beanie') s += `<path d="M37 44 Q36 14 60 14 Q84 14 83 44 Z" fill="${shade(a.shirt, 0.8)}"/><rect x="35" y="36" width="50" height="10" rx="4" fill="${shade(a.shirt, 0.62)}"/>`;
    if (hat === 'headphones') s += '<path d="M35 56 Q33 17 60 17 Q87 17 85 56" fill="none" stroke="#22252b" stroke-width="4"/><rect x="29" y="48" width="10" height="18" rx="4" fill="#22252b"/><rect x="81" y="48" width="10" height="18" rx="4" fill="#22252b"/>';
    s += '</svg>';
    container.innerHTML = s;
  }

  window.VSNAvatar = { OPTIONS, build, dispose, svg };
})();
