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
  const [phase, setPhase] = useState(0); // 0=blank, 1=logo, 2=tagline, 3=bar

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 200);
    const t2 = setTimeout(() => setPhase(2), 700);
    const t3 = setTimeout(() => setPhase(3), 1200);
    const t4 = setTimeout(() => onDone(), 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
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
