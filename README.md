# HandTracking3D

A browser-based AI hand control experience built with MediaPipe Hand Landmarker and Three.js. It renders a futuristic digital humanoid, tracks a live webcam hand, and responds to gestures with interactive motion, pulse effects, and a clean cinematic HUD.
**
Website is live here : https://preetham078.github.io/3DHandges/

## Features

- Live webcam activation with proper on/off camera control and media stream cleanup
- MediaPipe 21-point hand landmark tracking
- Gesture classification for open palm, pinch, fist, thumbs up, and two-finger control
- Procedural futuristic humanoid robot with articulated joints, wireframe styling, glow, and ambient particles
- Real-time interaction between the hand and 3D scene
- Clean, futuristic interface designed for demo recordings and presentation

## Project structure

- `index.html` — app shell and UI
- `style.css` — futuristic HUD styling
- `script.js` — MediaPipe + Three.js logic
- `assets/robot/` — reserved for optional robot assets (empty in this procedural build)

## Asset note

This build uses a procedural humanoid generated in code rather than a downloadable external GLB model. That keeps the project self-contained, avoids runtime dependency failures, and preserves the intended futuristic digital-skeleton appearance. No remote robot model is required.

## Run locally

1. Open the project folder in VS Code.
2. From the terminal in the project root, run:
   ```bash
   python3 -m http.server 8000
   ```
3. Open `http://localhost:8000` in a modern browser.
4. Click `START EXPERIENCE` and allow camera access.

## Notes

- Camera access works on `localhost` and HTTPS origins.
- The app processes the feed locally in the browser.
- If the camera is denied or MediaPipe fails to load, the UI shows a clear message instead of crashing.
