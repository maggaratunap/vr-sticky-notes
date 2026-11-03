import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { movementDelta, GazeMenuAnchor } from '../lib/vr-controls.ts';

test('flight follows pitch while walking stays level, and vertical input works only in flight', () => {
    const forward = [0, Math.SQRT1_2, -Math.SQRT1_2];
    const fly = movementDelta(forward, 0, -1, 0, true, .05);
    assert.ok(fly.y > .1 && fly.z < -.1);
    assert.equal(movementDelta(forward, 0, -1, 1, false, .05).y, 0);
    assert.ok(Math.abs(movementDelta([0, 0, -1], 0, 0, 1, true, .05).y - .15) < 1e-9);
    assert.ok(Math.abs(movementDelta([0, 0, -1], 0, 0, -1, true, .05).y + .15) < 1e-9);
});

test('mixed flight input never exceeds speed limit and looking straight up remains stable', () => {
    for (const forward of [[0, 1, 0], [0, -1, 0], [1, .5, -.5], [NaN, Infinity, 0]]) {
        const delta = movementDelta(forward, 2, -2, 2, true, 10);
        assert.ok(Object.values(delta).every(Number.isFinite));
        assert.ok(Math.hypot(delta.x, delta.y, delta.z) <= .150001);
    }
    const one = movementDelta([0, 0, -1], 0, -1, 0, true, .05);
    const diagonal = movementDelta([0, 0, -1], 1, -1, 1, true, .05);
    assert.ok(Math.abs(Math.hypot(...Object.values(one)) - Math.hypot(...Object.values(diagonal))) < 1e-9);
});

test('desktop, touch, Cardboard and Quest inputs move the actual camera/rig and stop cleanly', async () => {
    const { createServer } = await import('vite');
    const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
    try {
        const { Viewer } = await vite.ssrLoadModule('/lib/viewer.ts');
        const view = Object.create(Viewer.prototype);
        Object.assign(view, {
            camera: new T.PerspectiveCamera(80, 1, .05, 5000), controls: { target: new T.Vector3(), enabled: true },
            rig: new T.Group(), input: new T.Vector3(), keys: new Set(), keyboard: new T.Group(),
            walking: false, flying: false, isXR: false, liftInput: 0, snapArmed: true,
            makeVRMenu() {}, onFlyChange: null,
        });
        view.blur = Viewer.prototype.stopMovement.bind(view);
        view.keyboard.visible = false;
        view.camera.position.set(3, 6, 9);
        view.camera.rotation.x = Math.PI / 4;
        view.setFly(true);
        assert.deepEqual(view.camera.position.toArray(), [3, 6, 9], 'enter flight without teleporting');
        view.keys.add('w'); view.updateMovement(.05);
        assert.ok(view.camera.position.y > 6 && view.camera.position.z < 9);
        view.blur();
        const stopped = view.camera.position.clone(); view.updateMovement(.05);
        assert.deepEqual(view.camera.position.toArray(), stopped.toArray());
        view.lift(1); view.moveInput(1, 0); view.updateMovement(.05);
        assert.ok(view.camera.position.x > stopped.x && view.camera.position.y > stopped.y);
        view.lift(0); view.moveInput(0, 0);
        const beforeStep = view.camera.position.clone(); view.step(); view.flyStep(1);
        assert.ok(view.camera.position.y > beforeStep.y + .75 && view.camera.position.z < beforeStep.z);
        const beforeTap = view.camera.position.clone(); view.activateHit(undefined);
        assert.ok(view.camera.position.y > beforeTap.y && view.camera.position.z < beforeTap.z, 'Cardboard gaze and tap also flies into empty space');
        view.placing = true;
        const typingNote = view.camera.position.clone(); view.activateHit(undefined);
        assert.deepEqual(view.camera.position.toArray(), typingNote.toArray(), 'note placement never becomes a flight tap');
        view.placing = false;
        view.avatarMenu = true; const editingAvatar = view.camera.position.clone(); view.activateHit(undefined);
        assert.deepEqual(view.camera.position.toArray(), editingAvatar.toArray(), 'avatar editing blocks flight taps'); view.avatarMenu = false;
        // Quest moves the rig, preserving the headset-local pose and right-stick snap turns.
        view.isXR = true;
        const local = view.camera.position.clone();
        view.renderer = { xr: { getCamera: () => view.camera, getSession: () => ({ inputSources: [
            { handedness: 'left', gamepad: { axes: [0, 0, 0, -.5] } },
            { handedness: 'right', gamepad: { axes: [0, 0, 0, -1] } },
        ] }) } };
        view.updateMovement(.05);
        assert.ok(view.rig.position.y > 0 && view.rig.position.z < 0);
        assert.deepEqual(view.camera.position.toArray(), local.toArray());
        const hover = view.rig.position.clone(); view.keyboard.visible = true; view.updateMovement(.05);
        assert.deepEqual(view.rig.position.toArray(), hover.toArray(), 'typing in-world pauses movement');
        view.setFly(false);
        assert.equal(view.liftInput, 0); assert.equal(view.keys.size, 0);
    } finally { await vite.close(); }
});

test('every flight menu control remains reachable by gaze without following head rotation', async () => {
    const { createServer } = await import('vite');
    const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
    try {
        const { Viewer } = await vite.ssrLoadModule('/lib/viewer.ts');
        const view = Object.create(Viewer.prototype);
        Object.assign(view, {
            buttons: [], vrMenu: new T.Group(), flying: true, hallMode: false, placing: false, removeMode: false,
            canvasText: label => label,
            plane: (label, w, h) => { const b = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial()); b.name = label; return b; },
        });
        view.makeVRMenu();
        for (const label of ['Fly ON', 'Up', 'Down', 'Step', 'Note', 'Mic', 'Exit']) assert.ok(view.vrMenu.children.some(b => b.name === label));
        const anchor = new GazeMenuAnchor(), eye = new T.Vector3(0, 8, 0);
        const original = anchor.place(eye.toArray(), [0, 0, -1]);
        view.vrMenu.position.fromArray(original.position); view.vrMenu.rotation.y = original.yaw; view.vrMenu.updateMatrixWorld(true);
        for (const b of view.vrMenu.children) {
            const dir = b.localToWorld(new T.Vector3(.03, .01, 0)).sub(eye).normalize();
            assert.deepEqual(anchor.place(eye.toArray(), dir.toArray()), original);
            assert.equal(new T.Raycaster(eye, dir).intersectObjects(view.vrMenu.children)[0]?.object?.name, b.name);
            assert.ok(Math.acos(dir.dot(new T.Vector3(0, 0, -1))) < 40 * Math.PI / 180, 'inside the default Cardboard aperture');
        }
        view.clear(view.vrMenu);
    } finally { await vite.close(); }
});
