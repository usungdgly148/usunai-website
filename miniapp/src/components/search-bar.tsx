import Taro from '@tarojs/taro';
import { Input, View } from '@tarojs/components';

/**
 * 全局搜索框（放大镜 + 输入框 + 清除按钮）。
 *
 * 行为：
 * - onInput：每次输入触发（用于实时过滤）
 * - onSubmit：键盘「搜索」键触发（用于跳全局搜索页 / 提交查询）
 * - onTapIcon：点放大镜图标触发（可省；常用于「点图标跳搜索」场景）
 * - onClear：点右侧清除按钮触发；SearchBar 会先把 value 置空再回调
 *
 * 历史踩坑：原首页用的是 `⌕`（U+2315）字符当搜索图标，iOS/Android 系统字体
 * 几乎都不渲染这个冷门 Unicode，看不见也点不到。改用 PNG data URI（见
 * src/styles/ui-icons.scss，scripts/gen-ui-icons.js 生成）。
 */
export interface SearchBarProps {
  value: string;
  onInput: (value: string) => void;
  onSubmit?: () => void;
  onTapIcon?: () => void;
  onClear?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  showClear?: boolean;
  className?: string;
  inputClassName?: string;
  confirmType?: 'search' | 'done' | 'send' | 'go' | 'next';
}

export function SearchBar({
  value,
  onInput,
  onSubmit,
  onTapIcon,
  onClear,
  placeholder = '输入关键词搜索智能体和工作流',
  autoFocus = false,
  showClear = true,
  className,
  inputClassName,
  confirmType = 'search',
}: SearchBarProps) {
  const handleClear = () => {
    onInput('');
    onClear?.();
  };
  return (
    <View className={`mini-searchbar ${className || ''}`}>
      <View
        className='mini-searchbar-icon ui-icon-search'
        hoverClass={onTapIcon ? 'mini-searchbar-icon-hover' : undefined}
        onClick={() => onTapIcon?.()}
      />
      <Input
        className={`mini-searchbar-input ${inputClassName || ''}`}
        value={value}
        placeholder={placeholder}
        placeholderClass='mini-searchbar-placeholder'
        confirmType={confirmType}
        autoFocus={autoFocus}
        onInput={(event) => onInput(event.detail.value)}
        onConfirm={() => onSubmit?.()}
      />
      {showClear && value ? (
        <View
          className='mini-searchbar-clear ui-icon-clear'
          hoverClass='mini-searchbar-clear-hover'
          onClick={handleClear}
        />
      ) : null}
    </View>
  );
}

/** 工具：把当前关键词拼上 q 参数跳到全局搜索页（q 为空也允许跳转，搜索页会展示全量结果） */
export function gotoGlobalSearch(query?: string) {
  const trimmed = (query || '').trim();
  void Taro.navigateTo({
    url: `/pages/search/index${trimmed ? `?q=${encodeURIComponent(trimmed)}` : ''}`,
  });
}
