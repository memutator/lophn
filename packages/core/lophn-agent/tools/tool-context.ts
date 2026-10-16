import type { Clock, IdSource } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  AgentRef,
  Place,
  Role,
} from "../../../protocol/lophn-agent/places.ts";
import type { CallRouting } from "../ports.ts";
import type { CoreCall } from "../run-loop/core-call.ts";
import type { RecorderPorts } from "../session/rewind/record.ts";
import type {
  PlaceScope,
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
  // Gate의 intent에 싣는 호출자다. role과 place가 정체성을 다 말하지 못하는 Operator 때문에 둔다.
  agent: AgentRef;
  role: Role;
  place: Place | null;
  // 그 session이 시작할 때 고정한 tool 목록. tool.search가 읽는다.
  listed: readonly ToolDefinition[];
  // core route를 부른다. agent 자격이다.
  core: CoreCall;
  // Gate가 걸리는 tool만 executeToolCall이 부른다. 판정, 사람에게 묻기, 기다리기, 허락 소비를 core가 한 번에 한다.
  gate: ToolGatePort;
  router: CallRouting;
  questions: QuestionWait;
  scope: PlaceScope;
  // file.write와 file.edit가 쓰기 전에 pre-image를 남기는 길이다.
  rewind: RecorderPorts;
  skills: SkillReader;
  clock: Clock;
  ids: IdSource;
  fetch: typeof fetch;
};
