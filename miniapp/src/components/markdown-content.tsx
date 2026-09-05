import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';

type MarkdownBlock = {
  type: 'heading' | 'paragraph' | 'bullet' | 'ordered' | 'quote' | 'divider';
  value?: string;
  marker?: string;
  level?: number;
};

interface MarkdownContentProps {
  value?: string;
  className?: string;
  /** 文本是否可长按选中复制 */
  selectable?: boolean;
}

const INLINE_TOKEN_RE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function InlineMarkdown({ value, selectable }: { value: string; selectable?: boolean }) {
  const parts = value.split(INLINE_TOKEN_RE).filter(Boolean);

  return (
    <Text className='mini-markdown-inline' userSelect={selectable}>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <Text key={index} className='mini-markdown-token-bold' userSelect={selectable}>{part.slice(2, -2)}</Text>;
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return <Text key={index} className='mini-markdown-token-code' userSelect={selectable}>{part.slice(1, -1)}</Text>;
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <Text key={index} className='mini-markdown-token-italic' userSelect={selectable}>{part.slice(1, -1)}</Text>;
        }
        const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (link) {
          return (
            <Text
              key={index}
              className='mini-markdown-token-link'
              userSelect={selectable}
              onClick={() => Taro.setClipboardData({ data: link[2] })}
            >
              {link[1]}
            </Text>
          );
        }
        return <Text key={index} userSelect={selectable}>{part}</Text>;
      })}
    </Text>
  );
}

function parseBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', value: paragraph.join('\n') });
      paragraph = [];
    }
  };

  source.replace(/\r\n?/g, '\n').split('\n').forEach((rawLine) => {
    const value = rawLine.trim();
    if (!value) {
      flushParagraph();
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(value)) {
      flushParagraph();
      blocks.push({ type: 'divider' });
      return;
    }

    const heading = value.match(/^(#{1,6})\s+(.+)$/);
    const quote = value.match(/^>\s?(.+)$/);
    const ordered = value.match(/^(\d+)[.、]\s+(.+)$/);
    const bullet = value.match(/^[-*+]\s+(.+)$/);

    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', value: heading[2], level: Math.min(heading[1].length, 3) });
    } else if (quote) {
      flushParagraph();
      blocks.push({ type: 'quote', value: quote[1] });
    } else if (ordered) {
      flushParagraph();
      blocks.push({ type: 'ordered', marker: `${ordered[1]}.`, value: ordered[2] });
    } else if (bullet) {
      flushParagraph();
      blocks.push({ type: 'bullet', marker: '•', value: bullet[1] });
    } else {
      paragraph.push(value);
    }
  });

  flushParagraph();
  return blocks;
}

export function MarkdownContent({ value, className, selectable }: MarkdownContentProps) {
  const markdownClass = ['mini-markdown', className].filter(Boolean).join(' ');

  return (
    <View className={markdownClass}>
      {parseBlocks(value || '').map((block, index) => (
        <View key={index} className='mini-markdown-block'>
          {block.type === 'divider' && <View className='mini-markdown-divider' />}
          {block.type === 'heading' && (
            <View className={`mini-markdown-heading mini-markdown-heading-${block.level || 2}`}>
              <InlineMarkdown value={block.value || ''} selectable={selectable} />
            </View>
          )}
          {block.type === 'quote' && (
            <View className='mini-markdown-quote'>
              <InlineMarkdown value={block.value || ''} selectable={selectable} />
            </View>
          )}
          {(block.type === 'bullet' || block.type === 'ordered') && (
            <View className='mini-markdown-list-item'>
              <Text className='mini-markdown-marker'>{block.marker}</Text>
              <InlineMarkdown value={block.value || ''} selectable={selectable} />
            </View>
          )}
          {block.type === 'paragraph' && (
            <Text className='mini-markdown-paragraph' userSelect={selectable}>
              <InlineMarkdown value={block.value || ''} selectable={selectable} />
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
