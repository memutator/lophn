// lophn CLI의 실행 entry다. 조립만 하고 업무 규칙을 두지 않는다.
// 표(`registry.ts`) 밖 command는 실행 전에 거절한다. 인증은 환경 변수 `LOPHN_CODING_TOKEN` 하나이고,
// token이 없으면 core를 부르는 command는 아무것도 보내지 않는다.
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  CODING_TOKEN_ENV,
  HOOK_PAYLOAD_MAX_BYTES,
} from "../../protocol/coding-agent/mod.ts";
import type { RpcFetch } from "../../protocol/client/mod.ts";
import {
  createCoreClient,
  discoverDaemonAddress,
  LOPHN_DAEMON_URL,
} from "../connection/mod.ts";
import { helpJson, helpText } from "./help.ts";
import { CLI_EXITS, createOutput, exitOf } from "./output.ts";
import { parseArgs, type ParsedArgs } from "./parser.ts";
import { matchCommand } from "./registry.ts";
import type { RunContext } from "./commands/types.ts";

const VERSION = "0.1.0";

// 시험이 끼우는 환경이다. 없으면 process의 것이다.
export type CliOptions = {
  env?: { get(name: string): string | undefined };
  fetch?: RpcFetch;
  stdout?: WritableStream<Uint8Array>;
  stderr?: WritableStream<Uint8Array>;
  cwd?: string;
  home?: string;
  stdin?: () => Promise<string>;
};

export function ambientEnv(): { get(name: string): string | undefined } {
  return {
    get(name) {
      try {
        return Deno.env.get(name);
      } catch {
        return undefined;
      }
    },
  };
}

function readTextOrUndefined(path: string): string | undefined {
  try {
    return Deno.readTextFileSync(path);
  } catch {
    return undefined;
  }
}

// hook payload 상한까지만 읽는다. 상한을 넘으면 넘은 것을 알 만큼만 더 읽고 멈춘다.
async function readProcessStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const buffer = new Uint8Array(8192);
  while (total <= HOOK_PAYLOAD_MAX_BYTES) {
    const read = await Deno.stdin.read(buffer);
    if (read === null) break;
    chunks.push(buffer.slice(0, read));
    total += read;
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(all);
}

function inputOf(
  parsed: ParsedArgs,
  cwd: string,
): Result<Record<string, unknown>, LophnError> {
  let text: string | undefined = parsed.input;
  if (text === undefined && parsed.inputFile !== undefined) {
    const path = parsed.inputFile.startsWith("/")
      ? parsed.inputFile
      : `${cwd}/${parsed.inputFile}`;
    text = readTextOrUndefined(path);
    if (text === undefined) {
      return err({
        code: "invalid_input",
        message: "input 파일을 읽지 못했다",
        details: { path },
      });
    }
  }
  if (text === undefined) return ok({});
  try {
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return err({ code: "invalid_input", message: "input은 JSON 객체다" });
    }
    return ok(value as Record<string, unknown>);
  } catch {
    return err({ code: "invalid_input", message: "input JSON을 읽지 못했다" });
  }
}

const COMMON_KEYS = ["json", "input", "input_file", "idempotency_key"];

export async function cliMain(
  argv: readonly string[],
  options: CliOptions = {},
): Promise<number> {
  const parsed = parseArgs(argv);
  const env = options.env ?? ambientEnv();
  const token = env.get(CODING_TOKEN_ENV)?.trim() || undefined;
  const output = createOutput({
    json: parsed.json,
    stdout: options.stdout,
    stderr: options.stderr,
    secrets: token === undefined ? [] : [token],
  });
  const fail = async (error: LophnError) => {
    await output.failure(error);
    return exitOf(error);
  };
  if (parsed.errors.length > 0) {
    return await fail({
      code: "invalid_input",
      message: parsed.errors.join("; "),
    });
  }
  const [first] = parsed.positional;
  if (first === undefined || first === "help") {
    if (parsed.json) await output.result(helpJson());
    else await output.text(helpText(parsed.positional.slice(1).join(" ")));
    return first === undefined && !parsed.help ? CLI_EXITS.invalid_input : 0;
  }
  if (first === "version") {
    await output.result({ version: VERSION });
    return 0;
  }
  const matched = matchCommand(parsed.positional);
  if (matched === undefined) {
    return await fail({
      code: "invalid_input",
      message: `지원하지 않는 command다: ${parsed.positional.join(" ")}`,
    });
  }
  const { entry, used } = matched;
  if (parsed.help) {
    await output.text(helpText(entry.name));
    return 0;
  }
  const rest = parsed.positional.slice(used);
  const slots = entry.positional ?? [];
  if (rest.length !== slots.length) {
    return await fail({
      code: "invalid_input",
      message: slots.length === 0
        ? "command 뒤에 받지 않는 위치 인자가 있다"
        : `위치 인자가 필요하다: ${slots.map((s) => `<${s}>`).join(" ")}`,
    });
  }
  const cwd = options.cwd ?? Deno.cwd();
  const body = inputOf(parsed, cwd);
  if (!body.ok) return await fail(body.error);
  const candidate: Record<string, unknown> = { ...body.value };
  slots.forEach((slot, index) => candidate[slot] = rest[index]);
  if (parsed.json) candidate.json = true;
  if (parsed.idempotencyKey !== undefined) {
    candidate.idempotency_key = parsed.idempotencyKey;
  }
  const checked = entry.input.safeParse(candidate);
  if (!checked.success) {
    const field = checked.error.issues[0]?.path.join(".") ?? "";
    return await fail({
      code: "invalid_input",
      message: field === ""
        ? "command 입력이 맞지 않다"
        : `${field}: 입력이 맞지 않다`,
    });
  }
  const input = Object.fromEntries(
    Object.entries(checked.data as Record<string, unknown>).filter(([key]) =>
      !COMMON_KEYS.includes(key)
    ),
  );
  // coding token이 있을 때만 core 주소를 찾고 client를 만든다.
  let client: RunContext["client"];
  if (entry.auth === "coding_token" && token !== undefined) {
    const address = discoverDaemonAddress({
      env: env.get(LOPHN_DAEMON_URL),
      dataRoot: env.get("LOPHN_HOME"),
      readText: readTextOrUndefined,
    });
    if (!address.ok) return await fail(address.error);
    client = createCoreClient({
      baseUrl: address.value.url,
      token,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }
  const home = options.home ?? env.get("HOME") ?? "";
  const ran = await entry.run(input, {
    client,
    idempotencyKey: parsed.idempotencyKey,
    stdin: options.stdin ?? readProcessStdin,
    local: {
      env,
      cwd,
      home,
      dataRoot: env.get("LOPHN_HOME"),
      now: () => new Date().toISOString(),
    },
  });
  if (!ran.ok) return await fail(ran.error);
  await output.result(ran.value);
  return CLI_EXITS.success;
}

if (import.meta.main) {
  Deno.exit(await cliMain(Deno.args));
}
