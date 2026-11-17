import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [
  ['frontend/src/store.jsx', ["tutorialTitle: '新手使用教程'", "tutorialImage: ''", "tutorialUrl: ''"]],
  ['frontend/src/adminUI.jsx', ['export function TutorialSettings', 'aspect-[21/9]', 'maxWidth: 512', 'maxWidth: 840', 'formatImageBytes', 'tryUploadToBlob(processed, { admin: true })']],
  // 2026-10-28 修正：编码格式已从写死 webp 改为 mimeType 参数（默认仍是 webp），断言随之对齐真实契约
  ['frontend/src/imageCompress.js', ["mimeType = 'image/webp',", "canvas.toBlob(resolve, mimeType, quality)", "file.type === 'image/gif' || file.type === 'image/svg+xml'", 'maxHeight / img.height']],
  ['server/index.mjs', ["contentType.startsWith('image/') ? 5 * 1024 * 1024 : 25 * 1024 * 1024"]],
  ['frontend/src/blobUpload.js', ['adminFetch', 'const authenticatedFetch = admin ? adminFetch : apiFetch', 'authenticatedFetch(data.url']],
  ['frontend/src/store.jsx', ['const onUserUnauthorized', 'const onAdminUnauthorized', "addEventListener('usun:unauthorized', onUserUnauthorized)", "addEventListener('usun:admin-unauthorized', onAdminUnauthorized)"]],
  ['frontend/src/innerUI.jsx', ["aspectRatio: '21 / 9'", 'mobileActionTitle', 'SlidersHorizontal']],
  // 2026-11-17 卡片改版：旧断言是 featured 卡「图标绝对定位在左下」（md:left-4 md:top-auto），
  // 该封面块已按主人要求整体取消（图标移到名称上方左侧、卡片高度统一降低 25%）。
  // 现在改为守「卡片高度统一」的三段定高 + 标签行，防止有人把 h-[39px] / h-[21px] 换回 min-h 或 flex-1
  // ——那样一来「带标签 / 不带标签」「一行描述 / 两行描述」的卡片就会重新差出 3~4px，同页两种高度。
  ['frontend/src/components.jsx', ['(item.tags || []).slice(0, 3)', 'h-[39px]', 'h-[21px]', 'formatCount(item.uses)']],
  ['frontend/src/pages/Home.jsx', ['[refreshAllConfig, activeCat]', 'snap-x snap-mandatory', 'min-w-[82vw]']],
  ['frontend/src/pages/Workflow.jsx', ["useState(true)", "mobileActionTitle={mobileConfigView ? '历史记录' : '配置参数'}", 'inner-page-shell']],
  ['frontend/src/pages/Chat.jsx', ["matchMedia('(max-width: 767px)')", '添加附件或图片', 'inner-page-shell']],
  ['frontend/src/index.css', ['@supports (height: 100svh)', '@media (min-width: 768px)', 'calc(100dvh - 64px)']],
  ['frontend/src/pages/AgentList.jsx', ['[refreshAllConfig, activeCat]']],
];

const missing = [];
for (const [file, needles] of checks) {
  const source = read(file);
  for (const needle of needles) if (!source.includes(needle)) missing.push(`${file}: ${needle}`);
}

if (missing.length) {
  console.error('Stage C contract check failed:\n' + missing.map(item => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log('Stage C frontend experience contract check passed.');
