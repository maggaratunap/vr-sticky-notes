import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ModelGrab, PinchLatch, gestureModelTransform, defaultModelTransform, validModelTransform, normalizeModelTransform, rotateModelAround } from '../lib/model-transform.ts';
import { ModelManipulator } from '../lib/model-manipulator.ts';
import { XRHands } from '../lib/xr-hands.ts';
import { ModelTransformSync } from '../lib/model-transform-sync.ts';
import { GazeMenuAnchor } from '../lib/vr-controls.ts';

function fixture() {
    const model = new T.Group(), pins = new T.Group(), camera = new T.PerspectiveCamera(60, 1, .05, 5000);
    model.add(new T.Mesh(new T.BoxGeometry(2, 2, 2), new T.MeshBasicMaterial()));
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true); model.updateMatrixWorld(true);
    const captures = new Set(), changes = [];
    const host = { model, pins, camera, rig: new T.Group(), modelAssetId: null, isXR: false, stereoscopic: false, hallMode: false, modelMenu: false,
        placing: false, removeMode: false, avatarMenu: false, keyboard: { visible: false }, walking: false, controllers: [], ray: new T.Raycaster(), controls: { enabled: true }, stopMovement() {},
        renderer: { domElement: { clientHeight: 400, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }), setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) }, xr: { getCamera: () => camera, getFrame: () => null, getReferenceSpace: () => ({}), getSession: () => ({ inputSources: [] }) } },
        isModelObject(object) { for (let o = object; o; o = o.parent) if (o === model) return true; return false; },
        hitFromRay() { return this.ray.intersectObject(model, true)[0]; },
    };
    const m = new ModelManipulator(host); host.manipulator = m; m.loaded(); m.onChange = (value, final) => changes.push({ value, final });
    return { host, m, captures, changes };
}
function pointer(id, x, y, extra = {}) { return { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra }; }
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('one/two-point transforms translate in 3D, preserve the grab anchor and clamp the minimum size', () => {
    assert.deepEqual(gestureModelTransform(defaultModelTransform(), [[0, 0, 0]], [[1, -2, 3]]), { position: [1, -2, 3], scale: 1, yaw: 0 });
    const tiny = gestureModelTransform({ position: [2, 0, 0], scale: 1 }, [[-1, 0, 0], [1, 0, 0]], [[-.001, 0, 0], [.001, 0, 0]]);
    assert.equal(tiny.scale, .1); close(tiny.position[0], .2);
    const grab = new ModelGrab(); grab.begin('a', [-1, 0, 0], defaultModelTransform()); grab.begin('b', [1, 0, 0], defaultModelTransform());
    grab.move('a', [-2, 0, 0]); const scaled = grab.move('b', [2, 0, 0]); close(scaled.scale, 2);
    grab.end('b', scaled); const continued = grab.move('a', [-1.9, .2, .3]); close(continued.scale, 2); close(continued.position[0] - scaled.position[0], .1);
    assert.ok(!validModelTransform({ position: [0, 0, 0], scale: .001 })); assert.ok(!validModelTransform({ position: [0, NaN, 0], scale: 1 }));
});

test('desktop/touch drags move the object and attached notes while keeping the camera still', () => {
    const { host, m, captures, changes } = fixture(); const eye = host.camera.position.clone();
    assert.equal(m.pointerDown(pointer(1, 200, 200)), true); assert.equal(host.controls.enabled, false);
    m.pointerMove(pointer(1, 250, 150)); assert.ok(host.model.position.x > 1 && host.model.position.y > 1);
    assert.deepEqual(host.camera.position.toArray(), eye.toArray()); assert.deepEqual(host.pins.position.toArray(), host.model.position.toArray());
    const local = [.4, .2, .1]; const world = m.worldPoint(local); const recovered = m.localPoint(world); local.forEach((n, i) => close(n, recovered[i]));
    m.pointerUp(pointer(1, 250, 150)); assert.equal(m.active, false); assert.equal(host.controls.enabled, true); assert.equal(captures.size, 0); assert.equal(changes.at(-1).final, true);
});

test('mobile pinch scales and pans, then continues as a single-finger drag without a jump', () => {
    const { m, host } = fixture();
    m.pointerDown(pointer(1, 180, 200)); m.pointerDown(pointer(2, 220, 200)); m.pointerMove(pointer(2, 300, 200)); close(m.value().scale, 3);
    m.pointerUp(pointer(2, 300, 200)); const before = host.model.position.clone(); m.pointerMove(pointer(1, 185, 200));
    close(m.value().scale, 3); assert.ok(host.model.position.distanceTo(before) < .5);
    m.finish(); assert.equal(m.pointers.size, 0); assert.equal(m.active, false);
});

test('model wheel scaling is bounded, background navigation and note/control selection keep priority', () => {
    const { host, m } = fixture();
    const wheel = pointer(0, 200, 200, { deltaY: 200, deltaMode: 0 }); m.wheel(wheel); assert.ok(m.value().scale < 1); assert.ok(wheel.prevented);
    const background = pointer(0, -1000, 200, { deltaY: 200 }); m.wheel(background); assert.ok(!background.prevented);
    m.scaleTo(.000001); close(m.value().scale, .1);
    host.placing = true; assert.equal(m.pointerDown(pointer(1, 200, 200)), false); host.placing = false;
    host.hitFromRay = () => ({ object: { userData: { action() {} } } }); assert.equal(m.pointerDown(pointer(1, 200, 200)), false);
});

test('Alt-drag changes model depth, and a cancelled drag safely releases capture', () => {
    const { host, m, captures } = fixture(); m.pointerDown(pointer(1, 200, 200, { altKey: true, pointerType: 'mouse' }));
    m.pointerMove(pointer(1, 200, 250, { pointerType: 'mouse' })); assert.ok(host.model.position.z < -.5); m.finish(); assert.equal(captures.size, 0); assert.equal(host.controls.enabled, true);
});

test('Quest controller ray grabs support translation, two-controller scaling, and independent grip/trigger release', () => {
    const { host, m } = fixture(); host.isXR = true; host.modelMenu = true;
    const left = new T.Group(), right = new T.Group(); left.position.set(-.3, 0, 5); right.position.set(.3, 0, 5); host.controllers = [left, right];
    m.startController(left, 'select'); m.startController(left, 'squeeze'); m.startController(right, 'squeeze'); assert.equal(m.grab.points.size, 2);
    left.position.x = -.6; right.position.x = .6; m.updateXR(); close(m.value().scale, 2);
    m.endController(left, 'select'); assert.equal(m.grab.points.size, 2); m.endController(left, 'squeeze'); assert.equal(m.grab.points.size, 1);
    const before = host.model.position.clone(); right.position.y += .2; m.updateXR(); assert.ok(host.model.position.y > before.y);
    right.visible = false; m.updateXR(); assert.equal(m.active, false);
});

test('tracked hand pinches grab and scale, and release immediately on missing joint poses', () => {
    const { host, m } = fixture(); host.isXR = true; host.modelMenu = true;
    const positions = new Map(), sources = [];
    function hand(name, x) {
        const thumb = {}, index = {}, source = { handedness: name, hand: new Map([['thumb-tip', thumb], ['index-finger-tip', index]]) };
        const set = (center, gap = .02) => { positions.set(thumb, { x: center - gap / 2, y: 0, z: 1.1 }); positions.set(index, { x: center + gap / 2, y: 0, z: 1.1 }); };
        set(x); sources.push(source); return { source, thumb, index, set };
    }
    const a = hand('left', -.3), b = hand('right', .3);
    host.renderer.xr.getSession = () => ({ inputSources: sources });
    host.renderer.xr.getFrame = () => ({ getJointPose: joint => positions.has(joint) ? { transform: { position: positions.get(joint) } } : null });
    host.activateHit = () => {}; const hands = new XRHands(host);
    hands.update(); assert.equal(m.grab.points.size, 2);
    a.set(-.6); b.set(.6); hands.update(); close(m.value().scale, 2);
    positions.delete(a.index); hands.update(); assert.equal(m.grab.points.size, 1);
    positions.delete(b.index); hands.update(); assert.equal(m.active, false);
    const latch = new PinchLatch(); assert.equal(latch.update(.02).started, true); assert.equal(latch.update(.03).held, true); assert.equal(latch.update(.05).ended, true);
});

test('shared placement collapses input frames, orders revisions, and resolves a concurrent edit without replaying stale input', async () => {
    const writes = []; let release;
    const sync = new ModelTransformSync(async (room, body) => {
        writes.push({ room, ...body });
        if (writes.length === 1) await new Promise(resolve => release = resolve);
        return { record: { asset: body.asset, transform: body.transform, revision: body.revision + 1 } };
    });
    sync.receive('room', [{ asset: null, transform: defaultModelTransform(), revision: 4 }]);
    sync.queue('room', null, { position: [1, 0, 0], scale: 1 }); sync.queue('room', null, { position: [2, 0, 0], scale: 1 });
    const first = sync.flush(); sync.queue('room', null, { position: [3, 0, 0], scale: 2 }); release(); await first; await sync.flush();
    assert.deepEqual(writes.map(w => [w.transform.position[0], w.revision]), [[2, 4], [3, 5]]);
    let conflict; sync.onConflict = (_, record) => conflict = record;
    sync.save = async () => { throw { status: 409, data: { record: { asset: null, transform: { position: [9, 0, 0], scale: 3 }, revision: 8 } } }; };
    sync.queue('room', null, defaultModelTransform()); await sync.flush(); assert.equal(conflict.revision, 8); assert.equal(sync.pending.size, 0); assert.equal(sync.get('room', null).transform.scale, 3); sync.close();
});

test('changing rooms while a transform is saving cannot apply the old room placement to the new model', async () => {
    let release; const calls = [];
    const sync = new ModelTransformSync(async (room, body) => {
        calls.push(room); if (room === 'old') await new Promise(resolve => release = resolve);
        return { record: { asset: body.asset, transform: body.transform, revision: body.revision + 1 } };
    });
    sync.queue('old', null, { position: [20, 0, 0], scale: 2 }); const old = sync.flush();
    sync.clear(); sync.queue('new', null, { position: [1, 0, 0], scale: 1 }); release(); await old; await sync.flush();
    assert.deepEqual(calls, ['old', 'new']); assert.equal(sync.get('old', null).revision, 0); assert.equal(sync.get('new', null).transform.position[0], 1); sync.close();
});

test('Cardboard model menu buttons are fixed, gaze-reachable and perform the intended manipulation', async () => {
    const { createServer } = await import('vite');
    const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
    try {
        const { Viewer } = await vite.ssrLoadModule('/lib/viewer.ts');
        const view = Object.create(Viewer.prototype), calls = [];
        Object.assign(view, { buttons: [], vrMenu: new T.Group(), modelMenu: true, avatarMenu: false, flying: false,
            canvasText: text => text, plane: (text, w, h) => { const b = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial()); b.name = text; return b; },
            manipulator: { available: true, value: () => ({ scale: 1 }), nudge: d => calls.push(d), scaleTo: s => calls.push(s), reset: () => calls.push('reset'), bringHere: () => calls.push('bring'), rotateBy: a => calls.push(a), finish() {} },
        });
        view.makeVRMenu(); const anchor = new GazeMenuAnchor(), eye = new T.Vector3(0, 1.65, 0), fixed = anchor.place(eye.toArray(), [0, 0, -1]);
        view.vrMenu.position.fromArray(fixed.position); view.vrMenu.rotation.y = fixed.yaw; view.vrMenu.updateMatrixWorld(true);
        assert.equal(view.buttons.length, 16);
        for (const b of view.buttons) {
            const dir = b.localToWorld(new T.Vector3(.03, .01, 0)).sub(eye).normalize();
            assert.deepEqual(anchor.place(eye.toArray(), dir.toArray()), fixed);
            assert.equal(new T.Raycaster(eye, dir).intersectObjects(view.buttons)[0]?.object?.name, b.name);
        }
        view.buttons.find(b => b.name === 'Near').userData.action(); view.buttons.find(b => b.name === 'Bigger').userData.action(); view.buttons.find(b => b.name === 'Reset model').userData.action(); view.buttons.find(b => b.name === 'Rotate left').userData.action();
        assert.deepEqual(calls, ['near', 1.15, 'reset', Math.PI / 12]); view.clear(view.vrMenu);
    } finally { await vite.close(); }
});

test('horizontal model rotation keeps its center and notes attached, and accepts pre-rotation saved transforms', () => {
    const {host,m}=fixture(); host.model.children[0].position.set(3,2,1);host.model.updateMatrixWorld(true);
    const center=new T.Box3().setFromObject(host.model).getCenter(new T.Vector3());
    m.rotateTo(Math.PI/2);const after=new T.Box3().setFromObject(host.model).getCenter(new T.Vector3());close(center.distanceTo(after),0);
    close(host.model.rotation.x,0);close(host.model.rotation.z,0);close(host.pins.rotation.y,Math.PI/2);
    const local=[.2,.5,.8],world=m.worldPoint(local);const recovered=m.localPoint(world);local.forEach((n,i)=>close(n,recovered[i]));
    m.scaleTo(.5);close(m.value().yaw,Math.PI/2);m.positionTo([1,2,3]);close(m.value().yaw,Math.PI/2);m.reset();close(m.value().yaw,0);
    assert.equal(normalizeModelTransform({position:[2,3,4],scale:2}).yaw,0);
    assert.equal(validModelTransform({position:[0,0,0],scale:1,yaw:NaN}),false);
    const rotated=rotateModelAround({position:[2,0,0],scale:1,yaw:0},[0,0,0],Math.PI/2);close(rotated.position[2],-2);
});
test('Shift-drag and mobile two-finger twist rotate the model horizontally without rotating the camera', () => {
    const {host,m}=fixture();const eye=host.camera.quaternion.clone();
    m.pointerDown(pointer(1,200,200,{pointerType:'mouse',shiftKey:true}));m.pointerMove(pointer(1,250,200));close(m.value().yaw,.5);m.pointerUp(pointer(1,250,200));m.reset();
    m.pointerDown(pointer(1,180,200));m.pointerDown(pointer(2,220,200));m.pointerMove(pointer(2,180,240));close(m.value().yaw,Math.PI/2);close(m.value().scale,1);
    assert.ok(eye.equals(host.camera.quaternion));const before=m.value().yaw;m.pointerUp(pointer(2,180,240));m.pointerMove(pointer(1,185,200));close(m.value().yaw,before);m.finish();
});
test('two grabs rotate about world Y while preserving the grip midpoint and minimum size',()=>{
    const grab=new ModelGrab();grab.begin('left',[-1,0,0],defaultModelTransform());grab.begin('right',[1,0,0],defaultModelTransform());
    grab.move('left',[0,0,2],true);const value=grab.move('right',[0,0,-2],true);close(value.scale,2);close(value.yaw,Math.PI/2);close(Math.hypot(...value.position),0);
});
