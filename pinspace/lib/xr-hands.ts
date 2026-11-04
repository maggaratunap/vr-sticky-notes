import * as T from 'three';
import type { Viewer } from './viewer';
import { PinchLatch } from './model-transform.ts';

type HandState = { id: string; pinch: PinchLatch; native: boolean; pending: boolean; engaged: boolean };
/** One gesture router for joint pinches and native WebXR hand select events. */
export class XRHands {
    host: Viewer;
    states = new Map<XRInputSource, HandState>();
    sequence = 0;
    constructor(host: Viewer) { this.host = host; }
    isHand(source: XRInputSource | undefined) { return !!source && (!!source.hand || source.profiles?.some(p => p.includes('hand'))); }
    state(source: XRInputSource) {
        let state = this.states.get(source);
        if (!state) { state = { id: 'hand:' + ++this.sequence, pinch: new PinchLatch(), native: false, pending: false, engaged: false }; this.states.set(source, state); }
        return state;
    }
    select(source: XRInputSource, down: boolean) {
        if (!this.isHand(source)) return;
        const state = this.state(source);
        if (down && !state.native) state.pending = true;
        state.native = down;
    }
    release(source: XRInputSource) { const state = this.states.get(source); if (state) this.host.manipulator.endGrab(state.id); this.states.delete(source); }
    clear() { for (const source of this.states.keys()) this.release(source); }
    update(frame?: XRFrame | null) {
        if (!this.host.isXR) return;
        frame ||= this.host.renderer.xr.getFrame();
        const session = this.host.renderer.xr.getSession(), reference = this.host.renderer.xr.getReferenceSpace();
        const sources = [...(session?.inputSources || [])];
        for (const source of this.states.keys()) if (!sources.includes(source)) this.release(source);
        if (!frame || !reference || (session?.visibilityState && session.visibilityState !== 'visible')) { this.clear(); return; }
        this.host.rig.updateWorldMatrix(true, false);
        // Sample all hands before moving either one; two-hand transforms use one frame's poses.
        const samples: { source: XRInputSource; state: HandState; point: T.Vector3 | null; ray: T.Ray; held: boolean; start: boolean }[] = [];
        for (const source of sources) {
            if (!this.isHand(source)) continue;
            const state = this.state(source);
            let thumb: XRJointPose | null = null, index: XRJointPose | null = null, pose: XRPose | null = null;
            try {
                const a = source.hand?.get('thumb-tip'), b = source.hand?.get('index-finger-tip');
                if (a && b) { thumb = frame.getJointPose?.(a, reference) || null; index = frame.getJointPose?.(b, reference) || null; }
                if (source.targetRaySpace) pose = frame.getPose(source.targetRaySpace, reference) || null;
            } catch { /* A missing pose releases this source below. */ }
            const a = thumb && new T.Vector3().copy(thumb.transform.position), b = index && new T.Vector3().copy(index.transform.position);
            const pinch = state.pinch.update(a && b ? a.distanceTo(b) : null);
            let point = a && b ? this.host.rig.localToWorld(a.add(b).multiplyScalar(.5)) : null;
            const ray = new T.Ray();
            if (pose) {
                const matrix = new T.Matrix4().fromArray(pose.transform.matrix).premultiply(this.host.rig.matrixWorld);
                ray.origin.setFromMatrixPosition(matrix); ray.direction.set(0, 0, -1).transformDirection(matrix);
                // Native hand selection can still work when articulated joints are unavailable.
                if (!source.hand && (state.native || state.pending)) point = ray.origin.clone();
            } else {
                const camera = this.host.camera;
                camera.getWorldPosition(ray.origin); camera.getWorldDirection(ray.direction);
            }
            const held = !!point && (pinch.held || state.native), start = !!point && !state.engaged && (held || state.pending);
            samples.push({ source, state, point, ray, held, start });
        }
        for (const sample of samples) {
            const { state, point, ray, held, start } = sample;
            if (!point) { this.host.manipulator.endGrab(state.id); state.engaged = false; state.native = false; state.pending = false; continue; }
            if (start) {
                // Mark before dispatch: a menu action can change modes while the pinch is held.
                state.engaged = true; this.host.ray.ray.copy(ray);
                const hit = this.host.hitFromRay();
                if (hit?.object.userData.action || this.host.placing || this.host.removeMode || this.host.keyboard.visible)
                    this.host.activateHit(hit, false);
                else if (this.host.modelMenu) this.host.manipulator.startHand(state.id, point, hit);
                else this.host.activateHit(hit, true);
            }
            state.pending = false;
            if (held) this.host.manipulator.moveHand(state.id, point);
            else { this.host.manipulator.endGrab(state.id); state.engaged = false; }
        }
    }
}
