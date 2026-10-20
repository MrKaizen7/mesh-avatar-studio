import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, PARAMS } from 'mesh-avatar';
import { createRig } from '../packages/runtime/src/engine/rig.js';
import { createPhysics } from '../packages/runtime/src/engine/physics.js';

test('rig instances have isolated coordinates and physics state', () => {
  const a = parseRig(fixture);
  const b = parseRig(fixture);
  b.head.shiftX += 100;
  const first = createRig(a);
  const second = createRig(b);
  const P = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
  P.angleX = 30;
  const x = [600, 400];
  const y = [...x];
  first.applyHead(x, 1, P);
  second.applyHead(y, 1, P);
  expect(x).not.toEqual(y);
  const { Physics } = createPhysics(first, a);
  expect(new Physics()).not.toBe(new Physics());
});

test('missing optional parts and variable strand lengths stay finite', () => {
  const rig = parseRig(fixture);
  delete rig.hand;
  delete rig.buns;
  rig.accessories = [];
  rig.strands = [rig.strands![0]];
  rig.strands[0].nodes.splice(1, 1);
  const engine = createRig(rig);
  const { Physics } = createPhysics(engine, rig);
  const physics = new Physics();
  const P = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
  const phys = physics.step(P, 1 / 60);
  const out = engine.deformBase(500, 300, engine.baseWeights(500, 300), P, phys, [0, 0]);
  expect(out.every(Number.isFinite)).toBe(true);
  expect(physics.chains).toHaveLength(0);
});

test('soft-body bounce is movement-triggered, bounded, and settles without idle jiggle', () => {
  const rig = parseRig(fixture);
  rig.softBody = {
    regions: [-1, 1].map(side => ({
      cx: rig.body.chest.cx + side * rig.body.chest.rx * 0.45,
      cy: rig.body.chest.cy,
      rx: rig.body.chest.rx * 0.3,
      ry: rig.body.chest.ry * 0.4,
    })),
    gain: 0.65,
    maxOffset: 8,
    frequency: 3.5,
    damping: 0.65,
  };
  const engine = createRig(rig);
  const { Physics } = createPhysics(engine, rig);
  const physics = new Physics();
  const P = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));

  for (let i = 0; i < 60; i++) physics.step(P, 1 / 60);
  expect(physics.out.softBody).toEqual([0, 0]);

  physics.triggerSoftBodyBounce(0.75);
  let peak = 0;
  for (let i = 0; i < 180; i++) {
    const output = physics.step(P, 1 / 60).softBody;
    peak = Math.max(peak, Math.hypot(...output));
  }

  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(rig.softBody.maxOffset);
  expect(Math.hypot(...physics.out.softBody)).toBeLessThan(0.01);

  physics.triggerSoftBodyBounce();
  physics.step(P, 1 / 60);
  physics.setSoftBodyGain(0);
  expect(physics.out.softBody).toEqual([0, 0]);
  for (let i = 0; i < 30; i++) physics.step(P, 1 / 60);
  expect(physics.out.softBody).toEqual([0, 0]);
}, 15000);

test('body movement drives soft-body response and rig regions receive its displacement', () => {
  const rig = parseRig(fixture);
  rig.softBody = {
    regions: [{ ...rig.body.chest }],
    gain: 0.65,
    maxOffset: 8,
    frequency: 3.5,
    damping: 0.65,
  };
  const engine = createRig(rig);
  const { Physics } = createPhysics(engine, rig);
  const physics = new Physics();
  const P = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
  for (let i = 0; i < 10; i++) physics.step(P, 1 / 60);

  P.bodyAngleZ = 8;
  for (let i = 0; i < 5; i++) physics.step(P, 1 / 60);
  expect(Math.hypot(...physics.out.softBody)).toBeGreaterThan(0);

  const region = rig.softBody.regions[0];
  const offset = engine.deformBase(
    region.cx,
    region.cy,
    engine.baseWeights(region.cx, region.cy),
    P,
    physics.out,
    [0, 0],
  );
  const rest = engine.deformBase(
    region.cx,
    region.cy,
    engine.baseWeights(region.cx, region.cy),
    P,
    { ...physics.out, softBody: [0, 0] },
    [0, 0],
  );
  expect(offset).not.toEqual(rest);
});
