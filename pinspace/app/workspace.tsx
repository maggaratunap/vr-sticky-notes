'use client';
import { useEffect, useRef, useState } from 'react';
import RoomShortcuts from '../components/room-shortcuts';
import PresentationStudio from '../components/presentation-studio';
import type { PresentationSlide, CameraFrame } from '../lib/presentation';
import Joystick from '../components/joystick';
import ModelControls from '../components/model-controls';
import { defaultModelTransform, type ModelTransform } from '../lib/model-transform';
import { ModelTransformSync, type TransformRecord } from '../lib/model-transform-sync';
import AvatarEditor, { AvatarPortrait } from '../components/avatar-editor';
import { loadAvatar, saveAvatar, normalizeAvatar, type Avatar } from '../lib/avatar';
import FlightControls from '../components/flight-controls';
import CardboardSettings from '../components/cardboard-settings';
import { loadCardboard, saveCardboard, type CardboardSettings as LensSettings } from '../lib/cardboard';
import { RelayVoice, prepareVoice } from '../lib/relay-voice';
import { api, leaveRoom, rememberRoom } from '../lib/client-api';
import { Box, Layers, FileText, Plus, Upload, MessageSquare, Mic, MicOff, Users, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Check, CheckCheck, Search, X, Link, Maximize, Move, Scissors, Eye, Home, HelpCircle, Glasses, MousePointer2, StickyNote, PanelLeft, PanelRight, Download, Loader2, Volume2, FolderOpen, ArrowLeft, Smartphone, Trash2, RotateCcw } from 'lucide-react';
type Asset = {
    id: string;
    name: string;
    kind: string;
    size: number;
    canManage?: boolean;
};
type Note = {
    id: string;
    body: string;
    author: string;
    color: string;
    position: string;
    asset: string | null;
    resolved: number;
    created: number;
    canManage?: boolean;
};
type Peer = {
    id: string;
    name: string;
    pose: string;
    avatar?: Avatar;
    mic: number;
};
export default function Page() {
    const [modelValue, setModelValue] = useState(defaultModelTransform), [modelEnabled, setModelEnabled] = useState(true), [modelAvailable, setModelAvailable] = useState(false), [modelPanel, setModelPanel] = useState(false);
    const modelSyncRef = useRef<ModelTransformSync | null>(null);
    if (!modelSyncRef.current) modelSyncRef.current = new ModelTransformSync((id, body) => api('rooms/' + id + '/model-transform', 'PATCH', body));
    const modelSync = modelSyncRef.current;
    const [avatar, setAvatar] = useState(loadAvatar), [avatarEditor, setAvatarEditor] = useState(false);
    const avatarRef = useRef(avatar);
    const [flying, setFlying] = useState(false);
    const [cardboard, setCardboard] = useState(loadCardboard);
    const updateCardboard = (settings: LensSettings) => {
        setCardboard(settings);
        saveCardboard(settings);
        engine.current?.setCardboardSettings(settings);
    };
    const [hall, setHall] = useState(false), [portalRooms, setPortalRooms] = useState<any[]>([]), [roomOwner, setRoomOwner] = useState(false), [createInHall, setCreateInHall] = useState(false), [newTitle, setNewTitle] = useState(''), [removeTarget, setRemoveTarget] = useState<any>(null), [undo, setUndo] = useState<any>(null), [sampleHidden, setSampleHidden] = useState(false), [audioBusy, setAudioBusy] = useState(false), [touchMode, setTouchMode] = useState(false);
    const shortcutsPanel = useRef<any>(null), shortcutsRef = useRef<any[]>([]), [shortcuts, setShortcuts] = useState<any[]>([]);
    const assetsRef = useRef<Asset[]>([]);
    const studio = useRef<any>(null), requestedPdfPage = useRef(1), [filesMode, setFilesMode] = useState(false);
    const pdfRef = useRef<Asset | null>(null);
    const hallRef = useRef(false), nav = useRef<any>({}), undoRef = useRef<any>(null), selectedOnce = useRef(''), initialHall = useRef(false), voicePreparing = useRef(false);
    const viewport = useRef<HTMLDivElement>(null), engine = useRef<any>(null), file = useRef<HTMLInputElement>(null), localId = useRef(''), roomRef = useRef(''), activeRef = useRef<string | null>(null), nameRef = useRef(''), micRef = useRef(false), noteCallback = useRef<any>(null);
    const [ready, setReady] = useState(false), [assets, setAssets] = useState<Asset[]>([]), [notes, setNotes] = useState<Note[]>([]), [peers, setPeers] = useState<Peer[]>([]), [room, setRoom] = useState(''), [title, setTitle] = useState('Untitled presentation'), [name, setName] = useState(''), [active, setActive] = useState<Asset | null>(null), [tab, setTab] = useState('notes'), [filter, setFilter] = useState('open'), [search, setSearch] = useState(''), [placing, setPlacing] = useState(false), [point, setPoint] = useState<number[] | null>(null), [body, setBody] = useState(''), [color, setColor] = useState('yellow'), [busy, setBusy] = useState(''), [toast, setToast] = useState(''), [help, setHelp] = useState(false), [invite, setInvite] = useState(false), [mic, setMic] = useState(false), [voiceState, setVoiceState] = useState('Microphone off'), [left, setLeft] = useState(false), [right, setRight] = useState(false), [xray, setXray] = useState(false), [section, setSection] = useState(false), [walk, setWalk] = useState(false), [pdf, setPdf] = useState<Asset | null>(null), [pdfPage, setPdfPage] = useState(1), [pdfTotal, setPdfTotal] = useState(0), [pdfOpen, setPdfOpen] = useState(false), [vrSetup, setVrSetup] = useState(false), [xr, setXr] = useState(false), [stereo, setStereo] = useState(false), [error, setError] = useState(''), [viewerNotice, setViewerNotice] = useState('');
    pdfRef.current = pdf;
    const pdfRenderTask = useRef<any>(null), pdfRenderVersion = useRef(0);
    const pdfCanvas = useRef<HTMLCanvasElement>(null), pdfDoc = useRef<any>(null), voice = useRef<any>(null), creating = useRef<Promise<string> | null>(null);
    const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4500); };
    modelSync.onConflict = (id, record, message) => {
        if (roomRef.current !== id) return;
        const viewer = engine.current;
        if (viewer?.modelAssetId === record.asset) { viewer.manipulator.finish(false); viewer.manipulator.apply(record.transform); }
        notify(message);
    };
    modelSync.onError = message => setError(message);
    function receiveModelTransforms(id: string, records: TransformRecord[]) {
        const viewer = engine.current, manipulator = viewer?.manipulator;
        modelSync.receive(id, records, manipulator?.active ? viewer.modelAssetId : undefined);
        if (manipulator?.ready && !manipulator.active && !modelSync.busy(id, viewer.modelAssetId)) {
            const value = modelSync.get(id, viewer.modelAssetId).transform;
            if (JSON.stringify(value) !== JSON.stringify(manipulator.value())) manipulator.apply(value);
        }
    }
    function applyAvatar(value: Avatar) {
        const next = normalizeAvatar(value);
        avatarRef.current = next; setAvatar(next); saveAvatar(next); engine.current?.setSelfAvatar(next);
    }
    function saveAvatarEditor(value: Avatar, displayName: string) {
        applyAvatar(value); setName(displayName); nameRef.current = displayName; setAvatarEditor(false); notify('Avatar saved. Everyone in the room will see your new look.');
    }
    useEffect(() => { if (avatarEditor) engine.current?.stopMovement(); }, [avatarEditor]);
    async function ensureRoom() {
        if (roomRef.current)
            return roomRef.current;
        if (!creating.current)
            creating.current = api('rooms', 'POST', { title }).then(v => { roomRef.current = v.id; rememberRoom(v.id); setRoom(v.id); history.replaceState(null, '', '?room=' + v.id); return v.id; }).finally(() => creating.current = null);
        return creating.current;
    }
    useEffect(() => {
        const mobile = () => setTouchMode(window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 700);
        mobile();
        window.addEventListener('resize', mobile);
        localId.current = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), v => v.toString(16).padStart(2, '0')).join('');
        const n = localStorage.getItem('pinspace-name') || 'Guest reviewer';
        setName(n);
        nameRef.current = n;
        const r = new URLSearchParams(location.search).get('room') || '';
        roomRef.current = r;
        if (r)
            rememberRoom(r);
        setRoom(r);
        initialHall.current = new URLSearchParams(location.search).has('space');
        hallRef.current = initialHall.current;
        setHall(initialHall.current);
        let mounted = true;
        import('../lib/viewer').then(async ({ Viewer }) => {
            if (!mounted || !viewport.current)
                return;
            const v = new Viewer(viewport.current, (p: number[]) => noteCallback.current?.(p), (m: string) => notify(m));
            engine.current = v;
            let lastModelUi = 0;
            v.manipulator.onState = () => {
                const now = performance.now();
                if (v.manipulator.active && now - lastModelUi < 100) return;
                lastModelUi = now; setModelValue(v.manipulator.value()); setModelEnabled(v.manipulator.enabled); setModelAvailable(v.manipulator.available);
            };
            v.manipulator.onChange = (value, final, asset) => { if (roomRef.current && !hallRef.current) modelSync.queue(roomRef.current, asset, value, final); };
            v.manipulator.onState();
            v.setSelfAvatar(avatarRef.current);
            v.onAvatarChange = applyAvatar;
            v.onFlyChange = on => { setFlying(on); if (on) setWalk(true); };
            v.onRoom = (id: string) => nav.current.room(id);
            v.onSession = () => nav.current.hall();
            v.onNewRoom = () => nav.current.create();
            v.onShortcut = () => nav.current.shortcuts();
            v.onRemove = (item: any) => nav.current.remove(item);
            await v.init();
            if (initialHall.current) {
                v.clearModel();
                nav.current.load();
            }
            if (mounted) {
                setReady(true);
                setXr(v.xrSupported);
                if (v.fallback)
                    setViewerNotice('Simplified 3D view · WebGL is unavailable in this browser. Use a WebGL-enabled browser for VR.');
            }
        }).catch(() => setError('The 3D viewer could not start. Check that WebGL is enabled and reload.'));
        const back = () => {
            const q = new URLSearchParams(location.search);
            if (q.has('space'))
                nav.current.hall(false);
            else if (q.get('room'))
                nav.current.room(q.get('room'), false);
            else
                location.assign('/');
        };
        window.addEventListener('popstate', back);
        return () => { window.removeEventListener('popstate', back); window.removeEventListener('resize', mobile); mounted = false; modelSync.close(); engine.current?.dispose(); voice.current?.close(); };
    }, []);
    useEffect(() => {
        nameRef.current = name;
        if (name) { try { localStorage.setItem('pinspace-name', name); } catch {} }
    }, [name]);
    noteCallback.current = async (p: number[]) => {
        if ((engine.current?.isXR || engine.current?.stereoscopic)) {
            engine.current.openKeyboard(p, async (text: string) => {
                try {
                    await saveNote(text, p);
                }
                catch (e) {
                    notify((e as Error).message);
                    throw e;
                }
            });
        }
        else {
            setPoint(p);
            setPlacing(false);
            engine.current?.setPlacing(false);
        }
    };
    async function saveNote(text = body, p = point) {
        if (!text.trim() || !p)
            return;
        const id = await ensureRoom();
        await api('rooms/' + id + '/notes', 'POST', { body: text.trim(), author: nameRef.current || 'Guest reviewer', color, position: p, asset: activeRef.current });
        setPoint(null);
        setBody('');
        await sync();
        notify('Sticky note saved to the room');
    }
    async function loadHall() {
        if (hallRef.current && roomRef.current !== 'session-lounge') {
            const lounge = await api('lounge');
            roomRef.current = lounge.id;
            setRoom(lounge.id);
        }
        const data = await api('rooms');
        setPortalRooms(data.rooms);
        if (hallRef.current)
            engine.current?.setPortals(data.rooms);
        return data.rooms;
    }
    function stopVoice() { voice.current?.close(); voice.current = null; micRef.current = false; setMic(false); setVoiceState('Microphone off'); }
    function clearRoomView() { modelSync.clear(); setModelPanel(false); shortcutsRef.current = []; setShortcuts([]); engine.current?.setPresentationContent('model'); activeRef.current = null; setActive(null); setAssets([]); setNotes([]); setRoomOwner(false); setPeers([]); setPdf(null); setPdfOpen(false); pdfDoc.current?.destroy(); pdfDoc.current = null; engine.current?.clearPdf(); engine.current?.setNotes([]); engine.current?.setPeers([]); setSampleHidden(false); setLeft(false); setRight(false); setPlacing(false); setRemoveTarget(null); engine.current?.resetNavigation(); }
    async function enterHall(push = true) {
        if (roomRef.current)
            leaveRoom(roomRef.current, localId.current);
        stopVoice();
        roomRef.current = '';
        setRoom('');
        hallRef.current = true;
        setHall(true);
        clearRoomView();
        setTitle('Session space');
        if (push)
            history.pushState(null, '', '?space=1');
        await loadHall();
    }
    async function enterRoom(id: string, push = true) {
        if (roomRef.current && roomRef.current !== id)
            leaveRoom(roomRef.current, localId.current);
        stopVoice();
        hallRef.current = false;
        setHall(false);
        engine.current?.clearPortals();
        clearRoomView();
        roomRef.current = id;
        selectedOnce.current = '';
        rememberRoom(id);
        setRoom(id);
        if (push)
            history.pushState(null, '', '?room=' + id);
        engine.current?.demo();
        await sync();
    }
    async function createPortal(title: string) {
        if (!title.trim())
            return;
        const result = await api('rooms', 'POST', { title: title.trim() });
        await loadHall();
        setCreateInHall(false);
        setNewTitle('');
        notify('Room created. Its teleport bubble is now in the session space.');
        return result.id;
    }
    function newPortal() {
        if (engine.current?.isXR || engine.current?.stereoscopic)
            engine.current.openKeyboard([0, 0, 0], createPortal);
        else
            setCreateInHall(true);
    }
    async function addShortcut(target: string) {
        const source = roomRef.current;
        if (!source || hallRef.current)
            return;
        await api('rooms/' + source + '/shortcuts', 'POST', { target, position: engine.current?.shortcutPosition(shortcutsRef.current.length) || [0, 1.5, 4] });
        if (source === roomRef.current)
            await sync();
        notify('Shortcut added inside this room.');
    }
    async function moveShortcut(link: any) { await api('rooms/' + roomRef.current + '/shortcuts/' + link.id, 'PATCH', { position: engine.current?.shortcutPosition(shortcutsRef.current.length) || [0, 1.5, 4] }); await sync(); notify('Shortcut moved in front of your view.'); }
    function openShortcuts() {
        if (!roomOwner && (engine.current?.isXR || engine.current?.stereoscopic)) {
            notify('Gaze at a room shortcut bubble and tap to enter.');
            return;
        }
        if (engine.current?.isXR || engine.current?.stereoscopic) {
            engine.current.openKeyboard([0, 0, 0], async (text: string) => { const raw = text.trim().toLowerCase(); let target = raw; if (raw.includes('?'))
                target = new URL(raw, location.origin).searchParams.get('room') || ''; await addShortcut(target); }, 'Enter destination room code, then Save.');
        }
        else
            shortcutsPanel.current?.open();
    }
    async function commitRemove(item: any) {
        const target = { ...item, room: item.room || roomRef.current, wasActive: item.kind === 'assets' && item.id === activeRef.current, wasPdf: item.kind === 'assets' && item.id === pdfRef.current?.id };
        const path = target.kind === 'room' ? 'rooms/' + target.id : 'rooms/' + target.room + '/' + target.kind + '/' + target.id;
        await api(path, 'DELETE');
        setRemoveTarget(null);
        undoRef.current = target;
        setUndo(target);
        if (target.kind === 'room') {
            if (target.id === roomRef.current)
                await enterHall();
            else
                await loadHall();
        }
        else
            await sync();
        notify(target.label + ' removed. Undo is available.');
    }
    async function restore() {
        const target = undoRef.current;
        if (!target)
            return;
        const path = target.kind === 'room' ? 'rooms/' + target.id + '/restore' : 'rooms/' + target.room + '/' + target.kind + '/' + target.id + '/restore';
        await api(path, 'POST', {});
        undoRef.current = null;
        setUndo(null);
        if (hallRef.current)
            await loadHall();
        else {
            const state = await sync();
            if (target.wasActive || target.wasPdf) {
                const asset = state?.assets.find((a: Asset) => a.id === target.id);
                if (asset)
                    await choose(asset);
            }
        }
        notify('Restored');
    }
    nav.current = { hall: enterHall, room: enterRoom, load: loadHall, create: newPortal, shortcuts: openShortcuts, remove: (item: any) => {
            if (engine.current?.isXR || engine.current?.stereoscopic)
                commitRemove(item).catch((e: Error) => notify(e.message));
            else
                setRemoveTarget(item);
        } };
    useEffect(() => { engine.current?.setUndo(undo ? () => restore().catch((e: Error) => notify(e.message)) : null); }, [undo, ready]);
    useEffect(() => {
        if (!hall)
            return;
        const timer = setInterval(() => loadHall().catch((e: Error) => setError(e.message)), 4000);
        return () => clearInterval(timer);
    }, [hall, ready]);
    async function sync() {
        if (!roomRef.current)
            return;
        const requested = roomRef.current, s = await api('rooms/' + requested);
        if (roomRef.current !== requested)
            return;
        if (!hallRef.current) receiveModelTransforms(requested, s.modelTransforms || []);
        if (hallRef.current) {
            setPeers(s.peers.filter((p: Peer) => p.id !== localId.current));
            engine.current?.setPeers(s.peers.filter((p: Peer) => p.id !== localId.current));
            return s;
        }
        assetsRef.current = s.assets;
        setAssets(s.assets);
        setNotes(s.notes);
        setRoomOwner(!!s.room.canManage);
        setPeers(s.peers.filter((p: Peer) => p.id !== localId.current));
        setTitle(s.room.title);
        engine.current?.setNotes(s.notes.filter((n: Note) => n.asset === activeRef.current));
        engine.current?.setPeers(s.peers.filter((p: Peer) => p.id !== localId.current));
        if (activeRef.current && !s.assets.some((a: Asset) => a.id === activeRef.current)) {
            engine.current?.clearModel();
            activeRef.current = null;
            setActive(null);
            setSampleHidden(true);
        }
        if (pdfRef.current && !s.assets.some((a: Asset) => a.id === pdfRef.current?.id)) {
            setPdf(null);
            setPdfOpen(false);
            pdfDoc.current?.destroy();
            pdfDoc.current = null;
            engine.current?.clearPdf();
        }
        if (ready && selectedOnce.current !== requested) {
            selectedOnce.current = requested;
            const model = s.assets.find((a: Asset) => a.kind === 'glb');
            if (model)
                await choose(model);
        }
        shortcutsRef.current = s.shortcuts || [];
        setShortcuts(s.shortcuts || []);
        if (ready) {
            engine.current?.setRoomShortcuts(s.shortcuts || [], !!s.room.canManage);
            studio.current?.ingest(s.presentation);
        }
        return s;
    }
    useEffect(() => {
        if (!room)
            return;
        let stopped = false;
        const seen = new Set<string>();
        let ack: string[] = [];
        async function tick() {
            try {
                await sync();
                const v = await api('rooms/' + room + '/presence', 'POST', { id: localId.current, name: nameRef.current || 'Guest reviewer', pose: engine.current?.pose() || [0, 1.6, 8], avatar: avatarRef.current, mic: voice.current ? (micRef.current ? 1 : 2) : 0, ack });
                ack = [];
                for (const s of v.signals) {
                    ack.push(s.id);
                    if (seen.has(s.id))
                        continue;
                    seen.add(s.id);
                    await voice.current?.receive(s.sender, JSON.parse(s.payload));
                }
                voice.current?.updatePeers();
                setError('');
            }
            catch (e) {
                if (!stopped) {
                    if ((e as Error).message.startsWith('Room not found')) {
                        enterHall();
                        notify('The room was removed or is unavailable.');
                    }
                    else
                        setError((e as Error).message);
                }
            }
            if (!stopped)
                timer = setTimeout(tick, 1700);
        }
        let timer: ReturnType<typeof setTimeout>;
        tick();
        return () => { stopped = true; clearTimeout(timer); leaveRoom(room, localId.current); };
    }, [room, ready]);
    useEffect(() => {
        if (!ready)
            return;
        engine.current?.setNotes(notes.filter(n => n.asset === activeRef.current));
    }, [active, notes, ready]);
    async function choose(a: Asset | null) {
        if (a?.kind === 'pdf') {
            setPdf(a);
            requestedPdfPage.current = 1;
            setPdfPage(1);
            setPdfOpen(true);
            return;
        }
        setBusy(a ? 'Loading model…' : '');
        try {
            if (a) {
                await engine.current?.loadModel('/api/asset/' + a.id, a.id, modelSync.get(roomRef.current, a.id).transform);
                engine.current.modelAssetId = a.id;
                setSampleHidden(false);
            }
            else
                engine.current?.demo(modelSync.get(roomRef.current, null).transform);
            setSampleHidden(false);
            activeRef.current = a?.id || null;
            setActive(a);
            setLeft(false);
            setWalk(false);
            setSection(false);
            setXray(false);
            engine.current?.section(false);
            engine.current?.xray(false);
        }
        catch (e) {
            notify('Model could not load: ' + (e as Error).message);
        }
        finally {
            setBusy('');
        }
    }
    async function upload(files: FileList | null) {
        if (!files?.length)
            return;
        setBusy('Uploading…');
        try {
            const id = await ensureRoom();
            for (const f of Array.from(files)) {
                if (!/\.(glb|pdf)$/i.test(f.name))
                    throw Error('Please choose a GLB or PDF file.');
                if (f.size > 40 * 1024 * 1024)
                    throw Error('Files must be 40 MB or smaller.');
                const form = new FormData();
                form.append('file', f);
                await api('rooms/' + id + '/assets', 'POST', form);
            }
            const s = await sync();
            const a = s.assets.at(-1);
            if (a)
                await choose(a);
            notify('Files added to this room');
        }
        catch (e) {
            notify((e as Error).message);
        }
        finally {
            setBusy('');
            if (file.current)
                file.current.value = '';
        }
    }
    useEffect(() => {
        if (!pdf)
            return;
        let cancelled = false;
        setBusy('Opening PDF…');
        import('pdfjs-dist').then(async (p) => {
            p.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
            const doc = await p.getDocument({ url: '/api/asset/' + pdf.id, isEvalSupported: false }).promise;
            if (cancelled) {
                doc.destroy();
                return;
            }
            pdfDoc.current?.destroy();
            pdfDoc.current = doc;
            setPdfTotal(doc.numPages);
            const page = Math.min(doc.numPages, requestedPdfPage.current);
            setPdfPage(page);
            setBusy('');
            renderPdf(page, doc);
        }).catch(() => { notify('Unable to open this PDF. Try an unencrypted PDF.'); setBusy(''); });
        return () => { cancelled = true; };
    }, [pdf]);
    async function renderPdf(page: number, doc = pdfDoc.current) {
        if (!doc || !pdfCanvas.current)
            return;
        const version = ++pdfRenderVersion.current;
        const previous = pdfRenderTask.current;
        previous?.cancel();
        try {
            if (previous)
                await previous.promise.catch(() => { });
            const p = await doc.getPage(page);
            if (version !== pdfRenderVersion.current || doc !== pdfDoc.current)
                return;
            const v = p.getViewport({ scale: 1.4 }), c = pdfCanvas.current;
            c.width = v.width;
            c.height = v.height;
            const task = p.render({ canvasContext: c.getContext('2d'), viewport: v });
            pdfRenderTask.current = task;
            await task.promise;
            if (version !== pdfRenderVersion.current)
                return;
            if (engine.current)
                engine.current.pdfAssetId = pdfRef.current?.id || null;
            engine.current?.setPdf(c, () => setPdfPage(x => Math.max(1, x - 1)), () => setPdfPage(x => Math.min(doc.numPages, x + 1)), page, doc.numPages);
        }
        catch (e) {
            if (version === pdfRenderVersion.current && (e as Error).name !== 'RenderingCancelledException')
                notify('This page could not render.');
        }
    }
    useEffect(() => {
        if (pdfDoc.current)
            renderPdf(pdfPage);
    }, [pdfPage]);
    async function toggleMic() {
        if (voicePreparing.current)
            return;
        voicePreparing.current = true;
        setAudioBusy(true);
        let prepared: any = null;
        try {
            if (!voice.current) {
                prepared = await prepareVoice();
                const id = await ensureRoom();
                await api('rooms/' + id + '/presence', 'POST', { id: localId.current, name: nameRef.current || 'Guest reviewer', pose: engine.current?.pose() || [0, 1.6, 8], avatar: avatarRef.current, mic: 0 });
                const relay = new RelayVoice(localId.current, (path: string, method = 'GET', data?: any) => api('rooms/' + id + '/' + path, method, data), prepared, setVoiceState);
                voice.current = relay;
                await relay.init();
            }
            const on = await voice.current.toggle();
            micRef.current = on;
            setMic(on);
        }
        catch (e) {
            stopVoice();
            if (prepared) {
                prepared.stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
                if (prepared.context.state !== 'closed')
                    prepared.context.close().catch(() => { });
            }
            notify((e as Error).message);
        }
        finally {
            voicePreparing.current = false;
            setAudioBusy(false);
        }
    }
    const peersRef = useRef<Peer[]>([]);
    peersRef.current = peers;
    async function copyInvite() {
        try {
            await ensureRoom();
            await navigator.clipboard.writeText(location.href);
            notify('Room link copied');
        }
        catch {
            notify('Copy the room URL from your address bar');
        }
    }
    function beginNote() {
        if (hallRef.current) {
            newPortal();
            return;
        }
        setPlacing(!placing);
        engine.current?.setPlacing(!placing);
        if (!placing)
            notify('Tap a surface in the model to place your note');
    }
    async function applySlide(slide: PresentationSlide, view: CameraFrame | null) {
        if (slide.kind === 'pdf') {
            const a = assetsRef.current.find(a => a.id === slide.asset);
            if (!a)
                throw Error('This PDF is no longer available.');
            requestedPdfPage.current = slide.page;
            setPdfOpen(true);
            setPdfPage(slide.page);
            if (pdfRef.current?.id !== a.id)
                setPdf(a);
            engine.current?.setPresentationContent('pdf');
        }
        else {
            setPdfOpen(false);
            engine.current?.setPresentationContent('model');
            if (activeRef.current !== slide.asset || sampleHidden)
                await choose(assetsRef.current.find(a => a.id === slide.asset) || null);
            if (view)
                engine.current?.applyFrame(view);
        }
    }
    const visible = notes.filter(n => (filter === 'all' || (filter === 'resolved' ? !!n.resolved : !n.resolved)) && (!search || (n.body + ' ' + n.author).toLowerCase().includes(search.toLowerCase())));
    return <main className={'workspace ' + (hall ? 'hall-workspace' : '')}>
 <header className="topbar"><a className="brand" href="/" aria-label="Pinspace home"><span className="brandmark"><Box size={22}/></span>pinspace<span className="beta">BETA</span></a><span className="top-divider"/><div className="breadcrumb"><a href="/">Session space</a> <span>/</span> <strong>{hall ? 'Session space' : title}</strong></div><div className="top-actions"><span className={'connection ' + (room ? 'online' : '')}><i />{room ? 'Room live' : 'Demo workspace'}</span><button className="icon-button" title="3D session space" aria-label="Enter 3D session space" onClick={() => enterHall()}><Home size={18}/></button>{roomOwner && !hall && <button className="icon-button" aria-label="Remove current room" title="Remove current room" onClick={() => setRemoveTarget({ kind: 'room', id: room, label: title })}><Trash2 size={17}/></button>}{!hall && room && <RoomShortcuts key={room} ref={shortcutsPanel} room={room} links={shortcuts} canManage={roomOwner} add={addShortcut} move={moveShortcut} remove={(link: any) => commitRemove({ kind: 'shortcuts', id: link.id, label: 'shortcut to ' + link.title })} enter={enterRoom}/>}<button className="icon-button help" onClick={() => setHelp(true)} aria-label="Help"><HelpCircle size={19}/></button><button className="invite" onClick={async () => {
            try {
                await ensureRoom();
                setInvite(true);
            }
            catch (e) {
                notify((e as Error).message);
            }
        }}><Users size={16}/>Invite<span className="desktop"> audience</span></button><button className="avatar self avatar-customize" title="Customize avatar" aria-label="Customize avatar" onClick={() => setAvatarEditor(true)}><AvatarPortrait avatar={avatar} label={name || "Your avatar"}/></button></div></header>
 <nav className="rail"><button aria-label="3D session space" onClick={() => enterHall()}><Home size={19}/></button><button className="rail-logo active" aria-label="Model workspace" onClick={() => setLeft(!left)}><Box /></button><button onClick={() => { setTab('notes'); setRight(!right); }} aria-label="Sticky notes"><StickyNote /></button><button onClick={() => { setLeft(true); setFilesMode(true); file.current?.click(); }} aria-label="Upload files"><FolderOpen /></button><div className="rail-bottom"><a className="sessions-back" href="/" title="Session space" aria-label="Session space"><Home size={19}/></a><button onClick={() => setHelp(true)} aria-label="Workspace help"><HelpCircle size={20}/></button></div></nav>
 {hall ? <aside className={'assets-panel ' + (left ? 'mobile-open' : '')}><div className="panel-heading"><div><span className="eyebrow">3D SESSION SPACE</span><h2>Room portals</h2></div><button className="icon-button mobile-only" aria-label="Close library" onClick={() => setLeft(false)}><X size={18}/></button></div><button className="upload" onClick={newPortal}><Plus size={17}/>Create room + bubble</button><p className="upload-hint">Select a bubble to teleport into a room.</p><div className="portal-list">{portalRooms.map(r => <div className="asset-row" key={r.id}><button className="asset" onClick={() => enterRoom(r.id)}><span className="file-icon"><Glasses size={18}/></span><span><strong>{r.title}</strong><small>Enter room · {r.id.toUpperCase()}</small></span></button>{!!r.canManage && <button className="asset-remove" aria-label={'Remove room ' + r.title} onClick={() => setRemoveTarget({ kind: 'room', id: r.id, label: r.title })}><Trash2 size={15}/></button>}</div>)}</div><a className="upload" href="/">Back to room directory</a></aside> : <> <PresentationStudio key={room || 'demo'} ref={studio} owner={roomOwner || !room} engine={() => engine.current} peer={() => localId.current} name={name} active={() => activeRef.current} pdf={pdf} pdfPage={pdfPage} pdfTotal={pdfTotal} apply={applySlide} ensureRoom={ensureRoom} refresh={sync} presence={() => api('rooms/' + roomRef.current + '/presence', 'POST', { id: localId.current, name: nameRef.current, pose: engine.current?.pose() || [0, 1.6, 8], avatar: avatarRef.current, mic: micRef.current ? 1 : 0 })} open={left} files={filesMode} close={() => setLeft(false)} showFiles={() => setFilesMode(true)} outline={() => { setFilesMode(false); setLeft(true); }} discuss={() => { setTab('notes'); setRight(true); }} vr={() => setVrSetup(true)}/> <aside className={'assets-panel library-files ' + (!filesMode ? 'studio-hidden ' : '') + (left ? 'mobile-open' : '')}><div className="panel-heading"><div><span className="eyebrow">PRESENTATION ASSETS</span><h2>Models & drawings</h2></div><button className="icon-button mobile-only" onClick={() => setLeft(false)} aria-label="Close library"><X size={18}/></button></div><button className="back-outline" onClick={() => setFilesMode(false)}><ChevronLeft size={15}/>Back to presentation outline</button><button className="upload" onClick={() => file.current?.click()}><Upload size={17}/>Upload files<Plus size={15}/></button><input ref={file} type="file" accept=".glb,.pdf" multiple hidden onChange={e => upload(e.target.files)}/><p className="upload-hint">GLB models & PDF documents · up to 40 MB</p><div className="library-title"><ChevronDown size={13}/>MODELS<span>{assets.filter(a => a.kind === 'glb').length + 1}</span></div><div className="asset-row"><button className={'asset ' + (!active && !sampleHidden ? 'selected' : '')} onClick={() => choose(null)}><span className="file-icon"><Box size={19}/></span><span><strong>Community pavilion</strong><small>Sample model · explore first</small></span>{!active && !sampleHidden && <span className="selection-dot"/>}</button><button className="asset-remove" aria-label="Hide sample model" onClick={() => { engine.current?.clearModel(); activeRef.current = null; setActive(null); setSampleHidden(true); }}><X size={15}/></button></div>{assets.filter(a => a.kind === 'glb').map(a => <div className="asset-row" key={a.id}><button className={'asset ' + (active?.id === a.id ? 'selected' : '')} onClick={() => choose(a)}><span className="file-icon"><Box size={19}/></span><span><strong>{a.name}</strong><small>{(a.size / 1048576).toFixed(1)} MB · GLB model</small></span></button>{a.canManage && <button className="asset-remove" aria-label={'Remove ' + a.name} onClick={() => setRemoveTarget({ kind: 'assets', id: a.id, label: a.name })}><Trash2 size={15}/></button>}</div>)}<div className="library-title document-title"><ChevronDown size={13}/>DOCUMENTS<span>{assets.filter(a => a.kind === 'pdf').length}</span></div>{assets.filter(a => a.kind === 'pdf').map(a => <div className="asset-row" key={a.id}><button className="asset" onClick={() => choose(a)}><span className="file-icon pdf-icon"><FileText size={19}/></span><span><strong>{a.name}</strong><small>PDF · shared with this room</small></span></button>{a.canManage && <button className="asset-remove" aria-label={'Remove ' + a.name} onClick={() => setRemoveTarget({ kind: 'assets', id: a.id, label: a.name })}><Trash2 size={15}/></button>}</div>)}{!assets.some(a => a.kind === 'pdf') && <button className="empty-doc" onClick={() => file.current?.click()}><FileText size={18}/><span>Add drawings, details<br />or reference documents</span><Plus size={14}/></button>}<div className="library-bottom"><div className="revit-guide"><span className="mini-icon"><Layers size={17}/></span><strong>Bring your Revit model</strong><p>Convert your model to a self-contained GLB, then upload it here.</p><button onClick={() => setHelp(true)}>View import guide<ArrowUpRight size={13}/></button></div><div className="device-note"><Glasses size={17}/><span>One room. Any perspective.<small>Desktop, mobile & compatible VR</small></span></div></div></aside></>}

 <section className="stage"><div className="stage-top"><div className="stage-title"><button className="icon-button mobile-only" onClick={() => setLeft(true)} aria-label="Open library"><PanelLeft size={19}/></button><span className="model-dot"/><strong>{hall ? 'Session space' : sampleHidden && !active ? 'Empty review space' : active?.name || 'Community pavilion'}</strong><span className="sample-tag">{hall ? 'ROOM PORTALS' : active ? 'GLB MODEL' : 'SAMPLE MODEL'}</span></div><button className="view-pill" onClick={() => { engine.current?.fit(); setWalk(false); }}><Box size={14}/>3D view</button><button className="icon-button mobile-only" onClick={() => setRight(true)} aria-label="Open comments"><PanelRight size={20}/></button></div><div ref={viewport} className={'viewport ' + (placing ? 'placing' : '')} aria-label="Interactive 3D model viewer"/><div className="view-label"><span className="eyebrow">{stereo ? 'PHONE STEREO VIEW' : 'YOUR SHARED STAGE'}</span><h1>{hall ? 'Choose your room.' : 'Bring your story to life.'}</h1><p>{hall ? 'Select a teleport bubble to enter.' : 'Curate a view. Set the pace. Invite your audience.'}</p></div><div className="orientation" aria-hidden="true"><span className="axis-y">Y</span><span className="axis-z">Z</span><span className="axis-x">X</span><Box size={31}/></div><div className="stage-tools"><button title="Fit model" aria-label="Fit model" onClick={() => { engine.current?.fit(); setWalk(false); }}><Maximize size={18}/></button><span /><button className={walk ? 'tool-active' : ''} title="Walk mode · WASD or touch arrows" aria-label="Toggle walk mode" onClick={() => { setWalk(!walk); engine.current?.setWalk(!walk); }}><Move size={18}/></button><button className={section ? 'tool-active' : ''} title="Section cut" aria-label="Toggle section cut" onClick={() => { setSection(!section); engine.current?.section(!section); }}><Scissors size={18}/></button><button className={xray ? 'tool-active' : ''} title="Transparent model" aria-label="Toggle model transparency" onClick={() => { setXray(!xray); engine.current?.xray(!xray); }}><Eye size={18}/></button><span /><button className={placing ? 'tool-active' : ''} title="Add sticky note" aria-label="Place sticky note" onClick={beginNote}><StickyNote size={18}/></button></div><div className="bottom-stage"><span className="navigation-hint"><MousePointer2 size={14}/>{placing ? 'Select a surface to pin a note' : flying ? 'Fly · WASD / joystick · E up · Q down · drag to look' : modelEnabled && modelAvailable ? 'Drag to move · pinch / scroll to scale · Shift-drag / twist to rotate' : (walk || hall) ? 'Drag to look · joystick / WASD to move' : 'Drag to orbit · scroll to zoom · right-drag to pan'}</span><button className={"model-button " + (modelPanel ? "active" : "")} disabled={!ready || !modelAvailable} aria-expanded={modelPanel} onClick={() => { engine.current?.stopMovement(); setModelPanel(!modelPanel); }}>Move / Scale / Rotate</button><button className={"fly-button " + (flying ? "active" : "")} disabled={!ready} aria-pressed={flying} onClick={() => engine.current?.setFly(!flying)} title="Fly mode · WASD to move, E up, Q down"><ArrowUpRight size={17}/>{flying ? "Flying" : "Fly"}</button><button className="vr-button" onClick={() => setVrSetup(true)}><Glasses size={18}/>VR setup<ArrowUpRight size={13}/></button></div>{modelPanel && !stereo && <ModelControls value={modelValue} enabled={modelEnabled} available={modelAvailable} onEnabled={value => engine.current?.manipulator.setEnabled(value)} onScale={value => engine.current?.manipulator.scaleTo(value)} onRotate={value => engine.current?.manipulator.rotateTo(value)} onPosition={position => engine.current?.manipulator.positionTo(position)} onStep={direction => engine.current?.manipulator.nudge(direction)} onReset={() => engine.current?.manipulator.reset()} onBring={() => engine.current?.manipulator.bringHere()} onClose={() => setModelPanel(false)}/>}{(walk || hall || touchMode) && !stereo && <Joystick onMove={(x, z) => {
                if ((x || z) && !engine.current?.flying) {
                    setWalk(true);
                    engine.current?.setWalk(true);
                }
                engine.current?.moveInput(x, z);
            }}/>}{flying && !stereo && <FlightControls onLift={direction => engine.current?.lift(direction)} onStep={direction => engine.current?.flyStep(direction)}/>}{busy && <div className="loading"><Loader2 className="spin" size={22}/>{busy}</div>}{!ready && !error && <div className="loading"><Loader2 className="spin"/>Preparing your workspace…</div>}{(error || viewerNotice) && <div className="error-banner">{error || viewerNotice}</div>}{stereo && <div className="stereo-alignment" aria-hidden="true"/>}{stereo && <button className="exit-stereo" onClick={() => { engine.current?.stereo(false); setStereo(false); }}><X size={18}/>Exit stereo</button>}</section>
 <aside className={'review-panel ' + (right ? 'mobile-open' : '')}><div className="review-heading"><div className="tabs"><button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>{hall ? 'Session' : 'Sticky notes'}<span>{hall ? portalRooms.length : notes.length}</span></button><button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>People<span>{peers.length + 1}</span></button></div><button className="icon-button mobile-only" onClick={() => setRight(false)} aria-label="Close comments"><X size={18}/></button></div>{tab === 'notes' && hall ? <div className="hall-guide"><Glasses size={30}/><h2>Rooms, within reach.</h2><p>Select a floating bubble to enter its room. Create a new room and its portal appears in this shared space.</p><button className="upload" onClick={newPortal}><Plus size={16}/>Create room + bubble</button><h3>Browser & mobile</h3><p>Drag to look around. Use the joystick or WASD to move. Select a bubble or a room in the list.</p><h3>Cardboard</h3><p>Gaze at a destination and tap to move. Gaze at a bubble or control and tap to select. In a room: Note → gaze at a model surface → tap.</p><h3>Voice in every space</h3><p>Join audio and allow the microphone. Everyone in the same room or session space shares the same live audio channel.</p></div> : tab === 'notes' ? <><div className="review-intro"><h2>A place for every thought.</h2><p>Pin feedback directly to your model.</p></div><button className={'add-note ' + (placing ? 'armed' : '')} onClick={() => { beginNote(); setRight(false); }}><Plus size={17}/>{placing ? 'Select a surface…' : 'Add sticky note'}<span>N</span></button><div className="search"><Search size={15}/><input aria-label="Search notes" placeholder="Search notes…" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="note-filters">{['open', 'resolved', 'all'].map(f => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'open' ? 'Open' : f === 'resolved' ? 'Resolved' : 'All notes'}</button>)}<span>{visible.length}</span></div><div className="note-list">{visible.map((n, i) => <article key={n.id} className={'note-card ' + n.color}><div className="note-meta"><span className="note-number">{String(notes.indexOf(n) + 1).padStart(2, '0')}</span><span>{n.author}</span><small>{new Date(n.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div><button className="note-body" onClick={() => {
                    const a = assets.find(a => a.id === n.asset);
                    if (n.asset !== activeRef.current)
                        choose(a || null).then(() => engine.current?.focus(engine.current.manipulator.worldPoint(JSON.parse(n.position))));
                    else
                        engine.current?.focus(engine.current.manipulator.worldPoint(JSON.parse(n.position)));
                    setRight(false);
                }}>{n.body}</button><div className="note-footer">{n.canManage && <button aria-label={'Remove sticky note ' + (notes.indexOf(n) + 1)} onClick={() => setRemoveTarget({ kind: 'notes', id: n.id, label: 'sticky note' })}><Trash2 size={14}/></button>}<span><Box size={12}/>{n.asset ? assets.find(a => a.id === n.asset)?.name || 'Model' : 'Sample pavilion'}</span><button title={n.resolved ? 'Reopen note' : 'Resolve note'} aria-label={n.resolved ? 'Reopen note' : 'Resolve note'} onClick={async () => {
                    try {
                        await api('rooms/' + room + '/notes/' + n.id, 'PATCH', { resolved: !n.resolved });
                        sync();
                    }
                    catch (e) {
                        notify((e as Error).message);
                    }
                }}>{n.resolved ? <CheckCheck size={16}/> : <Check size={16}/>}</button></div></article>)}{!visible.length && <div className="notes-empty"><div className="paper-stack"><StickyNote size={30}/></div><h3>{search ? 'No matching notes' : filter === 'resolved' ? 'Nothing resolved yet' : 'Start the conversation'}</h3><p>{search ? 'Try another word.' : 'Add a sticky note to a model surface. Your team will see it here, too.'}</p>{!search && filter === 'open' && <button onClick={beginNote}>Place your first note<ArrowUpRight size={14}/></button>}</div>}</div><div className="review-tip"><span>✦</span><p>Feedback with context.<br /><strong>Select any note to find it in 3D.</strong></p></div></> : <div className="people-content"><h2>In this room</h2><p>Everyone shares models and notes.<br />Follow the presenter or explore independently.</p><label className="name-label">Your display name<input maxLength={50} value={name} onChange={e => setName(e.target.value)}/></label><div className="person"><span className="avatar self avatar-customize"><AvatarPortrait avatar={avatar} label="Your avatar"/></span><strong>{name || 'Guest'} <small>(you)</small></strong>{mic ? <Mic size={16}/> : <MicOff size={16}/>}</div>{peers.map(p => <div className="person" key={p.id}><span className="avatar avatar-customize"><AvatarPortrait avatar={p.avatar} label={p.name + " avatar"}/></span><strong>{p.name}</strong>{p.mic === 1 ? <Mic size={16}/> : <MicOff size={16}/>}</div>)}<button className="upload" onClick={() => setAvatarEditor(true)}>Customize my avatar</button><button className="upload" onClick={copyInvite}><Link size={16}/>Copy room link</button><p className="voice-detail">{voiceState}</p><button className="upload" onClick={() => voice.current?.resume().catch((e: Error) => notify(e.message))}>Resume sound</button><label className="name-label">Speaker volume<input type="range" min="0" max="100" defaultValue="100" aria-label="Speaker volume" onChange={e => voice.current?.volume(Number(e.target.value) / 100)}/></label><p className="voice-detail">Live audio uses an HTTPS relay across desktop, phones and headsets. Short packets are buffered for delivery, cleared on leave, and stale packets are removed on the next relay request. There is no recording archive.</p></div>}</aside>
 <footer className="session-bar"><div className="session-info"><a href="/?space=1" onClick={e => { e.preventDefault(); enterHall(); }} className="session-home" aria-label="Back to Session space"><Home size={15}/><span>Sessions</span></a><span className="live-dot"/><strong>{room ? 'Presentation room' : 'Explore the workspace'}</strong><span className="session-divider"/><span>{room ? room.toUpperCase() : 'Create a room when you add content'}</span></div><div className="voice-controls"><div className="participant-stack"><div className="mini-avatar avatar-customize"><AvatarPortrait avatar={avatar} label="Your avatar"/></div>{peers.slice(0, 3).map(p => <div className="mini-avatar avatar-customize" key={p.id}><AvatarPortrait avatar={p.avatar} label={p.name + " avatar"}/></div>)}</div><span className="participant-count">{peers.length + 1} {peers.length ? 'people' : 'person'}</span><button className={'mic-button ' + (mic ? 'on' : '')} onClick={toggleMic} disabled={audioBusy}>{audioBusy ? <Loader2 className="spin" size={16}/> : mic ? <Mic size={16}/> : <MicOff size={16}/>}<span>{mic ? 'Mic on' : 'Join audio'}</span></button><button className="icon-button mobile-only" onClick={() => { setTab('people'); setRight(true); }} aria-label="Participants"><Users size={18}/></button></div></footer>
 {pdf && <section className={'pdf-panel ' + (!pdfOpen ? 'pdf-hidden' : '')}><header><FileText size={17}/><strong>{pdf.name}</strong>{pdf.canManage && <button className="icon-button" aria-label="Remove current PDF" onClick={() => setRemoveTarget({ kind: 'assets', id: pdf.id, label: pdf.name })}><Trash2 size={16}/></button>}<a href={'/api/asset/' + pdf.id} download={pdf.name} aria-label="Download PDF"><Download size={17}/></a><button className="icon-button" onClick={() => setPdfOpen(false)} aria-label="Minimize PDF"><X size={18}/></button></header><div className="pdf-scroll"><canvas ref={pdfCanvas}/></div><footer><button className="icon-button" disabled={pdfPage <= 1} onClick={() => setPdfPage(p => p - 1)} aria-label="Previous PDF page"><ChevronLeft size={18}/></button><span>Page {pdfPage} of {pdfTotal || '…'}</span><button className="icon-button" disabled={pdfPage >= pdfTotal} onClick={() => setPdfPage(p => p + 1)} aria-label="Next PDF page"><ChevronRight size={18}/></button><span className="pdf-in-vr">Also visible in VR</span></footer></section>}{pdf && !pdfOpen && <button className="pdf-reopen" onClick={() => setPdfOpen(true)}><FileText size={16}/>Open PDF</button>}
 {point && <div className="modal-backdrop" onClick={() => setPoint(null)}><section className="dialog note-dialog" role="dialog" aria-modal="true" aria-labelledby="note-title" onClick={e => e.stopPropagation()}><button className="close-dialog icon-button" onClick={() => setPoint(null)} aria-label="Close"><X size={19}/></button><span className="eyebrow">PINNED TO YOUR MODEL</span><h2 id="note-title">Leave a little context.</h2><p>Your note will appear at the selected location.</p><label>Your name<input value={name} onChange={e => setName(e.target.value)} maxLength={50}/></label><label>Sticky note<textarea autoFocus rows={4} placeholder="What should the team know?" value={body} onChange={e => setBody(e.target.value)} maxLength={1200}/></label><div className="composer-bottom"><div className="colors">{['yellow', 'mint', 'pink'].map(c => <button key={c} aria-label={c + ' note'} className={c + ' ' + (color === c ? 'chosen' : '')} onClick={() => setColor(c)}>{color === c && <Check size={15}/>}</button>)}</div><small>{body.length}/1200</small><button className="primary" disabled={!body.trim() || !name.trim()} onClick={async () => {
                try {
                    await saveNote();
                }
                catch (e) {
                    notify((e as Error).message);
                }
            }}>Pin note<ArrowUpRight size={16}/></button></div></section></div>}
 {avatarEditor && <AvatarEditor avatar={avatar} name={name} onSave={saveAvatarEditor} onClose={() => setAvatarEditor(false)}/>}
 {invite && <div className="modal-backdrop" onClick={() => setInvite(false)}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title" onClick={e => e.stopPropagation()}><button className="close-dialog icon-button" onClick={() => setInvite(false)} aria-label="Close"><X size={19}/></button><Users size={28}/><h2 id="invite-title">Better, together.</h2><p>Share this link with your audience. They can follow your presentation in a browser, on mobile, or in VR.</p><div className="room-link">{typeof location !== 'undefined' ? location.href : ''}</div><button className="primary full" onClick={copyInvite}><Link size={16}/>Copy room link</button><p className="access-note">Anyone can open this public room link in a browser. Your room shortcut is also available in Session space. Models, documents and notes in this room are public.</p></section></div>}
 {vrSetup && <div className="modal-backdrop" onClick={() => setVrSetup(false)}><section className="dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="vr-setup-title" onClick={e => e.stopPropagation()}><button className="icon-button close-dialog" onClick={() => setVrSetup(false)} aria-label="Close"><X size={19}/></button><span className="eyebrow">STEP INSIDE THE REVIEW</span><h2 id="vr-setup-title">Choose your VR view.</h2><p>Open a room and join audio before putting on your headset.</p><div className="vr-options"><button className="vr-option" disabled={!ready || !xr} onClick={async () => {
                try {
                    const entering = engine.current.enterVR();
                    ensureRoom().catch(e => notify(e.message));
                    await entering;
                    setVrSetup(false);
                }
                catch (e) {
                    notify((e as Error).message);
                }
            }}><Glasses size={28}/><strong>Quest / dedicated headset</strong><p>Choose Model in the VR menu to move and scale: point at the model and hold a trigger or grip to grab it; use both controllers to resize. With hand tracking enabled, pinch and move one hand to drag, or pinch with both hands to resize. Left stick: move. Right stick: snap turn; in Fly mode, push up/down to change altitude. Select Fly in the VR menu to move where you look. Left trigger: teleport. Right trigger: select or place a note. Left grip: center. Right grip: microphone.</p><span>{xr ? 'Start headset VR' : 'Open in a WebXR headset browser'}<ArrowUpRight size={14}/></span></button><button className="vr-option" disabled={!ready || engine.current?.fallback} onClick={async () => {
                try {
                    const entering = engine.current.stereo(true);
                    setStereo(true);
                    setVrSetup(false);
                    await entering;
                    ensureRoom().catch(e => notify(e.message));
                }
                catch (e) {
                    setStereo(false);
                    notify((e as Error).message);
                }
            }}><Smartphone size={28}/><strong>Cardboard / phone headset</strong><p>Two circular eye windows with black lens borders and motion tracking where available. Choose Model in the fixed VR menu for movement buttons, Smaller/Bigger, Bring here and Reset. Adjust the lens fit below before starting. The menu keeps a fixed heading so you can gaze at every button. Hold a tap for one second to bring the menu in front of you. Gaze at a floor destination and tap to move. Gaze at a control or room bubble and tap to select. Choose Note, gaze at a model surface, and tap to add a sticky note. Center resets your heading and brings the fixed menu back in front of you. Select Fly, then gaze ahead and tap to fly, including into empty space; Up/Down change altitude.</p><span>Start Cardboard mode<ArrowUpRight size={14}/></span></button></div><CardboardSettings settings={cardboard} onChange={updateCardboard}/>{engine.current?.fallback && <div className="vr-info">This browser has WebGL disabled. The simplified viewer works here; VR needs a WebGL-enabled phone or headset browser.</div>}<p className="access-note">Cardboard: allow motion access if requested and rotate your phone to landscape. If the browser does not supply orientation data, drag to look. Cardboard has no positional tracking.</p><button className="primary" onClick={() => setVrSetup(false)}>Continue in browser<ArrowUpRight size={14}/></button></section></div>}
 {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><button className="close-dialog icon-button" onClick={() => setHelp(false)} aria-label="Close"><X size={19}/></button><span className="eyebrow">A QUICK FIELD GUIDE</span><h2 id="help-title">Your model. More perspectives.</h2><div className="help-grid"><article><Box /><h3>Bring a Revit model</h3><p>Export and convert Revit to a self-contained GLB with embedded materials and textures. This app accepts GLB, not RVT, IFC or FBX directly. Keep models under 40 MB; smaller models perform better on phones.</p></article><article><StickyNote /><h3>Pin a thought</h3><p>Choose Add sticky note, then tap any model surface. Write a comment and pin it. Open a note to jump to its position. Resolve it when the discussion is complete.</p></article><article><Glasses /><h3>Step into VR</h3><p>Open this HTTPS site in a WebXR headset browser. Aim with either hand and pinch to select a control, or use a controller trigger. Choose Note, then select a model surface to open the sticky-note keyboard. Choose Remove and select an object to remove it. Undo restores the last removal. Left trigger: teleport to the ground. Left stick: move. Right stick or Turn left / Turn right: rotate your view by 30°. Choose Model to move, resize and rotate horizontally: hold one pinch/trigger/grip to move; grab with both hands/controllers to resize and turn. Model buttons provide step controls. Choose Note from either menu, then pinch/select a model surface; use the in-world keyboard to type and Save. Left grip: center. Right grip: microphone. PDF page buttons work in VR.</p></article><article><Mic /><h3>Review together</h3><p>Create a room from Session space, then share its public link or room code. Join audio to enable your microphone; tap again to mute. Audio uses a common HTTPS relay so phones, desktops and headsets share the same voice transport, including on networks that block peer-to-peer calls. Join audio and allow microphone access before putting on a headset.</p></article></div><p className="access-note">Fly: select Fly beside VR setup. Use WASD or the joystick to fly where you look, E/Q or hold Up/Down for altitude. In Cardboard, select Fly in the fixed menu, gaze ahead and tap to fly; Up/Down change altitude. On Quest, the right stick also controls altitude while flying. Select Fly again to return to level movement. Models: Shift-drag on desktop or twist two fingers on mobile to rotate horizontally. Move / Scale / Rotate also has angle and size controls. Phones: drag the background to orbit; use the joystick to walk, then drag the view to look. Phone stereo uses orientation or touch with gaze-and-tap selection: tap Note, then gaze at a model surface and tap; gaze at keyboard keys and tap to type. Use Step to move forward and Center to reset your heading and menu position. Join audio before wearing phone goggles. It has no positional tracking. Headset support depends on WebXR availability.</p><button className="primary" onClick={() => setHelp(false)}>Back to the model<ArrowUpRight size={16}/></button></section></div>}
 {createInHall && <div className="modal-backdrop" onClick={() => setCreateInHall(false)}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-portal-title" onClick={e => e.stopPropagation()}><button className="close-dialog icon-button" aria-label="Close" onClick={() => setCreateInHall(false)}><X size={18}/></button><h2 id="new-portal-title">Create a room portal.</h2><p>The room will appear as a teleport bubble in this session space.</p><form onSubmit={e => { e.preventDefault(); createPortal(newTitle).catch((e: Error) => notify(e.message)); }}><label>Room name<input autoFocus maxLength={100} value={newTitle} onChange={e => setNewTitle(e.target.value)} required/></label><button className="primary full" disabled={!newTitle.trim()}>Create room + bubble</button></form></section></div>}
 {removeTarget && <div className="modal-backdrop" onClick={() => setRemoveTarget(null)}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="remove-title" onClick={e => e.stopPropagation()}><h2 id="remove-title">Remove {removeTarget.label}?</h2><p>{removeTarget.kind === 'room' ? 'The room and its teleport bubbles will be hidden. Its files, notes and shortcuts are preserved.' : 'This object will be hidden from the room. Notes attached to a removed model are hidden with it.'} You can restore it with Undo.</p><div className="confirm-actions"><button className="upload" onClick={() => setRemoveTarget(null)}>Cancel</button><button className="primary" onClick={() => commitRemove(removeTarget).catch((e: Error) => notify(e.message))}><Trash2 size={15}/>Remove</button></div></section></div>}
 {undo && <div className="undo-bar" role="status"><span>{undo.label} removed</span><button onClick={() => restore().catch((e: Error) => notify(e.message))}><RotateCcw size={15}/>Undo</button><button aria-label="Dismiss undo" onClick={() => { undoRef.current = null; setUndo(null); }}><X size={15}/></button></div>}
 {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
 </main>;
}

