export function shortcutPosition(value: unknown): number[] {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6))
        throw Error('Choose a valid shortcut position.');
    return value;
}
export function shortcutTarget(value: unknown, source: string): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}$/.test(value) || value === source)
        throw Error('Choose a different public destination room.');
    return value;
}
