/**
 * Supervisor —— cowork 的 Sup 大脑。
 *
 * 不是 LLM 本身。LLM 是底下那个 CLI subprocess（Codex / Claude Code / …），
 * 通过 Adapter 驱动。这个 Supervisor 类只做：
 * 1. 持有一个 RunningSession
 * 2. chat() 把用户的话送给 Sup，然后消费 events 直到 turn_completed
 * 3. 把流过去的 tool calls / assistant text 暴露给 UI 层
 *
 * 系统提示词由 src/persona/index.ts 按 personaId 构造（10 套 persona），
 * 不再写死在这里。要改基础规则改 persona/index.ts BASE_RULES。
 */

import type { CanonicalEvent, RunningSession } from './sup-runtime/types.js';
import { buildPrompt, getPersonaOrDefault } from './persona/index.js';

/**
 * 按 persona id 构造 Sup 的系统提示词。当前活着的 Sup CLI subprocess 是
 * spawn 时把 prompt 锁定的，切 persona 要 /quit 后重新 spawn 才生效。
 *
 * carryoverSummary：上次 session 用 /compact 生成的总结。--new 时会从最近
 * 一个 session 的 meta 拿过来塞进新 session，让新 Sup 立即"知道之前发生过啥"。
 */
export function buildSupervisorPrompt(
  personaId: string | null | undefined,
  carryoverSummary?: string | null,
  projectMd?: string | null,
): string {
  const persona = getPersonaOrDefault(personaId);
  return buildPrompt(persona, carryoverSummary ?? undefined, projectMd ?? undefined);
}

// ─── 流式事件处理 ──────────────────────────────────

export interface ChatObserver {
  /** 新的 assistant 文本 delta（用于流式 UI） */
  onTextDelta?(delta: string): void;
  /** Sup 调了一个工具 */
  onToolCall?(toolName: string, input: unknown): void;
  /** 工具返回了结果 */
  onToolResult?(callId: string, output: unknown, isError: boolean): void;
  /** Sup 内部错误 */
  onError?(message: string, fatal: boolean): void;
}

export interface ChatResult {
  text: string;
  toolCallCount: number;
  stopReason: 'end_turn' | 'max_tokens' | 'interrupted' | 'error';
  /** 本 turn 的 token 用量（claude 解析自 result.usage；codex 暂无） */
  usage?: import('./sup-runtime/types.js').TurnUsage;
}

// ─── Supervisor ──────────────────────────────────

export class Supervisor {
  private readonly session: RunningSession;
  private readonly iter: AsyncIterator<CanonicalEvent>;

  constructor(session: RunningSession) {
    this.session = session;
    this.iter = session.events()[Symbol.asyncIterator]();
  }

  async chat(
    userMessage: string,
    observer?: ChatObserver,
    opts?: { idleTimeoutMs?: number },
  ): Promise<ChatResult> {
    const idleMs = opts?.idleTimeoutMs ?? 120_000;
    await this.session.sendUserMessage(userMessage);

    const textParts: string[] = [];
    let toolCallCount = 0;
    let stopReason: ChatResult['stopReason'] = 'end_turn';

    while (true) {
      // 竞速 idle 超时：CLI 卡死时先试 interrupt 把它拖回来，不行再抛错。
      // 注意 orphan waiter 会留在 BaseRunningSession.waiters 里，
      // 下一次 chat 时会被第一条真正的事件消费掉，可接受。
      let timer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`chat idle timeout after ${idleMs}ms`)), idleMs);
      });
      let step: IteratorResult<CanonicalEvent>;
      try {
        step = await Promise.race([this.iter.next(), timeoutPromise]);
      } catch (err) {
        // idle 卡死：尝试 interrupt 一次，再给 2s grace 等 interrupted 事件
        observer?.onError?.(`idle timeout after ${idleMs}ms, 尝试 interrupt`, false);
        try { await this.session.sendInterrupt(); } catch { /* ignore */ }
        let graceTimer: NodeJS.Timeout | null = null;
        const grace = new Promise<never>((_, rej) => {
          graceTimer = setTimeout(() => rej(err instanceof Error ? err : new Error(String(err))), 2000);
        });
        try {
          step = await Promise.race([this.iter.next(), grace]);
        } catch {
          // interrupt 也没救回来，把错抛给上层
          stopReason = 'error';
          return { text: textParts.join('\n\n'), toolCallCount, stopReason };
        } finally {
          if (graceTimer) clearTimeout(graceTimer);
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
      const { value: event, done } = step;
      if (done) {
        // session 提前退出了，不正常
        stopReason = 'error';
        break;
      }

      switch (event.type) {
        case 'assistant_text':
          textParts.push(event.text);
          break;
        case 'assistant_text_delta':
          observer?.onTextDelta?.(event.delta);
          break;
        case 'tool_call':
          toolCallCount++;
          observer?.onToolCall?.(event.toolName, event.input);
          break;
        case 'tool_result':
          observer?.onToolResult?.(event.callId, event.output, event.isError);
          break;
        case 'session_error':
          observer?.onError?.(event.message, event.fatal);
          if (event.fatal) {
            stopReason = 'error';
          }
          break;
        case 'turn_completed':
          stopReason = event.stopReason;
          return {
            text: textParts.join('\n\n'),
            toolCallCount,
            stopReason,
            ...(event.usage ? { usage: event.usage } : {}),
          };
        case 'session_stopped':
          stopReason = 'error';
          return { text: textParts.join('\n\n'), toolCallCount, stopReason };
        default:
          // 其它事件（thinking / session_started）忽略
          break;
      }
    }

    return { text: textParts.join('\n\n'), toolCallCount, stopReason };
  }

  async interrupt(): Promise<void> {
    await this.session.sendInterrupt();
  }

  async stop(): Promise<void> {
    await this.session.stop();
  }
}
