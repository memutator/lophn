import type { Result } from "../../base/mod.ts";
import type { Id, JsonValue } from "../../protocol/base/mod.ts";
import type { ToolCallOutput } from "../../protocol/apps/calls/call.ts";
import type {
  AgentRef,
  NamedAgent,
  TurnOutcome,
} from "../../protocol/lophn-agent/mod.ts";
import type { RunPlace, RunRecord } from "../../protocol/runs/mod.ts";
import type { runCreate, runSettle } from "../../protocol/runs/mod.ts";
import type { Input } from "../../protocol/server/mod.ts";

// Operator의 place는 AgentRef에 없다. 이름을 푸는 쪽(wiring)이 place를 같이 준다.
export type ResolvedAgent = { agent: AgentRef; place: RunPlace | null };

export type TurnOfMessage = {
  turn: Id<"trn">;
  state: "running" | "finished";
  outcome: TurnOutcome | null;
};

// lophn agent를 부르는 port. 구현은 hr-runs-wiring이 끼운다.
export type RunAgents = {
  // 못 풀면 not_found, 여럿이면 invalid_input.
  resolve(named: NamedAgent): Promise<Result<ResolvedAgent>>;
  // 없으면 not_found, 열린 session이 아니면 conflict.
  agentOf(session: Id<"ses">): Promise<Result<ResolvedAgent>>;
  open(agent: AgentRef, session: Id<"ses">): Promise<Result<void>>;
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
  call(
    run: Id<"run">,
    app: Id<"app">,
    tool: string,
    input: JsonValue | undefined,
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
