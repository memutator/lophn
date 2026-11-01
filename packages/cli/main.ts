// lophn binary의 실행 entry다. 조립만 하고 업무 규칙을 두지 않는다. node 전용이라 core는 이 file을 import하지 않는다.
// 명령 표(`commands/`)의 명령은 data root의 user token file을 자격으로 쓴다. 자격이 없으면 core를 부르는 명령은
// 아무것도 보내지 않는다. `packages/coding-agent`의 local 명령 가운데 `harness sync-skills`만 같은 token으로 core를 읽고,
// `hook`과 그 밖의 `harness *`는 core를 부르지 않는다.
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import process from "node:process";
// 제품 판은 root package.json 하나다. 설치본에서도 platform/package.json으로 같이 간다(tools/package-linux.ts).
import productPackage from "../../package.json" with { type: "json" };
import {
  err,
  type LophnError,
  ok,
  type Result,
  systemClock,
} from "../base/mod.ts";
import { LOCAL_COMMANDS, type LocalCommand } from "../coding-agent/mod.ts";
import { type RpcFetch, USER_TOKEN_FILE_NAME } from "../protocol/client/mod.ts";
import { HOOK_STDIN_MAX_BYTES } from "../protocol/coding-agent/mod.ts";
import { loadAppCommands } from "./commands/app-command.ts";
import { COMMANDS } from "./commands/mod.ts";
import type { Command } from "./commands/types.ts";
import {
  clientCore,
  createCoreClient,
  discoverDaemonAddress,
  LOPHN_DAEMON_URL,
} from "./connection/mod.ts";
import { helpJson, helpText } from "./help.ts";
import { CLI_EXITS, createOutput, exitOf } from "./output.ts";
import { parseCommandLine, wordsOf } from "./parser.ts";

// 시험이 끼우는 환경이다. 없으면 process의 것이다.
type CliOptions = {
  env?: { get(name: string): string | undefined };
  fetch?: RpcFetch;
  stdout?: WritableStream<Uint8Array>;
  stderr?: WritableStream<Uint8Array>;
  home?: string;
  stdin?: () => Promise<string>;
  readText?: (path: string) => string | undefined;
};

function ambientEnv(): { get(name: string): string | undefined } {
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
  const env = options.env ?? ambientEnv();
  const readText = options.readText ?? readTextOrUndefined;
  const home = options.home ?? env.get("HOME") ?? "";
  const json = argv.includes("--json");
  const output = createOutput({
    json,
    stdout: options.stdout,
    stderr: options.stderr,
  });
  if (argv[0] === "version") {
    await output.result({ version: productPackage.version });
    return 0;
  }
  const all: readonly (Command | LocalCommand)[] = [
    ...COMMANDS,
    ...LOCAL_COMMANDS,
  ];
  // 표의 명령만 user token file을 읽는다. 앱 command(`lophn <domain> <command>`)는 표에 없어, 표에 없는 첫 낱말이면 core에서 읽어 이어 parse한다.
  const dataRoot = dataRootOf(env, home);
  const tokenPath = `${dataRoot ?? "<data root>"}/run/${USER_TOKEN_FILE_NAME}`;
  const token =
    dataRoot === undefined ? undefined : readText(tokenPath) || undefined;
  const secret = createOutput({
    json,
    stdout: options.stdout,
    stderr: options.stderr,
    secrets: token === undefined ? [] : [token],
  });
  const fail = async (error: LophnError) => {
    await secret.failure(error);
    return exitOf(error);
  };
  const connect = (): Result<ReturnType<typeof clientCore>> => {
    if (token === undefined) {
      return err({
        code: "unavailable",
        message: `lophn is not running: ${tokenPath} is missing`,
      });
    }
    const address = discoverDaemonAddress({
      env: env.get(LOPHN_DAEMON_URL),
      dataRoot,
      readText,
    });
    if (!address.ok) return address;
    return ok(
      clientCore(
        createCoreClient({
          baseUrl: address.value.url,
          token,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        }),
      ),
    );
  };

  let commands: readonly (Command | LocalCommand)[] = all;
  let core: ReturnType<typeof connect> | undefined;
  let parsed = parseCommandLine(argv, commands, { readText });
  const word = argv[0];
  if (
    !parsed.ok &&
    word !== undefined &&
    !word.startsWith("--") &&
    !all.some((item) => wordsOf(item.name)[0] === word)
  ) {
    core = connect();
    if (!core.ok) return await fail(core.error);
    const app = await loadAppCommands(core.value, word);
    if (!app.ok) return await fail(app.error);
    if (app.value.length > 0) {
      commands = [...all, ...app.value];
      parsed = parseCommandLine(argv, commands, { readText });
    }
  }
  if (!parsed.ok) {
    await output.failure(parsed.error);
    return exitOf(parsed.error);
  }
  const line = parsed.value;
  if (line.kind === "help") {
    const text = helpText(commands, line.topic);
    if (text === undefined) {
      const error = {
        code: "invalid_input",
        message: `unknown command: ${line.topic.join(" ")}. Run \`lophn help\``,
      } as const;
      await output.failure(error);
      return exitOf(error);
    }
    if (json && line.topic.length === 0) await output.result(helpJson(all));
    else await output.text(text);
    return argv.length === 0 ? CLI_EXITS.invalid_input : 0;
  }

  const { command, input } = line;
  if (!("routes" in command)) {
    const ran = await command.run(input, {
      env,
      home,
      now: () => new Date().toISOString(),
      stdin: options.stdin ?? readProcessStdin,
      core: () => (core ??= connect()),
    });
    if (!ran.ok) {
      await output.failure(ran.error);
      return exitOf(ran.error);
    }
    await output.result(ran.value);
    return CLI_EXITS.success;
  }

  core ??= connect();
  if (!core.ok) return await fail(core.error);
  const ran = await command.run(input, {
    core: core.value,
    key: line.key ?? crypto.randomUUID(),
    place: undefined,
    cwd: process.cwd(),
    clock: systemClock,
    signal: new AbortController().signal,
  });
  if (!ran.ok) return await fail(ran.error);
  const result = ran.value;
  if (result.failed !== undefined) {
    if (json) await secret.result(result.content);
    await secret.note(result.failed);
    return CLI_EXITS.failed;
  }
  await secret.result(json ? result.content : (result.text ?? result.content));
  if (result.note !== undefined) await secret.note(result.note);
  return CLI_EXITS.success;
}

if (import.meta.main) {
  process.exit(await cliMain(process.argv.slice(2)));
}
