/**
 * 任务面板 —— 替代之前的 WorkersPane + EventFeedPane。
 *
 * 每个工人 = 一个任务行。标记区分"谁该动"：
 *   *  agent 在处理（running）
 *   !  需要你关注（blocked）
 *   ✓  完成（idle，有过事件说明干过活）
 *   .  已停（stopped）
 *   ~  刚招进来还在启动
 *
 * 任务描述从 worker.initialPrompt 截取前 30 字。
 */

import { Box, Text } from 'ink';
import type { WorkerView } from '../types.js';

interface Props {
  workers: WorkerView[];
  /** worker name → initialPrompt（从 WorkerManager 获取） */
  taskLabels: Map<string, string>;
  height: number;
}

export function TasksPane({ workers, taskLabels, height }: Props) {
  const visible = workers.slice(0, Math.max(1, height - 3));

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      borderDimColor
      paddingX={1}
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
    >
      <Text dimColor bold>
        tasks ({workers.length})
      </Text>
      {visible.length === 0 ? (
        <Text dimColor>(spawn a worker to see tasks here)</Text>
      ) : (
        visible.map((w) => (
          <TaskRow key={w.name} worker={w} label={taskLabels.get(w.name)} />
        ))
      )}
    </Box>
  );
}

function TaskRow({ worker, label }: { worker: WorkerView; label?: string }) {
  const mark = marker(worker.state);
  const markColor = markerColor(worker.state);
  const tag = tagText(worker.state);
  const desc = label ? truncate(label, 35) : '(no task)';

  return (
    <Box>
      <Text color={markColor} bold>
        {mark}{' '}
      </Text>
      <Text bold>{worker.name}</Text>
      <Text dimColor>{'  '}</Text>
      <Text wrap="truncate-end">{desc}</Text>
      {tag ? (
        <Text dimColor>{' '}{tag}</Text>
      ) : null}
    </Box>
  );
}

function marker(state: WorkerView['state']): string {
  switch (state) {
    case 'running':
      return '*';
    case 'blocked':
      return '!';
    case 'idle':
      return '✓';
    case 'stopped':
      return '.';
  }
}

function markerColor(state: WorkerView['state']): 'yellow' | 'red' | 'green' | 'gray' {
  switch (state) {
    case 'running':
      return 'yellow';
    case 'blocked':
      return 'red';
    case 'idle':
      return 'green';
    case 'stopped':
      return 'gray';
  }
}

function tagText(state: WorkerView['state']): string | null {
  switch (state) {
    case 'blocked':
      return '[你]';
    case 'running':
      return '[AI]';
    default:
      return null;
  }
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + '…';
}
