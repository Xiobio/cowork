/**
 * cowork 基础设施场景测试。
 *
 * 直接使用编译后的 WorkerManager / IpcServer / IpcClient / 真 adapter（claude + codex）。
 * 不走 TUI、不走 Supervisor LLM —— 专注验证工人生命周期和 IPC 正确性。
 *
 * 使用方法:
 *   npm run build
 *   node test-scenarios.mjs
 */

import { WorkerManager } from './dist/worker-manager/manager.js';
import { IpcServer } from './dist/worker-manager/ipc-server.js';
import { IpcClient } from './dist/worker-manager/ipc-client.js';
import { getAdapter } from './dist/sup-runtime/registry.js';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TRIVIAL_PROMPT = 'say "ok" and then stop immediately. no tools, no explanation.';

// ─── 工具 ─────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeTempCwd() {
  return mkdtempSync(join(tmpdir(), 'cowork-test-'));
}

function cleanup(path) {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function makeManager(adapterName = 'claude') {
  const adapter = getAdapter(adapterName);
  const root = makeTempCwd();
  const manager = new WorkerManager({
    adapter,
    adapterName: adapter.name,
    workerCwdRoot: root,
  });
  return { manager, adapter, root };
}

async function waitFor(fn, timeoutMs, checkEveryMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(checkEveryMs);
  }
  return false;
}

// ─── 场景 ─────────────────────────────────────

/**
 * 场景 1 —— 3 个并发工人。
 * 验证：并发 spawn 不互相踩；每个拿到独立 pid；状态进入 running/idle；kill 全部干净。
 */
async function scenario1_ThreeConcurrent(round) {
  const tag = `s1r${round}`;
  const { manager, adapter, root } = makeManager('claude');
  const errors = [];
  const created = [];

  try {
    const cwds = [makeTempCwd(), makeTempCwd(), makeTempCwd()];
    const names = [`${tag}_a`, `${tag}_b`, `${tag}_c`];

    // 并发 spawn
    const results = await Promise.all(
      names.map((n, i) => manager.spawnWorker(n, cwds[i], TRIVIAL_PROMPT)),
    );
    results.forEach((r, i) => {
      if (!r.ok) errors.push(`spawn ${names[i]} 失败: ${r.error}`);
      else created.push(names[i]);
    });

    if (errors.length > 0) return { ok: false, errors };

    // 每个工人都要在 list 里
    const workers = manager.listWorkers();
    if (workers.length !== 3) errors.push(`listWorkers 应为 3, 实为 ${workers.length}`);

    // 每个 pid 唯一
    const pids = new Set(workers.map((w) => w.pid));
    if (pids.size !== 3) errors.push(`pid 应唯一, 实际 ${[...pids].join(',')}`);

    // 每个应 running（spawn 后 state 立即置为 running）
    for (const w of workers) {
      if (w.state !== 'running' && w.state !== 'starting' && w.state !== 'idle') {
        errors.push(`${w.name} state 异常: ${w.state}`);
      }
    }

    // 等 1-3 秒让事件流起来
    await sleep(1500);

    // 清理
    for (const cwd of cwds) cleanup(cwd);
  } catch (err) {
    errors.push(`exception: ${err.message}`);
  } finally {
    try {
      await manager.stopAll();
    } catch {
      /* ignore */
    }
    cleanup(root);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 场景 2 —— spawn 后中途 kill。
 * 验证：killWorker 能终止活跃工人；状态变 stopped；后续 listWorkers 仍可见但 state 正确。
 */
async function scenario2_KillMid(round) {
  const tag = `s2r${round}`;
  const { manager, root } = makeManager('claude');
  const errors = [];
  const cwd = makeTempCwd();

  try {
    const name = `${tag}_k`;
    const r = await manager.spawnWorker(name, cwd, TRIVIAL_PROMPT);
    if (!r.ok) {
      errors.push(`spawn 失败: ${r.error}`);
      return { ok: false, errors };
    }

    // 等工人开始工作
    const started = await waitFor(() => {
      const w = manager.getWorker(name);
      return w && (w.state === 'running' || w.state === 'idle' || w.eventCount > 0);
    }, 5000);
    if (!started) errors.push('工人未进入 running 状态');

    // 中途 kill
    const killR = await manager.killWorker(name, true);
    if (!killR.ok) errors.push(`kill 失败: ${killR.error}`);

    // 状态应变 stopped（最多 1 秒）
    const stopped = await waitFor(() => {
      const w = manager.getWorker(name);
      return w?.state === 'stopped';
    }, 2000);
    if (!stopped) {
      const w = manager.getWorker(name);
      errors.push(`kill 后 state 未变 stopped, 实为 ${w?.state}`);
    }

    // 重复 kill 应报错而不是崩
    const killR2 = await manager.killWorker(name, true);
    // 可能成功（幂等）也可能报 already stopped，但不能 throw — 返回值里应有 ok 字段
    if (typeof killR2.ok !== 'boolean') errors.push('重复 kill 返回值不含 ok 字段');
  } catch (err) {
    errors.push(`exception: ${err.message}`);
  } finally {
    try {
      await manager.stopAll();
    } catch {
      /* ignore */
    }
    cleanup(cwd);
    cleanup(root);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 场景 3 —— 跨 adapter 对称性（单次，round 决定 adapter）。
 * round 偶数走 claude，奇数走 codex；验证 spawn / send / kill 在两种 adapter 上行为一致。
 */
async function scenario3_CrossAdapter(round, adapterName) {
  const tag = `s3_${adapterName}_r${round}`;
  let mgrBundle;
  try {
    mgrBundle = makeManager(adapterName);
  } catch (err) {
    return { ok: false, errors: [`未知 adapter ${adapterName}: ${err.message}`] };
  }
  const { manager, adapter, root } = mgrBundle;
  const errors = [];
  const cwd = makeTempCwd();

  try {
    // 验证 probe 成功
    const probe = await adapter.probe();
    if (!probe.installed) {
      errors.push(`adapter ${adapterName} probe 失败: ${probe.error ?? 'unknown'}`);
      return { ok: false, errors };
    }

    const name = `${tag}_w`;
    const r = await manager.spawnWorker(name, cwd, TRIVIAL_PROMPT);
    if (!r.ok) {
      errors.push(`spawn 失败: ${r.error}`);
      return { ok: false, errors };
    }

    // 等状态
    const ready = await waitFor(() => {
      const w = manager.getWorker(name);
      return w && (w.state === 'running' || w.state === 'idle' || w.eventCount > 0);
    }, 8000);
    if (!ready) errors.push('spawn 后工人未进入活跃状态');

    // 发一条消息
    const sendR = await manager.sendToWorker(name, 'ack');
    if (!sendR.ok) errors.push(`send 失败: ${sendR.error}`);

    // kill
    const killR = await manager.killWorker(name, true);
    if (!killR.ok) errors.push(`kill 失败: ${killR.error}`);

    const stopped = await waitFor(() => {
      const w = manager.getWorker(name);
      return w?.state === 'stopped';
    }, 2000);
    if (!stopped) errors.push(`kill 后 state 未变 stopped`);
  } catch (err) {
    errors.push(`exception: ${err.message}`);
  } finally {
    try {
      await manager.stopAll();
    } catch {
      /* ignore */
    }
    cleanup(cwd);
    cleanup(root);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 场景 4 —— 错误处理 / 慢 CLI。
 * 验证：spawn 不存在的工人名、重复名、spawn 失败时 manager 不崩、sendToWorker 到不存在的工人返回 ok:false。
 */
async function scenario4_ErrorPaths(round) {
  const tag = `s4r${round}`;
  const { manager, root } = makeManager('claude');
  const errors = [];
  const cwd = makeTempCwd();

  try {
    // 1. 给不存在的工人发消息应返回 ok:false
    const r1 = await manager.sendToWorker('no_such_worker', 'hi');
    if (r1.ok) errors.push('对不存在工人 send 应返回 ok:false');

    // 2. kill 不存在的工人应返回 ok:false
    const r2 = await manager.killWorker('no_such_worker', true);
    if (r2.ok) errors.push('kill 不存在工人应返回 ok:false');

    // 3. spawn 一个正常工人
    const name = `${tag}_dup`;
    const r3 = await manager.spawnWorker(name, cwd, TRIVIAL_PROMPT);
    if (!r3.ok) {
      errors.push(`初次 spawn 失败: ${r3.error}`);
      return { ok: false, errors };
    }

    // 4. 同名重复 spawn 应返回 ok:false
    const r4 = await manager.spawnWorker(name, cwd, TRIVIAL_PROMPT);
    if (r4.ok) errors.push('重复名字 spawn 应返回 ok:false');

    // 5. peekEvents 对不存在工人应返回 null
    const events = manager.peekEvents('no_such_worker');
    if (events !== null) errors.push(`peekEvents 不存在工人应返回 null, 实为 ${events}`);

    // 6. readEvent 找不到的 id 应返回 null
    const ev = manager.readEvent('evt_99999');
    if (ev !== null) errors.push(`readEvent 未知 id 应返回 null`);

    // 7. 给已 kill 的工人发消息应返回 ok:false（不崩）
    await manager.killWorker(name, true);
    await waitFor(() => manager.getWorker(name)?.state === 'stopped', 2000);
    const r7 = await manager.sendToWorker(name, 'hi');
    if (r7.ok) errors.push('给 stopped 工人 send 应返回 ok:false');
  } catch (err) {
    errors.push(`exception: ${err.message}`);
  } finally {
    try {
      await manager.stopAll();
    } catch {
      /* ignore */
    }
    cleanup(cwd);
    cleanup(root);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 场景 5 —— 真 10 工人 IPC 压力测试。
 * 同时 spawn 10 个真 CLI 工人（claude），10 个 IPC client 同时打 list/get/send 方法。
 * 验证：10 并发 spawn 不相互踩；IPC 吞吐无丢失、无崩溃；bad-token 被拒；send_to_worker 返回 ok。
 */
async function scenario5_IpcStress(round) {
  const tag = `s5r${round}`;
  const { manager, root } = makeManager('claude');
  const ipc = new IpcServer(manager);
  const errors = [];
  const cwds = [];
  const clients = [];
  const WORKER_COUNT = 10;

  try {
    const info = await ipc.start();
    if (!info.token || info.port < 1) {
      errors.push('IPC server 未正常启动');
      return { ok: false, errors };
    }

    // 并发 spawn 10 个真工人
    const names = Array.from({ length: WORKER_COUNT }, (_, i) => `${tag}_w${i}`);
    for (let i = 0; i < WORKER_COUNT; i++) cwds.push(makeTempCwd());

    const spawnResults = await Promise.all(
      names.map((n, i) => manager.spawnWorker(n, cwds[i], TRIVIAL_PROMPT)),
    );
    spawnResults.forEach((r, i) => {
      if (!r.ok) errors.push(`spawn ${names[i]} 失败: ${r.error}`);
    });
    if (errors.length > 0) return { ok: false, errors };

    // 10 个并发 IPC client，每个打 5 × list + 3 × get + 2 × send = 10 次请求
    for (let i = 0; i < 10; i++) {
      clients.push(new IpcClient({ host: info.host, port: info.port, token: info.token }));
    }

    const clientResults = await Promise.all(
      clients.map(async (c, idx) => {
        const localErrors = [];
        try {
          await c.connect();
          for (let k = 0; k < 5; k++) {
            const list = await c.request('list_workers');
            if (!Array.isArray(list) || list.length !== WORKER_COUNT) {
              localErrors.push(`c${idx} list#${k} size=${list?.length}`);
            }
          }
          for (let k = 0; k < 3; k++) {
            const w = await c.request('get_worker', { name: names[k % WORKER_COUNT] });
            if (!w || typeof w !== 'object') {
              localErrors.push(`c${idx} get#${k} bad`);
            }
          }
          for (let k = 0; k < 2; k++) {
            const r = await c.request('send_to_worker', {
              name: names[(idx + k) % WORKER_COUNT],
              message: `ping ${idx}-${k}`,
            });
            if (!r || (r.ok !== true && r.ok !== false)) {
              localErrors.push(`c${idx} send#${k} bad shape`);
            }
          }
        } catch (err) {
          localErrors.push(`c${idx} exception: ${err.message}`);
        }
        return localErrors;
      }),
    );
    clientResults.forEach((e) => errors.push(...e));

    // bad-token 应被拒
    const evil = new IpcClient({ host: info.host, port: info.port, token: 'deadbeef' });
    try {
      await evil.connect();
      errors.push('bad-token client 不应连上');
    } catch {
      /* expected */
    }
    evil.close();

    // 验证所有 10 个工人仍在
    const live = manager.listWorkers();
    if (live.length !== WORKER_COUNT) {
      errors.push(`压测后工人数=${live.length}, 应为 ${WORKER_COUNT}`);
    }
  } catch (err) {
    errors.push(`exception: ${err.message}`);
  } finally {
    for (const c of clients) {
      try { c.close(); } catch { /* ignore */ }
    }
    try { await manager.stopAll(); } catch { /* ignore */ }
    try { await ipc.stop(); } catch { /* ignore */ }
    for (const cwd of cwds) cleanup(cwd);
    cleanup(root);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 场景 6 —— 端到端真 LLM round-trip。
 * spawn 一个真 claude 工人，发 prompt，等真实 assistant_text 事件到来，
 * 验证文本非空。证明整条 pipeline（spawn → stdin → LLM → stdout → parser → event queue）
 * 不是幻觉。
 */
async function scenario6_EndToEnd(round) {
  const tag = `s6r${round}`;
  const { manager, root } = makeManager('claude');
  const cwd = makeTempCwd();
  const errors = [];
  const name = `${tag}_e2e`;

  try {
    const r = await manager.spawnWorker(name, cwd, 'respond exactly with the single word: ok');
    if (!r.ok) {
      errors.push(`spawn 失败: ${r.error}`);
      return { ok: false, errors };
    }

    // 等真实 assistant_text 事件（最多 60s）
    const gotText = await waitFor(() => {
      const events = manager.peekEvents(name, { limit: 50 }) ?? [];
      return events.some((e) => e.type === 'assistant_text');
    }, 60000, 250);

    if (!gotText) {
      const events = manager.peekEvents(name, { limit: 50 }) ?? [];
      errors.push(`60s 内未收到 assistant_text。实际事件类型: ${events.map((e) => e.type).join(',') || '(none)'}`);
      return { ok: false, errors };
    }

    // 读一条文本看看真不真
    const events = manager.peekEvents(name, { limit: 50 }) ?? [];
    const textEvt = events.find((e) => e.type === 'assistant_text');
    if (textEvt) {
      const body = manager.readEvent(textEvt.id);
      const text = typeof body?.body === 'string' ? body.body : '';
      if (text.length < 1) {
        errors.push(`assistant_text 内容为空`);
      }
      console.log(`\n         └─ 真实回复: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
    }

    // clean up
    await manager.killWorker(name, true);
    await waitFor(() => manager.getWorker(name)?.state === 'stopped', 3000);
  } catch (err) {
    errors.push(`exception: ${err.message}`);
  } finally {
    try { await manager.stopAll(); } catch { /* ignore */ }
    cleanup(cwd);
    cleanup(root);
  }
  return { ok: errors.length === 0, errors };
}

// ─── 主 ──────────────────────────────────────

const plan = [
  // 场景 1: 3 并发工人
  { id: 1, name: '3 并发工人 (claude)', fn: () => scenario1_ThreeConcurrent(1) },
  // 场景 2: 中途 kill
  { id: 2, name: '中途 kill (claude)', fn: () => scenario2_KillMid(1) },
  // 场景 3: 跨 adapter claude × 5
  { id: 3, name: '跨 adapter claude #1', fn: () => scenario3_CrossAdapter(1, 'claude') },
  { id: 4, name: '跨 adapter claude #2', fn: () => scenario3_CrossAdapter(2, 'claude') },
  { id: 5, name: '跨 adapter claude #3', fn: () => scenario3_CrossAdapter(3, 'claude') },
  { id: 6, name: '跨 adapter claude #4', fn: () => scenario3_CrossAdapter(4, 'claude') },
  { id: 7, name: '跨 adapter claude #5', fn: () => scenario3_CrossAdapter(5, 'claude') },
  // 场景 3: 跨 adapter codex × 5
  { id: 8, name: '跨 adapter codex #1', fn: () => scenario3_CrossAdapter(1, 'codex') },
  { id: 9, name: '跨 adapter codex #2', fn: () => scenario3_CrossAdapter(2, 'codex') },
  { id: 10, name: '跨 adapter codex #3', fn: () => scenario3_CrossAdapter(3, 'codex') },
  { id: 11, name: '跨 adapter codex #4', fn: () => scenario3_CrossAdapter(4, 'codex') },
  { id: 12, name: '跨 adapter codex #5', fn: () => scenario3_CrossAdapter(5, 'codex') },
  // 场景 4: 错误路径
  { id: 13, name: '错误路径', fn: () => scenario4_ErrorPaths(1) },
  // 场景 5: 真 10 工人 IPC 压测
  { id: 14, name: '真 10 工人 IPC 压测', fn: () => scenario5_IpcStress(1) },
  // 场景 6: 端到端真 LLM round-trip（证明整条管道真在工作）
  { id: 15, name: '端到端 LLM round-trip', fn: () => scenario6_EndToEnd(1) },
];

const results = [];

console.log(`\n========================================`);
console.log(`cowork 10 轮场景测试 (${new Date().toISOString()})`);
console.log(`========================================\n`);

for (const test of plan) {
  const t0 = Date.now();
  process.stdout.write(`[R${test.id.toString().padStart(2, '0')}] ${test.name.padEnd(32)} `);
  try {
    const r = await test.fn();
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.ok) {
      console.log(`✓ PASS (${dt}s)`);
    } else {
      console.log(`✗ FAIL (${dt}s)`);
      for (const e of r.errors) console.log(`         └─ ${e}`);
    }
    results.push({ id: test.id, name: test.name, ok: r.ok, errors: r.errors, ms: Date.now() - t0 });
  } catch (err) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✗ THROW (${dt}s): ${err.message}`);
    results.push({ id: test.id, name: test.name, ok: false, errors: [err.message], ms: Date.now() - t0 });
  }
}

// ─── 汇总 ─────────────────────────────────────

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const totalS = (results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1);

console.log(`\n========================================`);
console.log(`结果: ${passed}/${results.length} PASS  ${failed} FAIL  耗时 ${totalS}s`);
console.log(`========================================`);

if (failed > 0) {
  console.log('\n失败明细:');
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  R${r.id} ${r.name}:`);
    for (const e of r.errors) console.log(`    - ${e}`);
  }
  process.exit(1);
}

process.exit(0);
