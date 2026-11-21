import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
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

export type InspectedLocalTool = {
  name: string;
  path: string;
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

export function buildLocalToolDefinitions(
  tools: readonly InspectedLocalTool[],
  cwd: string | null,
): ToolDefinition[] {
  return tools.map((tool) => {
    const modelName = localToolModelName(tool.name);
    return {
      name: modelName,
      description: tool.description,
      input: z.record(z.string(), z.unknown()),
      inputSchema: tool.inputSchema,
      effect: tool.effect,
      origin: "local",
      operations: [],
      async handler(input, ctx) {
        const ran = await runRunner<
          | { ok: true; content: RunnerContent[] }
          | { ok: false; message: string }
        >(
          "run",
          { path: tool.path, input, cwd: cwd ?? dirname(tool.path) },
          {
            cwd: cwd ?? dirname(tool.path),
            timeoutMs: RUN_TIMEOUT_MS,
            signal: ctx.signal,
          },
        );
        if (!ran.ok) return ran;
        if (!ran.value.ok) {
          return err({ code: "unavailable", message: ran.value.message });
        }
        return ok(await formatResult(ran.value.content, ctx));
      },
    };
  });
}

// 세 층의 폴더에서 로컬 tool을 발견해 ToolDefinition 목록으로 돌려준다. 파일이 없으면 자식 프로세스를 띄우지 않는다.
export async function loadLocalTools(
  folders: readonly (string | null | undefined)[],
  cwd: string | null,
): Promise<ToolDefinition[]> {
  const files = await discoverLocalToolFiles(folders);
  if (files.length === 0) return [];
  const inspected = await runRunner<{
    tools: InspectedLocalTool[];
    broken: { name: string; path: string; reason: string }[];
  }>("inspect", { files }, { timeoutMs: INSPECT_TIMEOUT_MS });
  if (!inspected.ok) return [];
  return buildLocalToolDefinitions(inspected.value.tools, cwd);
}
