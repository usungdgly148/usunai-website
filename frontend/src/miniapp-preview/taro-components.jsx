import React from 'react';

/**
 * `@tarojs/components` 在后台画布里的替身（由 vite.config.js 的 alias 指过来）。
 *
 * 用 `<view>` `<text>` `<image>` 这类自定义元素渲染，元素名跟小程序 WXML 对齐 ——
 * app.scss 里 `view, text, input, textarea, button, image { box-sizing: border-box }`
 * 这类元素选择器在画布上照样成立，不用为「浏览器标签」另写一套。
 *
 * 只做三件事：剥掉小程序专有属性、补上浏览器没有的默认盒行为、把事件对象
 * 适配成 Taro 的 `event.detail.value` 形状。样式一律交给生成出来的
 * miniappPreview.css + adapter.css，这里不写任何业务样式。
 */

/** 小程序专有 / 不落到 DOM 的 props（留着会被 React 当属性写进标签） */
const TARO_ONLY_PROPS = new Set([
  'hoverClass', 'hoverStyle', 'hoverStartTime', 'hoverStayTime',
  'mode', 'lazyLoad', 'webp', 'showMenuByLongpress',
  'indicatorDots', 'indicatorColor', 'indicatorActiveColor', 'autoplay', 'circular', 'vertical',
  'scrollX', 'scrollY', 'scrollTop', 'scrollLeft', 'scrollWithAnimation', 'enhanced', 'enableFlex',
  'placeholderStyle', 'placeholderClass', 'confirmType', 'confirmHold', 'adjustPosition',
  'autoFocus', 'cursorSpacing', 'selectionStart', 'selectionEnd', 'disableDefaultPadding',
  'holdKeyboard', 'maxlength', 'nativeProps', 'emptyValue', 'scrollIntoView',
]);

function domProps(props, extraDrop = []) {
  const out = {};
  for (const key of Object.keys(props)) {
    if (TARO_ONLY_PROPS.has(key) || extraDrop.includes(key)) continue;
    out[key] = props[key];
  }
  return out;
}

export const View = ({ className = '', style, children, ...rest }) => (
  <view className={className} style={style} {...domProps(rest)}>{children}</view>
);

export const Text = ({ className = '', style, children, ...rest }) => (
  <text className={className} style={style} {...domProps(rest)}>{children}</text>
);

export const ScrollView = ({ className = '', style, children, ...rest }) => (
  <scroll-view className={className} style={style} {...domProps(rest)}>{children}</scroll-view>
);

/**
 * 小程序 `<image>`：外层元素承接 class/尺寸（`.mini-category-picture` 这类规则挂在它身上），
 * 里面套一个铺满的 `<img>` 承载真实位图。`mode='aspectFill'` → object-fit: cover。
 */
export const Image = ({ className = '', style, src, mode = 'scaleToFill' }) => (
  <image className={className} style={style}>
    <img
      src={src}
      alt=""
      style={{
        width: '100%',
        height: '100%',
        objectFit: mode === 'aspectFill' ? 'cover' : 'contain',
      }}
    />
  </image>
);

/**
 * 轮播：画布不需要自动播放，只把第一帧显示出来（跟真机静止时看到的完全一样），
 * 但把 `indicatorDots` 那排白点补上 —— 指示点是 hero 观感的一部分。
 */
export const Swiper = ({ className = '', style, children, indicatorDots, indicatorColor, indicatorActiveColor }) => {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <swiper className={className} style={style}>
      {items[0]}
      {indicatorDots && items.length > 1 ? (
        <view className='miniapp-preview-dots'>
          {items.map((_item, index) => (
            <i
              key={index}
              style={{ background: index === 0
                ? (indicatorActiveColor || '#ffffff')
                : (indicatorColor || 'rgba(255,255,255,.45)') }}
            />
          ))}
        </view>
      ) : null}
    </swiper>
  );
};

export const SwiperItem = ({ className = '', style, children, ...rest }) => (
  <swiper-item className={className} style={style} {...domProps(rest)}>{children}</swiper-item>
);

/**
 * 输入框 → 浏览器原生 `<input>`。真机 `<input>` 没有默认边框，这里也靠 adapter.css 抹掉。
 * 画布里的输入框设成 readOnly：后台不需要在预览里打字，误触反而会让人以为改了真机。
 */
export const Input = ({ className = '', style, value, placeholder, onInput, onConfirm, ...rest }) => (
  <input
    className={className}
    style={style}
    value={value ?? ''}
    placeholder={placeholder}
    readOnly
    onChange={(event) => onInput?.({ detail: { value: event.target.value } })}
    onKeyDown={(event) => { if (event.key === 'Enter') onConfirm?.(); }}
    {...domProps(rest)}
  />
);

export const Textarea = ({ className = '', style, value, placeholder, ...rest }) => (
  <textarea className={className} style={style} value={value ?? ''} placeholder={placeholder} readOnly {...domProps(rest)} />
);

export const Button = ({ className = '', style, children, ...rest }) => (
  <button type='button' className={className} style={style} {...domProps(rest)}>{children}</button>
);

/** 兜底：渲染器用到但这里没实现的组件，渲染成空元素而不是崩掉整个画布 */
export function createUnsupported(name) {
  return ({ className = '', style }) => {
    if (typeof console !== 'undefined') console.warn(`[miniapp-preview] 画布未实现的组件：<${name}>`);
    return <view className={className} style={style} />;
  };
}
