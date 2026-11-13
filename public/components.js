/* A-Frame components used by VR Sticky Notes.
   Loaded in <head> so they exist before the scene is parsed. */
(function () {
  'use strict';
  const THREE = AFRAME.THREE;
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function isTypingTarget(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  // A-Frame's touch-to-look reads the first finger anywhere on screen, so holding the joystick
  // would block looking around. Make it follow only the finger touching the 3D view.
  (function patchLookControls() {
    const LC = AFRAME.components['look-controls'] && AFRAME.components['look-controls'].Component.prototype;
    if (!LC || LC.__touchPatched) return;
    const onStart = LC.onTouchStart, onMove = LC.onTouchMove;
    const own = (evt) => ({ touches: evt.targetTouches || evt.touches, preventDefault: () => evt.preventDefault() });
    LC.onTouchStart = function (evt) { return onStart.call(this, own(evt)); };
    LC.onTouchMove = function (evt) { return onMove.call(this, own(evt)); };
    LC.__touchPatched = true;
  })();

  // Keeps an entity's Y axis upright and turns it to face the viewer (name tags).
  AFRAME.registerComponent('billboard', {
    tick: function () {
      const cam = this.el.sceneEl.camera;
      if (!cam) return;
      cam.getWorldPosition(tmpV);
      this.el.object3D.getWorldPosition(tmpV2);
      tmpV.y = tmpV2.y;
      this.el.object3D.lookAt(tmpV);
    }
  });

  // Height of the walkable surface (floor, steps, stage, booth floors) under (x, z).
  // Shared by your own movement and by other people's avatars.
  const ground = { floors: null, at: 0, ray: null, from: new THREE.Vector3(), down: new THREE.Vector3(0, -1, 0) };
  window.VSNGroundAt = function (x, z, fromY) {
    const now = performance.now();
    if (!ground.floors || now - ground.at > 1000) {
      ground.floors = [...document.querySelectorAll('.floor')].map((e) => e.object3D).filter(Boolean);
      ground.at = now;
      if (!ground.ray) ground.ray = new THREE.Raycaster();
    }
    ground.ray.set(ground.from.set(x, fromY, z), ground.down);
    ground.ray.far = fromY + 1;
    const hit = ground.ray.intersectObjects(ground.floors, true)[0];
    return hit ? hit.point.y : 0;
  };

  // Movement for every device:
  //  - desktop: WASD / arrow keys (relative to where you look), Q / E to turn,
  //    Shift to sprint, Space to jump
  //  - headset: left thumbstick to walk (click it to sprint), right thumbstick to snap-turn
  //    (click it to jump)
  //  - phone: on-screen stick, plus Run and Jump buttons (setSprint / jump)
  //  - phone / Cardboard / laser: glideTo() when someone taps or aims at the floor
  // Fly mode (fly: true) removes gravity: you move where you look, including up and down,
  //  - desktop: Space rises, Shift or C sinks
  //  - headset: right thumbstick up / down rises and sinks
  //  - phone: hold the on-screen up / down buttons (setVertical), tap the sky to fly toward it
  AFRAME.registerComponent('rig-move', {
    schema: {
      speed: { default: 1.9 },
      sprintSpeed: { default: 4.4 },
      jumpSpeed: { default: 3.3 },   // about 0.55 m high, 0.65 s in the air
      gravity: { default: 9.8 },
      flySpeed: { default: 3.5 },
      bounds: { default: 9.2 },
      ceiling: { default: 60 },
      fly: { default: false },
      camera: { type: 'selector', default: '#cam' },
      left: { type: 'selector', default: '#leftHand' },
      right: { type: 'selector', default: '#rightHand' }
    },
    init: function () {
      this.keys = {};
      this.axisL = { x: 0, y: 0 };
      this.axisR = { x: 0, y: 0 };
      this.vertical = 0;
      this.joy = { x: 0, y: 0 };  // on-screen move stick (phones and tablets)
      this.look = { x: 0, y: 0 }; // on-screen look stick
      this.snapReady = true;
      this.glide = null;
      this.sprintLock = false;  // Run button (phones) or a thumbstick click (headsets)
      this.vy = 0;              // vertical speed while jumping
      this.onGround = true;
      this.jumpBuffer = 0;      // seconds a jump request stays valid (a press just before landing still counts)
      this.moving = false;      // walking or gliding this frame (for your avatar's state)
      this.fwd = new THREE.Vector3();
      this.right = new THREE.Vector3();
      this.camPos = new THREE.Vector3();

      window.addEventListener('keydown', (e) => {
        if (isTypingTarget(e.target)) return;
        this.keys[e.code] = true;
        if (e.code === 'Space') {
          // keep Space from "pressing" whichever button was last tapped
          e.preventDefault();
          if (!e.repeat && !this.data.fly) this.jump();
        }
      });
      window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
      window.addEventListener('blur', () => { this.keys = {}; this.vertical = 0; });

      const onStick = (axis) => (e) => { axis.x = e.detail.x || 0; axis.y = e.detail.y || 0; };
      if (this.data.left) this.data.left.addEventListener('thumbstickmoved', onStick(this.axisL));
      if (this.data.right) this.data.right.addEventListener('thumbstickmoved', onStick(this.axisR));
      // headset: click the left stick to toggle sprinting, click the right stick to jump
      if (this.data.left) this.data.left.addEventListener('thumbstickdown', () => this.setSprint(!this.sprintLock));
      if (this.data.right) this.data.right.addEventListener('thumbstickdown', () => this.jump());
    },

    // Ask for a jump. It happens on the next frame you are standing on something.
    jump: function () { if (!this.data.fly) this.jumpBuffer = 0.2; },
    setSprint: function (on) {
      this.sprintLock = !!on;
      this.el.emit('sprint-changed', { on: this.sprintLock });
    },
    isSprinting: function () {
      const k = this.keys;
      return !this.data.fly && (this.sprintLock || !!(k.ShiftLeft || k.ShiftRight));
    },
    // 0 standing or walking, 1 sprinting, 2 in the air, 3 flying (sent with your pose)
    motionState: function () {
      if (this.data.fly) return 3;
      if (!this.onGround) return 2;
      return this.moving && this.isSprinting() ? 1 : 0;
    },

    update: function (old) {
      // Landing: when flying is switched off, glide back down to the floor.
      if (old && old.fly && !this.data.fly) {
        this.vy = 0; this.onGround = true;
        const from = this.el.object3D.position.clone();
        const cam = this.cameraWorld(new THREE.Vector3());
        const to = from.clone(); to.y = this.groundAt(cam.x, cam.z, from.y + 2.5);
        this.glide = { from, to, t: 0, dur: Math.min(1.2, 0.4 + from.y * 0.08) };
      }
      if (!this.data.fly) this.vertical = 0;
    },

    cameraWorld: function (out) {
      return this.data.camera.object3D.getWorldPosition(out);
    },

    // Height of the walkable surface (floor, steps, stage) under (x, z).
    groundAt: function (x, z, fromY) { return window.VSNGroundAt(x, z, fromY); },

    // Move the rig so the viewer's head ends up above (x, z), standing on whatever is there.
    // In fly mode this also lands you.
    glideTo: function (x, z, y) {
      this.cameraWorld(this.camPos);
      const from = this.el.object3D.position.clone();
      const to = from.clone();
      to.x += x - this.camPos.x;
      to.z += z - this.camPos.z;
      to.y = y != null ? y : this.groundAt(x, z, 20);
      this.glide = { from, to, t: 0 };
    },

    // Fly a set distance along a world direction (fly mode: tap the sky).
    flyToward: function (dir, dist) {
      const from = this.el.object3D.position.clone();
      const to = from.clone().addScaledVector(dir.clone().normalize(), dist);
      this.glide = { from, to, t: 0, dur: 0.7 };
    },

    setVertical: function (v) { this.vertical = v; },

    // x: -1 (left) .. 1 (right), y: -1 (forward) .. 1 (back), like a thumbstick
    setJoystick: function (x, y) { this.joy.x = x; this.joy.y = y; },
    setLook: function (x, y) { this.look.x = x; this.look.y = y; },

    snapTurn: function (deg) {
      const rig = this.el.object3D;
      const before = this.cameraWorld(new THREE.Vector3());
      rig.rotation.y += THREE.MathUtils.degToRad(deg);
      rig.updateMatrixWorld(true);
      const after = this.cameraWorld(new THREE.Vector3());
      rig.position.x += before.x - after.x;
      rig.position.z += before.z - after.z;
    },

    tick: function (t, dtMs) {
      const dt = Math.min(dtMs / 1000, 0.1);
      if (!dt) return;
      const rig = this.el.object3D;
      const k = this.keys;
      const fly = this.data.fly;

      let f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      let s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      if (Math.abs(this.axisL.y) > 0.15) f += -this.axisL.y;
      if (Math.abs(this.axisL.x) > 0.15) s += this.axisL.x;
      if (Math.hypot(this.joy.x, this.joy.y) > 0.12) { f += -this.joy.y; s += this.joy.x; }
      let v = 0;
      if (fly) {
        v = (k.Space ? 1 : 0) - (k.ShiftLeft || k.ShiftRight || k.KeyC ? 1 : 0) + this.vertical;
        if (Math.abs(this.axisR.y) > 0.4) v += -this.axisR.y;
      }

      this.moving = !!(f || s) || !!this.glide;
      if (f || s || v) {
        this.glide = null;
        this.data.camera.object3D.getWorldDirection(this.fwd); // +Z of the camera entity = backwards
        this.fwd.negate();
        const flat = this.fwd.clone(); flat.y = 0;
        if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
        flat.normalize();
        if (!fly) this.fwd.copy(flat); else this.fwd.normalize(); // flying follows your gaze up and down
        this.right.crossVectors(flat, UP).normalize();
        const step = (fly ? this.data.flySpeed : this.isSprinting() ? this.data.sprintSpeed : this.data.speed) * dt;
        rig.position.addScaledVector(this.fwd, f * step);
        rig.position.addScaledVector(this.right, s * step);
        rig.position.y += v * step;
      }

      // On-screen look stick: turn and tilt the view (adds to the phone's gyroscope).
      if (Math.hypot(this.look.x, this.look.y) > 0.08 && !this.el.sceneEl.is('vr-mode')) {
        const lc = this.data.camera.components['look-controls'];
        if (lc) {
          const cx = Math.sign(this.look.x) * this.look.x * this.look.x; // gentle near the centre
          const cy = Math.sign(this.look.y) * this.look.y * this.look.y;
          lc.yawObject.rotation.y -= cx * 2.4 * dt;
          lc.pitchObject.rotation.x = Math.max(-1.45, Math.min(1.45, lc.pitchObject.rotation.x - cy * 1.7 * dt));
        }
      }

      // Snap turn (right stick sideways, or Q / E on a keyboard).
      const turn = this.axisR.x > 0.7 || k.KeyE ? -1 : this.axisR.x < -0.7 || k.KeyQ ? 1 : 0;
      if (turn && this.snapReady) { this.snapTurn(30 * turn); this.snapReady = false; }
      if (!turn) this.snapReady = true;

      if (this.glide) {
        const g = this.glide;
        g.t = Math.min(1, g.t + dt / (g.dur || 0.45));
        const e = g.t < 0.5 ? 2 * g.t * g.t : 1 - Math.pow(-2 * g.t + 2, 2) / 2;
        rig.position.lerpVectors(g.from, g.to, e);
        if (g.t >= 1) this.glide = null;
      }

      // Walking: stand on the floor, steps or stage under you (step up and down smoothly).
      // Jumping: leave the ground at jumpSpeed and fall back under gravity.
      if (!fly && !this.glide) {
        this.cameraWorld(this.camPos);
        const ground = this.groundAt(this.camPos.x, this.camPos.z, rig.position.y + 1.2);
        if (this.jumpBuffer > 0 && !this.onGround) this.jumpBuffer -= dt;
        if (this.jumpBuffer > 0 && this.onGround) {
          this.jumpBuffer = 0;
          this.onGround = false;
          this.vy = this.data.jumpSpeed;
          this.el.emit('jumped');
        }
        if (!this.onGround) {
          this.vy -= this.data.gravity * dt;
          rig.position.y += this.vy * dt;
          if (this.vy <= 0 && rig.position.y <= ground) { rig.position.y = ground; this.vy = 0; this.onGround = true; }
        } else {
          // walking off an edge drops you; stepping up is smooth
          if (rig.position.y - ground > 0.35) { this.onGround = false; this.vy = 0; } else {
            rig.position.y += (ground - rig.position.y) * Math.min(1, dt * 12);
            if (Math.abs(ground - rig.position.y) < 0.002) rig.position.y = ground;
          }
        }
      } else if (this.glide) { this.onGround = true; this.vy = 0; }
      // Stay above the floor, under the ceiling, and inside the bounds.
      rig.position.y = Math.max(0, Math.min(this.data.ceiling, rig.position.y));
      this.cameraWorld(this.camPos);
      const b = this.data.bounds;
      if (this.camPos.x > b) rig.position.x -= this.camPos.x - b;
      if (this.camPos.x < -b) rig.position.x += -b - this.camPos.x;
      if (this.camPos.z > b) rig.position.z -= this.camPos.z - b;
      if (this.camPos.z < -b) rig.position.z += -b - this.camPos.z;
    }
  });

  // Moves someone else's avatar smoothly to its latest pose and brings the figure to life:
  // the body turns to follow the head, the head looks where the person looks, and the rigged
  // figure (avatar.js, el.avFig) stands, walks, runs, jumps or floats to match how they move.
  // Poses carry a state: 0 on the ground, 1 sprinting, 2 in the air, 3 flying.
  AFRAME.registerComponent('avatar-lerp', {
    init: function () {
      this.targetP = this.el.object3D.position.clone();
      this.targetQ = new THREE.Quaternion();
      this.headQ = new THREE.Quaternion();
      this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
      this.body = null;
      this.bodyYaw = null;
      this.turning = false;
      this.speed = 0; this.k = 1; this.state = 0;
      this.ground = 0; this.groundT = -1e9;
      this.st = { speed: 0, state: 0, lookYaw: 0, lookPitch: 0, talk: false, t: 0 };
    },
    setTarget: function (p, q, s) {
      this.targetP.fromArray(p);
      this.targetQ.fromArray(q);
      this.state = s | 0;
    },
    tick: function (t, dtMs) {
      const dt = Math.min(dtMs / 1000, 0.1);
      const a = 1 - Math.exp(-dt * 12);
      const o = this.el.object3D;
      const px = o.position.x, pz = o.position.z;
      o.position.lerp(this.targetP, a);
      if (dtMs > 1) this.speed += (Math.hypot(o.position.x - px, o.position.z - pz) / (dtMs / 1000) - this.speed) * Math.min(1, dt * 8);
      this.headQ.slerp(this.targetQ, a);
      if (!this.body) this.body = this.el.querySelector('.av-body');
      this.euler.setFromQuaternion(this.headQ);
      const yaw = this.euler.y;
      if (this.bodyYaw === null) this.bodyYaw = yaw;
      // the body follows the head when it has turned far enough, or when moving
      let d = yaw - this.bodyYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > 0.7 || this.speed > 0.25) this.turning = true;
      if (this.turning) {
        this.bodyYaw += d * (1 - Math.exp(-dt * 7));
        if (Math.abs(d) < 0.04) this.turning = false;
      }
      if (this.body) this.body.object3D.rotation.set(0, this.bodyYaw, 0);

      const fig = this.el.avFig;
      if (!fig || !o.visible) return;
      // what's underneath (checked a few times a second)
      if (t - this.groundT > 250) { this.ground = window.VSNGroundAt(o.position.x, o.position.z, o.position.y + 0.3); this.groundT = t; }
      const h = o.position.y - this.ground;
      // size the figure so its eyes meet the person's eyes when they stand (or sit) on the floor;
      // in the air it keeps its size and simply rises
      const onFloor = this.state < 2 && h < 2.4;
      if (onFloor) this.k += (THREE.MathUtils.clamp(h / fig.eye, 0.7, 1.2) - this.k) * Math.min(1, dt * 6);
      fig.root.scale.setScalar(this.k);
      fig.root.position.y = -fig.eye * this.k;
      // contact shadow on the floor, fading as the person rises
      const lift = Math.max(0, h - fig.eye * this.k);
      const sh = fig.shadow;
      sh.position.y = (0.012 - lift) / this.k;
      sh.visible = lift < 5;
      const fade = Math.max(0.35, Math.min(1, 1 - lift / 3));
      sh.scale.set(fade, 1, fade);
      // look relative to the body
      let look = yaw - this.bodyYaw;
      look = Math.atan2(Math.sin(look), Math.cos(look));
      const st = this.st;
      st.speed = this.state >= 2 ? 0 : this.speed;
      st.state = this.state;
      st.lookYaw = look;
      st.lookPitch = this.euler.x;
      st.talk = !!this.el.avSpeaking;
      st.t = t;
      fig.update(dt, st);
    }
  });
})();
