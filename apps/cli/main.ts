// lophn CLI의 실행 entry다(code-map). 조립만 하고 업무 규칙을 두지 않는다.
// stdin/stdout에서 한 command를 읽고, credential provider는 T36의 실제 loader
// 자리라 지금은 unavailable이 맞다(coding-agent/harnesses). dispatch는
// registry의 route로만 한다(R1, architecture 5.1). parse 오류도 --json이면
// JSON 오류 하나다(T12 완료 8).
import {
  findCommand,
  HELP_COMMAND,
  parseArgs,
  splitCommand,
  VERSION_COMMAND,
} from "../../packages/coding-agent/cli/mod.ts";
import {
  commandHelp,
  helpJson,
  helpText,
} from "../../packages/coding-agent/cli/help.ts";
import { createOutput } from "../../packages/coding-agent/cli/output.ts";
import type {
  CommandRef,
  ParsedArgs,
} from "../../packages/coding-agent/cli/parser.ts";
import type { AgentFailure } from "../../packages/contracts/coding-agent/mod.ts";
import {
  LOPHN_DAEMON_URL,
  resolveDaemonAddress,
} from "../../packages/coding-agent/connection/client/daemon.ts";
import { err, ok, type Result } from "../../packages/base/mod.ts";

const VERSION = "0.1.0";

function inputOf(parsed: ParsedArgs): Result<unknown, AgentFailure> {
  if (parsed.input === undefined && parsed.inputFile === undefined) {
    return ok(undefined);
  }
  if (parsed.input !== undefined) return safeJson(parsed.input);
  const file = parsed.inputFile;
  const resolved = file?.startsWith("/") ? file : `${Deno.cwd()}/${file}`;
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

function safeJson(text: string): Result<unknown, AgentFailure> {
  try {
    return ok(JSON.parse(text));
  } catch {
    return err({ code: "invalid_input", message: "input JSON을 읽지 못했다" });
  }
}

export async function cliMain(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const output = createOutput({ json: parsed.json });
  if (parsed.help) {
    await emitHelp(parsed, output);
  }
  if (parsed.errors.length > 0) {
    // parse 오류는 실행 전 거절이다(cli#R4). --json이면 JSON 오류 하나다(T12 완료 8).
    await output.failure({
      code: "invalid_input",
      message: parsed.errors.join("; "),
    });
    return output.exitCode({ code: "invalid_input", message: "" });
  }
  if (parsed.command === undefined) {
    await output.failure({ code: "invalid_input", message: "command가 없다" });
    return output.exitCode({ code: "invalid_input", message: "" });
  }
  const ref = splitCommand(parsed.command);
  if (!ref.ok) {
    await output.failure(ref.error);
    return output.exitCode(ref.error);
  }
  if (ref.value.group === HELP_COMMAND) {
    const help = helpJson(ref.value.name);
    await output.result(help);
    return output.exitCode(undefined);
  }
  if (ref.value.group === VERSION_COMMAND) {
    await output.result({
      summary: `lophn ${VERSION}`,
      data: { version: VERSION },
      next: [],
    });
    return output.exitCode(undefined);
  }
  const command = commandRefName(ref.value);
  const entry = findCommand(command);
  if (parsed.help || entry === undefined) {
    // 표 밖 command는 실행 전 거절이다(cli#R4). 지원 목록을 다음 조회로 남긴다.
    await output.failure({
      code: "invalid_input",
      message: entry === undefined
        ? `지원하지 않는 command다: ${command}`
        : "command 입력이 완전하지 않다",
      details: { command },
    });
    return output.exitCode({ code: "invalid_input", message: "" });
  }
  const body = inputOf(parsed);
  if (!body.ok) {
    await output.failure(body.error);
    return output.exitCode(body.error);
  }
  const checked = entry.input.safeParse({
    ...((body.value ?? {}) as Record<string, unknown>),
    json: parsed.json || undefined,
  });
  if (!checked.success) {
    const field = checked.error.issues[0]?.path.join(".") ?? "";
    const failure: AgentFailure = {
      code: "invalid_input",
      message: field === ""
        ? "command 입력이 맞지 않다"
        : `${field}: 입력이 맞지 않다`,
    };
    await output.failure(failure);
    return output.exitCode(failure);
  }
  // 실제 실행은 T13·T14가 route마다 잇는다. credential provider는 T36 자리다.
  await output.diagnostic("core 실행 배선은 이후 작업이다");
  return output.exitCode(undefined);
}

function commandRefName(ref: CommandRef): string {
  return ref.name === undefined ? ref.group : `${ref.group} ${ref.name}`;
}

async function emitHelp(
  parsed: ParsedArgs,
  output: Awaited<ReturnType<typeof createOutput>>,
): Promise<void> {
  const name = parsed.positional.join(" ");
  const entry = commandHelp(name);
  const help = entry === undefined && name !== ""
    ? helpJson(undefined)
    : helpText(name);
  await output.result(help);
}

// 옵션 → 환경 설정 → 기본(daemon address 순서, connection#R15)이다. CLI에서는
// 기본 daemon 주소를 쓰지 않는다. 명시 값만 받는다(T12 뼈대).
export function daemonUrlOf(
  parsed: ParsedArgs,
  env: { get: (name: string) => string | undefined },
) {
  const option = parsed.daemonUrl;
  const fromEnv = env.get(LOPHN_DAEMON_URL);
  return resolveDaemonAddress({
    option,
    env: fromEnv,
  });
}

if (import.meta.main) {
  const exit = await cliMain(Deno.args);
  Deno.exit(exit);
}
