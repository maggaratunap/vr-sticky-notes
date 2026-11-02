# VR Sticky Notes

A multi-user VR space that runs in the browser. Create as many rooms as you need. In each room people walk around together, talk over their microphones, bring in 3D models and PDF documents, and leave sticky-note comments on pin boards, on models, or on specific PDF pages.

| Device | How it works |
|---|---|
| Computer (Chrome, Edge, Firefox, Safari) | Drag to look, WASD / arrows to move, Q / E to turn, click a surface to post a note |
| Phone (iPhone, Android) | Drag or turn the phone to look, tap the floor to walk, tap a surface (or press **+**) to post |
| Meta Quest / other WebXR headsets | Press **VR**. Point and pull the trigger. Left stick walks, right stick snap-turns, **A** or **X** toggles your mic. Notes are typed on a floating keyboard with quick phrases |
| Cardboard-style phone VR (Android Chrome) | Press **VR**, aim the ring in the middle of your view with your head, and press the Cardboard button: on the floor to walk there, on a surface to leave a note, on a button or doorway to use it |

## Features

- **Presentation venue**: every room is a hall with a raised stage, a large pin-able screen with the room name above it, curtains, a podium, audience benches along a centre aisle, and QUESTIONS / IDEAS boards on the side walls. You arrive in the aisle facing the stage. Walk up the steps, or tap / aim at the stage to step onto it.
- **Rooms**: the start screen lists rooms with who is in them and how many notes and files they have. Anyone can create a room (name, description, optionally *unlisted* so only people with the link find it). Each room has its own link: `https://your-site/?room=tcm-366-clash-review`.
- **Uploads for everyone**: anyone in a room can add 3D models (`.glb`, single-file `.gltf`, `.obj`) and PDFs. They go onto the stage facing the audience (PDFs to the left and right of centre, models in the middle) while there is room, otherwise in front of you. Everyone sees them right away.
  - Models are automatically centred and set on the floor (Revit exports often sit far away at survey coordinates). Very large or very small models are resized to fit the room; one tap on **1:1** puts them back to real scale so you can walk through.
  - PDFs appear as a standing panel with **Prev / Next** buttons that work with mouse, touch, laser and gaze. The page is shared, so everyone sees the same sheet.
  - The **Objects** panel lets anyone go to, bring over, put on stage, turn, or resize an object, and flip PDF pages. Only the person who uploaded it (or the admin) can delete it.
- **Fly mode**: press **Fly** to float freely in the direction you look, over and through models. Computer: WASD, Space up, Shift down, F toggles. Phone: tap the sky to fly toward it, hold the arrow buttons to rise or sink. Quest: left stick flies where you look, right stick up/down rises and sinks, B or Y toggles. Cardboard: aim at the sky and press the button. Tap or aim at the floor to land.
- **Room shortcuts**: from inside a room, open **Objects > Add room shortcut** to create a new room (or pick an existing one). A doorway appears in front of you, and the new room gets a doorway back. Walking through switches rooms without reloading, so headset users stay in VR. Deleting a room also removes doorways that point to it.
- **Sticky notes**: six colors, up to 280 characters, +1 votes, edit and delete your own. Notes placed on a model move and scale with it. Notes placed on a PDF belong to that page and only show on that page.
- **Voice chat**: peer-to-peer audio (WebRTC). Voices fade with distance and a green ring shows who is talking.
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
| `MAX_ITEMS_PER_ROOM` | `30` | Models + PDFs per room |
| `MAX_ROOMS` | `200` | Number of rooms |
| `MAX_USERS_PER_ROOM` | `16` | People in one room at once |
| `MAX_NOTES_PER_ROOM` | `500` | Notes per room |

### Voice on strict networks (campus Wi-Fi, some cellular)

Voice is peer-to-peer. On most networks that works with STUN. Some institutional networks block it; then you need a TURN relay. Get credentials from a hosted TURN provider or run your own `coturn` server, and set:

```
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:443?transport=tcp","username":"USER","credential":"PASS"}]
```

Voice uses a full mesh (everyone sends audio to everyone), which works well for about 8 people talking.

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
public/components.js A-Frame components: movement, avatar smoothing, name tags
public/style.css     Interface styles
render.yaml          One-click deploy on Render
```
