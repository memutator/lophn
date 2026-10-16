// command 표의 한 줄이다. 이름·입력·인증은 `CODING_CLI_COMMANDS`(protocol)가 정본이고, 여기는 그 표에
// 실행과 help 글을 붙인다. 표 밖 command는 만들지 않는다.
import type { z } from "zod";
import { err, type LophnError, type Result } from "../../../base/mod.ts";
import {
  CODING_CLI_COMMANDS,
  CODING_TOKEN_ENV,
  type CodingCliCommand,
} from "../../../protocol/coding-agent/mod.ts";
import { callRoute } from "../../connection/call.ts";
import type { CoreClient } from "../../connection/mod.ts";

// local 명령(harness)이 쓰는 환경이다.
export type LocalEnv = {
  env: { get(name: string): string | undefined };
  cwd: string;
  home: string;
  dataRoot: string | undefined;
  now(): string;
};

export type RunContext = {
  // coding token이 없으면 undefined다. 그러면 core를 부르는 command는 아무것도 보내지 않고 거절한다.
  client: CoreClient | undefined;
  idempotencyKey: string | undefined;
  stdin(): Promise<string>;
  local: LocalEnv;
};

export type CommandRun = (
  // 공통 칸(json·input·input_file·idempotency_key)을 뺀 command 입력이다.
  input: Record<string, unknown>,
  ctx: RunContext,
) => Promise<Result<unknown, LophnError>>;

export type CommandEntry = {
  // `lophn <group> <command>`의 `<group> <command>`다. `hook`처럼 한 단어도 있다.
  name: string;
  // help에 보이는 한 줄이다.
  summary: string;
  // 이름 pattern으로 정해진다(`isReadName`). help가 이 칸으로 읽기와 변경을 가른다.
  mutates: boolean;
  auth: CodingCliCommand["auth"];
  // 공통 칸을 포함한 CLI 입력 schema다.
  input: z.ZodType;
  // 위치 인자로 받는 입력 칸 이름이다(`hook <harness> <event>`).
  positional?: readonly string[];
  run: CommandRun;
};

// 읽기 명령의 마지막 단어다. 이름 pattern만으로 읽기를 가릴 수 있어야 하므로 변경 명령은 이 단어를 쓰지 않는다.
export const READ_WORDS = [
  "list",
  "show",
  "status",
  "blueprint",
  "invocations",
  "logs",
  "more",
  "diff",
  "detect",
  "fix-records",
] as const;

export function isReadName(name: string): boolean {
  const last = name.split(" ").at(-1) ?? name;
  return (READ_WORDS as readonly string[]).includes(last);
}

export function specOf(name: string): CodingCliCommand {
  const spec = CODING_CLI_COMMANDS.find((command) => command.name === name);
  if (spec === undefined) throw new Error(`command not in table: ${name}`);
  return spec;
}

export function noToken(): LophnError {
  return {
    code: "unauthorized",
    message:
      `${CODING_TOKEN_ENV}가 없다. coding agent session의 터미널에서만 쓴다`,
  };
}

// 표의 route 하나를 입력 그대로 부르는 기본 실행이다.
function routeRun(spec: CodingCliCommand): CommandRun {
  const route = spec.route;
  if (route === undefined) throw new Error(`no route: ${spec.name}`);
  return (input, ctx) => {
    if (ctx.client === undefined) return Promise.resolve(err(noToken()));
    return callRoute(ctx.client, {
      route,
      input,
      idempotencyKey: ctx.idempotencyKey,
    });
  };
}

export function entryOf(
  name: string,
  summary: string,
  options: { run?: CommandRun; positional?: readonly string[] } = {},
): CommandEntry {
  const spec = specOf(name);
  return {
    name,
    summary,
    mutates: !isReadName(name),
    auth: spec.auth,
    input: spec.input,
    ...(options.positional === undefined
      ? {}
      : { positional: options.positional }),
    run: options.run ?? routeRun(spec),
  };
}
