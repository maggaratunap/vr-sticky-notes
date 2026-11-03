import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { DEFAULT_AVATAR, normalizeAvatar, validateAvatar, cycleAvatar, SKIN_TONES, SHIRT_COLORS, HAIR_COLORS, AVATAR_STYLES } from '../lib/avatar.ts';
import { createAvatarMesh } from '../lib/avatar-mesh.ts';

test('avatar profiles accept only supported appearance values and safely read legacy/malformed data', () => {
    const a = { skin: SKIN_TONES[4][0], shirt: SHIRT_COLORS[2][0], hair: HAIR_COLORS[4][0], style: 'hardhat', glasses: true };
    assert.deepEqual(validateAvatar(a), a);
    assert.deepEqual(normalizeAvatar(JSON.stringify(a)), a);
    for (const value of [null, [], '{broken', { style: 'unknown', skin: 'url(script)', glasses: 'true' }]) assert.deepEqual(normalizeAvatar(value), DEFAULT_AVATAR);
    for (const value of [null, [], { ...a, skin: 'red' }, { ...a, style: 'custom.glb' }, { ...a, glasses: 1 }, { ...a, owner: 'other-user' }]) assert.throws(() => validateAvatar(value));
    let cycled = { ...a };
    for (let i = 0; i < AVATAR_STYLES.length; i++) cycled = cycleAvatar(cycled, 'style');
    assert.deepEqual(cycled, a);
});

test('3D avatars reflect selected skin, clothing, headwear and glasses without loading external models', () => {
    const group = createAvatarMesh({ ...DEFAULT_AVATAR, style: 'hardhat', glasses: true, shirt: SHIRT_COLORS[1][0] });
    assert.equal(group.getObjectByName('head').material.color.getHexString(), DEFAULT_AVATAR.skin.slice(1));
    assert.equal(group.getObjectByName('shirt').material.color.getHexString(), SHIRT_COLORS[1][0].slice(1));
    assert.ok(group.getObjectByName('hardhat')); assert.ok(group.getObjectByName('glasses'));
    assert.ok(!group.getObjectByName('hair'));
    const plain = createAvatarMesh({ ...DEFAULT_AVATAR, style: 'none', glasses: false });
    assert.ok(!plain.getObjectByName('hair')); assert.ok(!plain.getObjectByName('hardhat')); assert.ok(!plain.getObjectByName('glasses'));
    for (const root of [group, plain]) root.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
});

test('peer movement and microphone state reuse avatar geometry while appearance changes rebuild only that peer', async () => {
    const { createServer } = await import('vite');
    const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
    try {
        const { Viewer } = await vite.ssrLoadModule('/lib/viewer.ts');
        const view = Object.create(Viewer.prototype);
        Object.assign(view, { avatars: new T.Group(), lastPeers: '', canvasText: () => ({ width: 512, height: 100 }) });
        const first = { id: 'first', name: 'Reviewer', pose: '[1,2,3]', mic: 0, avatar: DEFAULT_AVATAR };
        const other = { ...first, id: 'other', name: 'Other reviewer' };
        view.setPeers([first, other]);
        const original = view.avatars.children[0], second = view.avatars.children[1];
        view.setPeers([{ ...first, pose: '[4,5,6]', mic: 1 }, other]);
        assert.equal(view.avatars.children[0], original); assert.deepEqual(original.position.toArray(), [4, 5, 6]);
        assert.equal(original.userData.micIndicator.material.color.getHexString(), '42a995');
        view.setPeers([{ ...first, avatar: { ...DEFAULT_AVATAR, style: 'hardhat' } }, other]);
        assert.notEqual(view.avatars.children[1], original);
        assert.equal(view.avatars.children.find(g => g.userData.peerId === 'other'), second);
        assert.ok(view.avatars.children.find(g => g.userData.peerId === 'first').getObjectByName('hardhat'));
        view.setPeers([]); assert.equal(view.avatars.children.length, 0);
    } finally { await vite.close(); }
});

test('VR avatar controls cycle appearance in a fixed reachable menu with a self preview', async () => {
    const { createServer } = await import('vite');
    const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
    try {
        const { Viewer } = await vite.ssrLoadModule('/lib/viewer.ts');
        const view = Object.create(Viewer.prototype);
        let shared;
        Object.assign(view, { selfAvatar: { ...DEFAULT_AVATAR }, avatarMenu: true, vrMenu: new T.Group(), buttons: [],
            onAvatarChange: avatar => shared = avatar, canvasText: text => text,
            plane: (text, w, h) => { const b = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial()); b.name = text; return b; },
        });
        view.makeVRMenu();
        assert.ok(view.vrMenu.children.some(g => g.getObjectByName('head')));
        const menuButtons = view.buttons.filter(b => b.userData.menu);
        assert.equal(menuButtons.length, 6);
        view.vrMenu.position.set(0, 1.17, -1.9); view.vrMenu.updateMatrixWorld(true);
        const eye = new T.Vector3(0, 1.65, 0);
        for (const b of menuButtons) {
            const dir = b.localToWorld(new T.Vector3(.03, .01, 0)).sub(eye).normalize();
            assert.equal(new T.Raycaster(eye, dir).intersectObjects(menuButtons)[0]?.object?.name, b.name);
        }
        view.changeAvatar('style'); assert.equal(view.selfAvatar.style, 'bob'); assert.deepEqual(shared, view.selfAvatar);
        view.changeAvatar('glasses'); assert.equal(view.selfAvatar.glasses, true);
        view.clear(view.vrMenu);
    } finally { await vite.close(); }
});
