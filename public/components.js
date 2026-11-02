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
  //  - desktop: WASD / arrow keys (relative to where you look)
  //  - headset: left thumbstick to walk, right thumbstick to snap-turn
  //  - phone / Cardboard / laser: glideTo() when someone taps or gazes at the floor
  AFRAME.registerComponent('rig-move', {
    schema: {
      speed: { default: 2.2 },
      bounds: { default: 9.2 },
      camera: { type: 'selector', default: '#cam' },
      left: { type: 'selector', default: '#leftHand' },
      right: { type: 'selector', default: '#rightHand' }
    },
    init: function () {
      this.keys = {};
      this.axisL = { x: 0, y: 0 };
      this.axisR = { x: 0, y: 0 };
      this.snapReady = true;
      this.glide = null;
      this.fwd = new THREE.Vector3();
      this.right = new THREE.Vector3();
      this.camPos = new THREE.Vector3();

      window.addEventListener('keydown', (e) => { if (!isTypingTarget(e.target)) this.keys[e.code] = true; });
      window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
      window.addEventListener('blur', () => { this.keys = {}; });

      const onStick = (axis) => (e) => { axis.x = e.detail.x || 0; axis.y = e.detail.y || 0; };
      if (this.data.left) this.data.left.addEventListener('thumbstickmoved', onStick(this.axisL));
      if (this.data.right) this.data.right.addEventListener('thumbstickmoved', onStick(this.axisR));
    },

    cameraWorld: function (out) {
      return this.data.camera.object3D.getWorldPosition(out);
    },

    // Move the rig so the viewer's head ends up above (x, z).
    glideTo: function (x, z) {
      this.cameraWorld(this.camPos);
      const from = this.el.object3D.position.clone();
      const to = from.clone();
      to.x += x - this.camPos.x;
      to.z += z - this.camPos.z;
      this.glide = { from, to, t: 0 };
    },

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

      let f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      let s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      if (Math.abs(this.axisL.y) > 0.15) f += -this.axisL.y;
      if (Math.abs(this.axisL.x) > 0.15) s += this.axisL.x;

      if (f || s) {
        this.glide = null;
        this.data.camera.object3D.getWorldDirection(this.fwd); // +Z of the camera entity = backwards
        this.fwd.y = 0;
        if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, 1);
        this.fwd.normalize().negate();
        this.right.crossVectors(this.fwd, UP).normalize();
        const step = this.data.speed * dt;
        rig.position.addScaledVector(this.fwd, f * step);
        rig.position.addScaledVector(this.right, s * step);
      }

      // Snap turn (right stick, or Q / E on a keyboard).
      const turn = this.axisR.x > 0.7 || k.KeyE ? -1 : this.axisR.x < -0.7 || k.KeyQ ? 1 : 0;
      if (turn && this.snapReady) { this.snapTurn(30 * turn); this.snapReady = false; }
      if (!turn) this.snapReady = true;

      if (this.glide) {
        const g = this.glide;
        g.t = Math.min(1, g.t + dt / 0.45);
        const e = g.t < 0.5 ? 2 * g.t * g.t : 1 - Math.pow(-2 * g.t + 2, 2) / 2;
        rig.position.lerpVectors(g.from, g.to, e);
        if (g.t >= 1) this.glide = null;
      }

      // Keep the viewer inside the room.
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
