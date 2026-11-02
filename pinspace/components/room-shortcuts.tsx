'use client';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, X, Plus, ArrowUpRight, Trash2, Move, Loader2 } from 'lucide-react';
import { api } from '../lib/client-api';
export default forwardRef<any, any>(function RoomShortcuts(props, ref) {
    const [open, setOpen] = useState(false), [rooms, setRooms] = useState<any[]>([]), [target, setTarget] = useState(''), [mode, setMode] = useState('existing'), [title, setTitle] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    async function show() { setOpen(true); setError(''); try {
        const data = await api('rooms');
        setRooms(data.rooms.filter((r: any) => r.id !== props.room));
    }
    catch (e) {
        setError((e as Error).message);
    } }
    useImperativeHandle(ref, () => ({ open: show }));
    async function run(fn: () => Promise<void>) { if (busy)
        return; setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    const available = rooms.filter(r => !props.links.some((link: any) => link.target === r.id));
    return <><button className="room-shortcuts-button" aria-label="Room shortcuts" title="Room shortcuts" onClick={show}><Link size={17}/><span>Rooms</span>{props.links.length > 0 && <small>{props.links.length}</small>}</button>{open && typeof document !== 'undefined' && createPortal(<div className="modal-backdrop" onClick={() => setOpen(false)}><section className="dialog shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={e => e.stopPropagation()}><button className="icon-button close-dialog" aria-label="Close shortcuts" onClick={() => setOpen(false)}><X size={19}/></button><span className="eyebrow">CONNECTED SPACES</span><h2 id="shortcuts-title">Rooms, within your room.</h2><p>Add teleport bubbles here to jump straight into another room. Everyone in this room can use them.</p><div className="shortcut-list">{props.links.map((link: any) => <div className="shortcut-row" key={link.id}><button className="shortcut-enter" onClick={() => { setOpen(false); props.enter(link.target); }}><span className="shortcut-glyph"><Link size={18}/></span><span><strong>{link.title}</strong><small>{link.target.toUpperCase()}</small></span><ArrowUpRight size={17}/></button>{props.canManage && <><button className="icon-button" aria-label={'Move shortcut to ' + link.title + ' here'} title="Move in front of me" disabled={busy} onClick={() => run(() => props.move(link))}><Move size={16}/></button><button className="icon-button" aria-label={'Remove shortcut to ' + link.title} title="Remove shortcut" disabled={busy} onClick={() => run(async () => { await props.remove(link); })}><Trash2 size={16}/></button></>}</div>)}{!props.links.length && <p className="shortcut-empty">No shortcuts in this room yet.</p>}</div>{props.canManage ? <div className="shortcut-create"><div className="studio-tabs"><button className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>Link an existing room</button><button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>Create a new room</button></div><form onSubmit={e => { e.preventDefault(); run(async () => { let id = target; if (mode === 'new') {
        const created = await api('rooms', 'POST', { title: title.trim() });
        id = created.id;
        setTarget(id);
        setMode('existing');
        setRooms(rs => [...rs, { id, title: title.trim() }]);
        setTitle('');
    } await props.add(id); setTarget(''); }); }}>{mode === 'existing' ? <label>Destination room<select value={target} onChange={e => setTarget(e.target.value)} required><option value="">Choose a public room…</option>{available.map(r => <option key={r.id} value={r.id}>{r.title} · {r.id.toUpperCase()}</option>)}</select></label> : <label>New room name<input maxLength={100} placeholder="e.g. Drawings & details" value={title} onChange={e => setTitle(e.target.value)} required/></label>}<p className="shortcut-placement">The bubble will be placed in front of your current view. Use Move to bring an existing shortcut here.</p><button className="primary full" disabled={busy || (mode === 'existing' ? !target : !title.trim()) || props.links.length >= 20}>{busy ? <Loader2 size={15} className="spin"/> : <Plus size={16}/>} {mode === 'new' ? 'Create room + shortcut' : 'Add shortcut inside this room'}</button></form><small>Removing a shortcut preserves its destination room. Up to 20 shortcuts per room.</small></div> : <p className="access-note">The room creator can add and move shortcuts. Open a shortcut above or select its bubble in 3D.</p>}{error && <p className="studio-error" role="alert">{error}</p>}</section></div>, document.body)}</>;
});
