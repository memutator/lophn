import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { manualClock } from "../../base/clock.ts";
import { err, ok, type Result } from "../../base/result.ts";
import type {
  GuiHarness,
  HarnessCatalogResult,
} from "../../protocol/acp/gui-session.ts";
import {
  createHarnessCatalog,
  type HarnessCatalogScope,
  harnessCatalogFile,
} from "./harness-catalog.ts";

const T0 = Date.UTC(2026, 10, 23, 0, 0, 0);

function sampleCatalog(modelId: string, effort = "high"): HarnessCatalogResult {
  return {
    models: [
      {
        id: "default",
        label: "Models",
        models: [
          {
            id: modelId,
            label: modelId,
            axes: [
              {
                id: "effort",
                label: "Effort",
                kind: "choice",
                values: [
                  { value: "low", label: "Low" },
                  { value: "high", label: "High" },
                ],
              },
            ],
          },
        ],
      },
    ],
    defaults: {
      model: modelId,
      options: { effort },
    },
  };
}

function scopeOf(harness: GuiHarness): HarnessCatalogScope {
  return harness === "opencode" ? "workspace" : "global";
}

function createManualTimers() {
  let nextId = 1;
  const timers = new Map<number, { ms: number; fn: () => void }>();
  return {
    after(ms: number, fn: () => void): () => void {
      const id = nextId++;
      timers.set(id, { ms, fn });
      return () => {
        timers.delete(id);
      };
    },
    fireAll() {
      for (const [id, item] of [...timers.entries()]) {
        timers.delete(id);
        item.fn();
      }
    },
    pendingCount() {
      return timers.size;
    },
  };
}

test("probe 없는 read는 CLI를 띄우지 않고 empty를 돌려주며, 손상 cache 파일도 무시한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-harness-catalog-"));
  try {
    const file = harnessCatalogFile(root);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "{corrupt json");

    let fetchCalls = 0;
    const manager = createHarnessCatalog({
      dataRoot: root,
      clock: manualClock(T0),
      scopeOf,
      fetchCatalog: async () => {
        fetchCalls += 1;
        return ok(sampleCatalog("claude-opus-4-7"));
      },
    });

    const view = await manager.read({ harness: "claude" });
    assert.deepEqual(view, {
      harness: "claude",
      status: "empty",
      catalog: null,
      fetched_at: null,
      stale: false,
      error: null,
    });
    assert.equal(fetchCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("observe로 채운 catalog는 disk에 저장되어 새 instance에서 복원되고, 내용 변경 시에만 onChanged를 낸다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-harness-catalog-"));
  try {
    const clock = manualClock(T0);
    const changed: GuiHarness[] = [];
    const manager = createHarnessCatalog({
      dataRoot: root,
      clock,
      scopeOf,
      staleAfterMs: 60_000,
      onChanged: (harness) => changed.push(harness),
      fetchCatalog: async () => {
        throw new Error("should not probe cached catalog");
      },
    });

    const first = sampleCatalog("claude-opus-4-7");
    await manager.observe("claude", undefined, first);
    // 같은 내용의 observe는 알림을 중복 발송하지 않는다.
    clock.advance(10_000);
    await manager.observe("claude", undefined, first);
    // 내용이 바뀌면 다시 알린다.
    const second = sampleCatalog("claude-sonnet-4-6");
    clock.advance(10_000);
    await manager.observe("claude", undefined, second);

    assert.deepEqual(changed, ["claude", "claude"]);

    // disk에 JSON이 저장되었고 새 instance가 그대로 복원한다.
    const saved = JSON.parse(
      await readFile(harnessCatalogFile(root), "utf8"),
    ) as { version: number; entries: unknown[] };
    assert.equal(saved.version, 1);
    assert.equal(saved.entries.length, 1);

    const reloaded = createHarnessCatalog({
      dataRoot: root,
      clock,
      scopeOf,
      staleAfterMs: 60_000,
      fetchCatalog: async () => {
        throw new Error("should not probe after reload");
      },
    });
    const fresh = await reloaded.read({ harness: "claude", probe: true });
    assert.equal(fresh.status, "ready");
    assert.equal(fresh.stale, false);
    assert.deepEqual(fresh.catalog, second);

    clock.advance(60_000);
    const stale = await reloaded.read({ harness: "claude" });
    assert.equal(stale.status, "ready");
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.catalog, second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("동시에 들어온 read(probe: true)와 refresh는 하나의 fetch로 합쳐진다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-harness-catalog-"));
  try {
    let fetchCalls = 0;
    let release!: (result: Result<HarnessCatalogResult>) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const manager = createHarnessCatalog({
      dataRoot: root,
      clock: manualClock(T0),
      scopeOf,
      fetchCatalog: () => {
        fetchCalls += 1;
        markStarted();
        return new Promise<Result<HarnessCatalogResult>>((resolve) => {
          release = resolve;
        });
      },
    });

    const p1 = manager.read({ harness: "codex", probe: true });
    const p2 = manager.read({ harness: "codex", probe: true });
    const p3 = manager.refresh({ harness: "codex" });

    await started;
    assert.equal(fetchCalls, 1);

    const catalog = sampleCatalog("gpt-5.3-codex");
    release(ok(catalog));

    const [v1, v2, v3] = await Promise.all([p1, p2, p3]);
    assert.equal(fetchCalls, 1);
    for (const view of [v1, v2, v3]) {
      assert.equal(view.status, "ready");
      assert.deepEqual(view.catalog, catalog);
      assert.equal(view.error, null);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deadline 초과 시 signal을 abort하고 기존 cached catalog를 지우지 않은 채 error를 돌려준다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-harness-catalog-"));
  try {
    const clock = manualClock(T0);
    const timers = createManualTimers();
    let markRefreshStarted!: (signal: AbortSignal) => void;
    const refreshStarted = new Promise<AbortSignal>((resolve) => {
      markRefreshStarted = resolve;
    });
    const cached = sampleCatalog("claude-opus-4-7");

    const manager = createHarnessCatalog({
      dataRoot: root,
      clock,
      scopeOf,
      timeoutMs: 20_000,
      after: timers.after,
      fetchCatalog: (_harness, options) => {
        markRefreshStarted(options.signal);
        return new Promise<Result<HarnessCatalogResult>>(() => {});
      },
    });

    await manager.observe("claude", undefined, cached);
    clock.advance(5_000);

    const pending = manager.refresh({ harness: "claude" });
    const seenSignal = await refreshStarted;
    assert.equal(timers.pendingCount(), 1);
    assert.equal(seenSignal.aborted, false);

    timers.fireAll();
    const failed = await pending;
    assert.equal(seenSignal.aborted, true);
    assert.equal(failed.status, "error");
    assert.deepEqual(failed.catalog, cached);
    assert.equal(failed.fetched_at, "2026-11-23T00:00:00.000Z");
    assert.match(failed.error ?? "", /timed out/);

    // cache가 보존되어 다음 read는 여전히 ready다.
    const afterRead = await manager.read({ harness: "claude" });
    assert.equal(afterRead.status, "ready");
    assert.deepEqual(afterRead.catalog, cached);

    // stop()도 진행 중인 probe의 signal을 취소한다.
    let markStopStarted!: (signal: AbortSignal) => void;
    const stopStarted = new Promise<AbortSignal>((resolve) => {
      markStopStarted = resolve;
    });
    const manager2 = createHarnessCatalog({
      dataRoot: root,
      clock,
      scopeOf,
      after: timers.after,
      fetchCatalog: (_harness, options) => {
        markStopStarted(options.signal);
        return new Promise<Result<HarnessCatalogResult>>((resolve) => {
          options.signal.addEventListener(
            "abort",
            () => resolve(err({ code: "unavailable", message: "aborted" })),
            { once: true },
          );
        });
      },
    });
    const inFlight = manager2.refresh({ harness: "codex" });
    const stopSignal = await stopStarted;
    manager2.stop();
    const stopped = await inFlight;
    assert.equal(stopSignal.aborted, true);
    assert.equal(stopped.status, "error");
    assert.equal(timers.pendingCount(), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace 범위 harness는 cwd별로 cache를 분리하고 global 범위 harness는 한 key를 공유한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-harness-catalog-"));
  try {
    const fetchLog: { harness: GuiHarness; cwd: string | undefined }[] = [];
    const manager = createHarnessCatalog({
      dataRoot: root,
      clock: manualClock(T0),
      scopeOf,
      fetchCatalog: async (harness, options) => {
        fetchLog.push({ harness, cwd: options.cwd });
        const model =
          harness === "opencode"
            ? `opencode-${options.cwd ?? "global"}`
            : `${harness}-shared`;
        return ok(sampleCatalog(model));
      },
    });

    const ocA = await manager.read({
      harness: "opencode",
      cwd: "/repo/a",
      probe: true,
    });
    const ocB = await manager.read({
      harness: "opencode",
      cwd: "/repo/b",
      probe: true,
    });
    const ocA2 = await manager.read({
      harness: "opencode",
      cwd: "/repo/a",
      probe: true,
    });

    assert.equal(ocA.catalog?.defaults.model, "opencode-/repo/a");
    assert.equal(ocB.catalog?.defaults.model, "opencode-/repo/b");
    assert.equal(ocA2.catalog?.defaults.model, "opencode-/repo/a");

    const claudeA = await manager.read({
      harness: "claude",
      cwd: "/repo/a",
      probe: true,
    });
    const claudeB = await manager.read({
      harness: "claude",
      cwd: "/repo/b",
      probe: true,
    });

    assert.equal(claudeA.catalog?.defaults.model, "claude-shared");
    assert.equal(claudeB.catalog?.defaults.model, "claude-shared");
    // opencode는 cwd마다 1번씩(2번), claude는 1번만 fetch한다.
    assert.deepEqual(fetchLog, [
      { harness: "opencode", cwd: "/repo/a" },
      { harness: "opencode", cwd: "/repo/b" },
      { harness: "claude", cwd: "/repo/a" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
