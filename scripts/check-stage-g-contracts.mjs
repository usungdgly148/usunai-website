import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { paginate, USER_PAGE_SIZE } from '../frontend/src/pagination.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

assert.equal(USER_PAGE_SIZE, 12, '用户侧列表每页应固定为 12 条');

const records = Array.from({ length: 25 }, (_, index) => index + 1);
assert.deepEqual(paginate(records, 1).items, records.slice(0, 12));
assert.deepEqual(paginate(records, 2).items, records.slice(12, 24));
assert.deepEqual(paginate(records, 3).items, records.slice(24));
assert.equal(paginate(records, 99).currentPage, 3, '数据减少后应修正越界页码');
assert.equal(paginate([], 2).currentPage, 1, '空列表应保持在第 1 页');

const pageContracts = [
  ['frontend/src/pages/Assets.jsx', 'pagedAssets.map'],
  ['frontend/src/pages/Orders.jsx', 'pagination.items.map'],
  ['frontend/src/pages/ComputeRecords.jsx', 'pagination.items.map'],
];

for (const [file, listNeedle] of pageContracts) {
  const source = await read(file);
  assert.ok(source.includes("from '../pagination.js'"), `${file} 应使用统一分页算法`);
  assert.ok(source.includes('<UserPagination'), `${file} 应渲染用户侧分页控制栏`);
  assert.ok(source.includes(listNeedle), `${file} 列表应渲染分页后的数据`);
  assert.ok(source.includes('setPage(1)'), `${file} 筛选条件变化时应重置页码`);
}

console.log('Stage G pagination contracts passed.');
