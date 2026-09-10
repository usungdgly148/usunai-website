#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 TDesign 图标字体子集并输出 src/styles/td-icon-font.scss

背景：tdesign-miniprogram 的 <t-icon> 通过 @font-face 从腾讯 CDN 加载字体
（https://tdesign.gtimg.com/icon/0.4.3/fonts/t.woff），小程序里加载不到 →
官方组件的图标会全部空白。项目做法是把用到的字形子集化后 base64 内联进 wxss。

本脚本：
  1. 解析 node_modules 里 icon.wxss 的 `.t-icon-<name>:before{content:'\\EXXX'}` 表；
  2. 扫描项目实际会用到的官方组件源码（chat-*、attachments 等），
     把其中出现的图标名 + src/components/td-icon.tsx 里已有的字形全部收集起来；
  3. 用 fonttools 的 pyftsubset 做子集化（woff）；
  4. 写出 src/styles/td-icon-font.scss（含 @font-face，勿手改）。

依赖：pip install fonttools brotli
用法：python scripts/gen-td-icon-font.py
"""
import base64
import io
import json
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TD = os.path.join(ROOT, 'node_modules', 'tdesign-miniprogram', 'miniprogram_dist')
ICON_CSS = os.path.join(TD, 'icon', 'icon.wxss')
TD_ICON_TSX = os.path.join(ROOT, 'src', 'components', 'td-icon.tsx')
OUT_SCSS = os.path.join(ROOT, 'src', 'styles', 'td-icon-font.scss')
CACHE_TTF = os.path.join(ROOT, 'node_modules', '.cache-tdesign-icon', 't.ttf')
FONT_URL = 'https://tdesign.gtimg.com/icon/0.4.3/fonts/t.ttf'

# 项目会用到的官方组件（扫描其中出现的图标名）
SCAN_DIRS = ['chat-sender', 'chat-actionbar', 'chat-message', 'chat-content',
             'chat-thinking', 'chat-loading', 'chat-markdown', 'attachments',
             'popover', 'icon']


def parse_icon_map():
    css = open(ICON_CSS, encoding='utf-8').read()
    pat = re.compile(r"\.t-icon-([a-zA-Z0-9\-]+):before\s*\{\s*content:\s*'\\([0-9A-Fa-f]+)'")
    return {name: code.upper() for name, code in pat.findall(css)}


def collect_used_names(valid_names):
    """扫描组件源码，收集出现的图标名（含动态拼接的静态字面量）。"""
    used = set()
    blobs = []
    for d in SCAN_DIRS:
        target = os.path.join(TD, d)
        if not os.path.isdir(target):
            continue
        for base, _dirs, files in os.walk(target):
            for f in files:
                if f.endswith(('.wxml', '.js', '.wxs')):
                    blobs.append(open(os.path.join(base, f), encoding='utf-8', errors='ignore').read())
    text = '\n'.join(blobs)
    # 组件里图标名都以字符串字面量出现（含 iconMap、fileIcon 映射等）
    for m in re.finditer(r"['\"]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['\"]", text):
        name = m.group(1)
        if name in valid_names:
            used.add(name)
    return used


def collect_existing_glyphs():
    """td-icon.tsx 里已有的码点必须保留，否则现有 TdIcon 会变空白。"""
    src = open(TD_ICON_TSX, encoding='utf-8').read()
    return {c.upper() for c in re.findall(r"\\u(E[0-9A-Fa-f]{3})", src)}


def ensure_ttf():
    if os.path.exists(CACHE_TTF) and os.path.getsize(CACHE_TTF) > 100_000:
        return CACHE_TTF
    os.makedirs(os.path.dirname(CACHE_TTF), exist_ok=True)
    print('下载 TDesign 图标字体 …')
    urllib.request.urlretrieve(FONT_URL, CACHE_TTF)
    return CACHE_TTF


def subset(ttf_path, codepoints, out_woff):
    from fontTools import subset as ft_subset  # noqa
    args = [
        ttf_path,
        '--unicodes=' + ','.join('U+' + c for c in sorted(codepoints)),
        '--flavor=woff',
        '--layout-features=',
        '--no-hinting',
        '--desubroutinize',
        '--output-file=' + out_woff,
    ]
    try:
        from fontTools.subset import main as ft_main
    except Exception:
        pass
    try:
        subprocess.run([sys.executable, '-m', 'fontTools.subset'] + args, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as e:
        raise SystemExit('pyftsubset 失败: ' + e.stderr.decode('utf-8', 'ignore'))


def main():
    icon_map = parse_icon_map()
    print('icon.wxss 图标总数:', len(icon_map))

    used_names = collect_used_names(set(icon_map))
    existing = collect_existing_glyphs()

    names = set()
    for n in sorted(used_names):
        names.add(n)
    # 兜底常用图标（组件里动态引用、脚本扫不到的）
    for n in ['add', 'close', 'send', 'send-filled', 'image', 'camera', 'file-add',
              'copy', 'replay', 'refresh', 'thumb-up', 'thumb-down', 'multiply',
              'bookmark-add', 'check', 'delete',
              'close-circle-filled', 'ellipsis', 'chevron-down', 'time',
              'info-circle', 'play', 'play-circle', 'pause-circle',
              # td-icon.tsx 自绘图标（脚本扫不到，须显式登记）
              'chat', 'control-platform', 'check-circle', 'copy', 'image', 'video']:
        if n in icon_map:
            names.add(n)

    codes = {icon_map[n] for n in names if n in icon_map} | existing
    print('收集到图标名', len(names), '个，去重后码点', len(codes), '个')

    ttf = ensure_ttf()
    tmp_woff = os.path.join(os.path.dirname(CACHE_TTF), 'subset.woff')
    subset(ttf, codes, tmp_woff)
    data = open(tmp_woff, 'rb').read()
    b64 = base64.b64encode(data).decode('ascii')
    print('子集字体', len(data), 'bytes → base64', len(b64), 'chars')

    header = ('/* TDesign 图标字体子集（本地内嵌，微信离线可渲染）\n'
              '   由 scripts/gen-td-icon-font.py 生成，勿手改。\n'
              '   码点对应 tdesign-miniprogram 0.4.3 的 icon/icon.wxss；\n'
              '   字形数：%d */\n' % len(codes))
    body = ("@font-face {\n  font-family: 'td-icons';\n"
            "  src: url(\"data:font/woff;charset=utf-8;base64,%s\") format('woff');\n"
            "  font-weight: 400;\n  font-style: normal;\n}\n" % b64)
    os.makedirs(os.path.dirname(OUT_SCSS), exist_ok=True)
    with open(OUT_SCSS, 'w', encoding='utf-8', newline='\n') as f:
        f.write(header + body)
    print('已写入', os.path.relpath(OUT_SCSS, ROOT))
    json.dump({'codepoints': sorted(codes), 'names': sorted(names)},
              open(os.path.join(os.path.dirname(CACHE_TTF), 'manifest.json'), 'w'),
              ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
