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

  // Movement for every device:
  //  - desktop: WASD / arrow keys (relative to where you look), Q / E to turn
  //  - headset: left thumbstick to walk, right thumbstick to snap-turn
  //  - phone / Cardboard / laser: glideTo() when someone taps or aims at the floor
  // Fly mode (fly: true) removes gravity: you move where you look, including up and down,
  //  - desktop: Space rises, Shift or C sinks
  //  - headset: right thumbstick up / down rises and sinks
  //  - phone: hold the on-screen up / down buttons (setVertical), tap the sky to fly toward it
  AFRAME.registerComponent('rig-move', {
    schema: {
      speed: { default: 2.2 },
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
      this.snapReady = true;
      this.glide = null;
      this.fwd = new THREE.Vector3();
      this.right = new THREE.Vector3();
      this.camPos = new THREE.Vector3();

      window.addEventListener('keydown', (e) => {
        if (isTypingTarget(e.target)) return;
        this.keys[e.code] = true;
        // keep Space from "pressing" whichever button was last tapped
        if (this.data.fly && e.code === 'Space') e.preventDefault();
      });
      window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
      window.addEventListener('blur', () => { this.keys = {}; this.vertical = 0; });

      const onStick = (axis) => (e) => { axis.x = e.detail.x || 0; axis.y = e.detail.y || 0; };
      if (this.data.left) this.data.left.addEventListener('thumbstickmoved', onStick(this.axisL));
      if (this.data.right) this.data.right.addEventListener('thumbstickmoved', onStick(this.axisR));
    },

    update: function (old) {
      // Landing: when flying is switched off, glide back down to the floor.
      if (old && old.fly && !this.data.fly) {
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
    groundAt: function (x, z, fromY) {
      const now = performance.now();
      if (!this.floors || now - this.floorsAt > 1000) {
        this.floors = [...document.querySelectorAll('.floor')].map((e) => e.object3D).filter(Boolean);
        this.floorsAt = now;
        if (!this.downRay) this.downRay = new THREE.Raycaster();
      }
      this.downRay.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
      this.downRay.far = fromY + 1;
      const hit = this.downRay.intersectObjects(this.floors, true)[0];
      return hit ? hit.point.y : 0;
    },

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
      let v = 0;
      if (fly) {
        v = (k.Space ? 1 : 0) - (k.ShiftLeft || k.ShiftRight || k.KeyC ? 1 : 0) + this.vertical;
        if (Math.abs(this.axisR.y) > 0.4) v += -this.axisR.y;
      }

      if (f || s || v) {
        this.glide = null;
        this.data.camera.object3D.getWorldDirection(this.fwd); // +Z of the camera entity = backwards
        this.fwd.negate();
        const flat = this.fwd.clone(); flat.y = 0;
        if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
        flat.normalize();
        if (!fly) this.fwd.copy(flat); else this.fwd.normalize(); // flying follows your gaze up and down
        this.right.crossVectors(flat, UP).normalize();
        const step = (fly ? this.data.flySpeed : this.data.speed) * dt;
        rig.position.addScaledVector(this.fwd, f * step);
        rig.position.addScaledVector(this.right, s * step);
        rig.position.y += v * step;
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
      if (!fly && !this.glide) {
        this.cameraWorld(this.camPos);
        const ground = this.groundAt(this.camPos.x, this.camPos.z, rig.position.y + 1.2);
        rig.position.y += (ground - rig.position.y) * Math.min(1, dt * 12);
        if (Math.abs(ground - rig.position.y) < 0.002) rig.position.y = ground;
      }
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

  // Smoothly moves a remote avatar toward the latest pose received.
  AFRAME.registerComponent('avatar-lerp', {
    init: function () {
      this.targetP = this.el.object3D.position.clone();
      this.targetQ = new THREE.Quaternion();
      this.headQ = new THREE.Quaternion();
      this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
      this.head = null;
      this.body = null;
    },
    setTarget: function (p, q) {
      this.targetP.fromArray(p);
      this.targetQ.fromArray(q);
    },
    tick: function (t, dtMs) {
      const dt = Math.min(dtMs / 1000, 0.1);
      const a = 1 - Math.exp(-dt * 12);
      this.el.object3D.position.lerp(this.targetP, a);
      this.headQ.slerp(this.targetQ, a);
      if (!this.head) this.head = this.el.querySelector('.av-head');
      if (!this.body) this.body = this.el.querySelector('.av-body');
      if (this.head) this.head.object3D.quaternion.copy(this.headQ);
      if (this.body) {
        this.euler.setFromQuaternion(this.headQ);
        this.body.object3D.rotation.set(0, this.euler.y, 0);
      }
    }
  });
})();
