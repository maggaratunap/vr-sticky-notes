import { DEFAULT_CARDBOARD, cardboardLayout, type CardboardSettings as Settings } from '../lib/cardboard';

export default function CardboardSettings({ settings, onChange }: { settings: Settings; onChange: (value: Settings) => void }) {
    const layout = cardboardLayout(1000, 460, settings);
    return <section className="cardboard-fit" aria-labelledby="cardboard-fit-title">
        <div className="cardboard-fit-heading"><h3 id="cardboard-fit-title">Cardboard lens fit</h3><button type="button" onClick={() => onChange({ ...DEFAULT_CARDBOARD })}>Reset</button></div>
        <p>Black lens borders are on. Adjust before inserting your phone. Center the phone’s screen divider in your viewer.</p>
        <svg className="cardboard-fit-preview" viewBox="0 0 1000 460" role="img" aria-label="Preview of two circular eye windows with black borders and aligned center marks">
            <rect width="1000" height="460" fill="black"/>
            {[layout.leftX, layout.rightX].map((x, i) => <g key={i}>
                <circle cx={x} cy="230" r={layout.radius} fill="#263d50"/>
                <circle cx={x} cy="230" r={layout.radius * .55} fill="none" stroke="#607d91" strokeWidth="2"/>
                <path d={`M${x - 30} 230h60M${x} 200v60`} stroke="white" strokeWidth="3"/>
            </g>)}
            <path d="M500 5v16M500 439v16" stroke="white" strokeWidth="3"/>
        </svg>
        <div className="cardboard-fit-controls">
            <label><span>Lens spacing <output>{settings.lensSpacing}%</output></span><input type="range" aria-label="Lens spacing" min="38" max="62" step="1" value={settings.lensSpacing} onChange={e => onChange({ ...settings, lensSpacing: Number(e.target.value) })}/><small>Move both eye windows inward or outward.</small></label>
            <label><span>Window size <output>{settings.viewSize}%</output></span><input type="range" aria-label="Window size" min="60" max="94" step="1" value={settings.viewSize} onChange={e => onChange({ ...settings, viewSize: Number(e.target.value) })}/><small>Smaller windows add more black surround.</small></label>
            <label><span>Field of view <output>{settings.fov}°</output></span><input type="range" aria-label="Field of view" min="60" max="100" step="1" value={settings.fov} onChange={e => onChange({ ...settings, fov: Number(e.target.value) })}/><small>Adjust the apparent scale of the scene.</small></label>
        </div>
        <p className="cardboard-fit-note">Saved on this device. This is a manual lens fit; it does not read a viewer QR profile or automatically correct lens distortion.</p>
    </section>;
}
