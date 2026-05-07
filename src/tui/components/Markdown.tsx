/**
 * 轻量级 Markdown → Ink 渲染。不是完整 markdown 解析器，只处理常见的：
 *
 * 块级：
 *   # / ## / ###  标题（加粗 / 加色）
 *   - / *         bullet
 *   1.            有序列表
 *   ```           fenced code（全段 dim + 浅灰）
 *   空行          保留
 *
 * 行内：
 *   **bold**      加粗
 *   *italic* / _italic_   斜体
 *   `code`        cyan dimColor
 *
 * 不渲染：链接、图片、表格、HTML —— 以后再加。
 *
 * 设计原则：**不吞任何原文**。解析失败的 token 原样显示，不要让用户困惑。
 */

import React from 'react';
import { Box, Text } from 'ink';

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => (
        <BlockRow key={i} block={b} />
      ))}
    </Box>
  );
}

// ─── 块级 ──────────────────────────────────────

type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'bullet'; indent: number; text: string }
  | { kind: 'numbered'; indent: number; marker: string; text: string }
  | { kind: 'code'; lang: string; body: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'quote'; text: string }
  | { kind: 'blank' }
  | { kind: 'p'; text: string };

export function parseBlocks(src: string): Block[] {
  const lines = src.split(/\r?\n/);
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? '';
      i++;
      const bodyLines: string[] = [];
      while (i < lines.length && !(lines[i] ?? '').match(/^```\s*$/)) {
        bodyLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++; // 吃掉 closing ```
      out.push({ kind: 'code', lang, body: bodyLines.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      out.push({ kind: 'blank' });
      i++;
      continue;
    }

    // 表格：当前行像 |a|b|c| 且下一行是 |---|---|---|
    if (line.includes('|') && i + 1 < lines.length) {
      const sep = lines[i + 1] ?? '';
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(sep) && sep.includes('-')) {
        const header = splitTableRow(line);
        if (header.length > 0) {
          const rows: string[][] = [];
          let j = i + 2;
          while (j < lines.length) {
            const r = lines[j] ?? '';
            if (!r.includes('|') || r.trim() === '') break;
            const cells = splitTableRow(r);
            if (cells.length === 0) break;
            rows.push(cells);
            j++;
          }
          out.push({ kind: 'table', header, rows });
          i = j;
          continue;
        }
      }
    }

    // blockquote：> 开头
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      out.push({ kind: 'quote', text: quote[1] ?? '' });
      i++;
      continue;
    }

    const h3 = line.match(/^###\s+(.*)$/);
    if (h3) {
      out.push({ kind: 'h3', text: h3[1] ?? '' });
      i++;
      continue;
    }
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      out.push({ kind: 'h2', text: h2[1] ?? '' });
      i++;
      continue;
    }
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) {
      out.push({ kind: 'h1', text: h1[1] ?? '' });
      i++;
      continue;
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) {
      out.push({ kind: 'bullet', indent: (bullet[1] ?? '').length, text: bullet[2] ?? '' });
      i++;
      continue;
    }

    const num = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (num) {
      out.push({
        kind: 'numbered',
        indent: (num[1] ?? '').length,
        marker: num[2] ?? '1.',
        text: num[3] ?? '',
      });
      i++;
      continue;
    }

    out.push({ kind: 'p', text: line });
    i++;
  }
  return out;
}

function BlockRow({ block }: { block: Block }) {
  switch (block.kind) {
    case 'h1':
      return <Text bold color="white" underline>{'# ' + block.text}</Text>;
    case 'h2':
      return <Text bold color="cyan">{block.text}</Text>;
    case 'h3':
      return <Text bold>{block.text}</Text>;
    case 'bullet':
      return (
        <Box>
          <Text dimColor>{' '.repeat(block.indent)}•{' '}</Text>
          <Inline text={block.text} />
        </Box>
      );
    case 'numbered':
      return (
        <Box>
          <Text dimColor>{' '.repeat(block.indent)}{block.marker}{' '}</Text>
          <Inline text={block.text} />
        </Box>
      );
    case 'code':
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {block.body.split(/\r?\n/).map((line, i) => (
            <Text key={i} color="cyan" dimColor>{line || ' '}</Text>
          ))}
        </Box>
      );
    case 'blank':
      return <Text> </Text>;
    case 'quote':
      return (
        <Box>
          <Text color="gray">│ </Text>
          <Text dimColor italic><Inline text={block.text} /></Text>
        </Box>
      );
    case 'table':
      return <TableBlock header={block.header} rows={block.rows} />;
    case 'p':
      return <Inline text={block.text} />;
  }
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, '');
  return trimmed.split('|').map((c) => c.trim());
}

function TableBlock({ header, rows }: { header: string[]; rows: string[][] }) {
  const numCols = Math.max(header.length, ...rows.map((r) => r.length));
  // 列宽 = 该列里最长 cell 的可见宽度，最少 3
  const widths: number[] = [];
  for (let c = 0; c < numCols; c++) {
    let max = visibleWidth(header[c] ?? '');
    for (const row of rows) max = Math.max(max, visibleWidth(row[c] ?? ''));
    widths.push(Math.max(3, max));
  }
  const padCell = (s: string, w: number): string => {
    const vw = visibleWidth(s);
    return s + ' '.repeat(Math.max(0, w - vw));
  };
  const sepLine = '─'.repeat(widths.reduce((a, b) => a + b + 3, 1));
  return (
    <Box flexDirection="column">
      <Text dimColor>{sepLine}</Text>
      <Box>
        {header.map((h, c) => (
          <React.Fragment key={c}>
            {c > 0 ? <Text dimColor> │ </Text> : <Text dimColor> </Text>}
            <Text bold>{padCell(h, widths[c] ?? 3)}</Text>
          </React.Fragment>
        ))}
      </Box>
      <Text dimColor>{sepLine}</Text>
      {rows.map((row, r) => (
        <Box key={r}>
          {Array.from({ length: numCols }).map((_, c) => (
            <React.Fragment key={c}>
              {c > 0 ? <Text dimColor> │ </Text> : <Text dimColor> </Text>}
              <Text>{padCell(row[c] ?? '', widths[c] ?? 3)}</Text>
            </React.Fragment>
          ))}
        </Box>
      ))}
      <Text dimColor>{sepLine}</Text>
    </Box>
  );
}

/** 简单可见宽度估算：CJK 字符算 2，其它 1 */
function visibleWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0x20000 && code <= 0x2fa1f)
    ) w += 2;
    else w += 1;
  }
  return w;
}

// ─── 行内 ──────────────────────────────────────

/**
 * 把一行文本里的 **bold** / *italic* / _italic_ / `code` 切成带样式的 span。
 * 用左到右单次扫描，遇到匹配就切。未匹配的 * _ ` 原样保留。
 */
function Inline({ text }: { text: string }) {
  const nodes = parseInline(text);
  return (
    <Text>
      {nodes.map((n, i) => {
        if (n.kind === 'text') return <Text key={i}>{n.text}</Text>;
        // bold/italic 的正文里可能还有 code 等嵌套 token，递归一次
        if (n.kind === 'bold') return <Text key={i} bold><Inline text={n.text} /></Text>;
        if (n.kind === 'italic') return <Text key={i} italic><Inline text={n.text} /></Text>;
        if (n.kind === 'code') return <Text key={i} color="cyan" dimColor>{n.text}</Text>;
        if (n.kind === 'link') return <Text key={i} color="blue" underline>{n.text} ({n.url})</Text>;
        return null;
      })}
    </Text>
  );
}

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string };

export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;
  const push = (kind: InlineNode['kind'], s: string) => {
    if (!s) return;
    if (kind === 'text' && out.length > 0 && out[out.length - 1]!.kind === 'text') {
      out[out.length - 1]!.text += s;
    } else {
      out.push({ kind, text: s } as InlineNode);
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    // [text](url)
    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (link) {
      out.push({ kind: 'link', text: link[1] ?? '', url: link[2] ?? '' });
      i += link[0].length;
      continue;
    }

    // **bold**
    const bold = rest.match(/^\*\*([^*]+?)\*\*/);
    if (bold) {
      push('bold', bold[1] ?? '');
      i += bold[0].length;
      continue;
    }

    // `code`
    const code = rest.match(/^`([^`]+?)`/);
    if (code) {
      push('code', code[1] ?? '');
      i += code[0].length;
      continue;
    }

    // *italic* —— 注意要保证前面不是 *（避免吃到 bold 的残片）
    const italic1 = rest.match(/^\*([^*\s][^*]*?)\*/);
    if (italic1) {
      push('italic', italic1[1] ?? '');
      i += italic1[0].length;
      continue;
    }

    // _italic_
    const italic2 = rest.match(/^_([^_\s][^_]*?)_/);
    if (italic2) {
      push('italic', italic2[1] ?? '');
      i += italic2[0].length;
      continue;
    }

    // 默认吃一个字符
    push('text', text[i] ?? '');
    i++;
  }
  return out;
}
