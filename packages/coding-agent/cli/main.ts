// lophn CLI의 실행 entry다. 조립만 하고 업무 규칙을 두지 않는다.
// 표(`registry.ts`) 밖 command는 실행 전에 거절한다. 인증은 환경 변수 `LOPHN_CODING_TOKEN`이고, `user`
// command만 token이 없을 때 data root의 user token file을 쓴다. 자격이 없으면 core를 부르는 command는
// 아무것도 보내지 않는다.
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import process from "node:process";
import type { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  CODING_TOKEN_ENV,
  HOOK_STDIN_MAX_BYTES,
} from "../../protocol/coding-agent/mod.ts";
import {
  type RpcFetch,
  USER_TOKEN_FILE_NAME,
} from "../../protocol/client/mod.ts";
import {
  createCoreClient,
  discoverDaemonAddress,
  LOPHN_DAEMON_URL,
} from "../connection/mod.ts";
import { helpJson, helpText } from "./help.ts";
import { CLI_EXITS, createOutput, exitOf } from "./output.ts";
import { parseArgs, type ParsedArgs } from "./parser.ts";
import { matchCommand } from "./registry.ts";
import { ExitWith, type RunContext } from "./commands/types.ts";

const VERSION = "0.9.0";

// 시험이 끼우는 환경이다. 없으면 process의 것이다.
type CliOptions = {
  env?: { get(name: string): string | undefined };
  fetch?: RpcFetch;
  stdout?: WritableStream<Uint8Array>;
  stderr?: WritableStream<Uint8Array>;
  cwd?: string;
  home?: string;
  stdin?: () => Promise<string>;
  readText?: (path: string) => string | undefined;
};

export function ambientEnv(): { get(name: string): string | undefined } {
  return {
    get(name) {
      return process.env[name];
    },
  };
}

function readTextOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

// hook stdin 상한까지만 읽는다. 상한을 넘으면 넘은 것을 알 만큼만 더 읽고 멈춘다.
async function readProcessStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    total += chunk.length;
    if (total > HOOK_STDIN_MAX_BYTES) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}

// `--input`·`--input-file`을 JSON으로 읽는다. 없으면 undefined다. `user` 명령은 JSON 값 하나(객체가 아니어도
// 된다)가 run 입력이고, 나머지는 객체가 route 입력의 칸이 된다.
function inputOf(
  parsed: ParsedArgs,
  cwd: string,
  readText: (path: string) => string | undefined,
  asValue: boolean,
): Result<unknown, LophnError> {
  let text: string | undefined = parsed.input;
  if (text === undefined && parsed.inputFile !== undefined) {
    const path = parsed.inputFile.startsWith("/")
      ? parsed.inputFile
      : `${cwd}/${parsed.inputFile}`;
    text = readText(path);
    if (text === undefined) {
      return err({
        code: "invalid_input",
        message: "input 파일을 읽지 못했다",
        details: { path },
      });
    }
  }
  if (text === undefined) return ok(undefined);
  try {
    const value = JSON.parse(text);
    if (
      !asValue &&
      (typeof value !== "object" || value === null || Array.isArray(value))
    ) {
      return err({ code: "invalid_input", message: "input은 JSON 객체다" });
    }
    return ok(value);
  } catch {
    return err({ code: "invalid_input", message: "input JSON을 읽지 못했다" });
  }
}

// 빠진 칸은 "필요하다", 틀린 칸은 기대하는 꼴을 말한다. agent가 입력을 다시 쓰는 데 이것만 보게 한다.
function describeIssue(issue: z.core.$ZodIssue, candidate: unknown): string {
  const path = issue.path.map(String);
  const given = path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined,
    candidate,
  );
  const field = path.join(".") || "(입력)";
  if (issue.code === "unrecognized_keys") {
    return `${field}: 모르는 칸 ${issue.keys.join(", ")}`;
  }
  if (given === undefined && issue.code === "invalid_type") {
    return `${field}: 필요하다 (${issue.expected})`;
  }
  let expected: string;
  if (issue.code === "invalid_type") expected = `${issue.expected} 이어야 한다`;
  else if (issue.code === "invalid_format" && "pattern" in issue) {
    expected = `${issue.pattern} 꼴이어야 한다`;
  } else if (issue.code === "invalid_value") {
    expected = `${issue.values.map(String).join(" | ")} 중 하나여야 한다`;
  } else expected = issue.message;
  return given === undefined
    ? `${field}: 필요하다 (${expected})`
    : `${field}: ${expected}`;
}

// core의 `resolveDataRoot`와 같은 규칙이다(`LOPHN_HOME`, 없으면 `$HOME/.lophn`). symlink·mode는 core가 켤 때 본다.
function dataRootOf(
  env: { get(name: string): string | undefined },
  home: string,
): string | undefined {
  const set = env.get("LOPHN_HOME");
  if (set !== undefined && set !== "") return set;
  return home === "" ? undefined : `${home}/.lophn`;
}

export async function cliMain(
  argv: readonly string[],
  options: CliOptions = {},
): Promise<number> {
  const parsed = parseArgs(argv);
  const env = options.env ?? ambientEnv();
  const token = env.get(CODING_TOKEN_ENV)?.trim() || undefined;
  const readText = options.readText ?? readTextOrUndefined;
  const home = options.home ?? env.get("HOME") ?? "";
  const matched = matchCommand(parsed.positional);
  // coding token이 없을 때 `user` 명령만 user token file을 읽는다.
  const userDataRoot = dataRootOf(env, home);
  const userTokenPath = `${
    userDataRoot ?? "<data root>"
  }/run/${USER_TOKEN_FILE_NAME}`;
  const userToken = matched?.entry.auth === "user" && token === undefined &&
      userDataRoot !== undefined
    ? readText(userTokenPath) || undefined
    : undefined;
  const output = createOutput({
    json: parsed.json,
    stdout: options.stdout,
    stderr: options.stderr,
    secrets: [token, userToken].filter((value) => value !== undefined),
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
  const cwd = options.cwd ?? process.cwd();
  const body = inputOf(parsed, cwd, readText, entry.auth === "user");
  if (!body.ok) return await fail(body.error);
  const candidate: Record<string, unknown> = entry.auth === "user"
    ? body.value === undefined ? {} : { input: body.value }
    : { ...(body.value as Record<string, unknown> | undefined) };
  slots.forEach((slot, index) => candidate[slot] = rest[index]);
  // flag가 위치 인자를 덮어쓰지 못하게 한다(`workflow report <step>`과 `--step`).
  if (parsed.step !== undefined && slots.includes("step")) {
    return await fail({
      code: "invalid_input",
      message: "<step> 위치 인자와 --step을 같이 쓰지 않는다",
    });
  }
  // 이 칸들은 run·workflow 명령만 받는다. 다른 명령은 strict 입력이 "모르는 칸"으로 거절한다.
  if (parsed.agent !== undefined) candidate.agent = parsed.agent;
  if (parsed.session !== undefined) candidate.session = parsed.session;
  if (parsed.schema !== undefined) candidate.schema = parsed.schema;
  if (parsed.step !== undefined) candidate.step = parsed.step;
  if (parsed.next !== undefined) candidate.next = parsed.next;
  if (parsed.async) candidate.async = true;
  // flag가 만든 칸은 route 입력이 아니다. route 입력의 칸(예: previews.start의 `input`)은 이름이 같아도 남는다.
  const flagKeys: string[] = [];
  if (parsed.json) {
    candidate.json = true;
    flagKeys.push("json");
  }
  if (parsed.idempotencyKey !== undefined) {
    candidate.idempotency_key = parsed.idempotencyKey;
    flagKeys.push("idempotency_key");
  }
  const checked = entry.input.safeParse(candidate);
  if (!checked.success) {
    return await fail({
      code: "invalid_input",
      message: `입력이 맞지 않다: ${
        checked.error.issues.map((issue) => describeIssue(issue, candidate))
          .join("; ")
      }`,
    });
  }
  const input = Object.fromEntries(
    Object.entries(checked.data as Record<string, unknown>).filter(([key]) =>
      !flagKeys.includes(key)
    ),
  );
  // 자격이 있을 때만 core 주소를 찾고 client를 만든다. `user` 명령은 coding token이 먼저다.
  let client: RunContext["client"];
  const credential = entry.auth === "user"
    ? token ?? userToken
    : entry.auth === "coding_token"
    ? token
    : undefined;
  if (entry.auth === "user" && credential === undefined) {
    return await fail({
      code: "unavailable",
      message: `lophn이 꺼져 있다: ${userTokenPath}이 없다`,
    });
  }
  if (credential !== undefined) {
    const address = discoverDaemonAddress({
      env: env.get(LOPHN_DAEMON_URL),
      dataRoot: entry.auth === "user" ? userDataRoot : env.get("LOPHN_HOME"),
      readText,
    });
    if (!address.ok) return await fail(address.error);
    client = createCoreClient({
      baseUrl: address.value.url,
      token: credential,
      appScoped: token !== undefined,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }
  const ran = await entry.run(input, {
    client,
    idempotencyKey: parsed.idempotencyKey,
    json: parsed.json,
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
  if (ran.value instanceof ExitWith) {
    await output.result(ran.value.stdout);
    if (ran.value.stderr !== undefined) await output.note(ran.value.stderr);
    return ran.value.exit;
  }
  await output.result(ran.value);
  return CLI_EXITS.success;
}

if (import.meta.main) {
  process.exit(await cliMain(process.argv.slice(2)));
}
