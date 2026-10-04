import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";

const video = document.querySelector("#camera");
const landmarkCanvas = document.querySelector("#landmarks");
const landmarkContext = landmarkCanvas.getContext("2d");
const cameraViewport = document.querySelector("#camera-viewport");
const startScreen = document.querySelector("#start-screen");
const startButton = document.querySelector("#start-button");
const startError = document.querySelector("#start-error");
const clockDisplay = document.querySelector("#clock");
const cameraToggleButton = document.querySelector("#camera-toggle");
const cameraToggleLabel = document.querySelector("#camera-toggle-label");

const ui = {
  cameraTag: document.querySelector("#camera-tag"),
  cameraState: document.querySelector("#camera-state"),
  handStatus: document.querySelector("#hand-status"),
  handIcon: document.querySelector("#hand-icon"),
  trackingStatus: document.querySelector("#tracking-status"),
  fps: document.querySelector("#fps"),
  coordinates: document.querySelector("#coordinate-readout"),
  gestureName: document.querySelector("#gesture-name"),
  gestureCardName: document.querySelector("#gesture-card-name"),
  gestureIcon: document.querySelector("#gesture-icon"),
  confidence: document.querySelector("#confidence"),
  confidenceBar: document.querySelector("#confidence-bar"),
  interactionState: document.querySelector("#interaction-state"),
  confirmState: document.querySelector("#confirm-state"),
  sceneTag: document.querySelector("#scene-tag"),
  sceneLoading: document.querySelector("#scene-loading"),
  sceneError: document.querySelector("#scene-error"),
  objectHud: document.querySelector("#object-hud"),
  sceneCoords: document.querySelector("#scene-coords"),
  footerStatus: document.querySelector("#footer-status"),
};

const gestureIcons = {
  "OPEN PALM": "✋",
  PINCH: "🤏",
  FIST: "✊",
  "THUMBS UP": "👍",
  "TWO FINGERS": "✌",
  "NO HAND": "◎",
  UNKNOWN: "◎",
};

const state = {
  stream: null,
  active: false,
  cameraEnabled: false,
  handLandmarker: null,
  handLandmarkerReady: false,
  renderer: null,
  scene: null,
  camera: null,
  robot: null,
  robotTargetMeshes: {},
  robotSelection: "chest",
  interactionActive: false,
  objectSelected: false,
  precisionMode: false,
  tapPulse: 0,
  confirmPulse: 0,
  lastGesture: "NO HAND",
  lastVideoTime: -1,
  lastFrameTime: performance.now(),
  frameCount: 0,
  lastFpsUpdate: performance.now(),
  smoothedLandmarks: null,
  currentGesture: "NO HAND",
  candidateGesture: "",
  candidateFrames: 0,
  lastHands: [],
};

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

let cameraToggleLocked = false;

function updateClock() {
  clockDisplay.textContent = new Date().toLocaleTimeString([], { hour12: false });
}
updateClock();
setInterval(updateClock, 1000);

function setStartError(message) {
  startError.textContent = message;
  startError.hidden = false;
}

function clearLandmarks() {
  landmarkContext.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
}

function updateCameraToggle() {
  const enabled = state.cameraEnabled && state.active;
  cameraToggleButton.classList.toggle("camera-toggle-off", !enabled);
  cameraToggleButton.setAttribute("aria-pressed", String(enabled));
  cameraToggleLabel.textContent = enabled ? "CAMERA OFF" : "CAMERA ON";
}

function setSceneError(message) {
  ui.sceneError.textContent = message;
  ui.sceneError.hidden = false;
  ui.sceneLoading.hidden = true;
}

function sizeLandmarkCanvas() {
  const bounds = cameraViewport.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  landmarkCanvas.width = Math.round(bounds.width * ratio);
  landmarkCanvas.height = Math.round(bounds.height * ratio);
  landmarkContext.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function canvasPoint(landmark) {
  const width = cameraViewport.clientWidth;
  const height = cameraViewport.clientHeight;
  const videoWidth = video.videoWidth || width;
  const videoHeight = video.videoHeight || height;
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const offsetX = (width - videoWidth * scale) / 2;
  const offsetY = (height - videoHeight * scale) / 2;
  return {
    x: landmark.x * videoWidth * scale + offsetX,
    y: landmark.y * videoHeight * scale + offsetY,
  };
}

function drawLandmarks(hands) {
  clearLandmarks();
  if (!hands.length) return;
  hands.forEach((hand) => {
    const points = hand.map(canvasPoint);
    landmarkContext.save();
    landmarkContext.lineCap = "round";
    landmarkContext.lineJoin = "round";
    HAND_CONNECTIONS.forEach(([start, end], index) => {
      const from = points[start];
      const to = points[end];
      landmarkContext.beginPath();
      landmarkContext.moveTo(from.x, from.y);
      landmarkContext.lineTo(to.x, to.y);
      landmarkContext.strokeStyle = index % 4 === 0 ? "#f3fffe" : "#64f2df";
      landmarkContext.lineWidth = index % 4 === 0 ? 2.3 : 1.6;
      landmarkContext.shadowColor = "#4ef5e5";
      landmarkContext.shadowBlur = 9;
      landmarkContext.stroke();
    });
    points.forEach((point, index) => {
      const radius = [4, 8, 12, 16, 20].includes(index) ? 4.2 : 2.6;
      landmarkContext.beginPath();
      landmarkContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
      landmarkContext.fillStyle = index === 8 || index === 4 ? "#ffffff" : "#61f1df";
      landmarkContext.shadowColor = "#3df9e8";
      landmarkContext.shadowBlur = 13;
      landmarkContext.fill();
      landmarkContext.beginPath();
      landmarkContext.arc(point.x, point.y, radius + 2, 0, Math.PI * 2);
      landmarkContext.strokeStyle = "rgba(159, 253, 243, 0.35)";
      landmarkContext.lineWidth = 1;
      landmarkContext.stroke();
    });
    landmarkContext.restore();
  });
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function isFingerExtended(landmarks, tip, pip, mcp) {
  return landmarks[tip].y < landmarks[pip].y && distance(landmarks[tip], landmarks[0]) > distance(landmarks[pip], landmarks[0]) * 1.08 &&
    distance(landmarks[tip], landmarks[0]) > distance(landmarks[mcp], landmarks[0]) * 1.22;
}

function classifyGesture(landmarks) {
  const palmWidth = Math.max(distance(landmarks[5], landmarks[17]), 0.001);
  const thumbIndexGap = distance(landmarks[4], landmarks[8]) / palmWidth;
  const index = isFingerExtended(landmarks, 8, 6, 5);
  const middle = isFingerExtended(landmarks, 12, 10, 9);
  const ring = isFingerExtended(landmarks, 16, 14, 13);
  const pinky = isFingerExtended(landmarks, 20, 18, 17);
  const thumbExtended = distance(landmarks[4], landmarks[5]) > distance(landmarks[3], landmarks[5]) * 1.28;
  const extendedCount = [index, middle, ring, pinky].filter(Boolean).length;
  const otherFingersFolded = extendedCount <= 1;

  if (thumbExtended && otherFingersFolded && landmarks[4].y < landmarks[3].y - palmWidth * 0.16 && landmarks[4].y < landmarks[2].y) {
    return { name: "THUMBS UP", confidence: 0.91 };
  }
  if (thumbIndexGap < 0.36) return { name: "PINCH", confidence: Math.min(0.99, 0.74 + (0.36 - thumbIndexGap) * 0.6) };
  if (extendedCount === 4) return { name: "OPEN PALM", confidence: 0.92 };
  if (index && middle && !ring && !pinky) return { name: "TWO FINGERS", confidence: 0.88 };
  if (extendedCount === 0) return { name: "FIST", confidence: 0.86 };
  return { name: "UNKNOWN", confidence: 0.58 };
}

function smoothGesture(rawName) {
  if (rawName === state.candidateGesture) {
    state.candidateFrames += 1;
  } else {
    state.candidateGesture = rawName;
    state.candidateFrames = 1;
  }
  if (state.candidateFrames >= 3) {
    state.currentGesture = state.candidateGesture;
  }
}

function smoothHand(landmarks) {
  const alpha = 0.42;
  if (!state.smoothedLandmarks || state.smoothedLandmarks.length !== landmarks.length) {
    state.smoothedLandmarks = landmarks.map((point) => ({ ...point }));
    return state.smoothedLandmarks;
  }
  state.smoothedLandmarks = landmarks.map((point, index) => ({
    x: state.smoothedLandmarks[index].x + (point.x - state.smoothedLandmarks[index].x) * alpha,
    y: state.smoothedLandmarks[index].y + (point.y - state.smoothedLandmarks[index].y) * alpha,
    z: (state.smoothedLandmarks[index].z || 0) + ((point.z || 0) - (state.smoothedLandmarks[index].z || 0)) * alpha,
  }));
  return state.smoothedLandmarks;
}

function updateGestureUi(gesture, confidence, landmarks) {
  ui.gestureName.textContent = gesture;
  ui.gestureCardName.textContent = gesture === "NO HAND" ? "AWAITING INPUT" : gesture;
  ui.gestureIcon.textContent = gestureIcons[gesture] || "◎";
  ui.confidence.textContent = gesture === "NO HAND" ? "—" : `${Math.round(confidence * 100)}%`;
  ui.confidenceBar.style.width = gesture === "NO HAND" ? "0%" : `${Math.round(confidence * 100)}%`;
  ui.handStatus.textContent = gesture === "NO HAND" ? "NOT DETECTED" : "DETECTED";
  ui.handIcon.textContent = gesture === "NO HAND" ? "○" : "◉";
  ui.handIcon.closest(".tracking-state").classList.toggle("active", gesture !== "NO HAND");

  if (landmarks?.length) {
    const palm = landmarks[9];
    ui.coordinates.textContent = `X ${(1 - palm.x).toFixed(2)}  Y ${palm.y.toFixed(2)}`;
  } else {
    ui.coordinates.textContent = "X --.--  Y --.--";
  }
}

function triggerBurst() {
  if (!state.robot) return;
  state.tapPulse = 1;
  if (state.robot.userData.coreMaterial) {
    state.robot.userData.coreMaterial.emissiveIntensity = 2.8;
  }
}

function highlightBodyPart(partName) {
  const targets = Object.values(state.robotTargetMeshes);
  targets.forEach((target) => {
    const isSelected = target.userData.partName === partName;
    const material = target.material;
    material.opacity = isSelected ? 0.7 : 0.08;
    material.color.set(isSelected ? 0x7ef0ff : 0x4dd0ff);
  });
  state.robotSelection = partName;
}

function updateInteraction(gesture, landmarks) {
  if (!landmarks || !state.robot) {
    state.interactionActive = false;
    state.objectSelected = false;
    ui.interactionState.textContent = "LOCKED";
    ui.sceneTag.textContent = "INTERACTION IDLE";
    ui.objectHud.classList.remove("visible");
    state.lastGesture = gesture;
    return;
  }

  if (gesture === "OPEN PALM") {
    state.interactionActive = true;
    state.objectSelected = false;
    ui.confirmState.textContent = "AWAITING INPUT";
  }

  if (gesture === "PINCH" && state.interactionActive) {
    state.objectSelected = true;
  }

  if (gesture === "FIST" && state.lastGesture !== "FIST") {
    triggerBurst();
  }

  if (gesture === "THUMBS UP" && state.lastGesture !== "THUMBS UP") {
    state.confirmPulse = 1;
    ui.confirmState.textContent = "CONFIRMED";
  }

  if (gesture === "TWO FINGERS" && state.lastGesture !== "TWO FINGERS") {
    state.precisionMode = !state.precisionMode;
  }

  if (gesture === "NO HAND") {
    state.interactionActive = false;
    state.objectSelected = false;
  }

  const handCenter = landmarks[9];
  const targetX = (0.5 - handCenter.x) * 3.5;
  const targetY = (0.5 - handCenter.y) * 1.6;
  const targetYaw = (0.5 - handCenter.x) * 1.2;
  const targetPitch = (0.5 - handCenter.y) * 0.7;
  state.robot.position.x += (targetX - state.robot.position.x) * 0.12;
  state.robot.position.y += (targetY - state.robot.position.y) * 0.12;
  state.robot.rotation.y += (targetYaw - state.robot.rotation.y) * 0.1;
  state.robot.rotation.x += (targetPitch - state.robot.rotation.x) * 0.1;

  if (gesture === "PINCH" || gesture === "TWO FINGERS") {
    const handX = handCenter.x * 2 - 1;
    const handY = -(handCenter.y * 2 - 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(handX, handY), state.camera);
    const targetMeshes = Object.values(state.robotTargetMeshes);
    const hits = raycaster.intersectObjects(targetMeshes, false);
    if (hits.length) {
      const part = hits[0].object.userData.partName;
      highlightBodyPart(part);
      ui.objectHud.classList.add("visible");
    } else {
      ui.objectHud.classList.remove("visible");
    }
  }

  if (!state.interactionActive) {
    ui.interactionState.textContent = "LOCKED";
  } else if (state.objectSelected) {
    ui.interactionState.textContent = state.precisionMode ? "PRECISION CONTROL" : "OBJECT SELECTED";
  } else {
    ui.interactionState.textContent = "ACTIVE / READY";
  }

  ui.sceneTag.textContent = state.objectSelected ? "OBJECT SELECTED" : state.interactionActive ? "INTERACTION ACTIVE" : "INTERACTION IDLE";
  ui.objectHud.classList.toggle("visible", state.objectSelected);

  state.lastGesture = gesture;
}

function createRobotTarget(partName, color) {
  const geometry = new THREE.SphereGeometry(0.22, 18, 14);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.partName = partName;
  mesh.visible = true;
  return mesh;
}

function createHumanoidRobot() {
  const root = new THREE.Group();
  const robotColor = new THREE.Color(0x7ae8df);
  const shellColor = new THREE.Color(0x8fc6ff);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: robotColor,
    emissive: new THREE.Color(0x1d7c84),
    emissiveIntensity: 1.2,
    roughness: 0.3,
    metalness: 0.55,
    transparent: true,
    opacity: 0.95,
  });

  const body = new THREE.Group();
  root.add(body);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.6, 10, 16), coreMaterial.clone());
  torso.position.y = 1.2;
  torso.rotation.z = 0.12;
  body.add(torso);

  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.2, 0.72), new THREE.MeshBasicMaterial({
    color: 0x9cf5ef,
    transparent: true,
    opacity: 0.18,
    wireframe: true,
  }));
  chestPlate.position.set(0, 1.2, 0.14);
  body.add(chestPlate);

  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 16), new THREE.MeshStandardMaterial({
    color: 0x58d7d0, emissive: 0x15a8a2, emissiveIntensity: 0.8, metalness: 0.45, roughness: 0.3, transparent: true, opacity: 0.88,
  }));
  pelvis.position.set(0, 0.1, 0);
  body.add(pelvis);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.54, 22, 18), coreMaterial.clone());
  head.position.set(0, 2.72, 0.08);
  body.add(head);

  const faceGrid = new THREE.Mesh(new THREE.TorusKnotGeometry(0.34, 0.08, 120, 16, 2, 3), new THREE.MeshBasicMaterial({
    color: 0x88e2ff, wireframe: true, transparent: true, opacity: 0.4,
  }));
  faceGrid.position.set(0, 2.7, 0.2);
  faceGrid.scale.set(1.15, 1, 1);
  body.add(faceGrid);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.34, 14), new THREE.MeshStandardMaterial({
    color: 0x86cfff, emissive: 0x295d7e, emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.44,
  }));
  neck.position.set(0, 2.12, 0.02);
  body.add(neck);

  const createLimb = (material, radius, length, color, position, rotation) => {
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.15, length, 12), material);
    limb.position.copy(position);
    limb.rotation.set(rotation.x, rotation.y, rotation.z);
    return limb;
  };

  const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x90effc, emissive: 0x2d6e99, emissiveIntensity: 0.75, metalness: 0.75, roughness: 0.3 });
  const armMaterial = new THREE.MeshStandardMaterial({ color: 0xaef1ff, emissive: 0x1d839a, emissiveIntensity: 0.9, metalness: 0.62, roughness: 0.32 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x93d9ff, emissive: 0x2b6281, emissiveIntensity: 0.7, metalness: 0.7, roughness: 0.35 });

  const leftShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), shoulderMaterial);
  leftShoulder.position.set(-0.9, 1.7, 0);
  body.add(leftShoulder);
  const rightShoulder = leftShoulder.clone();
  rightShoulder.position.x = 0.9;
  body.add(rightShoulder);

  const leftUpperArm = createLimb(armMaterial, 0.12, 0.95, 0x90effc, new THREE.Vector3(-1.22, 0.95, 0), new THREE.Euler(0, 0, 0.22));
  leftUpperArm.rotation.z = 0.82;
  body.add(leftUpperArm);
  const rightUpperArm = leftUpperArm.clone();
  rightUpperArm.position.x = 1.22; rightUpperArm.rotation.z = -0.82;
  body.add(rightUpperArm);

  const leftForearm = createLimb(armMaterial, 0.11, 0.9, 0x90effc, new THREE.Vector3(-1.82, 0.2, 0.1), new THREE.Euler(0, 0, 0.2));
  leftForearm.rotation.z = 0.95;
  body.add(leftForearm);
  const rightForearm = leftForearm.clone();
  rightForearm.position.x = 1.82; rightForearm.rotation.z = -0.95;
  body.add(rightForearm);

  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd4f8ff, emissive: 0x2a7bb5, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.32 }));
  leftHand.position.set(-2.18, -0.44, 0.12);
  body.add(leftHand);
  const rightHand = leftHand.clone(); rightHand.position.x = 2.18; body.add(rightHand);

  const leftThigh = createLimb(legMaterial, 0.16, 1.2, 0x93d9ff, new THREE.Vector3(-0.38, -1.05, 0), new THREE.Euler(0.08, 0, 0.03));
  body.add(leftThigh);
  const rightThigh = leftThigh.clone(); rightThigh.position.x = 0.38; body.add(rightThigh);

  const leftShin = createLimb(legMaterial, 0.14, 1.15, 0x93d9ff, new THREE.Vector3(-0.38, -2.18, 0.12), new THREE.Euler(0.12, 0, -0.03));
  body.add(leftShin);
  const rightShin = leftShin.clone(); rightShin.position.x = 0.38; body.add(rightShin);

  const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.68), new THREE.MeshStandardMaterial({ color: 0x9cf0ff, emissive: 0x16a3b4, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.22 }));
  leftFoot.position.set(-0.38, -2.92, 0.18); body.add(leftFoot);
  const rightFoot = leftFoot.clone(); rightFoot.position.x = 0.38; body.add(rightFoot);

  const bodyTargets = {
    head: createRobotTarget("head", 0x8df7ff),
    chest: createRobotTarget("chest", 0x6ea9ff),
    leftArm: createRobotTarget("leftArm", 0x7be2ff),
    rightArm: createRobotTarget("rightArm", 0x7be2ff),
    leftHand: createRobotTarget("leftHand", 0x7be2ff),
    rightHand: createRobotTarget("rightHand", 0x7be2ff),
    leftLeg: createRobotTarget("leftLeg", 0x7be2ff),
    rightLeg: createRobotTarget("rightLeg", 0x7be2ff),
  };

  bodyTargets.head.position.set(0, 2.72, 0.25); bodyTargets.head.scale.set(1.8, 1.7, 1.7);
  bodyTargets.chest.position.set(0, 1.2, 0.4); bodyTargets.chest.scale.set(1.7, 1.7, 1.2);
  bodyTargets.leftArm.position.set(-1.7, 0.35, 0.14); bodyTargets.leftArm.scale.set(1.3, 1.6, 1.2);
  bodyTargets.rightArm.position.set(1.7, 0.35, 0.14); bodyTargets.rightArm.scale.set(1.3, 1.6, 1.2);
  bodyTargets.leftHand.position.set(-2.15, -0.44, 0.2); bodyTargets.leftHand.scale.set(1.5, 1.5, 1.5);
  bodyTargets.rightHand.position.set(2.15, -0.44, 0.2); bodyTargets.rightHand.scale.set(1.5, 1.5, 1.5);
  bodyTargets.leftLeg.position.set(-0.45, -1.7, 0.18); bodyTargets.leftLeg.scale.set(1.5, 2.2, 1.3);
  bodyTargets.rightLeg.position.set(0.45, -1.7, 0.18); bodyTargets.rightLeg.scale.set(1.5, 2.2, 1.3);

  Object.values(bodyTargets).forEach((target) => {
    target.visible = true;
    root.add(target);
  });

  const ringGlow = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.035, 12, 120), new THREE.MeshBasicMaterial({ color: 0x85f1ff, transparent: true, opacity: 0.28 }));
  ringGlow.rotation.x = Math.PI / 2;
  ringGlow.position.y = -0.2;
  root.add(ringGlow);

  const particleCloud = new THREE.Group();
  const particleGeometry = new THREE.BufferGeometry();
  const particleCount = 420;
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i += 1) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * 5.2;
    positions[i3 + 1] = (Math.random() - 0.5) * 6.4;
    positions[i3 + 2] = (Math.random() - 0.5) * 3.3;
    const color = new THREE.Color(i % 2 === 0 ? 0x95f1ff : 0x7fa8ff);
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
  }
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const particleMaterial = new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(particleGeometry, particleMaterial);
  particleCloud.add(points);
  root.add(particleCloud);

  root.userData = {
    body,
    head,
    chestPlate,
    leftUpperArm,
    rightUpperArm,
    leftForearm,
    rightForearm,
    leftHand,
    rightHand,
    leftThigh,
    rightThigh,
    leftShin,
    rightShin,
    ringGlow,
    particleCloud,
    coreMaterial,
    targetMeshes: bodyTargets,
  };

  root.position.set(0, 0.1, 0);
  root.scale.setScalar(1.14);
  return root;
}

function initializeThree() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0f18, 0.05);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 0.6, 8.4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(cameraViewport.clientWidth, cameraViewport.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-label", "Interactive Three.js robot scene");
  cameraViewport.prepend(renderer.domElement);

  const hemisphere = new THREE.HemisphereLight(0xbfe8ff, 0x10161d, 1.65);
  scene.add(hemisphere);

  const keyLight = new THREE.DirectionalLight(0xe0f5ff, 2.3);
  keyLight.position.set(-3, 5, 5);
  scene.add(keyLight);

  const cyanGlow = new THREE.PointLight(0x65e4ff, 22, 12, 2);
  cyanGlow.position.set(2.5, 1.4, 3.5);
  scene.add(cyanGlow);

  const grid = new THREE.GridHelper(14, 30, 0x3a8290, 0x2f3d4b);
  grid.position.y = -2.2;
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  scene.add(grid);

  const robot = createHumanoidRobot();
  scene.add(robot);

  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.robot = robot;
  state.robotTargetMeshes = robot.userData.targetMeshes;
  state.robot.userData.coreMaterial = robot.userData.coreMaterial;

  resizeThree();
}

function resizeThree() {
  if (!state.renderer || !state.camera) return;
  const width = cameraViewport.clientWidth;
  const height = cameraViewport.clientHeight;
  if (!width || !height) return;
  state.renderer.setSize(width, height, false);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  sizeLandmarkCanvas();
}

function animateRobot(now) {
  if (!state.robot) return;
  const t = now * 0.001;
  const pulse = 1 + Math.sin(t * 1.8) * 0.05 + state.tapPulse * 0.16;
  state.robot.scale.setScalar(pulse);
  state.robot.rotation.y += 0.004;
  state.robot.rotation.x = Math.sin(t * 0.7) * 0.06;
  state.robot.position.y += Math.sin(t * 1.7) * 0.004;

  const leftArm = state.robot.userData.leftUpperArm;
  const rightArm = state.robot.userData.rightUpperArm;
  const leftForearm = state.robot.userData.leftForearm;
  const rightForearm = state.robot.userData.rightForearm;
  const leftShin = state.robot.userData.leftShin;
  const rightShin = state.robot.userData.rightShin;
  const head = state.robot.userData.head;
  const ringGlow = state.robot.userData.ringGlow;
  const particleCloud = state.robot.userData.particleCloud;

  leftArm.rotation.z = 0.82 + Math.sin(t * 1.2) * 0.18;
  rightArm.rotation.z = -0.82 - Math.sin(t * 1.2 + 0.8) * 0.18;
  leftForearm.rotation.z = 0.95 + Math.sin(t * 1.2 + 1.2) * 0.12;
  rightForearm.rotation.z = -0.95 - Math.sin(t * 1.2 + 1.4) * 0.12;
  leftShin.rotation.x = 0.12 + Math.sin(t * 1.3 + 0.7) * 0.09;
  rightShin.rotation.x = 0.12 + Math.sin(t * 1.3 + 1.0) * 0.09;
  head.rotation.y = Math.sin(t * 1.1) * 0.25;
  head.rotation.z = Math.sin(t * 1.5) * 0.13;
  ringGlow.rotation.z += 0.008;
  ringGlow.material.opacity = 0.2 + Math.sin(t * 2.8) * 0.08;

  const positions = particleCloud.children[0].geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += Math.sin(t * 0.5 + i) * 0.0009;
    positions[i + 1] += Math.cos(t * 0.6 + i) * 0.0009;
  }
  particleCloud.children[0].geometry.attributes.position.needsUpdate = true;

  if (state.tapPulse > 0) {
    state.tapPulse *= 0.94;
    if (state.tapPulse < 0.01) state.tapPulse = 0;
  }

  if (state.confirmPulse > 0) {
    state.confirmPulse *= 0.94;
    if (state.confirmPulse < 0.01) {
      state.confirmPulse = 0;
      ui.confirmState.textContent = "AWAITING INPUT";
    }
  }

  const robotCore = state.robot.userData.coreMaterial;
  robotCore.emissiveIntensity = 1.2 + state.tapPulse * 1.8 + Math.sin(t * 2.4) * 0.1;
  if (state.confirmPulse > 0) {
    robotCore.emissiveIntensity = 2.5 + state.confirmPulse * 4;
  }
}

function animate() {
  if (!state.active || !state.renderer || !state.scene || !state.camera) return;
  requestAnimationFrame(animate);
  const now = performance.now();
  const elapsed = Math.min((now - state.lastFrameTime) / 1000, 0.05);
  state.lastFrameTime = now;
  state.frameCount += 1;

  if (now - state.lastFpsUpdate >= 1000) {
    ui.fps.textContent = Math.round((state.frameCount * 1000) / (now - state.lastFpsUpdate));
    state.frameCount = 0;
    state.lastFpsUpdate = now;
  }

  animateRobot(now);
  state.camera.position.x += (0.2 - state.camera.position.x) * 0.02;
  state.camera.position.y += (0.7 - state.camera.position.y) * 0.02;
  state.camera.lookAt(0, 0.3, 0);
  if (state.renderer) state.renderer.render(state.scene, state.camera);
  ui.sceneCoords.textContent = `X ${state.robot.position.x.toFixed(2)}  Y ${state.robot.position.y.toFixed(2)}`;
}

async function initializeHandTracking() {
  if (state.handLandmarkerReady) return;
  try {
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm");
    state.handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    state.handLandmarkerReady = true;
  } catch (error) {
    console.error("MediaPipe failed to initialize:", error);
    throw new Error("mediapipe");
  }
}

function processVideoFrame() {
  if (!state.active || !state.cameraEnabled || !state.handLandmarker || !video) return;
  try {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      const result = state.handLandmarker.detectForVideo(video, performance.now());
      const landmarks = result.landmarks?.length ? result.landmarks.map(smoothHand) : [];
      state.lastHands = landmarks;
      drawLandmarks(landmarks);

      if (landmarks.length) {
        const classification = classifyGesture(landmarks[0]);
        smoothGesture(classification.name);
        updateGestureUi(state.currentGesture, classification.confidence, landmarks[0]);
        updateInteraction(state.currentGesture, landmarks[0]);
        ui.trackingStatus.textContent = "ACTIVE";
        ui.handStatus.textContent = "DETECTED";
        ui.footerStatus.textContent = "ACTIVE";
      } else {
        state.smoothedLandmarks = null;
        smoothGesture("NO HAND");
        updateGestureUi(state.currentGesture, 0, null);
        updateInteraction(state.currentGesture, null);
        ui.trackingStatus.textContent = "STANDBY";
        ui.footerStatus.textContent = "ACTIVE";
      }
    }
  } catch (error) {
    console.error("Hand tracking frame failed:", error);
    ui.trackingStatus.textContent = "ERROR";
    ui.footerStatus.textContent = "TRACKING ERROR";
    setSceneError("Hand tracking encountered an error. Reload the page and try again.");
    stopCamera();
    return;
  }

  requestAnimationFrame(processVideoFrame);
}

async function startExperience() {
  if (cameraToggleLocked) return;
  cameraToggleLocked = true;
  startButton.disabled = true;
  startButton.querySelector("span:first-child").textContent = "REQUESTING CAMERA";
  startError.hidden = true;

  if (!navigator.mediaDevices?.getUserMedia) {
    setStartError("Camera access requires HTTPS or localhost in a supported browser.");
    startButton.disabled = false;
    startButton.querySelector("span:first-child").textContent = "START EXPERIENCE";
    cameraToggleLocked = false;
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } },
    });

    state.stream = stream;
    video.srcObject = stream;
    video.classList.add("active");
    cameraViewport.classList.add("is-live");
    await video.play();

    if (!state.renderer) {
      initializeThree();
    }

    if (!state.handLandmarkerReady) {
      await initializeHandTracking();
    }

    state.active = true;
    state.cameraEnabled = true;
    ui.cameraTag.textContent = "LIVE INPUT";
    ui.cameraState.textContent = "CAMERA LIVE";
    ui.trackingStatus.textContent = "ACTIVE";
    ui.footerStatus.textContent = "ACTIVE";
    ui.handStatus.textContent = "NOT DETECTED";
    startScreen.classList.add("dismissed");
    updateCameraToggle();
    requestAnimationFrame(processVideoFrame);
    requestAnimationFrame(animate);
  } catch (error) {
    console.error("Experience initialization failed:", error);
    if (state.stream) {
      stopCamera();
    }
    setStartError(error.name === "NotAllowedError" ? "Camera permission was denied. Please allow camera access to continue." : "The experience could not be initialized. Please ensure WebGL and camera access are available.");
    startButton.disabled = false;
    startButton.querySelector("span:first-child").textContent = "START EXPERIENCE";
    cameraToggleLocked = false;
    return;
  }

  startButton.disabled = false;
  startButton.querySelector("span:first-child").textContent = "START EXPERIENCE";
  cameraToggleLocked = false;
}

function stopCamera() {
  state.active = false;
  state.cameraEnabled = false;
  state.lastVideoTime = -1;
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  if (video) {
    video.pause();
    video.srcObject = null;
    video.classList.remove("active");
  }
  cameraViewport.classList.remove("is-live");
  clearLandmarks();
  ui.cameraTag.textContent = "CAMERA OFF";
  ui.cameraState.textContent = "CAMERA OFF";
  ui.handStatus.textContent = "NOT DETECTED";
  ui.handIcon.textContent = "○";
  ui.handIcon.closest(".tracking-state").classList.remove("active");
  ui.trackingStatus.textContent = "OFFLINE";
  ui.footerStatus.textContent = "CAMERA OFF";
  ui.gestureName.textContent = "—";
  ui.gestureCardName.textContent = "AWAITING INPUT";
  ui.gestureIcon.textContent = "◎";
  ui.confidence.textContent = "—";
  ui.confidenceBar.style.width = "0%";
  ui.coordinates.textContent = "X --.--  Y --.--";
  updateCameraToggle();
}

cameraToggleButton.addEventListener("click", () => {
  if (state.cameraEnabled && state.active) {
    stopCamera();
    return;
  }
  startExperience();
});

startButton.addEventListener("click", startExperience);
window.addEventListener("resize", resizeThree);

updateCameraToggle();
sizeLandmarkCanvas();
ui.handStatus.textContent = "NOT DETECTED";
ui.cameraTag.textContent = "STANDBY";
ui.cameraState.textContent = "INPUT STANDBY";
ui.footerStatus.textContent = "NOT INITIALIZED";
