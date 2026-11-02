export type CardboardSettings = { lensSpacing: number; viewSize: number; fov: number };
export const DEFAULT_CARDBOARD: CardboardSettings = { lensSpacing: 50, viewSize: 86, fov: 80 };
const STORAGE_KEY = 'pinspace-cardboard-lenses-v1';

export function normalizeCardboard(value: Partial<CardboardSettings> | null = {}): CardboardSettings {
    const number = (n: unknown, fallback: number, min: number, max: number) =>
        typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    return {
        lensSpacing: number(value?.lensSpacing, DEFAULT_CARDBOARD.lensSpacing, 38, 62),
        viewSize: number(value?.viewSize, DEFAULT_CARDBOARD.viewSize, 60, 94),
        fov: number(value?.fov, DEFAULT_CARDBOARD.fov, 60, 100),
    };
}

export function loadCardboard(): CardboardSettings {
    try { return normalizeCardboard(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); }
    catch { return { ...DEFAULT_CARDBOARD }; }
}

export function saveCardboard(settings: CardboardSettings) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCardboard(settings))); }
    catch { /* Settings still work for this visit if browser storage is disabled. */ }
}

// CSS pixels, with a bottom-left origin shared by WebGL viewports and the mask.
// Each eye always has a square projection, including on very wide phones.
export function cardboardLayout(width: number, height: number, value: Partial<CardboardSettings>) {
    const settings = normalizeCardboard(value);
    const w = Math.max(1, Number.isFinite(width) ? width : 1);
    const h = Math.max(1, Number.isFinite(height) ? height : 1);
    const leftX = w * (.5 - settings.lensSpacing / 200);
    const rightX = w - leftX;
    const available = Math.max(0, Math.min(leftX, w / 2 - leftX, h / 2) - 3);
    const radius = Math.min(Math.min(w / 2, h) * settings.viewSize / 200, available);
    const eye = (x: number) => ({ x: x - radius, y: h / 2 - radius, size: radius * 2 });
    return { width: w, height: h, radius, left: eye(leftX), right: eye(rightX), leftX, rightX, centerY: h / 2 };
}
