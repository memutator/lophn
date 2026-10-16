# contract-app-calls-ports

`core/apps`의 새 module들이 서로 기대는 port를 type만으로 고정한다. wave 3의 app-calls-* task는 이 port와 가짜 구현으로 짓고, 서로의 구현을 기다리지 않는다.

- 단위: contract-app-calls (wave 2)
- 선행: contract-app-calls-api (port가 `protocol/apps/calls`의 type을 쓴다), contract-approvals (Gate 입력·판정 type을 쓴다)
- 소유(이 task만 고친다):
  - `packages/core/apps/ports.ts` (새 file)
- 읽을 것:
  - spec: S5 2~8장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`, S7 7장(drain을 activation과 같이 쓴다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`, S8 4장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: 이 task 몫 줄은 없다. port를 쓰는 줄은 `I3.5#1`~`I3.5#17`, `I2.7#9`(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #3(Gate는 core 한 곳), #7, #8, #51
  - 지금 코드: `packages/core/apps/tickets/ports.ts`(port 이름과 주석의 본보기), `packages/core/apps/runtime/supervisor-link.ts`(`ProcessSource`)
  - 새 file: `packages/protocol/apps/calls/*`(contract-app-calls-api), `packages/core/approvals/ports.ts`(contract-approvals)
- 계약:
  - 쓰는 것: `protocol/apps/calls`의 `AppApiCallInput`·`AppApiCallOutput`·`AppInvocation`·`AppApiCaller`·`ProcessCallRequest`·`ProcessCallResponse`·`ProcessApplyRequest`·`ProcessApplyResponse`·`RewindPlan`·`Rewind`·`ProjectSummary`·`AppApiTarget`, contract-approvals가 정한 Gate 입력(intent)과 판정 type(`Intent`, `GateVerdict`, `Approvals`. 이름은 그 file을 따른다), `base/mod.ts`의 `Result`
  - 내놓는 것: 아래 interface. 구현하는 task는 괄호 안과 같다.

## 할 일

`packages/core/apps/ports.ts`에 interface와 type만 둔다. 함수 본문과 값이 없다. 각 interface 위에 한국어 한두 줄 주석으로 "누가 구현하고 누가 쓰는지"를 적는다.

1. `AppApiCallPath` (구현: app-calls-path / 쓰는 곳: `app.call_api` route handler(app-calls-assembly), 앱 process의 broker 서비스)
   - `call(input: AppApiCallInput, auth: {actor: "user" | "agent" | "app"; app?: AppId}): Promise<Result<AppApiCallOutput>>`. `auth`는 route가 확인한 credential이다. 부른 쪽 확인(S5 4장 1), project 정하기, Gate, invocation 기록, write 줄 세우기, 앱 process 전달, 결과를 모두 이 호출 하나가 한다.
2. `CallerDirectory` (구현: lead 조립. places-sessions의 session 읽기 / 쓰는 곳: app-calls-path)
   - `agentToolCall(session, turn, tool_call): Result<{agent: string; place: {kind: "project"; project: ProjectId} | {kind: "app"; app: AppId} | {kind: "lophn"}} | null>` — 그 tool call이 지금 도는 turn의 것인지 확인하고, 그 agent가 놓인 곳을 준다. 없으면 null.
3. `ProjectDirectory` (구현: lead 조립. projects module의 읽기 / 쓰는 곳: app-calls-path, `app.projects` handler)
   - `list(): Result<readonly ProjectSummary[]>`, `get(id): Result<ProjectSummary | null>`
4. `AppApiLookup` (구현: app-calls-assembly. `core/apps/blueprint` 읽기 / 쓰는 곳: app-calls-path)
   - `find(app, release | null, api): Result<{release: ReleaseId; effect: "read" | "write" | "external"; project_scope: boolean} | null>` — 활성 release(또는 고정 release)의 blueprint 선언. 없는 app-api는 null.
5. Gate는 port를 새로 만들지 않는다. contract-approvals가 `core/approvals/ports.ts`에 둔 `Approvals`(`judge`, `openTurnRequest`, `waitTurnDecision`, `consumeTurnAllow`)를 app-calls-path가 직접 import한다. 이 file에는 호출 경로가 그것을 부르는 순서만 주석으로 적는다: `judge(intent)`가 `deny`면 `denied(gate_blocked)`, `ask`면 `openTurnRequest` → `waitTurnDecision`(reject는 `denied(rejected)`, cancelled는 `denied(cancelled)`), 허락이면 실행 직전 `consumeTurnAllow`. intent는 `{kind: "app_api", actor: agent | app, target: {app, api}, effect, input, origin}`이다. 사람 화면(`person`)은 Gate를 거치지 않는다(S2 5장). 앱이 부른 호출은 `origin`에 맞는 값이 contract-approvals의 `intentOriginSchema`에 없으면 보고한다.
6. `InvocationLedger` (구현: app-calls-invocations / 쓰는 곳: app-calls-path, app-calls-rewind, releases-problems의 activation, places-sessions의 session rewind)
   - `begin(input: Omit<AppInvocation, "status" | "finished_at" | "changeset" | "reverted_by" | "summary" | "detail_hash">): Result<AppInvocation>` — write·external·앱 시작은 시작을 미리 남긴다.
   - `finish(id, result: {status: "succeeded" | "failed" | "unknown"; finished_at; summary; detail_hash: string | null; changeset: Uint8Array | null}): Promise<Result<AppInvocation>>` — changeset 저장(blob)은 구현이 한다.
   - `recordOnce(input: <AppInvocation 전체>): Promise<Result<AppInvocation>>` — 시작을 미리 남기지 않는 읽기가 실패했을 때와 `denied`를 끝에서 한 번에 남긴다(S5 5장).
   - `get(id): Result<AppInvocation | null>`, `list(filter: <app.invocations 입력>): Result<readonly AppInvocation[]>`
   - `changesetOf(id): Promise<Result<Uint8Array | null>>`
   - `markReverted(ids: readonly InvocationId[], rewind: RewindId): Result<void>` — 되돌림 표시. 기록은 지우지 않는다.
   - `pruneChangesets(app, keepRelease: ReleaseId): Promise<Result<number>>` — activation이 끝난 뒤 이전 release의 changeset을 지운다(S5 6장, S7이 부른다).
   - `unfinished(): Result<readonly AppInvocation[]>` — core 재시작 점검. 끝나지 않은 호출을 결과 모름으로 닫는 것은 구현이 한다.
7. `AppProcessLink` (구현: app-calls-supervisor의 `supervisor-link` / 쓰는 곳: app-calls-path, app-calls-rewind)
   - `call(target: AppApiTarget, request: ProcessCallRequest): Promise<{sent: false; error: LophnError} | {sent: true; response: ProcessCallResponse | null}>` — 호출 경로는 "앱에 보내기 전에 실패했는지"와 "보냈는데 응답을 받지 못했는지(결과 모름, `response: null`)"를 구별해야 한다. 그래서 `Result`를 쓰지 않고 이 모양으로 둔다. 앱이 멈췄거나 연결이 없으면 `sent: false`다(S5 4장 끝).
   - `apply(app, request: ProcessApplyRequest): Promise<Result<ProcessApplyResponse>>`
8. `AppIntake` (구현: app-calls-path / 쓰는 곳: app-calls-rewind, releases-problems의 activation, app-calls-supervisor의 정지)
   - `close(app, reason: "rewind" | "activation"): void` — 새 호출 접수를 닫는다. 그 사이 온 호출은 실패시키지 않고 붙잡아 둔다(S5 7장 4, S7 7장).
   - `whenIdle(app, graceMs: number): Promise<{idle: true} | {idle: false; running: readonly InvocationId[]}>` — 도는 호출이 끝나기를 기다린다.
   - `abandon(app): Promise<void>` — 끝나지 않은 호출을 결과 모름으로 닫아 부른 쪽에 돌려준다(유예 뒤 강제 정지 때).
   - `open(app): void` — 접수를 다시 열고 붙잡은 호출을 넘긴다. 넘길 때 대상 release는 그때의 활성 release다.
9. `AppRewind` (구현: app-calls-rewind / 쓰는 곳: `app.rewind_plan`·`app.rewind` handler(app-calls-assembly), places-sessions의 session rewind)
   - `plan(app, from: InvocationId): Result<RewindPlan>`, `run(app, from: InvocationId, by: Actor): Promise<Result<Rewind>>`
10. `BundleLocator` (구현: lead 조립. releases의 bundle 사본과 preview 영역 / 쓰는 곳: app-calls-screens)
    - `dir(target: AppApiTarget): Result<string>` — 그 target의 UI bundle 사본 폴더 경로. 없으면 `not_found`.
11. `AppViewSignal` (구현: lead 조립. 남지 않는 event `AppViewChanged`를 내는 쪽 / 쓰는 곳: app-calls-rewind)
    - `changed(app: AppId, reason: "rewind"): void` — event 이름과 payload는 contract-events가 `protocol/events`에 둔다. 이 port는 그 event를 내는 한 줄이다.

위 interface 이름은 그대로 쓴다. 칸이 모자라 보이면 바꾸지 말고 보고에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. type만 둔다.
- 남지 않음: 해당 없음(새 file).

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: `AppProcessLink.call`의 반환 모양(보내기 전 실패와 보낸 뒤 결과 모름의 구별), `AppIntake.abandon`, `AppViewSignal`을 따로 둔 것
- 계약 바꾸기 요청: contract-approvals의 Gate type 이름과 어긋난 곳, session ID·agent ID·project ID의 type 이름
