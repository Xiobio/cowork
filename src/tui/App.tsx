/**
 * cowork TUI —— Static scrollback + 底部模式切换面板。
 *
 * 对话用 <Static> 输出到终端 scrollback，鼠标滚轮天然能翻。
 * 底部面板三种模式：chat（输入）/ tasks（任务列表）/ detail（单任务详情）
 * Tab 切换 chat ↔ tasks，Esc 返回 chat。
 */

import { useEffect, useLayoutEffect, useReducer, useState, useCallback, useRef } from 'react';
import { Box, Text, Static, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

import type { Supervisor, ChatObserver } from '../supervisor.js';
import type { RunningSession } from '../sup-runtime/types.js';
import type { WorkerManager } from '../worker-manager/manager.js';
import type { WorkerInfo } from '../worker-manager/types.js';
import { Splash } from './components/Splash.js';
import { reducer, initialState, mkMessageId } from './state.js';
import type { WorkerView } from './types.js';

interface AppProps {
  adapter: { name: string; displayName: string };
  session: RunningSession;
  supervisor: Supervisor;
  manager: WorkerManager;
  onExit: () => Promise<void> | void;
}

type PanelMode = 'chat' | 'tasks';

const HELP_TEXT = `可以试试：
  招一个工人叫小A，D:/proj/test，只说hello然后停
  现在大家都怎么样
  让小A 再说一次
  把小A 停了
命令：
  /quit /exit          退出（会停所有工人）
  /help                帮助
  /clear               清聊天
  /peek <名字>          直接看工人近 20 条事件（不过总管 LLM）
  /clean               清理所有 stopped 工人`;

export function App({ adapter, session, supervisor, manager, onExit }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, dispatch] = useReducer(reducer, initialState(adapter.name, adapter.displayName));
  const [input, setInput] = useState('');
  const [cols, setCols] = useState(stdout?.columns ?? 100);
  const [showSplash, setShowSplash] = useState(true);
  const [panelMode, setPanelMode] = useState<PanelMode>('chat');
  const [taskCursor, setTaskCursor] = useState(0);
  // tick 每 2 秒强制 re-render，让 "5s ago" 这种相对时间能更新
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  // 已经通过 <Static> 输出过的消息 ID，防止重复输出
  const flushedRef = useRef(new Set<string>());

  useLayoutEffect(() => {
    dispatch({ type: 'session-started', cliSessionId: session.cliSessionId ?? '', pid: session.pid });
    dispatch({ type: 'workers-refreshed', workers: mapWorkers(manager.listWorkers()) });
  }, [session, adapter.displayName, manager]);

  useEffect(() => {
    // 记每个 worker 上次看到的 state + 我们已经推过的 event id。
    // 改 bug：原来只看"state 变化"会在极端时序下丢 idle 转换。现在加一条兜底：
    // 如果 worker 当前是 idle/blocked/stopped 且我们还没为它的最新 assistant_text
    // 推过通知，就补一条。幂等靠 eventId 去重。
    const prevStates = new Map<string, string>();
    const notifiedEventId = new Map<string, string>(); // name → 上次推过通知的 event id

    for (const w of manager.listWorkers()) prevStates.set(w.name, w.state);

    const fireNotification = (name: string, label: string) => {
      const id = mkMessageId();
      dispatch({ type: 'sup-reply-started', messageId: id });
      dispatch({ type: 'sup-text-final', messageId: id, text: label });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      void name;
    };

    // 拿 worker 的最新 assistant_text 事件 ID（用作去重 key）
    const latestTextEventId = (name: string): string | null => {
      const events = manager.peekEvents(name, { limit: 20 }) ?? [];
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e?.type === 'assistant_text') return e.id;
      }
      return null;
    };

    const unsub = manager.subscribe(() => {
      const workers = manager.listWorkers();
      dispatch({ type: 'workers-refreshed', workers: mapWorkers(workers) });

      for (const w of workers) {
        // 通用状态通知（blocked / stopped / idle→running 恢复等）
        const prev = prevStates.get(w.name);
        if (prev && prev !== w.state && w.state !== 'idle') {
          const label = describeChange(w.name, prev, w.state, manager);
          if (label) fireNotification(w.name, label);
        }

        // idle 通知单独走一条基于 event-id 去重的路径（防止状态转换丢）
        if (w.state === 'idle') {
          const lastId = latestTextEventId(w.name);
          if (lastId && notifiedEventId.get(w.name) !== lastId) {
            const body = manager.readEvent(lastId);
            const content = typeof body?.body === 'string' ? body.body : '(empty)';
            const trimmed = content.length > 200 ? content.slice(0, 197) + '…' : content;
            fireNotification(w.name, `[${w.name}] 完成了任务，结果：\n${trimmed}`);
            notifiedEventId.set(w.name, lastId);
          }
        }

        prevStates.set(w.name, w.state);
      }
    });
    return unsub;
  }, [manager]);

  useEffect(() => {
    const onResize = () => { if (stdout) setCols(stdout.columns); };
    stdout?.on('resize', onResize);
    return () => { stdout?.off('resize', onResize); };
  }, [stdout]);

  // ─── 消息提交 ─────────────────────

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput('');
    setPanelMode('chat');

    if (trimmed === '/quit' || trimmed === '/exit') { await onExit(); exit(); return; }
    if (trimmed === '/help') {
      const id = mkMessageId();
      dispatch({ type: 'user-submit', text: trimmed, messageId: `u_${id}` });
      dispatch({ type: 'sup-reply-started', messageId: id });
      dispatch({ type: 'sup-text-final', messageId: id, text: HELP_TEXT });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      return;
    }
    if (trimmed === '/clear') { dispatch({ type: 'clear-chat' }); flushedRef.current.clear(); return; }

    // /peek <name> —— 直接从 WorkerManager 读近 20 条事件，不过 Sup LLM
    if (trimmed.startsWith('/peek ')) {
      const name = trimmed.slice('/peek '.length).trim();
      const id = mkMessageId();
      dispatch({ type: 'user-submit', text: trimmed, messageId: `u_${id}` });
      dispatch({ type: 'sup-reply-started', messageId: id });
      dispatch({ type: 'sup-text-final', messageId: id, text: renderPeek(manager, name) });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      return;
    }

    // /clean —— 把所有 stopped 工人从 map 里清掉（立即 sweep，不等 TTL）
    if (trimmed === '/clean') {
      const n = manager.sweepStopped(0);
      const id = mkMessageId();
      dispatch({ type: 'user-submit', text: trimmed, messageId: `u_${id}` });
      dispatch({ type: 'sup-reply-started', messageId: id });
      dispatch({ type: 'sup-text-final', messageId: id, text: `已清理 ${n} 个 stopped 工人` });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      dispatch({ type: 'workers-refreshed', workers: mapWorkers(manager.listWorkers()) });
      return;
    }

    const uid = `u_${mkMessageId()}`;
    const sid = `s_${mkMessageId()}`;
    dispatch({ type: 'user-submit', text: trimmed, messageId: uid });
    dispatch({ type: 'sup-reply-started', messageId: sid });

    const observer: ChatObserver = {
      onTextDelta: (delta) => dispatch({ type: 'sup-text-delta', messageId: sid, delta }),
      onToolCall: (toolName, inputObj) => {
        dispatch({ type: 'tool-call', callId: mkMessageId(), toolName: shortenToolName(toolName), inputSummary: summarizeInput(inputObj), workerName: extractWorkerName(inputObj) });
      },
      onToolResult: () => {},
      onError: (message, fatal) => { dispatch({ type: 'error', message }); if (fatal) void onExit(); },
    };

    try {
      const result = await supervisor.chat(trimmed, observer);
      dispatch({ type: 'sup-text-final', messageId: sid, text: result.text });
      dispatch({ type: 'sup-turn-completed', messageId: sid, toolCallCount: result.toolCallCount });
      dispatch({ type: 'workers-refreshed', workers: mapWorkers(manager.listWorkers()) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'sup-text-final', messageId: sid, text: `[error] ${msg}` });
      dispatch({ type: 'sup-turn-completed', messageId: sid, toolCallCount: 0 });
    }
  }, [supervisor, manager, onExit, exit]);

  // ─── 键盘 ─────────────────────

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') { void (async () => { await onExit(); exit(); })(); return; }
    if (key.tab) { setPanelMode(m => m === 'chat' ? 'tasks' : 'chat'); return; }
    if (key.escape) { setPanelMode('chat'); return; }

    if (panelMode === 'tasks') {
      if (key.upArrow) setTaskCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setTaskCursor(c => Math.min(state.workers.length - 1, c));
    }
  });

  // ─── Splash ─────────────────────

  const hideSplash = useCallback(() => setShowSplash(false), []);
  if (showSplash) return <Splash width={cols} onDone={hideSplash} />;

  // ─── 完成的消息 → Static 输出（永久进入 scrollback）─────────

  const completedMessages = state.chat.filter(m => !m.streaming);
  const newMessages = completedMessages.filter(m => !flushedRef.current.has(m.id));
  for (const m of newMessages) flushedRef.current.add(m.id);

  // tasks 一行摘要
  const taskLabels = new Map<string, string>();
  for (const w of manager.listWorkers()) taskLabels.set(w.name, w.initialPrompt);
  const isChatting = state.status.kind === 'chatting';
  const line = '─'.repeat(Math.max(1, cols - 2));

  // 当前正在 streaming 的消息
  const streamingMsg = state.chat.find(m => m.streaming);

  return (
    <Box flexDirection="column" width={cols}>
      {/* 已完成的消息 → 进 terminal scrollback，鼠标可翻 */}
      <Static items={newMessages}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column" paddingX={1}>
            {msg.role === 'user' ? (
              <Text color="cyan"><Text bold>&gt;</Text> {msg.text}</Text>
            ) : (
              <Box marginBottom={1}>
                <Text>{msg.text}</Text>
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* 正在生成的消息（动态区，会被下次渲染覆盖） */}
      {streamingMsg && (
        <Box paddingX={1}>
          <Text dimColor>{streamingMsg.text || '...'}</Text>
        </Box>
      )}

      {/* 思考中指示器 */}
      {isChatting && !streamingMsg && (
        <Box paddingX={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text dimColor> thinking ({state.currentTurnToolCalls} calls)</Text>
        </Box>
      )}

      {/* 分隔线 */}
      <Text dimColor>{line}</Text>

      {/* 任务列表（始终显示） */}
      {state.workers.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor bold>tasks ({state.workers.length})</Text>
          {state.workers.map(w => {
            const mark = w.state === 'running' ? '*' : w.state === 'blocked' ? '!' : w.state === 'idle' ? '✓' : '.';
            const mColor = w.state === 'running' ? 'yellow' : w.state === 'blocked' ? 'red' : w.state === 'idle' ? 'green' : 'gray';
            const action = w.currentAction ? `[${w.currentAction}]` : '';
            const age = formatAge(w.lastActivity);
            const meta = `${w.eventCount}ev · ${formatTokens(w.tokenUsed)}`;
            const label = truncate(taskLabels.get(w.name) ?? '', Math.max(20, cols - 50));
            return (
              <Box key={w.name} flexDirection="column">
                <Box>
                  <Text color={mColor}> {mark} </Text>
                  <Text bold>{w.name.padEnd(6)}</Text>
                  <Text color="cyan"> {action.padEnd(14)}</Text>
                  <Text dimColor>{age.padStart(6)}  </Text>
                  <Text dimColor>{meta}</Text>
                </Box>
                <Box paddingLeft={4}>
                  <Text dimColor>{label}</Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* 输入框 */}
      <Box paddingX={1}>
        {isChatting ? (
          <Box>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text dimColor> waiting for response...</Text>
          </Box>
        ) : (
          <Box>
            <Text color="cyan" bold>&gt; </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="" />
          </Box>
        )}
      </Box>

      {/* 底部提示 */}
      <Text dimColor>{line}</Text>
      <Box paddingX={1}>
        <Text dimColor>tab:tasks  /quit  /help  /clear</Text>
      </Box>
    </Box>
  );
}

// ─── 辅助 ─────────────────────────

function describeChange(name: string, from: string, to: string, mgr: WorkerManager): string | null {
  if (from === 'starting' && to === 'running') return null;

  if (to === 'idle') {
    // 读工人最后的 assistant_text，把结果带上
    const events = mgr.peekEvents(name, { limit: 10 });
    const lastText = events
      ?.filter(e => e.type === 'assistant_text')
      .pop();
    if (lastText) {
      const body = mgr.readEvent(lastText.id);
      const content = typeof body?.body === 'string' ? body.body : lastText.preview;
      const trimmed = content.length > 200 ? content.slice(0, 197) + '…' : content;
      return `[${name}] 完成了任务，结果：\n${trimmed}`;
    }
    return `[${name}] 完成了当前任务`;
  }
  if (to === 'stopped') return `[${name}] 已停止`;
  if (to === 'blocked') {
    const events = mgr.peekEvents(name, { limit: 5 });
    const lastErr = events?.filter(e => e.type === 'error').pop();
    if (lastErr) return `[${name}] 卡住了：${lastErr.preview}`;
    return `[${name}] 卡住了，需要你关注`;
  }
  if (to === 'running' && from === 'idle') return `[${name}] 开始处理新任务`;
  return null;
}

function mapWorkers(list: WorkerInfo[]): WorkerView[] {
  return list.map(w => ({
    name: w.name,
    state: w.state === 'starting' ? 'running' : w.state,
    lastActivity: w.lastActivity,
    tokenUsed: w.tokenUsed,
    currentAction: w.currentAction,
    eventCount: w.eventCount,
  }));
}

function formatAge(d: Date): string {
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}t`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}kt`;
  return `${(n / 1_000_000).toFixed(1)}Mt`;
}

/** /peek 命令：读近 20 条事件元数据 + 尝试展开最后一条 assistant_text */
function renderPeek(manager: WorkerManager, name: string): string {
  const worker = manager.getWorker(name);
  if (!worker) return `找不到工人 "${name}"。当前工人：${manager.listWorkers().map(w => w.name).join(', ') || '(无)'}`;
  const events = manager.peekEvents(name, { limit: 20 }) ?? [];
  const lines: string[] = [];
  lines.push(`[${name}] state=${worker.state} · ${worker.eventCount} 条事件 · ${formatTokens(worker.tokenUsed)} · ${worker.currentAction ? '正在 ' + worker.currentAction : '空闲'}`);
  lines.push(`cwd: ${worker.cwd}`);
  lines.push(`任务: ${worker.initialPrompt}`);
  lines.push('');
  if (events.length === 0) {
    lines.push('(还没有事件)');
    return lines.join('\n');
  }
  lines.push('近 20 条事件：');
  for (const e of events) {
    const tag = e.type === 'assistant_text' ? '💬'
      : e.type === 'tool_call' ? '🔧'
      : e.type === 'tool_result' ? '↩️'
      : e.type === 'error' ? '❌'
      : e.type === 'completion' ? '✓'
      : '·';
    const prefix = e.toolName ? `${e.toolName}: ` : '';
    lines.push(`  ${tag} ${prefix}${e.preview}`);
  }
  // 展开最后一条 assistant_text 的正文
  const lastText = [...events].reverse().find(e => e.type === 'assistant_text');
  if (lastText) {
    const body = manager.readEvent(lastText.id);
    if (typeof body?.body === 'string' && body.body.length > 0) {
      lines.push('');
      lines.push(`最后一段说话：`);
      const text = body.body.length > 600 ? body.body.slice(0, 597) + '…' : body.body;
      for (const ln of text.split(/\r?\n/)) lines.push(`  ${ln}`);
    }
  }
  return lines.join('\n');
}

function shortenToolName(t: string): string {
  const m = t.match(/^(?:mcp__)?[\w-]+[_.]([\w-]+)$/);
  if (m?.[1]) return m[1];
  return t.split(/[._]/).pop() ?? t;
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  if (typeof o.name === 'string') return `→ ${o.name}`;
  if (typeof o.event_id === 'string') return `← ${o.event_id}`;
  return '';
}

function extractWorkerName(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const n = (input as Record<string, unknown>).name;
  return typeof n === 'string' ? n : undefined;
}

function truncate(s: string, max: number): string {
  const c = s.replace(/\s+/g, ' ').trim();
  return c.length <= max ? c : c.slice(0, max - 1) + '…';
}
