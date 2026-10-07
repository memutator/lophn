// CLI argv에서 command 이름과 입력을 읽는 공용 조각이다. 실행(main.ts)과 launcher의 권한 계획(launch.ts)이
// 같은 argv를 같은 규칙으로 읽도록 한 곳에 둔다. 출력·실행은 하지 않는다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { findCommand } from "../../packages/coding-agent/cli/mod.ts";
import type { ParsedArgs } from "../../packages/coding-agent/cli/parser.ts";
import type { AgentFailure } from "../../packages/contracts/coding-agent/mod.ts";

function safeJson(text: string): Result<unknown, AgentFailure> {
  try {
    return ok(JSON.parse(text));
  } catch {
    return err({ code: "invalid_input", message: "input JSON을 읽지 못했다" });
  }
}

export function inputOf(
  parsed: ParsedArgs,
  cwd: string = Deno.cwd(),
): Result<unknown, AgentFailure> {
  if (parsed.input === undefined && parsed.inputFile === undefined) {
    return ok(undefined);
  }
  if (parsed.input !== undefined) return safeJson(parsed.input);
  const file = parsed.inputFile;
  const resolved = file?.startsWith("/") ? file : `${cwd}/${file}`;
  try {
    const text = Deno.readTextFileSync(resolved);
    return safeJson(text);
  } catch {
    return err({
      code: "invalid_input",
      message: "input 파일을 읽지 못했다",
      details: { path: resolved },
    });
  }
}

// command 이름은 표에 있는 가장 긴 앞부분이다(`app preview start`까지 세 조각). `used`는 이름에 쓴
// 조각 수라 그 뒤 위치 인자가 남으면 호출자가 거절한다.
export function commandNameOf(
  parsed: ParsedArgs,
): { command: string; used: number } {
  const tokens = [parsed.command ?? "", ...parsed.positional];
  let command = tokens.slice(0, 2).join(" ");
  let used = Math.min(2, tokens.length);
  for (let size = Math.min(3, tokens.length); size >= 1; size -= 1) {
    const candidate = tokens.slice(0, size).join(" ");
    if (findCommand(candidate) !== undefined) {
      command = candidate;
      used = size;
      break;
    }
  }
  return { command, used };
}

// command와 공통 option(flag)을 입력에 합친다. flag는 `--input`의 같은 field보다 우선한다.
export function candidateOf(
  parsed: ParsedArgs,
  command: string,
  body: unknown,
): Record<string, unknown> {
  const flags: Record<string, unknown> = {
    command,
    json: parsed.json || undefined,
    connection: parsed.connection,
    daemon_url: parsed.daemonUrl,
    app: parsed.app,
    base_revision: parsed.baseRevision,
    idempotency_key: parsed.idempotencyKey,
    hook: parsed.hook,
  };
  const candidate: Record<string, unknown> = {
    ...((body ?? {}) as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(flags)) {
    if (value !== undefined) candidate[key] = value;
  }
  return candidate;
}
