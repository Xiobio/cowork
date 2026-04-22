import { useEffect, useState } from 'react';
import { Text } from 'ink';

/**
 * 独立的时钟组件，自己持有 state。
 *
 * 为什么拆出来：原来 App 根组件每秒 setNow，整棵 React 树都会 re-render，
 * Ink 每秒输出一个完整帧，终端看起来是在闪。现在 setState 只发生在这个
 * 叶子组件，React 的更新只传播到它自己这一小片。
 */
export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return <Text color="white">{`${hh}:${mm}:${ss}`}</Text>;
}
