# VR Sticky Notes

A multi-user VR space that runs in the browser. Create as many rooms as you need. In each room people walk around together, talk over their microphones, bring in 3D models and PDF documents, and leave sticky-note comments on pin boards, on models, or on specific PDF pages.

| Device | How it works |
|---|---|
| Computer (Chrome, Edge, Firefox, Safari) | Drag to look, WASD / arrows to move, hold Shift to sprint, Space to jump, Q / E to turn, click a surface to post a note |
| Phone / tablet (iPhone, Android, iPad) | Two on-screen sticks: left stick to move, right stick to look around, plus the gyroscope (turn the phone to look; switch it off with the phone button at the top). **Run** toggles sprinting and **Jump** jumps (both beside the look stick). Tapping never moves you; it only selects boards, notes, models and PDFs |
| Meta Quest / other WebXR headsets | Press **VR**. Point and pull the trigger. Left stick walks (click it to sprint), right stick snap-turns (click it to jump), **A** or **X** toggles your mic. Notes are typed on a floating keyboard with quick phrases |
| Cardboard-style phone VR (Android Chrome) | Press **VR**, aim the ring in the middle of your view with your head, and press the Cardboard button: on the floor to walk there, on a surface to leave a note, on a button or doorway to use it |

## Features

- **High bay hall**: every room is a 48 x 48 m, 12 m tall high bay modelled on the Kemper Hall high bay: sealed concrete floor, translucent wall panels on the left, concrete block walls, a maroon steel frame with diagonal bracing, girders and joists under a corrugated roof deck, blue spiral ducts, high-bay lights, the lab window on the back wall and a large overhead garage door on the front wall. It is kept simple so it runs smoothly on standalone headsets such as Quest 3. It holds **15 booths**: 5 along the left wall (1-5), 5 along the back wall (6-10) and 5 along the right wall (11-15). Each booth has a pin-able back wall, a sign with the booth number and its main exhibit, two PDF stands, a model plinth and a **+ Add** sign while it still has room. The middle of the hall is left open; the room name is shown under the lab window on the back wall. You arrive by the garage door.
- **Realistic lighting**: reflections from a generated environment that matches the high bay, soft sun shadows (re-drawn only when something moves, so it stays smooth on headsets), oak booth floors, felt pin boards and track-lit booth walls.  Uploaded models get reflections and cast shadows too. All textures are generated in the browser, so nothing extra downloads.
- **Graphics setting**: tap the room name at the top left and choose **Detailed** or **Fast**. Fast turns off shadows and reflections. Computers and phones start in Detailed, standalone headsets (Quest) in Fast; the choice is remembered on that device.
- **Rooms**: the start screen lists rooms with who is in them and how many notes and files they have. Anyone can create a room (name, description, optionally *unlisted* so only people with the link find it). Each room has its own link: `https://your-site/?room=tcm-366-clash-review`.
- **Uploads for everyone**: anyone in a room can add 3D models (`.glb`, single-file `.gltf`, `.obj`) and PDFs. **Each booth holds 1 model and 2 PDFs**; the server enforces this. Choose a booth in the upload sheet (or tap a booth's **+ Add** sign); the file goes into the right slot, sized to fit. Everyone sees it right away.
  - Models are automatically centred and set on their plinth (Revit exports often sit far away at survey coordinates) and scaled to fit the booth; **Real size (1:1)** in the adjust panel restores true scale.
  - PDFs appear as a standing panel with **Prev / Next** buttons that work with mouse, touch, laser and gaze. The page is shared, so everyone sees the same sheet.
  - **Click (or point at) a model or PDF** to open its menu: **Add sticky note here** (exactly where you clicked), **Move, rotate or resize** (size slider, 1:1, fit booth, rotation, nudge left/right/away/closer/up/down, back to its booth spot, bring in front of me; everyone sees changes live), **Replace** with a new file (keeps its place and sticky notes) and **Remove**. Anyone can adjust; only the uploader, the room creator or the admin can replace or remove. Works in VR too, with floating panels (replacing a file needs a phone or computer).
  - The **Objects** panel lists everything by booth with Go to, Adjust, page turning, Replace and Remove.
- **Section cuts on models**: click a model and choose **Section cut**. Pick **Horizontal** (a plan cut, starting 1.2 m above the base on buildings), **Vertical, side to side** or **Vertical, front to back**, then drag the slider or use - and + (5 cm steps) to move the cut. **Flip** swaps which side is removed; a vertical cut starts by removing the half nearer to you. Cut walls and slabs are filled solid red so the section reads clearly, glass stays see-through, and clicks and sticky notes ignore the removed part. Everyone in the room sees the same cut and it is saved with the room. Works on screens and in VR (Quest and Cardboard use a panel with the same choices).
- **Fly mode**: press **Fly** to float freely in the direction you look, over and through models. Computer: WASD, Space up, Shift down, F toggles. Phone: the left stick flies where you look, hold the arrow buttons to rise or sink. Quest: left stick flies where you look, right stick up/down rises and sinks, B or Y toggles. Cardboard: aim at the sky and press the button. Tap or aim at the floor to land.
- **Room shortcuts**: from inside a room, open **Objects > Add room shortcut** to create a new room (or pick an existing one). A doorway appears in front of you, and the new room gets a doorway back. Walking through switches rooms without reloading, so headset users stay in VR. Deleting a room also removes doorways that point to it.
- **Rigged avatars that walk, run and jump**: everyone appears as a low-poly 3D figure with idle, walk, run and jump animations. When you move, sprint, jump or fly, everyone else sees your avatar do the same; the head turns and tilts to show where you are looking and nods while you talk, the body turns to follow, and a soft shadow sits under the feet (it stays on the floor when you jump or fly). Each figure is about 5,200 triangles plus 200 to 1,100 per accessory, with one shared texture, so a full room still runs on a Quest. The models (about 1 MB in total) are in `public/avatars/` and download once.
- **Avatar customization**: shirt and trouser color, skin tone, hair style (short, medium, long, bun, ponytail, curly, bald) and hair color, headwear (hard hat in yellow, white or orange, cap, beanie, headphones, headscarf), glasses or safety glasses, a beard, and a hi-vis vest. Set it in the lobby (**Customize**) or in a room (tap the room name, then **Customize avatar**); everyone sees changes right away.
- **Sticky notes**: six colors, up to 280 characters, +1 votes, edit and delete your own. Notes placed on a model move and scale with it. Notes placed on a PDF belong to that page and only show on that page.
- **Voice chat**: peer-to-peer audio (WebRTC). Voices fade with distance and a green ring shows who is talking.
- **Webcam**: press **Camera** in the bottom bar to share your webcam. Everyone in the room sees your picture on a small screen floating above your avatar (it always turns to face them), and you get a small preview at the top left. Press again to stop. The camera is off when you join, and the People panel shows who has it on. Video is kept small (320 x 240, about 15 frames a second) so it works on phones. Headsets without a front camera (Quest) can still see other people's cameras.
- **Export**: the room panel has **Download notes (CSV)** with text, author, votes, timestamps, what the note is on (room, model, or PDF and page) and position.

## Getting Revit content in

**3D model**: Revit does not export glTF on its own. Either:
1. In Revit, open a 3D view and use **File > Export > FBX**. Open the FBX in Blender (free) and use **File > Export > glTF 2.0**, format **glTF Binary (.glb)**. Or
2. Install a glTF exporter add-in for Revit and export `.glb` directly.

Tips: hide furniture, site, and detail you do not need before exporting. Files under about 30 MB load well on phones and headsets (the upload limit is 80 MB). Draco-compressed GLB files are supported.

**Drawings and sheets**: print or export them to PDF (up to 40 MB).

## Run it on your computer

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. Microphone and VR need **HTTPS** on anything other than `localhost`, so to test with phones or a headset, deploy it (below) or use a tunnel such as `npx localtunnel --port 3000` or `cloudflared tunnel --url http://localhost:3000`.

## Put it online (free option: Render)

1. Create a GitHub repository and upload this folder (everything except `node_modules` and `data`).
2. On https://render.com choose **New > Blueprint** and pick the repository. `render.yaml` sets everything up, including a random `ADMIN_KEY`.
3. Render gives you an `https://...onrender.com` address to share.

On the free plan the server goes to sleep when nobody has visited for a while (the next first load is slow), and its disk is wiped when it restarts or redeploys. That deletes rooms, notes **and uploaded files**. For a class or study that runs over weeks, add a Render persistent disk (paid) and set `DATA_DIR` to its mount path, or run it on any server or VM with Node.js. Download the CSV after important sessions either way.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Where rooms, notes and uploads are saved |
| `ADMIN_KEY` | none | Open the site with `?admin=YOUR_KEY` to delete any note, object or room |
| `ICE_SERVERS` | Google STUN | JSON list of STUN/TURN servers for voice (see below) |
| `MAX_MODEL_MB` / `MAX_PDF_MB` | `80` / `40` | Upload size limits |
| `MAX_ROOM_MB` | `500` | Total upload storage per room |
| `MAX_ITEMS_PER_ROOM` | `60` | Models, PDFs and doorways per room (15 booths x 3 files = 45) |
| `MAX_ROOMS` | `200` | Number of rooms |
| `MAX_USERS_PER_ROOM` | `16` | People in one room at once |
| `MAX_NOTES_PER_ROOM` | `500` | Notes per room |

### Voice on strict networks (campus Wi-Fi, some cellular)

Voice and camera are peer-to-peer. On most networks that works with STUN. Some institutional, hotel and phone networks block it; then you need a TURN relay. You can tell when this happens: the people list shows "can't connect voice/camera" next to the person, and their camera screen says "Camera can't connect". Get credentials from a hosted TURN provider or run your own `coturn` server, and set:

```
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:443?transport=tcp","username":"USER","credential":"PASS"}]
```

Voice and video use a full mesh (everyone sends directly to everyone). Voice works well for about 8 people. Each camera that is on costs every other person about 0.2 Mbit/s to download and its owner about 0.2 Mbit/s per viewer to upload, so with cameras on keep it to about 6 to 8 people, or ask only presenters to turn theirs on. The same TURN note above applies to video.

## Good to know

- There are no accounts. Ownership of notes, uploads and rooms is tied to the browser that made them, so clearing site data means you can no longer edit or delete them yourself. Use `ADMIN_KEY` for moderation.
- Uploaded files are visible to anyone who can open the room link. Do not upload confidential drawings to a public deployment.
- The 3D text uses A-Frame's Roboto font from `cdn.aframe.io`. If that CDN is blocked on a network, 3D labels appear blank (tap a note to read it in the panel). The 3D text can only show basic Latin characters; other characters show as `?` in 3D but display fine in the panels.
- Built with A-Frame 1.8, PDF.js 4.10 and the `ws` WebSocket library, all served from `node_modules`. No database.

## Files

```
server.js            HTTP + WebSocket server: rooms, uploads, notes, poses, voice signaling, CSV export
public/index.html    Scene and interface
public/app.js        Client: rooms, networking, notes, models, PDFs, avatars, voice, VR keyboard
public/components.js A-Frame components: movement, avatar smoothing and animation, name tags
public/avatar.js     The avatar figure (3D build and 2D portrait)
public/visuals.js    Lighting, reflections, shadows and generated materials
public/style.css     Interface styles
render.yaml          One-click deploy on Render
```
