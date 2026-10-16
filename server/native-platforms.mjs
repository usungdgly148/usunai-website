// 「原生模型」平台集合的唯一实现。
//
// 这些平台的共同点：对话由**服务端直连上游大模型**（不经 Coze）、
// 图片走服务端上传通道（小程序端返回 data-url 直通）、算力由服务端结算而非客户端预扣。
//
// ⚠️ 新增这类平台时只改这一个文件。目前有四处按它分流，漏改是**静默的**：
//   · server/index.mjs           —— /api/coze/chat 的平台分发
//   · server/miniapp-api.mjs     —— 下发给小程序的 supportsImages
//   · server/miniapp-runtime.mjs —— 小程序上传接口的 data-url 直通
//   · frontend/src/pages/Chat.jsx —— 附件数量、token 估算、预扣费与错误文案

export const DEEPSEEK_PLATFORM = 'deepseek-native';
// 外部大模型中转站（OpenAI 兼容协议）。Base URL 与 API Key 由「AI 授权管理」的
// relay 类型凭证集中提供，智能体只保存 authProviderId。
export const RELAY_PLATFORM = 'relay-native';

export const NATIVE_PLATFORMS = [DEEPSEEK_PLATFORM, RELAY_PLATFORM];

export function isNativePlatform(platform) {
  return NATIVE_PLATFORMS.includes(String(platform || ''));
}
