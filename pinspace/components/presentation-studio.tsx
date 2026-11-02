'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Square, ChevronLeft, ChevronRight, Box, FileText, Plus, ArrowUp, ArrowDown, Trash2, X, Maximize, StickyNote, FolderOpen, Save, Radio, PanelLeft } from 'lucide-react';
import { api } from '../lib/client-api';
import { emptyPresentation, exampleDeck, slideId, type Presentation, type PresentationSlide } from '../lib/presentation';
export default forwardRef<any, any>(function PresentationStudio(props, ref) {
    const [saved, setSaved] = useState<Presentation>(emptyPresentation), [deck, setDeck] = useState<PresentationSlide[]>([]), [dirty, setDirty] = useState(false), [selected, setSelected] = useState(''), [follow, setFollow] = useState(true), [focus, setFocus] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState(''), [clock, setClock] = useState(Date.now());
    const state = useRef<any>({}), applied = useRef(''), applying = useRef(Promise.resolve());
    state.current = { saved, deck, dirty, selected, follow, focus, props };
    const current = deck.find(s => s.id === selected) || deck[0], index = current ? deck.indexOf(current) : -1;
    const controlling = props.owner && saved.state.presenterPeer === props.peer();
    const locked = saved.state.live && follow && !controlling;
    function apply(slide: PresentationSlide, view = slide.camera) { applying.current = applying.current.catch(() => { }).then(() => props.apply(slide, view)).catch((e: Error) => setMessage(e.message)); }
    function ingest(p: Presentation) {
        const s = state.current;
        setSaved(p);
        if (!s.dirty)
            setDeck(p.deck);
        const host = props.owner && p.state.presenterPeer === props.peer();
        if (p.state.live && s.follow) {
            const slide = p.deck.find(v => v.id === p.state.slideId);
            if (slide) {
                setSelected(slide.id);
                if (!s.saved.state.live)
                    setFocus(true);
                const key = [slide.id, p.revision, p.state.updated].join(':');
                if (!host && key !== applied.current) {
                    applied.current = key;
                    apply(slide, p.state.view);
                }
            }
        }
        else if (!s.selected && p.deck[0])
            setSelected(p.deck[0].id);
    }
    useImperativeHandle(ref, () => ({ ingest }));
    async function action(body: any) { const id = await props.ensureRoom(); await api('rooms/' + id + '/presentation', 'POST', body); await props.refresh(); }
    async function work(fn: () => Promise<void>) {
        if (pending)
            return;
        setPending(true);
        setMessage('');
        try {
            await fn();
        }
        catch (e) {
            setMessage((e as Error).message);
        }
        finally {
            setPending(false);
        }
    }
    async function save() { const id = await props.ensureRoom(); await api('rooms/' + id + '/presentation', 'POST', { action: 'save', revision: saved.revision, deck }); setDirty(false); setSaved(s => ({ ...s, deck, revision: saved.revision + 1 })); }
    function edit(next: PresentationSlide[]) {
        if (saved.state.live)
            return;
        setDeck(next);
        setDirty(true);
    }
    async function select(slide: PresentationSlide) {
        if (locked)
            return;
        setSelected(slide.id);
        apply(slide);
        if (controlling && saved.state.live)
            await action({ action: 'go', slideId: slide.id });
    }
    function step(delta: number) {
        const s = state.current;
        const i = s.deck.findIndex((v: PresentationSlide) => v.id === s.selected);
        const target = s.deck[Math.max(0, Math.min(s.deck.length - 1, i + delta))];
        if (target)
            work(() => select(target));
    }
    function add(slides: PresentationSlide[]) {
        if (deck.length + slides.length > 50) {
            setMessage('A presentation can contain up to 50 slides.');
            return;
        }
        edit([...deck, ...slides]);
        setSelected(slides[0].id);
    }
    useEffect(() => { const root = document.querySelector('.workspace'); root?.classList.toggle('presentation-focus', focus); props.engine()?.setPresentation(focus); return () => { root?.classList.remove('presentation-focus'); props.engine()?.setPresentation(false); }; }, [focus]);
    useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]'))
                return;
            if (e.key === 'Escape')
                setFocus(false);
            if (state.current.focus && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
                e.preventDefault();
                if (!locked)
                    step(e.key === 'ArrowRight' ? 1 : -1);
            }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    });
    useEffect(() => {
        const v = props.engine();
        if (v) {
            v.onNext = () => step(1);
            v.onPrevious = () => step(-1);
        }
        return () => {
            if (v) {
                v.onNext = null;
                v.onPrevious = null;
            }
        };
    });
    // The presenter shares desktop camera changes; headset orientation always remains local.
    useEffect(() => {
        if (!controlling || !saved.state.live || current?.kind !== 'model')
            return;
        let busy = false, last = '';
        const timer = setInterval(async () => {
            const v = props.engine();
            if (!v || v.isXR || v.stereoscopic || busy)
                return;
            const view = v.cameraFrame();
            const key = JSON.stringify(view);
            if (key === last)
                return;
            last = key;
            busy = true;
            try {
                await action({ action: 'view', peer: props.peer(), view });
            }
            catch { }
            finally {
                busy = false;
            }
        }, 1200);
        return () => clearInterval(timer);
    }, [controlling, saved.state.live, current?.id]);
    const seconds = saved.state.live ? Math.max(0, Math.floor((clock - saved.state.startedAt) / 1000)) : 0;
    const transport = <div className={'presentation-transport ' + (focus ? 'focused' : '')} aria-label="Presentation controls"><div className="transport-status"><span className={'presentation-dot ' + (saved.state.live ? 'live' : '')}/><span>{saved.state.live ? (controlling ? 'YOU ARE PRESENTING' : follow ? 'FOLLOWING ' + saved.state.presenterName : 'EXPLORING') : 'PRESENTATION PREVIEW'}</span>{saved.state.live && <time>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</time>}</div><div className="transport-main"><button aria-label="Previous slide" disabled={locked || index <= 0 || pending} onClick={() => step(-1)}><ChevronLeft size={22}/></button><div className="transport-title"><small>{index + 1} / {deck.length}</small><strong>{current?.title || 'Build your presentation'}</strong></div><button aria-label="Next slide" disabled={locked || index >= deck.length - 1 || pending} onClick={() => step(1)}><ChevronRight size={22}/></button><span className="transport-separator"/><button aria-label="Open presentation outline" onClick={() => { setFocus(false); props.outline(); }}><PanelLeft size={18}/></button><button aria-label="Open discussion" onClick={() => { setFocus(false); props.discuss(); }}><StickyNote size={18}/></button><button aria-label="VR presentation setup" onClick={props.vr}><Box size={18}/></button><button aria-label={focus ? 'Exit presentation view' : 'Open presentation view'} onClick={() => setFocus(!focus)}>{focus ? <X size={19}/> : <Maximize size={18}/>}</button>{controlling && saved.state.live && <button className="end-presentation" onClick={() => work(async () => { await action({ action: 'stop' }); setFocus(false); })}><Square size={12}/>End</button>}</div>{saved.state.live && !controlling && <button className="follow-toggle" onClick={() => {
                setFollow(!follow);
                applied.current = '';
                if (!follow) {
                    const slide = saved.deck.find(s => s.id === saved.state.slideId);
                    if (slide) {
                        setSelected(slide.id);
                        apply(slide, saved.state.view);
                        setFocus(true);
                    }
                }
            }}>{follow ? 'Explore independently' : 'Rejoin live presentation'}</button>}</div>;
    return <><aside className={'assets-panel presentation-aside ' + (props.open ? 'mobile-open ' : '') + (props.files ? 'studio-hidden' : '')}><div className="panel-heading"><div><span className="eyebrow">PRESENTATION STUDIO</span><h2>Your story, in space.</h2></div><button className="icon-button mobile-only" aria-label="Close outline" onClick={props.close}><X size={18}/></button></div><div className="studio-tabs"><button className="active">Outline <span>{deck.length}</span></button><button onClick={props.showFiles}><FolderOpen size={14}/>Files</button></div><p className="studio-description">Guide your audience through model views and drawings, one moment at a time.</p><div className="slide-list">{deck.map((slide, i) => <button key={slide.id} className={'slide-item ' + (slide.id === current?.id ? 'selected' : '')} onClick={() => work(() => select(slide))} disabled={locked}><span className="slide-number">{String(i + 1).padStart(2, '0')}</span><span className={'slide-icon ' + slide.kind}>{slide.kind === 'pdf' ? <FileText size={20}/> : <Box size={20}/>}</span><span><strong>{slide.title}</strong><small>{slide.kind === 'pdf' ? 'PDF · page ' + slide.page : '3D model view'}</small></span>{saved.state.live && slide.id === saved.state.slideId && <Radio size={13}/>}</button>)}{!deck.length && <div className="outline-empty"><Box size={31}/><h3>A story worth stepping into.</h3><p>Capture your best model views. Add PDF pages. Arrange the order, then take the stage.</p>{props.owner ? <button className="upload" onClick={() => { const d = exampleDeck(); edit(d); setSelected(d[0].id); apply(d[0]); }}>Try a sample presentation</button> : <p>The room creator can prepare and present an outline here.</p>}</div>}</div>
 {props.owner && !saved.state.live && <><div className="capture-actions"><button className="upload" onClick={() => add([{ id: slideId(), title: 'Model view ' + (deck.length + 1), kind: 'model', asset: props.active(), page: 1, camera: props.engine()?.cameraFrame() || null, notes: '' }])}><Plus size={15}/>Capture current model view</button>{props.pdf && <><button className="upload" onClick={() => add([{ id: slideId(), title: props.pdf.name + ' · ' + props.pdfPage, kind: 'pdf', asset: props.pdf.id, page: props.pdfPage, camera: null, notes: '' }])}><FileText size={15}/>Add visible PDF page</button>{props.pdfTotal > 1 && <button className="text-action" onClick={() => add(Array.from({ length: props.pdfTotal }, (_, i) => ({ id: slideId(), title: props.pdf.name + ' · ' + (i + 1), kind: 'pdf', asset: props.pdf.id, page: i + 1, camera: null, notes: '' })))}>Add all {props.pdfTotal} PDF pages</button>}</>}</div>{current && <div className="slide-editor"><label>Slide title<input maxLength={100} value={current.title} onChange={e => edit(deck.map(s => s.id === current.id ? { ...s, title: e.target.value } : s))}/></label><label>Private speaker notes<textarea maxLength={4000} rows={3} placeholder="Your talking points…" value={current.notes} onChange={e => edit(deck.map(s => s.id === current.id ? { ...s, notes: e.target.value } : s))}/></label><div className="slide-edit-actions"><button aria-label="Move slide up" disabled={index <= 0} onClick={() => { const d = [...deck]; [d[index - 1], d[index]] = [d[index], d[index - 1]]; edit(d); }}><ArrowUp size={15}/></button><button aria-label="Move slide down" disabled={index >= deck.length - 1} onClick={() => { const d = [...deck]; [d[index + 1], d[index]] = [d[index], d[index + 1]]; edit(d); }}><ArrowDown size={15}/></button><button aria-label="Remove slide" onClick={() => { edit(deck.filter(s => s.id !== current.id)); setSelected(deck[index - 1]?.id || deck[index + 1]?.id || ''); }}><Trash2 size={15}/></button><span>{dirty ? 'Unsaved changes' : 'Saved outline'}</span></div></div>}</>}
 {controlling && saved.state.live && current?.notes && <div className="speaker-cue"><span className="eyebrow">YOUR SPEAKER NOTES</span><p>{current.notes}</p></div>}
 <div className="studio-bottom">{message && <p className="studio-error" role="alert">{message}</p>}{props.owner ? <>{dirty && <div className="save-outline"><button className="upload" disabled={pending} onClick={() => work(save)}><Save size={14}/>Save outline</button><button className="text-action" onClick={() => { setDeck(saved.deck); setDirty(false); }}>Reset</button></div>}<button className="primary full" disabled={pending || !deck.length || (!controlling && saved.state.live)} onClick={() => work(async () => {
                if (controlling && saved.state.live) {
                    await action({ action: 'stop' });
                    setFocus(false);
                    return;
                }
                if (dirty)
                    await save();
                await props.presence();
                const slide = current || deck[0];
                await action({ action: 'start', slideId: slide.id, peer: props.peer(), name: props.name });
                setSelected(slide.id);
                apply(slide);
                setFocus(true);
            })}>{controlling && saved.state.live ? <><Square size={14}/>End presentation</> : <><Play size={15}/>Present to room</>}</button></> : <button className="primary full" disabled={!deck.length} onClick={() => {
                if (current)
                    apply(current);
                setFocus(true);
            }}><Play size={15}/>{saved.state.live ? 'Join presentation' : 'Preview presentation'}</button>}<small>{props.owner ? 'Share the room link to invite your audience.' : 'Audience members can follow live or explore freely.'}</small></div></aside>{deck.length > 0 && typeof document !== 'undefined' && createPortal(transport, document.body)}</>;
});
