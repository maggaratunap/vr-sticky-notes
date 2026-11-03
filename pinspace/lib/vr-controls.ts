/** Input math shared by WebXR and Cardboard; independent of rendering. */
export function readStick(axes: ReadonlyArray<number> | undefined) {
    if (!axes)
        return { x: 0, z: 0 };
    const offset = axes.length >= 4 ? 2 : 0;
    const axis = (v: number | undefined) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > .15 ? Math.max(-1, Math.min(1, v)) : 0;
    return { x: axis(axes[offset]), z: axis(axes[offset + 1]) };
}
/** World-space locomotion at a capped speed, regardless of diagonal/mixed input. */
export function movementDelta(forward: readonly number[], x: number, z: number, lift: number, flying: boolean, seconds: number) {
    const finite = (n: number) => Number.isFinite(n) ? n : 0;
    let fx = finite(forward[0]), fy = flying ? finite(forward[1]) : 0, fz = finite(forward[2]);
    let length = Math.hypot(fx, fy, fz);
    if (length < .0001) { fx = 0; fy = 0; fz = -1; length = 1; }
    fx /= length; fy /= length; fz /= length;
    const horizontal = Math.hypot(fx, fz);
    const sx = horizontal > .0001 ? -fz / horizontal : 1, sz = horizontal > .0001 ? fx / horizontal : 0;
    const dx = -finite(z) * fx + finite(x) * sx;
    const dy = -finite(z) * fy + (flying ? finite(lift) : 0);
    const dz = -finite(z) * fz + finite(x) * sz;
    const scale = Math.min(.05, Math.max(0, finite(seconds))) * 3 / Math.max(1, Math.hypot(dx, dy, dz));
    return { x: dx * scale, y: dy * scale, z: dz * scale };
}
export class DwellSelector<T> {
    target: T | null = null;
    started = 0;
    fired = false;
    duration: number;
    constructor(duration = 1400) { this.duration = duration; }
    observe(target: T | null, now: number) {
        if (target !== this.target) {
            this.target = target;
            this.started = now;
            this.fired = false;
        }
        if (target === null)
            return { progress: 0, activate: false };
        const progress = Math.max(0, Math.min(1, (now - this.started) / this.duration));
        const activate = progress === 1 && !this.fired;
        if (activate)
            this.fired = true;
        return { progress, activate };
    }
    reset() { this.target = null; this.started = 0; this.fired = false; }
}
/** Circular, clamped touch joystick; screen-up means forward (negative Z). */
export function joystickVector(dx: number, dy: number, radius = 38) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || radius <= 0)
        return { x: 0, z: 0 };
    const length = Math.hypot(dx, dy);
    if (length < radius * .12)
        return { x: 0, z: 0 };
    const scale = Math.max(radius, length);
    return { x: dx / scale, z: dy / scale };
}
export function tapAction({ interactive, noteMode, removeMode, walkable }: {
    interactive: boolean;
    noteMode: boolean;
    removeMode: boolean;
    walkable: boolean;
}) {
    if (removeMode)
        return 'remove';
    if (interactive)
        return 'select';
    if (noteMode)
        return 'note';
    return walkable ? 'move' : 'none';
}
/** Keep gaze controls on a stable heading. Translation follows locomotion, rotation never chases the head. */
export class GazeMenuAnchor {
    heading: [
        number,
        number
    ] | null = null;
    reset() { this.heading = null; }
    place(eye: readonly number[], forward: readonly number[]) {
        if (!this.heading) {
            const length = Math.hypot(forward[0], forward[2]);
            this.heading = length > .01 ? [forward[0] / length, forward[2] / length] : [0, -1];
        }
        const [x, z] = this.heading;
        return { position: [eye[0] + x * 1.9, eye[1] - .48, eye[2] + z * 1.9], yaw: Math.atan2(-x, -z) };
    }
}

