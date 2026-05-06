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
import type {
  SessionBundle,
  SessionMeta,
  WorkerSnapshot,
} from '../session/storage.js';
import { appendChat, saveWorkers, summarizeAllSessions, updateMeta } from '../session/storage.js';
import { PERSONAS, getPersona, getPersonaOrDefault } from '../persona/index.js';
import { Splash } from './components/Splash.js';
import { Markdown } from './components/Markdown.js';
import { reducer, initialState, mkMessageId, seedMessageId } from './state.js';
import type { WorkerView } from './types.js';

interface AppProps {
  adapter: { name: string; displayName: string };
  session: RunningSession;
  supervisor: Supervisor;
  manager: WorkerManager;
  onExit: () => Promise<void> | void;
  persistence: {
    bundle: SessionBundle | null;
    meta: SessionMeta;
    resumed: boolean;
  };
}

type PanelMode = 'chat' | 'tasks';

/** Slash 命令注册表：自动补全 + 帮助文本都从这里来 */
const SLASH_COMMANDS: { name: string; usage: string; desc: string }[] = [
  { name: '/help',     usage: '/help',           desc: '看试玩建议和命令列表' },
  { name: '/quit',     usage: '/quit',           desc: '退出（停所有工人；session 自动保存）' },
  { name: '/exit',     usage: '/exit',           desc: '同 /quit' },
  { name: '/clear',    usage: '/clear',          desc: '清屏（不影响 session 历史）' },
  { name: '/peek',     usage: '/peek <名字>',    desc: '直接看工人近 20 条事件，不过 Sup' },
  { name: '/clean',    usage: '/clean',          desc: '从 map 里清掉所有 stopped 工人' },
  { name: '/respawn',  usage: '/respawn <名字>', desc: '用历史工人的 cwd+prompt 重新拉起' },
  { name: '/sessions', usage: '/sessions',       desc: '列本目录下所有 session（带 chat 数）' },
  { name: '/persona',  usage: '/persona [id]',   desc: '看/切换 Sup 人设（10 套）' },
  { name: '/new',      usage: '/new',            desc: '提示如何新开 session' },
];

function findMatchingCommands(input: string): typeof SLASH_COMMANDS {
  if (!input.startsWith('/')) return [];
  const head = input.split(/\s/)[0] ?? '';
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(head));
}

const HELP_TEXT = `可以试试：
  招一个工人叫小A，D:/proj/test，只说hello然后停
  现在大家都怎么样
  让小A 再说一次
  把小A 停了
命令：
  /quit /exit          退出（会停所有工人；session 被保存，下次默认 resume）
  /help                帮助
  /clear               清聊天
  /peek <名字>          直接看工人近 20 条事件（不过 Sup LLM）
  /clean               清理所有 stopped 工人
  /respawn <名字>       用历史工人的 cwd+prompt 重新招一个同名工人
  /sessions            列出本目录下的所有 session
  /persona [id]        看/切人设（10 套：office, summoner, intern, pirate, detective, …）
  /new                 提示如何新开 session`;

export function App({ adapter, session, supervisor, manager, onExit, persistence }: AppProps) {
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

  // 待处理输入队列：Sup 正在回复时用户还继续打字，排进这里，一个 turn 完再 drain。
  const inputQueueRef = useRef<string[]>([]);
  const [queueLen, setQueueLen] = useState(0);

  // 输入历史：用户之前发过的消息，用 up/down 回翻。
  const historyRef = useRef<string[]>([]);
  const historyCursor = useRef<number>(-1); // -1 = 当前草稿，否则 index into historyRef

  // Slash 命令补全：当前输入以 / 开头时打开 dropdown
  const slashMatches = findMatchingCommands(input);
  const slashMenuOpen = input.startsWith('/') && slashMatches.length > 0;
  const [slashCursor, setSlashCursor] = useState(0);
  // 输入变化时把 cursor reset 到 0（避免越界）
  useEffect(() => {
    if (slashCursor >= slashMatches.length) setSlashCursor(0);
  }, [slashMatches.length, slashCursor]);

  // 已经通过 <Static> 输出过的消息 ID，防止重复输出
  const flushedRef = useRef(new Set<string>());

  useLayoutEffect(() => {
    dispatch({ type: 'session-started', cliSessionId: session.cliSessionId ?? '', pid: session.pid });
    dispatch({ type: 'workers-refreshed', workers: mapWorkers(manager.listWorkers()) });

    // Sup 的 cliSessionId 多半要等 session_started 事件才填上。
    // 每 500ms 轮询一次，拿到就存回 meta 给下次 resume 用，最多 15 次
    // （7.5 秒）还没拿到就放弃 —— CLI 八成不产 session_id，resume 也没意义。
    if (session.cliSessionId) {
      updateMeta(process.cwd(), persistence.meta.id, { supCliSessionId: session.cliSessionId });
    } else {
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (session.cliSessionId) {
          updateMeta(process.cwd(), persistence.meta.id, { supCliSessionId: session.cliSessionId });
          clearInterval(timer);
        } else if (tries >= 15) {
          clearInterval(timer);
        }
      }, 500);
      return () => clearInterval(timer);
    }

    // resume 场景：回放 chat 历史 + 把历史工人塞进 dormantWorkers
    if (persistence.resumed && persistence.bundle) {
      const bundle = persistence.bundle;
      // seed msg id counter，避免新 id 和历史 id 撞
      let maxId = 0;
      for (const m of bundle.chat) {
        const match = m.id.match(/m_(\d+)/);
        if (match?.[1]) maxId = Math.max(maxId, parseInt(match[1], 10));
      }
      seedMessageId(maxId);
      dispatch({
        type: 'restore-chat',
        messages: bundle.chat.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          ts: new Date(m.ts),
        })),
      });
      dispatch({ type: 'set-dormant', workers: bundle.workers });
    }
  }, [session, adapter.displayName, manager, persistence]);

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
      appendChat(cwd, sessionId, { id, role: 'sup', text: label, ts: new Date().toISOString() });
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

    const cwd = process.cwd();
    const sessionId = persistence.meta.id;

    // saveWorkers 是 sync writeFileSync，subscribe 每条事件一次太狠
    // (一个 turn 50+ 事件 = 50+ 次 fs 阻塞)。debounce 到每 500ms 最多一次。
    let saveTimer: NodeJS.Timeout | null = null;
    let pendingSnapshots: WorkerSnapshot[] | null = null;
    const flushSave = () => {
      if (pendingSnapshots) {
        saveWorkers(cwd, sessionId, pendingSnapshots);
        pendingSnapshots = null;
      }
      saveTimer = null;
    };
    const scheduleSave = (snaps: WorkerSnapshot[]) => {
      pendingSnapshots = snaps;
      if (!saveTimer) saveTimer = setTimeout(flushSave, 500);
    };

    const unsub = manager.subscribe(() => {
      const workers = manager.listWorkers();
      dispatch({ type: 'workers-refreshed', workers: mapWorkers(workers) });

      // 持久化工人快照（debounced）
      const snapshots: WorkerSnapshot[] = workers.map((w) => ({
        name: w.name,
        cwd: w.cwd,
        initialPrompt: w.initialPrompt,
        adapterName: w.adapterName,
        state: w.state,
        cliSessionId: w.cliSessionId,
        lastActivity: w.lastActivity.toISOString(),
        eventCount: w.eventCount,
        tokenUsed: w.tokenUsed,
      }));
      scheduleSave(snapshots);

      // 如果新的活工人和 dormant 里某个重名，把那个 dormant 干掉
      for (const w of workers) {
        dispatch({ type: 'remove-dormant', name: w.name });
      }

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
    return () => {
      unsub();
      // 卸载前 flush 一次，别丢最后那条 pending 快照
      if (saveTimer) {
        clearTimeout(saveTimer);
        flushSave();
      }
    };
  }, [manager, persistence.meta.id]);

  useEffect(() => {
    const onResize = () => { if (stdout) setCols(stdout.columns); };
    stdout?.on('resize', onResize);
    return () => { stdout?.off('resize', onResize); };
  }, [stdout]);

  // ─── 消息提交 ─────────────────────

  const cwd = process.cwd();
  const sessionId = persistence.meta.id;

  const persistUser = useCallback((id: string, text: string) => {
    appendChat(cwd, sessionId, { id, role: 'user', text, ts: new Date().toISOString() });
  }, [cwd, sessionId]);
  const persistSup = useCallback((id: string, text: string) => {
    appendChat(cwd, sessionId, { id, role: 'sup', text, ts: new Date().toISOString() });
  }, [cwd, sessionId]);

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput('');
    setPanelMode('chat');
    historyCursor.current = -1;

    // 推入历史（dedup 最近一条）
    const hist = historyRef.current;
    if (hist[hist.length - 1] !== trimmed) {
      hist.push(trimmed);
      if (hist.length > 200) hist.splice(0, hist.length - 200);
    }

    // /quit /exit /clear 不排队 —— 这些本来就是要"立刻让我看到效果"的命令
    if (trimmed === '/quit' || trimmed === '/exit') {
      await onExit();
      exit();
      return;
    }
    if (trimmed === '/clear') {
      dispatch({ type: 'clear-chat' });
      flushedRef.current.clear();
      return;
    }

    // 其它情况下 chatting 中就排队
    if (state.status.kind === 'chatting') {
      const QUEUE_MAX = 50;
      if (inputQueueRef.current.length >= QUEUE_MAX) {
        // 队列满 —— 给用户一个错误反馈而不是悄悄丢
        const id = mkMessageId();
        dispatch({ type: 'sup-reply-started', messageId: id });
        dispatch({ type: 'sup-text-final', messageId: id, text: `[排队已满] 待处理消息超过 ${QUEUE_MAX} 条，新消息被丢弃。等总管处理一下，或 Ctrl+C 退出。` });
        dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
        return;
      }
      inputQueueRef.current.push(trimmed);
      setQueueLen(inputQueueRef.current.length);
      return;
    }
    if (trimmed === '/help') {
      const id = mkMessageId();
      const uid = `u_${id}`;
      dispatch({ type: 'user-submit', text: trimmed, messageId: uid });
      persistUser(uid, trimmed);
      dispatch({ type: 'sup-reply-started', messageId: id });
      dispatch({ type: 'sup-text-final', messageId: id, text: HELP_TEXT });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      persistSup(id, HELP_TEXT);
      return;
    }
    if (trimmed === '/new') {
      const id = mkMessageId();
      const uid = `u_${id}`;
      dispatch({ type: 'user-submit', text: trimmed, messageId: uid });
      persistUser(uid, trimmed);
      dispatch({ type: 'sup-reply-started', messageId: id });
      const hint = '要开新 session 请 /quit 后运行：\n  npm run dev -- --new\n（当前 session 仍会被保存，再 --list-sessions 可看到）';
      dispatch({ type: 'sup-text-final', messageId: id, text: hint });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      persistSup(id, hint);
      return;
    }
    // /persona —— 列 / 切换人设
    if (trimmed === '/persona' || trimmed.startsWith('/persona ')) {
      const arg = trimmed.slice('/persona'.length).trim();
      const id = mkMessageId();
      const uid = `u_${id}`;
      dispatch({ type: 'user-submit', text: trimmed, messageId: uid });
      persistUser(uid, trimmed);
      dispatch({ type: 'sup-reply-started', messageId: id });

      const currentId = persistence.meta.personaId ?? 'office';
      let out: string;
      if (!arg) {
        // 列出所有人设
        const lines: string[] = [];
        const cur = getPersonaOrDefault(currentId);
        lines.push(`当前人设：**${cur.name}** (\`${cur.id}\`) — ${cur.vibe}`);
        lines.push('');
        lines.push('全部 10 套：');
        for (const p of PERSONAS) {
          const mark = p.id === currentId ? '> ' : '  ';
          lines.push(`${mark}\`${p.id.padEnd(11)}\` — **${p.name}** · ${p.vibe}`);
        }
        lines.push('');
        lines.push('切换：`/persona <id>` 然后 /quit 重启（当前 Sup 的提示词在 spawn 时已锁定）');
        out = lines.join('\n');
      } else {
        const target = getPersona(arg);
        if (!target) {
          out = `没有 \`${arg}\` 这个人设。可选：${PERSONAS.map(p => p.id).join(', ')}`;
        } else if (target.id === currentId) {
          out = `当前已经是 **${target.name}** (\`${target.id}\`)。`;
        } else {
          updateMeta(cwd, persistence.meta.id, { personaId: target.id });
          out = `已切到 **${target.name}** (\`${target.id}\`)。\n` +
                `当前 Sup 的系统提示词在 spawn 时已锁，**要 /quit 后再重启** cowork 才会生效。\n` +
                `下次启动时会用这个人设构造新 Sup。`;
        }
      }
      dispatch({ type: 'sup-text-final', messageId: id, text: out });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      persistSup(id, out);
      return;
    }

    if (trimmed === '/sessions') {
      const id = mkMessageId();
      const uid = `u_${id}`;
      dispatch({ type: 'user-submit', text: trimmed, messageId: uid });
      persistUser(uid, trimmed);
      dispatch({ type: 'sup-reply-started', messageId: id });
      const sessions = summarizeAllSessions(cwd);
      const lines: string[] = [];
      lines.push(`本目录下 ${sessions.length} 个 session（最近的在上）：`);
      lines.push('');
      for (const s of sessions) {
        const mark = s.id === persistence.meta.id ? '> ' : '  ';
        lines.push(`${mark}\`${s.id}\``);
        lines.push(`    adapter=${s.adapter}  lastUsed=${formatAge(new Date(s.lastUsedAt))}  ${s.chatLines} chat · ${s.workerCount} workers`);
      }
      lines.push('');
      lines.push('切别的 session 要 /quit 后跑 `npm run dev -- --session <id>`');
      const out = lines.join('\n');
      dispatch({ type: 'sup-text-final', messageId: id, text: out });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      persistSup(id, out);
      return;
    }
    if (trimmed.startsWith('/respawn')) {
      const name = trimmed.slice('/respawn'.length).trim();
      const id = mkMessageId();
      const uid = `u_${id}`;
      dispatch({ type: 'user-submit', text: trimmed, messageId: uid });
      persistUser(uid, trimmed);
      dispatch({ type: 'sup-reply-started', messageId: id });
      let hint: string;
      if (!name) {
        hint = `用法：/respawn <名字>。当前 dormant：${state.dormantWorkers.map((w) => w.name).join(', ') || '(无)'}`;
        dispatch({ type: 'sup-text-final', messageId: id, text: hint });
        dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
        persistSup(id, hint);
        return;
      }
      const dormant = state.dormantWorkers.find((w) => w.name === name);
      if (!dormant) {
        hint = `找不到历史工人 "${name}"。当前 dormant：${state.dormantWorkers.map((w) => w.name).join(', ') || '(无)'}`;
      } else {
        // 如果 dormant 有 cliSessionId 且 adapter 是 claude，带着 --resume 起
        // （codex 的 app-server 忽略，adapter 层会 warn）
        const r = await manager.spawnWorker(
          dormant.name,
          dormant.cwd,
          dormant.initialPrompt,
          { resumeCliSessionId: dormant.cliSessionId ?? null },
        );
        if (!r.ok) {
          hint = `spawn 失败：${r.error}`;
        } else {
          dispatch({ type: 'remove-dormant', name });
          const resumedNote = dormant.cliSessionId
            ? `已尝试 resume 它之前的 CLI 会话（id=${dormant.cliSessionId.slice(0, 12)}…，仅 claude 生效）。如果 resume 失败会自动 fallback 新开。`
            : `没有历史 cliSessionId，按新会话启动。`;
          hint = `已重新招 "${name}"（cwd=${dormant.cwd}，同原始 prompt）。${resumedNote}`;
        }
      }
      dispatch({ type: 'sup-text-final', messageId: id, text: hint });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      persistSup(id, hint);
      return;
    }

    // /peek <name> —— 直接从 WorkerManager 读近 20 条事件，不过 Sup LLM
    if (trimmed.startsWith('/peek')) {
      const name = trimmed.slice('/peek'.length).trim();
      const id = mkMessageId();
      const uid = `u_${id}`;
      dispatch({ type: 'user-submit', text: trimmed, messageId: uid });
      persistUser(uid, trimmed);
      dispatch({ type: 'sup-reply-started', messageId: id });
      const out = name
        ? renderPeek(manager, name)
        : `用法：/peek <名字>。当前在跑：${manager.listWorkers().map(w => w.name).join(', ') || '(无)'}`;
      dispatch({ type: 'sup-text-final', messageId: id, text: out });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      persistSup(id, out);
      return;
    }

    // /clean —— 把所有 stopped 工人从 map 里清掉（立即 sweep，不等 TTL）
    if (trimmed === '/clean') {
      const n = manager.sweepStopped(0);
      const id = mkMessageId();
      const uid = `u_${id}`;
      dispatch({ type: 'user-submit', text: trimmed, messageId: uid });
      persistUser(uid, trimmed);
      dispatch({ type: 'sup-reply-started', messageId: id });
      const out = `已清理 ${n} 个 stopped 工人`;
      dispatch({ type: 'sup-text-final', messageId: id, text: out });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      persistSup(id, out);
      dispatch({ type: 'workers-refreshed', workers: mapWorkers(manager.listWorkers()) });
      return;
    }

    // 未注册的 / 命令：不要扔给 Sup 当人话，给个友好错误
    if (trimmed.startsWith('/')) {
      const head = trimmed.split(/\s/)[0] ?? '';
      const id = mkMessageId();
      const uid = `u_${id}`;
      dispatch({ type: 'user-submit', text: trimmed, messageId: uid });
      persistUser(uid, trimmed);
      dispatch({ type: 'sup-reply-started', messageId: id });
      const out = `不认识 \`${head}\`。可选命令：${SLASH_COMMANDS.map(c => c.name).join(', ')}\n（输入 \`/\` 会弹出补全菜单）`;
      dispatch({ type: 'sup-text-final', messageId: id, text: out });
      dispatch({ type: 'sup-turn-completed', messageId: id, toolCallCount: 0 });
      persistSup(id, out);
      return;
    }

    const uid = `u_${mkMessageId()}`;
    const sid = `s_${mkMessageId()}`;
    dispatch({ type: 'user-submit', text: trimmed, messageId: uid });
    persistUser(uid, trimmed);
    dispatch({ type: 'sup-reply-started', messageId: sid });

    const observer: ChatObserver = {
      onTextDelta: (delta) => dispatch({ type: 'sup-text-delta', messageId: sid, delta }),
      onToolCall: (toolName, inputObj) => {
        dispatch({ type: 'tool-call', callId: mkMessageId(), toolName: shortenToolName(toolName), inputSummary: summarizeInput(inputObj), workerName: extractWorkerName(inputObj) });
      },
      onToolResult: (_callId, output, isError) => {
        if (isError) {
          const preview = (() => {
            const s = typeof output === 'string' ? output : JSON.stringify(output);
            return s.length > 120 ? s.slice(0, 117) + '…' : s;
          })();
          dispatch({ type: 'tool-result-error', preview });
        }
      },
      onError: (message, fatal) => { dispatch({ type: 'error', message }); if (fatal) void onExit(); },
    };

    try {
      const result = await supervisor.chat(trimmed, observer);
      dispatch({ type: 'sup-text-final', messageId: sid, text: result.text });
      dispatch({ type: 'sup-turn-completed', messageId: sid, toolCallCount: result.toolCallCount });
      persistSup(sid, result.text);
      dispatch({ type: 'workers-refreshed', workers: mapWorkers(manager.listWorkers()) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'sup-text-final', messageId: sid, text: `[error] ${msg}` });
      dispatch({ type: 'sup-turn-completed', messageId: sid, toolCallCount: 0 });
      persistSup(sid, `[error] ${msg}`);
    }
  }, [supervisor, manager, onExit, exit, persistUser, persistSup, state.dormantWorkers, state.status.kind]);

  // Turn 结束后 drain 一条输入队列。注意 handleSubmit 自己会再次进入 chatting
  // 状态（Sup 的 chat 路径）或者直接完成（本地命令），下一轮再触发这个 effect。
  const drainingRef = useRef(false);
  useEffect(() => {
    if (state.status.kind !== 'ready') return;
    if (inputQueueRef.current.length === 0) return;
    if (drainingRef.current) return;
    drainingRef.current = true;
    const next = inputQueueRef.current.shift()!;
    setQueueLen(inputQueueRef.current.length);
    // 用 Promise.resolve 让出当前 render，再 submit
    void Promise.resolve().then(async () => {
      try {
        await handleSubmit(next);
      } finally {
        drainingRef.current = false;
      }
    });
  }, [state.status.kind, handleSubmit]);

  // ─── 键盘 ─────────────────────

  useInput((ch, key) => {
    // 全局：Ctrl+C 退出
    if (key.ctrl && ch === 'c') { void (async () => { await onExit(); exit(); })(); return; }

    // Ctrl+L 清屏（Claude Code 同键）
    if (key.ctrl && ch === 'l') {
      dispatch({ type: 'clear-chat' });
      flushedRef.current.clear();
      return;
    }

    if (panelMode === 'tasks') {
      if (key.tab) { setPanelMode('chat'); return; }
      if (key.escape) { setPanelMode('chat'); return; }
      if (key.upArrow) { setTaskCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setTaskCursor(c => Math.min(state.workers.length - 1, c)); return; }
      return;
    }

    // ─── chat 模式 ───
    // Slash 命令菜单打开时，↑↓ 导航菜单、Tab 自动补全、Esc 取消。
    if (slashMenuOpen) {
      if (key.upArrow) { setSlashCursor((c) => (c - 1 + slashMatches.length) % slashMatches.length); return; }
      if (key.downArrow) { setSlashCursor((c) => (c + 1) % slashMatches.length); return; }
      if (key.tab) {
        const cmd = slashMatches[slashCursor];
        if (cmd) {
          const needsArg = cmd.usage.includes('<') || cmd.usage.includes('[');
          setInput(cmd.name + (needsArg ? ' ' : ''));
        }
        return;
      }
      if (key.escape) {
        setInput('');
        return;
      }
      // 否则放过给 TextInput
      return;
    }

    // 没开 menu：Tab 切任务面板
    if (key.tab) { setPanelMode('tasks'); return; }

    // Esc 清输入 + 重置历史游标
    if (key.escape) {
      setInput('');
      historyCursor.current = -1;
      return;
    }

    // 上 = 更早历史，下 = 更近（或回到草稿）
    if (key.upArrow) {
      const hist = historyRef.current;
      if (hist.length === 0) return;
      const cur = historyCursor.current;
      const next = cur < 0 ? hist.length - 1 : Math.max(0, cur - 1);
      historyCursor.current = next;
      setInput(hist[next] ?? '');
      return;
    }
    if (key.downArrow) {
      const hist = historyRef.current;
      const cur = historyCursor.current;
      if (cur < 0) return; // 已经在草稿
      if (cur >= hist.length - 1) {
        historyCursor.current = -1;
        setInput('');
      } else {
        const next = cur + 1;
        historyCursor.current = next;
        setInput(hist[next] ?? '');
      }
      return;
    }
  });

  // ─── Splash ─────────────────────

  const hideSplash = useCallback(() => setShowSplash(false), []);
  if (showSplash) {
    const personaName = getPersonaOrDefault(persistence.meta.personaId).name;
    return (
      <Splash
        width={cols}
        adapterName={adapter.displayName}
        personaName={personaName}
        resumed={persistence.resumed}
        onDone={hideSplash}
      />
    );
  }

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
          <Box key={msg.id} flexDirection="column" paddingX={1} marginBottom={1}>
            {msg.role === 'user' ? (
              <Text color="cyan"><Text bold>&gt;</Text> {msg.text}</Text>
            ) : (
              <Markdown text={msg.text} />
            )}
          </Box>
        )}
      </Static>

      {/* 正在生成的消息（动态区，会被下次渲染覆盖） */}
      {streamingMsg && (
        <Box paddingX={1}>
          {streamingMsg.text
            ? <Markdown text={streamingMsg.text} />
            : <Text dimColor>...</Text>
          }
        </Box>
      )}

      {/* 思考中指示器：显示当前工具 + 目标，比 "thinking N calls" 直观 */}
      {isChatting && !streamingMsg && (
        <Box paddingX={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          {state.currentTool ? (
            <>
              <Text dimColor> Sup 正在调 </Text>
              <Text color="cyan">{state.currentTool.name}</Text>
              {state.currentTool.target && (
                <Text dimColor> → {state.currentTool.target}</Text>
              )}
              <Text dimColor> ({state.currentTurnToolCalls}</Text>
              {state.currentTurnToolErrors > 0 && (
                <Text color="red"> · {state.currentTurnToolErrors} 错</Text>
              )}
              <Text dimColor>)</Text>
            </>
          ) : (
            <Text dimColor> 思考中 ({state.currentTurnToolCalls} 次工具调用)</Text>
          )}
        </Box>
      )}

      {/* 错误 banner：上次 turn 有 tool 报错或 fatal error 就显示，下次 user-submit 自动清 */}
      {state.lastError && !isChatting && (
        <Box paddingX={1} marginTop={0}>
          <Text color="red" bold>! </Text>
          <Text color="red">{state.lastError.message.length > 100 ? state.lastError.message.slice(0, 97) + '…' : state.lastError.message}</Text>
        </Box>
      )}

      {/* 分隔线 */}
      <Text dimColor>{line}</Text>

      {/* 任务列表（始终显示；dormant 单独一段） */}
      {(state.workers.length > 0 || state.dormantWorkers.length > 0) && (
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor bold>
            tasks ({state.workers.length}
            {state.dormantWorkers.length > 0 ? ` · +${state.dormantWorkers.length} dormant` : ''}
            )
          </Text>
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
          {state.dormantWorkers.map(w => {
            const age = formatAge(new Date(w.lastActivity));
            const meta = `${w.eventCount}ev · ${formatTokens(w.tokenUsed)}`;
            const label = truncate(w.initialPrompt, Math.max(20, cols - 50));
            return (
              <Box key={'d_' + w.name} flexDirection="column">
                <Box>
                  <Text color="gray"> · </Text>
                  <Text color="gray">{w.name.padEnd(6)}</Text>
                  <Text color="gray"> [dormant]     </Text>
                  <Text dimColor>{age.padStart(6)}  </Text>
                  <Text dimColor>{meta}</Text>
                </Box>
                <Box paddingLeft={4}>
                  <Text dimColor>{label}</Text>
                </Box>
              </Box>
            );
          })}
          {state.dormantWorkers.length > 0 && (
            <Box paddingLeft={1}>
              <Text dimColor italic>
                dormant = 上次 session 留下的历史工人。用 /respawn &lt;名字&gt; 重新拉起。
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Slash 命令补全 dropdown */}
      {slashMenuOpen && (
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor>──── commands ────</Text>
          {slashMatches.map((cmd, i) => {
            const focused = i === slashCursor;
            return (
              <Box key={cmd.name}>
                <Text color={focused ? 'cyan' : undefined} bold={focused}>
                  {focused ? '› ' : '  '}
                  {cmd.usage.padEnd(20)}
                </Text>
                <Text dimColor> {cmd.desc}</Text>
              </Box>
            );
          })}
          <Text dimColor>  ↑↓ 选择 · Tab 补全 · Esc 取消</Text>
        </Box>
      )}

      {/* 输入框 —— 总是显示，chatting 时提交到队列而不是立即发送 */}
      <Box paddingX={1}>
        <Text color={isChatting ? 'yellow' : 'cyan'} bold>&gt; </Text>
        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder={isChatting ? '总管还在回复中，你可以继续打字，会排队...' : ''} />
      </Box>

      {/* 底部提示 */}
      <Text dimColor>{line}</Text>
      <Box paddingX={1}>
        <Text dimColor>
          {slashMenuOpen
            ? '↑↓ 选 · Tab 补全 · Esc 取消'
            : '↵ 发送 · ↑↓ 历史 · Ctrl+L 清屏 · Esc 清输入 · Tab 任务 · / 命令'}
          {queueLen > 0 ? `  · queued: ${queueLen}` : ''}
        </Text>
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
