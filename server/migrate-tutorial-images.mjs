// 一次性迁移历史教程图：将内联 data URL 改存为站内 21:9 WebP 文件。
// 使用：在生产服务器执行 node server/migrate-tutorial-images.mjs
// 脚本可重复执行；已迁移为站内文件的记录会自动跳过。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.USUN_DATA_DIR ? path.resolve(process.env.USUN_DATA_DIR) : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'usun.db');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DATA_IMAGE = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i;

if (!fs.existsSync(DB_PATH)) throw new Error('未找到运行时数据库');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 5000');
const read = db.prepare('SELECT value FROM kv WHERE key = ?');
const write = db.prepare('UPDATE kv SET value = ? WHERE key = ?');
let migrated = 0;

for (const key of ['agents', 'workflows']) {
  const row = read.get(key);
  if (!row) continue;
  const value = JSON.parse(row.value);
  const items = Array.isArray(value) ? value : Object.values(value || {});
  let changed = false;

  for (const item of items) {
    const match = DATA_IMAGE.exec(String(item?.tutorialImage || ''));
    if (!match) continue;
    const source = Buffer.from(match[1], 'base64');
    const name = `tutorial-${Date.now()}-${crypto.randomUUID()}.webp`;
    const target = path.join(UPLOAD_DIR, name);
    const temporary = `${target}.tmp`;
    await sharp(source, { animated: false })
      .rotate()
      .resize({ width: 840, height: 360, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toFile(temporary);
    fs.renameSync(temporary, target);
    item.tutorialImage = `/api/blob/serve?key=${encodeURIComponent(`uploads/${name}`)}`;
    changed = true;
    migrated += 1;
  }

  if (changed) write.run(JSON.stringify(value, null, 2), key);
}

db.close();
console.log(`migrated tutorial images: ${migrated}`);
