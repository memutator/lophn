import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import type { CodingUsage } from "../../types.ts";

export function claudeProjectDir(home: string, cwd: string): string {
  return `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

type Json = Record<string, unknown>;

function rate(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

// Claude Code는 한 응답을 content 블록마다 한 줄로 쓰고 줄마다 usage가 같다. message.id로 한 번만 센다.
// 중복 제거는 texts 전체에서 한다(subagent file도 같은 규칙).
export function parseClaudeJsonl(texts: string[]): CodingUsage {
  const seenMessages = new Set<string>();
  const seenToolUses = new Set<string>();
  const models = new Set<string>();
  let apiCalls = 0, input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  let toolResults = 0, toolErrors = 0;

  for (const text of texts) {
    for (const line of text.split("\n")) {
      let row: Json;
      try {
        row = JSON.parse(line);
      } catch {
        continue; // 빈 줄, 쓰는 도중인 마지막 줄
      }
      const message = row?.message as Json | undefined;
      if (message === null || typeof message !== "object") continue;
      if (row.type === "assistant") {
        const id = message.id;
        if (typeof id !== "string" || seenMessages.has(id)) continue;
        seenMessages.add(id);
        apiCalls++;
        if (typeof message.model === "string") models.add(message.model);
        const usage = (message.usage ?? {}) as Json;
        input += Number(usage.input_tokens) || 0;
        output += Number(usage.output_tokens) || 0;
        cacheRead += Number(usage.cache_read_input_tokens) || 0;
        cacheWrite += Number(usage.cache_creation_input_tokens) || 0;
      } else if (row.type === "user" && Array.isArray(message.content)) {
        for (const block of message.content as Json[]) {
          if (block?.type !== "tool_result") continue;
          const id = block.tool_use_id;
          if (typeof id === "string") {
            if (seenToolUses.has(id)) continue;
            seenToolUses.add(id);
          }
          toolResults++;
          if (block.is_error === true) toolErrors++;
        }
      }
    }
  }

  const inputTotal = input + cacheRead + cacheWrite;
  return {
    files: texts.length,
    models: [...models].sort(),
    api_calls: apiCalls,
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    input_total: inputTotal,
    cache_hit_rate: rate(cacheRead, inputTotal),
    tool_results: toolResults,
    tool_errors: toolErrors,
    tool_error_rate: rate(toolErrors, toolResults),
  };
}

async function readDirOrEmpty(path: string): Promise<Deno.DirEntry[]> {
  try {
    return await Array.fromAsync(Deno.readDir(path));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

// trial마다 cwd가 새 폴더라 project 폴더 안 jsonl이 모두 그 trial의 것이다.
export async function readClaudeUsage(
  home: string,
  cwd: string,
): Promise<Result<CodingUsage>> {
  const dir = claudeProjectDir(home, cwd);
  const notFound = err({
    code: "not_found" as const,
    message: `Claude Code session 기록 폴더가 없다: ${dir}`,
  });
  try {
    const entries = await readDirOrEmpty(dir);
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.isFile && entry.name.endsWith(".jsonl")) {
        paths.push(`${dir}/${entry.name}`);
      } else if (entry.isDirectory) {
        for (
          const sub of await readDirOrEmpty(`${dir}/${entry.name}/subagents`)
        ) {
          if (sub.isFile && sub.name.endsWith(".jsonl")) {
            paths.push(`${dir}/${entry.name}/subagents/${sub.name}`);
          }
        }
      }
    }
    if (paths.length === 0) return notFound;
    const texts = await Promise.all(paths.map((p) => Deno.readTextFile(p)));
    return ok(parseClaudeJsonl(texts));
  } catch (e) {
    return err({
      code: "unavailable" as const,
      message: `Claude Code session 기록을 읽지 못했다: ${dir} (${
        e instanceof Error ? e.message : String(e)
      })`,
    });
  }
}
