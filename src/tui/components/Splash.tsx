/**
 * 开场动画。显示 ~2 秒后自动消失。
 */

import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const LOGO = [
  '',
  '        ◇',
  '',
  '        c o w o r k',
  '',
  '        coordinate your AI workers',
  '        from a single conversation',
  '',
];

const FADE_LINES = [
  '        ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─',
];

interface Props {
  width: number;
  onDone: () => void;
}

export function Splash({ width, onDone }: Props) {
  // 从 1 开始 —— 首帧就显 logo，不要黑屏 200ms（snapshot 模式也能拍到东西）
  const [phase, setPhase] = useState(1); // 1=logo, 2=tagline, 3=bar

  useEffect(() => {
    const t2 = setTimeout(() => setPhase(2), 500);
    const t3 = setTimeout(() => setPhase(3), 1000);
    const t4 = setTimeout(() => onDone(), 1800);
    return () => { clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [onDone]);

  return (
    <Box flexDirection="column" width={width} alignItems="center" justifyContent="center" minHeight={15}>
      <Box flexDirection="column">
        {phase >= 1 && (
          <>
            <Text> </Text>
            <Text color="cyan" bold>        ◇</Text>
            <Text> </Text>
            <Text bold>        c o w o r k</Text>
          </>
        )}
        {phase >= 2 && (
          <>
            <Text> </Text>
            <Text dimColor>        coordinate your AI workers</Text>
            <Text dimColor>        from a single conversation</Text>
          </>
        )}
        {phase >= 3 && (
          <>
            <Text> </Text>
            <Text dimColor>        ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─</Text>
            <Text> </Text>
            <Text dimColor>        starting supervisor...</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
