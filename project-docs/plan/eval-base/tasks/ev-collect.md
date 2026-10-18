# ev-collect

trial이 끝난 core에서 제품 읽기 route로 session, turn, model call, tool call, call을 읽어 `SessionRecord`로 모으고, roadmap "공통 수치"를 `Metrics`로 계산하고, 전체 기록을 `.dev-data/eval/`에 쓴다. 진짜 provider도 core도 띄우지 않는다. 읽기 port를 인자로 받는다.

- 단위: ev-collect (wave 2)
- 선행: ev-contract
- 소유(이 task만 고친다):
  - `tests/eval/collect/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/eval.md`의 "공통 수치", "run", "지켜야 할 것"(record 전체는 `.dev-data/eval/`)
  - architecture: `project-docs/architecture/agent-call.md`(call의 모양, 실패가 두 길로 나온다는 것), `project-docs/architecture/testing.md`(`tests/support/core`)
  - 읽는 route 정의(모두 `packages/protocol/lophn-agent/`):
    - `agent-sessions.ts`: `agentSessionRead`
    - `turns.ts`·`turn-reads.ts`: `turnList`, `turnBodyView`
    - `model-calls.ts`·`model-call-values.ts`: `modelCallList`, `ModelCallRecord`, `TokenUsage`, `CallCost`, `ModelOutcome`
    - `tool-calls.ts`·`tool-values.ts`: `toolCallList`, `ToolCall`, `ToolOutcome`
    - `calls.ts`: `callRead`, `AgentCallRecord`, `CallReply`, `CallState`, `CallFailReason`
    - `ask-tool.ts`: `askInputSchema`(질문은 `ask` tool call의 입력에서 읽는다)
    - `places.ts`: `AgentRef`
  - 이름 풀기: `packages/protocol/apps/apps.ts`의 `appList`, `packages/protocol/projects/project-routes.ts`의 `projectList`
  - 본보기: `tests/support/core/mod.ts`의 `Core`(`tryCall`), `tests/e2e/call-gate_test.ts`(`toolCallList`로 `call` tool을 읽는 길)
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`(ev-contract)가 내놓는 `Metrics`, `SessionRecord`와 그 안의 `PlaceName`, `CollectedToolCall`, `CollectedModelCall`, `SentCall`. 모양은 아래 "기대하는 모양"이고 계획의 확정된 계약(`types.ts`)과 같다. `TrialRecord`(runner가 `sessions`와 `sumMetrics` 결과를 담는다)는 이 task가 만들지 않는다.
    - protocol의 읽기 route와 type은 위 "읽을 것"의 이름 그대로 import한다. 다시 정의하지 않는다.
    - `tests/support/core/mod.ts`의 `type Core`. 이 task는 `Pick<Core, "tryCall">`만 받는다(`ReadPort`).
  - 내놓는 것(`tests/eval/collect/mod.ts`가 다시 내보낸다):
    - `collectSessions(deps: { port: ReadPort; readBlob?: BlobReader }, roots: string[], since: string): Promise<SessionRecord[]>`: root session(runner가 연 것)에서 시작해 남은 `SentCall.record.receiver_session`을 따라가며(받는 쪽이 새로 연 session) 닿는 session을 모두 읽는다. `since`는 `TrialRecord.started_at`(t0, 되살리기와 setup이 끝난 직후)이다. `since`보다 먼저 시작한 turn과 그 turn의 model call·tool call은 기록에서 뺀다(되살리기·setup이 남긴 기록이 섞이지 않게 한다). 읽을 수 없는 session(`agentSessionRead`가 `not_found`, 예: coding session)은 건너뛴다.
    - `type BlobReader = (hash: string) => Promise<Uint8Array | null>`, `diskBlobReader(home: string): BlobReader`
    - `metricsOf(session: SessionRecord): Metrics`, `sumMetrics(list: Metrics[]): Metrics`, `toolRates(tools: Metrics["tools"]): { format: number | null; success: number | null; blocked: number | null }`
    - `writeFullRecord(dir: string, run: string, trial: number, value: unknown): Promise<string>`: `<dir>/<run>/trial-<trial>.json`을 쓰고 경로를 돌려준다. runner가 `dir`을 `.dev-data/eval`로 준다.

### 기대하는 모양(ev-contract가 `tests/eval/types.ts`에 고정한다)

```ts
import type { AgentCallRecord, AgentRef, CallFailReason, CallReply, CallState,
  ModelCallRecord, ToolCall, ToolOutcome, TurnRecord } from "../../packages/protocol/lophn-agent/mod.ts";

type PlaceName = { kind: "app" | "project"; id: string; name: string }; // name은 app.name, project.name

type CollectedModelCall = { call: ModelCallRecord; request: unknown | null }; // request는 보낸 body(JSON). 못 읽으면 null
type CollectedToolCall = {
  call: ToolCall;
  input: unknown | null;   // turnBodyView tool_call_input의 value
  output: unknown | null;  // turnBodyView tool_call_output의 value(ToolResult). output hash가 있을 때만
  body_truncated: boolean; // 둘 중 하나가 64KiB에서 잘렸다
};

type SentCall = {
  tool_call: string;          // tcl_...
  order: number;              // 이 session이 보낸 `call` tool call 순서. 0부터
  to: unknown;                // `call` 입력의 to 그대로
  reply: CallReply;           // 입력의 reply
  body: string;               // 입력의 body
  outcome: ToolOutcome | null;       // `call` tool call의 outcome. Gate가 막으면 not_executed/denied
  call: string | null;               // cal_... tool이 success로 끝났을 때 output.content.call
  state: CallState | null;           // output.content.state
  fail_reason: CallFailReason | null; // output.content.fail_reason
  record: AgentCallRecord | null;    // callRead 결과. call이 null이거나 행이 없으면 null
  receiver: AgentRef | null;         // record.to에서 풀린 받는 agent. 모르면 null
  receiver_session: string | null;   // record.receiver_session
  receiver_place: PlaceName | null;
};

type SessionRecord = {
  session: string;
  agent: AgentRef;
  place: PlaceName | null;
  turns: TurnRecord[];
  model_calls: CollectedModelCall[];  // modelCallList 순서(id 순)
  tool_calls: CollectedToolCall[];    // toolCallList 순서(id 순 = 시간 순)
  sent_calls: SentCall[];
};

type Metrics = {
  tokens: { input: number; output: number; cache_read: number; cache_write: number;
            reasoning: number; unknown_calls: number };
  input_total: number;            // input + cache_read + cache_write (input을 아는 call만)
  cache_hit_rate: number | null;  // cache_read / input_total. 분모 0이면 null
  cost_usd: number;               // reported·estimated·free 가운데 USD만
  unpriced_calls: number;         // 끝났는데 위에 못 든 cost(subscription, unknown, 다른 통화)
  time_ms: { turns: number; model_calls: number };
  tools: { counted: number; excluded: number; format: number; success: number; blocked: number;
           repeated_calls: number; repeat_groups: number; max_repeat: number;
           repeated_failure_turns: number };
  truncated_calls: number;        // outcome.kind가 partial인 model call
  agent_calls: { receiver_role: string | null; reply: CallReply;
                 state: CallState | null; failed: boolean }[];
};
```

## 할 일

1. `tests/eval/collect/blob.ts`: request body 읽기.
   - model call의 요청 body(`model_call_input` blob)를 읽는 제품 route는 없다. `blob.read`는 `model_call/input` field를 `general_read: false`로 막고(`packages/core/lophn-agent/usage/commands.ts`의 `modelCallBodyFields`), `turnBody`의 kind에도 없다. 새 route나 제품 flag를 만들지 않는다.
   - 그래서 `diskBlobReader(home)`가 trial의 data root(`Run.home`)에서 파일을 직접 읽는다. 경로는 `packages/core/storage/blobs/model.ts`의 `objectPathFor(root, hash)`(`<root>/blobs/sha256/<hash 앞 2자>/<나머지 62자>`)와 같다. `objectPathFor`를 import하거나, import가 무거우면 두 줄을 복사한다(이유를 주석으로).
   - 읽은 byte의 sha256(`packages/base`의 `sha256Hex`)이 `hash`와 다르거나 파일이 없으면 `null`이다. `request`는 byte를 UTF-8로 읽어 `JSON.parse`한 값이고, 파싱이 안 되면 `null`이다.
2. `tests/eval/collect/read.ts`: `collectSessions`.
   - `ReadPort.tryCall` 결과를 푸는 작은 helper를 둔다. 오류면 `route.name: code: message`로 던진다. 다만 `agentSessionRead`·`callRead`·`turnBodyView`의 `not_found`는 각각 "건너뜀", `record: null`, `null`로 받는다.
   - session마다:
     - **t0 자르기**: `turnList`가 준 turn 가운데 `Date.parse(started_at) < Date.parse(since)`인 것은 버린다. 버린 turn의 id를 가진 model call과 tool call도 버린다(`turn`이 null인 요약 model call은 자기 `started_at`이 `since`보다 앞서면 버린다). 버린 tool call에서 `sent_calls`를 만들지 않고, 따라서 거기서 `receiver_session`을 따라가지도 않는다.
     - `agentSessionRead` → `agent`. `place`는 `agent.role`에 따라 `app_engineer`는 `app`, `project_manager`는 `project`로 `appList`·`projectList`(trial에서 한 번만 읽어 캐시)에서 id로 이름을 찾는다. Operator는 `place: null`.
     - `turnList({ session })`, `modelCallList({ session })`, `toolCallList({ session, limit: 100 })`을 `next_cursor`가 null일 때까지 이어 읽는다.
     - 각 model call: `readBlob`이 있으면 `call.input`을 읽어 `request`. 없으면 `null`.
     - 각 tool call: `call.input`(hash)이 있으면 `turnBodyView({ kind: "tool_call_input", id })`, `call.output`이 null이 아니면 `{ kind: "tool_call_output", id }`. `truncated`면 `body_truncated`.
   - `sent_calls`: `tool === "call"`인 tool call마다 하나. 단 같은 id를 `retry_of`로 가리키는 다른 행이 있는 행(재시도에 밀린 것)은 뺀다.
     - `to`, `reply`, `body`는 입력에서, `call`·`state`·`fail_reason`은 `output.content`에서 읽는다(success일 때만 있다. `call` tool은 배달 실패도 success로 끝난다).
     - `call`이 있으면 `callRead`로 `record`. `record.to`가 `new_session`·`open_session_or_new`면 `receiver = to.agent`, `open_session`이면 받는 session의 `agentSessionRead`로 푼 agent. `receiver_session`은 `record.receiver_session`.
     - `receiver_place`는 receiver에서 위와 같이 이름을 푼다.
   - 이어 읽기: `receiver_session`이 아직 안 읽은 session이면 목록에 더한다(visited 집합). 받는 쪽은 model이 없으면 turn이 0개라 싸다.
3. `tests/eval/collect/metrics.ts`: `metricsOf`, `sumMetrics`, `toolRates`. 정의는 아래 "정한 것"의 숫자 규칙 그대로 구현한다.
   - `sumMetrics`는 칸을 더하고 `cache_hit_rate`는 더한 `cache_read`와 `input_total`에서 다시 계산한다(비율을 평균 내지 않는다). `max_repeat`는 max다.
4. `tests/eval/collect/store.ts`: `writeFullRecord`. 폴더를 만들고(`recursive`) 들여쓴 JSON으로 쓴다. `dir`은 인자다.
5. `tests/eval/collect/mod.ts`: 위 "내놓는 것"을 내보낸다.
6. test 둘(아래 "끝남").

## 정한 것(roadmap·README와 달라진 곳 포함)

- **token 정규화(roadmap 문장과 다르다).** 저장된 `usage.input`은 어떤 adapter에서든 cache를 뺀 새 입력이다. Anthropic Messages adapter(`providers/adapters/messages.ts`)는 API가 주는 `input_tokens`를 그대로 두고 `cache_in_input: false`, OpenAI responses·chat adapter는 `cached`를 이미 빼고 `cache_in_input: true`다. 과금 계산도 `new input + cache_read + cache_write`로 더한다(`packages/core/lophn-agent/usage/cost.ts`의 `chargedTokens`). 그래서 `cache_in_input`은 provider가 보고한 모양일 뿐이고, 이 task는 그 값으로 빼거나 더하지 않는다. `input_total = input + (cache_read ?? 0) + (cache_write ?? 0)`.
- **cache hit rate** = `Σ cache_read / Σ input_total`. 대상은 `state === "finished"`이고 `usage.input !== null`인 model call 전부(judgment 말고 요약 call도 든다. 돈과 token은 실제로 든다). `usage.input`이 null인 call은 token 합에 아무것도 더하지 않고 `tokens.unknown_calls`만 올린다. `cache_read`·`cache_write`·`output`·`reasoning`의 null은 0으로 더한다. 분모가 0이면 `null`.
- **cost**: `cost.kind`가 `reported`·`estimated`·`free`이고 `currency === "USD"`인 call의 `amount`(십진 문자열)를 `Number`로 더한다. 끝났는데(`state === "finished"`) 그 밖인 call은 `unpriced_calls`로 센다. 시작만 한 call은 무시한다. judge 비용은 여기에 없다(ev-judge, runner가 따로 적는다).
- **시간**: `time_ms.turns` = 끝난 turn의 `finished_at - started_at` 합(`Date.parse`), `time_ms.model_calls` = `duration_ms` 합(null은 0).
- **tool 정확도**(roadmap "공통 수치"). 대상 행은 "재시도에 밀리지 않은" tool call이고 `state === "finished"`인 것만이다(`outcome !== null`).
  - 분모(`counted`)에서 빼는 것(`excluded`): `outcome.kind === "not_executed"`이고 `code`가 `denied`·`rejected`가 아닌 것. roadmap이 든 다섯(`stopped`, `superseded`, `limit_reached`, `configuration_revoked`, `earlier_call_failed`)에 코드에서 더 나오는 `cancelled`(요청이 취소됨)를 더한다. model 탓이 아니라서다.
  - `format`: `kind === "failure"`이고 `code`가 `invalid_input` 또는 `not_found`. 한계: schema가 거절한 것과 handler가 낸 것을 못 가른다(roadmap에 이미 적힘).
  - `success`: `kind === "success"`.
  - `blocked`: `decision?.decision`이 `deny` 또는 `ask`이거나, `not_executed`이고 `code`가 `denied`·`rejected`. (같은 call이 `success`와 `blocked`에 같이 들 수 있다. 사람에게 물어 허락받고 성공한 경우다.)
  - `uncertain`은 분모에는 들고 어느 칸에도 안 든다.
  - 되풀이: session 안에서 (`tool`, `call.input` hash)가 같은 행을 묶는다. 크기 2 이상인 묶음 수가 `repeat_groups`, 묶음마다 `크기 - 1`의 합이 `repeated_calls`, 가장 큰 크기가 `max_repeat`. `repeated_failure_turns`는 `outcome.reason === "repeated_tool_failure"`인 끝난 turn 수. 같은 입력은 같은 hash다(입력 blob이 canonical JSON이다).
- `toolRates`는 `counted`가 0이면 셋 다 `null`, 아니면 각각 `/counted`.
- `truncated_calls` = `outcome?.kind === "partial"`인 model call 수.
- `agent_calls`는 `sent_calls`마다 하나다. `receiver_role` = `receiver?.role ?? (to에 role이 있으면 그 role) ?? null`, `failed` = `outcome`이 success가 아니거나 `state === "failed"`.
- **model이 없는 참가자**의 turn은 시작하자마자 `failed` / `configuration_unavailable`(`model_required`)로 끝난다. 정상이다. 그 turn은 model call이 없고 오류로 다루지 않는다(세지도, 던지지도 않는다). 기록에는 그대로 남고 `repeated_failure_turns`에도 들지 않는다(reason이 `repeated_tool_failure`일 때만 센다).
- tool 입력·출력 body는 모든 tool call에서 읽는다(호출 수가 몇 개 안 된다. 가장 단순하다). `ask` 질문 글, `call` 본문, `app.create`가 만든 앱 id(`output.content.id`)를 check와 judge 입력이 여기서 쓴다.
- `ask`의 질문 글은 `askRead`(메모리 route, 대기 중에만 읽힘)가 아니라 `ask` tool call의 입력(`askInputSchema`)에서 읽는다. 그래서 `SessionRecord`에 `asks` 칸이 없다.
- 실패한 tool call의 안내 글(`result.summary`)을 읽는 route는 없다. output blob은 success일 때만 남는다. 실패는 `outcome.code`로만 안다.
- `callList` 같은 call 목록 route는 없다. call은 보낸 쪽의 `call` tool call에서 찾고, 받는 쪽은 `callRead`로 푼다. Gate가 grant `excluded`로 막은 call은 `call` id도 `agent_calls` 행도 없이 `outcome: not_executed/denied`로만 남는다. 이름을 못 푼 call도 행이 없다(`project-docs/architecture/agent-call.md`).
- 재시도에 밀린 행 판정(`retry_of`가 이 행의 id인 다른 행이 있다)은 ev-checks에도 같은 규칙으로 따로 있다. 세 줄이라 공유 module을 만들지 않는다.
- `cost_usd`를 십진 정수로 안 더하고 `Number`로 더한다. 몇 달러 이하에 6자리라 어긋남이 무시할 만하다.

## 끝남

- `deno task check`가 통과한다. `tests/eval`의 `*_test.ts`도 check에서 돈다. 그래서 test는 순수해야 한다(core 부팅, subprocess, 네트워크, 진짜 provider 없음).
- 위험 test: "Anthropic 모양(`cache_in_input: false`)과 OpenAI 모양(`true`) usage가 같은 숫자에서 같은 `input_total`과 cache hit rate를 내고 cache가 두 번 빠지지 않으며, `denied` 같은 막힘은 tool 분모에 들고 `stopped` 같은 미실행은 분모에서 빠진다." (`metrics_test.ts`, 손으로 만든 `SessionRecord` 표 하나)
- 위험 test: "Gate가 막은 call(`not_executed/denied`)과 새 session에 간 call이 `sent_calls`에 보낸 쪽 기준 순서와 받는 쪽·답 방식·실패로 남고, `since`보다 먼저 시작한 turn(되살리기 흔적)과 그 안의 call은 기록에 남지 않는다." (`read_test.ts`, `tryCall`을 route 객체 비교로 흉내 내는 fake port. core를 띄우지 않는다)
- 새 subprocess·서버·진짜 provider 호출 test는 없다.
- 남지 않음: `grep -rn "cache_in_input" tests/eval/collect`는 주석과 test fixture에만 나온다(계산에 쓰지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 위 "정한 것" 밖에서 worker가 정한 것
- 넘길 줄: 남의 file을 맞춘 곳(없어야 한다)
- 계약 바꾸기 요청: `types.ts`의 `Metrics`·`SessionRecord`가 위 모양과 달라 막히는 곳
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: request body를 disk에서 직접 읽는다(제품 route 없음). `blobs/sha256` 배치가 바뀌면 깨진다. 실패한 tool call의 안내 글은 못 읽는다. coding session은 건너뛴다(`eval-coding`).
