import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createServer } from 'vite';

function fixtureGlb(animated) {
    const geometry = new T.BoxGeometry(2, 1, 1);
    const bufferViews = [], chunks = [];
    let byteLength = 0;
    function addBuffer(array) {
        const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
        bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
        byteLength += bytes.length;
        chunks.push(bytes);
        return bufferViews.length - 1;
    }
    const accessors = [
        { bufferView: addBuffer(geometry.attributes.position.array), componentType: 5126, type: 'VEC3', count: 24, min: [-1, -.5, -.5], max: [1, .5, .5] },
        { bufferView: addBuffer(geometry.attributes.normal.array), componentType: 5126, type: 'VEC3', count: 24 },
        { bufferView: addBuffer(geometry.index.array), componentType: 5123, type: 'SCALAR', count: 36 },
    ];
    const gltf = {
        asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
        nodes: [{ name: 'Test block', mesh: 0, translation: [5, 0, 0] }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [.06, .47, .62, 1], metallicFactor: 0 } }],
        buffers: [{ byteLength: 0 }], bufferViews, accessors,
    };
    if (animated) {
        accessors.push({ bufferView: addBuffer(new Float32Array([0, 1])), componentType: 5126, type: 'SCALAR', count: 2, min: [0], max: [1] });
        gltf.animations = ['Lift', 'Slide'].map((name, index) => {
            const end = index === 0 ? [5, 2, 0] : [8, 0, 0];
            accessors.push({ bufferView: addBuffer(new Float32Array([5, 0, 0, ...end])), componentType: 5126, type: 'VEC3', count: 2 });
            return { name, samplers: [{ input: 3, output: accessors.length - 1 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] };
        });
    }
    gltf.buffers[0].byteLength = byteLength;
    const json = Buffer.from(JSON.stringify(gltf));
    const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
    header.write('glTF'); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + paddedJson.length + byteLength, 8);
    header.writeUInt32LE(paddedJson.length, 12); header.write('JSON', 16);
    binHeader.writeUInt32LE(byteLength); binHeader.write('BIN\0', 4);
    geometry.dispose();
    return Buffer.concat([header, paddedJson, binHeader, ...chunks]);
}

test('animated GLB upload playback survives recentering, supports VR controls and releases when the model changes', async () => {
    const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
    const previousProgressEvent = globalThis.ProgressEvent;
    globalThis.ProgressEvent ??= class ProgressEvent extends Event {};
    const animated = URL.createObjectURL(new Blob([fixtureGlb(true)]));
    const still = URL.createObjectURL(new Blob([fixtureGlb(false)]));
    try {
        const { Viewer } = await vite.ssrLoadModule('/lib/viewer.ts');
        const viewer = Object.create(Viewer.prototype);
        Object.assign(viewer, {
            model: new T.Group(), pins: new T.Group(), pdfGroup: new T.Group(), vrMenu: new T.Group(),
            loadVersion: 0, buttons: [], isXR: true,
            manipulator: { finish() {}, prepare() {}, loaded() {} },
            fit() {}, canvasText: label => label, plane: label => Object.assign(new T.Object3D(), { name: label }),
        });
        assert.equal(await viewer.loadModel(animated, 'animated'), true);
        assert.deepEqual(viewer.getModelAnimationState(), { clips: ['Lift', 'Slide'], index: 0, playing: true });
        const block = viewer.model.getObjectByName('Test_block');
        assert.ok(block);
        const point = () => block.getWorldPosition(new T.Vector3()).toArray();
        const start = point();
        assert.equal(start[0], 0);
        viewer.updateModelAnimation(.25);
        assert.equal(point()[1], start[1] + .5);
        const click = label => viewer.buttons.find(button => button.name === label).userData.action();
        click('Animation');
        click('Pause');
        const paused = point();
        viewer.updateModelAnimation(.25);
        assert.deepEqual(point(), paused);
        click('Restart');
        assert.deepEqual(point(), start);
        assert.equal(viewer.getModelAnimationState().playing, false);
        click('Next clip');
        viewer.updateModelAnimation(.25);
        assert.equal(point()[0], .75);
        viewer.setPresentationContent('pdf');
        assert.equal(viewer.getModelAnimationState(), null);
        viewer.updateModelAnimation(.25);
        assert.equal(point()[0], .75);
        viewer.setPresentationContent('model');
        viewer.updateModelAnimation(.25);
        assert.equal(point()[0], 1.5);
        assert.equal(await viewer.loadModel(still, 'static'), true);
        assert.equal(viewer.modelAnimation, null);
        assert.equal(viewer.buttons.some(button => button.name === 'Animation'), false);
    } finally {
        if (previousProgressEvent === undefined) delete globalThis.ProgressEvent;
        else globalThis.ProgressEvent = previousProgressEvent;
        URL.revokeObjectURL(animated);
        URL.revokeObjectURL(still);
        await vite.close();
    }
});
