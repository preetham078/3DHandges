import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";

const video = document.querySelector("#camera");
const landmarkCanvas = document.querySelector("#landmarks");
const landmarkContext = landmarkCanvas.getContext("2d");
const cameraViewport = document.querySelector("#camera-viewport");
const sceneViewport = document.querySelector("#scene");
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
  objectHudLabel: document.querySelector("#object-hud-label"),
  sceneCoords: document.querySelector("#scene-coords"),
  footerStatus: document.querySelector("#footer-status"),
};

const state = {
  stream: null,
  active: false,
  cameraEnabled: false,
  poseLandmarker: null,
  handLandmarker: null,
  faceLandmarker: null,
  motionTrackingReady: false,
  renderer: null,
  scene: null,
  camera: null,
  robot: null,
  robotModules: {},
  cameraYaw: 0,
  cameraPitch: 0.04,
  cameraRadius: 12.4,
  cameraFocus: new THREE.Vector3(0, 0.15, 0),
  cameraFocusTarget: new THREE.Vector3(0, 0.15, 0),
  cameraRadiusTarget: 12.4,
  pointerDown: false,
  pointerX: 0,
  pointerY: 0,
  animationStarted: false,
  motionActive: false,
  lastVideoTime: -1,
  lastFrameTime: performance.now(),
  frameCount: 0,
  lastFpsUpdate: performance.now(),
  smoothedLandmarks: {},
  lastPose: null,
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

function drawLandmarks(hands, shouldClear = true) {
  if (shouldClear) clearLandmarks();
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

const POSE_CONNECTIONS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];

function drawPoseOverlay(pose, hands) {
  clearLandmarks();
  if (pose) {
    const points = pose.map(canvasPoint);
    landmarkContext.save();
    landmarkContext.lineCap = "round";
    POSE_CONNECTIONS.forEach(([fromIndex, toIndex]) => {
      const from = points[fromIndex]; const to = points[toIndex];
      landmarkContext.beginPath(); landmarkContext.moveTo(from.x, from.y); landmarkContext.lineTo(to.x, to.y);
      landmarkContext.strokeStyle = "#61f1df"; landmarkContext.lineWidth = 2.2; landmarkContext.shadowColor = "#3df9e8"; landmarkContext.shadowBlur = 9; landmarkContext.stroke();
    });
    [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach((index) => {
      const point = points[index]; landmarkContext.beginPath(); landmarkContext.arc(point.x, point.y, index === 0 ? 5 : 3.4, 0, Math.PI * 2);
      landmarkContext.fillStyle = "#eaffff"; landmarkContext.fill();
    });
    landmarkContext.restore();
  }
  drawLandmarks(hands, false);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function smoothHand(landmarks, key) {
  const alpha = 0.36;
  const previous = state.smoothedHands[key];
  if (!previous || previous.length !== landmarks.length) {
    state.smoothedHands[key] = landmarks.map((point) => ({ ...point }));
    return state.smoothedHands[key];
  }
  state.smoothedHands[key] = landmarks.map((point, index) => ({
    x: previous[index].x + (point.x - previous[index].x) * alpha,
    y: previous[index].y + (point.y - previous[index].y) * alpha,
    z: (previous[index].z || 0) + ((point.z || 0) - (previous[index].z || 0)) * alpha,
  }));
  return state.smoothedHands[key];
}

function makeHandData(landmarks, key) {
  const pinchPoint = {
    x: (landmarks[4].x + landmarks[8].x) / 2,
    y: (landmarks[4].y + landmarks[8].y) / 2,
    z: (landmarks[4].z + landmarks[8].z) / 2,
  };
  const palmWidth = Math.max(distance(landmarks[5], landmarks[17]), 0.001);
  return { key, landmarks, pinchPoint, pinching: distance(landmarks[4], landmarks[8]) / palmWidth < 0.43, depth: landmarks[9].z || 0 };
}

function updateHandUi(right, left) {
  const activeCount = Number(Boolean(right)) + Number(Boolean(left));
  ui.gestureName.textContent = activeCount === 2 ? "TWO HANDS" : activeCount === 1 ? `${right ? "RIGHT" : "LEFT"} HAND` : "WAITING";
  ui.handStatus.textContent = activeCount ? `${activeCount} HAND${activeCount > 1 ? "S" : ""} DETECTED` : "NOT DETECTED";
  ui.handIcon.textContent = activeCount ? "◉" : "○";
  ui.handIcon.closest(".tracking-state").classList.toggle("active", Boolean(activeCount));
  ui.confidence.textContent = activeCount ? `${activeCount}/2` : "—";
  ui.confidenceBar.style.width = `${activeCount * 50}%`;
  if (right || left) {
    const point = (right || left).pinchPoint;
    ui.coordinates.textContent = `X ${(1 - point.x).toFixed(2)}  Y ${point.y.toFixed(2)}`;
  } else ui.coordinates.textContent = "X --.--  Y --.--";
}

function setModuleExploded(key, exploded) {
  const module = state.robotModules[key];
  if (module) module.userData.targetExplode = exploded ? 1 : 0;
}

function resetRobot() {
  state.allExploded = false;
  Object.keys(state.robotModules).forEach((key) => {
    const module = state.robotModules[key];
    setModuleExploded(key, false);
    module.userData.manualActive = false;
    module.userData.detached = false;
    module.userData.manualRotation = new THREE.Euler();
    if (module.userData.highlight) module.userData.highlight.visible = false;
  });
  state.heldModule = null;
  state.selectedModule = null;
  state.robotSelection = null;
  state.cameraFocusTarget.set(0, 0.15, 0);
  state.cameraRadiusTarget = 12.4;
  ui.objectHud.classList.remove("visible");
  ui.sceneTag.textContent = "INTERACTION IDLE";
}

function explodeRobot() {
  state.allExploded = true;
  Object.keys(state.robotModules).forEach((key) => setModuleExploded(key, true));
  ui.sceneTag.textContent = "ARCHITECTURE EXPLODED";
}

function selectModule(key, explode = true) {
  const module = state.robotModules[key];
  if (!module) return;
  if (state.selectedModule && state.selectedModule !== key && !state.allExploded) setModuleExploded(state.selectedModule, false);
  state.selectedModule = key;
  state.robotSelection = key;
  if (explode) setModuleExploded(key, true);
  module.getWorldPosition(state.cameraFocusTarget);
  state.cameraRadiusTarget = Math.max(4.6, Math.min(8.4, module.userData.focusRadius || 6.6));
  ui.objectHudLabel.textContent = module.userData.label;
  ui.objectHud.classList.add("visible");
  ui.sceneTag.textContent = module.userData.label;
  ui.interactionState.textContent = "OBJECT SELECTED";
}

function cursorWorld(point, zOffset = 0) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2((1 - point.x) * 2 - 1, -(point.y * 2 - 1)), state.camera);
  const normal = state.camera.getWorldDirection(new THREE.Vector3());
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, state.cameraFocus);
  const world = raycaster.ray.intersectPlane(plane, new THREE.Vector3()) || state.cameraFocus.clone();
  return world.addScaledVector(normal, zOffset);
}

function moduleAtHand(hand) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2((1 - hand.pinchPoint.x) * 2 - 1, -(hand.pinchPoint.y * 2 - 1)), state.camera);
  return raycaster.intersectObjects(state.robotPickables, false)[0];
}

function setModuleHighlight(key, visible) {
  const module = state.robotModules[key];
  if (!module || !state.scene) return;
  if (!module.userData.highlight) {
    module.userData.highlight = new THREE.BoxHelper(module, 0x62f0df);
    module.userData.highlight.material.transparent = true;
    module.userData.highlight.material.opacity = .78;
    state.scene.add(module.userData.highlight);
  }
  module.userData.highlight.visible = visible;
}

function beginGrab(key, hand, source = "RIGHT HAND") {
  const module = state.robotModules[key];
  if (!module || state.heldModule) return;
  state.heldModule = key;
  state.selectedModule = key;
  state.robotSelection = key;
  module.userData.manualActive = true;
  module.userData.detached = true;
  module.userData.targetExplode = 0;
  const handLocal = state.robot.worldToLocal(cursorWorld(hand.pinchPoint, hand.depth * 2.6));
  module.userData.grabOffset = module.position.clone().sub(handLocal);
  module.userData.manualTarget = module.position.clone();
  module.userData.manualRotation = module.rotation.clone();
  setModuleHighlight(key, true);
  state.cameraFocusTarget.copy(module.getWorldPosition(new THREE.Vector3()));
  state.cameraRadiusTarget = Math.min(state.cameraRadiusTarget, module.userData.focusRadius || 6.4);
  ui.objectHudLabel.textContent = `GRABBED — ${source}`;
  ui.objectHud.classList.add("visible");
  ui.interactionState.textContent = "HOLDING MODULE";
  ui.confirmState.textContent = "DETACHED / INSPECT";
}

function releaseGrab(snap = false) {
  const key = state.heldModule;
  if (!key) return;
  const module = state.robotModules[key];
  if (snap) {
    module.userData.manualTarget = module.userData.base.clone();
    module.userData.manualRotation = new THREE.Euler();
    module.userData.detached = false;
    ui.objectHudLabel.textContent = "MODULE ATTACHED";
    ui.confirmState.textContent = "MODULE ATTACHED";
  } else {
    ui.objectHudLabel.textContent = "MODULE RELEASED";
    ui.confirmState.textContent = "FLOATING / GRAB TO MOVE";
  }
  module.userData.manualActive = !snap;
  setModuleHighlight(key, false);
  state.heldModule = null;
  state.leftInspectAnchor = null;
  state.twoHandZoomAnchor = null;
  state.snapFrames = 0;
  ui.interactionState.textContent = snap ? "ATTACHED" : "MODULE RELEASED";
}

function updateHeldModule(right, left) {
  const module = state.robotModules[state.heldModule];
  if (!module) return;
  const handLocal = state.robot.worldToLocal(cursorWorld(right.pinchPoint, right.depth * 2.6));
  module.userData.manualTarget = handLocal.add(module.userData.grabOffset || new THREE.Vector3());
  state.cameraFocusTarget.lerp(module.getWorldPosition(new THREE.Vector3()), .12);
  if (left) {
    if (!state.leftInspectAnchor) state.leftInspectAnchor = { x: left.pinchPoint.x, y: left.pinchPoint.y, depth: left.depth, rotation: module.userData.manualRotation.clone(), radius: state.cameraRadiusTarget };
    const anchor = state.leftInspectAnchor;
    module.userData.manualRotation.y = anchor.rotation.y + (left.pinchPoint.x - anchor.x) * 5;
    module.userData.manualRotation.x = anchor.rotation.x + (left.pinchPoint.y - anchor.y) * 3;
    state.cameraRadiusTarget = THREE.MathUtils.clamp(anchor.radius + (left.depth - anchor.depth) * 18, 3.8, 9);
    ui.objectHudLabel.textContent = "INSPECTING — LEFT HAND";
    ui.interactionState.textContent = "INSPECTING MODULE";
  }
  if (left?.pinching && right.pinching) {
    const distanceNow = Math.hypot(left.pinchPoint.x - right.pinchPoint.x, left.pinchPoint.y - right.pinchPoint.y);
    if (!state.twoHandZoomAnchor) state.twoHandZoomAnchor = { distance: distanceNow, radius: state.cameraRadiusTarget };
    state.cameraRadiusTarget = THREE.MathUtils.clamp(state.twoHandZoomAnchor.radius - (distanceNow - state.twoHandZoomAnchor.distance) * 12, 3.6, 9);
  } else state.twoHandZoomAnchor = null;
  const snapDistance = module.userData.manualTarget.distanceTo(module.userData.base);
  if (snapDistance < .42) {
    state.snapFrames += 1;
    ui.objectHudLabel.textContent = "READY TO ATTACH";
    ui.confirmState.textContent = "ATTACH";
    if (state.snapFrames > 12) releaseGrab(true);
  } else state.snapFrames = 0;
}

function updateHandCursors(right, left) {
  if (!state.handCursors) return;
  [["right", right], ["left", left]].forEach(([key, hand]) => {
    const cursor = state.handCursors[key];
    cursor.visible = Boolean(hand);
    if (!hand) return;
    cursor.position.lerp(cursorWorld(hand.pinchPoint, hand.depth * 2.6), .35);
    cursor.children[0].material.emissiveIntensity = hand.pinching ? 3.5 : 1.1;
    cursor.scale.setScalar(hand.pinching ? 1.25 : 1);
  });
}

function updateInteraction(right, left) {
  state.rightHand = right; state.leftHand = left;
  state.rightPinching = Boolean(right?.pinching); state.leftPinching = Boolean(left?.pinching);
  updateHandUi(right, left); updateHandCursors(right, left);
  if (right?.pinching && !state.lastRightPinching && !state.heldModule) {
    const hit = moduleAtHand(right);
    if (hit) beginGrab(hit.object.userData.partKey, right);
  }
  if (state.heldModule && right?.pinching) updateHeldModule(right, left);
  if (state.heldModule && (!right || !right.pinching)) releaseGrab(false);
  if (!state.heldModule && !right && !left) {
    ui.gestureCardName.textContent = "AWAITING HANDS";
    ui.gestureIcon.textContent = "◎";
  } else if (state.heldModule) {
    ui.gestureCardName.textContent = left ? "TWO-HAND INSPECTION" : "RIGHT HAND HOLD";
    ui.gestureIcon.textContent = "◉";
  } else {
    ui.gestureCardName.textContent = right?.pinching ? "SEARCHING MODULE" : "TRACKING HANDS";
    ui.gestureIcon.textContent = "◌";
  }
  state.lastRightPinching = Boolean(right?.pinching);
}

function smoothLandmarkSet(landmarks, key) {
  if (!landmarks?.length) return null;
  const previous = state.smoothedLandmarks[key];
  const amount = .32;
  state.smoothedLandmarks[key] = !previous || previous.length !== landmarks.length ? landmarks.map((point) => ({ ...point })) : landmarks.map((point, index) => ({
    x: previous[index].x + (point.x - previous[index].x) * amount,
    y: previous[index].y + (point.y - previous[index].y) * amount,
    z: (previous[index].z || 0) + ((point.z || 0) - (previous[index].z || 0)) * amount,
  }));
  return state.smoothedLandmarks[key];
}

function jointAngle(a, b, c) {
  const ab = new THREE.Vector2(a.x - b.x, a.y - b.y);
  const cb = new THREE.Vector2(c.x - b.x, c.y - b.y);
  return Math.acos(THREE.MathUtils.clamp(ab.normalize().dot(cb.normalize()), -1, 1));
}

function limbDirection(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function poseRotation(key, x = 0, y = 0, z = 0) {
  const part = state.robotModules[key];
  if (part) part.userData.poseRotation = new THREE.Euler(x, y, z);
}

function updateMotionUi(pose) {
  const detected = Boolean(pose);
  ui.gestureName.textContent = detected ? "PERSON DETECTED" : "WAITING";
  ui.handStatus.textContent = detected ? "BODY DETECTED" : "NOT DETECTED";
  ui.handIcon.textContent = detected ? "◉" : "○";
  ui.handIcon.closest(".tracking-state").classList.toggle("active", detected);
  ui.confidence.textContent = detected ? "LIVE" : "—";
  ui.confidenceBar.style.width = detected ? "100%" : "0%";
  ui.gestureCardName.textContent = detected ? "MIRRORING MOTION" : "AWAITING SUBJECT";
  ui.gestureIcon.textContent = detected ? "◉" : "◎";
  ui.interactionState.textContent = detected ? "MIRROR ACTIVE" : "MIRROR READY";
  ui.confirmState.textContent = detected ? "JOINT ANGLES MAPPED" : "AWAITING POSE";
  ui.objectHudLabel.textContent = detected ? "LIVE HUMAN → ROBOT MIRROR" : "MIRROR MODE READY";
  ui.objectHud.classList.toggle("visible", detected);
}

function applyHumanMotion(pose, hands, face) {
  if (!pose) return;
  const leftShoulder = pose[11], rightShoulder = pose[12], leftHip = pose[23], rightHip = pose[24];
  const shoulderMid = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2, z: (leftShoulder.z + rightShoulder.z) / 2 };
  const hipMid = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2, z: (leftHip.z + rightHip.z) / 2 };
  const torsoLean = THREE.MathUtils.clamp(Math.atan2(shoulderMid.x - hipMid.x, hipMid.y - shoulderMid.y), -.45, .45);
  const torsoYaw = THREE.MathUtils.clamp((leftShoulder.z - rightShoulder.z) * 2.8, -.45, .45);
  poseRotation("TORSO", 0, torsoYaw, -torsoLean);
  poseRotation("ABDOMEN", 0, torsoYaw * .7, -torsoLean * .7);
  poseRotation("PELVIS", 0, torsoYaw * .35, -torsoLean * .35);

  [["LEFT", 11, 13, 15, -1], ["RIGHT", 12, 14, 16, 1]].forEach(([side, shoulderIndex, elbowIndex, wristIndex, direction]) => {
    const shoulder = pose[shoulderIndex], elbow = pose[elbowIndex], wrist = pose[wristIndex];
    const directionAngle = limbDirection(shoulder, elbow);
    const shoulderLift = THREE.MathUtils.clamp((directionAngle - Math.PI / 2) * direction, -1.55, 1.55);
    const elbowBend = THREE.MathUtils.clamp(Math.PI - jointAngle(shoulder, elbow, wrist), 0, 2.1);
    poseRotation(`${side}_ARM`, 0, (elbow.z - shoulder.z) * 1.9, shoulderLift);
    const arm = state.robotModules[`${side}_ARM`];
    if (arm?.userData.kinematics) {
      arm.userData.kinematics.forearm.rotation.z += ((direction * elbowBend * .58) - arm.userData.kinematics.forearm.rotation.z) * .14;
      arm.userData.kinematics.wrist.rotation.y += ((wrist.z - elbow.z) * 3 - arm.userData.kinematics.wrist.rotation.y) * .14;
    }
  });

  [["LEFT", 23, 25, 27, -1], ["RIGHT", 24, 26, 28, 1]].forEach(([side, hipIndex, kneeIndex, ankleIndex, direction]) => {
    const hip = pose[hipIndex], knee = pose[kneeIndex], ankle = pose[ankleIndex];
    const legLift = THREE.MathUtils.clamp((limbDirection(hip, knee) - Math.PI / 2) * direction, -.95, .95);
    const kneeBend = THREE.MathUtils.clamp(Math.PI - jointAngle(hip, knee, ankle), 0, 1.9);
    poseRotation(`${side}_LEG`, 0, (knee.z - hip.z) * 1.5, legLift);
    const leg = state.robotModules[`${side}_LEG`];
    if (leg?.userData.kinematics) leg.userData.kinematics.shin.rotation.z += ((direction * kneeBend * .42) - leg.userData.kinematics.shin.rotation.z) * .14;
    poseRotation(`${side}_FOOT`, (ankle.y - knee.y) * .6, 0, legLift * .25);
  });

  const head = state.robotModules.HEAD;
  const neck = state.robotModules.NECK;
  const headRoll = face?.length ? Math.atan2(face[263].y - face[33].y, face[263].x - face[33].x) : 0;
  const headYaw = face?.length ? THREE.MathUtils.clamp((face[263].z - face[33].z) * 8, -.8, .8) : torsoYaw * .45;
  const eyeMidY = face?.length ? (face[33].y + face[263].y) / 2 : pose[0].y;
  const headPitch = face?.length ? THREE.MathUtils.clamp((face[1].y - eyeMidY) * 4, -.55, .55) : 0;
  if (head) head.userData.poseRotation = new THREE.Euler(headPitch, headYaw, headRoll);
  if (neck) neck.userData.poseRotation = new THREE.Euler(headPitch * .35, headYaw * .35, headRoll * .35);

  hands.forEach(({ key, landmarks }) => {
    const robotHand = state.robotModules[key === "Left" ? "LEFT_HAND" : "RIGHT_HAND"];
    if (!robotHand?.userData.kinematics) return;
    const fingerTips = [8, 12, 16, 20];
    robotHand.userData.kinematics.fingers.forEach((finger, index) => {
      const curl = THREE.MathUtils.clamp(1 - distance(landmarks[0], landmarks[fingerTips[index]]) / Math.max(distance(landmarks[0], landmarks[9]) * 2.1, .001), 0, 1);
      finger.rotation.x += (curl * 1.15 - finger.rotation.x) * .14;
    });
    const thumbCurl = THREE.MathUtils.clamp(1 - distance(landmarks[0], landmarks[4]) / Math.max(distance(landmarks[0], landmarks[9]) * 1.55, .001), 0, 1);
    robotHand.userData.kinematics.thumb.rotation.x += (thumbCurl * .8 - robotHand.userData.kinematics.thumb.rotation.x) * .14;
  });
}

function createHumanoidRobot() {
  const root = new THREE.Group();
  root.name = "Robot";
  const modules = {};
  const pickables = [];
  const shell = new THREE.MeshStandardMaterial({ color: 0xa8bbc8, metalness: 0.86, roughness: 0.27 });
  const shellLight = new THREE.MeshStandardMaterial({ color: 0xe1e9ec, metalness: 0.78, roughness: 0.22 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x14212a, metalness: 0.35, roughness: 0.36 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x33414c, metalness: 0.95, roughness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x167f9c, emissive: 0x07546a, emissiveIntensity: 1.15, metalness: 0.72, roughness: 0.2 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b1116, roughness: 0.62, metalness: 0.15 });
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x75838b, metalness: 0.9, roughness: 0.24 });

  const mesh = (geometry, material, position = null, rotation = null) => {
    const object = new THREE.Mesh(geometry, material);
    if (position) object.position.copy(position);
    if (rotation) object.rotation.set(rotation.x, rotation.y, rotation.z);
    object.castShadow = object.receiveShadow = true;
    return object;
  };
  const box = (x, y, z, material, position) => mesh(new THREE.BoxGeometry(x, y, z), material, position);
  const cyl = (r1, r2, h, material, position, rotation) => mesh(new THREE.CylinderGeometry(r1, r2, h, 16), material, position, rotation);
  const module = (key, label, position, explode, focusRadius = 6.5) => {
    const group = new THREE.Group();
    group.name = key;
    group.position.copy(position);
    group.userData = { key, label, base: position.clone(), explode: explode.clone(), targetExplode: 0, focusRadius };
    root.add(group); modules[key] = group;
    return group;
  };
  const boltRing = (parent, radius, z = 0.22) => {
    for (let i = 0; i < 6; i += 1) {
      const angle = i / 6 * Math.PI * 2;
      const bolt = cyl(0.028, 0.028, 0.04, boltMat, new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z), new THREE.Euler(Math.PI / 2, 0, 0));
      parent.add(bolt);
    }
  };
  const joint = (radius = 0.2, depth = 0.28) => {
    const group = new THREE.Group();
    group.add(cyl(radius, radius, depth, jointMat, new THREE.Vector3(), new THREE.Euler(0, Math.PI / 2, 0)));
    const ring = mesh(new THREE.TorusGeometry(radius * 0.69, 0.027, 8, 20), accent, new THREE.Vector3(depth / 2 + .005, 0, 0), new THREE.Euler(0, Math.PI / 2, 0));
    group.add(ring);
    for (let i = 0; i < 4; i += 1) {
      const angle = i * Math.PI / 2;
      group.add(cyl(.026, .026, .045, boltMat, new THREE.Vector3(depth / 2 + .025, Math.cos(angle) * radius * .67, Math.sin(angle) * radius * .67), new THREE.Euler(0, Math.PI / 2, 0)));
    }
    return group;
  };
  const limbHousing = (length, width, side = 1) => {
    const group = new THREE.Group();
    group.add(mesh(new THREE.CapsuleGeometry(width, Math.max(.08, length - width * 2), 6, 14), shellLight));
    group.add(box(width * 1.33, length * .64, width * .9, carbon, new THREE.Vector3(0, 0, width * .52)));
    group.add(box(width * .34, length * .56, width * .11, accent, new THREE.Vector3(side * width * .72, 0, width * .58)));
    group.add(cyl(.045, .045, length * .72, jointMat, new THREE.Vector3(-side * width * .7, 0, width * .42)));
    group.add(cyl(.066, .066, .07, accent, new THREE.Vector3(-side * width * .7, length * .25, width * .42), new THREE.Euler(Math.PI / 2, 0, 0)));
    return group;
  };
  const armModule = (side) => {
    const x = side * 1.02;
    const group = module(side < 0 ? "LEFT_ARM" : "RIGHT_ARM", side < 0 ? "LEFT ARM MODULE" : "RIGHT ARM MODULE", new THREE.Vector3(x, 1.72, 0), new THREE.Vector3(side * .7, .08, 0), 6.8);
    const shoulder = joint(.27, .34); shoulder.position.set(side * .08, 0, 0); group.add(shoulder);
    const shoulderCap = mesh(new THREE.SphereGeometry(.34, 16, 12), shell, new THREE.Vector3(side * .11, 0, 0)); shoulderCap.scale.set(1.12, .9, .88); group.add(shoulderCap);
    const upper = limbHousing(.88, .2, side); upper.position.set(side * .28, -.6, 0); group.add(upper);
    const elbow = joint(.19, .29); elbow.position.set(side * .27, -1.12, 0); group.add(elbow);
    const forearm = limbHousing(.78, .18, side); forearm.position.set(side * .32, -1.64, 0); group.add(forearm);
    const wrist = joint(.12, .2); wrist.position.set(side * .3, -2.1, 0); group.add(wrist);
    group.userData.kinematics = { upper, elbow, forearm, wrist };
    return group;
  };
  const handModule = (side) => {
    const group = module(side < 0 ? "LEFT_HAND" : "RIGHT_HAND", side < 0 ? "LEFT ROBOTIC HAND" : "RIGHT ROBOTIC HAND", new THREE.Vector3(side * 1.35, -.44, .02), new THREE.Vector3(side * 1.05, -.18, .04), 5.5);
    group.add(box(.34, .42, .2, shellLight, new THREE.Vector3(0, 0, .02)));
    group.add(box(.22, .28, .1, carbon, new THREE.Vector3(0, -.02, .14)));
    const fingerX = [-.13, -.045, .045, .13];
    const fingers = [];
    fingerX.forEach((finger, index) => {
      const digit = new THREE.Group(); digit.position.set(finger, -.27, .02); group.add(digit);
      fingers.push(digit);
      for (let segment = 0; segment < 3; segment += 1) {
        const length = segment === 0 ? .17 : .125;
        const phalanx = box(.052, length, .062, shell, new THREE.Vector3(0, -segment * .135, 0));
        digit.add(phalanx);
        if (segment < 2) digit.add(cyl(.04, .04, .075, jointMat, new THREE.Vector3(0, -segment * .135 - length / 2, 0), new THREE.Euler(0, 0, Math.PI / 2)));
      }
      digit.rotation.z = (index - 1.5) * .08;
    });
    const thumb = new THREE.Group(); thumb.position.set(side * .22, -.08, 0); thumb.rotation.z = side * -.68; group.add(thumb);
    thumb.add(box(.055, .19, .066, shell, new THREE.Vector3(0, -.08, 0))); thumb.add(box(.05, .14, .06, shellLight, new THREE.Vector3(0, -.23, 0)));
    group.userData.kinematics = { fingers, thumb };
    return group;
  };
  const legModule = (side) => {
    const group = module(side < 0 ? "LEFT_LEG" : "RIGHT_LEG", side < 0 ? "LEFT LEG MODULE" : "RIGHT LEG MODULE", new THREE.Vector3(side * .41, .12, 0), new THREE.Vector3(side * .45, -.15, .02), 7.6);
    const hip = joint(.21, .3); hip.position.set(0, 0, 0); group.add(hip);
    const thigh = limbHousing(1.02, .25, side); thigh.position.set(0, -.64, 0); group.add(thigh);
    const knee = joint(.23, .32); knee.position.set(0, -1.27, .02); group.add(knee);
    const shin = limbHousing(1.02, .23, -side); shin.position.set(0, -1.91, 0); group.add(shin);
    const ankle = joint(.14, .25); ankle.position.set(0, -2.48, .02); group.add(ankle);
    group.userData.kinematics = { thigh, knee, shin, ankle };
    return group;
  };
  const footModule = (side) => {
    const group = module(side < 0 ? "LEFT_FOOT" : "RIGHT_FOOT", side < 0 ? "LEFT MECHANICAL FOOT" : "RIGHT MECHANICAL FOOT", new THREE.Vector3(side * .41, -2.44, .12), new THREE.Vector3(side * .34, -.09, .22), 5.8);
    group.add(box(.42, .18, .73, shellLight, new THREE.Vector3(0, -.05, .12)));
    group.add(box(.3, .11, .4, carbon, new THREE.Vector3(0, .04, .27)));
    group.add(cyl(.065, .065, .44, jointMat, new THREE.Vector3(side * .18, -.05, .08), new THREE.Euler(0, 0, Math.PI / 2)));
    group.add(box(.44, .06, .79, rubber, new THREE.Vector3(0, -.16, .13)));
    return group;
  };

  const head = module("HEAD", "HEAD MODULE", new THREE.Vector3(0, 3.28, .02), new THREE.Vector3(0, .62, .06), 5.6);
  const skull = mesh(new THREE.SphereGeometry(.43, 20, 16), shellLight); skull.scale.set(.9, 1.14, .88); head.add(skull);
  head.add(box(.58, .29, .14, carbon, new THREE.Vector3(0, -.06, .38)));
  [-.18, .18].forEach((x) => head.add(mesh(new THREE.SphereGeometry(.072, 12, 10), accent, new THREE.Vector3(x, .02, .47))));
  head.add(box(.18, .09, .06, jointMat, new THREE.Vector3(0, -.22, .46)));
  [-1, 1].forEach((side) => { const ear = joint(.16, .12); ear.rotation.y = Math.PI / 2; ear.position.set(side * .43, .04, 0); head.add(ear); });
  boltRing(head, .3, .41);

  const neck = module("NECK", "NECK & HEAD JOINT", new THREE.Vector3(0, 2.72, 0), new THREE.Vector3(0, .25, 0), 5.4);
  neck.add(cyl(.17, .2, .35, jointMat, new THREE.Vector3())); neck.add(mesh(new THREE.TorusGeometry(.2, .03, 8, 20), accent, new THREE.Vector3(0, .15, 0)));
  const torso = module("TORSO", "UPPER TORSO MODULE", new THREE.Vector3(0, 1.88, 0), new THREE.Vector3(0, .12, .08), 7.3);
  torso.add(box(1.4, .86, .54, shellLight, new THREE.Vector3(0, 0, 0)));
  torso.add(box(.82, .64, .12, carbon, new THREE.Vector3(0, -.01, .34)));
  torso.add(box(.12, .52, .07, accent, new THREE.Vector3(0, .02, .42)));
  [-.57, .57].forEach((x) => { torso.add(box(.2, .72, .57, shell, new THREE.Vector3(x, 0, -.01))); boltRing(torso, .23, .31); });
  const abdomen = module("ABDOMEN", "CHEST / ABDOMEN MODULE", new THREE.Vector3(0, .98, 0), new THREE.Vector3(0, -.08, .06), 6.7);
  abdomen.add(cyl(.43, .51, .62, carbon, new THREE.Vector3())); abdomen.add(box(.5, .36, .11, shell, new THREE.Vector3(0, 0, .42))); abdomen.add(cyl(.06, .06, .5, accent, new THREE.Vector3(.31, 0, .3)));
  const pelvis = module("PELVIS", "HIP / PELVIS MODULE", new THREE.Vector3(0, .28, 0), new THREE.Vector3(0, -.18, .02), 6.5);
  pelvis.add(box(1.05, .43, .52, shellLight, new THREE.Vector3())); pelvis.add(box(.66, .2, .1, carbon, new THREE.Vector3(0, .05, .32))); [-.4, .4].forEach((x) => { const hip = joint(.2, .32); hip.position.set(x, -.18, 0); pelvis.add(hip); });

  armModule(-1); armModule(1); handModule(-1); handModule(1); legModule(-1); legModule(1); footModule(-1); footModule(1);
  const spineCable = new THREE.CatmullRomCurve3([new THREE.Vector3(-.28, 2.3, -.32), new THREE.Vector3(-.4, 1.25, -.45), new THREE.Vector3(-.24, .38, -.34)]);
  root.add(mesh(new THREE.TubeGeometry(spineCable, 18, .026, 6, false), accent));
  const plinth = mesh(new THREE.CylinderGeometry(1.55, 1.75, .08, 48), new THREE.MeshStandardMaterial({ color: 0x101b22, metalness:.6, roughness:.34 }), new THREE.Vector3(0, -2.69, .1)); root.add(plinth);

  Object.values(modules).forEach((part) => part.traverse((child) => {
    if (child.isMesh) { child.userData.partKey = part.userData.key; pickables.push(child); }
  }));
  root.userData = { modules, pickables };
  root.scale.setScalar(1.06);
  return root;
}

function initializeThree() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0f18, 0.05);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0.35, 12.4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(sceneViewport.clientWidth, sceneViewport.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-label", "Interactive Three.js robot scene");
  sceneViewport.prepend(renderer.domElement);

  const hemisphere = new THREE.HemisphereLight(0xbfe8ff, 0x10161d, 1.65);
  scene.add(hemisphere);

  const keyLight = new THREE.DirectionalLight(0xe0f5ff, 2.3);
  keyLight.position.set(-3, 5, 5);
  scene.add(keyLight);

  const cyanGlow = new THREE.PointLight(0x65e4ff, 18, 12, 2);
  cyanGlow.position.set(2.5, 1.4, 3.5);
  scene.add(cyanGlow);

  const grid = new THREE.GridHelper(14, 30, 0x3a8290, 0x2f3d4b);
  grid.position.y = -2.75;
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  scene.add(grid);

  const robot = createHumanoidRobot();
  scene.add(robot);

  const createHandCursor = (color) => {
    const cursor = new THREE.Group();
    const glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.1, metalness: .35, roughness: .24 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.115, .012, 8, 20), glow);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.027, 10, 8), glow);
    cursor.add(ring, dot);
    cursor.visible = false;
    scene.add(cursor);
    return cursor;
  };

  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.robot = robot;
  state.robotModules = robot.userData.modules;

  resizeThree();
  ui.sceneLoading.hidden = true;
  ui.interactionState.textContent = "MIRROR READY";
  if (!state.animationStarted) {
    state.animationStarted = true;
    requestAnimationFrame(animate);
  }
}

function resizeThree() {
  if (!state.renderer || !state.camera) return;
  const width = sceneViewport.clientWidth;
  const height = sceneViewport.clientHeight;
  if (!width || !height) return;
  state.renderer.setSize(width, height, false);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  sizeLandmarkCanvas();
}

function animateRobot(now) {
  if (!state.robot) return;
  Object.values(state.robotModules).forEach((part) => {
    const pose = part.userData.poseRotation || new THREE.Euler();
    part.position.lerp(part.userData.base, 0.08);
    part.rotation.x += (pose.x - part.rotation.x) * .12;
    part.rotation.y += (pose.y - part.rotation.y) * .12;
    part.rotation.z += (pose.z - part.rotation.z) * .12;
  });
}

function animate() {
  requestAnimationFrame(animate);
  if (!state.renderer || !state.scene || !state.camera) return;
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
  state.cameraFocus.lerp(state.cameraFocusTarget, 0.08);
  state.cameraRadius += (state.cameraRadiusTarget - state.cameraRadius) * 0.075;
  state.cameraPitch = THREE.MathUtils.clamp(state.cameraPitch, -0.55, 0.5);
  const cosPitch = Math.cos(state.cameraPitch);
  state.camera.position.set(
    state.cameraFocus.x + Math.sin(state.cameraYaw) * cosPitch * state.cameraRadius,
    state.cameraFocus.y + Math.sin(state.cameraPitch) * state.cameraRadius,
    state.cameraFocus.z + Math.cos(state.cameraYaw) * cosPitch * state.cameraRadius,
  );
  state.camera.lookAt(state.cameraFocus);
  if (state.renderer) state.renderer.render(state.scene, state.camera);
  ui.sceneCoords.textContent = state.motionActive ? "LIVE BODY → ROBOT" : "AWAITING BODY POSE";
}

async function initializeHandTracking() {
  if (state.motionTrackingReady) return;
  try {
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm");
    state.poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", delegate: "GPU" },
      runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: .55, minPosePresenceConfidence: .5, minTrackingConfidence: .5,
    });
    state.motionTrackingReady = true;
    // Hand and face details improve the mirror but never block the initial body pose.
    vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }).then((tracker) => { state.handLandmarker = tracker; }).catch((error) => console.warn("Hand detail tracking unavailable:", error));
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "GPU" },
      runningMode: "VIDEO", numFaces: 1, minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5,
    }).then((tracker) => { state.faceLandmarker = tracker; }).catch((error) => console.warn("Face detail tracking unavailable:", error));
  } catch (error) {
    console.error("Motion tracking failed to initialize:", error);
    throw new Error("motion-tracking");
  }
}

function processVideoFrame() {
  if (!state.active || !state.cameraEnabled || !state.poseLandmarker || !video) return;
  try {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      const now = performance.now();
      const poseResult = state.poseLandmarker.detectForVideo(video, now);
      const handResult = state.handLandmarker?.detectForVideo(video, now) || { landmarks: [], handedness: [] };
      const faceResult = state.faceLandmarker?.detectForVideo(video, now);
      const pose = smoothLandmarkSet(poseResult.landmarks?.[0], "pose");
      const hands = (handResult.landmarks || []).map((landmarks, index) => ({
        key: handResult.handedness?.[index]?.[0]?.categoryName || "Right",
        landmarks: smoothLandmarkSet(landmarks, `hand-${index}`),
      }));
      const face = smoothLandmarkSet(faceResult?.faceLandmarks?.[0], "face");
      drawPoseOverlay(pose, hands.map((hand) => hand.landmarks));
      updateMotionUi(pose);
      state.motionActive = Boolean(pose);
      if (pose) {
        applyHumanMotion(pose, hands, face);
        ui.trackingStatus.textContent = "ACTIVE";
        ui.footerStatus.textContent = "ACTIVE";
      } else {
        ui.trackingStatus.textContent = "STANDBY";
        ui.footerStatus.textContent = "ACTIVE";
      }
    }
  } catch (error) {
    console.error("Motion tracking frame failed:", error);
    ui.trackingStatus.textContent = "ERROR";
    ui.footerStatus.textContent = "POSE TRACKING ERROR";
    setSceneError("Body tracking encountered an error. Reload the page and try again.");
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

    state.active = true;
    state.cameraEnabled = true;
    ui.cameraTag.textContent = "LIVE INPUT";
    ui.cameraState.textContent = "CAMERA LIVE";
    ui.trackingStatus.textContent = "ACTIVE";
    ui.footerStatus.textContent = "ACTIVE";
    ui.handStatus.textContent = "BODY NOT DETECTED";
    startScreen.classList.add("dismissed");
    updateCameraToggle();
    if (state.motionTrackingReady) {
      requestAnimationFrame(processVideoFrame);
    } else {
      ui.trackingStatus.textContent = "LOADING POSE";
      ui.footerStatus.textContent = "LOADING POSE MODEL";
      initializeHandTracking().then(() => {
        if (state.active) requestAnimationFrame(processVideoFrame);
      }).catch((trackingError) => {
        console.error("Motion tracker failed:", trackingError);
        ui.trackingStatus.textContent = "UNAVAILABLE";
        ui.footerStatus.textContent = "POSE MODEL UNAVAILABLE";
        setSceneError("Camera is live, but the pose model could not load. Check your internet connection and reload.");
      });
    }
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
  ui.handStatus.textContent = "BODY NOT DETECTED";
  ui.handIcon.textContent = "○";
  ui.handIcon.closest(".tracking-state").classList.remove("active");
  ui.trackingStatus.textContent = "OFFLINE";
  ui.footerStatus.textContent = "CAMERA OFF";
  ui.gestureName.textContent = "WAITING";
  ui.gestureCardName.textContent = "AWAITING SUBJECT";
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

sceneViewport.addEventListener("pointerdown", (event) => {
  state.pointerDown = true; state.pointerX = event.clientX; state.pointerY = event.clientY;
  sceneViewport.setPointerCapture?.(event.pointerId);
});
sceneViewport.addEventListener("pointermove", (event) => {
  if (!state.pointerDown) return;
  const dx = event.clientX - state.pointerX; const dy = event.clientY - state.pointerY;
  state.cameraYaw -= dx * .009; state.cameraPitch += dy * .006;
  state.pointerX = event.clientX; state.pointerY = event.clientY;
});
sceneViewport.addEventListener("pointerup", (event) => {
  state.pointerDown = false;
});
sceneViewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  state.cameraRadiusTarget = THREE.MathUtils.clamp(state.cameraRadiusTarget + event.deltaY * .009, 4.3, 15);
}, { passive: false });

updateCameraToggle();
sizeLandmarkCanvas();
ui.handStatus.textContent = "NOT DETECTED";
ui.cameraTag.textContent = "STANDBY";
ui.cameraState.textContent = "INPUT STANDBY";
ui.footerStatus.textContent = "NOT INITIALIZED";
initializeThree();
// The spatial canvas is useful before camera permission is granted; camera can be enabled from its panel.
startScreen.classList.add("dismissed");
