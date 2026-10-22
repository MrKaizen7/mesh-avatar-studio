import { dismissGuide, samplePresent, sampleSkipReason } from './sample';
import { expect, test } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fixture from '../samples/miko-qipao/rig.json' with { type: 'json' };

test('dragging a head handle synchronizes the inspector', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const canvas = page.getByTestId('editor');
  await expect(canvas).toHaveAttribute('data-scale', /0\./);
  await page.screenshot({ path: 'docs/screenshots/all-groups.png' });
  const box = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  const x = box.x + Number(await canvas.getAttribute('data-offset-x')) + 615 * scale;
  const y = box.y + Number(await canvas.getAttribute('data-offset-y')) + 400 * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20 * scale, y + 15 * scale, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('spinbutton', { name: 'head.cx', exact: true })).toHaveValue('635');
  await expect(page.getByRole('spinbutton', { name: 'head.cy', exact: true })).toHaveValue('415');
  await page.screenshot({ path: 'docs/screenshots/head-drag.png' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'head.cx', exact: true })).toHaveValue('615');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'head.cx', exact: true })).toHaveValue('635');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save rig', exact: true }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(saved.head.cx).toBe(635);
  expect(saved.head.cy).toBe(415);
  expect(saved.eyes[0].top).toEqual(fixture.eyes[0].top);
});

test('applies translation, scale and rotation to the selected rig cluster', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByTestId('part-head').click();
  await page.getByRole('spinbutton', { name: 'Move X (px)', exact: true }).fill('12');
  await page.getByRole('spinbutton', { name: 'Move Y (px)', exact: true }).fill('-8');
  await page.getByRole('spinbutton', { name: 'Scale (%)', exact: true }).fill('100');
  await page.getByRole('spinbutton', { name: 'Rotate (°)', exact: true }).fill('0');
  await page.getByRole('button', { name: 'Apply to selected cluster', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'head.cx', exact: true })).toHaveValue(String(fixture.head.cx + 12));
  await expect(page.getByRole('spinbutton', { name: 'head.cy', exact: true })).toHaveValue(String(fixture.head.cy - 8));
});

test('box-select mode selects multiple dots and dragging one moves the selected set together', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  test.setTimeout(90_000);
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByTestId('part-head').click();
  const canvas = page.getByTestId('editor');
  const bounds = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  const xOffset = Number(await canvas.getAttribute('data-offset-x'));
  const yOffset = Number(await canvas.getAttribute('data-offset-y'));
  const imageScreen = (x: number, y: number) => [bounds.x + xOffset + x * scale, bounds.y + yOffset + y * scale];
  const center = imageScreen(fixture.head.cx, fixture.head.cy);
  const pivot = imageScreen(fixture.head.pivotX, fixture.head.pivotY);
  const selectionMode = page.getByRole('button', { name: 'Box select mode', exact: true });
  await selectionMode.click();
  await expect(selectionMode).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(center[0] - 8, center[1] - 8);
  await page.mouse.down();
  await page.mouse.move(pivot[0] + 8, pivot[1] + 8, { steps: 2 });
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-selection-count', '2');
  await selectionMode.click();
  await page.mouse.move(center[0], center[1]);
  await page.mouse.down();
  await page.mouse.move(center[0] + 10 * scale, center[1] + 5 * scale, { steps: 1 });
  await page.mouse.up();
  await expect(page.getByRole('spinbutton', { name: 'head.cx', exact: true })).toHaveValue('625');
  await expect(page.getByRole('spinbutton', { name: 'head.pivotX', exact: true })).toHaveValue('650');
  await expect(page.getByRole('spinbutton', { name: 'head.pivotY', exact: true })).toHaveValue('705');
});

test('selects a missing hair part, draws it, cancels with Escape, and keeps drawing undoable', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const rig = structuredClone(fixture) as Partial<typeof fixture>;
  delete rig.strands;
  await page.getByLabel('Open rig file', { exact: true }).setInputFiles({
    name: 'rig.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rig)),
  });
  const part = page.getByTestId('part-strands');
  const partRow = part.locator('..');
  await expect(part).toBeEnabled();
  await part.click();
  const drawButton = page.getByRole('button', { name: 'Draw hair strand', exact: true });
  await drawButton.click();
  const canvas = page.getByTestId('editor');
  await expect(canvas).toHaveAttribute('data-draw-tool', 'strand');
  await page.keyboard.press('Escape');
  await expect(canvas).toHaveAttribute('data-draw-tool', '');
  await drawButton.click();
  const bounds = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  const xOffset = Number(await canvas.getAttribute('data-offset-x'));
  const yOffset = Number(await canvas.getAttribute('data-offset-y'));
  const start = [bounds.x + xOffset + 700 * scale, bounds.y + yOffset + 590 * scale];
  const end = [bounds.x + xOffset + 790 * scale, bounds.y + yOffset + 680 * scale];
  await page.mouse.move(start[0], start[1]);
  await page.mouse.down();
  await page.mouse.move(end[0], end[1], { steps: 4 });
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-draw-tool', '');
  await expect(partRow).not.toHaveClass(/is-absent/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(partRow).toHaveClass(/is-absent/);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(partRow).not.toHaveClass(/is-absent/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save rig', exact: true }).click();
  const savedPath = await (await downloadPromise).path();
  const saved = JSON.parse(await readFile(savedPath!, 'utf8'));
  expect(saved.strands).toHaveLength(1);
  expect(saved.strands[0].nodes).toHaveLength(4);
});

test('a missing part does not offer a guide-only rig action', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const rig = structuredClone(fixture) as Partial<typeof fixture>;
  delete rig.hand;
  await page.getByLabel('Open rig file', { exact: true }).setInputFiles({
    name: 'rig.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rig)),
  });
  const missingHand = page.getByTestId('part-hand');
  await expect(missingHand).toBeEnabled();
  await expect(missingHand.locator('..')).toHaveClass(/is-absent/);
  await missingHand.click();
  await expect(page.getByRole('button', { name: 'Draw guide line', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Part name', { exact: true })).toHaveCount(0);
});

test('loads an image without auto-rigging and stages an adapter suggestion until explicitly applied', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  test.setTimeout(180_000);
  const projectName = `auto-rig-upload-e2e-${Date.now()}`;
  const source = await readFile(new URL('../samples/miko-qipao/source.png', import.meta.url));
  const suggestion = structuredClone(fixture);
  suggestion.head.cx += 25;
  suggestion.eyes[0].opening[0][0] += 1;
  let requestedHeadGuide: unknown;
  await page.route('**/__studio/projects/**/auto-rig', async route => {
    requestedHeadGuide = route.request().postDataJSON().head_guide;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rig: suggestion,
        warnings: ['Review the detected landmarks.'],
      }),
    });
  });
  await page.goto('/');
  try {
    await dismissGuide(page);
    await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load image', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Load image', { exact: true }))
      .toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
    await page.getByLabel('Load image', { exact: true }).setInputFiles({
      name: `${projectName}.png`, mimeType: 'image/png', buffer: source,
    });
    await expect(page.getByText('Auto-rig suggestion ready. Your current rig is unchanged.', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('project-location').locator('strong')).toHaveText(projectName);
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
    await page.getByTestId('part-head').click();
    const headX = page.getByRole('spinbutton', { name: 'head.cx', exact: true });
    const originalHeadX = await headX.inputValue();
    await page.getByRole('button', { name: 'Request auto-rig', exact: true }).click();
    await expect(page.getByText('Auto-rig suggestion ready. Your current rig is unchanged.', { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    expect(requestedHeadGuide).toEqual({
      cx: fixture.head.cx,
      cy: fixture.head.cy,
      rx: fixture.head.rx,
      ry: fixture.head.ry,
    });
    await expect(headX).toHaveValue(originalHeadX);
    await expect(page.getByTestId('stale-banner')).toHaveCount(0);
    await expect(page.getByText('Review the detected landmarks.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Apply suggestion', exact: true }).click();
    await expect(headX).toHaveValue(String(suggestion.head.cx));
    await expect(page.getByTestId('stale-banner')).toBeVisible();
    await expect(page.getByText('Auto-rig suggestion applied. Undo restores the previous rig.', { exact: true })).toBeVisible();
  } finally {
    await rm(resolve('projects', projectName), { recursive: true, force: true });
  }
});

test('keeps a drawn soft-body region selected and editable under Soft-body', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const softBodyPart = page.getByTestId('part-softBody');
  await softBodyPart.scrollIntoViewIfNeeded();
  await softBodyPart.click();
  const addRegion = page.getByRole('button', { name: 'Add soft-body region', exact: true });
  await addRegion.scrollIntoViewIfNeeded();
  await addRegion.click();
  const canvas = page.getByTestId('editor');
  const bounds = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  const xOffset = Number(await canvas.getAttribute('data-offset-x'));
  const yOffset = Number(await canvas.getAttribute('data-offset-y'));
  const start = [bounds.x + xOffset + 320 * scale, bounds.y + yOffset + 460 * scale];
  const end = [bounds.x + xOffset + 440 * scale, bounds.y + yOffset + 600 * scale];
  await page.mouse.move(start[0], start[1]);
  await page.mouse.down();
  await page.mouse.move(end[0], end[1], { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('part-softBody')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Add soft-body region', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'softBody.regions.0.cx', exact: true })).toBeVisible();
});

test('draws an accessory rig entry and marks its generated layer stale', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  test.setTimeout(90_000);
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const accessories = page.getByTestId('part-accessories');
  await accessories.scrollIntoViewIfNeeded();
  await accessories.click();
  await page.getByLabel('Accessory name', { exact: true }).fill('red charm');
  await page.getByRole('button', { name: 'Add accessory rig', exact: true }).click();
  const canvas = page.locator('canvas.editor-canvas');
  const bounds = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  const xOffset = Number(await canvas.getAttribute('data-offset-x'));
  const yOffset = Number(await canvas.getAttribute('data-offset-y'));
  const start = [bounds.x + xOffset + 500 * scale, bounds.y + yOffset + 600 * scale];
  const end = [bounds.x + xOffset + 620 * scale, bounds.y + yOffset + 760 * scale];
  await page.mouse.move(start[0], start[1]);
  await page.mouse.down();
  await page.mouse.move(end[0], end[1], { steps: 1 });
  await page.mouse.up();
  await expect(accessories.locator('..')).not.toHaveClass(/is-absent/);
  await expect(page.getByTestId('stale-banner')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save rig', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'));
  expect(saved.accessories).toHaveLength(fixture.accessories.length + 1);
  expect(saved.accessories.at(-1)).toMatchObject({
    name: 'red-charm',
    pivot: [560, 600],
    tip: [560, 761],
    split: 0.55,
    box: [500, 600, 620, 761],
    color: { redness: 0.08, minRed: 35 },
  });
});

test('draws and duplicates a missing bun, then deletes the duplicate from the canvas toolbar', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  test.setTimeout(90_000);
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const rig = structuredClone(fixture) as Partial<typeof fixture>;
  delete rig.buns;
  await page.getByLabel('Open rig file', { exact: true }).setInputFiles({
    name: 'rig.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rig)),
  });
  await page.getByTestId('part-buns').click();
  await page.getByRole('button', { name: 'Draw left hair bun', exact: true }).click();
  const canvas = page.getByTestId('editor');
  const bounds = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  const xOffset = Number(await canvas.getAttribute('data-offset-x'));
  const yOffset = Number(await canvas.getAttribute('data-offset-y'));
  const start = [bounds.x + xOffset + 700 * scale, bounds.y + yOffset + 130 * scale];
  const end = [bounds.x + xOffset + 810 * scale, bounds.y + yOffset + 240 * scale];
  await page.mouse.move(start[0], start[1]);
  await page.mouse.down();
  await page.mouse.move(end[0], end[1], { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('part-buns').locator('..')).not.toHaveClass(/is-absent/);
  await expect(page.getByRole('toolbar', { name: 'Selected rig item tools' })).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate selected rig item', exact: true }).click();
  await expect(page.getByTestId('part-buns').locator('..')).not.toHaveClass(/is-absent/);
  await page.getByRole('button', { name: 'Delete selected rig item', exact: true }).click();
});

test('soft-body preview button produces a measured bounce', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const rig = structuredClone(fixture) as Partial<typeof fixture> & {
    softBody: { regions: { cx: number; cy: number; rx: number; ry: number }[]; gain: number; maxOffset: number; frequency: number; damping: number };
  };
  const preview = page.getByTestId('preview');
  const previousRevision = Number(await preview.getAttribute('data-revision'));
  rig.softBody = {
    regions: [{ cx: 640, cy: 960, rx: 100, ry: 100 }],
    gain: 0.65,
    maxOffset: 8,
    frequency: 3.5,
    damping: 0.65,
  };
  await page.getByLabel('Open rig file', { exact: true }).setInputFiles({
    name: 'rig.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rig)),
  });
  await expect.poll(async () => Number(await preview.getAttribute('data-revision'))).toBeGreaterThan(previousRevision);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('softbody-offset')).toContainText('0.00 px');
  const strength = page.getByRole('slider', { name: 'Bounce strength', exact: true });
  await strength.focus();
  await strength.press('Home');
  for (let step = 0; step < 7; step++) await strength.press('ArrowRight');
  await expect(strength).toHaveValue('0.35');
  const trigger = page.getByRole('button', { name: 'Trigger soft-body bounce', exact: true });
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  await trigger.click({ force: true });
  await expect(page.getByTestId('softbody-offset')).not.toContainText('0.00 px');
});

test('opens a validated rig and rejects malformed files without replacing the project', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const edited = structuredClone(fixture);
  edited.head.cx = 645;
  await page.getByLabel('Open rig file', { exact: true }).setInputFiles({ name: 'rig.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(edited)) });
  await page.getByTestId('part-head').click();
  await expect(page.getByRole('spinbutton', { name: 'head.cx', exact: true })).toHaveValue('645');
  await page.getByLabel('Open rig file', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1}') });
  await expect(page.getByRole('alert')).toContainText('rig.image');
  await expect(page.getByRole('spinbutton', { name: 'head.cx', exact: true })).toHaveValue('645');
});

test('rebuilds from cached assets, marks cut-outs stale, and sweeps angles', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const assets: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/miko-qipao/')) assets.push(request.url());
  });
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const count = assets.length;
  const canvas = page.getByTestId('preview');
  const revision = Number(await canvas.getAttribute('data-revision'));
  await page.getByRole('button', { name: 'Pause idle motion', exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-revision'))).toBeGreaterThan(revision);
  await page.getByRole('slider', { name: 'Turn left/right', exact: true }).focus();
  await page.getByRole('slider', { name: 'Turn left/right', exact: true }).press('End');
  await page.getByTestId('part-eyes').click();
  await page.getByText(`1 · Opening (${fixture.eyes[0].opening.length})`, { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'eyes.0.opening.0.0', exact: true }).fill('451');
  const stale = page.getByTestId('stale-banner');
  await expect(stale).toContainText('The sample is read-only. To continue editing, copy it into a project.');
  await expect(stale.getByRole('button', { name: 'Copy and continue editing', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute('data-revision'))).toBeGreaterThan(revision + 1);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  expect(assets.length).toBe(count);
  await page.screenshot({ path: 'docs/screenshots/stale.png' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(stale).toHaveCount(0);
  await page.getByRole('button', { name: 'Sweep angles', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop sweep' })).toBeVisible();
  for (let frame = 0; frame < 3; frame++) {
    await page.waitForTimeout(650);
    await page.screenshot({ path: `docs/screenshots/stress-${frame}.png` });
  }
  await page.getByRole('button', { name: 'Stop sweep', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sweep angles', exact: true })).toBeVisible();
});

test('opens a local project folder without the installed sample', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.route('**/miko-qipao/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('.png')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  });
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByRole('heading', { name: 'Open a project', exact: true })).toBeVisible();
  await page.getByLabel('Open project folder files', { exact: true }).setInputFiles(fileURLToPath(new URL('../samples/miko-qipao/', import.meta.url)));
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('part-head').click();
  await expect(page.getByRole('spinbutton', { name: 'head.cx', exact: true })).toHaveValue('615');
});

test('a newly opened project establishes its own cut-out baseline', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const directory = await mkdtemp(join(resolve('projects'), 'mesh-avatar-project-'));
  try {
    await cp(fileURLToPath(new URL('../samples/miko-qipao/', import.meta.url)), directory, { recursive: true });
    const rig = structuredClone(fixture);
    rig.eyes[0].opening[0][0] += 1;
    await writeFile(join(directory, 'rig.json'), JSON.stringify(rig));
    await page.goto('/');
    await dismissGuide(page);
    const folder = page.getByLabel('Open project folder files', { exact: true });
    await folder.setInputFiles(directory);
    await page.getByTestId('part-eyes').click();
    await page.getByText(`1 · Opening (${rig.eyes[0].opening.length})`, { exact: true }).click();
    const point = page.getByRole('spinbutton', { name: 'eyes.0.opening.0.0', exact: true });
    await expect(point).toHaveValue('447');
    await expect(page.locator('.stale')).toHaveCount(0);
    await point.fill('448');
    await expect(page.locator('.stale')).toContainText('This project is available in the project list.');
    await folder.setInputFiles(directory);
    await expect(page.locator('.stale')).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
