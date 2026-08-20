import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const store = read('frontend/src/store.jsx');
const server = read('server/index.mjs');
const app = read('frontend/src/App.jsx');

const failures = [];
const requireText = (source, text, label) => {
  if (!source.includes(text)) failures.push(label);
};
const rejectText = (source, text, label) => {
  if (source.includes(text)) failures.push(label);
};

requireText(store, "body: JSON.stringify({ item })", '资产必须按单条 item 保存');
requireText(store, "'/api/data/assets/delete'", '资产删除必须使用服务端删除接口');
requireText(server, "body && body.item", '服务端必须支持单条资产幂等合并');
requireText(server, "existing.findIndex", '服务端资产保存必须按 id 去重');

const deductBlock = store.slice(store.indexOf('const deductPoints ='), store.indexOf('const rechargePoints ='));
rejectText(deductBlock, "tryWriteSingleKey('compute'", '前端扣费不得再次写算力流水');
rejectText(deductBlock, 'setComputeRecords(prev => [record', '前端扣费不得新增重复流水');
requireText(store, "'/api/compute/deduct'", '扣费后必须读取服务端权威余额');
requireText(server, 'serverBilled: true', '普通用户扣费同步接口必须只返回服务端已计费状态');

requireText(store, "'/api/admin/users/adjust-points'", '后台调整必须调用原子接口');
requireText(server, 'kvAdminAdjustPoints', '服务端必须原子保存余额、流水和订单');
requireText(server, "await KV.kvGet('computePackages')", '套餐调整必须读取服务器套餐配置');
requireText(server, "'rechargeInfo'", '提示信息必须列入服务器配置键');
requireText(server, "'legalAgreements'", '政策协议必须列入服务器配置键');

for (const file of ['AdminUsers.jsx', 'AdminAssets.jsx', 'AdminCompute.jsx', 'AdminOrders.jsx']) {
  const source = read(`frontend/src/pages/${file}`);
  requireText(source, 'const pageSize = 10;', `${file} 必须每页 10 条`);
  requireText(source, '<AdminPagination', `${file} 必须渲染分页控件`);
}

requireText(app, '/admin/legal-agreements', '后台政策协议路由缺失');
requireText(app, "setOpenAgreement('privacy')", '前端隐私政策弹窗入口缺失');
requireText(app, "setOpenAgreement('terms')", '前端服务条款弹窗入口缺失');
requireText(app, 'ReactMarkdown', '政策协议 Markdown 渲染缺失');

if (failures.length) {
  console.error('Stage A contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Stage A contract check passed.');
