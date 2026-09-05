import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_CATEGORY_OPTIONS, resolveAssetCategory } from '../frontend/src/assetUtils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

assert.deepEqual(
  ASSET_CATEGORY_OPTIONS.filter((item) => item.value).map((item) => item.value),
  ['copy', 'image', 'video', 'audio', 'graphic'],
  'asset category choices must match the five existing asset tabs',
);
assert.equal(resolveAssetCategory('video', 'copy'), 'video');
assert.equal(resolveAssetCategory('', 'graphic'), 'graphic');
assert.equal(resolveAssetCategory('invalid', 'image'), 'image');

for (const file of ['frontend/src/pages/AdminAgentEdit.jsx', 'frontend/src/pages/AdminWorkflowEdit.jsx']) {
  const source = read(file);
  assert.match(source, /assetCategory:\s*''/, `${file} must initialize assetCategory`);
  assert.match(source, /ASSET_CATEGORY_OPTIONS\.map/, `${file} must render all asset category choices`);
}

for (const file of ['frontend/src/pages/Chat.jsx', 'frontend/src/pages/Workflow.jsx']) {
  const source = read(file);
  assert.match(source, /resolveAssetCategory\([^,]+\.assetCategory,/, `${file} must apply the configured category when saving assets`);
}

console.log('Asset category routing checks passed.');
