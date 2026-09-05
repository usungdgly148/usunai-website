import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MINIAPP_LAYOUT_TYPES,
  defaultMiniappLayout,
  publishMiniappLayout,
  resolveMiniappLayout,
  rollbackMiniappLayout,
  saveMiniappLayoutDraft,
  validateMiniappLayout,
} from '../server/miniapp-layout.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const values = new Map();
const KV = {
  async kvGet(key) { return values.get(key); },
  async kvPut(key, value) { values.set(key, value); },
  async kvPutMany(entries) { for (const [key, value] of entries) values.set(key, value); },
};

assert.deepEqual([...MINIAPP_LAYOUT_TYPES], [
  'carousel', 'announcements', 'search', 'categories',
  'featured-agents', 'featured-workflows', 'quick-links', 'spacer',
]);

for (const page of ['home', 'category']) {
  const initial = validateMiniappLayout(defaultMiniappLayout(page), page);
  assert.equal(initial.page, page);
  assert.ok(initial.blocks.length > 0);
}

for (const type of ['cases', 'rich-text', 'image', 'cta']) {
  assert.throws(() => validateMiniappLayout({ page: 'home', blocks: [{ id: type, type }] }, 'home'));
}
assert.throws(() => validateMiniappLayout({ page: 'home', blocks: [{ id: 'bad-link', type: 'search', link: 'javascript:alert(1)' }] }, 'home'));

const firstDraft = defaultMiniappLayout('home');
firstDraft.blocks[0].title = '第一版';
await saveMiniappLayoutDraft(KV, 'home', firstDraft);
const first = await publishMiniappLayout(KV, 'home');

const secondDraft = structuredClone(firstDraft);
secondDraft.blocks[0].title = '第二版';
secondDraft.blocks.push({ id: 'custom-space', type: 'spacer', visible: true, spacing: 32 });
const second = await publishMiniappLayout(KV, 'home', secondDraft);
assert.notEqual(first.id, second.id);
assert.equal((await resolveMiniappLayout(KV, 'home')).layout.blocks[0].title, '第二版');

const rollback = await rollbackMiniappLayout(KV, 'home', first.id);
assert.match(rollback.note, /^回滚自/);
assert.equal((await resolveMiniappLayout(KV, 'home')).layout.blocks[0].title, '第一版');

const versions = values.get('miniapp_layout_versions_home');
values.set('miniapp_layout_versions_home', [{ id: 'broken', layout: { page: 'home', blocks: [{ id: 'x', type: 'cta' }] } }, ...versions]);
values.set('miniapp_layout_published_home', 'broken');
const recovered = await resolveMiniappLayout(KV, 'home');
assert.equal(recovered.source, 'history');
assert.notEqual(recovered.versionId, 'broken');

const server = read('server/index.mjs');
const admin = read('frontend/src/pages/AdminMiniappDesign.jsx');
const app = read('frontend/src/App.jsx');
const nav = read('frontend/src/adminUI.jsx');
const renderer = read('miniapp/src/components/layout-blocks.tsx');
const miniappApi = read('miniapp/src/services/api.ts');
assert.match(server, /handleMiniappLayout/);
assert.match(app, /admin\/miniapp-design/);
assert.match(nav, /小程序设计/);
assert.match(admin, /保存草稿/);
assert.match(admin, />发布(?:布局)?<\/button>/);
assert.match(admin, /回滚/);
assert.match(admin, /draggable/);
assert.match(renderer, /featured-agents/);
assert.match(renderer, /featured-workflows/);
assert.match(renderer, /quick-links/);
assert.match(miniappApi, /\/api\/miniapp\/v1\/layout/);

console.log('miniapp stage 5 visual layout contracts: ok');
