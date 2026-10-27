// eval이 다른 task들과 나누는 계약. type과 아주 작은 constructor만 둔다.
//
// 관례(다른 task가 기댄다):
// - 시나리오 file은 `tests/eval/scenarios/<group>/<id>.scenario.ts`이고 `export default`로
//   `Scenario` 하나를 내놓는다. 같은 폴더의 다른 file(`common.ts` 등)은 시나리오가 아니고,
//   공용 index file은 없다. 찾는 쪽은 `**/*.scenario.ts`를 glob한다.
// - run 요약은 `tests/eval/runs/<RunRecord.id>.json`이고 `RunRecord`에서
//   `TrialResult.record`, `SourceInfo.diff`, `SourceInfo.untracked`를 뺀 JSON이다.
//   전체 기록은 `.dev-data/eval/<RunRecord.id>/`에 있다.

import type { Id } from "../../packages/protocol/base/mod.ts";
import type {
  AgentCallRecord,
  AgentRef,
  CallFailReason,
  CallReply,
  CallState,
  ModelCallRecord,
  NamedAgent,
  Role,
  ToolCall,
  ToolOutcome,
  TurnRecord,
} from "../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../support/core/mod.ts";

// ---- 버전 ----

export type VersionKind =
  | "material"
  | "scenario"
  | "criterion"
  | "judge"
  | "checks"
  | "core"
  | "instruction"
  | "skill"
  | "skill-description"
  | "tool"
  | "assembly"
  | "runtime"
  | "template"
  | "model"
  | "cli";

// `kind:name@n`이 한 버전의 이름이다. core, assembly, runtime, checks는 name이 kind와 같다(`core:core@31`).
export type VersionRef = { kind: VersionKind; name: string; n: number };

export type RegistryEntry = {
  kind: VersionKind;
  name: string;
  n: number;
  hash: string; // sha256 hex
  content?: string; // 글 component와 criterion, judge일 때만
};

// ---- 참가자와 단계 ----

// 글(place, name)은 call 도구의 `to`가 맞추는 이름과 같다: 앱은 app.name(예 "가계부"), project는 project.name
// (예 "tax"), Operator는 자기 name. 앱의 일은 그 앱의 App Engineer가 맡는다.
export type Participant = Omit<NamedAgent, "role"> & { role: Role };

export type Step =
  | { kind: "say"; to: Participant; text: string } // 사람 말 한 줄
  | { kind: "untilIdle" }; // 진짜 model을 받은 참가자가 모두 쉴 때까지

// 되살린 world. 키는 Participant에 쓰는 이름과 같다.
export type WorldIds = {
  apps: Record<string, Id<"app">>; // app.name → id
  projects: Record<string, Id<"prj">>; // project.name → id
  operators: Record<string, Id<"agt">>; // Operator name → id
};

// 재료를 되살리는 동안의 core와 지금까지 되살린 world.
export type RestoreContext = { core: Core; world: WorldIds };

// ---- check ----

export type CheckOutcome = { pass: boolean; reason: string }; // reason은 한 줄

// check는 trial 기록만 본다. 판단 case check는 끝난 world를 묻지 않는다.
export type CheckInput = { trial: TrialRecord };

export type ProgramCheck = {
  kind: "program";
  id: string;
  run(input: CheckInput): CheckOutcome | Promise<CheckOutcome>;
};

export type JudgeCheck = {
  kind: "judge";
  id: string;
  premise: string[]; // 먼저 통과해야 하는 같은 시나리오 program check id. 하나라도 떨어지면 judge를 부르지 않는다
  criterion: string; // `relay-complete@1`(name@n). parseRef(text, "criterion")로 푼다
  input(input: CheckInput): string | Promise<string>; // judge가 받는 쪼인 입력. 인용은 이 글 안에 있어야 한다
};

export type Check = ProgramCheck | JudgeCheck;

export type Criterion = {
  name: string;
  n: number;
  question: string;
  verdicts: string[]; // 늘 "cannot_tell"을 포함한다
  pass: string[]; // 통과로 치는 verdict. verdicts의 부분집합이고 cannot_tell은 들지 않는다
};

// ---- 시나리오 ----

export type Fixtures = {
  right: TrialRecord[]; // 모든 program check를 통과해야 한다
  wrong: { trial: TrialRecord; fails: string[] }[]; // fails에 적은 program check id가 떨어져야 한다
};

export type Scenario = {
  id: string;
  n: number;
  proposal: boolean; // AGENT-ROLE의 "(제안)" 줄에서 나온 case. 떨어지면 model보다 그 줄이나 지침이 틀렸을 수 있다
  world: string[]; // 재료 `이름@n` 목록. 되살리는 순서는 재료의 needs가 정한다
  real: Participant[]; // 진짜 model을 받는 참가자. 나머지는 model이 없다
  steps: Step[];
  checks: Check[];
  fixtures: Fixtures;
};

// ---- 수집한 기록 ----

export type PlaceName = { kind: "app" | "project"; id: string; name: string }; // name은 app.name이나 project.name

export type CollectedModelCall = {
  call: ModelCallRecord;
  request: unknown | null; // 보낸 body(JSON). 못 읽으면 null
};

export type CollectedToolCall = {
  call: ToolCall;
  input: unknown | null; // turnBodyView tool_call_input의 value
  output: unknown | null; // turnBodyView tool_call_output의 value(ToolResult). output hash가 있을 때만
  body_truncated: boolean; // 둘 중 하나가 64KiB에서 잘렸다
};

export type SentCall = {
  tool_call: string; // tcl_...
  order: number; // 이 session이 보낸 `call` tool call 순서. 0부터
  to: unknown; // `call` 입력의 to 그대로
  reply: CallReply; // 입력의 reply
  body: string; // 입력의 body
  outcome: ToolOutcome | null; // `call` tool call의 outcome. Gate가 막으면 not_executed/denied
  call: string | null; // cal_... tool이 success로 끝났을 때 output.content.call
  state: CallState | null; // output.content.state
  fail_reason: CallFailReason | null; // output.content.fail_reason
  record: AgentCallRecord | null; // callRead 결과. call이 null이거나 행이 없으면 null
  receiver: AgentRef | null; // record.to에서 풀린 받는 agent. 모르면 null
  receiver_session: string | null; // record.receiver_session
  receiver_place: PlaceName | null;
};

export type SessionRecord = {
  session: string;
  agent: AgentRef;
  place: PlaceName | null;
  turns: TurnRecord[];
  model_calls: CollectedModelCall[]; // modelCallList 순서(id 순)
  tool_calls: CollectedToolCall[]; // toolCallList 순서(id 순 = 시간 순)
  sent_calls: SentCall[]; // call은 여기에만 있다
};

// ---- 수치 ----

export type Metrics = {
  tokens: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
    reasoning: number;
    unknown_calls: number;
  };
  input_total: number; // input + cache_read + cache_write (input을 아는 call만)
  cache_hit_rate: number | null; // cache_read / input_total. 분모 0이면 null
  cost_usd: number; // reported·estimated·free 가운데 USD만
  unpriced_calls: number; // 끝났는데 위에 못 든 cost(subscription, unknown, 다른 통화)
  time_ms: { turns: number; model_calls: number };
  tools: {
    counted: number;
    excluded: number;
    format: number;
    success: number;
    blocked: number;
    repeated_calls: number;
    repeat_groups: number;
    max_repeat: number;
    repeated_failure_turns: number;
  };
  truncated_calls: number; // outcome.kind가 partial인 model call
  agent_calls: {
    receiver_role: string | null;
    reply: CallReply;
    state: CallState | null;
    failed: boolean;
  }[];
};

// ---- trial 기록 ----

// timeout이면 아직 시작 안 한 message나 session id를 unstarted에 담는다.
export type Settle = { kind: "idle" | "timeout"; unstarted: string[] };

export type TrialRecord = {
  index: number; // 0부터
  started_at: string; // t0. 되살리기와 model 붙이기가 끝난 뒤 첫 단계 직전
  finished_at: string;
  settle: Settle;
  sessions: SessionRecord[];
  metrics: Metrics; // sessions의 합
};

// ---- judge, run ----

export type JudgeItem = {
  check: string; // JudgeCheck.id
  criterion: string; // `relay-complete@1`
  input: string;
  // pending = program이 쪼인 입력만 두고 아직 채점 전(verdict·quote null, error null). judged = 답이 들어와 검사를 통과했다.
  // error = enum 밖의 답이나 입력에 없는 인용으로 걸러졌다.
  state: "pending" | "judged" | "error";
  model: string | null; // 채점한 model. pending이면 null. 다른 model이 채점한 run은 grader가 다르다
  verdict: string | null; // 채점 전이거나 judge 오류면 null
  quote: string | null;
  quote_found: boolean; // 인용이 input 안에 있나
  judge: string; // `judge@1`
  error: string | null;
};

export type CheckResult = {
  id: string;
  kind: "program" | "judge";
  pass: boolean;
  reason: string;
  pending?: boolean; // 채점 대기인 judge check만 true. pass는 false다. 채점이 들어오면 지우고 pass를 다시 정한다
};

export type TrialResult = {
  index: number;
  settle: Settle;
  checks: CheckResult[];
  judge: JudgeItem[];
  metrics: Metrics;
  components?: VersionRef[]; // 이 trial에서 진짜 model이 본 것. RunRecord.components는 trial 전체의 합집합이라 trial마다는 모른다
  record?: TrialRecord; // 전체 기록(.dev-data/eval)에만 있고 tests/eval/runs의 요약에는 없다
};

export type SourceInfo = {
  commit: string;
  dirty: boolean; // packages, package.json, package-lock.json에 commit 안 된 변경이 있나
  diff?: string; // 전체 기록에만 있다
  untracked?: string[]; // 전체 기록에만 있다
};

export type RunRecord = {
  id: string; // `tests/eval/runs/<id>.json`의 이름이자 `.dev-data/eval/<id>/`의 이름
  started_at: string;
  scenario: VersionRef; // kind "scenario"
  materials: VersionRef[]; // kind "material"
  components: VersionRef[]; // 진짜 model이 본 것. trial 전체의 합집합
  core: VersionRef; // kind "core"
  grader: {
    criteria: VersionRef[]; // kind "criterion"
    judge: VersionRef | null; // kind "judge". judge check가 없으면 null
    checks: VersionRef; // kind "checks". tests/eval/checks 전체의 버전
  };
  model: string; // 요청한 model 이름
  effort?: string; // 요청한 effort. 없으면 catalog 기본값으로 돌았다
  source: SourceInfo;
  trials: TrialResult[];
};

// ---- 재료 ----

// `app`은 앱 source만, `active_app`은 source에 active 표시와 release 이력을 얹은 것이다.
export type MaterialKind = "app" | "project" | "kinds" | "operator";

// `tests/eval/materials/<이름>/<n>/material.json`의 내용이다. 이름과 n은 폴더가 정한다.
export type MaterialManifest = {
  kind: MaterialKind;
  ids: Record<string, string>; // 되살린 뒤에도 같아야 하는 고정 id
  needs: string[]; // 다른 재료 `이름@n`
  content_hash: string;
};

// ---- scorecard ----

export type ScorecardRow = {
  scenario: VersionRef;
  proposal: boolean;
  run: string | null; // 고른 run의 id. 없으면 null
  stale: string[]; // 낡은 이유. 비어 있으면 유효하다
  passed: number; // 통과한 trial 수
  trials: number;
  checks: {
    id: string;
    kind: "program" | "judge";
    passed: number;
    of: number;
    reasons: string[];
  }[];
  metrics: Metrics | null; // trial 전체의 합
};

// ---- constructor ----

export const say = (to: Participant, text: string): Step => ({
  kind: "say",
  to,
  text,
});
export const untilIdle = (): Step => ({ kind: "untilIdle" });

// `kind:name@n`. 예: `material:apps-home@1`, `instruction:lophn@4`, `core:core@31`.
export function refText(ref: VersionRef): string {
  return `${ref.kind}:${ref.name}@${ref.n}`;
}

// refText의 반대. kind를 안 쓴 글(`apps-home@1`)은 두 번째 인자 kind를 쓴다. 형식이 틀리면 throw한다.
// name에는 `:`와 `@`가 들지 않는다고 본다.
export function parseRef(text: string, kind?: VersionKind): VersionRef {
  const at = text.lastIndexOf("@");
  const n = Number(text.slice(at + 1));
  if (
    at < 1 ||
    !Number.isInteger(n) ||
    n < 1 ||
    !/^\d+$/.test(text.slice(at + 1))
  ) {
    throw new Error(`invalid version ref: ${text}`);
  }
  const head = text.slice(0, at);
  const colon = head.indexOf(":");
  if (colon === -1) {
    if (kind === undefined) {
      throw new Error(`version ref needs a kind: ${text}`);
    }
    return { kind, name: head, n };
  }
  const name = head.slice(colon + 1);
  if (colon === 0 || name === "") {
    throw new Error(`invalid version ref: ${text}`);
  }
  return { kind: head.slice(0, colon) as VersionKind, name, n };
}
