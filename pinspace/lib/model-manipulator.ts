import * as T from 'three';
import type { Viewer } from './viewer';
import { ModelGrab, PinchLatch, clampModelScale, defaultModelTransform, normalizeModelTransform, scaleModelAround, type ModelTransform, type Vec3 } from './model-transform.ts';

export class ModelManipulator {
    host: Viewer;
    enabled = true;
    ready = false;
    grab = new ModelGrab();
    pointers = new Map<number, { x: number; y: number }>();
    plane = new T.Plane();
    depthDrag: { y: number; point: T.Vector3; direction: T.Vector3; units: number } | null = null;
    controllers = new Map<string, { controller: T.Object3D; depth: number; buttons: Set<string> }>();
    hands = new Map<XRInputSource, { id: string; pinch: PinchLatch }>();
    handId = 0;
    radius = 5;
    dirty = false;
    onChange: ((transform: ModelTransform, final: boolean, asset: string | null) => void) | null = null;
    onState: (() => void) | null = null;
    constructor(host: Viewer) { this.host = host; }
    get active() { return this.grab.points.size > 0; }
    get available() { return this.ready && this.host.model.visible && !this.host.hallMode; }
    get usable() { return this.available && this.enabled && !this.host.placing && !this.host.removeMode && !this.host.avatarMenu && !this.host.keyboard.visible; }
    value(): ModelTransform { return { position: this.host.model.position.toArray() as Vec3, scale: this.host.model.scale.x }; }
    prepare() { this.finish(false); this.ready = false; this.apply(defaultModelTransform()); }
    loaded(value: ModelTransform = defaultModelTransform()) {
        this.radius = Math.max(.1, new T.Box3().setFromObject(this.host.model).getBoundingSphere(new T.Sphere()).radius);
        this.ready = true; this.apply(value);
    }
    apply(value: ModelTransform, publish = false, final = false) {
        const next = normalizeModelTransform(value);
        this.host.model.position.fromArray(next.position); this.host.model.scale.setScalar(next.scale); this.host.model.updateMatrixWorld(true);
        this.host.pins.position.copy(this.host.model.position); this.host.pins.scale.copy(this.host.model.scale); this.host.pins.updateMatrixWorld(true);
        this.onState?.();
        if (publish) { this.dirty = true; this.onChange?.(next, final, this.host.modelAssetId); }
    }
    setEnabled(value: boolean) { this.finish(); this.enabled = value; this.onState?.(); }
    localPoint(point: readonly number[]) { this.host.model.updateMatrixWorld(true); return this.host.model.worldToLocal(new T.Vector3(...point)).toArray(); }
    worldPoint(point: readonly number[]) { this.host.model.updateMatrixWorld(true); return this.host.model.localToWorld(new T.Vector3(...point)).toArray(); }
    scaleTo(scale: number, anchor?: T.Vector3) {
        if (!this.available) return;
        const center = anchor || new T.Box3().setFromObject(this.host.model).getCenter(new T.Vector3());
        this.apply(scaleModelAround(this.value(), center.toArray(), clampModelScale(scale)), true, true);
    }
    positionTo(position: Vec3) { if (this.available) this.apply({ ...this.value(), position: position.map(n => Math.max(-100000, Math.min(100000, n))) as Vec3 }, true, true); }
    nudge(direction: 'left' | 'right' | 'up' | 'down' | 'near' | 'far') {
        if (!this.available) return;
        const camera = this.host.isXR ? this.host.renderer.xr.getCamera() : this.host.camera;
        const forward = camera.getWorldDirection(new T.Vector3()), right = new T.Vector3().crossVectors(forward, new T.Vector3(0, 1, 0)).normalize();
        if (right.lengthSq() < .01) right.set(1, 0, 0);
        const delta = direction === 'up' || direction === 'down' ? new T.Vector3(0, direction === 'up' ? 1 : -1, 0) :
            direction === 'left' || direction === 'right' ? right.multiplyScalar(direction === 'left' ? -1 : 1) : forward.multiplyScalar(direction === 'near' ? -1 : 1);
        delta.multiplyScalar(Math.max(.1, this.radius * this.value().scale * .08));
        this.positionTo(this.host.model.position.clone().add(delta).toArray() as Vec3);
    }
    reset() { if (this.available) { this.finish(false); this.apply(defaultModelTransform(), true, true); } }
    bringHere() {
        if (!this.available) return;
        const camera = this.host.isXR ? this.host.renderer.xr.getCamera() : this.host.camera;
        const eye = camera.getWorldPosition(new T.Vector3()), direction = camera.getWorldDirection(new T.Vector3());
        const center = new T.Box3().setFromObject(this.host.model).getCenter(new T.Vector3());
        const target = eye.addScaledVector(direction, Math.max(2, this.radius * this.value().scale * 2.2));
        this.positionTo(this.host.model.position.clone().add(target.sub(center)).toArray() as Vec3);
    }
    rayAt(x: number, y: number) {
        const rect = this.host.renderer.domElement.getBoundingClientRect();
        this.host.camera.updateMatrixWorld(true);
        this.host.ray.setFromCamera(new T.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.host.camera);
        return this.host.ray;
    }
    pointerPoint(id: number, value: { x: number; y: number }) {
        if (this.depthDrag && this.pointers.size === 1) return this.depthDrag.point.clone().addScaledVector(this.depthDrag.direction, (value.y - this.depthDrag.y) * this.depthDrag.units);
        return this.rayAt(value.x, value.y).ray.intersectPlane(this.plane, new T.Vector3());
    }
    consume(event: Event) { event.preventDefault(); event.stopImmediatePropagation(); }
    pointerDown(e: PointerEvent) {
        if (this.host.isXR || this.host.stereoscopic || !this.usable || (e.pointerType === 'mouse' && e.button !== 0)) return false;
        const input = { x: e.clientX, y: e.clientY };
        if (!this.active) {
            const hit = (this.rayAt(input.x, input.y), this.host.hitFromRay());
            if (!hit || !this.host.isModelObject(hit.object)) return false;
            this.host.stopMovement();
            const direction = this.host.camera.getWorldDirection(new T.Vector3());
            this.plane.setFromNormalAndCoplanarPoint(direction, hit.point);
            this.depthDrag = e.altKey ? { y: input.y, point: hit.point.clone(), direction, units: Math.max(.001, hit.distance / Math.max(100, this.host.renderer.domElement.clientHeight)) } : null;
        }
        if (this.pointers.size >= 2) { this.consume(e); return true; }
        if (this.pointers.size === 1) this.depthDrag = null;
        this.pointers.set(e.pointerId, input);
        const point = this.pointerPoint(e.pointerId, input);
        if (!point) { this.pointers.delete(e.pointerId); return false; }
        this.grab.begin('pointer:' + e.pointerId, point.toArray() as Vec3, this.value());
        // Reproject both points when switching from one-finger drag to a pinch.
        for (const [id, p] of this.pointers) { const v = this.pointerPoint(id, p); if (v) this.grab.points.set('pointer:' + id, v.toArray() as Vec3); }
        this.grab.rebase(this.value()); this.host.controls.enabled = false;
        this.host.renderer.domElement.setPointerCapture(e.pointerId); this.consume(e); this.onState?.(); return true;
    }
    pointerMove(e: PointerEvent) {
        if (!this.pointers.has(e.pointerId)) return false;
        const input = { x: e.clientX, y: e.clientY }; this.pointers.set(e.pointerId, input);
        const point = this.pointerPoint(e.pointerId, input), next = point && this.grab.move('pointer:' + e.pointerId, point.toArray() as Vec3);
        if (next) this.apply(next, true); this.consume(e); return true;
    }
    pointerUp(e: PointerEvent) {
        if (!this.pointers.has(e.pointerId)) return false;
        this.pointers.delete(e.pointerId);
        if (this.host.renderer.domElement.hasPointerCapture?.(e.pointerId)) this.host.renderer.domElement.releasePointerCapture(e.pointerId);
        this.grab.end('pointer:' + e.pointerId, this.value());
        this.depthDrag = null;
        for (const [id, p] of this.pointers) { const v = this.pointerPoint(id, p); if (v) this.grab.points.set('pointer:' + id, v.toArray() as Vec3); }
        this.grab.rebase(this.value());
        if (!this.active) this.finish(); this.consume(e); return true;
    }
    wheel(e: WheelEvent) {
        if (this.host.isXR || this.host.stereoscopic || !this.usable || this.active) return;
        const hit = (this.rayAt(e.clientX, e.clientY), this.host.hitFromRay());
        if (!hit || !this.host.isModelObject(hit.object)) return;
        const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
        this.scaleTo(this.value().scale * Math.exp(Math.max(-.3, Math.min(.3, -delta * .0015))), hit.point); this.consume(e);
    }
    finish(publish = true) {
        const ids = [...this.pointers.keys()]; this.pointers.clear(); this.grab.clear(); this.controllers.clear(); this.hands.clear(); this.depthDrag = null;
        for (const id of ids) if (this.host.renderer.domElement.hasPointerCapture?.(id)) this.host.renderer.domElement.releasePointerCapture(id);
        this.host.controls.enabled = !this.host.isXR && !this.host.stereoscopic && !this.host.walking;
        if (publish && this.dirty) this.onChange?.(this.value(), true, this.host.modelAssetId);
        this.dirty = false; this.onState?.();
    }
    startController(controller: T.Object3D, button: string) {
        if (!this.host.isXR || !this.host.modelMenu || !this.usable || controller.userData.source?.hand) return;
        const id = 'controller:' + controller.uuid, existing = this.controllers.get(id);
        if (existing) { existing.buttons.add(button); return; }
        controller.updateWorldMatrix(true, false); this.host.ray.setFromXRController(controller as T.XRTargetRaySpace);
        const hit = this.host.hitFromRay();
        if (!hit || !this.host.isModelObject(hit.object)) return;
        const point = this.host.ray.ray.at(hit.distance, new T.Vector3());
        if (this.grab.begin(id, point.toArray() as Vec3, this.value())) {
            this.controllers.set(id, { controller, depth: hit.distance, buttons: new Set([button]) }); this.host.stopMovement(); this.onState?.();
        }
    }
    endController(controller: T.Object3D, button?: string) {
        const id = 'controller:' + controller.uuid, record = this.controllers.get(id); if (!record) return;
        if (button) record.buttons.delete(button); else record.buttons.clear();
        if (!record.buttons.size) { this.controllers.delete(id); this.endGrab(id); }
    }
    endGrab(id: string) { if (!this.grab.points.has(id)) return; this.grab.end(id, this.value()); if (!this.active && this.dirty) { this.onChange?.(this.value(), true, this.host.modelAssetId); this.dirty = false; } this.onState?.(); }
    updateXR() {
        if (!this.host.isXR) return;
        if (!this.host.modelMenu || !this.usable) { if (this.active || this.hands.size) this.finish(); return; }
        for (const [id, record] of this.controllers) {
            if (!record.controller.visible) { this.controllers.delete(id); this.endGrab(id); continue; }
            record.controller.updateWorldMatrix(true, false); this.host.ray.setFromXRController(record.controller as T.XRTargetRaySpace);
            const next = this.grab.move(id, this.host.ray.ray.at(record.depth, new T.Vector3()).toArray() as Vec3);
            if (next) this.apply(next, true);
        }
        const frame = this.host.renderer.xr.getFrame(), reference = this.host.renderer.xr.getReferenceSpace();
        const sources = [...(this.host.renderer.xr.getSession()?.inputSources || [])];
        for (const [source, state] of this.hands) if (!sources.includes(source)) { this.endGrab(state.id); this.hands.delete(source); }
        if (!frame || !reference) { for (const state of this.hands.values()) { state.pinch.update(null); this.endGrab(state.id); } return; }
        for (const source of sources) {
            if (!source.hand) continue;
            let state = this.hands.get(source);
            if (!state) { state = { id: 'hand:' + ++this.handId, pinch: new PinchLatch() }; this.hands.set(source, state); }
            const thumbSpace = source.hand.get('thumb-tip'), indexSpace = source.hand.get('index-finger-tip');
            let thumb: XRJointPose | null = null, index: XRJointPose | null = null;
            try { if (thumbSpace && indexSpace) { thumb = frame.getJointPose?.(thumbSpace, reference) || null; index = frame.getJointPose?.(indexSpace, reference) || null; } } catch { /* Tracking loss releases the grab. */ }
            const a = thumb && new T.Vector3().copy(thumb.transform.position), b = index && new T.Vector3().copy(index.transform.position);
            const pinch = state.pinch.update(a && b ? a.distanceTo(b) : null);
            if (!a || !b || pinch.ended) { this.endGrab(state.id); continue; }
            const point = this.host.rig.localToWorld(a.add(b).multiplyScalar(.5));
            if (pinch.started) {
                const controller = this.host.controllers.find(c => c.userData.source === source);
                if (controller) { controller.updateWorldMatrix(true, false); this.host.ray.setFromXRController(controller); }
                else this.host.ray.set(point, this.host.renderer.xr.getCamera().getWorldDirection(new T.Vector3()));
                const hit = this.host.hitFromRay();
                const close = new T.Box3().setFromObject(this.host.model).distanceToPoint(point) < .2;
                if (!hit?.object.userData.action && (close || (hit && this.host.isModelObject(hit.object)))) {
                    this.grab.begin(state.id, point.toArray() as Vec3, this.value()); this.host.stopMovement(); this.onState?.();
                }
            }
            if (pinch.held) { const next = this.grab.move(state.id, point.toArray() as Vec3); if (next) this.apply(next, true); }
        }
    }
}
