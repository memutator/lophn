// daemon 수준 harness model catalog cache와 lazy probe 관리자다.
// 기동 시 CLI를 띄우지 않는다: 열린 GUI 탭이 observe()로 공짜 캐싱하거나,
// 편집기가 probe: true / refresh()로 요청할 때만 단일 deadline과 in-flight dedup으로 조회한다.
// 마지막 성공 snapshot은 <dataRoot>/cache/harness-catalog.json에 원자 교체로 남겨 재시작 뒤에도 바로 연다.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { canonicalize } from "../../base/canonical-json.ts";
import type { Clock } from "../../base/clock.ts";
import { errorCode } from "../../base/errors.ts";
import type { Result } from "../../base/result.ts";
import {
  GUI_HARNESSES,
  type GuiHarness,
  type HarnessCatalogResult,
} from "../../protocol/acp/gui-session.ts";
import type { HarnessCatalogView } from "../../protocol/acp/harness-catalog.ts";
import { acpModelGroupSchema } from "../../protocol/acp/session.ts";

export const DEFAULT_CATALOG_TIMEOUT_MS = 20_000;
export const DEFAULT_CATALOG_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const GLOBAL_SCOPE_KEY = "__global__";
const CACHE_VERSION = 1;

export type HarnessCatalogScope = "global" | "workspace";

export type HarnessCatalogDeps = {
  dataRoot: string;
  clock: Clock;
  fetchCatalog(
    harness: GuiHarness,
    options: { cwd?: string; signal: AbortSignal },
  ): Promise<Result<HarnessCatalogResult>>;
  scopeOf(harness: GuiHarness): HarnessCatalogScope;
  onChanged?(harness: GuiHarness): void;
  timeoutMs?: number;
  staleAfterMs?: number;
  log?(message: string): void;
  after?(ms: number, fn: () => void): () => void;
};

export type HarnessCatalogManager = {
  /** 열린 GUI 탭이 model 목록을 받았을 때 memory·disk cache를 갱신한다. 내용이 바뀌면 onChanged를 부른다. */
  observe(
    harness: GuiHarness,
    scopeCwd: string | undefined,
    result: HarnessCatalogResult,
  ): Promise<void>;
  read(input: {
    harness: GuiHarness;
    cwd?: string;
    probe?: boolean;
  }): Promise<HarnessCatalogView>;
  refresh(input: {
    harness: GuiHarness;
    cwd?: string;
  }): Promise<HarnessCatalogView>;
  /** 진행 중인 probe의 AbortSignal을 모두 취소한다. */
  stop(): void;
};

/** disk cache file 경로. */
export function harnessCatalogFile(dataRoot: string): string {
  return join(dataRoot, "cache", "harness-catalog.json");
}

const storedCatalogSchema = z.strictObject({
  models: z.array(acpModelGroupSchema),
  defaults: z.strictObject({
    model: z.string().nullable(),
    options: z.record(z.string(), z.string()),
  }),
});

const storedEntrySchema = z.strictObject({
  harness: z.enum(GUI_HARNESSES),
  scope: z.string().min(1),
  catalog: storedCatalogSchema,
  fetched_at: z.string().min(1),
  fetched_at_ms: z.number().finite(),
});

type StoredEntry = z.infer<typeof storedEntrySchema>;

const storedFileSchema = z.strictObject({
  version: z.literal(CACHE_VERSION),
  entries: z.array(z.unknown()),
});

type InFlight = {
  controller: AbortController;
  promise: Promise<HarnessCatalogView>;
};

function defaultAfter(ms: number, fn: () => void): () => void {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, file);
  } catch (thrown) {
    await rm(temp, { force: true }).catch(() => {});
    throw thrown;
  }
}

function cacheKey(harness: GuiHarness, scope: string): string {
  return `${harness}\0${scope}`;
}

export function createHarnessCatalog(
  deps: HarnessCatalogDeps,
): HarnessCatalogManager {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS;
  const staleAfterMs = deps.staleAfterMs ?? DEFAULT_CATALOG_STALE_AFTER_MS;
  const after = deps.after ?? defaultAfter;
  const file = harnessCatalogFile(deps.dataRoot);

  const entries = new Map<string, StoredEntry>();
  const inFlight = new Map<string, InFlight>();

  let loaded = false;
  let loadPromise: Promise<Map<string, StoredEntry>> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  function scopeKeyOf(harness: GuiHarness, cwd?: string): string {
    if (deps.scopeOf(harness) !== "workspace") return GLOBAL_SCOPE_KEY;
    const trimmed = cwd?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : GLOBAL_SCOPE_KEY;
  }

  function isStale(entry: StoredEntry): boolean {
    return deps.clock.nowMs() - entry.fetched_at_ms >= staleAfterMs;
  }

  function readyView(entry: StoredEntry): HarnessCatalogView {
    return {
      harness: entry.harness,
      status: "ready",
      catalog: structuredClone(entry.catalog),
      fetched_at: entry.fetched_at,
      stale: isStale(entry),
      error: null,
    };
  }

  function emptyView(harness: GuiHarness): HarnessCatalogView {
    return {
      harness,
      status: "empty",
      catalog: null,
      fetched_at: null,
      stale: false,
      error: null,
    };
  }

  function errorView(
    harness: GuiHarness,
    previous: StoredEntry | undefined,
    message: string,
  ): HarnessCatalogView {
    return {
      harness,
      status: "error",
      catalog: previous ? structuredClone(previous.catalog) : null,
      fetched_at: previous ? previous.fetched_at : null,
      stale: previous ? isStale(previous) : false,
      error: message,
    };
  }

  async function loadFromDisk(): Promise<Map<string, StoredEntry>> {
    const disk = new Map<string, StoredEntry>();
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (thrown) {
      if (errorCode(thrown) !== "ENOENT") {
        deps.log?.(
          `harness-catalog: failed to read cache (${thrown instanceof Error ? thrown.message : String(thrown)})`,
        );
      }
      return disk;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      deps.log?.("harness-catalog: ignoring corrupt cache JSON");
      return disk;
    }

    const fileResult = storedFileSchema.safeParse(parsed);
    if (!fileResult.success) {
      deps.log?.("harness-catalog: ignoring cache file with unexpected shape");
      return disk;
    }

    for (const item of fileResult.data.entries) {
      const entryResult = storedEntrySchema.safeParse(item);
      if (!entryResult.success) continue;
      if (entryResult.data.catalog.models.length === 0) continue;
      const key = cacheKey(entryResult.data.harness, entryResult.data.scope);
      disk.set(key, entryResult.data);
      // load 전에 observe()로 들어온 새 값은 disk 값으로 덮어쓰지 않는다.
      if (!entries.has(key)) {
        entries.set(key, entryResult.data);
      }
    }
    return disk;
  }

  function ensureLoaded(): Promise<Map<string, StoredEntry>> {
    if (loaded && loadPromise !== null) return loadPromise;
    loadPromise ??= loadFromDisk().finally(() => {
      loaded = true;
    });
    return loadPromise;
  }

  function persist(): Promise<void> {
    const run = async (): Promise<void> => {
      await ensureLoaded();
      const payload = {
        version: CACHE_VERSION,
        entries: [...entries.values()],
      };
      try {
        await writeFileAtomic(file, JSON.stringify(payload));
      } catch (thrown) {
        deps.log?.(
          `harness-catalog: failed to write cache (${thrown instanceof Error ? thrown.message : String(thrown)})`,
        );
      }
    };
    const next = writeChain.then(run, run);
    writeChain = next;
    return next;
  }

  function catalogChanged(
    previous: StoredEntry | undefined,
    next: StoredEntry,
  ): boolean {
    if (previous === undefined) return true;
    return canonicalize(previous.catalog) !== canonicalize(next.catalog);
  }

  function probe(
    harness: GuiHarness,
    scope: string,
    cwd: string | undefined,
  ): Promise<HarnessCatalogView> {
    const key = cacheKey(harness, scope);
    const existing = inFlight.get(key);
    if (existing !== undefined) return existing.promise;

    const controller = new AbortController();
    const run = async (): Promise<HarnessCatalogView> => {
      await ensureLoaded();
      if (controller.signal.aborted) {
        return errorView(
          harness,
          entries.get(key),
          "harness catalog probe aborted",
        );
      }

      let timedOut = false;
      const cancelTimer = after(timeoutMs, () => {
        timedOut = true;
        controller.abort(
          new Error(`harness catalog probe timed out after ${timeoutMs}ms`),
        );
      });

      let onAbort: (() => void) | null = null;
      try {
        const aborted = new Promise<Result<HarnessCatalogResult>>((resolve) => {
          const finish = () => {
            resolve({
              ok: false,
              error: {
                code: "unavailable",
                message: timedOut
                  ? `harness catalog probe timed out after ${timeoutMs}ms`
                  : "harness catalog probe aborted",
              },
            });
          };
          if (controller.signal.aborted) {
            finish();
            return;
          }
          onAbort = finish;
          controller.signal.addEventListener("abort", finish, { once: true });
        });

        const fetchOptions: { cwd?: string; signal: AbortSignal } =
          cwd !== undefined
            ? { cwd, signal: controller.signal }
            : { signal: controller.signal };

        const fetched = Promise.resolve()
          .then(() => deps.fetchCatalog(harness, fetchOptions))
          .catch(
            (thrown): Result<HarnessCatalogResult> => ({
              ok: false,
              error: {
                code: "unavailable",
                message:
                  thrown instanceof Error ? thrown.message : String(thrown),
              },
            }),
          );

        const outcome = await Promise.race([fetched, aborted]);
        const previous = entries.get(key);

        if (!outcome.ok) {
          deps.log?.(
            `harness-catalog: probe failed for ${harness} (${scope}): ${outcome.error.message}`,
          );
          return errorView(harness, previous, outcome.error.message);
        }

        if (outcome.value.models.length === 0) {
          return emptyView(harness);
        }

        const next: StoredEntry = {
          harness,
          scope,
          catalog: structuredClone(outcome.value),
          fetched_at: deps.clock.now(),
          fetched_at_ms: deps.clock.nowMs(),
        };
        const changed = catalogChanged(previous, next);
        entries.set(key, next);
        await persist();
        if (changed) {
          deps.onChanged?.(harness);
        }
        return readyView(next);
      } finally {
        cancelTimer();
        if (onAbort !== null) {
          controller.signal.removeEventListener("abort", onAbort);
        }
        if (inFlight.get(key)?.controller === controller) {
          inFlight.delete(key);
        }
      }
    };

    const promise = run();
    inFlight.set(key, { controller, promise });
    return promise;
  }

  return {
    async observe(harness, scopeCwd, result) {
      if (result.models.length === 0) return;
      const scope = scopeKeyOf(harness, scopeCwd);
      const key = cacheKey(harness, scope);
      const wasLoaded = loaded;
      const previousMemory = entries.get(key);
      const next: StoredEntry = {
        harness,
        scope,
        catalog: structuredClone(result),
        fetched_at: deps.clock.now(),
        fetched_at_ms: deps.clock.nowMs(),
      };
      // 같은 instance에서 바로 이어지는 read()가 최신 값을 보도록 먼저 반영한다.
      entries.set(key, next);

      const disk = await ensureLoaded();
      const previous =
        previousMemory ?? (wasLoaded ? undefined : disk.get(key));
      const changed = catalogChanged(previous, next);
      await persist();
      if (changed) {
        deps.onChanged?.(harness);
      }
    },

    async read(input) {
      await ensureLoaded();
      const scope = scopeKeyOf(input.harness, input.cwd);
      const key = cacheKey(input.harness, scope);
      const cached = entries.get(key);
      if (cached !== undefined) {
        return readyView(cached);
      }
      if (input.probe !== true) {
        return emptyView(input.harness);
      }
      return probe(input.harness, scope, input.cwd);
    },

    async refresh(input) {
      await ensureLoaded();
      const scope = scopeKeyOf(input.harness, input.cwd);
      return probe(input.harness, scope, input.cwd);
    },

    stop() {
      for (const item of inFlight.values()) {
        item.controller.abort(new Error("harness catalog stopped"));
      }
      inFlight.clear();
    },
  };
}
