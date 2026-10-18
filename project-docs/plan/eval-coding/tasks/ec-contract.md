# ec-contract

eval-base가 land한 `tests/eval/types.ts`(main 9ddeca36f)에 eval-coding이 필요한 type과 한 줄짜리 constructor를 더한다. 고치는 곳은 아래 "할 일"에 줄 단위로 적은 것뿐이고 나머지는 land한 file 그대로 둔다. type을 넓히면 land한 코드 다섯 곳이 type check에 걸리므로(할 일 12) 그 줄만 최소로 맞춘다.

- 단위: ec-contract (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/types.ts`
  - `tests/eval/checks/validate.ts`
  - `tests/eval/checks/run_test.ts`(새 file)
- 읽을 것:
  - 계획: `project-docs/plan/eval-coding/README.md`(task 표, "정한 것")
  - eval-base(land함): `project-docs/architecture/eval.md`, `tests/eval/types.ts`(이 brief의 "할 일"은 그 file의 줄에 맞춘 것이다), `tests/eval/checks/run.ts`·`validate.ts`·`validate_test.ts`, `tests/eval/restore/manifest.ts`·`mod.ts`, `tests/eval/runner/trial.ts`
  - 설계: `project-docs/products/roadmap/eval.md`의 "참가자", "재료"(종류와 되살리는 길), "시나리오"(꼴, 요구 카드), "공통 수치"(coding agent 열)
  - protocol(import할 것): `packages/protocol/approvals/mod.ts`의 `IntentKind`, `RequestChoice`, `packages/protocol/coding-agent/mod.ts`의 `HarnessId`, `packages/protocol/lophn-agent/ask-tool.ts`의 `AskQuestion`, `AskAnswer`
- 계약:
  - 쓰는 것: land한 `tests/eval/types.ts`와 `tests/eval/checks/`. (main의 `types.ts`는 eval-base의 ev-contract가 만든 것과 byte로 같다.)
  - 내놓는 것: 아래 type과 함수. 이름과 칸이 곧 계약이다. 쓰는 쪽: `ec-driver`(`CodingTrace`), `ec-metrics`(`CodingUsage`, `CodingCommand`, `CodingRecord`), `ec-human`(`HumanSpec`, `ApproveRule`, `HumanRecord`), `ec-restore`(`Save`, `SaveSource`, `MaterialKind`), `ec-checks`, `ec-runner`, `ec-scenarios`.

## 할 일

land한 `tests/eval/types.ts`는 `deno fmt`된 모양이다(칸 설명 주석이 같은 줄 뒤에 붙는다). 새 줄도 같은 모양으로 쓴다.

1. import. 위쪽 type import 묶음에 아래를 더한다.

```ts
import type {
  IntentKind,
  RequestChoice,
} from "../../packages/protocol/approvals/mod.ts";
import type { HarnessId } from "../../packages/protocol/coding-agent/mod.ts";
import type {
  AskAnswer,
  AskQuestion,
} from "../../packages/protocol/lophn-agent/ask-tool.ts";
```

2. 참가자. `Participant`(land한 줄 `export type Participant = Omit<NamedAgent, "role"> & { role: Role };`)는 그대로 둔다. `Role`에 `coding_agent`가 없기 때문이다. 바로 아래에 더한다.

```ts
// coding agent는 앱 하나에 붙는다. place.app은 app.name이다(Participant의 place와 같은 이름 규칙).
// Step.say의 to는 Participant 그대로다(coding agent에게는 말하지 않는다).
export type CodingParticipant = {
  role: "coding_agent";
  place: { app: string };
};

export function isCodingAgent(
  participant: Participant | CodingParticipant,
): participant is CodingParticipant {
  return participant.role === "coding_agent";
}
```

   `Participant | CodingParticipant`를 가르는 곳(ec-human, ec-runner, ec-checks)은 모두 `isCodingAgent`를 쓴다. cast는 없다. 값 export는 파일 아래 "constructor" 절에 둔다(이 함수도 거기로 옮겨도 된다).

3. 단계. land한 `Step`을 이렇게 바꾼다.

```ts
export type Step =
  | { kind: "say"; to: Participant; text: string } // 사람 말 한 줄
  | { kind: "untilIdle" } // 진짜 model을 받은 참가자가 모두 쉴 때까지
  // world에 든 `call` 재료의 본문을 fake lophn 대본이 재료가 가리키는 받는 agent에게 `call`로 보낸다.
  // material은 재료 이름(`calendar-call`)이다. runner가 scenario.world에서 `이름@n`을 찾는다.
  | { kind: "deliver"; material: string }
  // 켜진 앱의 app-api를 사람 자격으로 부른다(`apps/call_api`). app은 app.name이다. 앱이 낸 오류(outcome `failed`)는
  // 단계 실패가 아니다(calendar-diagnose가 bug를 일부러 터뜨린다). `denied`·`unknown`은 던진다.
  | { kind: "callApi"; app: string; api: string; input?: unknown };
```

4. judge check의 `input`. land한 줄 `input(input: CheckInput): string; // judge가 받는 쪼인 입력. 인용은 이 글 안에 있어야 한다`를 바꾼다.

```ts
  input(input: CheckInput): string | Promise<string>; // judge가 받는 쪼인 입력. 인용은 이 글 안에 있어야 한다. 끝난 world를 읽는 입력은 route를 불러 Promise다
```

   이 type을 부르는 쪽은 await한다. `tests/eval/checks/validate.ts`의 judge 입력 확인(land한 코드: `if (c.input({ trial, core: null }).trim() === "") {`)을 `if ((await c.input({ trial, core: null })).trim() === "") {`로 고친다. 그 `try`/`catch`는 그대로다(reject도 "input 오류"로 보고된다). runner의 await(`tests/eval/runner/trial.ts`의 `input: check.input({ trial, core })`)는 type check가 걸리므로 이 task가 `input: await check.input({ trial, core })` 한 줄로 맞춘다(할 일 12). 끝난 world를 읽는 입력은 fixture 확인(`core: null`)에서 route를 부를 수 없으므로 `core === null`일 때 fixture 기록만 읽도록 쓰는 쪽(ec-checks)이 맡는다.

5. `tests/eval/checks/run.ts`의 `runProgramChecks`는 land한 코드가 이미 check를 배열 순서대로 하나씩 `await`한다(`for (const check of checks)` 안의 `await check.run(input)`, 던지면 그 check만 떨어지고 뒤 check는 돈다). 코드는 고치지 않는다. 이 순서에 observation 확인이 기댄다(앞 check가 앱에 실패를 일으켜 world를 바꾼다). 지켜 두려고 `tests/eval/checks/run_test.ts`(새 file)에 test 하나를 쓴다(아래 "끝남").
6. 사람 역할과 save, 시나리오. land한 `Scenario` 위에 더하고(`// \`save\`는 이 계획에 없다(eval-coding이 더한다).` 주석 줄은 지운다), `Scenario`의 `real`을 바꾸고 두 칸을 더한다.

```ts
// 적지 않은 종류는 "reject"다. 규칙에 없는 허락을 소리 없이 주지 않는다.
// 앱 첫 activation은 `activation: "allow"`, Gate가 사람에게 묻는 app-api·MCP tool은 `app_api`·`mcp_tool`에 "once" 등을 적는다.
export type ApproveRule = Partial<Record<IntentKind, RequestChoice>>;

// card는 요구 카드 글이다(roadmap "요구 카드"). 이름@n으로 가리키지 않고 시나리오 file 안에 둔다.
// 시나리오 hash가 시나리오 file로 재어지므로 카드를 고치면 시나리오 n이 오른다. 새 VersionKind가 필요 없다.
export type HumanSpec = { card: string; approve: ApproveRule };

// 시나리오가 끝난 world에서 남길 것. 키는 새 재료 이름(`calendar-app`), 값은 무엇을 남기나.
// 쓰기는 runner가 `tests/eval/materials/<이름>/<n+1>/`에 한다.
export type SaveSource =
  | { kind: "active_app"; app: string } // 켜진 앱: source repo(blueprint 포함)와 manifest, active 표시
  | { kind: "call"; app: string }; // lophn이 그 앱의 App Engineer에게 보낸 첫 call의 본문(SentCall.body)과 받는 쪽
export type Save = Record<string, SaveSource>;
```

   `Scenario`는 이렇게 된다(바뀐 줄만 보인다).

```ts
export type Scenario = {
  // id, n, proposal, world는 그대로
  real: (Participant | CodingParticipant)[]; // 진짜 model을 받는 참가자. 나머지는 model이 없다
  human?: HumanSpec; // 없으면 사람 역할이 없다(판단 case)
  save?: Save; // 없으면 아무것도 남기지 않는다
  // setup, steps, checks, fixtures는 그대로
};
```

   save 종류를 둘로 줄인 이유: 앱 data와 package를 재료로 남기는 시나리오가 없다(calendar-data와 `@me/date-range`는 손으로 쓴 재료다). 필요해지면 그때 더한다.

7. 재료 종류. land한 줄 `export type MaterialKind = "app" | "project" | "context" | "operator"; // eval-coding이 더한다`를 이렇게 바꾼다. `app`은 앱 source만, `active_app`은 source에 active 표시와 release 이력을 얹은 것이다.

```ts
export type MaterialKind =
  | "app"
  | "project"
  | "context"
  | "operator"
  | "active_app"
  | "app_data"
  | "package"
  | "call";
```

8. coding agent와 사람 역할의 기록. "수치" 절 `Metrics` 정의 아래에 더한다. coding agent는 세 층이다: `CodingTrace`는 `ec-driver`가 찍고, `CodingUsage`·`CodingCommand`는 `ec-metrics`가 만들고, `CodingRecord`는 `ec-metrics`의 `codingRecordOf`가 합친다.

```ts
export type CodingEnd =
  | "exited"
  | "killed"
  | "host_lost"
  | "timeout"
  | "no_session_start"
  | "open_failed";

// driver가 찍는 것. 시각은 Clock.now() 형식이다.
export type CodingTrace = {
  session: string; // ses_... (터미널 plan의 session)
  app: string; // app_...
  ticket: string; // tkt_...
  harness: HarnessId; // 이 계획에서는 "claude"만
  cwd: string; // 앱 source 폴더
  command_log: string; // `lophn` wrapper 기록 file의 절대 경로(아래 형식)
  attach_socket: string; // 사람이 이 session의 화면을 보는 unix socket 경로(`deno task eval:attach`). session이 끝나면 지워진다
  human_input: boolean; // 사람이 `--write`로 붙어 키를 넣었다. 그 trial은 사람이 끼어든 것이다
  opened_at: string | null; // open 요청이 ok로 끝난 시각. spawn이 실패하면 null
  reported_at: string | null; // ticket이 reported가 된 것을 처음 본 시각
  ended_at: string | null; // process가 끝난 시각
  end: CodingEnd | null; // 아직 살아 있으면 null
  exit_code: number | null;
  tail: string; // 끝났을 때 터미널 출력의 마지막 4000자(제어 문자를 뺀 글). 전체 기록에만 남는다
};

// wrapper 기록 한 줄: `<ISO 시각>\t<arg1>\t<arg2>\t<arg3>\n`. 없는 인자는 빈 칸이다.
// hook 호출(`hook claude Stop`)도 같은 file에 적힌다.
export type CodingCommand = { at: string; name: string }; // name은 hook이 아닌 명령의 첫 두 단어(`ticket report`, `message send`)

// Claude Code의 session JSONL(message.usage, tool_result)에서 읽은 것. 비용은 세지 않는다(사람).
export type CodingUsage = {
  files: number; // 읽은 jsonl 수(session + subagent)
  models: string[]; // message.model의 고유값, 정렬
  api_calls: number; // message.id 중복을 뺀 assistant 응답 수
  input: number; // input_tokens
  output: number; // output_tokens
  cache_read: number; // cache_read_input_tokens
  cache_write: number; // cache_creation_input_tokens
  input_total: number; // input + cache_read + cache_write
  cache_hit_rate: number | null; // cache_read / input_total. 분모 0이면 null
  tool_results: number; // tool_result 블록 수
  tool_errors: number; // 그중 is_error:true
  tool_error_rate: number | null; // tool_errors / tool_results. 분모 0이면 null
};

export type CodingRecord = Omit<CodingTrace, "command_log" | "attach_socket"> & {
  usage: CodingUsage | null; // JSONL을 못 읽으면 null
  usage_error: string | null; // 못 읽은 이유 한 줄
  commands: CodingCommand[]; // 시각 순서
  message_send: number; // commands 가운데 `message send`의 수
  permission_requests: number; // wrapper 기록의 `hook claude PermissionRequest` 수. 사람이 없는 터미널에서 permission 물음이 떴다는 기록이다
};

// run 요약(commit)에는 터미널 글을 넣지 않는다. `human_input`은 요약에도 남는다(사람이 끼어든 run을 가려내야 하기 때문이다).
export type CodingSummary = Omit<CodingRecord, "tail">;

// 사람 역할이 한 일. 모양의 출처는 ec-human이다(model, 정의 버전, 답한 질문, 허락 결정).
export type HumanRecord = {
  model: string; // 쓴 model (human.json)
  definition: string; // `human@<n>` (human.json의 n)
  answers: {
    at: string; // Clock
    session: string;
    tool_call: string;
    questions: AskQuestion[]; // askRead로 읽은 질문 전부
    answers: AskAnswer[]; // 낸 답
    error: string | null; // 모델 호출 오류(default로 채웠으면 이유), askAnswer 오류
    cost_usd: number;
  }[];
  decisions: {
    at: string;
    path: "turn" | "pending";
    session: string | null;
    request: string;
    kind: IntentKind; // intent.kind
    target: unknown; // intent.target 그대로
    choice: string; // once | allow | reject
    rule: RequestChoice | null; // 시나리오 규칙. null이면 규칙 없음
    error: string | null;
  }[];
  cost_usd: number; // answers[].cost_usd의 합
};

// run 요약(commit)에는 답 글을 넣지 않는다.
export type HumanSummary = {
  answered: number; // answers의 수
  fallback: number; // answers 가운데 error가 있는 것(default로 채운 답)
  decisions: number; // decisions의 수
  cost_usd: number;
};
```

   `HumanRecord`의 칸은 `ec-human.md` 할 일 5에 있는 모양이다. 달라진 곳이 있으면 `ec-human`의 것을 따르고 보고에 적는다.

9. 기록 칸. land한 `TrialRecord`와 `TrialResult`의 끝에 선택 칸을 더한다(coding agent가 없는 시나리오와 eval-base의 fixture가 그대로 유효해야 한다).

```ts
export type TrialRecord = {
  // ... land한 칸 그대로
  coding?: CodingRecord[]; // coding session마다 하나
  human?: HumanRecord; // 사람 역할이 있는 시나리오만
};

export type TrialResult = {
  // ... land한 칸 그대로
  coding?: CodingSummary[];
  human?: HumanSummary;
};
```

10. constructor. "constructor" 절(`say`, `untilIdle` 아래)에 더한다.

```ts
export const codingAgent = (app: string): CodingParticipant => ({
  role: "coding_agent",
  place: { app },
});
export const deliver = (material: string): Step => ({
  kind: "deliver",
  material,
});
export const callApi = (app: string, api: string, input?: unknown): Step =>
  input === undefined
    ? { kind: "callApi", app, api }
    : { kind: "callApi", app, api, input };
export const activeApp = (app: string): SaveSource => ({
  kind: "active_app",
  app,
});
export const sentCall = (app: string): SaveSource => ({ kind: "call", app });
```

11. file 위 관례 주석에 한 줄을 더한다: "`Metrics`는 role agent만 센다. coding agent의 token은 `TrialRecord.coding`에 있고 둘을 더하지 않는다(CLI 기록이라 칸이 반쯤만 겹친다)."
12. land한 코드를 최소로 맞춘다(type을 넓히면 `deno task check`가 깨지는 곳이다. 다른 task의 file이지만 wave 1이라 겹치지 않는다. 이 줄들만 고치고 "넘길 줄"에 적는다).
    - `tests/eval/restore/manifest.ts`의 `ID_PREFIX`(`as const satisfies Record<MaterialKind, string>`): 새 종류 넷을 `active_app: "app"`, `app_data: "app"`, `package: "app"`, `call: "app"`로 더한다(`idSchema(prefix)`가 칸 하나를 요구한다. `ec-restore`가 종류마다 맞게 바꾼다).
    - `tests/eval/restore/mod.ts`의 `restoreOne`(`switch (material.manifest.kind)`가 `Promise<Result<void>>`를 돌려준다): 새 종류 넷의 `case`를 모아 `return err({ code: "unavailable", message: \`material kind ${material.manifest.kind} is restored by ec-restore\` })`를 더한다(`err`를 `packages/base/mod.ts` import에 더한다. 지금은 `ok, type Result`만 가져온다).
    - `tests/eval/runner/trial.ts`: `real: scenario.real.map((p) => agentRefOf(ctx.world, p))`를 `real: scenario.real.filter((p): p is Participant => !isCodingAgent(p)).map((p) => agentRefOf(ctx.world, p))`로, `input: check.input({ trial, core })`를 `input: await check.input({ trial, core })`로 고친다(`Participant`, `isCodingAgent`를 `../types.ts`에서 import). coding agent에게는 agent 층 model을 붙이지 않는다(CLI가 자기 login으로 돈다).
    - 그 밖에 type check가 걸리는 곳이 있으면 같은 방식으로 최소로 맞춘다.
13. 그 밖의 칸은 건드리지 않는다. 칸을 더 늘리거나 줄여야 하면 고치지 말고 "계약 바꾸기 요청"에 적는다. protocol import 이름이 실제 export와 안 맞으면 export 이름에 맞게 고치고 보고에 적는다.

## 끝남

- `deno task check`가 통과한다. 판단 case 17개의 시나리오와 fixture, `tests/eval/**`의 기존 test가 새 type으로도 통과한다.
- 위험 test: "`runProgramChecks`는 check를 배열 순서대로 하나씩 돌고(앞 check가 바꾼 상태를 뒤 check가 본다), 앞 check가 던져도 뒤 check가 돈다." (`run_test.ts`. 가짜 program check 셋: 첫째가 공유 변수를 바꾸고, 둘째가 그 변수를 읽어 통과하고, 셋째가 던진다. 순서가 깨지면 observation 확인이 조용히 틀려진다. 그 밖의 type과 constructor는 test하지 않는다.)
- 위 type과 `isCodingAgent`, `codingAgent`, `deliver`, `callApi`, `activeApp`, `sentCall`이 export된다.
- `types.ts`에 `HumanRole`을 만들지 않는다(그 이름은 ec-human의 runtime handle type이다. `types.ts`의 것은 `HumanSpec`·`HumanRecord`·`HumanSummary`).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
