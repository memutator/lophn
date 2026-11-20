import type { Result } from "../../base/mod.ts";
import type { Id, JsonValue } from "../../protocol/base/mod.ts";
import type { ToolCallOutput } from "../../protocol/apps/calls/call.ts";
import type {
  AgentAddress,
  AgentAtWorkspace,
  TurnOutcome,
} from "../../protocol/lophn-agent/mod.ts";
import type { RunRecord } from "../../protocol/runs/mod.ts";
import type { runCreate, runSettle } from "../../protocol/runs/mod.ts";
import type { Input } from "../../protocol/server/mod.ts";

// job이 run을 열 때 붙이는 출처다. 메모리에만 있고 route 입력이 아니다.
export type JobOrigin = {
  job: Id<"job">;
  job_run: Id<"jbr">;
  // 다른 컴퓨터의 event가 연 차례다. 그 agent와 tool은 또 다른 컴퓨터를 부르지 못한다.
  remote: boolean;
};

// flow instance가 run을 열 때 붙이는 출처다. creator는 flow의 앱 tool 호출을 맡는
// (agent, project)다.
export type InstanceOrigin = {
  instance: Id<"wfi">;
  creator: AgentAtWorkspace;
};

// tag 없이 `job` 키와 `instance` 키로 가른다. jobs wiring이 낸 값을 그대로 두려는 것이다.
export type RunOrigin = JobOrigin | InstanceOrigin;

export type TurnOfMessage = {
  turn: Id<"trn">;
  state: "running" | "finished";
  outcome: TurnOutcome | null;
};

// lophn agent를 부르는 port. 구현은 wiring/runs.ts가 끼운다.
export type RunAgents = {
  // 못 풀면 not_found.
  resolve(address: AgentAddress): Promise<Result<AgentAtWorkspace>>;
  // 없으면 not_found, 열린 session이 아니면 conflict.
  agentOf(session: Id<"ses">): Promise<Result<AgentAtWorkspace>>;
  open(
    agent: AgentAtWorkspace,
    session: Id<"ses">,
    options?: { remote?: boolean },
  ): Promise<Result<void>>;
  // run이 새로 연 session을 사람이 볼 Agent 탭으로 요청한다. 요청이 늦거나 잃어도 run에는 영향이 없다.
  showTab(agent: AgentAtWorkspace, session: Id<"ses">): void;
  // unattended로 넣는다.
  send(
    session: Id<"ses">,
    message: Id<"msg">,
    text: string,
  ): Promise<Result<void>>;
  // 아직 가져간 turn이 없거나 메시지가 지워졌으면 null.
  turnOf(message: Id<"msg">): Promise<Result<TurnOfMessage | null>>;
  // 그 turn에서 그 session의 agent가 남긴 마지막 메시지의 글.
  answer(session: Id<"ses">, turn: Id<"trn">): Promise<Result<string | null>>;
  // 이미 끝났으면 ok.
  stop(turn: Id<"trn">): Promise<Result<void>>;
  // 이미 가져갔으면 conflict.
  unqueue(session: Id<"ses">, message: Id<"msg">): Promise<Result<void>>;
};

export type RunTools = {
  // 없으면 not_found.
  resolveApp(app: string): Promise<Result<Id<"app">>>;
  // tool은 앱의 command 이름이다. job·flow·CLI의 tool run은 operation을 부르지 못한다.
  call(
    run: Id<"run">,
    app: Id<"app">,
    tool: string,
    input: JsonValue | undefined,
    origin?: RunOrigin,
  ): Promise<Result<ToolCallOutput>>;
};

export type RunStore = {
  create(input: Input<typeof runCreate>): Promise<Result<RunRecord>>;
  // running이 아니면 conflict.
  settle(input: Input<typeof runSettle>): Promise<Result<RunRecord>>;
  read(run: Id<"run">): Promise<Result<RunRecord>>;
  running(): Promise<Result<RunRecord[]>>;
};

export type Timers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export const systemTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as number),
};
