import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AVATAR_STYLES, DEFAULT_AVATAR, HAIR_COLORS, SHIRT_COLORS, SKIN_TONES, normalizeAvatar, type Avatar } from '../lib/avatar';

export function AvatarPortrait({ avatar, label = 'Avatar preview' }: { avatar: unknown; label?: string }) {
    const a = normalizeAvatar(avatar);
    return <svg viewBox="0 0 200 210" role="img" aria-label={label} className="avatar-portrait">
        <rect width="200" height="210" rx="24" fill="#e8eff2"/>
        {a.style === 'bob' && <ellipse cx="100" cy="94" rx="49" ry="62" fill={a.hair}/>}
        <path d="M30 210v-35q0-31 42-38h56q42 7 42 38v35" fill={a.shirt}/>
        <path d="M82 120h36v28q-18 16-36 0" fill={a.skin}/>
        <ellipse cx="100" cy="86" rx="43" ry="51" fill={a.skin}/>
        {(a.style === 'short' || a.style === 'bob') && <path d="M57 83V65q3-35 43-35t43 35v18l-13-20q-35 9-59-3z" fill={a.hair}/>}
        {a.style === 'hardhat' && <g fill="#e9b54b"><path d="M49 66q1-43 51-43t51 43z"/><rect x="41" y="62" width="118" height="13" rx="6"/><path d="M94 26h12v35H94z" fill="#c18d2c"/></g>}
        <g fill="#27313b"><circle cx="84" cy="88" r="3"/><circle cx="116" cy="88" r="3"/></g>
        <path d="M90 111q10 8 20 0" stroke="#714939" strokeWidth="3" fill="none" strokeLinecap="round"/>
        {a.glasses && <g fill="none" stroke="#27313b" strokeWidth="3"><rect x="68" y="78" width="28" height="22" rx="8"/><rect x="104" y="78" width="28" height="22" rx="8"/><path d="M96 86h8M58 83l10 2M132 85l10-2"/></g>}
    </svg>;
}

export default function AvatarEditor({ avatar, name, onSave, onClose }: { avatar: Avatar; name: string; onSave: (avatar: Avatar, name: string) => void; onClose: () => void }) {
    const [draft, setDraft] = useState(() => normalizeAvatar(avatar)), [displayName, setDisplayName] = useState(name);
    const dialog = useRef<HTMLElement>(null);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
        return () => previous?.focus();
    }, []);
    function keyDown(e: React.KeyboardEvent) {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        if (e.key === 'Tab') {
            const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select') || []);
            const first = nodes[0], last = nodes.at(-1);
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
    }
    function palette(field: 'skin' | 'shirt' | 'hair', title: string, colors: readonly (readonly [string, string])[]) {
        return <fieldset><legend>{title}</legend><div className="avatar-swatches">{colors.map(([color, label]) => <button key={color} type="button" aria-label={`${title}: ${label}`} aria-pressed={draft[field] === color} title={label} style={{ backgroundColor: color }} onClick={() => setDraft({ ...draft, [field]: color })}>{draft[field] === color && <span aria-hidden="true">✓</span>}</button>)}</div></fieldset>;
    }
    return <div className="modal-backdrop" onClick={onClose}><section ref={dialog} className="dialog avatar-dialog" role="dialog" aria-modal="true" aria-labelledby="avatar-title" onClick={e => e.stopPropagation()} onKeyDown={keyDown}>
        <button className="icon-button close-dialog" type="button" aria-label="Close avatar editor" onClick={onClose}><X size={19}/></button>
        <span className="eyebrow">YOUR PRESENCE IN THE ROOM</span><h2 id="avatar-title">Make yourself at home.</h2><p>Choose how you appear to everyone in your session.</p>
        <form onSubmit={e => { e.preventDefault(); onSave(draft, displayName.trim() || 'Guest reviewer'); }}>
            <div className="avatar-editor-layout"><div className="avatar-preview"><AvatarPortrait avatar={draft}/><strong>{displayName.trim() || 'Guest reviewer'}</strong><span>Live preview</span></div>
            <div className="avatar-options"><label className="avatar-name">Display name<input maxLength={50} value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="nickname"/></label>
            {palette('skin', 'Skin tone', SKIN_TONES)}{palette('shirt', 'Shirt color', SHIRT_COLORS)}
            <fieldset><legend>Hair & headwear</legend><div className="avatar-styles">{AVATAR_STYLES.map(([style, label]) => <button key={style} type="button" aria-pressed={draft.style === style} onClick={() => setDraft({ ...draft, style })}>{label}</button>)}</div></fieldset>
            {palette('hair', 'Hair color', HAIR_COLORS)}
            <label className="avatar-glasses"><input type="checkbox" checked={draft.glasses} onChange={e => setDraft({ ...draft, glasses: e.target.checked })}/>Glasses</label></div></div>
            <p className="avatar-save-note">Appearance is saved in this browser and shared when you join a room. In VR, choose Avatar in the fixed menu to change your look.</p>
            <div className="avatar-editor-actions"><button type="button" className="avatar-reset" onClick={() => setDraft({ ...DEFAULT_AVATAR })}>Reset appearance</button><button type="button" className="upload" onClick={onClose}>Cancel</button><button type="submit" className="primary">Save avatar</button></div>
        </form>
    </section></div>;
}
