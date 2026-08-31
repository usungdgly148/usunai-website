import Taro from '@tarojs/taro';

export function fileToDataUrl(path: string, mimeType = 'application/octet-stream') {
  return new Promise<string>((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success(result) { resolve(`data:${mimeType};base64,${String(result.data || '')}`); },
      fail(error) { reject(new Error(error.errMsg || '读取文件失败')); },
    });
  });
}

export function runtimeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function collectMediaUrls(value: unknown) {
  const images = new Set<string>();
  const videos = new Set<string>();
  const visit = (entry: unknown, key = '') => {
    if (typeof entry === 'string') {
      const urls = entry.match(/https?:\/\/[^\s"'<>]+/g) || [];
      urls.forEach((url) => {
        const clean = url.replace(/[),.;]+$/, '');
        if (/\.(?:mp4|mov|m4v|webm)(?:\?|$)/i.test(clean) || /video/i.test(key)) videos.add(clean);
        else if (/\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(clean) || /image|picture|cover/i.test(key)) images.add(clean);
      });
      return;
    }
    if (Array.isArray(entry)) entry.forEach((item) => visit(item, key));
    else if (entry && typeof entry === 'object') Object.entries(entry).forEach(([name, item]) => visit(item, name));
  };
  visit(value);
  return { images: [...images], videos: [...videos] };
}
