import { Box, Text } from 'ink';
import type { AppState } from '../state.js';
import { Clock } from './Clock.js';

interface Props {
  state: AppState;
  width: number;
}

export function StatusBar({ state, width }: Props) {
  const statusText = renderStatus(state);
  const statusColor = renderStatusColor(state);
  const running = state.workers.filter((w) => w.state === 'running').length;
  const blocked = state.workers.filter((w) => w.state === 'blocked').length;
  const total = state.workers.length;

  return (
    <Box borderStyle="single" borderColor="gray" borderDimColor paddingX={1} width={width} justifyContent="space-between">
      <Box>
        <Text bold dimColor>cowork</Text>
        <Text dimColor> {shortAdapterName(state.adapterName)}</Text>
      </Box>
      <Box>
        <Text dimColor>{total}w </Text>
        {running > 0 && <Text color="green">{running}run </Text>}
        {blocked > 0 && <Text color="red">{blocked}blk </Text>}
        <Text color={statusColor}>{statusText}</Text>
        <Text dimColor> </Text>
        <Clock />
      </Box>
    </Box>
  );
}

function shortAdapterName(name: string): string {
  if (name === 'codex') return 'codex';
  if (name === 'claude' || name === 'claude-code') return 'claude';
  return name;
}

function renderStatus(state: AppState): string {
  switch (state.status.kind) {
    case 'starting':
      return 'starting...';
    case 'ready':
      return 'ready';
    case 'chatting':
      return `thinking (${state.currentTurnToolCalls} calls)`;
    case 'error':
      return `err: ${state.status.message.slice(0, 30)}`;
    case 'stopped':
      return 'stopped';
  }
}

function renderStatusColor(state: AppState): 'green' | 'yellow' | 'red' | 'gray' {
  switch (state.status.kind) {
    case 'ready': return 'green';
    case 'chatting':
    case 'starting': return 'yellow';
    case 'error': return 'red';
    case 'stopped': return 'gray';
  }
}
