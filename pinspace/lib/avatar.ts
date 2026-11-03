export const SKIN_TONES = [
    ['#f5d7bd', 'Porcelain'], ['#e8bb95', 'Warm beige'], ['#cb946a', 'Honey'],
    ['#a96f49', 'Chestnut'], ['#805034', 'Brown'], ['#503325', 'Deep brown'],
] as const;
export const SHIRT_COLORS = [
    ['#436c85', 'Ocean'], ['#3e7765', 'Forest'], ['#845f9d', 'Violet'],
    ['#c96e58', 'Terracotta'], ['#d3a543', 'Gold'], ['#344253', 'Slate'],
] as const;
export const HAIR_COLORS = [
    ['#302820', 'Dark brown'], ['#6e4830', 'Brown'], ['#c39350', 'Blond'],
    ['#aa5036', 'Auburn'], ['#b4b5b6', 'Silver'],
] as const;
export const AVATAR_STYLES = [['short', 'Short hair'], ['bob', 'Long hair'], ['none', 'No hair'], ['hardhat', 'Hard hat']] as const;
export type Avatar = { skin: string; shirt: string; hair: string; style: typeof AVATAR_STYLES[number][0]; glasses: boolean };
export const DEFAULT_AVATAR: Avatar = { skin: '#cb946a', shirt: '#436c85', hair: '#302820', style: 'short', glasses: false };
const KEY = 'pinspace-avatar-v1';
const hasColor = (colors: readonly (readonly [string, string])[], value: unknown) => colors.some(c => c[0] === value);

export function normalizeAvatar(value: unknown): Avatar {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {
        skin: hasColor(SKIN_TONES, v.skin) ? v.skin as string : DEFAULT_AVATAR.skin,
        shirt: hasColor(SHIRT_COLORS, v.shirt) ? v.shirt as string : DEFAULT_AVATAR.shirt,
        hair: hasColor(HAIR_COLORS, v.hair) ? v.hair as string : DEFAULT_AVATAR.hair,
        style: AVATAR_STYLES.some(s => s[0] === v.style) ? v.style as Avatar['style'] : DEFAULT_AVATAR.style,
        glasses: typeof v.glasses === 'boolean' ? v.glasses : false,
    };
}
export function validateAvatar(value: unknown): Avatar {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Choose a valid avatar.');
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(k => !['skin', 'shirt', 'hair', 'style', 'glasses'].includes(k)) ||
        !hasColor(SKIN_TONES, v.skin) || !hasColor(SHIRT_COLORS, v.shirt) || !hasColor(HAIR_COLORS, v.hair) ||
        !AVATAR_STYLES.some(s => s[0] === v.style) || typeof v.glasses !== 'boolean') throw Error('Choose a valid avatar.');
    return normalizeAvatar(v);
}
export function loadAvatar(): Avatar {
    try { return normalizeAvatar(localStorage.getItem(KEY)); } catch { return { ...DEFAULT_AVATAR }; }
}
export function saveAvatar(avatar: Avatar) {
    try { localStorage.setItem(KEY, JSON.stringify(normalizeAvatar(avatar))); return true; } catch { return false; }
}
export function cycleAvatar(avatar: Avatar, field: 'skin' | 'shirt' | 'hair' | 'style'): Avatar {
    const choices = { skin: SKIN_TONES, shirt: SHIRT_COLORS, hair: HAIR_COLORS, style: AVATAR_STYLES }[field];
    const index = choices.findIndex(choice => choice[0] === avatar[field]);
    return normalizeAvatar({ ...avatar, [field]: choices[(index + 1) % choices.length][0] });
}
