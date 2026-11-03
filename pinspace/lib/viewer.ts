import * as T from 'three';
import { DwellSelector, readStick, tapAction, GazeMenuAnchor, movementDelta } from './vr-controls';
import { cardboardLayout, loadCardboard, normalizeCardboard, type CardboardSettings } from './cardboard';
import { createAvatarMesh } from './avatar-mesh';
import { loadAvatar, normalizeAvatar, cycleAvatar, type Avatar } from './avatar';
import { SVGRenderer, SVGObject } from 'three/addons/renderers/SVGRenderer.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
export class Viewer {
    presentationMode = false;
    lastPresentationPdf: any = null;
    onNext: (() => void) | null = null;
    onPrevious: (() => void) | null = null;
    cameraFrame() { const camera = this.isXR ? this.renderer.xr.getCamera() : this.camera; const position = new T.Vector3(), direction = new T.Vector3(); camera.getWorldPosition(position); camera.getWorldDirection(direction); const target = this.walking || this.isXR || this.stereoscopic ? position.clone().addScaledVector(direction, 10) : this.controls.target.clone(); return { position: position.toArray().map(n => Math.round(n * 1000) / 1000), target: target.toArray().map(n => Math.round(n * 1000) / 1000) }; }
    applyFrame(frame: {
        position: number[];
        target: number[];
    }) {
        if (this.isXR || this.stereoscopic)
            return;
        this.setWalk(false);
        this.rig.position.set(0, 0, 0);
        this.camera.position.fromArray(frame.position);
        this.controls.target.fromArray(frame.target);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
    }
    setPresentation(on: boolean) {
        if (this.presentationMode === on)
            return;
        this.presentationMode = on;
        this.makeVRMenu();
        if (this.lastPresentationPdf)
            this.setPdf(...this.lastPresentationPdf as [
                HTMLCanvasElement,
                () => void,
                () => void,
                number,
                number
            ]);
    }
    setPresentationContent(kind: string) { this.model.visible = kind !== 'pdf'; this.pins.visible = kind !== 'pdf'; this.pdfGroup.visible = kind === 'pdf'; }
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(42, 1, .05, 5000);
    renderer: T.WebGLRenderer;
    controls: OrbitControls;
    model = new T.Group();
    pins = new T.Group();
    avatars = new T.Group();
    rig = new T.Group();
    pdfGroup = new T.Group();
    keyboard = new T.Group();
    xrSupported = false;
    isXR = false;
    placing = false;
    walking = false;
    flying = false;
    liftInput = 0;
    onFlyChange: ((flying: boolean) => void) | null = null;
    selfAvatar = loadAvatar();
    avatarMenu = false;
    onAvatarChange: ((avatar: Avatar) => void) | null = null;
    stereoscopic = false;
    ray = new T.Raycaster();
    pointer = new T.Vector2();
    clip = new T.Plane(new T.Vector3(0, -1, 0), 2);
    clock = new T.Clock();
    keys = new Set<string>();
    input = new T.Vector3();
    buttons: T.Object3D[] = [];
    keyboardHint = 'Write a note. Aim, then tap or pull the trigger.';
    keyboardText = '';
    keyboardPosition = [0, 0, 0];
    saveKeyboard: any = null;
    controllers: T.XRTargetRaySpace[] = [];
    observer: ResizeObserver;
    down = { x: 0, y: 0, time: 0 };
    vrCam = new T.StereoCamera();
    cardboardSettings = loadCardboard();
    regularFov = 42;
    cardboardMask: { scene: T.Scene; camera: T.Camera; material: T.ShaderMaterial; geometry: T.PlaneGeometry } | null = null;
    disposed = false;
    lastNotes = '';
    lastPeers = '';
    orientation: any = null;
    orientationEnabled = false;
    currentPdf: T.CanvasTexture | null = null;
    dwell = new DwellSelector<T.Object3D>();
    snapArmed = true;
    orientationOffset: number | null = null;
    menuAnchor = new GazeMenuAnchor();
    hallMode = false;
    onShortcut: (() => void) | null = null;
    portals = new T.Group();
    info = new T.Group();
    removeMode = false;
    pdfAssetId: string | null = null;
    modelAssetId: string | null = null;
    loadVersion = 0;
    lastPortals = '';
    onRoom: ((id: string) => void) | null = null;
    onNewRoom: (() => void) | null = null;
    onSession: (() => void) | null = null;
    onRemove: ((item: {
        kind: string;
        id: string;
        label: string;
    }) => void) | null = null;
    undoAction: (() => void) | null = null;
    fallback = false;
    vrMenu = new T.Group();
    reticle = new T.Mesh(new T.RingGeometry(.007, .01, 24), new T.MeshBasicMaterial({ color: 0x2d657a, depthTest: false }));
    gazeTarget: T.Object3D | null = null;
    gazeSince = 0;
    gazeFired = false;
    constructor(private host: HTMLElement, private onPin: (p: number[]) => void, private notify: (s: string) => void) {
        try {
            this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
        }
        catch {
            this.fallback = true;
            const svg = new SVGRenderer();
            let animation = 0;
            const setLoop = (fn: any) => {
                cancelAnimationFrame(animation);
                if (fn) {
                    const loop = () => { fn(); animation = requestAnimationFrame(loop); };
                    loop();
                }
            };
            this.renderer = Object.assign(svg, { setPixelRatio: () => { }, shadowMap: {}, xr: { enabled: false, addEventListener: () => { }, getSession: () => null }, setAnimationLoop: setLoop, dispose: () => setLoop(null), setScissorTest: () => { }, setScissor: () => { }, setViewport: () => { } }) as any;
        }
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setClearColor('#edf0f3');
        this.renderer.outputColorSpace = T.SRGBColorSpace;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = T.PCFSoftShadowMap;
        this.renderer.xr.enabled = true;
        this.host.appendChild(this.renderer.domElement);
        this.camera.position.set(17, 13, 18);
        this.scene.add(this.rig);
        this.rig.add(this.camera);
        this.scene.add(this.vrMenu);
        this.camera.add(this.reticle);
        this.reticle.position.z = -.9;
        this.reticle.visible = false;
        this.reticle.renderOrder = 1000;
        this.vrMenu.visible = false;
        this.vrMenu.position.set(0, -.62, -1.5);
        this.scene.add(this.model, this.pins, this.avatars, this.pdfGroup, this.keyboard, this.portals, this.info);
        this.info.visible = false;
        this.keyboard.visible = false;
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.target.set(0, 2, 0);
        this.controls.maxPolarAngle = Math.PI * .49;
        this.controls.minDistance = .2;
        this.controls.maxDistance = 400;
        this.scene.add(new T.HemisphereLight(0xffffff, 0xb3becb, 2.4));
        const sun = new T.DirectionalLight(0xfff5e9, 3.1);
        sun.position.set(15, 30, 12);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -28;
        sun.shadow.camera.right = 28;
        sun.shadow.camera.top = 28;
        sun.shadow.camera.bottom = -28;
        sun.shadow.normalBias = .05;
        this.scene.add(sun);
        const ground = new T.Mesh(new T.PlaneGeometry(2000, 2000), new T.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 1 }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -.13;
        ground.receiveShadow = true;
        ground.name = 'ground';
        this.scene.add(ground);
        const grid = new T.GridHelper(160, 80, 0xd4dae1, 0xdfe4e9);
        grid.position.y = -.12;
        this.scene.add(grid);
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(this.host);
        this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
        this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
        this.renderer.domElement.addEventListener('pointermove', this.pointerMove);
        this.renderer.domElement.addEventListener('contextmenu',this.contextMenu);
        window.addEventListener('keydown', this.keyDown);
        window.addEventListener('keyup', this.keyUp);
        window.addEventListener('blur', this.blur);
        document.addEventListener('visibilitychange', this.visibilityChanged);
        this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
        this.renderer.xr.addEventListener('sessionstart', () => { this.setFly(false); this.blur(); this.menuAnchor.reset(); this.isXR = true; this.avatarMenu = false; this.makeVRMenu(); this.vrMenu.visible = true; this.controls.enabled = false; this.rig.position.set(0, 0, 11); this.camera.position.set(0, 1.6, 0); this.camera.rotation.set(0, 0, 0); this.placing = false; this.keyboard.visible = false; });
        document.addEventListener('fullscreenchange', this.fullscreenChanged);
        this.renderer.xr.addEventListener('sessionend', () => { this.isXR = false; this.vrMenu.visible = false; this.reticle.visible = false; this.placing = false; this.rig.position.set(0, 0, 0); this.keyboard.visible = false; this.setWalk(false); this.fit(); });
        this.demo();
        this.makeVRMenu();
        this.resize();
        this.renderer.setAnimationLoop(this.animate);
    }
    async init() {
        if (this.fallback)
            return;
        this.xrSupported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
        for (let i = 0; i < 2; i++) {
            const c = this.renderer.xr.getController(i);
            const line = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(0, 0, -1)]), new T.LineBasicMaterial({ color: i ? 0xf6b944 : 0x44a6bf }));
            line.scale.z = 30;
            c.add(line);
            this.rig.add(c);
            this.controllers.push(c);
            c.addEventListener('connected', (e: any) => { c.userData.hand = e.data.handedness; });
            c.addEventListener('selectstart', () => this.controllerSelect(c, c.userData.hand === 'left' ? 0 : 1));
            c.addEventListener('squeezestart', () => {
                if (c.userData.hand !== 'left') {
                    document.querySelector<HTMLButtonElement>('.mic-button')?.click();
                }
                else if (this.keyboard.visible)
                    this.keyboard.visible = false;
                else
                    this.centerView();
            });
        }
    }
    resize() {
        const w = this.host.clientWidth, h = this.host.clientHeight;
        if (!w || !h)
            return;
        this.camera.aspect = this.stereoscopic ? 1 : w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        if (!this.isXR && !this.walking && !this.stereoscopic)
            this.fit();
    }
    clear(g: T.Group) {
        g.traverse((o: any) => {
            if (o.geometry)
                o.geometry.dispose();
            if (o.material) {
                for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                    m.map?.dispose();
                    m.dispose();
                }
            }
        });
        g.clear();
    }
    demo() {
        this.loadVersion++;
        this.hallMode = false;
        this.modelAssetId = null;
        this.clear(this.model);
        const mat = (c: number) => new T.MeshStandardMaterial({ color: c, roughness: .75 });
        const white = mat(0xe6e4df), slab = mat(0xf5f3ed), dark = mat(0x313f50), wood = mat(0xbb9572), blue = mat(0x7ca3ae), glass = new T.MeshStandardMaterial({ color: 0x88afba, metalness: .15, roughness: .12, transparent: true, opacity: .48 });
        const box = (x: number, y: number, z: number, w: number, h: number, d: number, m: T.Material) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; this.model.add(o); return o; };
        box(0, 0, 0, 14, .22, 9, slab);
        box(0, .16, 0, 16, .15, 11, white);
        box(0, 3.3, 0, 14.4, .3, 9.4, slab);
        box(0, 6.45, 0, 14.4, .28, 9.4, slab);
        box(-.5, 6.65, -1.5, 13.5, .14, 6.2, dark);
        for (const x of [-6.7, -2.3, 2.3, 6.7])
            for (const z of [-4.2, 4.2])
                box(x, 3.2, z, .25, 6.4, .25, white);
        box(-6.9, 3.2, 0, .22, 6.3, 8.6, white);
        box(0, 3.2, -4.4, 13.8, 6.3, .22, white);
        for (const y of [1.7, 4.85]) {
            box(-3.4, y, 4.25, 6.3, 2.75, .08, glass);
            box(4.7, y, 4.25, 3.8, 2.75, .08, glass);
            box(6.85, y, .1, .08, 2.75, 8.1, glass);
            for (let x = -6.5; x < 7; x += 1.1)
                box(x, y, 4.3, .045, 2.8, .06, dark);
            for (let z = -4; z < 4.4; z += 1.1)
                box(6.9, y, z, .06, 2.8, .045, dark);
        }
        box(.7, 1.65, 4.3, 1.8, 3, .1, dark);
        box(.7, 1.5, 4.38, 1.5, 2.7, .08, glass);
        box(-2.4, 1.5, -1, .14, 3, 6.7, white);
        box(1.9, 1.5, -2, 7.6, 3, .14, white);
        box(1.9, 4.8, -1, 7.6, 3, .14, white);
        box(-2.4, 4.8, -1, .14, 3, 6.7, white);
        // Entry canopy, fins, terrace, steps and interior furniture.
        box(2.3, 3.15, 5.1, 6.5, .16, 2.3, dark);
        for (let x = -6.4; x < -.3; x += .38)
            box(x, 4.9, 4.65, .10, 2.8, .35, wood);
        for (let i = 0; i < 3; i++)
            box(1.2, .08 - i * .06, 5.3 + i * .6, 4.8, .12, 1.2, white);
        for (const y of [.45, 3.6])
            for (const x of [-4.5, 1, 4.5]) {
                box(x, y, 1.2, 1.8, .12, 1, wood);
                for (const dx of [-.7, .7])
                    for (const dz of [-.35, .35])
                        box(x + dx, y - .22, 1.2 + dz, .06, .4, .06, dark);
            }
        box(9.4, .05, -1.5, 3, .15, 10, white);
        for (const z of [-4, 0, 4]) {
            box(9.6, .5, z, 1.2, .7, 1.2, dark);
            const tree = new T.Mesh(new T.IcosahedronGeometry(.65, 1), mat(0x718f7a));
            tree.position.set(9.6, 1.35, z);
            tree.castShadow = true;
            this.model.add(tree);
        }
        const rail = mat(0x4b5664);
        for (const z of [3.9, 4.25])
            box(3, 6.95, z, 7.8, .06, .06, rail);
        for (let x = -.9; x < 7; x += .9)
            box(x, 6.7, 4.25, .05, .7, .05, rail);
        this.fit();
    }
    async loadModel(url: string) {
        const version = ++this.loadVersion;
        const loader = new GLTFLoader();
        const draco = new DRACOLoader();
        draco.setDecoderPath('/draco/');
        loader.setDRACOLoader(draco);
        loader.setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.loadAsync(url);
        if (version !== this.loadVersion)
            return;
        const obj = gltf.scene;
        const bounds = new T.Box3().setFromObject(obj);
        if (bounds.isEmpty())
            throw Error('The model contains no visible geometry.');
        this.clear(this.model);
        const center = bounds.getCenter(new T.Vector3());
        obj.position.sub(new T.Vector3(center.x, bounds.min.y, center.z));
        obj.traverse((o: any) => {
            if (o.isMesh) {
                o.castShadow = true;
                o.receiveShadow = true;
            }
        });
        this.model.add(obj);
        draco.dispose();
        this.lastNotes = '';
        this.fit();
    }
    fit() {
        if (this.isXR || this.stereoscopic)
            return;
        this.setFly(false);
        if (this.hallMode) {
            this.resetNavigation();
            this.setWalk(true);
            return;
        }
        if (!this.isXR) {
            this.walking = false;
            this.controls.enabled = true;
        }
        const b = new T.Box3().setFromObject(this.model);
        const c = b.getCenter(new T.Vector3()), s = b.getSize(new T.Vector3()), radius = b.getBoundingSphere(new T.Sphere()).radius || 10, angle = Math.atan(Math.tan(this.camera.fov * Math.PI / 360) * Math.min(1, this.camera.aspect)), d = radius / Math.sin(angle) * 1.1;
        this.rig.position.set(0, 0, 0);
        this.camera.position.copy(c).add(new T.Vector3(.75, .58, .9).normalize().multiplyScalar(d));
        this.controls.target.copy(c);
        this.camera.far = Math.max(5000, d * 20);
        this.camera.updateProjectionMatrix();
        this.controls.update();
    }
    setPlacing(v: boolean) { this.placing = v; }
    section(v: boolean) { this.clip.constant = new T.Box3().setFromObject(this.model).getCenter(new T.Vector3()).y; this.renderer.clippingPlanes = v ? [this.clip] : []; }
    xray(v: boolean) {
        this.model.traverse((o: any) => {
            if (o.isMesh)
                for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                    if (!m.userData.orig)
                        m.userData.orig = { opacity: m.opacity, transparent: m.transparent };
                    m.transparent = v || m.userData.orig.transparent;
                    m.opacity = v ? .25 : m.userData.orig.opacity;
                    m.depthWrite = !v;
                    m.needsUpdate = true;
                }
        });
    }
    setWalk(v: boolean) {
        this.setFly(false);
        const was = this.walking;
        this.walking = v;
        this.controls.enabled = !v;
        if (v && !was && !this.isXR) {
            this.camera.position.set(0, 1.65, 12);
            this.controls.target.set(0, 1.65, 0);
            this.controls.update();
        }
    }
    setFly(v: boolean) {
        if (this.flying === v) return;
        this.flying = v;
        this.blur();
        if (v) {
            // Start from the current view rather than jumping to the walking spawn.
            this.walking = true;
            this.controls.enabled = false;
        }
        this.onFlyChange?.(v);
        this.makeVRMenu();
    }
    lift(direction: number) { this.liftInput = this.flying && Number.isFinite(direction) ? Math.max(-1, Math.min(1, direction)) : 0; }
    flyStep(direction: number) { if (this.flying && Number.isFinite(direction)) this.translate(new T.Vector3(0, Math.sign(direction) * .75, 0)); }
    translate(delta: T.Vector3) {
        if (this.isXR) this.rig.position.add(delta);
        else { this.camera.position.add(delta); this.controls.target.add(delta); }
    }
    focus(p: number[]) { this.setWalk(false); const point = new T.Vector3(...p); this.controls.target.copy(point); this.camera.position.copy(point).add(new T.Vector3(4, 3, 5)); this.controls.update(); }
    pose() { const v = new T.Vector3(); (this.isXR ? this.renderer.xr.getCamera() : this.camera).getWorldPosition(v); return v.toArray(); }
    lookPointer: {
        id: number;
        x: number;
        y: number;
    } | null = null;
    contextMenu=(e:Event)=>{if(this.stereoscopic)e.preventDefault();};
    pointerMove = (e: PointerEvent) => {
        const last = this.lookPointer;
        if (!last || last.id !== e.pointerId)
            return;
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        this.lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
        if (!this.walking || (!e.buttons && e.pointerType !== 'touch') || this.orientation)
            return;
        const rotation = new T.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        rotation.y -= dx * .004;
        rotation.x = T.MathUtils.clamp(rotation.x - dy * .004, -1.4, 1.4);
        this.camera.quaternion.setFromEuler(rotation);
        const dir = new T.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this.controls.target.copy(this.camera.position).addScaledVector(dir, 10);
    };
    pointerDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY, time: performance.now() }; this.lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY }; };
    pointerUp = (e: PointerEvent) => {
        this.lookPointer = null;
        if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 8)
            return;
        if (this.stereoscopic) {
            if (performance.now() - this.down.time >= 650) {
                this.menuAnchor.reset();
                this.updateVRMenu();
                this.notify('Menu brought in front of you.');
                return;
            }
            this.selectGaze();
            return;
        }
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
        this.ray.setFromCamera(this.pointer, this.camera);
        this.activateHit(this.hitFromRay(), this.walking);
    };
    keyDown = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement).matches('input,textarea,select,[contenteditable="true"]'))
            return;
        if ((this.walking || this.isXR) && ['w', 'a', 's', 'd', ...(this.flying ? ['q', 'e'] : [])].includes(e.key.toLowerCase())) e.preventDefault();
        this.keys.add(e.key.toLowerCase());
        if (e.key.toLowerCase() === 'n')
            document.querySelector<HTMLButtonElement>('.add-note')?.click();
    };
    keyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
    stopMovement() { this.keys.clear(); this.input.set(0, 0, 0); this.liftInput = 0; this.lookPointer = null; }
    blur = () => this.stopMovement();
    visibilityChanged = () => { if (document.hidden) this.blur(); };
    contextLost = (e: Event) => { e.preventDefault(); this.notify('Graphics context lost. Reload to restore the model viewer.'); };
    moveInput(x: number, z: number) { this.input.set(x, 0, z); }
    async enterVR() {
        if (!navigator.xr)
            throw Error('This browser does not support WebXR.');
        const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
        this.renderer.xr.setReferenceSpaceType('local-floor');
        await this.renderer.xr.setSession(session);
    }
    async stereo(v: boolean) {
        if (this.fallback)
            throw Error('Cardboard needs WebGL. Open this site in a browser with hardware graphics enabled.');
        if (v && !this.stereoscopic) this.regularFov = this.camera.fov;
        this.vrCam.aspect = 1;
        this.stereoscopic = v;
        this.avatarMenu = false; this.makeVRMenu();
        this.camera.fov = v ? this.cardboardSettings.fov : this.regularFov;
        this.resize();
        this.menuAnchor.reset();
        this.reticle.visible = v;
        this.keyboard.visible = false;
        this.placing = false;
        this.dwell.reset();
        if (v) {
            this.orientationOffset = null;
            this.setWalk(true);
            const event = (window as any).DeviceOrientationEvent;
            // Invoke permission and fullscreen requests within the original click gesture.
            const permission = event?.requestPermission ? event.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
            document.documentElement.requestFullscreen?.().then(() => { const o = screen.orientation as any; o?.lock?.('landscape').catch(() => { }); }).catch(() => { });
            const granted = await permission;
            if (granted === 'granted')
                window.addEventListener('deviceorientation', this.onOrientation);
            else
                this.notify('Motion access was declined. Drag to look, or enable motion access in your browser.');
        }
        else {
            window.removeEventListener('deviceorientation', this.onOrientation);
            this.orientation = null;
            this.orientationOffset = null;
            this.vrMenu.visible = false;
            this.setWalk(false);
            this.fit();
            if (document.fullscreenElement)
                document.exitFullscreen().catch(() => { });
            const o = screen.orientation as any;
            o?.unlock?.();
        }
    }
    setCardboardSettings(settings: CardboardSettings) {
        this.cardboardSettings = normalizeCardboard(settings);
        if (this.stereoscopic) {
            this.camera.fov = this.cardboardSettings.fov;
            this.camera.updateProjectionMatrix();
        }
    }
    renderCardboard() {
        const size = this.renderer.getSize(new T.Vector2());
        const layout = cardboardLayout(size.x, size.y, this.cardboardSettings);
        this.camera.updateMatrixWorld();
        this.vrCam.update(this.camera);
        // Clear the whole frame first so resized/moved windows leave no stale image.
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, size.x, size.y);
        this.renderer.setClearColor(0x000000);
        this.renderer.clear();
        this.renderer.setClearColor('#edf0f3');
        this.renderer.setScissorTest(true);
        for (const [eye, camera] of [[layout.left, this.vrCam.cameraL], [layout.right, this.vrCam.cameraR]] as const) {
            this.renderer.setScissor(eye.x, eye.y, eye.size, eye.size);
            this.renderer.setViewport(eye.x, eye.y, eye.size, eye.size);
            this.renderer.render(this.scene, camera);
        }
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, size.x, size.y);
        if (!this.cardboardMask) {
            const material = new T.ShaderMaterial({
                uniforms: { resolution: { value: new T.Vector2() }, centers: { value: new T.Vector3() }, radius: { value: 0 } },
                vertexShader: 'varying vec2 uvMask; void main(){uvMask=uv; gl_Position=vec4(position.xy,0.0,1.0);}',
                fragmentShader: `varying vec2 uvMask; uniform vec2 resolution; uniform vec3 centers; uniform float radius;
                    void main(){vec2 p=uvMask*resolution; float d=min(length(p-vec2(centers.x,centers.z)),length(p-vec2(centers.y,centers.z)));
                    gl_FragColor=vec4(0.0,0.0,0.0,smoothstep(max(0.0,radius-2.0),max(0.001,radius),d));}`,
                transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
            });
            const scene = new T.Scene(), geometry = new T.PlaneGeometry(2, 2);
            const mesh = new T.Mesh(geometry, material);
            mesh.frustumCulled = false;
            scene.add(mesh);
            this.cardboardMask = { scene, camera: new T.Camera(), material, geometry };
        }
        const { material, scene, camera } = this.cardboardMask;
        material.uniforms.resolution.value.set(size.x, size.y);
        material.uniforms.centers.value.set(layout.leftX, layout.rightX, layout.centerY);
        material.uniforms.radius.value = layout.radius;
        const autoClear = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.renderer.render(scene, camera);
        this.renderer.autoClear = autoClear;
    }
    centerView() {
        this.menuAnchor.reset();
        this.dwell.reset();
        if (this.stereoscopic) {
            this.orientationOffset = null;
            if (!this.orientation) {
                this.camera.rotation.set(0, 0, 0);
                this.controls.target.copy(this.camera.position).add(new T.Vector3(0, 0, -10));
            }
        }
        else if (this.isXR) {
            const dir = new T.Vector3();
            this.renderer.xr.getCamera().getWorldDirection(dir);
            this.snapTurn(-Math.atan2(-dir.x, -dir.z));
        }
    }
    step() {
        const cam = this.isXR ? this.renderer.xr.getCamera() : this.camera;
        const dir = new T.Vector3();
        cam.getWorldDirection(dir);
        if (!this.flying) dir.y = 0;
        dir.normalize().multiplyScalar(1);
        this.translate(dir);
    }
    updateVRMenu() {
        this.vrMenu.visible = (this.isXR || this.stereoscopic) && !this.keyboard.visible;
        if (!this.vrMenu.visible)
            return;
        const cam = this.isXR ? this.renderer.xr.getCamera() : this.camera;
        const pos = new T.Vector3(), dir = new T.Vector3();
        cam.getWorldPosition(pos);
        cam.getWorldDirection(dir);
        const anchor = this.menuAnchor.place(pos.toArray(), dir.toArray());
        this.vrMenu.position.fromArray(anchor.position);
        this.vrMenu.rotation.set(0, anchor.yaw, 0);
        this.vrMenu.updateMatrixWorld(true);
    }
    resetNavigation() {
        this.avatarMenu = false;
        this.setFly(false);
        this.blur();
        this.menuAnchor.reset();
        this.input.set(0, 0, 0);
        this.placing = false;
        this.removeMode = false;
        this.keyboard.visible = false;
        this.info.visible = false;
        this.rig.position.set(0, 0, this.isXR ? 11 : 0);
        if (!this.isXR) {
            this.camera.position.set(0, 1.65, 8);
            this.camera.rotation.set(0, 0, 0);
            this.controls.target.set(0, 1.65, -5);
        }
        this.orientationOffset = null;
    }
    visibleButton(b: T.Object3D) {
        for (let o: T.Object3D | null = b; o; o = o.parent)
            if (!o.visible)
                return false;
        return true;
    }
    hitFromRay() {
        this.ray.camera = this.isXR ? this.renderer.xr.getCamera() : this.camera;
        const targets = [...this.buttons.filter(b => this.visibleButton(b)), ...this.pins.children];
        const interactive = this.ray.intersectObjects(targets, false)[0];
        if (interactive)
            return interactive;
        if (this.keyboard.visible)
            return;
        const ground = this.scene.children.find(o => o.name === 'ground');
        return this.ray.intersectObjects([this.model, ...(ground ? [ground] : [])], true).find(hit => !this.renderer.clippingPlanes?.length || this.clip.distanceToPoint(hit.point) >= 0);
    }
    gazeHit() { this.camera.updateMatrixWorld(true); this.ray.setFromCamera(new T.Vector2(), this.camera); return this.hitFromRay(); }
    walkable(hit: T.Intersection) {
        if (!hit.face)
            return false;
        const normal = hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld));
        return normal.y > .5;
    }
    teleport(point: T.Vector3) {
        if (this.isXR) {
            const head = new T.Vector3();
            this.renderer.xr.getCamera().getWorldPosition(head);
            this.rig.position.x += point.x - head.x;
            this.rig.position.z += point.z - head.z;
            this.rig.position.y = point.y;
        }
        else {
            const delta = point.clone().add(new T.Vector3(0, 1.65, 0)).sub(this.camera.position);
            this.camera.position.add(delta);
            this.controls.target.add(delta);
        }
    }
    activateHit(hit: T.Intersection | undefined, allowMove = true) {
        if (!hit) {
            if (this.flying && allowMove && !this.placing && !this.removeMode && !this.keyboard.visible && !this.avatarMenu) this.step();
            return;
        }
        const data = hit.object.userData;
        const ui = !!data.action;
        if (this.avatarMenu && !ui) return;
        const action = tapAction({ interactive: ui, noteMode: this.placing, removeMode: this.removeMode, walkable: allowMove && this.walkable(hit) });
        if (this.removeMode && !data.menu) {
            const item = data.removeTag || (this.modelAssetId && this.isModelObject(hit.object) ? { kind: 'assets', id: this.modelAssetId, label: 'model' } : null);
            if (item) {
                this.removeMode = false;
                this.makeVRMenu();
                this.onRemove?.(item);
            }
            return;
        }
        if (ui) {
            Promise.resolve(data.action()).catch(() => this.notify('Action failed. Try again.'));
            return;
        }
        if (action === 'note' && this.isModelObject(hit.object)) {
            this.placing = false;
            this.makeVRMenu();
            this.onPin(hit.point.toArray());
        }
        else if (this.flying && allowMove && !this.placing && !this.removeMode && !this.keyboard.visible)
            this.step();
        else if (action === 'move')
            this.teleport(hit.point);
    }
    isModelObject(object: T.Object3D) {
        for (let o: T.Object3D | null = object; o; o = o.parent)
            if (o === this.model)
                return true;
        return false;
    }
    selectGaze() { this.activateHit(this.gazeHit()); this.dwell.reset(); }
    clearPdf() { this.lastPresentationPdf = null; const ids = new Set(this.pdfGroup.children); this.buttons = this.buttons.filter(b => !ids.has(b)); this.clear(this.pdfGroup); this.pdfAssetId = null; }
    clearModel() { this.loadVersion++; this.clear(this.model); this.modelAssetId = null; this.lastNotes = ''; this.clear(this.pins); }
    setUndo(action: (() => void) | null) { this.undoAction = action; this.makeVRMenu(); }
    clearPortals() { const ids = new Set<T.Object3D>(); this.portals.traverse(o => ids.add(o)); this.buttons = this.buttons.filter(b => !ids.has(b)); this.clear(this.portals); this.lastPortals = ''; this.hallMode = false; this.makeVRMenu(); }
    shortcutPosition(index = 0) { const cam = this.isXR ? this.renderer.xr.getCamera() : this.camera; const pos = new T.Vector3(), dir = new T.Vector3(); cam.getWorldPosition(pos); cam.getWorldDirection(dir); const vr = this.isXR || this.stereoscopic; if (vr)
        dir.y = 0; if (dir.lengthSq() < .01)
        dir.set(0, 0, -1); dir.normalize(); const side = new T.Vector3().crossVectors(dir, new T.Vector3(0, 1, 0)).normalize(); return pos.addScaledVector(dir, 6 + Math.floor(index / 3) * 2).addScaledVector(side, (index % 3 - 1) * 1.7).add(new T.Vector3(0, vr ? -.2 : -.8, 0)).toArray(); }
    setRoomShortcuts(links: any[], canManage: boolean) { this.setPortals(links.map(link => ({ ...link, id: link.target, shortcutId: link.id, portalPosition: link.position })), true, canManage); }
    setPortals(rooms: any[], inside = false, canCreate = true) {
        const key = JSON.stringify([inside, canCreate, rooms.map(r => [r.id, r.shortcutId, r.title, r.portalPosition, r.canManage])]);
        if (key === this.lastPortals)
            return;
        this.clearPortals();
        if (!inside) {
            this.clearModel();
            this.clearPdf();
        }
        this.hallMode = !inside;
        this.lastPortals = key;
        const create = (position: number[], label: string, action: () => void, room?: any) => {
            const group = new T.Group();
            group.position.fromArray(position);
            const sphere = new T.Mesh(new T.SphereGeometry(1, 24, 16), new T.MeshStandardMaterial({ color: room ? 0x88b7c0 : 0xc9b87b, transparent: true, opacity: .72, roughness: .23, metalness: .15 }));
            sphere.userData.action = action;
            if (room && room.canManage)
                sphere.userData.removeTag = { kind: inside ? 'shortcuts' : 'room', id: inside ? room.shortcutId : room.id, label: inside ? 'shortcut to ' + room.title : room.title };
            group.add(sphere);
            this.buttons.push(sphere);
            const ring = new T.Mesh(new T.TorusGeometry(1.2, .035, 8, 48), new T.MeshStandardMaterial({ color: 0x6c8c9f }));
            ring.rotation.x = Math.PI / 2;
            ring.position.y = -1.3;
            group.add(ring);
            const card = this.plane(this.canvasText(label, '#f4f8fb', 768, 240, 42), 2.8, .88);
            card.position.set(0, 1.6, .2);
            card.userData.action = action;
            if (room && room.canManage)
                card.userData.removeTag = sphere.userData.removeTag;
            if (this.fallback) {
                (card.material as T.Material).transparent = true;
                (card.material as T.Material).opacity = 0;
                const ns = 'http://www.w3.org/2000/svg', node = document.createElementNS(ns, 'g'), rect = document.createElementNS(ns, 'rect'), text = document.createElementNS(ns, 'text');
                rect.setAttribute('x', '-95');
                rect.setAttribute('y', '-20');
                rect.setAttribute('width', '190');
                rect.setAttribute('height', '40');
                rect.setAttribute('rx', '5');
                rect.setAttribute('fill', '#f6f9fc');
                rect.setAttribute('stroke', '#c9d9e5');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('y', '4');
                text.setAttribute('font-size', '10');
                text.setAttribute('fill', '#4c6880');
                text.textContent = label.length > 29 ? label.slice(0, 28) + '…' : label;
                const content = document.createElementNS(ns, 'g');
                content.appendChild(rect);
                content.appendChild(text);
                node.appendChild(content);
                node.style.cursor = 'pointer';
                node.setAttribute('role', 'button');
                node.setAttribute('tabindex', '0');
                node.setAttribute('aria-label', label);
                node.addEventListener('pointerup', (event) => {
                    event.stopPropagation();
                    if (Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) < 8)
                        action();
                });
                node.addEventListener('keydown', (event) => {
                    if ((event as KeyboardEvent).key === 'Enter')
                        action();
                });
                const svg = new SVGObject(node);
                svg.userData.fallbackContent = content;
                svg.position.copy(card.position);
                group.add(svg);
            }
            group.add(card);
            this.buttons.push(card);
            if (inside)
                group.scale.setScalar(.55);
            this.portals.add(group);
        };
        rooms.forEach((room, i) => {
            let p = [((i % 5) - 2) * 4, 1.5, -6 - Math.floor(i / 5) * 4];
            try {
                if (room.portalPosition)
                    p = JSON.parse(room.portalPosition);
            }
            catch { }
            create(p, room.title + ' · ENTER', () => this.onRoom?.(room.id), room);
        });
        if (!inside)
            create([0, 1.5, 0], '+ CREATE A ROOM', () => this.onNewRoom?.());
        else if (canCreate)
            create(this.shortcutPosition(rooms.length + 1), '+ ADD ROOM SHORTCUT', () => this.onShortcut?.());
        this.makeVRMenu();
        if (!inside && !this.isXR && !this.stereoscopic)
            this.setWalk(true);
    }
    layoutFallbackLabels() {
        if (!this.fallback || !this.portals.children.length)
            return;
        this.scene.updateMatrixWorld(true);
        this.camera.updateMatrixWorld(true);
        const width = this.host.clientWidth, height = this.host.clientHeight, placed: {
            x: number;
            y: number;
        }[] = [];
        this.portals.traverse(object => {
            const content = object.userData.fallbackContent;
            if (!content)
                return;
            const p = new T.Vector3();
            object.getWorldPosition(p);
            p.project(this.camera);
            const x = p.x * width / 2, baseY = -p.y * height / 2;
            let y = baseY;
            for (let attempt = 0; attempt < 25 && placed.some(r => Math.abs(r.x - x) < 196 && Math.abs(r.y - y) < 45); attempt++)
                y -= 46;
            content.setAttribute('transform', 'translate(0,' + (y - baseY) + ')');
            placed.push({ x, y });
        });
    }
    openNote(note: any) {
        if (!this.isXR && !this.stereoscopic) {
            this.notify(note.author + ': ' + note.body);
            return;
        }
        const ids = new Set(this.info.children);
        this.buttons = this.buttons.filter(b => !ids.has(b));
        this.clear(this.info);
        const body = this.plane(this.canvasText(note.author + ' · ' + note.body, '#fff0ad', 768, Math.max(384, Math.ceil(note.body.length / 28) * 48 + 80), 36), 2.1, Math.max(1.05, Math.ceil(note.body.length / 28) * .13 + .22));
        this.info.add(body);
        const close = this.plane(this.canvasText('Close', '#edf2f7', 512, 120, 42), .7, .2);
        close.position.set(.65, -.8, .02);
        close.userData.action = () => this.info.visible = false;
        this.info.add(close);
        this.buttons.push(close);
        const cam = this.isXR ? this.renderer.xr.getCamera() : this.camera;
        const pos = new T.Vector3(), dir = new T.Vector3();
        cam.getWorldPosition(pos);
        cam.getWorldDirection(dir);
        this.info.position.copy(pos).addScaledVector(dir, 2);
        this.info.quaternion.copy(cam.quaternion);
        this.info.visible = true;
    }
    onOrientation = (e: DeviceOrientationEvent) => {
        if (e.alpha !== null)
            this.orientation = e;
    };
    canvasText(text: string, bg = '#fff1af', width = 768, height = 384, size = 38) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const g = c.getContext('2d')!;
        g.fillStyle = bg;
        g.fillRect(0, 0, width, height);
        g.fillStyle = '#27364c';
        g.font = '500 ' + size + 'px sans-serif';
        const words = text.split(' ');
        let line = '', y = size + 22;
        for (const w of words) {
            if (g.measureText(line + w).width > width - 60) {
                g.fillText(line, 30, y);
                y += size * 1.35;
                line = '';
            }
            line += w + ' ';
        }
        g.fillText(line, 30, y);
        return c;
    }
    plane(canvas: HTMLCanvasElement, w: number, h: number) { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: new T.CanvasTexture(canvas), side: T.DoubleSide })); return m; }
    setNotes(notes: any[]) {
        const key = JSON.stringify(notes);
        if (key === this.lastNotes)
            return;
        this.lastNotes = key;
        this.clear(this.pins);
        for (const n of notes) {
            if (n.resolved)
                continue;
            const c = this.canvasText(n.author + ' · ' + n.body, n.color === 'mint' ? '#cbe8dc' : n.color === 'pink' ? '#f7d6dc' : '#fff0a8');
            const m = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), depthTest: false }));
            m.position.fromArray(JSON.parse(n.position));
            m.position.y += .5;
            m.scale.set(2.6, 1.3, 1);
            m.userData.text = n.author + ': ' + n.body;
            m.userData.action = () => this.openNote(n);
            if (n.canManage)
                m.userData.removeTag = { kind: 'notes', id: n.id, label: 'sticky note' };
            this.pins.add(m);
        }
    }
    setPeers(peers: any[]) {
        const key = JSON.stringify(peers);
        if (key === this.lastPeers)
            return;
        this.lastPeers = key;
        const ids = new Set(peers.map(p => p.id));
        for (const g of [...this.avatars.children]) {
            if (!ids.has(g.userData.peerId)) { this.clear(g as T.Group); this.avatars.remove(g); }
        }
        for (const p of peers) {
            const appearance = normalizeAvatar(p.avatar), styleKey = JSON.stringify([appearance, p.name]);
            let g = this.avatars.children.find(child => child.userData.peerId === p.id) as T.Group | undefined;
            if (g && g.userData.styleKey !== styleKey) { this.clear(g); this.avatars.remove(g); g = undefined; }
            if (!g) {
                g = new T.Group();
                g.userData.peerId = p.id; g.userData.styleKey = styleKey;
                g.add(createAvatarMesh(appearance));
                const label = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(this.canvasText(p.name, '#ffffff', 512, 100, 36)), depthTest: false }));
                label.position.y = .4; label.scale.set(1.5, .3, 1); g.add(label);
                const mic = new T.Mesh(new T.SphereGeometry(.035, 8, 6), new T.MeshBasicMaterial());
                mic.position.set(.24, .19, 0); g.add(mic); g.userData.micIndicator = mic;
                this.avatars.add(g);
            }
            (g.userData.micIndicator.material as T.MeshBasicMaterial).color.set(p.mic === 1 ? '#42a995' : '#9daab4');
            try { g.position.fromArray(JSON.parse(p.pose)); } catch { g.position.set(0, 1.65, 8); }
        }
    }
    setSelfAvatar(value: Avatar) {
        const next = normalizeAvatar(value);
        if (JSON.stringify(next) === JSON.stringify(this.selfAvatar)) return;
        this.selfAvatar = next;
        if (this.avatarMenu) this.makeVRMenu();
    }
    changeAvatar(field: 'skin' | 'shirt' | 'hair' | 'style' | 'glasses') {
        const next = field === 'glasses' ? { ...this.selfAvatar, glasses: !this.selfAvatar.glasses } : cycleAvatar(this.selfAvatar, field);
        this.setSelfAvatar(next);
        this.onAvatarChange?.(next);
    }
    setPdf(c: HTMLCanvasElement, prev: () => void, next: () => void, page: number, total: number) {
        this.lastPresentationPdf = [c, prev, next, page, total];
        this.buttons = this.buttons.filter(x => !this.pdfGroup.children.includes(x));
        this.clear(this.pdfGroup);
        const w = this.presentationMode ? 7 : 4, h = Math.min(9, w * c.height / c.width);
        const panel = this.plane(c, w, h);
        panel.position.set(this.presentationMode ? 0 : -10, h / 2 + 1, this.presentationMode ? -5 : 0);
        panel.rotation.y = this.presentationMode ? 0 : Math.PI / 3;
        if (this.pdfAssetId)
            panel.userData.removeTag = { kind: 'assets', id: this.pdfAssetId, label: 'PDF' };
        this.pdfGroup.add(panel);
        this.buttons.push(panel);
        for (const [i, label, fn] of [[-1, 'Previous', prev], [1, 'Next', next]] as const) {
            const b = this.plane(this.canvasText(label + ' · ' + page + '/' + total, '#e0e9f2', 512, 100, 34), 1.6, .32);
            b.position.set((this.presentationMode ? 0 : -10) + i * 1.1, .65, this.presentationMode ? -4.9 : 1);
            b.rotation.y = Math.PI / 4;
            b.userData.action = this.presentationMode ? () => i === -1 ? this.onPrevious?.() : this.onNext?.() : fn;
            this.pdfGroup.add(b);
            this.buttons.push(b);
        }
    }
    openKeyboard(p: number[], save: (s: string) => void, hint = 'Write a note. Aim, then tap or pull the trigger.') { this.keyboardHint = hint; this.keyboardPosition = p; this.saveKeyboard = save; this.keyboardText = ''; this.info.visible = false; this.drawKeyboard(); const cam = this.isXR ? this.renderer.xr.getCamera() : this.camera; const dir = new T.Vector3(); cam.getWorldDirection(dir); const pos = new T.Vector3(); cam.getWorldPosition(pos); this.keyboard.position.copy(pos).addScaledVector(dir, 1.7); this.keyboard.position.y = pos.y - .25; this.keyboard.quaternion.copy(cam.quaternion); this.keyboard.visible = true; }
    drawKeyboard() {
        this.dwell.reset();
        this.buttons = this.buttons.filter(x => !this.keyboard.children.includes(x));
        this.clear(this.keyboard);
        const text = this.plane(this.canvasText(this.keyboardText || this.keyboardHint, '#fff0a8', 1024, 200, 34), 1.9, .38);
        text.position.y = .78;
        this.keyboard.add(text);
        const rows = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM.,?'];
        rows.forEach((row, j) => {
            [...row].forEach((key, i) => {
                this.keyButton(key, (i - (row.length - 1) / 2) * .19, .38 - j * .23, .175, .2, () => {
                    if (this.keyboardText.length < 500)
                        this.keyboardText += key.toLowerCase();
                    this.drawKeyboard();
                });
            });
        });
        this.keyButton('Space', -.56, -.6, .65, .22, () => { this.keyboardText += ' '; this.drawKeyboard(); });
        this.keyButton('⌫', 0, -.6, .3, .22, () => { this.keyboardText = this.keyboardText.slice(0, -1); this.drawKeyboard(); });
        this.keyButton('Save', .55, -.6, .6, .22, async () => {
            if (!this.keyboardText.trim())
                return;
            await this.saveKeyboard(this.keyboardText);
            this.keyboard.visible = false;
        });
        this.keyButton('Cancel', .7, 1.08, .4, .2, () => this.keyboard.visible = false);
    }
    keyButton(label: string, x: number, y: number, w: number, h: number, fn: () => void) { const b = this.plane(this.canvasText(label, label === 'Save' ? '#b7ded1' : '#f5f7fa', 512, 160, 65), w, h); b.position.set(x, y, .01); b.userData.action = fn; this.keyboard.add(b); this.buttons.push(b); }
    makeVRMenu() {
        const old = new Set(this.vrMenu.children);
        this.buttons = this.buttons.filter(b => !old.has(b));
        this.clear(this.vrMenu);
        const actions: [
            string,
            () => void
        ][] = [
            [this.hallMode ? 'New room' : this.placing ? 'Note ON' : 'Note', () => {
                    if (this.hallMode)
                        this.onNewRoom?.();
                    else {
                        this.placing = !this.placing;
                        this.removeMode = false;
                        this.makeVRMenu();
                    }
                }],
            [this.removeMode ? 'Remove ON' : 'Remove', () => { this.removeMode = !this.removeMode; this.placing = false; this.makeVRMenu(); }], ['Mic', () => document.querySelector<HTMLButtonElement>('.mic-button')?.click()],
            ['Step', () => this.step()], ['Center', () => this.centerView()], ['Session', () => this.onSession?.()], ['Undo', () => this.undoAction?.()], ['Exit', () => {
                    if (this.isXR)
                        this.renderer.xr.getSession()?.end();
                    else
                        document.querySelector<HTMLButtonElement>('.exit-stereo')?.click();
                }]
        ];
        if (!this.hallMode)
            actions.push(['Rooms', () => this.onShortcut?.()]);
        if (this.presentationMode) {
            actions[1] = ['Previous', () => this.onPrevious?.()];
            actions[3] = ['Next', () => this.onNext?.()];
        }
        actions.push([this.flying ? 'Fly ON' : 'Fly', () => this.setFly(!this.flying)]);
        if (this.flying) actions.push(['Up', () => this.flyStep(1)], ['Down', () => this.flyStep(-1)]);
        actions.push(['Avatar', () => { this.stopMovement(); this.avatarMenu = true; this.makeVRMenu(); }]);
        if (this.avatarMenu) {
            actions.splice(0, actions.length,
                ['Skin tone', () => this.changeAvatar('skin')], ['Shirt color', () => this.changeAvatar('shirt')], ['Hair color', () => this.changeAvatar('hair')],
                ['Hair / hat', () => this.changeAvatar('style')], [this.selfAvatar.glasses ? 'Glasses ON' : 'Glasses', () => this.changeAvatar('glasses')],
                ['Done', () => { this.avatarMenu = false; this.makeVRMenu(); }]);
            const preview = createAvatarMesh(this.selfAvatar);
            preview.scale.setScalar(.6); preview.position.set(0, .55, 0); this.vrMenu.add(preview);
        }
        actions.forEach(([label, action], i) => { const b = this.plane(this.canvasText(label, label.includes('ON') ? '#fff0ad' : '#edf3f8', 512, 160, 58), .34, .12); b.position.set((i % 3 - 1) * .38, -Math.floor(i / 3) * .16, 0); b.userData.action = action; b.userData.menu = true; this.vrMenu.add(b); this.buttons.push(b); });
    }
    snapTurn(angle: number) { const head = new T.Vector3(); this.renderer.xr.getCamera().getWorldPosition(head); const offset = head.sub(this.rig.position); const rotated = offset.clone().applyAxisAngle(new T.Vector3(0, 1, 0), angle); this.rig.rotateY(angle); this.rig.position.add(offset.sub(rotated)); }
    controllerSelect(c: T.Object3D, i: number) {
        this.ray.setFromXRController(c as T.XRTargetRaySpace);
        const hit = this.hitFromRay();
        if (hit?.object.userData.action || this.placing || this.removeMode)
            this.activateHit(hit, true);
        else if (i === 0 && hit && this.walkable(hit))
            this.teleport(hit.point);
    }
    updateMovement(dt: number) {
        if ((this.isXR || this.walking) && !this.keyboard.visible && !this.avatarMenu) {
            let x = this.input.x + (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0), z = this.input.z + (this.keys.has('s') ? 1 : 0) - (this.keys.has('w') ? 1 : 0);
            let lift = this.liftInput + (this.keys.has('e') ? 1 : 0) - (this.keys.has('q') ? 1 : 0);
            if (this.isXR)
                for (const source of this.renderer.xr.getSession()?.inputSources || []) {
                    const stick = readStick(source.gamepad?.axes);
                    if (source.handedness === 'right') {
                        if (this.flying) lift -= stick.z;
                        if (Math.abs(stick.x) < .25)
                            this.snapArmed = true;
                        else if (Math.abs(stick.x) > .65 && this.snapArmed) {
                            this.snapArmed = false;
                            this.snapTurn(-Math.sign(stick.x) * Math.PI / 6);
                        }
                    }
                    else {
                        x += stick.x;
                        z += stick.z;
                    }
                }
            const dir = new T.Vector3();
            (this.isXR ? this.renderer.xr.getCamera() : this.camera).getWorldDirection(dir);
            const delta = movementDelta(dir.toArray(), x, z, lift, this.flying, dt);
            this.translate(new T.Vector3(delta.x, delta.y, delta.z));
        }
    }
    animate = () => {
        if (this.disposed)
            return;
        const dt = Math.min(this.clock.getDelta(), .05);
        if (this.stereoscopic && this.orientation) {
            const e = this.orientation;
            const orient = (screen.orientation?.angle || 0) * Math.PI / 180;
            this.camera.quaternion.setFromEuler(new T.Euler((e.beta || 0) * Math.PI / 180, (e.alpha || 0) * Math.PI / 180, -(e.gamma || 0) * Math.PI / 180, 'YXZ'));
            this.camera.quaternion.multiply(new T.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5))).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -orient));
            if (this.orientationOffset === null) {
                this.menuAnchor.reset();
                const forward = new T.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
                this.orientationOffset = Math.atan2(-forward.x, -forward.z);
            }
            this.camera.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -this.orientationOffset));
        }
        else if (!this.isXR && !this.walking)
            this.controls.update();
        this.updateMovement(dt);
        this.updateVRMenu();
        this.layoutFallbackLabels();
        if (this.stereoscopic) {
            const hit = this.gazeHit();
            (this.reticle.material as T.MeshBasicMaterial).color.set(this.removeMode ? 0xc87870 : hit?.object.userData.action ? 0xe5b449 : this.placing ? 0xe5b449 : hit && this.walkable(hit) ? 0x4eae98 : 0x8298a9);
            this.reticle.scale.setScalar(hit?.object.userData.action ? 1.3 : 1);
            this.renderCardboard();
        }
        else
            this.renderer.render(this.scene, this.camera);
    };
    fullscreenChanged = () => {
        if (this.stereoscopic && !document.fullscreenElement)
            document.querySelector<HTMLButtonElement>('.exit-stereo')?.click();
    };
    dispose() { document.removeEventListener('visibilitychange', this.visibilityChanged); this.blur(); this.cardboardMask?.geometry.dispose(); this.cardboardMask?.material.dispose(); this.renderer.domElement.removeEventListener('contextmenu',this.contextMenu); document.removeEventListener('fullscreenchange', this.fullscreenChanged); this.disposed = true; this.renderer.setAnimationLoop(null); this.observer.disconnect(); window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('blur', this.blur); window.removeEventListener('deviceorientation', this.onOrientation); this.clear(this.model); this.clear(this.pins); this.clear(this.avatars); this.clear(this.pdfGroup); this.clear(this.keyboard); this.clear(this.portals); this.clear(this.info); this.controls.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}

