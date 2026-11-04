export type Vec3 = [number, number, number];
export type ModelTransform = { position: Vec3; scale: number };
export const MIN_MODEL_SCALE = .1, MAX_MODEL_SCALE = 100, MODEL_POSITION_LIMIT = 100000;
export const defaultModelTransform = (): ModelTransform => ({ position: [0, 0, 0], scale: 1 });
export function validModelTransform(value: unknown): value is ModelTransform {
    const v = value as ModelTransform;
    return !!v && Array.isArray(v.position) && v.position.length === 3 && v.position.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MODEL_POSITION_LIMIT) &&
        typeof v.scale === 'number' && Number.isFinite(v.scale) && v.scale >= MIN_MODEL_SCALE && v.scale <= MAX_MODEL_SCALE;
}
export function normalizeModelTransform(value: unknown): ModelTransform {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return defaultModelTransform(); } }
    return validModelTransform(value) ? { position: [...value.position] as Vec3, scale: value.scale } : defaultModelTransform();
}
export const clampModelScale = (value: number) => Number.isFinite(value) ? Math.max(MIN_MODEL_SCALE, Math.min(MAX_MODEL_SCALE, value)) : 1;
const point = (v: readonly number[]): Vec3 => v.map(n => Math.max(-MODEL_POSITION_LIMIT, Math.min(MODEL_POSITION_LIMIT, Number.isFinite(n) ? n : 0))) as Vec3;
const midpoint = (a: readonly number[], b: readonly number[]): Vec3 => a.map((n, i) => (n + b[i]) / 2) as Vec3;
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((n, i) => n - b[i]));

export function scaleModelAround(base: ModelTransform, anchor: readonly number[], requestedScale: number): ModelTransform {
    const scale = clampModelScale(requestedScale), ratio = scale / base.scale;
    return { scale, position: point(base.position.map((n, i) => anchor[i] + (n - anchor[i]) * ratio)) };
}
/** One point translates; two points translate and uniformly scale around their midpoint. */
export function gestureModelTransform(base: ModelTransform, start: readonly Vec3[], current: readonly Vec3[]): ModelTransform {
    if (!start.length || start.length !== current.length || start.some(p => p.some(n => !Number.isFinite(n))) || current.some(p => p.some(n => !Number.isFinite(n)))) return normalizeModelTransform(base);
    if (start.length === 1) return { scale: base.scale, position: point(base.position.map((n, i) => n + current[0][i] - start[0][i])) };
    const a = midpoint(start[0], start[1]), b = midpoint(current[0], current[1]);
    const separation = distance(start[0], start[1]);
    const scale = clampModelScale(base.scale * (separation > .002 ? distance(current[0], current[1]) / separation : 1));
    const ratio = scale / base.scale;
    return { scale, position: point(base.position.map((n, i) => b[i] + (n - a[i]) * ratio)) };
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
    move(id: string, value: Vec3) {
        if (!this.points.has(id)) return null;
        this.points.set(id, [...value]); return gestureModelTransform(this.base, this.start, [...this.points.values()]);
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
