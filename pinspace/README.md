# Pinspace on Render

The presentation version of Pinspace runs independently of ChatGPT: Vite + React and Three.js in the browser, a Node.js 24 HTTP API, SQLite, and local uploaded files. It includes ordered model/PDF presentations, private speaker cues, shared slides, live HTTPS microphone relay, spatial notes, Quest/Cardboard controls, and room-to-room teleport shortcuts.

## Run locally

```sh
npm ci
npm run build
npm start
```

Open http://localhost:3000. `npm run dev` starts the API on 3001 and Vite on its development port. Phones, microphones and immersive VR require HTTPS outside localhost.

## Deployment

The `pinspace-render` branch keeps this version in `pinspace/`, alongside the earlier application at the repository root. Deploy this subdirectory using:

- Runtime: Node.js 24 (`NODE_VERSION=24.22.1`)
- Build: `cd pinspace && npm ci && npm run build`
- Start: `cd pinspace && npm start`
- Health endpoint: `/healthz`
- Region: Oregon, matching the existing service

The app binds `0.0.0.0:$PORT`. Render supplies the external URL for request-origin validation. For a custom domain, set `PUBLIC_ORIGIN` to the canonical HTTPS origin.

The initial free deployment uses `STORAGE_MODE=preview`. Its visible banner explains that rooms, notes, models and PDFs may disappear when Render restarts or redeploys the service. This is a testing deployment, not durable classroom storage. Do not rely on important feedback surviving a restart. The existing ChatGPT-hosted rooms are not copied automatically; this host starts with its own database and browser credentials.

For durable storage, first approve a paid service and disk in Render. Mount the disk at `/var/data`, set `DATA_DIR=/var/data/pinspace` and `STORAGE_MODE=persistent`, then deploy. Both SQLite (including WAL) and uploads live under DATA_DIR. A disk-backed service runs as a single instance. Migrations run transactionally at process startup, when the disk is available. Back up the database and uploads together using SQLite's online-backup facilities; do not simply copy a live WAL database file.

The shared voice relay sends short 16 kHz PCM packets over HTTPS and retains only a delivery buffer. It is intended for small groups, not large classes speaking simultaneously. Joining audio is opt-in on each device. Models must be self-contained GLB files up to 40 MB; Revit must be converted first. PDFs can be multipage; presentations contain up to 50 model views/PDF pages.

Room management is tied to a random guest credential in the creator's browser. Clearing browser storage loses those rights. On a new hostname each device receives a new credential. Rooms and uploaded content are public. Speaker notes are stripped from audience API responses. Objects and rooms support recoverable removal.

Cardboard uses two circular eye windows with a black lens mask, a center alignment mark and a dedicated 80° default field of view. In VR setup, Lens fit adjusts screen-space lens spacing, window size and field of view; settings are saved per browser/device. The scene and mask share the same eye layout and square projection, including on wide phones. Align the phone with the viewer’s center divider and tune the fit before inserting it. This manual fit does not scan Cardboard QR profiles or apply viewer-specific radial distortion correction. Quest/WebXR uses its headset-provided projection and is unchanged.

Cardboard: gaze at a destination/control and tap. The menu retains a fixed heading instead of rotating away from gaze. Hold a tap for around one second, then release, to place the menu in front of the current view; Center resets the heading. The fixed in-world keyboard includes digits for room codes. Real device testing remains necessary.

## Verification

`npm run check` checks TypeScript. `npm test` covers navigation math, gaze targeting, presentation validation and privacy, PCM worklet resampling, and the real Node HTTP API. The server test exercises uploads, shared presentation/shortcuts/notes, cross-guest authorization, audio packet relay/cleanup, origin checks, and persistence across restart.

Vendor Draco and PDF worker files are copied from locked npm dependencies during the build. User data, credentials, dependencies and built files are not committed.


## Flying

Choose Fly beside VR setup to start from the current camera position. Fly again returns to level movement without dropping or teleporting the camera. WASD or the touch joystick moves relative to the view, including pitch; E goes up and Q goes down. Hold the on-screen Up/Down buttons to change altitude, or activate them with the keyboard for a 0.75 m step. In Cardboard/Quest, select Fly in the fixed world menu. In Cardboard, gaze ahead and tap to fly 1 m, including into empty space; interactive controls and note placement retain priority. Step also flies 1 m where you look, and Up/Down change altitude by 0.75 m. Quest left stick moves; right stick up/down changes altitude while flying and left/right retains snap turns. Room changes, fit/orbit and VR exit reset flight. Inputs stop on release, cancellation, blur and tab hiding. Flight has no collision detection.

## Avatars

Choose Your avatar in the room directory, the portrait at the top right of a workspace, or Customize my avatar under People. The editor previews skin tone, shirt/hair colors, hair/headwear and glasses before Save avatar. Cancel discards edits; Reset appearance restores the defaults in the draft. Preferences are saved in this browser and included in each authenticated presence update across rooms. Other participants see a lightweight head-and-shoulders 3D avatar, a display-name label and a separate microphone indicator. Presence updates reuse existing geometry when only position or microphone state changes.

In Quest or Cardboard, select Avatar in the fixed world menu. Skin tone, Shirt color, Hair color, Hair / hat and Glasses cycle the available choices, with a 3D self preview; Done returns to navigation. These VR choices apply and save immediately. Locomotion pauses in the VR avatar editor. Preferences are local to the browser; they are not an account profile synchronized across devices. The server validates all appearance fields and enforces participant ownership. Migration 0005 adds optional appearance to existing peer rows; older clients/rows keep the default appearance, and an omitted profile does not overwrite an existing one.
