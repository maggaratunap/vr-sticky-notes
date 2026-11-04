import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MAX_MODEL_SCALE, MIN_MODEL_SCALE, type ModelTransform } from '../lib/model-transform';
function ModelNumber({ value, label, min, max, step, onCommit }: { value: number; label: string; min: number; max: number; step: number; onCommit: (value: number) => void }) {
    const [draft, setDraft] = useState(String(value)), editing = useRef(false);
    useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
    return <input aria-label={label} type="number" min={min} max={max} step={step} value={draft} onFocus={() => editing.current = true} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} onBlur={() => {
        editing.current = false;
        const number = Number(draft);
        if (draft.trim() && Number.isFinite(number)) { const next = Math.max(min, Math.min(max, number)); setDraft(String(next)); onCommit(next); }
        else setDraft(String(value));
    }}/>;
}
export default function ModelControls({ value, enabled, available, onEnabled, onScale, onRotate, onPosition, onStep, onReset, onBring, onClose }: {
    value: ModelTransform; enabled: boolean; available: boolean; onEnabled: (v: boolean) => void;
    onScale: (v: number) => void; onRotate: (v: number) => void; onPosition: (v: [number, number, number]) => void;
    onStep: (direction: 'left' | 'right' | 'up' | 'down' | 'near' | 'far') => void; onReset: () => void; onBring: () => void; onClose: () => void;
}) {
    return <section className="model-controls" aria-label="Model manipulation controls" onKeyDown={e => e.stopPropagation()}>
        <header><strong>Move, scale & rotate</strong><button className="icon-button" onClick={onClose} aria-label="Close model controls"><X size={16}/></button></header>
        <label className="model-drag-toggle"><input type="checkbox" checked={enabled} onChange={e => onEnabled(e.target.checked)} disabled={!available}/>Drag model</label>
        <p>Drag to move. Pinch or scroll to resize. Shift-drag or twist two fingers to rotate horizontally. Alt-drag changes depth. Drag the background to navigate.</p>
        <fieldset disabled={!available}><legend>Scale · minimum 10%</legend>
            <input aria-label="Model scale" type="range" min="-1" max="2" step=".01" value={Math.log10(value.scale)} onChange={e => onScale(10 ** Number(e.target.value))}/>
            <label className="model-percent"><ModelNumber label="Model scale percent" value={Math.round(value.scale * 10000) / 100} min={MIN_MODEL_SCALE * 100} max={MAX_MODEL_SCALE * 100} step={1} onCommit={number => onScale(number / 100)}/> %</label>
        </fieldset>
        <fieldset disabled={!available}><legend>Horizontal rotation</legend>
            <input aria-label="Model rotation" type="range" min="-180" max="180" step="1" value={(value.yaw || 0) * 180 / Math.PI} onChange={e => onRotate(Number(e.target.value) * Math.PI / 180)}/>
            <label className="model-percent"><ModelNumber label="Model rotation degrees" value={Math.round((value.yaw || 0) * 180 / Math.PI)} min={-180} max={180} step={1} onCommit={number => onRotate(number * Math.PI / 180)}/> °</label>
            <div className="model-rotate-buttons"><button onClick={() => onRotate((value.yaw || 0) + Math.PI / 12)}>Rotate left</button><button onClick={() => onRotate((value.yaw || 0) - Math.PI / 12)}>Rotate right</button></div>
        </fieldset>
        <fieldset disabled={!available}><legend>Position</legend><div className="model-position">{['X', 'Y', 'Z'].map((axis, i) => <label key={axis}>{axis}<ModelNumber label={'Model position ' + axis} value={Math.round(value.position[i] * 100) / 100} min={-100000} max={100000} step={.1} onCommit={number => { const p = [...value.position] as [number, number, number]; p[i] = number; onPosition(p); }}/></label>)}</div></fieldset>
        <div className="model-step-buttons">{(['left', 'up', 'right', 'near', 'down', 'far'] as const).map(direction => <button key={direction} disabled={!available} onClick={() => onStep(direction)}>{direction[0].toUpperCase() + direction.slice(1)}</button>)}</div>
        <footer><button disabled={!available} onClick={onBring}>Bring here</button><button disabled={!available} onClick={onReset}>Reset model</button></footer>
        {!available && <p>Open a model to use these controls.</p>}
    </section>;
}
