import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Rig, Point, Ellipse, Eye, Skeleton } from 'mesh-avatar';

type Landmark = { x: number; y: number; visibility?: number; presence?: number };
type FaceBounds = { left: number; right: number; top: number; bottom: number };
export type AutoRigDraft = Omit<Rig, 'eyes'> & {
  eyes: { opening: Point[]; roi: Point[] }[];
};
type AutoRigResult = {
  rig: AutoRigDraft;
  detectedFaceCount: number;
  selectedFace: number;
  faceBounds: FaceBounds;
  detectorUsed: 'anime_face_detector' | 'mediapipe';
  warnings: string[];
  poseDetected: boolean;
  skeletonJointCount: number;
};
export type AutoRigStage = 'loadingModel' | 'detectingFace' | 'detectingPose';
export type AnimeFaceDetection = {
  bbox: [number, number, number, number, number];
  keypoints: [number, number, number][];
};

const EYE_CURVE_SAMPLES = 24;
const MAX_INFERENCE_DIMENSION = 1024;
const POSE_JOINT_NAMES = [
  'nose', 'leftEyeInner', 'leftEye', 'leftEyeOuter', 'rightEyeInner', 'rightEye',
  'rightEyeOuter', 'leftEar', 'rightEar', 'mouthLeft', 'mouthRight',
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist',
  'rightWrist', 'leftPinky', 'rightPinky', 'leftIndex', 'rightIndex',
  'leftThumb', 'rightThumb', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee',
  'leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftFootIndex', 'rightFootIndex',
];
const POSE_BONES = [
  ['nose', 'leftEyeInner'], ['leftEyeInner', 'leftEye'], ['leftEye', 'leftEyeOuter'],
  ['leftEyeOuter', 'leftEar'], ['nose', 'rightEyeInner'], ['rightEyeInner', 'rightEye'],
  ['rightEye', 'rightEyeOuter'], ['rightEyeOuter', 'rightEar'], ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'], ['leftWrist', 'leftPinky'],
  ['leftWrist', 'leftIndex'], ['leftWrist', 'leftThumb'], ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'], ['rightWrist', 'rightPinky'], ['rightWrist', 'rightIndex'],
  ['rightWrist', 'rightThumb'], ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'], ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['leftAnkle', 'leftHeel'], ['leftHeel', 'leftFootIndex'], ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'], ['rightAnkle', 'rightHeel'], ['rightHeel', 'rightFootIndex'],
] as const;

const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];
const EYE_CONTOURS = [
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
];
const BROW_POINTS = [
  70, 63, 105, 66, 107, 55, 65, 336, 296, 334, 293, 300, 285, 295,
];
const JAW_POINTS = [234, 127, 162, 21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 454, 152, 176, 148];
const MOUTH_POINTS = [61, 291, 0, 17, 13, 14];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toPoint(landmarks: Landmark[], index: number, width: number, height: number): Point {
  const point = landmarks[index];
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`Face detector did not return landmark ${index}.`);
  }
  return [clamp(point.x, 0, 1) * width, clamp(point.y, 0, 1) * height];
}

function bounds(points: Point[]): FaceBounds {
  return {
    left: Math.min(...points.map(([x]) => x)),
    right: Math.max(...points.map(([x]) => x)),
    top: Math.min(...points.map(([, y]) => y)),
    bottom: Math.max(...points.map(([, y]) => y)),
  };
}
export function selectFaceForHeadGuide(faces: FaceBounds[], head: Rig['head']): number {
  if (!faces.length) throw new Error('At least one detected face is required.');
  const guideWidth = Math.max(1, head.rx * 2), guideHeight = Math.max(1, head.ry * 2);
  const score = (face: FaceBounds) => {
    const centerX = (face.left + face.right) / 2;
    const centerY = (face.top + face.bottom) / 2;
    const width = Math.max(1, face.right - face.left);
    const dx = (centerX - head.cx) / guideWidth;
    const dy = (centerY - head.cy) / guideHeight;
    const sizeDifference = Math.log(width / guideWidth);
    return dx * dx + dy * dy + 0.25 * sizeDifference * sizeDifference;
  };
  return faces.reduce((best, face, index) => score(face) < score(faces[best]) ? index : best, 0);
}

function ellipse(points: Point[], paddingX = 1, paddingY = paddingX): Ellipse {
  const box = bounds(points);
  return {
    cx: (box.left + box.right) / 2,
    cy: (box.top + box.bottom) / 2,
    rx: Math.max(1, (box.right - box.left) / 2 * paddingX),
    ry: Math.max(1, (box.bottom - box.top) / 2 * paddingY),
  };
}

function paddedLoop(points: Point[], scale = 1.35): Point[] {
  const box = bounds(points);
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const rx = Math.max(2, (box.right - box.left) / 2 * scale);
  const ry = Math.max(2, (box.bottom - box.top) / 2 * scale);
  return Array.from({ length: 16 }, (_, index) => {
    const angle = index * 2 * Math.PI / 16;
    return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry] as Point;
  });
}

function faceBox(landmarks: Landmark[], width: number, height: number) {
  return bounds(FACE_OVAL.map(index => toPoint(landmarks, index, width, height)));
}

function eyeCurves(opening: Point[]): Pick<Eye, 'x0' | 'x1' | 'top' | 'bot'> {
  const xs = opening.map(([x]) => x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 >= x1) throw new Error('Detected eye opening must have positive width.');
  const top: number[] = [], bot: number[] = [];
  for (let i = 0; i < EYE_CURVE_SAMPLES; i++) {
    const x = x0 + (x1 - x0) * Math.min(Math.max(i / (EYE_CURVE_SAMPLES - 1), 0.002), 0.998);
    const crossings: number[] = [];
    for (let j = 0; j < opening.length; j++) {
      const [ax, ay] = opening[j], [bx, by] = opening[(j + 1) % opening.length];
      if ((ax - x) * (bx - x) <= 0 && ax !== bx) crossings.push(ay + (by - ay) * (x - ax) / (bx - ax));
    }
    if (crossings.length < 2) throw new Error('Detected eye opening does not span every sampled column.');
    top.push(Math.round(Math.min(...crossings) * 100) / 100);
    bot.push(Math.round(Math.max(...crossings) * 100) / 100);
  }
  for (const index of [0, EYE_CURVE_SAMPLES - 1]) {
    top[index] = bot[index] = Math.round((top[index] + bot[index]) / 2 * 100) / 100;
  }
  return { x0, x1, top, bot };
}

export function completeAutoRigDraft(draft: AutoRigDraft, current?: Rig): Rig {
  const eyes: Eye[] = draft.eyes.map(eye => ({ ...eye, ...eyeCurves(eye.opening) }));
  return {
    ...draft,
    eyes,
    buns: current?.buns,
    strands: current?.strands,
    accessories: current?.accessories,
    hand: current?.hand,
    guides: current?.guides,
  };
}

export function buildPoseSkeleton(
  landmarks: Landmark[],
  width: number,
  height: number,
): Skeleton {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Source image dimensions must be positive integers.');
  }
  if (landmarks.length !== POSE_JOINT_NAMES.length) {
    throw new Error(`Pose detector must return exactly ${POSE_JOINT_NAMES.length} landmarks.`);
  }
  const joints = landmarks.map((landmark, index) => {
    if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
      throw new Error(`Pose detector returned invalid landmark ${index}.`);
    }
    const visibility = landmark.visibility ?? landmark.presence;
    if (visibility === undefined || !Number.isFinite(visibility)) {
      throw new Error(`Pose detector returned no confidence for landmark ${index}.`);
    }
    return {
      name: POSE_JOINT_NAMES[index],
      position: [
        clamp(landmark.x, 0, 1) * width,
        clamp(landmark.y, 0, 1) * height,
      ] as Point,
      visibility: clamp(visibility, 0, 1),
    };
  });
  return {
    joints,
    bones: POSE_BONES.map(([from, to]) => ({ from, to })),
  };
}

export function applyPoseSkeletonToRig(rig: AutoRigDraft, skeleton: Skeleton): boolean {
  rig.skeleton = skeleton;
  const joints = new Map(skeleton.joints.map(joint => [joint.name, joint]));
  const leftShoulder = joints.get('leftShoulder')!;
  const rightShoulder = joints.get('rightShoulder')!;
  const leftHip = joints.get('leftHip')!;
  const rightHip = joints.get('rightHip')!;
  if ([leftShoulder, rightShoulder, leftHip, rightHip].some(joint => joint.visibility < 0.35)) {
    return false;
  }
  const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const shoulderCenter = midpoint(leftShoulder.position, rightShoulder.position);
  const hipCenter = midpoint(leftHip.position, rightHip.position);
  const shoulderWidth = Math.max(1, Math.hypot(
    rightShoulder.position[0] - leftShoulder.position[0],
    rightShoulder.position[1] - leftShoulder.position[1],
  ));
  const torsoLength = Math.max(1, Math.hypot(
    hipCenter[0] - shoulderCenter[0],
    hipCenter[1] - shoulderCenter[1],
  ));
  const chestCenter: Point = [
    shoulderCenter[0] + (hipCenter[0] - shoulderCenter[0]) * 0.42,
    shoulderCenter[1] + (hipCenter[1] - shoulderCenter[1]) * 0.42,
  ];
  const band = (a: number, b: number): [number, number] => {
    const start = clamp(Math.min(a, b), 0, rig.image.height - 1);
    const end = clamp(Math.max(a, b), start + 1, rig.image.height);
    return [start, end];
  };
  rig.body.pivotX = hipCenter[0];
  rig.body.pivotY = hipCenter[1];
  rig.body.breathBand = band(shoulderCenter[1], hipCenter[1]);
  rig.body.rollBand = [...rig.body.breathBand];
  rig.body.chest = {
    cx: chestCenter[0],
    cy: chestCenter[1],
    rx: Math.max(8, shoulderWidth * 0.48),
    ry: Math.max(8, torsoLength * 0.28),
  };
  rig.body.shoulders = [leftShoulder, rightShoulder].map(joint => ({
    cx: joint.position[0],
    cy: joint.position[1],
    rx: Math.max(5, shoulderWidth * 0.2),
    ry: Math.max(5, torsoLength * 0.13),
  }));
  if (rig.softBody) {
    rig.softBody.regions = [-1, 1].map(side => ({
      cx: chestCenter[0] + side * rig.body.chest.rx * 0.38,
      cy: chestCenter[1] - rig.body.chest.ry * 0.12,
      rx: rig.body.chest.rx * 0.34,
      ry: rig.body.chest.ry * 0.42,
    }));
  }
  return true;
}

async function inferPoseFromCanvas(
  image: HTMLCanvasElement,
  width: number,
  height: number,
): Promise<Skeleton | undefined> {
  const files = await FilesetResolver.forVisionTasks('/mediapipe');
  let landmarker: PoseLandmarker | undefined;
  try {
    const options = {
      runningMode: 'IMAGE',
      numPoses: 1,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
    } as const;
    try {
      landmarker = await PoseLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: { modelAssetPath: '/mediapipe/pose_landmarker_lite.task', delegate: 'GPU' },
      });
    } catch {
      landmarker = await PoseLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: { modelAssetPath: '/mediapipe/pose_landmarker_lite.task', delegate: 'CPU' },
      });
    }
    const result = landmarker.detect(image);
    return result.landmarks[0]
      ? buildPoseSkeleton(result.landmarks[0], width, height)
      : undefined;
  } finally {
    landmarker?.close();
  }
}

export async function detectBodyPose(sourceUrl: string): Promise<Skeleton | undefined> {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Could not load the source image for pose detection (HTTP ${response.status}).`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const inferenceScale = Math.min(1, MAX_INFERENCE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const image = document.createElement('canvas');
    image.width = Math.max(1, Math.round(bitmap.width * inferenceScale));
    image.height = Math.max(1, Math.round(bitmap.height * inferenceScale));
    const context = image.getContext('2d');
    if (!context) throw new Error('Could not prepare the source image for pose inference.');
    context.drawImage(bitmap, 0, 0, image.width, image.height);
    return await inferPoseFromCanvas(image, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

export function buildAutoRigDraft(
  width: number,
  height: number,
  landmarks: Landmark[],
): { rig: AutoRigDraft; faceBounds: FaceBounds } {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Source image dimensions must be positive integers.');
  }
  const face = faceBox(landmarks, width, height);
  const chin = toPoint(landmarks, 152, width, height);
  const eyePolygons = EYE_CONTOURS.map(contour =>
    contour.map(index => toPoint(landmarks, index, width, height)),
  );
  const nosePoints = [1, 2, 98, 327, 168, 6].map(index => toPoint(landmarks, index, width, height));
  const mouthPoints = MOUTH_POINTS.map(index => toPoint(landmarks, index, width, height));
  const browPoints = BROW_POINTS.map(index => toPoint(landmarks, index, width, height));
  const jawPoints = JAW_POINTS.map(index => toPoint(landmarks, index, width, height));
  const cheeks = [205, 425].map(index => toPoint(landmarks, index, width, height));
  return buildRigDraftFromFeatures({
    width,
    height,
    face,
    chin,
    eyePolygons,
    nose: ellipse(nosePoints, 1.4, 1.3),
    mouthPoints,
    browPoints,
    jawPoints,
    cheeks,
  });
}

function buildRigDraftFromFeatures({
  width,
  height,
  face,
  chin,
  eyePolygons,
  nose,
  mouthPoints,
  browPoints,
  jawPoints,
  cheeks,
}: {
  width: number;
  height: number;
  face: FaceBounds;
  chin: Point;
  eyePolygons: Point[][];
  nose: Ellipse;
  mouthPoints: Point[];
  browPoints: Point[];
  jawPoints: Point[];
  cheeks: Point[];
}): { rig: AutoRigDraft; faceBounds: FaceBounds } {
  const faceWidth = Math.max(1, face.right - face.left);
  const faceHeight = Math.max(1, face.bottom - face.top);
  const centerX = (face.left + face.right) / 2;
  eyePolygons.sort((a, b) => bounds(a).left - bounds(b).left);
  const eyeRegions = eyePolygons.map(points => paddedLoop(points));
  const eyeEllipses = eyePolygons.map(points => ellipse(points, 1.5, 2));
  const mouthBox = bounds(mouthPoints);
  const leftCorner = mouthPoints.reduce((left, point) => point[0] < left[0] ? point : left);
  const rightCorner = mouthPoints.reduce((right, point) => point[0] > right[0] ? point : right);
  const mouthCenter: Point = [(leftCorner[0] + rightCorner[0]) / 2, (leftCorner[1] + rightCorner[1]) / 2];
  const browBox = bounds(browPoints);
  const jaw = ellipse(jawPoints, 1, 1.05);
  const jawBand = [Math.max(0, chin[1] - faceHeight * 0.45), Math.min(height, chin[1] + faceHeight * 0.1)] as [number, number];
  const headRy = faceHeight * 0.78;
  const head = {
    cx: centerX,
    cy: face.top + faceHeight * 0.48,
    rx: faceWidth * 0.66,
    ry: headRy,
    shiftX: 0,
    shiftY: 0,
    pivotX: centerX,
    pivotY: chin[1],
    maxRoll: 0.12,
    weightBand: [Math.min(height - 1, chin[1]), height] as [number, number],
    turnBand: [
      Math.max(0, face.top + faceHeight * 0.55),
      Math.min(height, chin[1] + 1),
    ] as [number, number],
  };
  const shoulderY = Math.min(height - 1, chin[1] + faceHeight * 0.28);
  const chestY = Math.min(height - 1, chin[1] + faceHeight * 0.82);
  const bandStart = Math.max(0, Math.min(height - 1, shoulderY));
  const fine = {
    x0: Math.floor(clamp(face.left - faceWidth * 0.3, 0, width - 1)),
    x1: Math.ceil(clamp(face.right + faceWidth * 0.3, 1, width)),
    y0: Math.floor(clamp(face.top - faceHeight * 0.4, 0, height - 1)),
    y1: Math.ceil(clamp(chin[1] + faceHeight * 0.35, 1, height)),
    cell: 3,
  };
  if (fine.x0 >= fine.x1) fine.x1 = Math.min(width, fine.x0 + 1);
  if (fine.y0 >= fine.y1) fine.y1 = Math.min(height, fine.y0 + 1);

  const rig: AutoRigDraft = {
    version: 1 as const,
    image: { width, height },
    head,
    body: {
      pivotX: centerX,
      pivotY: height,
      maxRoll: 0.012,
      breathBand: [bandStart, height],
      rollBand: [bandStart, height],
      chest: {
        cx: centerX,
        cy: chestY,
        rx: faceWidth * 0.68,
        ry: faceHeight * 0.55,
      },
      shoulders: [-1, 1].map(side => ({
        cx: centerX + side * faceWidth * 0.5,
        cy: shoulderY,
        rx: faceWidth * 0.28,
        ry: faceHeight * 0.18,
      })),
    },
    softBody: {
      regions: [-1, 1].map(side => ({
        cx: centerX + side * faceWidth * 0.25,
        cy: chestY - faceHeight * 0.04,
        rx: faceWidth * 0.2,
        ry: faceHeight * 0.2,
      })),
      gain: 0.65,
      maxOffset: Math.min(18, Math.max(2, faceHeight * 0.035)),
      frequency: 3.5,
      damping: 0.65,
    },
    face: {
      nose,
      mouth: ellipse(mouthPoints, 1.2, 1.25),
      eyeA: eyeEllipses[0],
      eyeB: eyeEllipses[1],
      earL: { cx: face.left, cy: face.top + faceHeight * 0.52, rx: faceWidth * 0.06, ry: faceHeight * 0.12 },
      earR: { cx: face.right, cy: face.top + faceHeight * 0.52, rx: faceWidth * 0.06, ry: faceHeight * 0.12 },
      brow: {
        ...ellipse(browPoints, 1.05, 1.15),
        band: [Math.max(0, browBox.top), Math.min(height, Math.max(browBox.top + 1, browBox.bottom))],
      },
      jaw: { ...jaw, band: jawBand },
    },
    eyes: eyePolygons.map((opening, index) => ({
      opening,
      roi: eyeRegions[index],
    })),
    mouth: {
      cx: mouthCenter[0],
      cy: mouthCenter[1],
      angle: Math.atan2(rightCorner[1] - leftCorner[1], rightCorner[0] - leftCorner[0]),
      halfLen: Math.max(1, Math.hypot(rightCorner[0] - leftCorner[0], rightCorner[1] - leftCorner[1]) / 2),
      bow: 0,
      area: {
        cx: mouthCenter[0],
        cy: mouthCenter[1],
        rx: Math.max(1, (mouthBox.right - mouthBox.left) * 0.65),
        ry: Math.max(1, (mouthBox.bottom - mouthBox.top) * 0.8),
        angle: 0,
      },
    },
    cheeks,
    strands: [],
    mesh: {
      baseCell: 8,
      fine,
      handCell: 5,
      tasselCell: 4,
      eyeBallCell: 2,
      eyeCell: 2,
      spriteCell: 2,
    },
    view: { padTop: 0.08, padSide: 0.08 },
  };

  return { rig, faceBounds: face };
}

export function buildAnimeAutoRigDraft(
  width: number,
  height: number,
  detection: AnimeFaceDetection,
): { rig: AutoRigDraft; faceBounds: FaceBounds; lowConfidenceLandmarks: boolean } {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Source image dimensions must be positive integers.');
  }
  if (!Array.isArray(detection.keypoints) || detection.keypoints.length !== 28) {
    throw new Error('Anime face detector must return exactly 28 landmarks.');
  }
  if (!Number.isFinite(detection.bbox[0]) || !Number.isFinite(detection.bbox[1])
    || !Number.isFinite(detection.bbox[2]) || !Number.isFinite(detection.bbox[3])) {
    throw new Error('Anime face detector returned invalid face bounds.');
  }
  const face = {
    left: clamp(Math.min(detection.bbox[0], detection.bbox[2]), 0, width - 1),
    top: clamp(Math.min(detection.bbox[1], detection.bbox[3]), 0, height - 1),
    right: clamp(Math.max(detection.bbox[0], detection.bbox[2]), 1, width),
    bottom: clamp(Math.max(detection.bbox[1], detection.bbox[3]), 1, height),
  };
  if (face.left >= face.right || face.top >= face.bottom) {
    throw new Error('Anime face detector returned an empty face region.');
  }
  const landmarks = detection.keypoints.map(([x, y, confidence], index) => {
    if (![x, y, confidence].every(Number.isFinite) || confidence < 0) {
      throw new Error(`Anime face detector returned invalid landmark ${index}.`);
    }
    return {
      point: [clamp(x, 0, width - 1), clamp(y, 0, height - 1)] as Point,
      confidence,
    };
  });
  const pointAt = (index: number) => landmarks[index].point;
  const eyePolygons = [
    { top: [11, 12, 13], bottom: [14, 15, 16] },
    { top: [17, 18, 19], bottom: [20, 21, 22] },
  ].map(({ top, bottom }) => [
    ...top.map(pointAt).sort((a, b) => a[0] - b[0]),
    ...bottom.map(pointAt).sort((a, b) => b[0] - a[0]),
  ]);
  const jawPoints = [0, 1, 2, 3, 4].map(pointAt);
  const nosePoint = pointAt(23);
  const mouthPoints = [24, 25, 26, 27].map(pointAt);
  const browPoints = [5, 6, 7, 8, 9, 10].map(pointAt);
  const faceWidth = face.right - face.left;
  const faceHeight = face.bottom - face.top;
  const rigResult = buildRigDraftFromFeatures({
    width,
    height,
    face,
    chin: jawPoints.reduce((lowest, point) => point[1] > lowest[1] ? point : lowest),
    eyePolygons,
    nose: {
      cx: nosePoint[0],
      cy: nosePoint[1],
      rx: Math.max(1, faceWidth * 0.035),
      ry: Math.max(1, faceHeight * 0.04),
    },
    mouthPoints,
    browPoints,
    jawPoints,
    cheeks: [
      jawPoints.reduce((left, point) => point[0] < left[0] ? point : left),
      jawPoints.reduce((right, point) => point[0] > right[0] ? point : right),
    ],
  });
  return {
    ...rigResult,
    lowConfidenceLandmarks: landmarks.some(({ confidence }) => confidence < 0.25),
  };
}

export async function autoRigImage(
  sourceUrl: string,
  faceIndex = 0,
  onProgress?: (stage: AutoRigStage) => void,
  guide?: Pick<Rig, 'head'>,
): Promise<AutoRigResult> {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Could not load the source image (HTTP ${response.status}).`);
  const bitmap = await createImageBitmap(await response.blob());
  onProgress?.('loadingModel');
  const files = await FilesetResolver.forVisionTasks('/mediapipe');
  const options = {
    runningMode: 'IMAGE',
    numFaces: guide ? 5 : 1,
  } as const;
  let landmarker: FaceLandmarker;
  try {
    landmarker = await FaceLandmarker.createFromOptions(files, {
      ...options,
      baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'GPU' },
    });
  } catch {
    landmarker = await FaceLandmarker.createFromOptions(files, {
      ...options,
      baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'CPU' },
    });
  }
  try {
    const inferenceScale = Math.min(1, MAX_INFERENCE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const inferenceImage = document.createElement('canvas');
    inferenceImage.width = Math.max(1, Math.round(bitmap.width * inferenceScale));
    inferenceImage.height = Math.max(1, Math.round(bitmap.height * inferenceScale));
    const context = inferenceImage.getContext('2d');
    if (!context) throw new Error('Could not prepare the source image for face inference.');
    context.drawImage(bitmap, 0, 0, inferenceImage.width, inferenceImage.height);
    onProgress?.('detectingFace');
    if (onProgress) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const result = landmarker.detect(inferenceImage);
    if (!result.faceLandmarks.length) {
      throw new Error('MediaPipe did not detect a face in this image.');
    }
    const faces = result.faceLandmarks
      .map((landmarks, index) => ({
        index,
        landmarks,
        bounds: faceBox(landmarks, bitmap.width, bitmap.height),
      }))
      .sort((a, b) => {
        const areaA = (a.bounds.right - a.bounds.left) * (a.bounds.bottom - a.bounds.top);
        const areaB = (b.bounds.right - b.bounds.left) * (b.bounds.bottom - b.bounds.top);
        return areaB - areaA;
      });
    if (guide) faceIndex = selectFaceForHeadGuide(faces.map(face => face.bounds), guide.head);
    if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= faces.length) {
      throw new Error(`face_index must be between 0 and ${faces.length - 1}.`);
    }
    const selected = faces[faceIndex];
    const { rig, faceBounds } = buildAutoRigDraft(bitmap.width, bitmap.height, selected.landmarks);
    const warnings = [
      'Automatic rigging uses face landmarks and, when detected, estimated full-body pose landmarks. Inspect the pose review before rendering.',
      'Hair strands, buns, accessories, hands, and foreground-object masks are not inferred by this face model.',
      'Soft-body regions are estimated from the chest and should be reviewed or disabled if they do not match the artwork.',
      'The exported skeleton is pose-guide metadata; limb articulation is not yet implemented by the runtime.',
    ];
    if (guide) warnings.push('The current rig head position was used to choose the closest detected face. The generated result is staged separately and will not replace your rig until you apply it.');
    let bodyPoseApplied = false;
    onProgress?.('detectingPose');
    if (onProgress) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const skeleton = await inferPoseFromCanvas(inferenceImage, bitmap.width, bitmap.height);
      if (skeleton) {
        bodyPoseApplied = applyPoseSkeletonToRig(rig, skeleton);
        if (!bodyPoseApplied) {
          warnings.push('A pose was found, but shoulder/hip confidence was too low to replace the estimated torso region.');
        }
      } else {
        warnings.push('MediaPipe Pose Landmarker found no body pose; torso dimensions remain face-derived estimates.');
      }
    } catch (error) {
      warnings.push(`Body pose inference failed; torso dimensions remain face-derived estimates: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (faces.length > 1 && !guide) {
      warnings.push(`${faces.length} faces were detected. The selected face is the largest by default; face_index can select another detected face.`);
    }
    return {
      rig,
      detectedFaceCount: faces.length,
      selectedFace: faceIndex,
      faceBounds,
      detectorUsed: 'mediapipe',
      warnings,
      poseDetected: Boolean(rig.skeleton),
      skeletonJointCount: rig.skeleton?.joints.length ?? 0,
    };
  } finally {
    landmarker.close();
    bitmap.close();
  }
}
