/**
 * 开场动画。多阶段揭幕 —— ◇ 钻石阵 → 标题揭开 → 标语 → 当前 adapter/persona 状态。
 * 总时长 ~2.5 秒。snapshot 模式首帧就能看到 logo（phase 1 已含 ASCII title）。
 */

import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  width: number;
  adapterName: string;
  personaName: string;
  resumed: boolean;
  onDone: () => void;
}

// COWORK 的 ASCII 大字标题。窄一点保证 80 列也能完整显示。
// 用 Box drawing 字符堆出风格化字母。
const TITLE_LINES = [
  '   ▄▄▄    ▄▄▄    ▄    ▄    ▄▄▄    ▄▄▄▄    ▄   ▄ ',
  '  █      █   █   █▌  ▐█   █   █   █   █   █  █  ',
  '  █      █   █   █▐██▌█   █   █   █▄▄█    █▄█   ',
  '  █      █   █   █ ██ █   █   █   █  █    █▄ █  ',
  '   ▀▀▀    ▀▀▀    ▀    ▀    ▀▀▀    ▀  ▀    ▀  ▀  ',
];

// ◇ 钻石阵：第一阶段先显示一颗，第二阶段铺开。
const DIAMOND_SOLO = '       ◇';
const DIAMOND_CLUSTER = '   ◇   ◇   ◇   ◇   ◇';

export function Splash({ width, adapterName, personaName, resumed, onDone }: Props) {
  // 0=cluster only, 1=title shown, 2=tagline, 3=info
  const [phase, setPhase] = useState(1);

  useEffect(() => {
    const t2 = setTimeout(() => setPhase(2), 500);
    const t3 = setTimeout(() => setPhase(3), 1000);
    const t4 = setTimeout(() => onDone(), 2400);
    return () => { clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [onDone]);

  // 任意按键跳过 splash —— 频繁重启的用户不用每次等 2.4 秒
  useInput(() => {
    onDone();
  });

  return (
    <Box flexDirection="column" width={width} alignItems="center" justifyContent="center" minHeight={20}>
      <Box flexDirection="column">
        {/* phase 1: 钻石阵 + 标题（首帧就显，snapshot 也能拍到） */}
        <Text> </Text>
        <Text color="cyan" bold>{DIAMOND_CLUSTER}</Text>
        <Text> </Text>
        {TITLE_LINES.map((line, i) => (
          <Text key={i} color="cyan" bold>{line}</Text>
        ))}
        <Text> </Text>

        {/* phase 2: 标语 */}
        {phase >= 2 && (
          <>
            <Text dimColor>     coordinate your AI workers,</Text>
            <Text dimColor>     batch their reports, route your commands.</Text>
            <Text> </Text>
          </>
        )}

        {/* phase 3: adapter / persona / resume 状态 */}
        {phase >= 3 && (
          <>
            <Text dimColor>     ─────────────────────────────────────────</Text>
            <Text> </Text>
            <Text>
              <Text dimColor>     adapter: </Text>
              <Text color="green">{adapterName}</Text>
              <Text dimColor>  ·  persona: </Text>
              <Text color="magenta">{personaName}</Text>
            </Text>
            <Text> </Text>
            <Text dimColor>     {resumed ? '↻ resuming previous session...' : '✦ starting fresh session...'}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
