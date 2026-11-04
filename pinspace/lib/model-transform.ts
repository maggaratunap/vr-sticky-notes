export type Vec3 = [number, number, number];
export type ModelTransform = { position: Vec3; scale: number; yaw?: number };
export const MIN_MODEL_SCALE = .1, MAX_MODEL_SCALE = 100, MODEL_POSITION_LIMIT = 100000;
export const defaultModelTransform = (): ModelTransform => ({ position: [0, 0, 0], scale: 1, yaw: 0 });
export const normalizeYaw = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));
export function validModelTransform(value: unknown): value is ModelTransform {
    const v = value as ModelTransform;
    return !!v && Array.isArray(v.position) && v.position.length === 3 && v.position.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MODEL_POSITION_LIMIT) &&
        typeof v.scale === 'number' && Number.isFinite(v.scale) && v.scale >= MIN_MODEL_SCALE && v.scale <= MAX_MODEL_SCALE &&
        (v.yaw === undefined || (typeof v.yaw === 'number' && Number.isFinite(v.yaw) && Math.abs(v.yaw) <= 100000));
}
export function normalizeModelTransform(value: unknown): ModelTransform {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return defaultModelTransform(); } }
    return validModelTransform(value) ? { position: [...value.position] as Vec3, scale: value.scale, yaw: normalizeYaw(value.yaw || 0) } : defaultModelTransform();
}
export const clampModelScale = (value: number) => Number.isFinite(value) ? Math.max(MIN_MODEL_SCALE, Math.min(MAX_MODEL_SCALE, value)) : 1;
const point = (v: readonly number[]): Vec3 => v.map(n => Math.max(-MODEL_POSITION_LIMIT, Math.min(MODEL_POSITION_LIMIT, Number.isFinite(n) ? n : 0))) as Vec3;
const midpoint = (a: readonly number[], b: readonly number[]): Vec3 => a.map((n, i) => (n + b[i]) / 2) as Vec3;
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((n, i) => n - b[i]));

export function scaleModelAround(base: ModelTransform, anchor: readonly number[], requestedScale: number): ModelTransform {
    const scale = clampModelScale(requestedScale), ratio = scale / base.scale;
    return { ...normalizeModelTransform(base), scale, position: point(base.position.map((n, i) => anchor[i] + (n - anchor[i]) * ratio)) };
}
/** Rotate only about world Y, preserving the selected world-space pivot. */
export function rotateModelAround(base: ModelTransform, anchor: readonly number[], yaw: number): ModelTransform {
    if (!Number.isFinite(yaw)) return normalizeModelTransform(base);
    const angle = yaw - (base.yaw || 0), c = Math.cos(angle), s = Math.sin(angle);
    const x = base.position[0] - anchor[0], z = base.position[2] - anchor[2];
    return { ...normalizeModelTransform(base), yaw: normalizeYaw(yaw), position: point([anchor[0] + c * x + s * z, base.position[1], anchor[2] - s * x + c * z]) };
}
export function horizontalGestureAngle(start: readonly Vec3[], current: readonly Vec3[]) {
    if (start.length < 2 || current.length < 2) return 0;
    const a = start[1].map((n, i) => n - start[0][i]), b = current[1].map((n, i) => n - current[0][i]);
    if (Math.hypot(a[0], a[2]) < .02 || Math.hypot(b[0], b[2]) < .02) return 0;
    return normalizeYaw(Math.atan2(a[2], a[0]) - Math.atan2(b[2], b[0]));
}
/** One point translates; two points pan/scale and optionally rotate horizontally about their midpoint. */
export function gestureModelTransform(base: ModelTransform, start: readonly Vec3[], current: readonly Vec3[], angle = 0): ModelTransform {
    if (!start.length || start.length !== current.length || start.some(p => p.some(n => !Number.isFinite(n))) || current.some(p => p.some(n => !Number.isFinite(n)))) return normalizeModelTransform(base);
    if (start.length === 1) return { ...normalizeModelTransform(base), position: point(base.position.map((n, i) => n + current[0][i] - start[0][i])) };
    const a = midpoint(start[0], start[1]), b = midpoint(current[0], current[1]);
    const separation = distance(start[0], start[1]);
    const scale = clampModelScale(base.scale * (separation > .002 ? distance(current[0], current[1]) / separation : 1));
    const ratio = scale / base.scale;
    return rotateModelAround({ ...normalizeModelTransform(base), scale, position: point(base.position.map((n, i) => b[i] + (n - a[i]) * ratio)) }, b, (base.yaw || 0) + angle);
}
export class ModelGrab {
    points = new Map<string, Vec3>();
    start: Vec3[] = [];
    base = defaultModelTransform();
    rebase(transform: ModelTransform) { this.base = normalizeModelTransform(transform); this.start = [...this.points.values()].map(p => [...p] as Vec3); }
    begin(id: string, value: Vec3, transform: ModelTransform) {
        if (this.points.has(id) || this.points.size >= 2) return false;
        this.points.set(id, [...value]); this.rebase(transform); return true;
    }
    move(id: string, value: Vec3, rotate = false, angle?: number) {
        if (!this.points.has(id)) return null;
        this.points.set(id, [...value]); const current = [...this.points.values()];
        return gestureModelTransform(this.base, this.start, current, angle ?? (rotate ? horizontalGestureAngle(this.start, current) : 0));
    }
    end(id: string, transform: ModelTransform) { this.points.delete(id); this.rebase(transform); }
    clear() { this.points.clear(); this.start = []; }
}
export class PinchLatch {
    held = false;
    update(separation: number | null) {
        const previous = this.held;
        if (separation === null || !Number.isFinite(separation)) this.held = false;
        else if (!this.held && separation < .025) this.held = true;
        else if (this.held && separation > .04) this.held = false;
        return { held: this.held, started: this.held && !previous, ended: !this.held && previous };
    }
}
