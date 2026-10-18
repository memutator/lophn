# ev-contracts

eval 층이 서로 기대는 모양을 `tests/eval/types.ts` 한 file에 고정한다: 시나리오와 case, run record(collector가 내놓는 것), 재료 manifest, scorecard 줄. 코드 로직은 없고 type과 상수뿐이다.

- 단위: ev (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/types.ts`
- 읽을 것:
  - 계획: `project-docs/plan/eval-base/README.md`(정한 것), `project-docs/products/roadmap/eval.md`의 "기초 모양", "공통 수치", "재료", "시나리오", "책임에 따른 call: 작은 판단 case", "case 고르는 규칙"
  - 조사: `project-docs/plan/eval-base/research/coding-agent-eval.md` 4절(record 칸), `reuse-and-materials.md` Part 3(hash)
  - protocol(칸 이름을 그대로 쓴다): `packages/protocol/lophn-agent/{tool-values,tool-calls,model-call-values,model-calls,turn-values,calls,places}.ts`
  - 본보기: `tests/support/core/mod.ts`(`Core`, `Run`), `tests/support/fake-server/types.ts`(`Step`)
  - architecture: `project-docs/architecture/testing.md`
- 계약:
  - 쓰는 것: protocol의 `Role`·`AgentRef`·`ModelChoice` type, `Core`·`Run`, fake server의 `Step`·`FakeServer`
  - 내놓는 것: 아래 "모양". 이후 모든 `ev-*` task가 이 file만 import해서 서로 기댄다.

## 모양

아래를 `tests/eval/types.ts`에 그대로 옮긴다(이름과 칸을 바꾸지 않는다). protocol 값을 다시 정의하지 않고 import해서 쓴다.

```ts
// 1) 대상과 world
// 진짜 model이 붙는 session 주인. 이름으로 가리키고, id는 재료를 되살린 뒤 WorldIds로 푼다.
export type Target =
  | { role: "lophn" }
  | { role: "app_engineer"; app: string }                 // 앱 name
  | { role: "project_manager"; project: string }          // project name(slug)
  | { role: "operator"; name: string; place: { app: string } | { project: string } };
export function targetKey(t: Target): string;             // "lophn", "app_engineer:가계부", "operator:월말정리"
export type WorldIds = {                                  // 재료가 고정한 id. 이름 → id
  apps: Record<string, string>;       // app_
  projects: Record<string, string>;   // prj_
  operators: Record<string, string>;  // agt_
  contexts: Record<string, string>;   // ctx_ (PM이 만든 것이라 되살릴 때마다 다르다)
};

// 2) 시나리오 (작은 판단 case는 steps가 say 하나인 시나리오다)
export type SetupCtx = {
  core: Core; run: Run; fake: FakeServer;
  restoreModel: ModelChoice;          // 되살리기·setup 전용 fake provider의 model. 진짜 model이 아니다
  ids: WorldIds;
};
export type Setup = (ctx: SetupCtx) => Promise<void>;
export type Step = { kind: "say"; to: Target; text: string };   // 이후 계획이 단계를 더한다
export type CheckResult = { pass: boolean; why: string | null }; // why: 떨어진 이유 한 줄(scorecard에 간다)
export type Check = {
  id: string;                         // case 안에서 하나. 예: "calls-ledger-ae"
  describe: string;                   // 사람이 읽는 한 줄
  known_gap?: string;                 // roadmap "찾은 빈틈" 때문에 떨어질 수 있으면 그 이름. 떨어지면 scorecard에 제품 탓으로 따로 적는다
  run(record: RunRecord): CheckResult;  // 순수 함수. core를 부르지 않는다
};
export type Fixture = {               // grader를 돈 쓰기 전에 확인하는 손으로 쓴 record
  record: RunRecord;
  fails?: string[];                   // wrong에서만 쓴다. 이 check들이 떨어져야 한다(비면 안 된다)
};
export type SaveSpec = (ctx: SetupCtx & { record: RunRecord }) => Promise<{
  kind: MaterialKind; needs: string[]; recipe: unknown; files: Map<string, Uint8Array>;
}>;
export type Scenario = {
  id: string;                         // "L4-app", "calendar-mvp"
  world: string[];                    // 재료 "이름@n"
  real: Target[];                     // 진짜 model이 붙는 session. 나머지는 model이 없다
  setup?: Setup[];                    // 재료로 못 하는 준비(grant, 문제, ticket)
  steps: Step[];
  checks: Check[];
  save?: Record<string, SaveSpec>;    // 재료 이름 → 결과를 새 n으로 담는 법
  wrong: Fixture;                     // 떨어져야 하는 record. 모든 case에 필수
  right: Fixture;                     // 모든 check가 통과해야 하는 record. 필수
  trials: number;                     // 기본 반복. 판단 case 3, 사슬 1
  proposal: boolean;                  // AGENT-ROLE "(제안)" 줄에서 나온 case. 떨어지면 지침이나 그 줄이 틀렸을 수 있다(case 규칙 4)
};

// 3) run record: collector가 한 trial에서 읽어 내놓는다. 전체는 git 밖 .dev-data/eval/에 쓴다.
export type TurnRecord = {
  id: string; state: string;
  outcome: { kind: string; reason: string } | null;       // completed|failed|interrupted + reason
  started_at: string; finished_at: string | null; active_ms: number | null;
};
export type ToolCallRecord = {
  id: string; turn: string;
  order: number;                      // session 안 시작 순서(turn 시작 → response_order). 순서 check가 쓴다
  tool: string;                       // ledger 값 그대로. 비교는 "."와 "_"를 같게 본다
  effect: "read" | "write" | "external";
  input_hash: string; input: unknown; // input: turnBodyView(tool_call_input), 못 읽으면 null
  output: unknown | null;             // OUTPUT_TOOLS만 채운다
  outcome: { kind: "success" | "failure" | "not_executed" | "uncertain"; code: string } | null;
  decision: "allow" | "ask" | "deny" | null;
  started_at: string | null; finished_at: string | null; duration_ms: number | null;
};
export const OUTPUT_TOOLS = ["call", "app.create"] as const;   // output 본문을 읽어 담는 tool
export type CallRecord = {            // tool `call` 하나마다 하나
  tool_call: string; turn: string;
  asked: { to: unknown; reply: "none" | "result" | "conversation"; body: string };  // model이 쓴 그대로
  result: { call: string | null; state: string; fail_reason: string | null } | null; // tool 결과. 못 읽으면 null
  record: {                           // calls/read. send 때 실패한 call은 행이 없어 null
    to: { role: string; app?: string; project?: string; operator?: string } | null; // 풀린 받는 agent. app·project는 이름(모르면 id)
    reply: string; state: string; fail_reason: string | null; receiver_session: string | null;
  } | null;
};
export type AskRecord = {             // tool `ask` 하나마다 하나. 질문은 tool 입력에서 읽는다(askRead는 turn이 끝나면 풀린다)
  tool_call: string;
  questions: { question: string; header: string; options: string[]; multiSelect: boolean }[];
};
export type ModelCallRecord = {
  id: string; turn: string; purpose: string; attempt_kind: string;
  outcome: { kind: string; code: string | null; finish_reason: string | null };
  usage: { input: number | null; output: number | null; cache_read: number | null; cache_write: number | null; reasoning: number | null };
  cost: { kind: string; amount: number | null; currency: string | null };
  duration_ms: number | null;
};
export type Metrics = {
  tokens: { input: number; output: number; cache_read: number; cache_write: number; reasoning: number; unknown_calls: number };
  cost: { amount: number; currency: string | null; unknown_calls: number };   // reported+estimated의 합
  time: { turn_ms: number; model_ms: number; tool_ms: number };
  tools: {                            // tool 정확도의 넷(roadmap "공통 수치")
    total: number;                    // 모든 tool call
    excluded: number;                 // 분모에서 뺀 not_executed (EXCLUDED_NOT_EXECUTED)
    format_errors: number;            // failure + code invalid_input|not_found
    success: number;                  // outcome.kind === success
    blocked: number;                  // decision이 ask나 deny
    repeats: number;                  // (tool, input_hash)가 같은 call의 두 번째부터의 수
    repeated_tool_failure: boolean;   // turn outcome.reason === repeated_tool_failure
  };
  truncated: number;                  // outcome.kind === partial인 model 호출 수
  agent_calls: number;                // tool `call`의 수
  model_calls: number;
};
export const EXCLUDED_NOT_EXECUTED = ["stopped", "superseded", "limit_reached", "configuration_revoked", "earlier_call_failed"] as const;
export type SessionRecord = {
  target: Target; session: string;
  turns: TurnRecord[]; tool_calls: ToolCallRecord[]; calls: CallRecord[]; asks: AskRecord[];
  messages: { id: string; from: "human" | "agent"; text: string }[];
  model_calls: ModelCallRecord[];
  metrics: Metrics;
};
export type RunRecord = {
  scenario: string; trial: number; model: string;         // model: "claude-haiku-5-5"나 "fake"
  world: { name: string; n: number; content_hash: string }[];
  env: { lophn_commit: string; sdk_hash: string; template_hash: string };
  ended_by: "completed" | "stopped_on_question" | "spend_cap" | "timeout";
  names: { apps: Record<string, string>; projects: Record<string, string> };  // id → name. 끝난 뒤 읽은 것(run 중 app.create로 생긴 앱 포함)
  sessions: SessionRecord[];
  metrics: Metrics;                   // sessions의 합
};

// 4) 재료
export const MATERIAL_KINDS = ["app_source", "active_app", "app_data", "project", "context", "package", "operator_grant"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export type MaterialRef = `${string}@${number}`;           // "apps-home@1"
export type Manifest = {              // tests/eval/materials/<이름>/<n>/material.json
  name: string; n: number; kind: MaterialKind;
  needs: MaterialRef[];               // 먼저 되살릴 재료
  parent: MaterialRef | null;         // 어느 재료에서 나왔나
  produced_by: { scenario: string; trial: number; lophn_commit: string } | null;
  content_hash: string;               // sha256Hex(bundleBytes(files + recipe)). 계산은 ev-material
  recipe: unknown;                    // 종류별. 아래 Recipe
};
// 종류별 recipe. 고정 id는 여기 있다. 쓰지 않는 종류(active_app, app_data, package)는 unknown으로 둔다.
export type AppSourceRecipe = { apps: { id: string; slug: string; name: string; description: string; source: string | null }[] }; // source: files/ 아래 폴더. null이면 등록만
export type ProjectRecipe = { projects: { id: string; name: string; title: string; purpose: string; folder: string }[] };         // folder: files/ 아래 폴더
export type ContextRecipe = { project: string; name: string; purpose: string; bundle: string };                                    // project: name, bundle: files/ 아래 bundle.json
export type OperatorGrantRecipe = {
  operators: { id: string; name: string; place: { app: string } | { project: string }; body: string; contexts: string[] }[];       // contexts: context name
  grants: { agent: Target; entries: { agent: Target; setting: "excluded" | "never" | "ask" }[] }[];
};

// 5) scorecard 줄: 시나리오 × model
export type ScorecardLine = {
  scenario: string; model: string; trials: number; passed: number;
  proposal: boolean;
  checks: { id: string; passed: number; why: string[]; known_gap: string | null }[];   // why: 떨어진 이유(중복 없이)
  mean: Metrics;                      // trial 평균. tools.repeated_tool_failure는 trial 수
  world: { name: string; n: number; content_hash: string }[];
  env: { lophn_commit: string; sdk_hash: string; template_hash: string };
};
```

## 할 일

1. `tests/eval/types.ts`를 위 모양대로 쓴다. 주석은 "왜"만 쓴다(칸마다 위 설명을 옮기지 않는다).
2. protocol에 이미 있는 값은 import한다(`Role`, `ModelChoice`). `ToolCallRecord.outcome.kind`와 `Metrics.tools`의 근거는 roadmap "공통 수치"의 tool 정확도 넷이다.
3. `targetKey`만 코드이고 나머지는 type과 상수(`OUTPUT_TOOLS`, `EXCLUDED_NOT_EXECUTED`, `MATERIAL_KINDS`)다.
4. 모양을 쓰다 protocol의 실제 칸과 맞지 않는 곳을 찾으면 protocol 쪽을 따라 고치고 "정한 것"에 적는다. 예: `decision` 값, `outcome.code` 문자열, `turn.outcome` 칸 이름.

## 끝남

- `deno task check`가 통과한다(`tests/eval`은 아직 check의 test discovery에 들지 않아도 fmt, lint, type check는 돈다).
- 위험 test: 없음(type과 상수뿐이다).
- 남지 않음: 이 file에 `TODO`가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: protocol 실제 칸에 맞추려고 바꾼 이름
- 계약 바꾸기 요청: 없음(이 task가 계약이다)
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 없음이면 "없음"
