import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createServer} from 'vite';
import {XRHands} from '../lib/xr-hands.ts';
import {ModelManipulator} from '../lib/model-manipulator.ts';
import {GazeMenuAnchor} from '../lib/vr-controls.ts';
let vite, Viewer;
before(async()=>{vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});({Viewer}=await vite.ssrLoadModule('/lib/viewer.ts'));});
after(async()=>{await vite?.close();});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≈ ${b}`);
function fixture(){
    const v=Object.create(Viewer.prototype), scene=new T.Scene(), rig=new T.Group(), camera=new T.PerspectiveCamera(60,1,.05,5000), model=new T.Group(), pins=new T.Group();
    model.add(new T.Mesh(new T.BoxGeometry(2,2,2),new T.MeshBasicMaterial()));camera.position.set(0,1.6,5);rig.add(camera);scene.add(rig,model,pins);
    const sources=[], joints=new Map(), rays=new Map(), saved=[];
    const session={inputSources:sources,visibilityState:'visible'},frame={getJointPose:joint=>joints.has(joint)?{transform:{position:joints.get(joint)}}:null,getPose:space=>rays.has(space)?{transform:{matrix:rays.get(space)}}:null};
    Object.assign(v,{scene,rig,camera,model,pins,isXR:true,stereoscopic:false,walking:false,modelMenu:false,placing:false,removeMode:false,avatarMenu:false,hallMode:false,flying:false,
        buttons:[],controllers:[],keyboard:new T.Group(),vrMenu:new T.Group(),info:new T.Group(),menuAnchor:new GazeMenuAnchor(),dwell:{reset(){}},keys:new Set(),input:new T.Vector3(),liftInput:0,ray:new T.Raycaster(),controls:{enabled:false,target:new T.Vector3()},keyboardText:'',keyboardHint:'Write a note',modelAssetId:null,
        notify(){},canvasText:text=>text,plane:(text,w,h)=>{const mesh=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.name=text;return mesh;},
        renderer:{xr:{getCamera:()=>camera,getFrame:()=>frame,getReferenceSpace:()=>({}),getSession:()=>session},clippingPlanes:[],domElement:{}},
        onPin:p=>v.openKeyboard(p,async text=>saved.push({text,point:p})),
    });
    v.keyboard.visible=false;v.info.visible=false;scene.add(v.vrMenu,v.keyboard,v.info);v.manipulator=new ModelManipulator(v);v.manipulator.loaded();v.hands=new XRHands(v);v.makeVRMenu();v.updateVRMenu();scene.updateMatrixWorld(true);
    function hand(name){
        const thumb={},index={},space={},source={handedness:name,profiles:['generic-hand-select'],hand:new Map([['thumb-tip',thumb],['index-finger-tip',index]]),targetRaySpace:space};sources.push(source);
        const h={source,thumb,index,space,point:new T.Vector3(name==='left'?-.3:.3,1.3,4),gap:.06,target:new T.Vector3(0,0,0),set(point,gap=h.gap,target=h.target){h.point.fromArray(point);h.gap=gap;h.target.copy(target);h.write();},write(){joints.set(thumb,{x:h.point.x-h.gap/2,y:h.point.y,z:h.point.z});joints.set(index,{x:h.point.x+h.gap/2,y:h.point.y,z:h.point.z});rays.set(space,new T.Matrix4().lookAt(h.point,h.target,new T.Vector3(0,1,0)).setPosition(h.point).toArray());}};h.write();return h;
    }
    function tick(){scene.updateMatrixWorld(true);v.hands.update(frame);v.updateVRMenu();scene.updateMatrixWorld(true);}
    function press(h,target){const p=target instanceof T.Vector3?target:target.getWorldPosition(new T.Vector3());h.set(h.point.toArray(),.06,p);tick();h.set(h.point.toArray(),.015,p);tick();}
    function release(h){h.set(h.point.toArray(),.06);v.hands.select(h.source,false);tick();}
    const button=name=>v.buttons.find(b=>b.name===name);
    return {v,sources,joints,rays,frame,session,saved,hand,tick,press,release,button};
}
test('joint-only hand pinches select Note, pin a surface, type and save using the real VR keyboard',async()=>{
    const f=fixture(),h=f.hand('right');f.press(h,f.button('Note'));assert.equal(f.v.placing,true);
    // Holding the same pinch cannot toggle Note off or activate a newly created button.
    f.tick();assert.equal(f.v.placing,true);f.release(h);
    h.set([.3,.2,4],.06,new T.Vector3(.3,.2,1));f.press(h,new T.Vector3(.3,.2,1));assert.equal(f.v.keyboard.visible,true);assert.equal(f.v.placing,false);f.release(h);
    f.press(h,f.button('A'));f.tick();assert.equal(f.v.keyboardText,'a');f.release(h);
    f.press(h,f.button('Save'));await Promise.resolve();assert.equal(f.saved[0].text,'a');assert.equal(f.v.keyboard.visible,false);
});
test('native select events and joint pinches share one action, and hand triggers never fall into controller teleport',()=>{
    const f=fixture(),h=f.hand('left'),controller=new T.Group();controller.userData.source=h.source;
    const target=f.button('Note').getWorldPosition(new T.Vector3());h.set(h.point.toArray(),.015,target);
    f.v.controllerSelect(controller,0);f.tick();assert.equal(f.v.placing,true);f.tick();assert.equal(f.v.placing,true);
    f.v.controllerSelect(controller,0);f.tick();assert.equal(f.v.placing,true);f.release(h);
    f.press(h,f.button('Note ON'));assert.equal(f.v.placing,false);
});
test('Model menu hand grabs resize and turn, then Note exits manipulation without blocking surface placement',()=>{
    const f=fixture(),a=f.hand('left'),b=f.hand('right');f.press(a,f.button('Model'));assert.equal(f.v.modelMenu,true);f.release(a);
    a.set([-.3,0,1.1],.015,new T.Vector3(0,0,0));b.set([.3,0,1.1],.015,new T.Vector3(0,0,0));f.tick();assert.equal(f.v.manipulator.grab.points.size,2);
    a.set([0,0,1.7]);b.set([0,0,.5]);f.tick();close(f.v.manipulator.value().scale,2);close(f.v.manipulator.value().yaw,Math.PI/2);
    f.release(a);f.release(b);a.set([-.3,1.3,4],.06);f.press(a,f.button('Note'));assert.equal(f.v.modelMenu,false);assert.equal(f.v.placing,true);assert.equal(f.v.manipulator.active,false);
});
test('tracking loss, source removal and hidden XR sessions release hands without moving the model',()=>{
    const f=fixture(),h=f.hand('left');f.v.modelMenu=true;h.set([0,0,1.1],.015);f.tick();assert.equal(f.v.manipulator.active,true);
    f.joints.delete(h.index);f.tick();assert.equal(f.v.manipulator.active,false);
    h.write();f.tick();assert.equal(f.v.manipulator.active,true);f.sources.splice(0);f.tick();assert.equal(f.v.manipulator.active,false);
    f.sources.push(h.source);f.tick();assert.equal(f.v.manipulator.active,true);f.session.visibilityState='visible-blurred';f.tick();assert.equal(f.v.manipulator.active,false);
});
test('player turn buttons work with hand pinches and preserve the tracked head position',()=>{
    const f=fixture(),h=f.hand('left');const before=f.v.camera.getWorldPosition(new T.Vector3()),heading=[...f.v.menuAnchor.heading];
    f.press(h,f.button('Turn left'));close(f.v.rig.rotation.y,Math.PI/6);close(before.distanceTo(f.v.camera.getWorldPosition(new T.Vector3())),0);assert.notDeepEqual(f.v.menuAnchor.heading,heading);
});
test('native hand rays remain usable when articulated joints are unavailable',()=>{
    const f=fixture(),h=f.hand('right');h.source.hand=null;h.set(h.point.toArray(),.06,f.button('Note').getWorldPosition(new T.Vector3()));
    f.v.hands.select(h.source,true);f.tick();assert.equal(f.v.placing,true);f.v.hands.select(h.source,false);f.tick();
});

test('Quest right-stick snap turn works inside Model mode, rearms at center and does not translate the player',()=>{
    const f=fixture();f.v.modelMenu=true;f.v.snapArmed=true;const source={handedness:'right',gamepad:{axes:[0,0,.9,0]}};f.sources.push(source);
    const before=f.v.camera.getWorldPosition(new T.Vector3());f.v.updateMovement(.05);close(f.v.rig.rotation.y,-Math.PI/6);f.v.updateMovement(.05);close(f.v.rig.rotation.y,-Math.PI/6);
    source.gamepad.axes[2]=0;f.v.updateMovement(.05);source.gamepad.axes[2]=.9;f.v.updateMovement(.05);close(f.v.rig.rotation.y,-Math.PI/3);close(before.distanceTo(f.v.camera.getWorldPosition(new T.Vector3())),0);
});
test('Cardboard player turning updates both touch and sensor heading without changing model yaw',()=>{
    const f=fixture();f.v.isXR=false;f.v.stereoscopic=true;f.v.orientationOffset=.4;const before=f.v.camera.position.clone();f.v.turnPlayer(Math.PI/6);close(f.v.orientationOffset,.4-Math.PI/6);close(f.v.camera.rotation.y,Math.PI/6);assert.ok(before.equals(f.v.camera.position));close(f.v.manipulator.value().yaw,0);
});
