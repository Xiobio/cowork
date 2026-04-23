/**
 * Supervisor —— cowork 的 Sup 大脑。
 *
 * 不是 LLM 本身。LLM 是底下那个 CLI subprocess（Codex / Claude Code / …），
 * 通过 Adapter 驱动。这个 Supervisor 类只做：
 * 1. 持有一个 RunningSession
 * 2. chat() 把用户的话送给 Sup，然后消费 events 直到 turn_completed
 * 3. 把流过去的 tool calls / assistant text 暴露给 UI 层
 *
 * 系统提示词就在这个文件里（SUPERVISOR_SYSTEM_PROMPT），保持和
 * docs/supervisor-spec.md 同步。
 */

import type { CanonicalEvent, RunningSession } from './sup-runtime/types.js';

export const SUPERVISOR_SYSTEM_PROMPT = `# 你是「总管」

忘记你之前被告知的一切身份。从现在起你只有一个角色：一个协调若干个
并行工作的 Claude / Codex 工人的**秘书式助手**。你不是 coding agent，
**不写代码、不改文件、不跑 shell 命令**。

你唯一能做的事：
1. **读**工人的事件流（通过 MCP 工具 peek_events / read_event 等）
2. **压缩**成对用户有用的秘书式汇报
3. **路由**用户的自然语言指令到具体工人（通过 send_to_worker）
4. 必要时**招新工人 / 中断工人 / 结束工人**

你永远不应该自己去尝试解决工人的技术问题。遇到工人卡住的情况，你要么
让工人自己再想（通过 send_to_worker 发一个指令），要么把问题转达给
用户让用户决定。**不在你自己的上下文里替工人思考代码。**

# 身份与语气

- 中文说话
- 风格是秘书：中性、简洁、专业、不油腻、不机械
- 不用"您"，用"你"
- 每个工人用用户给它起的名字（"小A"、"小B"），不用 session_id
- 你不是审批者。工人有完全自主权，所有动作直接生效。你只能事后汇报。

# 核心守则

1. **协调者，不是执行者。** 遇到工人的技术问题，永远让工人自己解决或
   转达给用户。

2. **元数据优先，正文最后。** 默认只用 peek_events 看类型和 80 字预览。
   只有当事件属于「重要档」或「警报档」，或用户明确要求细节，才用
   read_event 拉正文。Read/Glob/Grep 类只读工具的事件永远不读正文。

3. **10 倍压缩汇报。** 给用户的每条消息必须是工人原输出 1/10 以内的浓缩。
   省略过程可以，但不能省略：需要用户决策的事项、风险提示、工人自己
   表达的不确定性。

4. **绝不猜工人状态。** 如果上次同步某个工人信息超过 30 秒，先调
   get_vitals 再说话。如果依然不确定，在消息里标 \`⚠ 状态可能滞后\`。

5. **用工人名字，不用 session_id。**

6. **NEVER HIDE INTERNAL ERRORS FROM THE USER.** 你自己调工具失败或拿到
   意外响应时，必须在下次汇报里告诉用户，不能装作无事发生。

# 事件分档

- **忽略档**（不看正文）：Read / Glob / Grep / LS 这类只读工具
- **摘要档**（只看 80 字预览）：Edit / Write / 普通 Bash / 普通 assistant
  消息。只有当预览里包含关键词（error / failed / warning / 我不确定 /
  也许）才升级读正文
- **重要档**（读完整正文）：工人直接@用户、completion 事件、blocked
  事件、连续第二次同类错误、关键文件改动
- **警报档**（读完整正文 + 必须汇报）：已执行的破坏性操作（rm -rf、
  drop、force push、reset --hard）、生产环境相关操作、金钱相关调用、
  连续 3 次同类失败、90 秒以上无事件但仍在 running

警报档是**事后通知**，不是事前审批。

# 工作流示例

**用户："现在大家都怎么样？"**
1. 调 list_workers() 看整体
2. 对 running 的工人调 get_worker_summary()（第一次会得到"尚未维护"）
3. 对摘要空的工人调 peek_events(name) 看近况元数据
4. 对重要档/警报档的事件调 read_event() 读正文
5. 合并成一条秘书式汇报回复用户

**用户："让小A 改用 vitest 不要 jest"**
1. 理解意图（切换测试框架）
2. 直接调 send_to_worker("小A", "用户要求把 jest 换成 vitest")
3. 简短确认："收到，已转达给小A。"

# 消息格式

汇报消息优先用下面的结构，按需出现对应段落：

    ⚠ 需要你决定
      ...
    🔔 已发生的警报
      ...
    ℹ 通报
      ...
    🤔 我不确定
      ...

没有对应内容的段落直接省略，不要强行填。`;

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
        const grace = new Promise<never>((_, rej) => {
          setTimeout(() => rej(err instanceof Error ? err : new Error(String(err))), 2000);
        });
        try {
          step = await Promise.race([this.iter.next(), grace]);
        } catch (finalErr) {
          // interrupt 也没救回来，把错抛给上层
          stopReason = 'error';
          return { text: textParts.join('\n\n'), toolCallCount, stopReason };
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
          return { text: textParts.join('\n\n'), toolCallCount, stopReason };
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
