import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  ToolEffect,
  ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ToolDefinition } from "./registry.ts";
import { spillLarge } from "./spill.ts";
import type { ToolContext } from "./tool-context.ts";

// 파일 기반 로컬 tool이다. `<data root>/tools/`, `<workspace>/.lophn/tools/`, `<workspace data>/tools/` 세 층에서
// `.ts`·`.js`·`.mjs` 파일을 찾아 격리된 Node 자식 프로세스로 schema를 읽고 실행한다.
// model에 보이는 이름은 `local__<name>`이라 내장 tool(`_` 하나)·MCP(`mcp__`)와 겹치지 않는다.
// 신뢰 목록(`approvals.local_tool_trust`)에 `(realPath, sha256)`이 없는 스크립트는 inspect 단계에서도 실행하지 않고
// stub 정의 + local_tool gate로 올려, 사람이 승인한 뒤에만 실행한다.
export const LOCAL_TOOL_PREFIX = "local__";
export const LOCAL_TOOL_NAME = /^[a-z][a-z0-9_]*$/;
const MODEL_NAME_MAX = 64;
const EXTENSIONS = new Set([".ts", ".js", ".mjs"]);
const INTERNAL_ENV = /^(LOPHN_|ELECTRON_|NODE_CHANNEL_FD$)/;
const INSPECT_TIMEOUT_MS = 5_000;
const RUN_TIMEOUT_MS = 60_000;
const RUNNER_PATH = fileURLToPath(
  new URL("./local-tool-runner.ts", import.meta.url),
);

export function localToolModelName(name: string): string {
  return `${LOCAL_TOOL_PREFIX}${name}`;
}

export function parseLocalToolName(modelName: string): string | null {
  if (!modelName.startsWith(LOCAL_TOOL_PREFIX)) return null;
  const name = modelName.slice(LOCAL_TOOL_PREFIX.length);
  if (
    !LOCAL_TOOL_NAME.test(name) ||
    name.includes("__") ||
    modelName.length > MODEL_NAME_MAX
  ) {
    return null;
  }
  return name;
}

export type LocalToolFile = {
  name: string;
  path: string;
};

export type LocalToolDigest = LocalToolFile & {
  realPath: string;
  sha256: string;
};

export type LocalToolTrustRecord = {
  path: string;
  sha256: string;
};

export type LoadLocalToolsOptions = {
  // 사람이 이미 신뢰한 `(실제 경로, sha256)` 목록(`approvals.local_tool_trust`).
  // 생략하면 빈 목록(fail-closed): 신뢰되지 않은 스크립트는 inspect를 실행하지 않고 stub + gate로만 올린다.
  trusted?: readonly LocalToolTrustRecord[];
};

export type InspectedLocalTool = {
  name: string;
  path: string;
  realPath?: string;
  sha256?: string;
  changed?: boolean;
  description: string;
  inputSchema: Record<string, unknown>;
  effect: ToolEffect;
};

// 앞 층에서 뒤 층 순서대로 덮어쓴다(전역 → workspace repo → workspace data).
export async function discoverLocalToolFiles(
  folders: readonly (string | null | undefined)[],
): Promise<LocalToolFile[]> {
  const byName = new Map<string, LocalToolFile>();
  for (const folder of folders) {
    if (!folder) continue;
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    for (const filename of names) {
      if (filename.startsWith(".") || filename.startsWith("_")) continue;
      if (
        filename.endsWith(".d.ts") ||
        /_test\.[^.]+$/.test(filename) ||
        /\.test\.[^.]+$/.test(filename)
      ) {
        continue;
      }
      const ext = extname(filename);
      if (!EXTENSIONS.has(ext)) continue;
      const stem = filename.slice(0, -ext.length);
      if (parseLocalToolName(localToolModelName(stem)) === null) continue;
      byName.set(stem, { name: stem, path: join(folder, filename) });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function hashLocalToolFile(
  file: LocalToolFile,
): Promise<LocalToolDigest | null> {
  try {
    const resolved = await realpath(file.path);
    const bytes = await readFile(resolved);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { ...file, realPath: resolved, sha256 };
  } catch {
    return null;
  }
}

export async function discoverLocalToolDigests(
  folders: readonly (string | null | undefined)[],
): Promise<LocalToolDigest[]> {
  const files = await discoverLocalToolFiles(folders);
  const digests: LocalToolDigest[] = [];
  for (const file of files) {
    const digest = await hashLocalToolFile(file);
    if (digest !== null) digests.push(digest);
  }
  return digests;
}

function safeEnv(
  base: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || INTERNAL_ENV.test(key)) continue;
    out[key] = value;
  }
  // Electron binary를 Node로 띄워 도는 환경(설치본·test runner)에서는 자식도 Node로 떠야 한다.
  if (
    base.ELECTRON_RUN_AS_NODE === "1" ||
    process.versions.electron !== undefined
  ) {
    out.ELECTRON_RUN_AS_NODE = "1";
  }
  return out;
}

async function runRunner<T>(
  mode: "inspect" | "run",
  payload: unknown,
  options: { cwd?: string; timeoutMs: number; signal?: AbortSignal },
): Promise<Result<T>> {
  return await new Promise<Result<T>>((resolve) => {
    const child = spawn(
      process.execPath,
      ["--no-warnings", RUNNER_PATH, mode],
      {
        cwd: options.cwd,
        env: safeEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: Result<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(err({ code: "unavailable", message: "local tool call aborted" }));
    };
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        err({
          code: "unavailable",
          message: `local tool timed out after ${options.timeoutMs}ms`,
        }),
      );
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (cause) => {
      finish(
        err({
          code: "unavailable",
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        finish(
          err({
            code: "unavailable",
            message: stderr.trim() || `local tool runner exited with ${code}`,
          }),
        );
        return;
      }
      try {
        finish(ok(JSON.parse(stdout) as T));
      } catch {
        finish(
          err({
            code: "internal",
            message: "local tool runner returned invalid JSON",
          }),
        );
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

type RunnerContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

async function formatResult(
  content: readonly RunnerContent[],
  ctx: ToolContext,
): Promise<ToolResult> {
  const texts = content
    .filter(
      (item): item is { type: "text"; text: string } => item.type === "text",
    )
    .map((item) => item.text);
  const images = content.filter(
    (item): item is { type: "image"; mimeType: string; data: string } =>
      item.type === "image",
  );
  const joined = texts.join("\n");
  const summary =
    texts.length > 0
      ? joined.slice(0, 120)
      : images.length > 0
        ? `[${images.length} image(s)]`
        : "ok";
  const payload: ToolResult["content"] =
    images.length > 0
      ? { content: content.map((item) => ({ ...item })) }
      : joined;
  return await spillLarge(ctx, {
    status: "success",
    summary: summary || "ok",
    content: payload,
    complete: true,
    source: null,
    continuation: null,
    pending: [],
    spill: { arrayKeys: [] },
  });
}

function makeRunnerHandler(
  toolPath: string,
  cwd: string | null,
): NonNullable<ToolDefinition["handler"]> {
  return async (input, ctx) => {
    const ran = await runRunner<
      { ok: true; content: RunnerContent[] } | { ok: false; message: string }
    >(
      "run",
      { path: toolPath, input, cwd: cwd ?? dirname(toolPath) },
      {
        cwd: cwd ?? dirname(toolPath),
        timeoutMs: RUN_TIMEOUT_MS,
        signal: ctx.signal,
      },
    );
    if (!ran.ok) return ran;
    if (!ran.value.ok) {
      return err({ code: "unavailable", message: ran.value.message });
    }
    return ok(await formatResult(ran.value.content, ctx));
  };
}

export function buildLocalToolDefinitions(
  tools: readonly InspectedLocalTool[],
  cwd: string | null,
): ToolDefinition[] {
  return tools.map((tool) => {
    const modelName = localToolModelName(tool.name);
    const gatePath = tool.realPath ?? tool.path;
    const gateSha256 = tool.sha256 ?? "";
    const gateChanged = tool.changed === true;
    return {
      name: modelName,
      description: tool.description,
      input: z.record(z.string(), z.unknown()),
      inputSchema: tool.inputSchema,
      effect: tool.effect,
      origin: "local",
      operations: [],
      gate: async () => {
        // 호출 시점에 파일이 바뀌었으면 최신 sha256을 다시 계산해 변조를 놓치지 않는다.
        const current = await hashLocalToolFile({
          name: tool.name,
          path: gatePath,
        });
        const liveSha = current?.sha256 ?? gateSha256;
        const livePath = current?.realPath ?? gatePath;
        const changed =
          gateChanged || (gateSha256 !== "" && liveSha !== gateSha256);
        return {
          kind: "local_tool",
          name: tool.name,
          path: livePath,
          sha256: liveSha,
          changed,
        };
      },
      handler: makeRunnerHandler(gatePath, cwd),
    };
  });
}

function untrustedStub(
  digest: LocalToolDigest,
  changed: boolean,
  cwd: string | null,
): ToolDefinition {
  return {
    name: localToolModelName(digest.name),
    description: changed
      ? `Local tool ${digest.name} (file changed since last trust; requires re-approval before running)`
      : `Untrusted local tool ${digest.name} (requires approval before first run)`,
    input: z.record(z.string(), z.unknown()),
    inputSchema: { type: "object", additionalProperties: true },
    effect: "external",
    origin: "local",
    operations: [],
    gate: async () => {
      const current = await hashLocalToolFile(digest);
      const liveSha = current?.sha256 ?? digest.sha256;
      const livePath = current?.realPath ?? digest.realPath;
      return {
        kind: "local_tool",
        name: digest.name,
        path: livePath,
        sha256: liveSha,
        changed: changed || liveSha !== digest.sha256,
      };
    },
    handler: makeRunnerHandler(digest.realPath, cwd),
  };
}

// 세 층의 폴더에서 로컬 tool을 발견해 ToolDefinition 목록으로 돌려준다.
// 이미 신뢰된 `(realPath, sha256)` 파일만 inspect 자식 프로세스로 읽고, 비신뢰·변경 파일은 코드를 실행하지 않고
// stub 정의와 local_tool gate로만 올려 승인 뒤 실행되게 한다.
export async function loadLocalTools(
  folders: readonly (string | null | undefined)[],
  cwd: string | null,
  options?: LoadLocalToolsOptions,
): Promise<ToolDefinition[]> {
  const digests = await discoverLocalToolDigests(folders);
  if (digests.length === 0) return [];

  const trustedByPath = new Map<string, string>();
  for (const entry of options?.trusted ?? []) {
    const resolved = await realpath(entry.path).catch(() => entry.path);
    trustedByPath.set(resolved, entry.sha256);
  }

  const trustedDigests: LocalToolDigest[] = [];
  const untrustedStubs: ToolDefinition[] = [];
  for (const digest of digests) {
    const expectedSha = trustedByPath.get(digest.realPath);
    if (expectedSha !== undefined && expectedSha === digest.sha256) {
      trustedDigests.push(digest);
    } else {
      untrustedStubs.push(
        untrustedStub(digest, expectedSha !== undefined, cwd),
      );
    }
  }

  const trustedDefs: ToolDefinition[] = [];
  if (trustedDigests.length > 0) {
    const inspected = await runRunner<{
      tools: InspectedLocalTool[];
      broken: { name: string; path: string; reason: string }[];
    }>(
      "inspect",
      {
        files: trustedDigests.map((d) => ({ name: d.name, path: d.realPath })),
      },
      { timeoutMs: INSPECT_TIMEOUT_MS },
    );
    if (inspected.ok) {
      const byName = new Map(trustedDigests.map((d) => [d.name, d]));
      const enriched: InspectedLocalTool[] = inspected.value.tools.map((t) => {
        const digest = byName.get(t.name);
        return {
          ...t,
          realPath: digest?.realPath ?? t.path,
          sha256: digest?.sha256 ?? "",
          changed: false,
        };
      });
      trustedDefs.push(...buildLocalToolDefinitions(enriched, cwd));
    }
  }

  return [...trustedDefs, ...untrustedStubs].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
