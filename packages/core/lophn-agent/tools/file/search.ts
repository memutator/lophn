import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { continuation } from "../bundles/paging.ts";
import { fitJson } from "../result.ts";
import type { ToolContext } from "../tool-context.ts";
import { fail, fsFail, resolveInWorkspace } from "./scope.ts";
import type { SearchInput, SearchOutput } from "./search-worker.ts";

// RegExp가 끝나지 않을 수 있어 훑기는 Worker에서 돌리고 기한에 끊는다.
const SEARCH_DEADLINE_MS = 10_000;
// minified 한 줄에 RegExp를 돌리지 않는다.
const MAX_TESTED_LINE_CHARS = 4_000;

type Base = { dir: string; single: string | null };

async function baseOf(
  ctx: ToolContext,
  path: string | undefined,
): Promise<Result<Base>> {
  const at = await resolveInWorkspace(ctx.scope, path ?? ".", "read");
  if (!at.ok) return at;
  try {
    const baseStat = await stat(at.value.path);
    return ok(
      baseStat.isDirectory()
        ? { dir: at.value.path, single: null }
        : { dir: join(at.value.path, ".."), single: at.value.path },
    );
  } catch (error) {
    return fsFail(error);
  }
}

// 같은 pattern의 Worker가 끝나기를 기다린다. 어느 길로 끝나든 Worker를 끝낸다.
function runSearch(
  input: Omit<SearchInput, "roots" | "maxLine">,
  ctx: ToolContext,
): Promise<Result<SearchOutput & { ok: true }>> {
  const { read, write, base, results } = ctx.scope;
  const worker = new Worker(new URL("./search-worker.ts", import.meta.url), {
    workerData: {
      ...input,
      maxLine: MAX_TESTED_LINE_CHARS,
      roots: { read, write, base, results },
    },
  });
  return new Promise((resolve) => {
    const settle = (result: Result<SearchOutput & { ok: true }>) => {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      resolve(result);
    };
    const onAbort = () => settle(fail("unavailable", "the search was stopped"));
    const timer = setTimeout(
      () =>
        settle(
          fail(
            "invalid_input",
            "the search did not finish within 10 seconds; use a simpler pattern or a narrower path or glob",
          ),
        ),
      SEARCH_DEADLINE_MS,
    );
    if (ctx.signal?.aborted) return onAbort();
    ctx.signal?.addEventListener("abort", onAbort);
    worker.once("message", (out: SearchOutput) =>
      settle(out.ok ? ok(out) : fail("invalid_input", out.message)),
    );
    const failed = () => settle(fail("unavailable", "the search failed"));
    worker.once("error", failed);
    worker.once("exit", failed);
  });
}

function resultOf(
  summary: string,
  key: string,
  items: string[],
  more: boolean,
): ToolResult {
  const fitted = fitJson({ [key]: items }, [key]);
  const cut = fitted.content === null ? items.length : fitted.omittedCount;
  return {
    status: "success",
    summary,
    content: fitted.content as ToolResult["content"],
    complete: !more && cut === 0,
    source: null,
    continuation: continuation(
      more || cut > 0 ? "narrow pattern or path to see the rest" : null,
    ),
    pending: [],
  };
}

export async function globFiles(
  input: { pattern: string; path?: string },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  const base = await baseOf(ctx, input.path);
  if (!base.ok) return base;
  const found = await runSearch(
    { kind: "glob", pattern: input.pattern, base: base.value },
    ctx,
  );
  if (!found.ok) return found;
  const { items, more } = found.value;
  return ok(resultOf(`${items.length} files match`, "files", items, more));
}

export async function grepFiles(
  input: { pattern: string; path?: string; glob?: string },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  const base = await baseOf(ctx, input.path);
  if (!base.ok) return base;
  const found = await runSearch(
    {
      kind: "grep",
      pattern: input.pattern,
      glob: input.glob,
      base: base.value,
    },
    ctx,
  );
  if (!found.ok) return found;
  const { items, more, skipped } = found.value;
  const note =
    skipped > 0
      ? ` (${skipped} lines over ${MAX_TESTED_LINE_CHARS} characters were not searched)`
      : "";
  return ok(
    resultOf(`${items.length} lines match${note}`, "matches", items, more),
  );
}
