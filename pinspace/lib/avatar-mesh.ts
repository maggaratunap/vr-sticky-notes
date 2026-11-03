import * as T from 'three';
import { normalizeAvatar } from './avatar.ts';

/** Small head-and-shoulders avatar. Origin is the participant's eye position. */
export function createAvatarMesh(value: unknown) {
    const a = normalizeAvatar(value), group = new T.Group();
    const material = (color: string) => new T.MeshStandardMaterial({ color, roughness: .85 });
    const skin = material(a.skin), shirt = material(a.shirt), hair = material(a.hair), ink = material('#27313b');
    function add(name: string, geometry: T.BufferGeometry, mat: T.Material, position: [number, number, number], scale: [number, number, number] = [1, 1, 1]) {
        const mesh = new T.Mesh(geometry, mat); mesh.name = name; mesh.position.set(...position); mesh.scale.set(...scale); group.add(mesh); return mesh;
    }
    add('head', new T.SphereGeometry(.17, 16, 12), skin, [0, 0, 0], [1, 1.12, .94]);
    add('neck', new T.CylinderGeometry(.065, .07, .13, 8), skin, [0, -.2, 0]);
    add('shirt', new T.CapsuleGeometry(.15, .17, 4, 12), shirt, [0, -.45, -.01], [1.45, 1, .75]);
    for (const side of [-1, 1]) {
        add('sleeve', new T.CapsuleGeometry(.07, .13, 4, 8), shirt, [side * .23, -.4, 0]);
        add('hand', new T.SphereGeometry(.062, 8, 6), skin, [side * .23, -.59, .015]);
        add('eye', new T.SphereGeometry(.013, 8, 6), ink, [side * .06, .025, .153]);
    }
    add('nose', new T.SphereGeometry(.022, 8, 6), skin, [0, -.02, .167]);
    if (a.style === 'short' || a.style === 'bob') {
        add('hair', new T.SphereGeometry(.178, 16, 8, 0, Math.PI * 2, 0, Math.PI * .47), hair, [0, .01, -.012], [1.02, 1.12, 1]);
        if (a.style === 'bob') add('long-hair', new T.SphereGeometry(.175, 12, 8), hair, [0, -.055, -.07], [1.06, 1.3, .63]);
    }
    if (a.style === 'hardhat') {
        const hat = material('#e9b54b');
        add('hardhat', new T.SphereGeometry(.19, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat, [0, .08, 0], [1, .8, 1]);
        add('hardhat-brim', new T.CylinderGeometry(.218, .218, .026, 20), hat, [0, .08, .025], [1, 1, 1.06]);
    }
    if (a.glasses) {
        for (const side of [-1, 1]) add('glasses', new T.TorusGeometry(.041, .006, 5, 16), ink, [side * .06, .025, .173]);
        add('glasses-bridge', new T.BoxGeometry(.04, .009, .01), ink, [0, .025, .175]);
    }
    return group;
}
