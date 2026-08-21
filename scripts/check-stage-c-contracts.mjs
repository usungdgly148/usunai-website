import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [
  ['frontend/src/store.jsx', ["tutorialTitle: '新手使用教程'", "tutorialImage: ''", "tutorialUrl: ''"]],
  ['frontend/src/adminUI.jsx', ['export function TutorialSettings', 'aspect-[21/9]', 'maxWidth: 512', 'maxWidth: 1680', 'formatImageBytes', 'tryUploadToBlob(processed, { admin: true })']],
  ['frontend/src/imageCompress.js', ["canvas.toBlob(resolve, 'image/webp', quality)", "file.type === 'image/gif' || file.type === 'image/svg+xml'", 'maxHeight / img.height']],
  ['server/index.mjs', ["contentType.startsWith('image/') ? 5 * 1024 * 1024 : 25 * 1024 * 1024"]],
  ['frontend/src/blobUpload.js', ['adminFetch', 'const authenticatedFetch = admin ? adminFetch : apiFetch', 'authenticatedFetch(data.url']],
  ['frontend/src/store.jsx', ['const onUserUnauthorized', 'const onAdminUnauthorized', "addEventListener('usun:unauthorized', onUserUnauthorized)", "addEventListener('usun:admin-unauthorized', onAdminUnauthorized)"]],
  ['frontend/src/innerUI.jsx', ["aspectRatio: '21 / 9'", 'mobileActionTitle', 'SlidersHorizontal']],
  ['frontend/src/components.jsx', ['(item.tags || []).slice(0, 3)', 'md:left-4 md:top-auto', 'formatCount(item.uses)']],
  ['frontend/src/pages/Home.jsx', ['[refreshAllConfig, activeCat]', 'snap-x snap-mandatory', 'min-w-[82vw]']],
  ['frontend/src/pages/Workflow.jsx', ["useState(true)", "mobileActionTitle={mobileConfigView ? '历史记录' : '配置参数'}", "calc(100dvh - 64px)"]],
  ['frontend/src/pages/Chat.jsx', ["matchMedia('(max-width: 767px)')", '添加附件或图片', "calc(100dvh - 64px)"]],
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
