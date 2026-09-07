import { ScrollView, Text, View } from '@tarojs/components';
import type { ReactNode } from 'react';

export interface TableColumn {
  key: string;
  label: string;
  /** 列宽（design px，pxtransform 不处理内联样式，故直接写 rpx 单位） */
  width: number;
}

/**
 * 横向滚动数据表：与网页端移动端「overflow-x-auto 表格」一致。
 * 列宽固定（超出屏幕时左右滑动查看），表头与数据行同容器一起滚动，保证列对齐。
 */
export function HScrollTable({ columns, rows, rowKey, renderCell }: {
  columns: TableColumn[];
  rows: Array<Record<string, unknown>>;
  rowKey: (row: Record<string, unknown>, index: number) => string;
  renderCell: (row: Record<string, unknown>, col: TableColumn) => ReactNode;
}) {
  // 表总宽 = 列宽之和 + 左右 24px 内边距
  const totalWidth = columns.reduce((sum, col) => sum + col.width, 0) + 48;
  return (
    <>
      <Text className='mini-table-swipe-hint'>左右滑动查看更多列</Text>
      <ScrollView className='mini-table-scroll' scrollX enableFlex showScrollbar={false}>
        <View className='mini-table' style={{ width: `${totalWidth}rpx` }}>
          <View className='mini-table-head'>
            {columns.map((col) => (
              <Text key={col.key} className='mini-table-th' style={{ width: `${col.width}rpx` }}>{col.label}</Text>
            ))}
          </View>
          {rows.map((row, index) => (
            <View key={rowKey(row, index)} className='mini-table-row'>
              {columns.map((col) => (
                <View key={col.key} className='mini-table-cell' style={{ width: `${col.width}rpx` }}>{renderCell(row, col)}</View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

export default HScrollTable;
