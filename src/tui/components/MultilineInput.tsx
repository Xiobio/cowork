/**
 * 多行输入组件 —— 替换 ink-text-input。
 *
 * 为什么自己写：ink-text-input 只支持单行，长文本粘贴会丢 \n。Claude Code
 * 一致体验需要多行 + 粘贴保留换行。
 *
 * 简化：cursor 永远在 value 末尾，不支持 home/end/方向键中间编辑（暂不做）。
 * 真正交互的核心：
 * - 单字符输入：append
 * - 粘贴：input 含多字符，保留 \n
 * - Enter (单独按)：submit；Enter 在粘贴中（input.length>1 含 \r）：保留为换行
 * - Backspace：删一个字符
 * - Esc / Tab / Ctrl+_ / 方向键：不处理，让父 useInput 接管
 *
 * 布局：每个 \n 切一行 <Text>，最后一行行尾画个反白方块当光标。
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  value: string;
  onChange: (v: string) => void;
  /**
   * Enter 处理：返回 true 表示组件已经处理（一般是粘贴里的 \r 当作换行追加），
   * 返回 false / undefined 表示父级应该接管（一般是单独按 Enter 当作 submit）。
   * 父级用这个判断要不要触发 handleSubmit。
   */
  onEnter?: (rawInput: string) => boolean | void;
  placeholder?: string;
  /** disabled 时本组件的 useInput 不再处理任何键 */
  disabled?: boolean;
}

export function MultilineInput({
  value,
  onChange,
  onEnter,
  placeholder = '',
  disabled = false,
}: Props) {
  useInput(
    (input, key) => {
      if (disabled) return;

      // 控制键交给父级处理
      if (
        key.escape ||
        key.tab ||
        key.upArrow ||
        key.downArrow ||
        key.leftArrow ||
        key.rightArrow ||
        key.pageUp ||
        key.pageDown
      ) {
        return;
      }
      if (key.ctrl || key.meta) return;

      // Enter：粘贴里的换行追加，单独按由父级决定（onEnter 通知）
      if (key.return) {
        if (input.length > 1) {
          // 粘贴含 \n，整体 append
          onChange(value + input);
          return;
        }
        // 单独按 Enter 不在这里 submit，让父级 useInput 处理
        if (onEnter) onEnter(input);
        return;
      }

      // 删除
      if (key.backspace || key.delete) {
        if (value.length > 0) onChange(value.slice(0, -1));
        return;
      }

      // 普通字符或粘贴：append，保留 \n
      if (input) {
        onChange(value + input);
      }
    },
    { isActive: !disabled },
  );

  if (!value && placeholder) {
    return <Text dimColor>{placeholder}</Text>;
  }

  const allLines = value.split('\n');
  // 多行输入封顶：超过 MAX_VISIBLE 行只显示最后 N 行 + "(+N 行在上)" 指示。
  // 防止粘贴长文时把整个 TUI 顶掉。
  const MAX_VISIBLE = 5;
  const overflow = Math.max(0, allLines.length - MAX_VISIBLE);
  const visible = overflow > 0 ? allLines.slice(-MAX_VISIBLE) : allLines;

  return (
    <Box flexDirection="column">
      {overflow > 0 && (
        <Text dimColor italic>↑ +{overflow} 行（已折叠，仍会发送）</Text>
      )}
      {visible.map((ln, i) => {
        const isLast = i === visible.length - 1;
        return (
          <Box key={i}>
            <Text>{ln}</Text>
            {isLast && !disabled && <Text inverse>{' '}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
