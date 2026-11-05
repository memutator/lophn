import type { Clock, IdSource } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { TurnMode } from "../../../protocol/lophn-agent/turn-values.ts";
import type {
  AgentId,
  Workspace,
  WorkspaceKind,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { ResultSpill } from "./spill.ts";
import type { CoreCall } from "../run-loop/core-call.ts";
import type {
  WorkspaceScope,
  QuestionWait,
  SkillReader,
  ToolGatePort,
} from "./ports.ts";
import type { ToolDefinition } from "./registry.ts";

// tool handler에 넘기는 실행 맥락이다. turn마다 하나 만든다.
// tool은 이것만 보고 바깥을 부른다. 직접 import해서 부르지 않는다.
export type ToolContext = {
  session: Id<"ses">;
  turn: Id<"trn">;
  // 이 tool call의 ID. 재전송을 하나로 묶는 dedup 기준이다. 입력에서 받지 않는다.
  tool_call: Id<"tcl">;
  // Gate의 GateCall에 싣는 호출자다.
  agent: AgentId;
  // 이 session의 workspace 종류다. home이면 workspace가 null이다.
  kind: WorkspaceKind;
  // 이 turn의 mode. 시작 때 정해 turn 동안 같다. ask가 사람 없음을 안다.
  // Gate 판정은 core가 turn 행에서 읽는다.
  mode: TurnMode;
  workspace: Workspace | null;
  // 그 session이 시작할 때 고정한 tool 목록.
  listed: readonly ToolDefinition[];
  // core route를 부른다. agent 자격이다.
  core: CoreCall;
  // Gate가 걸리는 tool만 executeToolCall이 부른다. 판정, 사람에게 묻기, 기다리기를 core가 한 번에 한다.
  gate: ToolGatePort;
  questions: QuestionWait;
  scope: WorkspaceScope;
  skills: SkillReader;
  clock: Clock;
  ids: IdSource;
  fetch: typeof fetch;
  // 상한을 넘는 tool 결과의 전체를 쓰는 길. 없으면 미리보기만 간다.
  spill?: ResultSpill;
  // turn이 멈추면 중단된다. 오래 도는 tool(shell)이 자기 process를 정리하는 데 쓴다.
  signal?: AbortSignal;
};
