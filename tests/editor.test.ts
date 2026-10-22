import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, validateRig } from 'mesh-avatar';
import { buildOverlay, changeVertex, deleteRigItem, drawRigPart, duplicateRigItem, moveHandle, moveHandles, nearestHandle, getAt, resizeRigToImage, setAt, transformRigCluster } from '../src/editor/model';

const view = { scale: 0.5, x: 20, y: 10 };
test('hit-testing finds the nearest handle within eight screen pixels', () => {
  const handles = buildOverlay(parseRig(fixture)).handles.filter(h => h.id === 'head.center');
  expect(nearestHandle(handles, [615 * 0.5 + 27, 400 * 0.5 + 10], view)?.id).toBe('head.center');
  expect(nearestHandle(handles, [615 * 0.5 + 29, 400 * 0.5 + 10], view)).toBeUndefined();
  const competing = [...handles, { ...handles[0], id: 'nearer', point: [625, 400] as [number, number] }];
  expect(nearestHandle(competing, [625 * 0.5 + 20, 210], view)?.id).toBe('nearer');
});
test('dragging a center updates exactly its coordinates and radius handles preserve the center', () => {
  const rig = parseRig(fixture);
  const handles = buildOverlay(rig).handles;
  const next = moveHandle(rig, handles.find(h => h.id === 'head.center')!, [635, 420]);
  expect(next.head.cx).toBe(635);
  expect(next.head.cy).toBe(420);
  expect(rig.head.cx).toBe(615);
  const wider = moveHandle(rig, handles.find(h => h.id === 'head.rx')!, [1100, 400]);
  expect(wider.head.rx).toBe(485);
  expect(wider.head.cx).toBe(615);
});
test('vertex insertion and deletion preserve polygon and polyline minimum sizes', () => {
  let rig = parseRig(fixture);
  rig = changeVertex(rig, 'eyes.0.opening', 1, [448, 480], true);
  expect(getAt(rig, 'eyes.0.opening.1')).toEqual([448, 480]);
  while (rig.eyes[0].opening.length > 3) rig = changeVertex(rig, 'eyes.0.opening', 0, null, true);
  expect(changeVertex(rig, 'eyes.0.opening', 0, null, true).eyes[0].opening).toHaveLength(3);
  while (rig.strands![0].nodes.length > 2) rig = changeVertex(rig, 'strands.0.nodes', 0, null, false);
  expect(changeVertex(rig, 'strands.0.nodes', 0, null, false).strands![0].nodes).toHaveLength(2);
  expect(validateRig(rig)).toEqual([]);
});

test('manual drawing adds a four-node hair strand to a rig with no strands', () => {
  const rig = parseRig(fixture);
  delete rig.strands;
  const next = drawRigPart(rig, 'strand', [100, 200], [220, 260]);
  expect(next.strands).toHaveLength(1);
  expect(next.strands![0]).toMatchObject({
    name: 'strand-1',
    nodes: [[100, 200], [140, 220], [180, 240], [220, 260]],
    k: 1,
    max: 8,
  });
  expect(validateRig(next)).toEqual([]);
});

test('draws buns and creates safe unique accessory layer names', () => {
  const rig = parseRig(fixture);
  delete rig.buns;
  const bunRig = drawRigPart(rig, 'bunL', [700, 100], [820, 220]);
  expect(bunRig.buns?.bunL).toEqual({ cx: 760, cy: 160, rx: 60, ry: 60 });
  expect(validateRig(bunRig)).toEqual([]);

  const first = drawRigPart(rig, 'accessory', [100, 200], [150, 300], 'Red charm');
  const second = drawRigPart(first, 'accessory', [200, 200], [250, 300], 'Red charm');
  expect(second.accessories?.slice(-2).map(item => item.name)).toEqual(['red-charm', 'red-charm-2']);
  expect(second.accessories?.every(item => /^[A-Za-z0-9_-]+$/.test(item.name))).toBe(true);
});

test('duplicates and deletes selected accessories and buns without affecting other items', () => {
  const rig = parseRig(fixture);
  const duplicate = duplicateRigItem(rig, 'accessories.0')!;
  expect(duplicate.path).toBe('accessories.1');
  expect(duplicate.rig.accessories).toHaveLength(rig.accessories!.length + 1);
  expect(duplicate.rig.accessories![1].name).toMatch(/^[A-Za-z0-9_-]+$/);
  const deleted = deleteRigItem(duplicate.rig, duplicate.path);
  expect(deleted.accessories).toEqual(rig.accessories);

  const withoutBuns = structuredClone(rig);
  delete withoutBuns.buns;
  const withBun = drawRigPart(withoutBuns, 'bunL', [700, 100], [820, 220]);
  const copiedBun = duplicateRigItem(withBun, 'buns.bunL')!;
  expect(copiedBun.path).toBe('buns.bunR');
  expect(deleteRigItem(copiedBun.rig, 'buns.bunR').buns?.bunR).toBeUndefined();
});

test('ellipse handles rotate and scale both radii around the same center', () => {
  const rig = parseRig(fixture);
  const handles = buildOverlay(rig).handles;
  const rotation = handles.find(handle => handle.id === 'face.nose.rotate')!;
  const resized = handles.find(handle => handle.id === 'face.nose.resize')!;
  const rotated = moveHandle(rig, rotation, [rotation.point[0] + 30, rotation.point[1] - 20]);
  expect(rotated.face.nose.angle).not.toBe(0);
  const scaled = moveHandle(rig, resized, [
    resized.ellipseTransform!.center[0] + (resized.point[0] - resized.ellipseTransform!.center[0]) * 1.5,
    resized.ellipseTransform!.center[1] + (resized.point[1] - resized.ellipseTransform!.center[1]) * 1.5,
  ]);
  expect(scaled.face.nose.rx).toBe(rig.face.nose.rx * 1.5);
  expect(scaled.face.nose.ry).toBe(rig.face.nose.ry * 1.5);
  expect(validateRig(rotated)).toEqual([]);
  expect(validateRig(scaled)).toEqual([]);
});

test('moving a selected set of rig dots translates every selected anchor in one edit', () => {
  const rig = parseRig(fixture), handles = buildOverlay(rig).handles;
  const selected = handles.filter(handle => ['head.center', 'head.pivot'].includes(handle.id));
  const moved = moveHandles(rig, selected, 14, -9);
  expect(moved.head.cx).toBe(rig.head.cx + 14);
  expect(moved.head.cy).toBe(rig.head.cy - 9);
  expect(moved.head.pivotX).toBe(rig.head.pivotX + 14);
  expect(moved.head.pivotY).toBe(rig.head.pivotY - 9);
  expect(validateRig(moved)).toEqual([]);
});

test('resizes the current rig proportionally to a newly loaded image', () => {
  const rig = parseRig(fixture);
  const resized = resizeRigToImage(rig, rig.image.width * 2, rig.image.height * 2);
  expect(resized.image).toEqual({ width: rig.image.width * 2, height: rig.image.height * 2 });
  expect(resized.head.cx).toBe(rig.head.cx * 2);
  expect(resized.head.rx).toBe(rig.head.rx * 2);
  expect(resized.face.nose.cy).toBe(rig.face.nose.cy * 2);
  expect(validateRig(resized)).toEqual([]);
  expect(() => resizeRigToImage(rig, 0, rig.image.height)).toThrow(/positive integers/);
});

test('manual ellipses add shoulder and soft-body influence to the body overlay', () => {
  const rig = parseRig(fixture);
  const shoulderRig = drawRigPart(rig, 'shoulder', [300, 400], [380, 460]);
  expect(shoulderRig.body.shoulders.at(-1)).toEqual({ cx: 340, cy: 430, rx: 40, ry: 30 });
  const softBodyRig = drawRigPart(rig, 'softBody', [300, 400], [380, 460]);
  expect(softBodyRig.softBody?.regions).toHaveLength(1);
  expect(buildOverlay(softBodyRig).shapes).toContainEqual(expect.objectContaining({
    item: 'softBody.regions.0', group: 'softBody', kind: 'ellipse',
  }));
  expect(validateRig(shoulderRig)).toEqual([]);
  expect(validateRig(softBodyRig)).toEqual([]);
});

test('manual guides support named lines and ellipses beyond image bounds without creating animation', () => {
  const rig = parseRig(fixture);
  const lineRig = drawRigPart(rig, 'guideLine', [150, 120], [150, -30], 'left thigh', 'body');
  const ellipseRig = drawRigPart(lineRig, 'guideEllipse', [1040, 600], [1230, 710], 'left thigh');
  expect(ellipseRig.guides).toEqual([
    { name: 'left thigh', kind: 'line', points: [[150, 120], [150, -30]], part: 'body' },
    { name: 'left thigh 2', kind: 'ellipse', points: [[1040, 600], [1230, 710]] },
  ]);
  expect(ellipseRig.skeleton).toEqual(rig.skeleton);
  expect(buildOverlay(ellipseRig).shapes).toEqual(expect.arrayContaining([
    expect.objectContaining({ item: 'guides.0', group: 'guides', kind: 'line' }),
    expect.objectContaining({ item: 'guides.1', group: 'guides', kind: 'ellipse' }),
  ]));
  expect(buildOverlay(ellipseRig).handles.filter(handle => handle.group === 'guides').every(handle => !handle.vertex)).toBe(true);
  const center = buildOverlay(ellipseRig).handles.find(handle => handle.id === 'guides.1.center')!;
  const movedEllipse = moveHandle(ellipseRig, center, [1140, 680]);
  expect(movedEllipse.guides![1].points).toEqual([[1045, 625], [1235, 735]]);
  const shiftedGuides = transformRigCluster(ellipseRig, 'guides', { x: 5, y: 6, scale: 1, rotation: 0 });
  expect(shiftedGuides.guides![1].points).toEqual([[1045, 606], [1235, 716]]);
  expect(validateRig(ellipseRig)).toEqual([]);
  expect(validateRig({ ...ellipseRig, guides: [{ ...ellipseRig.guides![0], part: ' ' }] }))
    .toContain('rig.guides[0].part: expected a non-empty string');
  expect(validateRig({ ...ellipseRig, guides: [{ ...ellipseRig.guides![0], name: '   ' }] }))
    .toContain('rig.guides[0].name: expected a non-empty string');
});

test('integer rectangles and cells round in both handle moves and numeric edits without rounding other geometry', () => {
  const rig = parseRig(fixture), handles = buildOverlay(rig).handles;
  const box = moveHandle(rig, handles.find(h => h.id === 'accessories.1.box.end')!, [1075.9, 482.7]);
  expect(box.accessories![1].box.slice(2)).toEqual([1076, 483]);
  expect(moveHandle(rig, handles.find(h => h.id === 'accessories.1.box.end')!, [1075.49, 482.49]).accessories![1].box.slice(2)).toEqual([1075, 482]);
  const fine = moveHandle(rig, handles.find(h => h.id === 'mesh.fine.end')!, [880.3, 760.8]);
  expect(fine.mesh.fine).toMatchObject({ x1: 880, y1: 761 });
  for (const path of ['mesh.baseCell', 'mesh.handCell', 'mesh.fine.cell', 'accessories.0.box.0']) expect(getAt(setAt(rig, path, 14.7), path)).toBe(15);
  expect(setAt(rig, 'head.cx', 615.4).head.cx).toBe(615.4);
  expect(moveHandle(rig, handles.find(h => h.id === 'head.center')!, [615.35, 400.24]).head).toMatchObject({ cx: 615.4, cy: 400.2 });
  expect(validateRig(box)).toEqual([]); expect(validateRig(fine)).toEqual([]);
});

test('cluster transforms move and resize a whole selected rig group and rotate its geometry', () => {
  const rig = parseRig(fixture);
  const moved = transformRigCluster(rig, 'head', { x: 12, y: -8, scale: 1, rotation: 0 });
  expect(moved.head.cx).toBe(rig.head.cx + 12);
  expect(moved.head.cy).toBe(rig.head.cy - 8);
  expect(moved.head.pivotX).toBe(rig.head.pivotX + 12);
  expect(moved.head.weightBand).toEqual(rig.head.weightBand.map(value => value - 8));

  const scaled = transformRigCluster(rig, 'head', { x: 0, y: 0, scale: 1.5, rotation: 0 });
  expect(scaled.head.rx).toBe(rig.head.rx * 1.5);
  expect(scaled.head.ry).toBe(rig.head.ry * 1.5);
  expect(scaled.head.shiftX).toBe(rig.head.shiftX * 1.5);
  expect(scaled.head.maxRoll).toBe(rig.head.maxRoll);

  const movedAccessory = transformRigCluster(rig, 'accessories.0', { x: 15, y: -5, scale: 1, rotation: 0 });
  expect(movedAccessory.accessories![0].pivot).toEqual([rig.accessories![0].pivot[0] + 15, rig.accessories![0].pivot[1] - 5]);
  expect(movedAccessory.accessories![0].box).toEqual([
    rig.accessories![0].box[0] + 15, rig.accessories![0].box[1] - 5,
    rig.accessories![0].box[2] + 15, rig.accessories![0].box[3] - 5,
  ]);
  expect(movedAccessory.accessories![1]).toEqual(rig.accessories![1]);

  const rotated = transformRigCluster(rig, 'mouth', { x: 0, y: 0, scale: 1, rotation: Math.PI / 4 });
  expect(rotated.mouth.angle).toBeCloseTo(rig.mouth.angle + Math.PI / 4);
  expect(rotated.mouth.area.angle).toBeCloseTo(rig.mouth.area.angle + Math.PI / 4);
  expect(validateRig(moved)).toEqual([]);
  expect(validateRig(scaled)).toEqual([]);
  expect(validateRig(rotated)).toEqual([]);
});
