import { editorNumber, isIntegerField } from '../../packages/runtime/src/rig/numeric';
import type { Accessory, Point, Rig, RigGuide, SoftBody, Strand } from 'mesh-avatar';

export interface Viewport { scale: number; x: number; y: number }
export type DrawTool = 'strand' | 'shoulder' | 'softBody' | 'accessory' | 'bunL' | 'bunR' | 'guideLine' | 'guideEllipse';
export interface Handle {
  id: string;
  item: string;
  group: string;
  point: Point;
  xPath: string;
  yPath?: string;
  translate?: { xPaths: string[]; yPaths: string[]; origin: Point };
  radius?: { axis: 'x' | 'y'; center: Point; angle: number };
  ellipseTransform?: { path: string; center: Point; rx: number; ry: number; angle: number; mode: 'rotate' | 'scale' };
  vertex?: { path: string; index: number; closed: boolean };
}
export interface Shape {
  item: string;
  group: string;
  kind: 'ellipse' | 'line';
  points: Point[];
  closed?: boolean;
  editable?: boolean;
  band?: boolean;
  radius?: Point;
  angle?: number;
}
export function getAt(root: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, root);
}
export function setAt(rig: Rig, path: string, value: unknown): Rig {
  const next = structuredClone(rig);
  const parts = path.split('.');
  let target = next as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = typeof value === 'number' ? editorNumber(path, value) : value;
  return next;
}
export function resizeRigToImage(rig: Rig, width: number, height: number): Rig {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError('Image dimensions must be positive integers.');
  }
  const scale = Math.min(width / rig.image.width, height / rig.image.height);
  const offsetX = (width - rig.image.width * scale) / 2;
  const offsetY = (height - rig.image.height * scale) / 2;
  let next = structuredClone(rig);
  const moved = new Set<string>();
  const scaledRadii = new Set<string>();
  const scaleRadius = (path: string) => {
    if (scaledRadii.has(path)) return;
    scaledRadii.add(path);
    const radius = getAt(next, path);
    if (typeof radius === 'number') next = setAt(next, path, Math.max(1, radius * scale));
  };
  const transformPoint = (xPath: string, yPath: string) => {
    const key = `${xPath}|${yPath}`;
    if (moved.has(key)) return;
    moved.add(key);
    const x = getAt(next, xPath), y = getAt(next, yPath);
    if (typeof x !== 'number' || typeof y !== 'number') return;
    next = setAt(setAt(next, xPath, offsetX + x * scale), yPath, offsetY + y * scale);
  };
  const { handles } = buildOverlay(rig);
  for (const handle of handles) {
    if (handle.translate) {
      handle.translate.xPaths.forEach((xPath, index) => transformPoint(xPath, handle.translate!.yPaths[index]));
    } else if (handle.radius) {
      scaleRadius(handle.xPath);
    } else if (handle.ellipseTransform?.mode === 'scale') {
      const { path } = handle.ellipseTransform;
      scaleRadius(`${path}.rx`);
      scaleRadius(`${path}.ry`);
    } else if (!handle.ellipseTransform && handle.yPath) {
      transformPoint(handle.xPath, handle.yPath);
    }
  }
  if (rig.skeleton) {
    rig.skeleton.joints.forEach((joint, index) => {
      next = setAt(next, `skeleton.joints.${index}.position.0`, offsetX + joint.position[0] * scale);
      next = setAt(next, `skeleton.joints.${index}.position.1`, offsetY + joint.position[1] * scale);
    });
  }
  next.image = { width, height };
  return next;
}
export function safeAccessoryLayerName(name: string, existing: Iterable<string>, fallback: string): string {
  const used = new Set(existing);
  const reserved = new Set(['base', 'hairmask', 'hand', ...[0, 1].flatMap(index =>
    ['ball', 'lash', 'low', 'crease'].map(part => `eye${index}_${part}`))]);
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
  let candidate = base, suffix = 2;
  while (used.has(candidate) || reserved.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}
export function drawRigPart(rig: Rig, tool: DrawTool, start: Point, end: Point, guideName = '', guidePart?: string): Rig {
  const next = structuredClone(rig);
  if (tool === 'guideLine' || tool === 'guideEllipse') {
    const guides = next.guides ?? [];
    const baseName = guideName.trim();
    const names = new Set(guides.map(guide => guide.name));
    let name = baseName || `Guide ${guides.length + 1}`;
    if (names.has(name)) {
      let suffix = 2;
      while (names.has(`${name} ${suffix}`)) suffix++;
      name = `${name} ${suffix}`;
    }
    const guide: RigGuide = {
      name,
      kind: tool === 'guideLine' ? 'line' : 'ellipse',
      points: [[...start], [...end]],
      ...(guidePart ? { part: guidePart } : {}),
    };
    next.guides = [...guides, guide];
  } else if (tool === 'bunL' || tool === 'bunR') {
    const [cx, cy] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    next.buns = { ...next.buns, [tool]: {
      cx, cy,
      rx: Math.max(2, Math.abs(end[0] - start[0]) / 2),
      ry: Math.max(2, Math.abs(end[1] - start[1]) / 2),
    } };
  } else if (tool === 'accessory') {
    const accessories = next.accessories ?? [];
    const requestedName = guideName.trim() || `accessory-${accessories.length + 1}`;
    const name = safeAccessoryLayerName(requestedName, accessories.map(accessory => accessory.name), `accessory-${accessories.length + 1}`);
    const x0 = Math.max(0, Math.floor(Math.min(start[0], end[0])));
    const y0 = Math.max(0, Math.floor(Math.min(start[1], end[1])));
    const x1 = Math.min(rig.image.width, Math.ceil(Math.max(start[0], end[0])));
    const y1 = Math.min(rig.image.height, Math.ceil(Math.max(start[1], end[1])));
    const accessory: Accessory = {
      name,
      pivot: [(x0 + x1) / 2, y0],
      tip: [(x0 + x1) / 2, y1],
      split: 0.55,
      box: [x0, y0, x1, y1],
      color: { redness: 0.08, minRed: 35 },
    };
    next.accessories = [...accessories, accessory];
  } else if (tool === 'strand') {
    const index = (next.strands ?? []).length;
    const names = new Set((next.strands ?? []).map(strand => strand.name));
    let name = `strand-${index + 1}`;
    for (let suffix = index + 2; names.has(name); suffix++) name = `strand-${suffix}`;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const strand: Strand = {
      name,
      nodes: [0, 1 / 3, 2 / 3, 1].map(t => [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]),
      sigma: Math.max(12, length * 0.1),
      k: 1,
      max: 8,
    };
    next.strands = [...(next.strands ?? []), strand];
  } else {
    const region = {
      cx: (start[0] + end[0]) / 2,
      cy: (start[1] + end[1]) / 2,
      rx: Math.max(2, Math.abs(end[0] - start[0]) / 2),
      ry: Math.max(2, Math.abs(end[1] - start[1]) / 2),
    };
    if (tool === 'shoulder') next.body.shoulders.push(region);
    else {
      const softBody: SoftBody = next.softBody ?? {
        regions: [],
        gain: 0.65,
        maxOffset: Math.min(18, Math.max(2, region.ry * 0.35)),
        frequency: 3.5,
        damping: 0.65,
      };
      softBody.regions.push(region);
      next.softBody = softBody;
    }
  }
  return next;
}

export function deleteRigItem(rig: Rig, path: string): Rig {
  const next = structuredClone(rig);
  const bun = path.match(/^buns\.(bunL|bunR)$/);
  if (bun && next.buns) {
    delete next.buns[bun[1] as 'bunL' | 'bunR'];
    if (!next.buns.bunL && !next.buns.bunR) delete next.buns;
    return next;
  }
  const arrayPath = path.match(/^(strands|accessories|guides|body\.shoulders|softBody\.regions)\.(\d+)$/);
  if (!arrayPath) return rig;
  const array = getAt(next, arrayPath[1]);
  if (!Array.isArray(array)) return rig;
  array.splice(Number(arrayPath[2]), 1);
  if (arrayPath[1] === 'strands' && !array.length) delete next.strands;
  if (arrayPath[1] === 'accessories' && !array.length) delete next.accessories;
  if (arrayPath[1] === 'guides' && !array.length) delete next.guides;
  if (arrayPath[1] === 'softBody.regions' && !array.length) delete next.softBody;
  return next;
}

export function duplicateRigItem(rig: Rig, path: string): { rig: Rig; path: string } | undefined {
  const bun = path.match(/^buns\.(bunL|bunR)$/);
  if (bun) {
    const other = bun[1] === 'bunL' ? 'bunR' : 'bunL';
    if (rig.buns?.[other]) return undefined;
    const item = rig.buns?.[bun[1] as 'bunL' | 'bunR'];
    if (!item) return undefined;
    const next = structuredClone(rig);
    next.buns = { ...next.buns, [other]: { ...item, cx: item.cx + (bun[1] === 'bunL' ? 40 : -40) } };
    return { rig: next, path: `buns.${other}` };
  }
  const match = path.match(/^(strands|accessories|guides|body\.shoulders|softBody\.regions)\.(\d+)$/);
  if (!match) return undefined;
  const group = match[1], index = Number(match[2]), array = getAt(rig, group);
  if (!Array.isArray(array) || !array[index]) return undefined;
  const next = structuredClone(rig), copy = structuredClone(array[index]) as Record<string, unknown>;
  const existingNames = new Set((array as { name?: string }[]).map(item => item.name).filter((name): name is string => !!name));
  if (group === 'accessories' || group === 'strands' || group === 'guides') {
    const baseName = String(copy.name ?? group.slice(0, -1));
    let suffix = 2, candidate = `${baseName}-copy`;
    while (existingNames.has(candidate)) candidate = `${baseName}-copy-${suffix++}`;
    copy.name = group === 'accessories'
      ? safeAccessoryLayerName(candidate, existingNames, 'accessory-copy')
      : candidate;
  }
  const target = getAt(next, group) as unknown[];
  target.splice(index + 1, 0, copy);
  return { rig: next, path: `${group}.${index + 1}` };
}
export function numericFields(value: unknown, path: string): { path: string; value: number }[] {
  if (typeof value === 'number') return [{ path, value }];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => numericFields(child, path ? `${path}.${key}` : key));
}
export function screen(point: Point, view: Viewport): Point {
  return [point[0] * view.scale + view.x, point[1] * view.scale + view.y];
}
export function imagePoint(point: Point, view: Viewport): Point {
  return [(point[0] - view.x) / view.scale, (point[1] - view.y) / view.scale];
}
export function nearestHandle(handles: Handle[], point: Point, view: Viewport, threshold = 8): Handle | undefined {
  let nearest: Handle | undefined;
  let distance = threshold;
  for (const handle of handles) {
    const p = screen(handle.point, view);
    const d = Math.hypot(p[0] - point[0], p[1] - point[1]);
    if (d <= distance) { distance = d; nearest = handle; }
  }
  return nearest;
}
export function moveHandle(rig: Rig, handle: Handle, point: Point): Rig {
  const rounded = (value: number, path: string) => isIntegerField(path) ? Math.round(value) : Math.round(value * 10) / 10;
  if (handle.ellipseTransform) {
    const { path, center, rx, ry, angle, mode } = handle.ellipseTransform;
    const dx = point[0] - center[0], dy = point[1] - center[1];
    if (mode === 'rotate') return setAt(rig, `${path}.angle`, Math.atan2(dy, dx) + Math.PI / 4);
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    const factor = Math.hypot(localX / rx, localY / ry);
    return setAt(setAt(rig, `${path}.rx`, Math.max(1, rounded(rx * factor, `${path}.rx`))),
      `${path}.ry`, Math.max(1, rounded(ry * factor, `${path}.ry`)));
  }
  if (handle.translate) {
    const dx = point[0] - handle.translate.origin[0], dy = point[1] - handle.translate.origin[1];
    return handle.translate.xPaths.reduce((next, path, index) =>
      setAt(setAt(next, path, rounded(getAt(rig, path) as number + dx, path)),
        handle.translate!.yPaths[index], rounded(getAt(rig, handle.translate!.yPaths[index]) as number + dy, handle.translate!.yPaths[index])), rig);
  }
  if (handle.radius) {
    const { center, axis, angle } = handle.radius;
    const dx = point[0] - center[0], dy = point[1] - center[1];
    const amount = axis === 'x' ? dx * Math.cos(angle) + dy * Math.sin(angle)
      : -dx * Math.sin(angle) + dy * Math.cos(angle);
    return setAt(rig, handle.xPath, Math.max(1, rounded(Math.abs(amount), handle.xPath)));
  }
  return setAt(setAt(rig, handle.xPath, rounded(point[0], handle.xPath)), handle.yPath!, rounded(point[1], handle.yPath!));
}
export function moveHandles(rig: Rig, handles: Handle[], dx: number, dy: number): Rig {
  const movable = handles.filter(handle => handle.yPath && !handle.radius && !handle.ellipseTransform);
  return movable.reduce((next, handle) => moveHandle(next, handle, [handle.point[0] + dx, handle.point[1] + dy]), rig);
}
export function changeVertex(rig: Rig, path: string, index: number, point: Point | null, closed: boolean): Rig {
  const points = structuredClone(getAt(rig, path)) as Point[];
  if (point) points.splice(index, 0, point);
  else if (points.length > (closed ? 3 : 2)) points.splice(index, 1);
  return setAt(rig, path, points);
}
export function nearestEdge(shapes: Shape[], point: Point, view: Viewport) {
  let best: { shape: Shape; index: number; point: Point } | undefined;
  let distance = 8;
  for (const shape of shapes.filter(s => s.editable)) {
    const count = shape.closed ? shape.points.length : shape.points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = screen(shape.points[i], view), b = screen(shape.points[(i + 1) % shape.points.length], view);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const closest: Point = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(point[0] - closest[0], point[1] - closest[1]);
      if (d < distance) { distance = d; best = { shape, index: i + 1, point: imagePoint(closest, view) }; }
    }
  }
  return best;
}
export function buildOverlay(rig: Rig): { handles: Handle[]; shapes: Shape[] } {
  const handles: Handle[] = [], shapes: Shape[] = [];
  const pointHandle = (item: string, group: string, point: Point, xPath: string, yPath: string, id = item) =>
    handles.push({ id, item, group, point, xPath, yPath });
  function walk(value: unknown, path: string, group: string) {
    if (!value || typeof value !== 'object') return;
    const key = path.split('.').at(-1)!;
    if (Array.isArray(value)) {
      if (value.length >= 2 && value.every(p => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number'))) {
        const points = value as Point[];
        const closed = ['opening', 'roi', 'outline', 'background'].includes(key);
        const editable = closed || ['nodes', 'jaw'].includes(key);
        if (group !== 'cheeks') shapes.push({ item: path, group, kind: 'line', points, closed, editable });
        points.forEach((point, index) => {
          const item = group === 'strands' ? path.split('.').slice(0, 2).join('.') : path;
          const handle: Handle = { id: `${path}.${index}`, item, group, point,
            xPath: `${path}.${index}.0`, yPath: `${path}.${index}.1` };
          if (editable) handle.vertex = { path, index, closed };
          handles.push(handle);
        });
        return;
      }
      if (value.length === 2 && value.every(v => typeof v === 'number')) {
        if (!key.toLowerCase().endsWith('band') && !['band', 'jawRange'].includes(key))
          pointHandle(path, group, value as Point, `${path}.0`, `${path}.1`);
        else if (group !== 'hand' || !key.startsWith('fingerX')) {
          value.forEach((y, i) => {
            const center = group === 'body' ? rig.body.chest.cx : rig.head.cx;
            shapes.push({ item: path, group, kind: 'line', band: true, points: [[0, y], [rig.image.width, y]] });
            handles.push({ id: `${path}.${i}`, item: path, group, point: [center, y],
              xPath: `${path}.${i}`, radius: { axis: 'y', center: [center, 0], angle: 0 } });
          });
        }
        return;
      }
      if (key === 'box' && value.length === 4) {
        const [x0, y0, x1, y1] = value as number[];
        shapes.push({ item: path, group, kind: 'line', points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
        pointHandle(path, group, [x0, y0], `${path}.0`, `${path}.1`, `${path}.start`);
        pointHandle(path, group, [x1, y1], `${path}.2`, `${path}.3`, `${path}.end`);
        return;
      }
      value.forEach((child, index) => walk(child, `${path}.${index}`, group));
      return;
    }
    const object = value as Record<string, unknown>;
    if (typeof object.cx === 'number' && typeof object.cy === 'number') {
      const center: Point = [object.cx, object.cy];
      pointHandle(path, group, center, `${path}.cx`, `${path}.cy`, `${path}.center`);
      if (typeof object.rx === 'number' && typeof object.ry === 'number') {
        const angle = typeof object.angle === 'number' ? object.angle : 0;
        shapes.push({ item: path, group, kind: 'ellipse', points: [center], radius: [object.rx, object.ry], angle });
        for (const axis of ['x', 'y'] as const) {
          const theta = angle + (axis === 'y' ? Math.PI / 2 : 0);
          const radius = axis === 'x' ? object.rx : object.ry;
          handles.push({ id: `${path}.r${axis}`, item: path, group,
            point: [center[0] + Math.cos(theta) * radius, center[1] + Math.sin(theta) * radius],
            xPath: `${path}.r${axis}`, radius: { axis, center, angle } });
        }
        const resizeLocal: Point = [object.rx * Math.cos(Math.PI / 4), object.ry * Math.sin(Math.PI / 4)];
        const resizePoint: Point = [
          center[0] + resizeLocal[0] * Math.cos(angle) - resizeLocal[1] * Math.sin(angle),
          center[1] + resizeLocal[0] * Math.sin(angle) + resizeLocal[1] * Math.cos(angle),
        ];
        handles.push({ id: `${path}.resize`, item: path, group, point: resizePoint,
          xPath: `${path}.rx`, ellipseTransform: { path, center, rx: object.rx, ry: object.ry, angle, mode: 'scale' } });
        const rotateRadius = Math.max(object.rx, object.ry) + 22;
        const rotateAngle = angle - Math.PI / 4;
        handles.push({ id: `${path}.rotate`, item: path, group,
          point: [center[0] + Math.cos(rotateAngle) * rotateRadius, center[1] + Math.sin(rotateAngle) * rotateRadius],
          xPath: `${path}.angle`, ellipseTransform: { path, center, rx: object.rx, ry: object.ry, angle, mode: 'rotate' } });
      }
      if (typeof object.halfLen === 'number' && typeof object.angle === 'number') {
        shapes.push({ item: path, group, kind: 'line', points: [-1, 1].map(sign =>
          [center[0] + sign * (object.halfLen as number) * Math.cos(object.angle as number),
            center[1] + sign * (object.halfLen as number) * Math.sin(object.angle as number)]) });
      }
    }
    if (typeof object.pivotX === 'number' && typeof object.pivotY === 'number')
      pointHandle(path, group, [object.pivotX, object.pivotY], `${path}.pivotX`, `${path}.pivotY`, `${path}.pivot`);
    if (['x0', 'y0', 'x1', 'y1'].every(key => typeof object[key] === 'number')) {
      const { x0, y0, x1, y1 } = object as Record<string, number>;
      shapes.push({ item: path, group, kind: 'line', points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
      pointHandle(path, group, [x0, y0], `${path}.x0`, `${path}.y0`, `${path}.start`);
      pointHandle(path, group, [x1, y1], `${path}.x1`, `${path}.y1`, `${path}.end`);
    }
    Object.entries(object).forEach(([key, child]) => walk(child, `${path}.${key}`, group));
  }
  Object.entries(rig).forEach(([group, value]) => {
    if (group !== 'image' && group !== 'guides') walk(value, group, group);
  });
  (rig.guides ?? []).forEach((guide, index) => {
    if (guide.kind === 'ellipse') {
      const [a, b] = guide.points;
      const center: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      shapes.push({ item: `guides.${index}`, group: 'guides', kind: 'ellipse',
        points: [center], radius: [Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2] });
      handles.push({ id: `guides.${index}.center`, item: `guides.${index}`, group: 'guides', point: center,
        xPath: `guides.${index}.points.0.0`, yPath: `guides.${index}.points.0.1`,
        translate: {
          xPaths: [`guides.${index}.points.0.0`, `guides.${index}.points.1.0`],
          yPaths: [`guides.${index}.points.0.1`, `guides.${index}.points.1.1`],
          origin: center,
        } });
      pointHandle(`guides.${index}`, 'guides', a, `guides.${index}.points.0.0`, `guides.${index}.points.0.1`, `guides.${index}.start`);
      pointHandle(`guides.${index}`, 'guides', b, `guides.${index}.points.1.0`, `guides.${index}.points.1.1`, `guides.${index}.end`);
    } else {
      shapes.push({ item: `guides.${index}`, group: 'guides', kind: 'line', points: guide.points });
      guide.points.forEach((point, pointIndex) => {
        const path = `guides.${index}.points.${pointIndex}`;
        const handle: Handle = { id: path, item: `guides.${index}`, group: 'guides', point,
          xPath: `${path}.0`, yPath: `${path}.1` };
        handles.push(handle);
      });
    }
  });
  return { handles, shapes };
}

export interface ClusterTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export function transformRigCluster(rig: Rig, target: string, transform: ClusterTransform): Rig {
  if (!Object.values(transform).every(Number.isFinite) || transform.scale <= 0)
    throw new RangeError('Cluster transforms must be finite and scale must be greater than zero.');

  const group = target.split('.')[0];
  const matchesTarget = (item: string) => item === target || item.startsWith(`${target}.`);
  const { handles, shapes } = buildOverlay(rig);
  const groupHandles = handles.filter(handle => handle.group === group && matchesTarget(handle.item));
  const groupShapes = shapes.filter(shape => shape.group === group && matchesTarget(shape.item));
  const points: Point[] = groupHandles.filter(handle => !handle.radius).map(handle => handle.point);
  for (const shape of groupShapes) {
    if (shape.band) continue;
    if (shape.kind === 'ellipse' && shape.radius) {
      const angle = shape.angle ?? 0;
      const rx = shape.radius[0], ry = shape.radius[1];
      const extentX = Math.hypot(rx * Math.cos(angle), ry * Math.sin(angle));
      const extentY = Math.hypot(rx * Math.sin(angle), ry * Math.cos(angle));
      const [cx, cy] = shape.points[0];
      points.push([cx - extentX, cy - extentY], [cx + extentX, cy + extentY]);
    } else points.push(...shape.points);
  }
  if (!points.length) return rig;

  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const center: Point = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const cos = Math.cos(transform.rotation), sin = Math.sin(transform.rotation);
  const applyPoint = ([x, y]: Point): Point => {
    const sx = (x - center[0]) * transform.scale, sy = (y - center[1]) * transform.scale;
    return [
      center[0] + sx * cos - sy * sin + transform.x,
      center[1] + sx * sin + sy * cos + transform.y,
    ];
  };
  let next = rig;
  const updatedPaths = new Set<string>();
  const boxes = new Set<string>();
  const groupValue = getAt(rig, target);
  const collectBoxes = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && Array.isArray((value as Record<string, unknown>).box)) {
      const boxPath = `${path}.box`;
      const box = getAt(rig, boxPath);
      if (Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)) {
        const [x0, y0, x1, y1] = box as number[];
        const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(point => applyPoint(point as Point));
        next = setAt(next, boxPath, [
          Math.min(...corners.map(point => point[0])), Math.min(...corners.map(point => point[1])),
          Math.max(...corners.map(point => point[0])), Math.max(...corners.map(point => point[1])),
        ]);
        boxes.add(boxPath);
      }
    }
    if (Array.isArray(value)) value.forEach((child, index) => collectBoxes(child, `${path}.${index}`));
    else Object.entries(value).forEach(([key, child]) => collectBoxes(child, path ? `${path}.${key}` : key));
  };
  collectBoxes(groupValue, target);

  for (const handle of groupHandles) {
    if (handle.translate) {
      for (let index = 0; index < handle.translate.xPaths.length; index++) {
        const xPath = handle.translate.xPaths[index], yPath = handle.translate.yPaths[index];
        const key = `${xPath}|${yPath}`;
        if (updatedPaths.has(key) || [...boxes].some(path => xPath.startsWith(`${path}.`))) continue;
        updatedPaths.add(key);
        const x = getAt(rig, xPath), y = getAt(rig, yPath);
        if (typeof x !== 'number' || typeof y !== 'number') continue;
        const [nextX, nextY] = applyPoint([x, y]);
        next = setAt(setAt(next, xPath, nextX), yPath, nextY);
      }
      continue;
    }
    if (handle.yPath && !handle.radius) {
      const key = `${handle.xPath}|${handle.yPath}`;
      if (updatedPaths.has(key) || [...boxes].some(path => handle.xPath.startsWith(`${path}.`))) continue;
      updatedPaths.add(key);
      const [x, y] = applyPoint(handle.point);
      next = setAt(setAt(next, handle.xPath, x), handle.yPath, y);
    } else if (handle.radius?.axis === 'y') {
      const y = getAt(rig, handle.xPath);
      if (typeof y === 'number') next = setAt(next, handle.xPath,
        center[1] + (y - center[1]) * transform.scale + transform.y);
    }
  }

  const scaleGeometry = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => scaleGeometry(child, `${path}.${index}`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (typeof child === 'number' && ['rx', 'ry', 'halfLen', 'shiftX', 'shiftY', 'sigma', 'max', 'maxOffset'].includes(key))
        next = setAt(next, childPath, child * transform.scale);
      else if (typeof child === 'number' && key === 'angle')
        next = setAt(next, childPath, child + transform.rotation);
      else scaleGeometry(child, childPath);
    }
  };
  scaleGeometry(groupValue, target);
  return next;
}
