'use client';
import { useEffect, useState } from 'react';
import { Box, Plus, ArrowUpRight, ArrowRight, Search, Glasses, Smartphone, Monitor, Users, StickyNote, FileText, Link, Copy, Check, X, Loader2, Clock, Layers, RefreshCw, Trash2, RotateCcw } from 'lucide-react';
import { api, rememberRoom } from '../lib/client-api';
type Room = {
    id: string;
    title: string;
    created: number;
    models: number;
    documents: number;
    notes: number;
    people: number;
    canManage?: boolean;
    live?: boolean;
    slides?: number;
};
export default function Lobby() {
    const [removeRoom, setRemoveRoom] = useState<Room | null>(null), [removed, setRemoved] = useState<Room | null>(null);
    const [rooms, setRooms] = useState<Room[]>([]), [search, setSearch] = useState(''), [recent, setRecent] = useState<string[]>([]), [onlyRecent, setOnlyRecent] = useState(false), [creating, setCreating] = useState(false), [roomTitle, setRoomTitle] = useState(''), [name, setName] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [copied, setCopied] = useState(''), [deviceGuide, setDeviceGuide] = useState(false);
    async function refresh() {
        try {
            const v = await api('rooms');
            setRooms(v.rooms);
            setError('');
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        setName(localStorage.getItem('pinspace-name') || '');
        try {
            setRecent(JSON.parse(localStorage.getItem('pinspace-recent-rooms') || '[]'));
        }
        catch { }
        refresh();
        const t = setInterval(refresh, 12000);
        return () => clearInterval(t);
    }, []);
    async function create(e: React.FormEvent) {
        e.preventDefault();
        if (busy || !roomTitle.trim())
            return;
        setBusy(true);
        try {
            if (name.trim())
                localStorage.setItem('pinspace-name', name.trim());
            const v = await api('rooms', 'POST', { title: roomTitle.trim() });
            enter(v.id);
        }
        catch (e) {
            setError((e as Error).message);
            setBusy(false);
        }
    }
    function enter(id: string) { rememberRoom(id); location.assign('/?room=' + encodeURIComponent(id)); }
    async function join(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        try {
            const raw = code.trim();
            let id = raw.toLowerCase();
            if (raw.includes('?'))
                id = new URL(raw, location.origin).searchParams.get('room') || '';
            if (!/^[a-f0-9]{8}$/.test(id))
                throw Error('Enter an 8-character room code or a Pinspace room link.');
            await api('rooms/' + id);
            enter(id);
        }
        catch (e) {
            setError((e as Error).message);
            setBusy(false);
        }
    }
    async function copy(r: Room) {
        try {
            await navigator.clipboard.writeText(location.origin + '/?room=' + r.id);
            setCopied(r.id);
            setTimeout(() => setCopied(''), 2500);
        }
        catch {
            setError('Clipboard unavailable. Open the room and copy its address.');
        }
    }
    async function remove() {
        if (!removeRoom)
            return;
        try {
            await api('rooms/' + removeRoom.id, 'DELETE');
            setRemoved(removeRoom);
            setRemoveRoom(null);
            await refresh();
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    async function restoreRoom() {
        if (!removed)
            return;
        try {
            await api('rooms/' + removed.id + '/restore', 'POST', {});
            setRemoved(null);
            await refresh();
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    const visible = rooms.filter(r => (!onlyRecent || recent.includes(r.id)) && (r.title + ' ' + r.id).toLowerCase().includes(search.toLowerCase()));
    return <main className="lobby">
 <header className="lobby-header"><a className="brand" href="/" aria-label="Pinspace home"><span className="brandmark"><Box size={22}/></span>pinspace<span className="beta">BETA</span></a><span className="lobby-public"><i />Public session space</span><a className="session-3d-link" href="/?space=1"><Glasses size={17}/>Enter 3D session</a><button className="lobby-guide" onClick={() => setDeviceGuide(true)}><Glasses size={17}/>Device guide</button><button className="primary" onClick={() => setCreating(true)}><Plus size={16}/>New presentation</button></header>
 <div className="lobby-content"><section className="lobby-hero"><div><span className="eyebrow">A STAGE FOR YOUR NEXT BIG IDEA</span><h1>Present beyond<br /><span>the slide.</span></h1><p>Turn 3D models and PDF drawings into a guided story.<br className="desktop"/> Present live. Talk it through. Invite anyone inside.</p><div className="hero-actions"><button className="primary" onClick={() => setCreating(true)}><Plus size={17}/>Create a presentation<ArrowUpRight size={15}/></button><a href="/?space=1">Enter session space<ArrowRight size={15}/></a></div><div className="device-chips"><span><Monitor size={14}/>Desktop</span><span><Smartphone size={14}/>Mobile</span><span><Glasses size={16}/>Quest & Cardboard</span></div></div><div className="space-illustration" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="room-cube"><Box size={115} strokeWidth={.7}/><span>YOUR IDEAS.<br />CENTER STAGE.</span></div><div className="floating-note"><StickyNote size={18}/><span>Live views.<br />Shared ideas.</span><i /></div><div className="floating-file"><Layers size={20}/><span>Models & drawings</span></div><span className="diagram-plus">+</span><span className="diagram-dot"/></div></section>
 {error && <div className="lobby-error" role="alert">{error}<button onClick={() => { setError(''); refresh(); }}>Try again<RefreshCw size={13}/></button></div>}
 <section className="session-directory"><div className="directory-heading"><div><span className="eyebrow">PREPARE. PRESENT. DISCUSS.</span><h2>Presentation rooms <span>{rooms.length}</span></h2><p>Rooms appear as shortcuts here and teleport bubbles in the 3D session space.</p></div><form className="join-room" onSubmit={join}><label htmlFor="room-code">Have a room code?</label><div><input id="room-code" placeholder="Code or room link" value={code} onChange={e => setCode(e.target.value)} required/><button disabled={busy || !code.trim()} aria-label="Join room"><ArrowRight size={17}/></button></div></form></div>
 <div className="directory-controls"><div className="directory-tabs"><button className={!onlyRecent ? 'selected' : ''} onClick={() => setOnlyRecent(false)}>All public rooms</button><button className={onlyRecent ? 'selected' : ''} onClick={() => setOnlyRecent(true)}><Clock size={13}/>Recently visited</button></div><div className="directory-search"><Search size={15}/><input aria-label="Search rooms" placeholder="Find a room…" value={search} onChange={e => setSearch(e.target.value)}/></div></div>
 <div className="room-grid"><button className="new-room-card" onClick={() => setCreating(true)}><span><Plus size={24}/></span><h3>A new perspective starts here.</h3><p>Build an outline of model views and drawings for your next presentation.</p><strong>Create a presentation<ArrowUpRight size={15}/></strong></button>{loading ? <div className="directory-loading"><Loader2 className="spin" size={21}/>Loading rooms…</div> : visible.map((r, i) => <article className="room-shortcut" key={r.id}><div className={'room-card-art art-' + (i % 3)}><Box size={56} strokeWidth={1}/><span className="room-art-label">PRESENTATION ROOM</span><span className={'room-live ' + (r.people ? '' : 'quiet')}><i />{r.live ? 'Presenting live' : r.people ? r.people + ' in room' : 'Ready to join'}</span></div><div className="room-card-body"><a className="room-title-link" href={'/?room=' + r.id} onClick={() => rememberRoom(r.id)}><h3>{r.title}</h3><ArrowUpRight size={18}/></a><div className="room-code">ROOM {r.id.toUpperCase()}{recent.includes(r.id) && <span>Visited</span>}</div><div className="room-stats"><span><Box size={13}/>{r.models} models</span><span><FileText size={13}/>{r.documents} PDFs</span><span><Layers size={13}/>{r.slides || 0} slides</span></div><div className="room-card-footer"><a href={'/?room=' + r.id} onClick={() => rememberRoom(r.id)}>Enter room<ArrowRight size={14}/></a>{!!r.canManage && <button aria-label={'Remove room ' + r.title} onClick={() => setRemoveRoom(r)}><Trash2 size={16}/></button>}<button onClick={() => copy(r)} aria-label={'Copy link to ' + r.title} title="Copy room link">{copied === r.id ? <Check size={16}/> : <Link size={16}/>}</button></div></div></article>)}</div>{!loading && !visible.length && (search || onlyRecent) && <div className="no-rooms"><Search size={22}/><h3>No rooms found</h3><p>{onlyRecent ? 'Rooms you visit on this browser will appear here.' : 'Try a different name or room code.'}</p></div>}
 </section><footer className="lobby-footer"><span><Box size={15}/>One room. Any perspective.</span><span>Public rooms and their uploaded content are visible to anyone.</span><button onClick={() => setDeviceGuide(true)}>How to join in VR<ArrowUpRight size={13}/></button></footer></div>
 {removeRoom && <div className="modal-backdrop" onClick={() => setRemoveRoom(null)}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="remove-room-title" onClick={e => e.stopPropagation()}><h2 id="remove-room-title">Remove {removeRoom.title}?</h2><p>The shortcut and teleport bubble will be hidden. Its models and notes are preserved; Undo restores the room.</p><div className="confirm-actions"><button className="upload" onClick={() => setRemoveRoom(null)}>Cancel</button><button className="primary" onClick={remove}><Trash2 size={15}/>Remove room</button></div></section></div>}
 {removed && <div className="undo-bar" role="status"><span>{removed.title} removed</span><button onClick={restoreRoom}><RotateCcw size={15}/>Undo</button><button aria-label="Dismiss undo" onClick={() => setRemoved(null)}><X size={15}/></button></div>}
 {creating && <div className="modal-backdrop" onClick={() => setCreating(false)}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-title" onClick={e => e.stopPropagation()}><button className="icon-button close-dialog" onClick={() => setCreating(false)} aria-label="Close"><X size={19}/></button><span className="eyebrow">MAKE SPACE FOR YOUR TEAM</span><h2 id="create-title">Create a presentation room.</h2><p>A room keeps your models, PDF sheets and sticky notes together. It gets its own shortcut in Session space.</p><form onSubmit={create}><label>Room name<input autoFocus maxLength={100} placeholder="e.g. Kemper Hall · Design presentation" value={roomTitle} onChange={e => setRoomTitle(e.target.value)} required/></label><label>Your display name<input maxLength={50} placeholder="How your team sees you" value={name} onChange={e => setName(e.target.value)}/></label><p className="public-room-notice"><Users size={16}/>This is a public room. Anyone can open its link and view shared files and comments.</p><button className="primary full" disabled={busy || !roomTitle.trim()}>{busy ? <Loader2 size={16} className="spin"/> : <Plus size={16}/>}Create and enter room</button>{error && <p className="form-error" role="alert">{error}</p>}</form></section></div>}
 {deviceGuide && <div className="modal-backdrop" onClick={() => setDeviceGuide(false)}><section className="dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="devices-title" onClick={e => e.stopPropagation()}><button className="icon-button close-dialog" onClick={() => setDeviceGuide(false)} aria-label="Close"><X size={19}/></button><span className="eyebrow">CHOOSE YOUR PERSPECTIVE</span><h2 id="devices-title">One link. Your device.</h2><div className="help-grid"><article><Monitor /><h3>Desktop browser</h3><p>Open a room shortcut. Drag to orbit, scroll to zoom, right-drag to pan. Walk with WASD. Choose Add sticky note and click a model surface.</p></article><article><Smartphone /><h3>Mobile browser</h3><p>Open the same room link. Drag to orbit and pinch to zoom. Use the library and comments buttons at the top. Walk with the touch joystick; drag the scene to look.</p></article><article><Glasses /><h3>Quest or dedicated VR</h3><p>Open the public link in your headset browser. Enter a room, choose VR setup, then Start headset VR. Left stick moves; right stick turns. Left trigger teleports; right trigger selects and places notes.</p></article><article><Glasses /><h3>Cardboard phone headset</h3><p>Enter a room on your phone, join audio first, then choose VR setup → Start Cardboard mode. Allow motion access if requested and rotate to landscape. The menu stays on a fixed heading. Look down to reach it; hold a tap for one second to bring it in front of you. Gaze at a floor destination and tap to move. Gaze at a bubble, control or keyboard key and tap to select. Choose Note, gaze at a model surface, and tap to add a sticky note. Center resets your heading.</p></article></div><p className="access-note">Immersive VR needs WebGL and a compatible WebXR browser. Cardboard provides stereo viewing and orientation tracking where supported; it does not provide tracked walking. Browser and phone permissions vary.</p><button className="primary" onClick={() => setDeviceGuide(false)}>Back to Session space<ArrowRight size={15}/></button></section></div>}
 </main>;
}
