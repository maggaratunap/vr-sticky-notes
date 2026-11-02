export type CameraFrame = {
    position: number[];
    target: number[];
};
export type PresentationSlide = {
    id: string;
    title: string;
    kind: 'model' | 'pdf';
    asset: string | null;
    page: number;
    camera: CameraFrame | null;
    notes: string;
};
export type PresentationState = {
    live: boolean;
    slideId: string | null;
    presenterName: string;
    presenterPeer: string | null;
    startedAt: number;
    updated: number;
    view: CameraFrame | null;
};
export type Presentation = {
    deck: PresentationSlide[];
    revision: number;
    state: PresentationState;
};
export const emptyPresentation = (): Presentation => ({ deck: [], revision: 0, state: { live: false, slideId: null, presenterName: '', presenterPeer: null, startedAt: 0, updated: 0, view: null } });
export function validCamera(value: unknown): value is CameraFrame { const c = value as CameraFrame; const vector = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6); return !!c && vector(c.position) && vector(c.target) && c.position.some((n, i) => Math.abs(n - c.target[i]) > .0001); }
export function validateDeck(input: unknown, assets: {
    id: string;
    kind: string;
}[]): PresentationSlide[] {
    if (!Array.isArray(input) || input.length > 50)
        throw Error('A presentation can contain up to 50 slides.');
    const seen = new Set<string>();
    return input.map((s: any) => {
        if (!s || typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id) || seen.has(s.id))
            throw Error('Each slide needs a unique ID.');
        seen.add(s.id);
        if (typeof s.title !== 'string' || !s.title.trim() || s.title.length > 100)
            throw Error('Slide titles must contain 1–100 characters.');
        if (s.kind !== 'model' && s.kind !== 'pdf')
            throw Error('Choose a model view or PDF page.');
        const asset = s.asset == null ? null : assets.find(a => a.id === s.asset);
        if (s.asset != null && !asset)
            throw Error('A slide refers to an unavailable file. Restore the file or remove that slide.');
        if (s.kind === 'pdf' && (!asset || asset.kind !== 'pdf'))
            throw Error('PDF slides require a PDF in this room.');
        if (s.kind === 'model' && asset && asset.kind !== 'glb')
            throw Error('Model views require a GLB model.');
        if (s.camera != null && !validCamera(s.camera))
            throw Error('The saved camera view is invalid.');
        if (s.kind === 'pdf' && (!Number.isInteger(s.page) || s.page < 1 || s.page > 10000))
            throw Error('Choose a valid PDF page.');
        if (s.notes != null && (typeof s.notes !== 'string' || s.notes.length > 4000))
            throw Error('Speaker notes must be 4,000 characters or fewer.');
        return { id: s.id, title: s.title.trim(), kind: s.kind, asset: asset?.id || null, page: s.kind === 'pdf' ? s.page : 1, camera: s.kind === 'model' ? (s.camera || null) : null, notes: s.notes || '' };
    });
}
export function readPresentation(room: any, canManage: boolean, assets: {
    id: string;
}[], now = Date.now()): Presentation {
    const result = emptyPresentation();
    try {
        const deck = JSON.parse(room.presentationDeck || '[]');
        if (Array.isArray(deck))
            result.deck = deck.filter(s => s && typeof s.id === 'string' && (s.kind === 'model' || s.kind === 'pdf') && (!s.asset || assets.some(a => a.id === s.asset))).map(s => ({ ...s, notes: canManage ? s.notes || '' : '' }));
    }
    catch { }
    result.revision = room.presentationRevision || 0;
    try {
        const state = JSON.parse(room.presentationState || 'null');
        if (state) {
            const slide = result.deck.find(s => s.id === state.slideId) || result.deck[0];
            result.state = { live: !!state.live && !!slide && room.presenterSeen > now - 15000, slideId: slide?.id || null, presenterName: typeof state.presenterName === 'string' ? state.presenterName : 'Presenter', presenterPeer: typeof state.presenterPeer === 'string' ? state.presenterPeer : null, startedAt: Number(state.startedAt) || 0, updated: Number(state.updated) || 0, view: slide?.id === state.slideId && validCamera(state.view) ? state.view : slide?.camera || null };
        }
    }
    catch { }
    if (!result.state.slideId)
        result.state.slideId = result.deck[0]?.id || null;
    return result;
}
export function slideId() { return globalThis.crypto?.randomUUID?.() || 'slide_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
export function exampleDeck(): PresentationSlide[] {
    return [
        { id: slideId(), title: 'Welcome to the pavilion', kind: 'model', asset: null, page: 1, camera: { position: [22, 15, 25], target: [0, 3, 0] }, notes: 'Introduce the project, audience, and purpose of this walkthrough.' },
        { id: slideId(), title: 'Explore the entrance', kind: 'model', asset: null, page: 1, camera: { position: [9, 5, 15], target: [1, 2.2, 4] }, notes: 'Highlight circulation, the entry canopy, and the glazed facade.' },
        { id: slideId(), title: 'Questions & discussion', kind: 'model', asset: null, page: 1, camera: { position: [-18, 12, 22], target: [0, 3, 0] }, notes: 'Invite questions. Audience members can explore independently or leave a sticky note.' }
    ];
}
