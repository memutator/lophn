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
} from "./mod.ts";
import { commandHelp, helpJson, helpText } from "./help.ts";
import { createOutput } from "./output.ts";
import type { ParsedArgs } from "./parser.ts";
import type { AgentFailure } from "../../protocol/coding-agent/mod.ts";
import {
  discoverDaemonAddress,
  LOPHN_DAEMON_URL,
  resolveDaemonAddress,
} from "../connection/client/daemon.ts";
import {
  connectionFromRef,
  createCoreClient,
} from "../connection/client/core.ts";
import {
  createHelperCredentialProvider,
  registeringProvider,
} from "../connection/credential/helper.ts";
import { LOPHN_CONNECTION } from "../../protocol/coding-agent/mod.ts";
import { REDACTION_REPLACEMENT } from "../../protocol/platform/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionStream,
} from "../../base/redaction/mod.ts";
import { candidateOf, commandNameOf, inputOf } from "./invocation.ts";
import {
  actorOf,
  ambientEnv,
  appSocketDirOf,
  type CliPorts,
  runCliCommand,
} from "./dispatch.ts";
import type { CredentialProvider } from "../connection/credential/provider.ts";
import type { RpcFetch } from "../../protocol/platform/mod.ts";

const VERSION = "0.1.0";

// 조립이 끼워 주는 redaction이다(mcp-server/stdio의 같은 모양). 알려진 secret
// registry를 process 수명으로 두고 실패 진단·details를 거친다. push는 검사가 확정된
// prefix만 돌려주므로 push의 결과에 finish의 보류를 더해 온전한 글을 돌려준다.
function redactor(
  registry: ReturnType<typeof createKnownSecretRegistry>,
): (text: string) => string {
  return (text) => {
    const stream = createRedactionStream(registry);
    const released = stream.push(text);
    return released + stream.finish();
  };
}

// 시험이 끼우는 환경이다. 없으면 process의 것이다. 사람의 실제 data root·HOME은 시험이 temp로 준다.
export type CliOptions = {
  env?: { get(name: string): string | undefined };
  provider?: CredentialProvider;
  fetch?: RpcFetch;
  stdout?: WritableStream<Uint8Array>;
  stderr?: WritableStream<Uint8Array>;
  cwd?: string;
  home?: string;
  installRoot?: string;
  ports?: Partial<CliPorts>;
  appSocketDir?: string;
  stdin?: () => Promise<string>;
};

// 설치 묶음의 위치다. 이 entry는 `<설치 root>/platform/apps/cli/main.ts`라 세 단계 위다.
const INSTALL_ROOT = new URL("../../../", import.meta.url).pathname;

function readTextOrUndefined(path: string): string | undefined {
  try {
    return Deno.readTextFileSync(path);
  } catch {
    return undefined;
  }
}

// 받은 token은 어떤 출력에도 남지 않게 마지막으로 한 번 더 지운다(connection#R17).
function scrub(
  known: ReturnType<typeof createKnownSecretRegistry>,
  text: string,
): string {
  let out = text;
  for (let hit = known.match(out); hit !== undefined; hit = known.match(out)) {
    out = out.slice(0, hit.index) + REDACTION_REPLACEMENT +
      out.slice(hit.index + hit.length);
  }
  return out;
}

export async function cliMain(
  argv: readonly string[],
  options: CliOptions = {},
): Promise<number> {
  const parsed = parseArgs(argv);
  const known = createKnownSecretRegistry();
  const output = createOutput({
    json: parsed.json,
    redact: redactor(known),
    stdout: options.stdout,
    stderr: options.stderr,
  });
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
    const help = helpJson(parsed.positional.join(" ") || undefined);
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
  // command 이름은 표에 있는 가장 긴 앞부분이다(`app preview start`까지 세 조각). 남는 위치 인자는
  // 받지 않는다(위치 인자가 없고 선택값만 있다).
  const tokens = [parsed.command, ...parsed.positional];
  const { command, used } = commandNameOf(parsed);
  const entry = findCommand(command);
  if (entry !== undefined && tokens.length > used) {
    const failure: AgentFailure = {
      code: "invalid_input",
      message: "command 뒤에 받지 않는 위치 인자가 있다",
    };
    await output.failure(failure);
    return output.exitCode(failure);
  }
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
  const candidate = candidateOf(parsed, command, body.value);
  const checked = entry.input.safeParse(candidate);
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
  // `session summary --hook`은 어떤 실패도 stdout 빈 값·exit 0이다(guides#R24). 세션 시작을 막지 않는다.
  const hookMode = command === "session summary" &&
    (checked.data as { hook?: boolean }).hook === true;
  const env = options.env ?? ambientEnv();
  const connection = connectionFromRef(
    (checked.data as { connection?: string }).connection ??
      env.get(LOPHN_CONNECTION),
  );
  const dataRoot = env.get("LOPHN_HOME");
  const address = discoverDaemonAddress({
    option: parsed.daemonUrl,
    env: env.get(LOPHN_DAEMON_URL),
    dataRoot,
    readText: readTextOrUndefined,
  });
  if (!address.ok) {
    if (hookMode) return 0;
    await output.failure(address.error);
    return output.exitCode(address.error);
  }
  // connection 참조로 시작할 때 helper에서 credential을 한 번 받는다. 평문 파일·user credential
  // fallback은 없다(connection#R17).
  const provider = registeringProvider(
    options.provider ?? createHelperCredentialProvider({
      helper: `${
        (options.installRoot ?? INSTALL_ROOT).replace(/\/$/, "")
      }/lophn-credential`,
    }),
    known,
  );
  const client = connection.ok
    ? createCoreClient({
      baseUrl: address.value.url,
      provider,
      connection: connection.value,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    })
    : undefined;
  const appSocketDir = options.appSocketDir ?? appSocketDirOf(env, () => {
    try {
      return Deno.uid();
    } catch {
      return null;
    }
  });
  const ran = await runCliCommand(
    command,
    { ...checked.data as Record<string, unknown> },
    {
      client,
      provider,
      actor: actorOf(env),
      cwd: options.cwd ?? Deno.cwd(),
      dataRoot,
      env,
      home: options.home ?? env.get("HOME"),
      installRoot: options.installRoot ?? INSTALL_ROOT,
      daemonUrl: address.value.url,
      ...(appSocketDir === undefined ? {} : { appSocketDir }),
      now: () => new Date().toISOString(),
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(options.ports === undefined ? {} : { ports: options.ports }),
    },
  );
  if (hookMode) {
    if (ran.ok) {
      await output.raw(
        String((ran.value.data as { hook?: unknown } | undefined)?.hook ?? ""),
      );
    }
    return 0;
  }
  if (command === "session observe") {
    // hook의 stdout은 제품이 model context로 읽을 수 있어 비워 둔다. 보내지 못해도 harness 작업을 막지 않으므로
    // 진단은 stderr 한 줄이고 exit는 0이다(조사 T6).
    if (!ran.ok) {
      await output.diagnostic(`session observe: ${ran.error.message}`);
    }
    return 0;
  }
  if (!ran.ok) {
    const failure: AgentFailure = {
      code: ran.error.code,
      message: ran.error.message,
      ...(ran.error.details === undefined
        ? {}
        : { details: ran.error.details }),
    };
    await output.failure(failure);
    return output.exitCode(failure);
  }
  const { isError, ...result } = ran.value;
  const safe = JSON.parse(
    scrub(known, JSON.stringify(result)),
  ) as typeof result;
  await output.result(safe);
  // 실패·거절·검사 실패 결과는 성공 exit가 아니다(cli#R26).
  // 쓰기 응답을 잃은 결과는 실제 오류와 구별한 effect_unknown(exit 6)이다(cli#R5).
  const lost = (result.data as { details?: Record<string, unknown> } | null)
    ?.details;
  const refused: AgentFailure | undefined = isError !== true
    ? undefined
    : lost?.diagnosis === "effect_unknown"
    ? { code: "unavailable", message: result.summary, details: lost }
    : { code: "conflict", message: "결과가 실패를 알린다" };
  return output.exitCode(refused);
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
