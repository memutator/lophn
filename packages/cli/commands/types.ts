// 명령 표의 한 줄이 가진 모양이다. 이 package의 `commands/`는 lophn이 내놓는 명령의 정본이고 binary(`main.ts`)와
// lophn agent의 `lophn` tool(core)이 같은 표를 쓴다. 다른 점은 core를 부르는 자격(`CommandCore`)뿐이다.
// 명령 code는 얇게 둔다: route를 부르고 결과를 다듬는 것까지다. 부른 쪽에 따라 달라지는 규칙은 core route가
// credential을 보고 정한다. 같은 명령을 binary가 user token으로도 부르기 때문이다.
import type { z } from "zod";
import type { Clock, LophnError, Result } from "../../base/mod.ts";
import type {
  CommandRoute,
  MemoryRoute,
  ReadRoute,
} from "../../protocol/base/route.ts";
import type {
  Workspace,
  WorkspaceKind,
} from "../../protocol/lophn-agent/workspaces.ts";

// core를 부르는 interface다. binary는 user token HTTP client를, `lophn` tool은 agent credential의 `CoreCall`을 끼운다.
export type CommandCore = {
  // read와 memory route. envelope 없이 입력을 그대로 보낸다.
  read<R extends ReadRoute | MemoryRoute>(
    route: R,
    input: unknown,
  ): Promise<Result<z.output<R["output"]>>>;
  // command route. 같은 key로 다시 부르면 같은 효과다. compare가 없으면 빈 객체다.
  command<R extends CommandRoute>(
    route: R,
    input: unknown,
    options: { key: string; compare?: unknown },
  ): Promise<Result<z.output<R["output"]>>>;
};

export type CommandContext = {
  core: CommandCore;
  // 쓰기 명령이 command route에 넘기는 idempotency key. `lophn` tool은 tool call의 id, binary는 `--idempotency-key`이거나
  // 새로 만든 값이다.
  key: string;
  // lophn agent session의 workspace다(home이면 null). binary에는 session이 없어 undefined다.
  workspace: Workspace | null | undefined;
  // 상대 path를 푸는 기준 폴더다. binary는 process cwd, `lophn` tool은 workspace의 첫 폴더다(home이면 없다).
  cwd?: string;
  // lophn tool이 file을 읽기 전에 거치는 읽기 범위 검사다. 허용하면 실제 경로를, 아니면 오류를 돌려준다. binary에는 없다.
  resolveRead?: (path: string) => Promise<Result<string>>;
  // lophn agent의 tool call 신원이다. core가 agent caller를 기록된 tool call과 대조하므로 명령이 앱 호출 같은 caller를 받는 route에 넘긴다.
  // binary에는 없다(사람은 run을 거친다).
  caller?: { session: string; turn: string; tool_call: string };
  clock: Clock;
  signal: AbortSignal;
};

export type CommandResult = {
  summary: string;
  content: Record<string, unknown>;
  // 결과가 상한을 넘을 때 뒤쪽 항목부터 덜어 낼 content의 배열 key. 상한에 맞추는 일은 `lophn` tool 쪽이 한다.
  // binary는 전부 찍는다.
  arrayKeys?: readonly string[];
  // binary가 `--json` 없이 찍는 글이다. 없으면 content를 줄로 푼다.
  text?: string;
  // 명령은 끝났지만 일의 결과가 실패다(끝난 run이 failed). binary는 exit 4로 끝나고 이 글을 stderr에 쓴다.
  failed?: string;
  // 실패는 아니지만 알릴 것이다(workflow 시작은 됐는데 넘기지 못했다). binary는 stderr에 쓴다.
  note?: string;
};

export type CommandEffect = "read" | "write" | "external";

// parser와 help가 읽는 칸이다. binary의 local 명령(`packages/coding-agent/local`)도 이 모양이라 같은 parser·help를 쓴다.
export type CommandDoc = {
  // 점 이름이다(`job.create`). argv 낱말은 `.`로 나누고 `_`는 `-`로 바꾼다(`app.link_source` → `app link-source`).
  // `hook`처럼 점 없는 이름은 한 낱말이다.
  name: string;
  summary: string;
  description: string;
  // 칸이 flag가 된다(`field_name` → `--field-name`). strict object여야 한다.
  input: z.ZodType;
  // 위치 인자로 받는 칸 이름이다. 순서대로 채운다.
  positional?: readonly string[];
  effect: CommandEffect;
};

export type Command = CommandDoc & {
  // 이 명령이 core에 부르는 route다. lophn agent credential의 operation 상한이 여기서 정해진다.
  routes: readonly { name: string }[];
  // 이 명령을 부를 수 있는 lophn agent의 workspace 종류다. 비면 binary만 부른다.
  workspaces: readonly WorkspaceKind[];
  run(
    input: Record<string, unknown>,
    ctx: CommandContext,
  ): Promise<Result<CommandResult, LophnError>>;
};

type CommandSpec<I extends z.ZodType> = Omit<Command, "input" | "run"> & {
  input: I;
  run(
    input: z.output<I>,
    ctx: CommandContext,
  ): Promise<Result<CommandResult, LophnError>>;
};

// 실행 전에 parser가 `input`으로 검사하므로 run의 입력 type이 맞다.
export function defineCommand<I extends z.ZodType>(
  spec: CommandSpec<I>,
): Command {
  return spec as unknown as Command;
}
