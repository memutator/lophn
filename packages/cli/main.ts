// lophn binary의 실행 entry다. 조립만 하고 업무 규칙을 두지 않는다. node 전용이라 core는 이 file을 import하지 않는다.
// 명령 표(`commands/`)의 명령은 core를 부르는 자격을 control connect로 받고, 없으면 ensure로 core를 띄운다.
// harness가 띄운 shell이면 env의 turn 자격(agent credential)으로만 부르고 user 자격으로 바꾸지 않는다.
// `packages/coding-agent`의 local 명령 가운데 `harness sync-skills`만 같은 길로 core를 읽고,
// `hook`과 그 밖의 `harness *`는 core를 부르지 않는다.
import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
// 제품 판은 root package.json 하나다. 설치본에서도 platform/package.json으로 같이 간다(tools/package/main.ts).
import productPackage from "../../package.json" with { type: "json" };
import {
  err,
  homeOf,
  type LophnError,
  type OsPlatform,
  ok,
  type Result,
  systemClock,
} from "../base/mod.ts";
import {
  LOCAL_COMMANDS,
  type LocalCommand,
  type LocalCore,
} from "../coding-agent/mod.ts";
import type { RpcFetch } from "../protocol/client/mod.ts";
import type { ControlDial, SpawnDetached } from "../protocol/client/mod.ts";
import {
  HOOK_STDIN_MAX_BYTES,
  TERMINAL_GUI_EVENT,
} from "../protocol/coding-agent/mod.ts";
import {
  SESSION_ENV_NAME,
  TERMINAL_SESSION_PREFIX,
} from "../protocol/lophn-agent/session-tag.ts";
import { loadAppCommands } from "./commands/app-command.ts";
import { CORE_COMMANDS, type CoreCommand } from "./commands/core.ts";
import { COMMANDS } from "./commands/mod.ts";
import { ROSTER_CHANGING_COMMANDS } from "./commands/remote.ts";
import { parseWorkspaceText } from "./commands/tab.ts";
import type { Command, CommandCore, CommandResult } from "./commands/types.ts";
import { agentCredential } from "./connection/client/token.ts";
import { openConnection, stopCore } from "./connection/mod.ts";
import { helpJson, helpText } from "./help.ts";
import { CLI_EXITS, createOutput, exitOf } from "./output.ts";
import {
  fieldsOf,
  parseCommandLine,
  splitOn,
  unknownCommandError,
  wordsOf,
} from "./parser.ts";
import { remoteCore } from "./remote-core.ts";

// 시험이 끼우는 환경이다. 없으면 process의 것이다.
type CliOptions = {
  env?: { get(name: string): string | undefined };
  fetch?: RpcFetch;
  stdout?: WritableStream<Uint8Array>;
  stderr?: WritableStream<Uint8Array>;
  home?: string;
  stdin?: () => Promise<string>;
  readText?: (path: string) => string | undefined;
  platform?: OsPlatform;
  // 설치본의 platform/ 또는 개발 checkout의 root. 없으면 이 file 위치에서 본다.
  platformRoot?: string;
  // core를 찾고 띄우는 IO. 없으면 node adapter를 쓴다.
  dial?: ControlDial;
  spawnDetached?: SpawnDetached;
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
  return home === "" ? undefined : join(home, ".lophn");
}

// screenshot의 image는 file로 쓰고 path를 찍는다. 터미널의 agent는 image를 읽을 길이 없고 base64를 찍으면 context만 먹는다.
function saveImage(
  result: CommandResult,
  input: Record<string, unknown>,
): Result<CommandResult, LophnError> {
  const image = result.content.image as
    | { media_type: string; data_base64: string }
    | undefined;
  if (image === undefined) return ok(result);
  const path =
    typeof input.out === "string"
      ? resolve(process.cwd(), input.out)
      : join(
          tmpdir(),
          "lophn-screenshots",
          `${String(input.tab)}-${systemClock.nowMs()}.${image.media_type === "image/jpeg" ? "jpg" : "png"}`,
        );
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(image.data_base64, "base64"));
  } catch {
    return err({
      code: "invalid_input",
      message: `cannot write the screenshot to ${path}`,
    });
  }
  const { image: _image, ...rest } = result.content;
  return ok({ ...result, content: { ...rest, image_path: path }, text: path });
}

// `on` 칸을 가진 명령이다. `workspaces`가 있는 명령은 agent 자격의 `--on`을 허용한다.
// `on`이 필수인 명령(`send`, `settings.export`)은 사람·agent 모두 로컬 core에서 돌려 대상 컴퓨터로 보낸다(machines/call이 아니다).
const ON_COMMANDS: readonly Command[] = COMMANDS.filter((command) => {
  const shape = (command.input as { shape?: Record<string, unknown> }).shape;
  return shape !== undefined && "on" in shape;
});
const AGENT_ON_COMMANDS: readonly Command[] = ON_COMMANDS.filter(
  (command) => command.workspaces.length > 0,
);
const LOCAL_ON_COMMANDS: readonly Command[] = ON_COMMANDS.filter((command) =>
  fieldsOf(command.input).some(
    (field) => field.name === "on" && field.required,
  ),
);

function coreCommandsOnly(): LophnError {
  return {
    code: "invalid_input",
    message:
      "--on runs core commands only (version, harness, hook and core commands run on this computer)",
  };
}

export async function cliMain(
  rawArgv: readonly string[],
  options: CliOptions = {},
): Promise<number> {
  const env = options.env ?? ambientEnv();
  const readText = options.readText ?? readTextOrUndefined;
  const home =
    options.home ??
    homeOf(
      {
        HOME: env.get("HOME"),
        USERPROFILE: env.get("USERPROFILE"),
        HOMEDRIVE: env.get("HOMEDRIVE"),
        HOMEPATH: env.get("HOMEPATH"),
      },
      process.platform,
    ) ??
    "";
  const json = rawArgv.includes("--json");
  const stdoutStream = options.stdout ?? Writable.toWeb(process.stdout);
  const stderrStream = options.stderr ?? Writable.toWeb(process.stderr);
  // 자격은 연결한 뒤에야 안다. 아는 자격은 그때부터 stdout·stderr(오류 포함)에서 지운다.
  let secret: string | undefined;
  const output = () =>
    createOutput({
      json,
      stdout: stdoutStream,
      stderr: stderrStream,
      secrets: secret === undefined ? [] : [secret],
    });
  const fail = async (error: LophnError) => {
    await output().failure(error);
    return exitOf(error);
  };
  // `--on <기계>`는 어떤 parse보다 먼저 뗀다. 기계로 가는 길은 이 값뿐이고 capability는 env에서도 읽지 않는다.
  const split = splitOn(rawArgv);
  if (!split.ok) return await fail(split.error);
  let { on, argv } = split.value;
  if (on === "") {
    return await fail({
      code: "invalid_input",
      message: "--on needs a computer name or id",
    });
  }
  // agent 자격(harness가 띄운 shell)은 machines/call(사람 자격만)을 쓰지 못한다. `on` 칸을 가진 명령이면 `--on`을 그 칸으로 두고
  // 그 명령의 route로 보낸다(agent의 lophn tool과 같은 길). 그 밖의 명령에 붙은 `--on`은 거절한다.
  // 사람 자격이라도 `send`, `settings export`처럼 `on`이 필수인 명령은 이 컴퓨터의 core에서 실행해 대상으로 보낸다.
  if (on !== null) {
    const command = COMMANDS.filter((item) =>
      wordsOf(item.name).every((word, at) => argv[at] === word),
    ).sort((a, b) => wordsOf(b.name).length - wordsOf(a.name).length)[0];
    if (agentCredential(env) !== undefined) {
      if (command === undefined || !AGENT_ON_COMMANDS.includes(command)) {
        return await fail({
          code: "forbidden",
          message: `an agent uses --on only with ${AGENT_ON_COMMANDS.map((item) => wordsOf(item.name).join(" ")).join(", ")}`,
        });
      }
      // 명령 낱말 앞에 쓴 `--on`도 칸이 되게 끝에 다시 붙인다.
      argv = [...argv, "--on", on];
      on = null;
    } else if (command !== undefined && LOCAL_ON_COMMANDS.includes(command)) {
      argv = [...argv, "--on", on];
      on = null;
    }
  }
  if (argv[0] === "version") {
    if (on !== null) return await fail(coreCommandsOnly());
    await output().result({ version: productPackage.version });
    return 0;
  }
  const all: readonly (Command | LocalCommand | CoreCommand)[] = [
    ...COMMANDS,
    ...LOCAL_COMMANDS,
    ...CORE_COMMANDS,
  ];
  // 표에 없는 첫 낱말이면 core에서 앱 command를 읽어 이어 parse한다.
  const dataRoot = dataRootOf(env, home);
  const platform = options.platform ?? process.platform;
  const platformRoot =
    options.platformRoot ?? fileURLToPath(new URL("../..", import.meta.url));
  let pending: Promise<Result<CommandCore, LophnError>> | undefined;
  // core 연결은 처음 필요할 때 한 번만 한다. help·version·core를 부르지 않는 local 명령은 core를 띄우지 않는다.
  const connect = (): Promise<Result<CommandCore, LophnError>> =>
    (pending ??= openConnection({
      env,
      dataRoot,
      platform,
      platformRoot,
      productVersion: productPackage.version,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.dial === undefined ? {} : { dial: options.dial }),
      ...(options.spawnDetached === undefined
        ? {}
        : { spawnDetached: options.spawnDetached }),
    }).then((opened) => {
      if (!opened.ok) return err(opened.error);
      secret = opened.value.token;
      return ok(opened.value.core);
    }));
  // `harness sync-skills`가 이 read로 core를 처음 부를 때 ensure한다. 다른 local 명령은 이 길을 쓰지 않는다.
  const localCore: LocalCore = {
    read: async (route, input) => {
      const connected = await connect();
      if (!connected.ok) return connected;
      return connected.value.read(route, input);
    },
  };
  // `--on`이면 명령의 core 호출이 그 기계의 `machines/call`로 간다. core는 capability 없는 이 호출을 사람의 터미널(`terminal`)로 본다.
  // lophn 터미널 탭 안의 coding agent가 `--on`을 쳐도 같다. 거절하지 않는다: 받는 기계의 허락(기기별 터미널 입력)이 막는다.
  const target = (connected: CommandCore): CommandCore =>
    on === null ? connected : remoteCore(connected, on);

  let commands: readonly (Command | LocalCommand | CoreCommand)[] = all;
  let core: Result<CommandCore, LophnError> | undefined;
  // `lophn hook <harness> lophn-gui -- <args...>`는 `--` 뒤의 인자를 CLI flag로 파싱하지 않고 그대로 hook에 넘긴다.
  const dashAt =
    argv[0] === "hook" && argv[2] === TERMINAL_GUI_EVENT
      ? argv.indexOf("--")
      : -1;
  const parseArgv = dashAt >= 0 ? argv.slice(0, dashAt) : argv;
  const extraArgs = dashAt >= 0 ? argv.slice(dashAt + 1) : undefined;
  let parsed = parseCommandLine(parseArgv, commands, { readText });
  const word = argv[0];
  if (
    !parsed.ok &&
    word !== undefined &&
    !word.startsWith("--") &&
    !all.some((item) => wordsOf(item.name)[0] === word)
  ) {
    const connected = await connect();
    if (!connected.ok) return await fail(connected.error);
    const targeted = target(connected.value);
    core = ok(targeted);
    const app = await loadAppCommands(targeted, word, on !== null);
    if (!app.ok) return await fail(app.error);
    if (app.value.length > 0) {
      commands = [...all, ...app.value];
      parsed = parseCommandLine(argv, commands, { readText });
    }
  }
  if (!parsed.ok) {
    await output().failure(parsed.error);
    return exitOf(parsed.error);
  }
  const line = parsed.value;
  if (line.kind === "help") {
    // `--on`은 core를 부르는 명령에만 듣는다(아래 `coreCommandsOnly`).
    const text = helpText(commands, line.topic, (item) => "routes" in item);
    if (text === undefined) {
      const error = unknownCommandError(line.topic, commands);
      await output().failure(error);
      return exitOf(error);
    }
    if (json && line.topic.length === 0) await output().result(helpJson(all));
    else await output().text(text);
    return argv.length === 0 ? CLI_EXITS.invalid_input : 0;
  }

  const { command, input } = line;
  // lophn의 터미널 탭은 사람 token을 받는다(agent 자격 env가 없다). 그 안의 coding agent가 명단을 바꾸지 못하게 막는다.
  // agent가 env를 지우면 지나가는 실수 막기다.
  if (
    ROSTER_CHANGING_COMMANDS.includes(command.name) &&
    (env.get(SESSION_ENV_NAME) ?? "").startsWith(TERMINAL_SESSION_PREFIX)
  ) {
    return await fail({
      code: "forbidden",
      message: `lophn ${wordsOf(command.name).join(" ")} is refused inside a lophn terminal tab, where a coding agent may be the one typing; use Settings › Remote, or a terminal outside lophn (SSH on a computer without a screen)`,
    });
  }
  if (!("routes" in command)) {
    if (on !== null) return await fail(coreCommandsOnly());
    const ran =
      "binary" in command
        ? await command.run(input, {
            stop: () =>
              stopCore({
                env,
                dataRoot,
                platform,
                ...(options.dial === undefined ? {} : { dial: options.dial }),
              }),
          })
        : await command.run(input, {
            env,
            home,
            cwd: process.cwd(),
            now: () => new Date().toISOString(),
            stdin: options.stdin ?? readProcessStdin,
            ...(extraArgs === undefined ? {} : { extraArgs }),
            core: () => ok(localCore),
          });
    if (!ran.ok) return await fail(ran.error);
    await output().result(ran.value);
    return CLI_EXITS.success;
  }

  if (core === undefined) {
    const connected = await connect();
    core = connected.ok ? ok(target(connected.value)) : connected;
  }
  if (!core.ok) return await fail(core.error);
  const ran = await command.run(input, {
    core: core.value,
    key: line.key ?? crypto.randomUUID(),
    // project 터미널의 env다. `tab open --url`이 사람 token일 때 놓을 자리로 쓴다. `LOPHN_WORKSPACE`는 이 기계의 것이라 다른 기계에는 넘기지 않는다.
    workspace:
      on === null
        ? parseWorkspaceText(env.get("LOPHN_WORKSPACE") ?? "")
        : undefined,
    cwd: process.cwd(),
    clock: systemClock,
    signal: new AbortController().signal,
  });
  if (!ran.ok) return await fail(ran.error);
  const saved = saveImage(ran.value, input);
  if (!saved.ok) return await fail(saved.error);
  const result = saved.value;
  if (result.failed !== undefined) {
    if (json) await output().result(result.content);
    await output().note(result.failed);
    return CLI_EXITS.failed;
  }
  await output().result(
    json ? result.content : (result.text ?? result.content),
  );
  if (result.note !== undefined) await output().note(result.note);
  return CLI_EXITS.success;
}

if (import.meta.main) {
  process.exit(await cliMain(process.argv.slice(2)));
}
