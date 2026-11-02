import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { cardboardLayout, normalizeCardboard, DEFAULT_CARDBOARD, loadCardboard, saveCardboard } from '../lib/cardboard.ts';

test('phone eye windows stay circular, level, symmetric and separated at all fit limits', () => {
    for (const [w, h] of [[844, 390], [932, 430], [2400, 1080], [390, 844], [1365, 935]]) {
        for (const lensSpacing of [38, 50, 62]) for (const viewSize of [60, 86, 94]) {
            const v = cardboardLayout(w, h, { lensSpacing, viewSize });
            assert.ok(Math.abs(v.leftX + v.rightX - w) < 1e-8);
            assert.equal(v.left.size, v.right.size);
            assert.equal(v.left.y, v.right.y);
            assert.ok(v.left.x >= 0 && v.left.x + v.left.size <= w / 2 - 2);
            assert.ok(v.right.x >= w / 2 + 2 && v.right.x + v.right.size <= w);
            assert.ok(v.left.y >= 0 && v.left.y + v.left.size <= h);
        }
    }
});

test('lens fit rejects corrupt settings and survives disabled browser storage', () => {
    assert.deepEqual(normalizeCardboard(null), DEFAULT_CARDBOARD);
    assert.deepEqual(normalizeCardboard({ lensSpacing: NaN, viewSize: -20, fov: Infinity }), { lensSpacing: 50, viewSize: 60, fov: 80 });
    assert.deepEqual(loadCardboard(), DEFAULT_CARDBOARD);
    assert.doesNotThrow(() => saveCardboard(DEFAULT_CARDBOARD));
});

test('Cardboard render clears stale pixels, draws matched square eyes and composites the mask without clearing the scene', async () => {
    const { createServer } = await import('vite');
    const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
    try {
        const { Viewer } = await vite.ssrLoadModule('/lib/viewer.ts');
        const events = [];
        const renderer = {
            autoClear: true,
            getSize(v) { return v.set(844, 390); },
            setScissorTest(on) { events.push(['scissor', on]); },
            setViewport(...rect) { events.push(['viewport', ...rect]); },
            setScissor(...rect) { events.push(['clip', ...rect]); },
            setClearColor(color) { events.push(['color', color]); },
            clear() { events.push(['clear']); },
            render(scene, camera) { events.push(['render', scene, camera, this.autoClear]); },
        };
        const view = { renderer, camera: new T.PerspectiveCamera(80, 1, .05, 5000), vrCam: new T.StereoCamera(), scene: new T.Scene(), cardboardSettings: DEFAULT_CARDBOARD, cardboardMask: null };
        view.vrCam.aspect = 1;
        Viewer.prototype.renderCardboard.call(view);
        const draws = events.filter(e => e[0] === 'render');
        assert.equal(draws.length, 3);
        assert.equal(draws[0][2], view.vrCam.cameraL);
        assert.equal(draws[1][2], view.vrCam.cameraR);
        assert.equal(draws[2][3], false);
        assert.equal(renderer.autoClear, true);
        const clips = events.filter(e => e[0] === 'clip');
        assert.equal(clips.length, 2);
        assert.equal(clips[0][3], clips[0][4]);
        assert.equal(clips[0][3], clips[1][3]);
        assert.deepEqual(events.filter(e => e[0] === 'viewport').at(-1), ['viewport', 0, 0, 844, 390]);
        assert.ok(events.findIndex(e => e[0] === 'clear') < events.findIndex(e => e[0] === 'render'));
        const uniform = view.cardboardMask.material.uniforms;
        assert.equal(uniform.centers.value.x, 211);
        assert.equal(uniform.centers.value.y, 633);
        // Equal eye magnification avoids vertical disparity; no per-eye aspect stretch.
        assert.equal(view.vrCam.cameraL.projectionMatrix.elements[5], view.vrCam.cameraR.projectionMatrix.elements[5]);
        assert.equal(view.vrCam.cameraL.projectionMatrix.elements[0], view.vrCam.cameraL.projectionMatrix.elements[5]);
        const material = view.cardboardMask.material;
        view.cardboardSettings = { lensSpacing: 44, viewSize: 70, fov: 80 };
        Viewer.prototype.renderCardboard.call(view);
        assert.equal(view.cardboardMask.material, material);
        assert.ok(uniform.centers.value.x > 211);
        assert.ok(uniform.radius.value < 167.7);
        view.cardboardMask.geometry.dispose();
        material.dispose();
    } finally { await vite.close(); }
});
