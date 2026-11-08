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
import { HOOK_STDIN_MAX_BYTES } from "../protocol/coding-agent/mod.ts";
import { loadAppCommands } from "./commands/app-command.ts";
import { CORE_COMMANDS, type CoreCommand } from "./commands/core.ts";
import { COMMANDS } from "./commands/mod.ts";
import { parseWorkspaceText } from "./commands/tab.ts";
import type { Command, CommandCore, CommandResult } from "./commands/types.ts";
import { openConnection, stopCore } from "./connection/mod.ts";
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
  const image = result.content.image as { data_base64: string } | undefined;
  if (image === undefined) return ok(result);
  const path =
    typeof input.out === "string"
      ? resolve(process.cwd(), input.out)
      : join(
          tmpdir(),
          "lophn-screenshots",
          `${String(input.tab)}-${systemClock.nowMs()}.png`,
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

export async function cliMain(
  argv: readonly string[],
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
  const json = argv.includes("--json");
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
  if (argv[0] === "version") {
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
  const fail = async (error: LophnError) => {
    await output().failure(error);
    return exitOf(error);
  };

  let commands: readonly (Command | LocalCommand | CoreCommand)[] = all;
  let core: Result<CommandCore, LophnError> | undefined;
  let parsed = parseCommandLine(argv, commands, { readText });
  const word = argv[0];
  if (
    !parsed.ok &&
    word !== undefined &&
    !word.startsWith("--") &&
    !all.some((item) => wordsOf(item.name)[0] === word)
  ) {
    core = await connect();
    if (!core.ok) return await fail(core.error);
    const app = await loadAppCommands(core.value, word);
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
    const text = helpText(commands, line.topic);
    if (text === undefined) {
      const error = {
        code: "invalid_input",
        message: `unknown command: ${line.topic.join(" ")}. Run \`lophn help\``,
      } as const;
      await output().failure(error);
      return exitOf(error);
    }
    if (json && line.topic.length === 0) await output().result(helpJson(all));
    else await output().text(text);
    return argv.length === 0 ? CLI_EXITS.invalid_input : 0;
  }

  const { command, input } = line;
  if (!("routes" in command)) {
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
            core: () => ok(localCore),
          });
    if (!ran.ok) return await fail(ran.error);
    await output().result(ran.value);
    return CLI_EXITS.success;
  }

  core ??= await connect();
  if (!core.ok) return await fail(core.error);
  const ran = await command.run(input, {
    core: core.value,
    key: line.key ?? crypto.randomUUID(),
    // project 터미널의 env다. `tab open --url`이 사람 token일 때 놓을 자리로 쓴다.
    workspace: parseWorkspaceText(env.get("LOPHN_WORKSPACE") ?? ""),
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
