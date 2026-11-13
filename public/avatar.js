/* VR Sticky Notes - avatars.
 * Everyone is a rigged, low-poly figure (public/avatars/body.glb) with idle, walk, run and jump
 * clips. Hair, headwear, glasses, eyebrows and beards are separate small models fixed to the
 * head bone. Skin, shirt and trouser colours (and the hi-vis vest) are painted in the shader
 * from one recolour mask, so every avatar shares one texture and one shader program.
 * Cost per figure: 1 skinned draw call (~5,200 triangles) plus 1 per accessory (~200-1,100 each).
 * The figure's origin is its feet; it faces -z, like the camera.
 */
(function () {
  'use strict';
  const THREE = AFRAME.THREE;
  const BASE = '/avatars/';

  const OPTIONS = {
    skin: ['#f6d7b8', '#e8b98f', '#c98f62', '#a46a3f', '#7a4a2a', '#4f2f1c'],
    hair: [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long'], ['bun', 'Bun'], ['ponytail', 'Ponytail'], ['curly', 'Curly'], ['none', 'Bald']],
    hairColor: ['#1b1a1c', '#3b2a20', '#6b4a2f', '#a9783f', '#d8b673', '#9c3f22', '#8f9094', '#e6e3dc'],
    pants: ['#34425a', '#23262d', '#5c6670', '#6f6a5c', '#b9a47c'],
    hat: [['none', 'None'], ['hardhat-yellow', 'Hard hat, yellow'], ['hardhat-white', 'Hard hat, white'], ['hardhat-orange', 'Hard hat, orange'], ['cap', 'Cap'], ['beanie', 'Beanie'], ['headphones', 'Headphones'], ['headscarf', 'Headscarf']],
    eyes: [['none', 'None'], ['glasses', 'Glasses'], ['safety', 'Safety glasses']],
    beard: [['none', 'None'], ['full', 'Beard']]
  };
  const HAT_COLORS = { 'hardhat-yellow': '#f5c400', 'hardhat-white': '#f2f2ee', 'hardhat-orange': '#f36f21' };
  const VEST = '#cdf23a', STRIPE = '#e9ecef', DARK = '#2a2d33';

  // ---- body proportions (model units: the body is 1 unit tall, facing +z in the file) ----
  const EYE = 0.8965;          // eye height in the model
  const EYE_M = 1.6;           // eye height in metres for a standing person
  const SCALE = EYE_M / EYE;   // model units -> metres
  const WALK_MPS = 1.085;      // ground speed the walk clip is drawn for, at SCALE
  const RUN_MPS = 4.07;        // same for the run clip

  // ---- colour helpers ----
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function shade(hex, k) { return '#' + rgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join(''); }
  function mix(a, b, t) { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
  const lipOf = (skin) => mix(skin, '#a8413f', 0.5);
  const browOf = (a) => (a.hair === 'none' ? mix(a.skin, '#2a211c', 0.7) : shade(a.hairColor, a.hairColor === '#e6e3dc' || a.hairColor === '#8f9094' ? 0.75 : 0.8));
  const scarfOf = (a) => shade(a.shirt, 0.78);

  // ---- where each accessory sits on the head (model units, bind pose, face toward +z) ----
  // ry: turn the part first (some files face sideways); w: width to scale it to;
  // top/bottom/cy: height of its top, bottom or centre; front/cz: depth of its front or centre;
  // sy, sz: extra stretch up or front-to-back; scalp: add a shell over the back of the head
  const FIT = {
    'hair-short': { w: 0.232, top: 1.03, cz: -0.012, scalp: 'top' },
    'hair-medium': { w: 0.242, top: 1.03, cz: -0.014, scalp: 'medium' },
    'hair-long': { w: 0.232, top: 1.03, cz: -0.02, scalp: 'long' },
    'hair-bun': { ry: Math.PI / 2, w: 0.212, top: 1.088, cz: -0.014, scalp: 'top' },
    'hair-ponytail': { ry: Math.PI / 2, w: 0.228, top: 1.03, cz: -0.03, scalp: 'top' },
    'hair-curly': { w: 0.266, top: 1.052, cz: -0.012, scalp: 'curly' },
    beard: { w: 0.19, bottom: 0.763, front: 0.102, sy: 0.76 },
    hardhat: { w: 0.238, bottom: 0.892, cz: 0.004 },
    beanie: { w: 0.226, bottom: 0.9, cz: -0.004 },
    headphones: { w: 0.236, cy: 0.9, cz: -0.004 },
    headscarf: { w: 0.262, top: 1.04, cz: -0.006, sy: 1.04, scalp: 'scarf' },
    glasses: { w: 0.19, cy: 0.898, front: 0.104, sz: 0.85 },
    safety: { w: 0.2, cy: 0.9, front: 0.106, sz: 0.85 }
  };
  const PARTS = Object.keys(FIT);

  // ---- loading (once, shared by every avatar) ----
  const lib = { ready: false, promise: null, body: null, clips: null, geo: {}, maps: {}, mask: null, bindHip: null, headBindInv: null };
  function load() {
    if (lib.promise) return lib.promise;
    const loader = new THREE.GLTFLoader();
    const get = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
    const tex = new Promise((res, rej) => new THREE.TextureLoader().load(BASE + 'body-mask.png', res, undefined, rej));
    lib.promise = Promise.all([get(BASE + 'body.glb'), tex].concat(PARTS.map((n) => get(BASE + n + '.glb'))))
      .then(([body, mask, ...parts]) => {
        mask.flipY = false; mask.colorSpace = THREE.NoColorSpace;
        lib.mask = mask;
        lib.body = body.scene;
        lib.clips = prepareClips(body.animations);
        lib.body.updateMatrixWorld(true);
        lib.bindHip = hipLocal(lib.body, new THREE.Vector3());
        lib.headBindInv = lib.body.getObjectByName('Head').matrixWorld.clone().invert();
        // every part's geometry is baked into model space here, once
        parts.forEach((g, i) => {
          const name = PARTS[i], f = FIT[name];
          let mesh = null;
          g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
          let geo = mesh.geometry;
          if (f.ry) geo.rotateY(f.ry);
          geo.computeBoundingBox();
          geo.applyMatrix4(fitMatrix(geo.boundingBox, f));
          if (f.scalp) geo = merge([geo, scalp(f.scalp)]);
          geo.computeBoundingBox();
          lib.geo[name] = geo;
          if (mesh.material.map) lib.maps[name] = mesh.material.map;
        });
        const cap = capParts();
        cap.dome.computeBoundingBox(); cap.peak.computeBoundingBox();
        lib.geo['cap-dome'] = cap.dome; lib.geo['cap-peak'] = cap.peak;
        lib.ready = true;
      });
    lib.promise.catch((e) => console.warn('avatar models failed to load', e));
    return lib.promise;
  }

  // Scale and place a part (bounding box `b`, in its own units) on the head, in model units.
  function fitMatrix(b, f) {
    const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const s = f.w / size.x, sy = s * (f.sy || 1), sz = s * (f.sz || 1);
    const y = f.top != null ? f.top - b.max.y * sy : f.bottom != null ? f.bottom - b.min.y * sy : f.cy - c.y * sy;
    const z = f.front != null ? f.front - b.max.z * sz : (f.cz || 0) - c.z * sz;
    return new THREE.Matrix4().compose(new THREE.Vector3(-c.x * s, y, z), new THREE.Quaternion(), new THREE.Vector3(s, sy, sz));
  }

  // The hair and headscarf files are open shells that frame the face. A smooth shell over the
  // crown and the back of the head (longer for longer styles) completes them.
  const HEAD_C = new THREE.Vector3(0, 0.888, -0.006), HEAD_R = new THREE.Vector3(0.1, 0.118, 0.103);
  function scalp(kind) {
    const out = [];
    const reach = { top: 0.56, medium: 0.56, long: 0.56, curly: 0.58, scarf: 0.66 }[kind];
    const grow = kind === 'curly' ? 1.12 : kind === 'scarf' ? 1.1 : 1.06;
    const crown = new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI * reach);
    crown.rotateX(-0.8);                       // rim high over the forehead, low at the nape
    crown.scale(HEAD_R.x * grow, HEAD_R.y * grow, HEAD_R.z * grow);
    crown.translate(HEAD_C.x, HEAD_C.y + (kind === 'curly' ? 0.012 : 0.004), HEAD_C.z - 0.004);
    out.push(crown);
    // a curtain of hair (or cloth) down the back for the longer styles
    const drop = { medium: 0.79, long: 0.69, scarf: 0.75 }[kind];
    if (drop) {
      const topY = 0.9, h = topY - drop, r = HEAD_R.x * grow;
      const back = new THREE.CylinderGeometry(r, r * (kind === 'long' ? 1.12 : 1.04), h, 14, 1, true, Math.PI / 2 + 0.25, Math.PI - 0.5);
      back.scale(1, 1, HEAD_R.z / HEAD_R.x);
      back.translate(0, topY - h / 2, HEAD_C.z - 0.006);
      out.push(back);
    }
    return merge(out);
  }

  // Merge geometries (position and normal only), keeping an index.
  function merge(list) {
    let nv = 0, ni = 0;
    const parts = list.map((g) => { const ix = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()]; nv += g.attributes.position.count; ni += ix.length; return { g, ix }; });
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const { g, ix } of parts) {
      if (!g.attributes.normal) g.computeVertexNormals();
      const P = g.attributes.position, N = g.attributes.normal; // may be interleaved or quantised
      for (let i = 0; i < P.count; i++) {
        const o = (vo + i) * 3;
        pos[o] = P.getX(i); pos[o + 1] = P.getY(i); pos[o + 2] = P.getZ(i);
        nor[o] = N.getX(i); nor[o + 1] = N.getY(i); nor[o + 2] = N.getZ(i);
      }
      for (let i = 0; i < ix.length; i++) idx[io++] = ix[i] + vo;
      vo += P.count;
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    m.setIndex(new THREE.BufferAttribute(idx, 1));
    return m;
  }

  // Clips: idle, walk and run loop; jump is the first hop of the file's jump clip, with the hips
  // left where they are (the person's own jump lifts the whole figure); fly holds its mid-air frame.
  function prepareClips(anims) {
    const byName = (n) => anims.find((a) => a.name === n);
    const noHipMove = (clip) => { clip.tracks = clip.tracks.filter((t) => !/\.position$/.test(t.name)); return clip; };
    const jump = byName('jump');
    const fps = 24;
    return {
      idle: byName('standing_relax'),
      walk: byName('walk'),
      run: byName('run'),
      jump: noHipMove(THREE.AnimationUtils.subclip(jump, 'hop', Math.round(0.04 * fps), Math.round(0.36 * fps), fps)),
      fly: noHipMove(THREE.AnimationUtils.subclip(jump, 'float', Math.round(0.17 * fps), Math.round(0.21 * fps), fps))
    };
  }

  // Hip position relative to the model, from the bone transforms (no world matrices needed).
  const _v = new THREE.Vector3();
  function hipLocal(model, out) {
    const hip = model.getObjectByName ? model.getObjectByName('Hip') : model;
    const root = hip.parent; // BoneRoot
    out.copy(hip.position).applyQuaternion(root.quaternion).add(root.position);
    return out;
  }

  // Copy a skinned scene so each copy has its own skeleton (geometry is shared).
  function cloneSkinned(source) {
    const srcOf = new Map(), cloneOf = new Map();
    const clone = source.clone();
    (function walk(a, b) { srcOf.set(b, a); cloneOf.set(a, b); for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]); })(source, clone);
    clone.traverse((n) => {
      if (!n.isSkinnedMesh) return;
      const src = srcOf.get(n);
      n.skeleton = src.skeleton.clone();
      n.bindMatrix.copy(src.bindMatrix);
      n.skeleton.bones = src.skeleton.bones.map((b) => cloneOf.get(b));
      n.bind(n.skeleton, n.bindMatrix);
    });
    return clone;
  }

  // ---- materials ----
  const lightweight = () => AFRAME.utils.device.isMobileVR();
  function makeMat(opts) {
    return lightweight() ? new THREE.MeshLambertMaterial(opts) : new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.8, metalness: 0 }, opts));
  }
  const matCache = new Map();
  function flatMat(color) {
    if (!matCache.has(color)) matCache.set(color, makeMat({ color: new THREE.Color(color) }));
    return matCache.get(color);
  }
  function texMat(map) {
    const k = 'tex:' + map.uuid;
    if (!matCache.has(k)) matCache.set(k, makeMat({ map }));
    return matCache.get(k);
  }

  // Body material: the shared texture, recoloured by the mask (r skin, g shirt, b trousers,
  // a vest 0.5 / reflective band 1). Each figure has its own uniforms but the same program.
  const REF = { skin: 0.5996, shirt: 0.872, pants: 0.4766 }; // mean linear luminance of each region
  function bodyMat(map, a) {
    const m = makeMat({ map });
    const lin = (hex) => new THREE.Color(hex);
    m.userData.u = {
      vsnMask: { value: lib.mask },
      vsnSkin: { value: lin(a.skin) }, vsnShirt: { value: lin(a.shirt) }, vsnPants: { value: lin(a.pants) },
      vsnVest: { value: lin(VEST) }, vsnStripe: { value: lin(STRIPE) }, vsnVestOn: { value: a.vest ? 1 : 0 }
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, m.userData.u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D vsnMask; uniform vec3 vsnSkin, vsnShirt, vsnPants, vsnVest, vsnStripe; uniform float vsnVestOn;')
        .replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec4 mk = texture2D(vsnMask, vMapUv);
    float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float vest = step(0.25, mk.a) * vsnVestOn;
    vec3 top = mix(vsnShirt, mix(vsnVest, vsnStripe, step(0.75, mk.a)), vest);
    float topRef = mix(${REF.shirt.toFixed(4)}, 0.8, vest);
    diffuseColor.rgb = mix(diffuseColor.rgb, vsnSkin * min(l / ${REF.skin.toFixed(4)}, 1.25), mk.r);
    diffuseColor.rgb = mix(diffuseColor.rgb, top * min(l / topRef, 1.2), max(mk.g, vest));
    diffuseColor.rgb = mix(diffuseColor.rgb, vsnPants * min(l / ${REF.pants.toFixed(4)}, 1.3), mk.b);
  }`);
    };
    m.customProgramCacheKey = () => 'vsn-body-' + (lightweight() ? 'l' : 's');
    return m;
  }

  // ---- soft contact shadow ----
  let shadowMat = null;
  const shadowGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
  function getShadowMat() {
    if (shadowMat) return shadowMat;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)'); grad.addColorStop(0.6, 'rgba(0,0,0,0.22)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return shadowMat;
  }

  // A cap has no model of its own: a dome and a peak, sized to the head.
  let capGeo = null;
  function capParts() {
    if (capGeo) return capGeo;
    const dome = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    dome.rotateX(-0.3);
    dome.scale(HEAD_R.x * 1.12, HEAD_R.y * 1.04, HEAD_R.z * 1.12);
    dome.translate(HEAD_C.x, HEAD_C.y + 0.012, HEAD_C.z - 0.002);
    const peak = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false, -Math.PI / 2, Math.PI);
    peak.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.918, 0.098), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0, 0)), new THREE.Vector3(0.092, 0.007, 0.075)));
    capGeo = { dome, peak };
    return capGeo;
  }

  // ---- build one figure ----
  function build(a) {
    if (!lib.ready) return null;
    const root = new THREE.Group();           // feet at origin, facing -z
    const model = cloneSkinned(lib.body);
    model.rotation.y = Math.PI;               // the file faces +z
    model.scale.setScalar(SCALE);
    root.add(model);
    const armature = model.getObjectByName('Armature') || model.children[0];
    let skinned = null;
    model.traverse((o) => { if (o.isSkinnedMesh) skinned = o; });
    const mat = bodyMat(skinned.material.map, a);
    skinned.material = mat;
    skinned.castShadow = false;
    skinned.frustumCulled = false; // animated hips move outside the bind-pose bounds

    // accessories, fixed to the head bone
    const head = model.getObjectByName('Head');
    const hatOn = !!HAT_COLORS[a.hat] || a.hat === 'cap' || a.hat === 'beanie';
    const scarf = a.hat === 'headscarf';
    let top = 1.0;
    // a part's geometry is already in model space: undo the head's rest pose so it follows the head
    const add = (name, material, extra) => {
      const geo = lib.geo[name];
      const m = new THREE.Mesh(geo, material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(lib.headBindInv);
      if (extra) m.matrix.multiply(extra);
      head.add(m);
      top = Math.max(top, extra ? new THREE.Vector3(0, geo.boundingBox.max.y, 0).applyMatrix4(extra).y : geo.boundingBox.max.y);
      return m;
    };
    if (!scarf && a.hair !== 'none') {
      const style = a.hair;
      // short styles disappear under a hat; longer ones show below it, pulled in a little
      const hidden = hatOn && (style === 'short' || style === 'curly' || style === 'bun');
      if (!hidden) {
        const tuck = hatOn ? new THREE.Matrix4().makeTranslation(HEAD_C.x, HEAD_C.y - 0.01, HEAD_C.z).multiply(new THREE.Matrix4().makeScale(0.93, 0.93, 0.93)).multiply(new THREE.Matrix4().makeTranslation(-HEAD_C.x, -HEAD_C.y, -HEAD_C.z)) : null;
        add('hair-' + style, flatMat(a.hairColor), tuck);
      }
    }
    if (a.beard === 'full') add('beard', flatMat(a.hairColor));
    if (HAT_COLORS[a.hat]) add('hardhat', flatMat(HAT_COLORS[a.hat]));
    else if (a.hat === 'beanie') add('beanie', flatMat(shade(a.shirt, 0.8)));
    else if (a.hat === 'headphones') add('headphones', flatMat(DARK));
    else if (scarf) add('headscarf', flatMat(scarfOf(a)));
    else if (a.hat === 'cap') { add('cap-dome', flatMat(shade(a.shirt, 0.8))); add('cap-peak', flatMat(shade(a.shirt, 0.66))); }
    if (a.eyes === 'glasses') add('glasses', texMat(lib.maps.glasses));
    else if (a.eyes === 'safety') add('safety', texMat(lib.maps.safety));
    model.traverse((o) => { o.userData.av = true; });

    const shadow = new THREE.Mesh(shadowGeo, getShadowMat());
    shadow.renderOrder = 1;
    root.add(shadow);

    // animation
    const mixer = new THREE.AnimationMixer(model);
    const acts = {};
    for (const k of ['idle', 'walk', 'run', 'jump', 'fly']) {
      const act = mixer.clipAction(lib.clips[k]);
      if (k === 'jump') { act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; }
      act.enabled = k === 'idle';
      act.setEffectiveWeight(k === 'idle' ? 1 : 0);
      act.play();
      acts[k] = act;
    }
    acts.idle.time = Math.random() * lib.clips.idle.duration; // people don't sway in step
    const w = { idle: 1, walk: 0, run: 0, jump: 0, fly: 0 };

    const fig = {
      root, model, shadow, material: mat,
      top: (top - EYE) * SCALE,            // head top above the eyes, metres
      eye: EYE_M,
      update: function (dt, st) { animate(this, dt, st); }
    };
    fig._ = { mixer, acts, w, armature, head, hip: model.getObjectByName('Hip'), hipNow: new THREE.Vector3(), air: false, lastState: 0 };
    return fig;
  }

  // ---- per-frame animation ----
  // st: { speed (m/s on the ground), state (0 ground, 1 sprint, 2 in the air, 3 flying),
  //       lookYaw, lookPitch (radians, head relative to the body), talk (bool), t (ms) }
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
  function animate(fig, dt, st) {
    const S = fig._, A = S.acts, W = S.w;
    const air = st.state === 2, fly = st.state === 3;
    // which clip should be playing
    const target = { idle: 0, walk: 0, run: 0, jump: 0, fly: 0 };
    let walkScale = 1, runScale = 1;
    if (fly) target.fly = 1;
    else if (air) target.jump = 1;
    else if (st.speed > 0.15) {
      const run = st.state === 1 || st.speed > 2.9;
      if (run) { target.run = 1; runScale = THREE.MathUtils.clamp(st.speed / RUN_MPS, 0.6, 1.4); }
      else { target.walk = 1; walkScale = THREE.MathUtils.clamp(st.speed / WALK_MPS, 0.55, 1.9); }
    } else target.idle = 1;
    // restart the hop each time someone leaves the ground
    if (air && !S.air) { A.jump.reset(); A.jump.play(); }
    S.air = air;
    const k = Math.min(1, dt * (air ? 14 : 8));
    let move = 0;
    for (const n in W) {
      W[n] += (target[n] - W[n]) * k;
      if (W[n] < 0.002 && !target[n]) W[n] = 0;
      A[n].enabled = W[n] > 0;
      A[n].setEffectiveWeight(W[n]);
      if (n !== 'idle') move += W[n];
    }
    A.walk.timeScale = walkScale;
    A.run.timeScale = runScale;
    A.jump.timeScale = 0.55;
    S.mixer.update(dt);

    // keep the hips over the feet while moving (the clips walk forward on their own)
    hipLocal(S.hip, S.hipNow);
    S.armature.position.x = -(S.hipNow.x - lib.bindHip.x) * Math.min(1, move);
    S.armature.position.z = -(S.hipNow.z - lib.bindHip.z) * Math.min(1, move);

    // turn the head toward where the person is looking (and nod a little while talking)
    let pitch = THREE.MathUtils.clamp(st.lookPitch || 0, -0.75, 0.6);
    const yaw = THREE.MathUtils.clamp(st.lookYaw || 0, -1.1, 1.1);
    if (st.talk) pitch += Math.sin(st.t * 0.011) * 0.035 + Math.sin(st.t * 0.023) * 0.02;
    if (Math.abs(pitch) > 0.001 || Math.abs(yaw) > 0.001) {
      const head = S.head;
      head.parent.updateWorldMatrix(true, false);
      head.parent.getWorldQuaternion(_q);               // parent world
      fig.root.getWorldQuaternion(_qb);                 // body world
      _q2.setFromEuler(_e.set(pitch, yaw, 0));          // look, in the body's frame
      _q2.premultiply(_qb).multiply(_qb.invert());      // ... in world space
      // new local = parent^-1 * look * parent * local
      head.quaternion.premultiply(_q).premultiply(_q2).premultiply(_q.invert());
    }
  }

  function dispose(fig) {
    if (!fig) return;
    if (fig.material) fig.material.dispose();
    if (fig._ && fig._.mixer) { fig._.mixer.stopAllAction(); fig._.mixer.uncacheRoot(fig.model); }
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
    if (hairOn) {
      if (style === 'long') s += `<path d="M34 50 Q33 22 60 22 Q87 22 86 50 L90 112 Q60 122 30 112 Z" fill="${hc}"/>`;
      if (style === 'medium') s += `<path d="M34 50 Q33 22 60 22 Q87 22 86 50 L87 84 Q87 90 80 90 L40 90 Q33 90 33 84 Z" fill="${hc}"/>`;
      if (style === 'curly') s += `<circle cx="60" cy="44" r="31" fill="${hc}"/>`;
      if (style === 'bun' && !covered) s += `<circle cx="60" cy="19" r="10" fill="${hc}"/>`;
      if (style === 'ponytail') s += `<path d="M80 34 Q100 40 95 82 Q89 70 82 56 Z" fill="${hc}"/>`;
    }
    if (scarf) s += `<path d="M32 54 Q31 19 60 19 Q89 19 88 54 Q89 90 80 104 L40 104 Q31 90 32 54 Z" fill="${sc}"/>`;
    s += `<path d="M18 150 L22 122 Q24 106 42 101 L52 97 L68 97 L78 101 Q96 106 98 122 L102 150 Z" fill="${a.shirt}"/>`;
    if (a.vest) s += `<path d="M34 104 L50 98 L60 112 L70 98 L86 104 L90 150 L30 150 Z" fill="${VEST}"/><rect x="31" y="126" width="58" height="5" fill="${STRIPE}"/><rect x="30.5" y="139" width="59" height="5" fill="${STRIPE}"/>`;
    s += `<path d="M52 78 L52 97 Q60 104 68 97 L68 78 Z" fill="${shade(sk, 0.88)}"/>`;
    if (scarf) s += `<path d="M44 86 Q60 96 76 86 L84 106 Q60 114 36 106 Z" fill="${sc}"/>`;
    s += `<ellipse cx="38" cy="57" rx="4" ry="7" fill="${shade(sk, 0.92)}"/><ellipse cx="82" cy="57" rx="4" ry="7" fill="${shade(sk, 0.92)}"/>`;
    s += `<path d="${face}" fill="${sk}"/>`;
    if (hairOn) s += `<path d="M38 50 Q36 23 60 22 Q84 23 82 50 Q79 37 60 36 Q41 37 38 50 Z" fill="${hc}"/>`;
    s += `<g fill="none" stroke="${browOf(a)}" stroke-width="2.2" stroke-linecap="round"><path d="M46 48.5 q5 -3 10 -0.5"/><path d="M64 48 q5 -2.5 10 0.5"/></g>`;
    for (const x of [51, 69]) s += `<ellipse cx="${x}" cy="55" rx="4.6" ry="3" fill="#f4f1ec"/><circle cx="${x}" cy="55" r="2.4" fill="#4a3222"/><circle cx="${x}" cy="55" r="1" fill="#101012"/>`;
    s += `<path d="M60.5 57 q-3.5 9 -1.5 11 q1.5 1 3.5 0" fill="none" stroke="${shade(sk, 0.72)}" stroke-width="1.5" stroke-linecap="round"/>`;
    if (a.beard === 'full') s += `<path d="M39 58 Q40 80 50 86 Q60 91 70 86 Q80 80 81 58 Q78 70 71 72 Q60 69 49 72 Q42 70 39 58 Z" fill="${hc}"/><path d="M52 71 Q60 67 68 71 Q60 74 52 71 Z" fill="${hc}"/>`;
    s += `<path d="M53 73 q7 4 14 0" fill="none" stroke="${a.beard === 'full' ? shade(hc, 0.6) : lipOf(sk)}" stroke-width="2.4" stroke-linecap="round"/>`;
    if (scarf) s += `<path fill-rule="evenodd" d="M32 54 Q31 19 60 19 Q89 19 88 54 Q89 80 76 90 Q60 98 44 90 Q31 80 32 54 Z M43 53 Q43 35 60 35 Q77 35 77 53 Q77 68 70 76 Q60 83 50 76 Q43 68 43 53 Z" fill="${sc}"/>`;
    if (a.eyes === 'glasses') s += '<g fill="none" stroke="#22252b" stroke-width="2.4"><rect x="43" y="49" width="15" height="12" rx="2"/><rect x="62" y="49" width="15" height="12" rx="2"/><path d="M58 55 h4"/></g>';
    if (a.eyes === 'safety') s += '<rect x="41" y="48" width="38" height="14" rx="6" fill="rgba(150,205,240,.5)" stroke="#22252b" stroke-width="1.8"/>';
    if (HAT_COLORS[hat]) { const c = HAT_COLORS[hat]; s += `<path d="M35 43 Q35 16 60 15 Q85 16 85 43 Z" fill="${c}"/><rect x="29" y="40" width="62" height="6" rx="3" fill="${shade(c, 0.88)}"/><rect x="57" y="15" width="6" height="26" rx="3" fill="${shade(c, 0.9)}"/>`; }
    if (hat === 'cap') s += `<path d="M37 43 Q37 19 60 19 Q83 19 83 43 Z" fill="${shade(a.shirt, 0.8)}"/><path d="M60 39 L97 42 Q98 47 93 47 L60 45 Z" fill="${shade(a.shirt, 0.66)}"/>`;
    if (hat === 'beanie') s += `<path d="M37 44 Q36 14 60 14 Q84 14 83 44 Z" fill="${shade(a.shirt, 0.8)}"/><rect x="35" y="36" width="50" height="10" rx="4" fill="${shade(a.shirt, 0.62)}"/>`;
    if (hat === 'headphones') s += '<path d="M35 56 Q33 17 60 17 Q87 17 85 56" fill="none" stroke="#22252b" stroke-width="4"/><rect x="29" y="48" width="10" height="18" rx="4" fill="#22252b"/><rect x="81" y="48" width="10" height="18" rx="4" fill="#22252b"/>';
    s += '</svg>';
    container.innerHTML = s;
  }

  window.VSNAvatar = { OPTIONS, load, build, dispose, svg, get ready() { return lib.ready; }, EYE_M, SCALE };
})();
