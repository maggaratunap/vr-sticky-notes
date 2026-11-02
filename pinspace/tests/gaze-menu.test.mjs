import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {GazeMenuAnchor} from '../lib/vr-controls.ts';
import {shortcutPosition,shortcutTarget} from '../lib/room-shortcuts.ts';
test('gaze menu remains fixed as the head turns toward each of its nine buttons',()=>{
 const anchor=new GazeMenuAnchor(),eye=new T.Vector3(0,1.65,8),forward=[0,0,-1];const original=anchor.place(eye.toArray(),forward);
 const menu=new T.Group();menu.position.fromArray(original.position);menu.rotation.y=original.yaw;
 const buttons=Array.from({length:9},(_,i)=>{const b=new T.Mesh(new T.PlaneGeometry(.34,.12),new T.MeshBasicMaterial());b.position.set((i%3-1)*.38,-Math.floor(i/3)*.16,0);menu.add(b);return b;});menu.updateMatrixWorld(true);
 for(const button of buttons){const target=button.localToWorld(new T.Vector3(.03,.01,0));const headDirection=target.clone().sub(eye).normalize();const next=anchor.place(eye.toArray(),headDirection.toArray());assert.deepEqual(next,original);const ray=new T.Raycaster(eye,headDirection);assert.equal(ray.intersectObjects(buttons)[0]?.object?.uuid,button.uuid,'gaze ray reaches the intended button');}
});
test('menu follows translation, stays level, and recenters only when requested',()=>{const a=new GazeMenuAnchor();const first=a.place([0,1.65,0],[0,0,-1]);const moved=a.place([4,2,6],[1,.9,0]);assert.deepEqual(moved.position,[4,1.52,4.1]);assert.equal(moved.yaw,first.yaw);a.reset();const centered=a.place([4,2,6],[1,.9,0]);assert.deepEqual(centered.position,[5.9,1.52,6]);assert.ok(Math.abs(centered.yaw+Math.PI/2)<1e-10);a.reset();assert.ok(a.place([0,1.65,0],[0,1,0]).position.every(Number.isFinite));});
test('shortcut destination and placement reject self links, malformed room IDs and invalid coordinates',()=>{assert.equal(shortcutTarget('abcdef12','12345678'),'abcdef12');assert.throws(()=>shortcutTarget('12345678','12345678'));assert.throws(()=>shortcutTarget('session-lounge','12345678'));assert.deepEqual(shortcutPosition([0,1.5,-4]),[0,1.5,-4]);for(const v of [[0,NaN,0],[0,0],[1e9,0,0],null])assert.throws(()=>shortcutPosition(v));});
