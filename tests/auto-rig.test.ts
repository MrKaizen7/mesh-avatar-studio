import { describe, expect, it } from 'vitest';
import { parseRig, validateRig } from 'mesh-avatar';
import fixture from '../samples/miko-qipao/rig.json';
import {
  applyPoseSkeletonToRig,
  buildAnimeAutoRigDraft,
  buildAutoRigDraft,
  buildPoseSkeleton,
  completeAutoRigDraft,
  selectFaceForHeadGuide,
} from '../src/editor/auto-rig';

function landmarks() {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const oval = [
    [10, 0.5, 0.2], [338, 0.65, 0.22], [297, 0.72, 0.32], [332, 0.75, 0.42],
    [284, 0.76, 0.55], [251, 0.73, 0.68], [389, 0.68, 0.78], [356, 0.6, 0.88],
    [454, 0.52, 0.91], [323, 0.45, 0.9], [361, 0.38, 0.88], [288, 0.32, 0.8],
    [397, 0.27, 0.7], [365, 0.24, 0.58], [379, 0.23, 0.48], [378, 0.24, 0.38],
    [400, 0.28, 0.3], [377, 0.35, 0.24], [152, 0.5, 0.9], [148, 0.4, 0.88],
    [176, 0.35, 0.82], [149, 0.3, 0.75], [150, 0.28, 0.7], [136, 0.27, 0.65],
    [172, 0.25, 0.6], [58, 0.24, 0.55], [132, 0.25, 0.45], [93, 0.27, 0.35],
    [234, 0.28, 0.3], [127, 0.32, 0.26], [162, 0.38, 0.22], [21, 0.43, 0.21],
    [54, 0.46, 0.2], [103, 0.48, 0.2], [67, 0.49, 0.2], [109, 0.5, 0.2],
  ] as const;
  for (const [index, x, y] of oval) points[index] = { x, y };
  const eyeA = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
  const eyeB = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
  for (const [contour, center] of [[eyeA, 0.4], [eyeB, 0.6]] as const) {
    contour.forEach((index, position) => {
      const angle = position * 2 * Math.PI / contour.length;
      points[index] = {
        x: center + Math.cos(angle) * 0.06,
        y: 0.43 + Math.sin(angle) * 0.025,
      };
    });
  }
  points[61] = { x: 0.44, y: 0.62 };
  points[291] = { x: 0.56, y: 0.62 };
  points[0] = { x: 0.5, y: 0.61 };
  points[17] = { x: 0.5, y: 0.65 };
  points[13] = { x: 0.5, y: 0.61 };
  points[14] = { x: 0.5, y: 0.64 };
  points[205] = { x: 0.38, y: 0.58 };
  points[425] = { x: 0.62, y: 0.58 };
  return points;
}

function animeDetection() {
  return {
    bbox: [30, 15, 70, 85, 0.99] as [number, number, number, number, number],
    keypoints: [
      [32, 50, 0.9], [40, 68, 0.9], [50, 78, 0.9], [61, 68, 0.9], [68, 48, 0.9],
      [39, 40, 0.9], [44, 39, 0.9], [48, 38, 0.9], [54, 37, 0.9], [59, 36, 0.9], [63, 35, 0.9],
      [39, 49, 0.9], [44, 48, 0.9], [48, 47, 0.9], [39, 51, 0.9], [44, 50, 0.9], [48, 49, 0.9],
      [53, 45, 0.9], [58, 44, 0.9], [63, 43, 0.9], [53, 47, 0.9], [58, 46, 0.9], [63, 45, 0.9],
      [52, 57, 0.9], [45, 64, 0.9], [51, 62, 0.9], [57, 63, 0.9], [51, 67, 0.9],
    ] as [number, number, number][],
  };
}

describe('automatic face rigging', () => {
  it('maps face landmarks into a Studio rig draft that passes validation', () => {
    const { rig, faceBounds } = buildAutoRigDraft(1000, 1000, landmarks());
    expect(validateRig(rig, { draft: true })).toEqual([]);
    expect(rig.eyes).toHaveLength(2);
    expect(rig.eyes[0].opening.length).toBeGreaterThan(3);
    expect(rig.eyes[1].opening.length).toBeGreaterThan(3);
    expect(rig.face.eyeA.cx).toBeLessThan(rig.face.eyeB.cx);
    expect(faceBounds.left).toBeLessThan(faceBounds.right);
    expect(rig.strands).toEqual([]);
  });

  it('rejects invalid image dimensions and missing landmarks', () => {
    expect(() => buildAutoRigDraft(0, 100, landmarks())).toThrow(/dimensions/);
    expect(() => buildAutoRigDraft(100, 100, [])).toThrow(/landmark/);
  });

  it('maps anime face landmarks into a valid Studio rig draft', () => {
    const { rig, faceBounds, lowConfidenceLandmarks } = buildAnimeAutoRigDraft(100, 100, animeDetection());
    expect(validateRig(rig, { draft: true })).toEqual([]);
    expect(rig.eyes).toHaveLength(2);
    expect(rig.face.eyeA.cx).toBeLessThan(rig.face.eyeB.cx);
    expect(faceBounds.left).toBe(30);
    expect(lowConfidenceLandmarks).toBe(false);
  });

  it('completes an auto-rig draft with runtime eye curves and keeps authored optional rigs', () => {
    const current = parseRig(fixture);
    const { rig: draft } = buildAnimeAutoRigDraft(current.image.width, current.image.height, animeDetection());
    const completed = completeAutoRigDraft(draft, current);

    expect(validateRig(completed)).toEqual([]);
    expect(completed.eyes).toHaveLength(2);
    expect(completed.eyes[0].top).toHaveLength(24);
    expect(completed.eyes[0].bot).toHaveLength(24);
    expect(completed.strands).toEqual(current.strands);
    expect(completed.accessories).toEqual(current.accessories);
    expect(completed.hand).toEqual(current.hand);
  });

  it('completes a new-image draft without carrying optional rigs from another avatar', () => {
    const { rig: draft } = buildAnimeAutoRigDraft(100, 100, animeDetection());
    const completed = completeAutoRigDraft(draft);

    expect(validateRig(completed)).toEqual([]);
    expect(completed.eyes[0].top).toHaveLength(24);
    expect(completed.strands).toBeUndefined();
    expect(completed.accessories).toBeUndefined();
    expect(completed.hand).toBeUndefined();
  });

  it('selects the detected face closest in position and size to the current head guide', () => {
    const head = { ...parseRig(fixture).head, cx: 520, cy: 340, rx: 100, ry: 120 };
    const faces = [
      { left: 80, top: 70, right: 240, bottom: 260 },
      { left: 430, top: 190, right: 590, bottom: 460 },
    ];
    expect(selectFaceForHeadGuide(faces, head)).toBe(1);
    expect(selectFaceForHeadGuide([faces[0]], head)).toBe(0);
  });

  it('rejects incomplete anime face landmarks', () => {
    const detection = animeDetection();
    detection.keypoints.pop();
    expect(() => buildAnimeAutoRigDraft(100, 100, detection)).toThrow(/28 landmarks/);
  });

  it('maps full-body pose landmarks into a validated skeleton and torso estimate', () => {
    const pose = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      visibility: 0.95,
    }));
    pose[11] = { x: 0.38, y: 0.35, visibility: 0.95 };
    pose[12] = { x: 0.62, y: 0.35, visibility: 0.95 };
    pose[23] = { x: 0.43, y: 0.58, visibility: 0.95 };
    pose[24] = { x: 0.57, y: 0.58, visibility: 0.95 };
    const { rig } = buildAnimeAutoRigDraft(100, 200, animeDetection());
    const originalRegions = rig.softBody!.regions.map(region => ({ ...region }));
    const skeleton = buildPoseSkeleton(pose, 100, 200);

    expect(applyPoseSkeletonToRig(rig, skeleton)).toBe(true);
    expect(validateRig(rig, { draft: true })).toEqual([]);
    expect(rig.skeleton?.joints).toHaveLength(33);
    expect(rig.skeleton?.bones.length).toBeGreaterThan(20);
    expect(rig.body.pivotX).toBe(50);
    expect(rig.body.pivotY).toBeCloseTo(116);
    expect(rig.softBody?.regions).not.toEqual(originalRegions);
  });

  it('rejects incomplete or low-confidence pose data without fabricating torso landmarks', () => {
    expect(() => buildPoseSkeleton([], 100, 100)).toThrow(/33 landmarks/);
    const pose = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      visibility: 0.95,
    }));
    const { rig } = buildAnimeAutoRigDraft(100, 100, animeDetection());
    const originalChest = { ...rig.body.chest };
    const skeleton = buildPoseSkeleton(pose, 100, 100);
    skeleton.joints.find(joint => joint.name === 'leftShoulder')!.visibility = 0.1;

    expect(applyPoseSkeletonToRig(rig, skeleton)).toBe(false);
    expect(rig.body.chest).toEqual(originalChest);
    expect(rig.skeleton).toBe(skeleton);
  });
});
