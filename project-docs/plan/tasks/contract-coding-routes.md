# contract-coding-routes

coding agent 연결의 계약을 새 모양으로 놓는다: coding token과 principal, CLI 명령 목록, hook·메시지·terminal 요청·harness 보고 route, ticket route(verify, update, claim, 완료 보고, 근거 kind `annotation`), core ↔ coding transport port, shell IPC 변경. type·schema·상수·type-only port만 둔다.

- 단위: contract-coding (wave 2)
- 선행: contract-coding-adapter (`CodingLaunchPlan`·`CodingRunOptions`를 import한다)
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/token.ts` (새로)
  - `packages/protocol/coding-agent/cli-commands.ts` (새로)
  - `packages/protocol/coding-agent/hook.ts` (새로)
  - `packages/protocol/coding-agent/message.ts` (새로)
  - `packages/protocol/coding-agent/source-diff.ts` (새로)
  - `packages/protocol/coding-agent/harness-report.ts` (새로)
  - `packages/protocol/coding-agent/terminal-requests.ts` (새로)
  - `packages/protocol/coding-agent/transport.ts` (새로)
  - `packages/protocol/coding-agent/ticket/` (새 폴더: `values.ts`, `routes.ts`, `claims.ts`, `ports.ts`, `mod.ts`)
  - `packages/shell/ipc/coding.ts` (더하기만)
  - `packages/shell/ipc/terminal.ts` (더하기만)
- 읽을 것:
  - spec: S6 2·4·5·6·7·8·9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - spec: S3 3·4·7장(call 봉투, 받는 곳, 앱 줄) — `.../specs/agent-call.md`
  - spec: S1 5·6·10장 — `.../specs/event.md`
  - spec: S9 9장(ticket 근거 annotation) — `.../specs/annotation.md`
  - spec: S4 4장 ticket 줄(App Engineer tool) — `.../specs/agent-definition.md`
  - inventory: `I1.6#2`, `I2.6#1`, `I2.6#2`, `I2.6#5`, `I2.6#6`
  - 결정: `../README.md` 3장 #6, #60, #66·67, #69, #74
  - 지금 코드(읽기만): `packages/protocol/coding-agent/{ticket-values,ticket-routes,ticket-claims,ports,cli-*,connections,connection-auth,sessions,harnesses}.ts`, `packages/protocol/base/{route,actor,ids,ports}.ts`, `packages/shell/ipc/{coding,terminal}.ts`
- 계약:
  - 쓰는 것:
    - S1 domain event(`TicketVerified`, `TicketCompletionReported`, `TicketClaimExpired`, `CodingSessionEndedUnreported`)는 contract-events가 `protocol/events`에 둔다. 이 task는 event를 정의하지 않는다.
    - `contract-coding-adapter`가 놓는 `codingLaunchPlanSchema`(`launch-plan.ts`), `CodingRunOptions`, `canLaunch`·`canDeliverMessages`(`harness-adapter.ts`). `HarnessId`는 옛 `harnesses.ts`에서 쓴다.
    - call id(`cal_…`)·봉투·`CodingOptions`(`{harness?, model?}`)·Router의 `InputTransport` port는 contract-calls-places가 `protocol/lophn-agent`와 `core/router/ports.ts`에 둔다. 이 task의 `transport.ts`는 그 `InputTransport`가 harness session에 쓰는 쪽(wiring이 끼운다)이다. 칸 이름이 맞는지 대 보고, main에 아직 없으면 call id를 `idSchema("cal")`로 직접 쓰고 보고한다. 주의: contract-calls-places의 `CallRef`는 근거 링크이고 call id가 아니다. 이 task는 call id를 `CallId`라고 부른다.
    - annotation id는 contract-app-calls가 `protocol/apps`에 둔다. 아직 없으면 `z.string().min(1)`로 두고 보고한다.
  - 내놓는 것: 아래 "새로 놓는 모양"

## 새로 놓는 모양

wave 3 task들이 이 모양에 맞춰 짓는다. 옛 `ticket-*.ts`, `connections.ts`, `sessions.ts`, `cli-*.ts`, `mcp-*.ts`는 지우지 않는다(`I1.6#2`: mcp-*.ts 다섯은 mcp-server와 CLI가 쓰는 동안 둔다. 지우는 일은 mcp-server가 없어진 뒤 cleanup이 한다). 새 file은 옛 export와 이름이 겹치지 않게 한다. ticket처럼 같은 이름이 필요한 곳은 새 폴더 `ticket/`에 놓고, `mod.ts` 목록에는 넣지 않는다(wave 3 task가 `.../coding-agent/ticket/mod.ts`로 deep import한다. 목록 교체는 cleanup이 한다).

### `token.ts` (coding token과 principal, #66)

```ts
export const CODING_TOKEN_ENV = "LOPHN_CODING_TOKEN";
export const codingSessionIdSchema = idSchema("ses");            // coding session. 앱 하나에 한 번에 하나(S6 2장 2)
export function codingPrincipal(session: string): `coding_agent:${string}`;   // "coding_agent:ses_…"
export const codingPrincipalSchema: z.ZodType<string>;
export const codingTokenScopeSchema = z.strictObject({ session: codingSessionIdSchema, app: idSchema("app") });
// token 발급·회수 port. 구현은 core/server/identity(events 단위). 원문 token은 저장하지 않는다
export type CodingTokens = {
  issue(scope: CodingTokenScope): Result<{ token: string }>;     // 앱 하나 범위
  revoke(session: string): Result<void>;                         // 회수한 token의 새 호출은 거절
};
export const CodingTokens: PortKey<CodingTokens>;
// session → app 조회 port. 구현은 coding-agent-session. ticket 쪽이 "token은 앱 하나만 연다"를 검사할 때 쓴다
export type CodingSessionLookup = { appOf(session: string): string | null };
export const CodingSessionLookup: PortKey<CodingSessionLookup>;
```

- 옛 `connectionPrincipal`(`coding_agent:cac_…`)은 그대로 둔다. `ses` 형 principal을 받도록 `protocol/base/actor.ts`와 `ids.ts`를 고치는 일은 lead 몫이다(보고의 등록할 것).

### `cli-commands.ts` (CLI 명령 목록, #69)

```ts
export const CODING_CLI_COMMANDS: readonly CodingCliCommand[];   // 아래 표. 이름·입력 schema·출력 schema·인증을 묶는다
export const CODING_CLI_NAMES: readonly string[];
export type CodingCliCommand = { name: string; auth: "coding_token" | "local"; input: z.ZodType; output: z.ZodType; route?: Route };
export const cliCommonSchema = z.strictObject({ json: z.boolean().optional(), input: z.string().optional(), input_file: z.string().optional(), idempotency_key: z.string().optional() });
```

| 명령 | auth | 하는 일 / 근거 |
|---|---|---|
| `ticket list`, `ticket show` | coding_token | 자기 앱의 ticket 읽기. `show`는 목표·상태·claim·check 결과와 근거(annotation은 메모·component·source 위치·release·screenshot 파일 경로까지)를 돌려준다. `I2.6#33`, S6 5장 6, S9 9장 |
| `ticket claim`, `ticket renew`, `ticket report` | coding_token | `claim`은 실제로 claim한다(`I2.6#1`). `report`는 summary 본문을 받아 hash·upload를 거쳐 완료 보고한다 |
| `message send` | coding_token | 맡긴 App Engineer에게 메시지(S6 5장 6). route는 `message.ts` |
| `hook <harness> <event>` | coding_token | stdin JSON을 `hook.ts` route로 넘긴다(#67). token이 없으면 보내지 않고 실패한다 |
| `app show`, `app test`, `app preview start`, `app preview stop`, `app status`, `app blueprint`, `app invocations`, `app logs` | coding_token | 자기 앱만(`I2.6#4`). `app list`·`app path`·`app register`·`app source`·`app sync-tools`·`app command`·`app validate`는 뺀다 |
| `release prepare` | coding_token | 지금 claim 아래에서 release 준비(S7 4장). 옛 이름 `app release prepare` |
| `package list`, `package show` | coding_token | 의존으로 선언된 package의 안내 읽기만(`I2.6#5`). 옛 `sdk`는 `add`를 빼고 이름을 `package`로 바꾼다 |
| `problem list`, `problem show`, `problem more`, `problem diff`, `problem record-fix` | coding_token | `I2.6#6`. `list`는 진행 상태로 좁히고, `show`는 발생 release·commit을 붙이고, `more`는 종류(발생 목록, 실패 invocation, log, 직전 release와 설정 변화, 지난 고친 기록, 관련 문제, 첨부)를 골라 읽고, `diff`는 `source-diff.ts` route를 부른다. `snapshot`·`test`·`bundle`·`summary`·`attachment open`은 뺀다 |
| `harness detect`, `harness refresh`, `harness install` | local | Settings와 shell main이 exec로 부른다. token이 없고 core를 부르지 않는다. 입출력은 아래 |

- 인증: CLI는 환경 변수 `LOPHN_CODING_TOKEN`만 읽는다(`I2.6#2`). 연결 참조(`LOPHN_CONNECTION`)와 credential helper는 없다. core 주소 찾기는 지금 `connection/client/daemon.ts` 그대로다.
- 뺀 것(목록에 넣지 않는다): `index`, `search`, `read`, `document *`, `save`, `format *`, `project *`, `series *`, `question *`, `approval *`, `daemon *`, `doctor`, `mcp config`, `connection *`, `session *`, `harness list/inspect/plan/update/remove`, `skills *`, `ticket create/cancel/checks/release`.
- `harness detect`/`refresh` 출력: `HarnessDetection[]`(`harnesses.ts`의 `harnessDetectionSchema`). `harness install` 입력: `{ harness: HarnessId, folder: absolutePath }`, 출력: `{ skill: Outcome, hook: Outcome }`, `Outcome = "installed" | "unchanged" | "kept_user_edit" | "not_supported" | "failed"`(사람이 고친 파일은 덮지 않는다. S6 4장).

### `hook.ts`, `message.ts`, `source-diff.ts`, `harness-report.ts`

모두 `protocol/base/route.ts`의 `defineMemory`(ledger에 쓰지 않는 route)나 `defineRead`다.

| route | resource.method | actors | 입력 → 출력 |
|---|---|---|---|
| `codingHook` | `coding_agent_sessions.hook` | `coding_agent` | `{ harness: HarnessId, event: string(≤80), payload: json(≤64KiB) }` → `{ accepted: boolean }`. core가 `hookSignalOf`로 바꾸고 모르면 `accepted: false`(오류가 아니다) |
| `codingMessageSend` | `coding_agent_sessions.send_message` | `coding_agent` | `{ body: string(≤8,000 code point), refs?: ticket id 목록 }` → `{ accepted: true }`. Router를 거쳐 맡긴 App Engineer("열린 session, 없으면 새 session")에게 간다. ledger에는 안 쓴다(`I3.6#11`) |
| `codingSourceDiff` | `coding_agent_sources.diff` | `coding_agent`, `agent` | `{ from_release, to_release }` → `{ files: {path, status: "added"\|"removed"\|"changed", patch: string\|null}[], truncated: boolean }` 또는 `{ preserved: false, reason }`(`I3.6#12`, 앱은 token이 정한다) |
| `harnessReport` | `coding_agent_harnesses.report` | `user` | `{ detections: HarnessDetection[] }` → `{}`. shell main이 감지 결과를 core 메모리에 알린다(#60) |
| `harnessList` | `coding_agent_harnesses.list` | `user`, `agent` | `{}` → 제품마다 `{ harness, detected, version, login, can_launch, can_deliver_messages }`. `can_launch`·`can_deliver_messages`는 `canLaunch`·`canDeliverMessages`와 같은 뜻의 칸이고 core가 채운다 |

### `terminal-requests.ts` (core → shell main, #6)

core는 shell main에 Gateway frame으로 터미널 요청을 보낸다. shell main은 사람 token으로 접속한 하나뿐인 client다. frame 틀은 contract-events의 Gateway 구독 frame을 따르되, 이 file이 요청 본문과 감싸는 frame을 정의한다.

```ts
export const codingTerminalRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("open"), request: requestIdSchema, plan: codingLaunchPlanSchema }),
  z.strictObject({ kind: z.literal("input"), request: requestIdSchema, session: codingSessionIdSchema, text: z.string().max(8192) }),
  z.strictObject({ kind: z.literal("stop"), request: requestIdSchema, session: codingSessionIdSchema }),
]);
export const codingTerminalFrameSchema = z.strictObject({ kind: z.literal("coding_terminal"), request: codingTerminalRequestSchema });
// shell main이 결과와 끝을 core에 알리는 memory route (actor user)
export const codingTerminalResult = defineMemory(/* coding_agent_terminals.result */);   // { request, ok: true, terminal_ref? } | { request, ok: false, reason: "spawn_failed"|"no_terminal"|"folder_missing"|"host_lost" }
export const codingTerminalExited = defineMemory(/* coding_agent_terminals.exited */);   // { session, exit_code: number|null, reason: "exited"|"killed"|"host_lost" }
```

- `open`은 새 탭을 열되 focus를 옮기지 않는다(S6 5장 4). `input`은 사람이 그 탭에 focus해 있으면 shell main이 focus가 풀릴 때까지 쥐고 있다가 넣은 뒤 `result`로 알린다(S6 7장). `stop`은 cancel·ticket 취소·lophn 끄기 때 쓴다.
- "focus 요청"은 core가 보내지 않는다. 대기 목록에서 누르는 일은 renderer에서 시작하므로 `shell/ipc/terminal.ts`의 `focusSession`(아래)이다.
- frame을 Gateway server frame 목록에 넣는 일은 lead 몫이다(contract-events의 `ready`·`event`·`closed`에 더한다. 보고의 등록할 것). `plan.env`에 coding token이 있으므로 shell main은 이 frame을 renderer로 중계하지 않는다.

### `transport.ts` (Router ↔ coding transport port, `I3.6#1·2·13`)

```ts
export type CodingStartInput = { call: CallId; app: string; ticket: string; options: CodingRunOptions };
export type CodingStartResult = { status: "started"; session: string } | { status: "queued" };
export const CODING_START_FAILURES = ["not_connected", "cannot_launch", "no_source_folder", "ticket_unavailable"] as const;   // Result 오류의 details.reason
export const CODING_SEND_REJECTIONS = ["no_turn_end_signal", "state_unknown", "session_ended"] as const;
export type CodingAppLine = { app: string; active: { session: string; ticket: string; call: CallId } | null; waiting: { call: CallId; ticket: string }[] };   // 앱별 맡기기 줄(메모리)
export type CodingTransport = {
  start(tx: Tx, input: CodingStartInput): Result<CodingStartResult>;   // 그 앱에 끝나지 않은 session이 있으면 queued
  send(tx: Tx, input: { session: string; call: CallId | null; text: string }): Result<{ status: "delivered" | "queued" }>;   // idle이면 delivered, 도는 중이라 기다리면 queued. 거절은 CODING_SEND_REJECTIONS
  stop(tx: Tx, input: { call: CallId; reason: "cancelled" | "ticket_cancelled" }): Result<void>;   // 줄에 있으면 줄에서 빼고, 돌고 있으면 멈추고 token 회수
  lines(): readonly CodingAppLine[];
};
export const CodingTransport: PortKey<CodingTransport>;
```

- Router의 `InputTransport.deliver`가 같은 tx 안에서 부른다고 보고 `Tx`를 첫 인자로 받는 동기 `Result`로 둔다. 터미널 요청 frame 전송 같은 비동기 side effect는 이 port 밖(구현)에서 commit 뒤에 한다.
- `queued` call의 취소·lophn 재시작 때 `failed`(이유: lophn 재시작)로 돌리는 일은 Router 몫이다.
- `RunOptions`가 `harness`를 안 줬으면 transport가 Settings 기본 실행 옵션(contract-platform의 설정 선언)으로 채운다.

### `ticket/` (ticket 계약, `I2.1#8`·`I2.6#26~33`·`I3.6#18~21`의 모양)

옛 `ticket-values.ts`·`ticket-routes.ts`·`ticket-claims.ts`를 읽고 아래대로 바꾼 것을 새 폴더에 놓는다. 이름은 옛 export와 같게 해도 된다(목록 교체는 cleanup).

| 파일 | 내용 |
|---|---|
| `values.ts` | `TICKET_STATES = open, claimed, reported, verified, failed, cancelled`(옛 `confirmed`는 `verified`, 옛 `check_failed`는 `failed`로. S4 tool의 `result: verified \| failed`와 맞춘다). ticket 내용은 `goal`(text, ≤2,000 code point) 하나와 `check` 하나와 `evidence[]`다: `title`·`what`·`why`·`kind`·`inspect`·`preserve`·`problems`·`readiness`·`needs`·`adoption_questions`를 뺀다(S4 4장 `ticket.create`: 목표, acceptance check, 근거 링크; tool 입력은 contract-agent-tools-catalog의 `ticket.*` 줄이 정본이다). 목록용 제목은 `goal`의 첫 줄(≤120 code point)로 계산한다. 근거 `evidence` kind는 `problem`, `ticket`, `release`, `file`(앱 source 상대 경로), `annotation`(S9). 옛 `version`(문서 판)은 뺀다. acceptance `check`는 셋 가운데 하나: `test_command`(옛 모양 그대로), `app_test`, `text`(`{kind: "text", text: string(≤500)}`, App Engineer가 판단하는 글 조건). 옛 `reproduction_test`·`release_active`·`problems_closed`·`human_confirmation`을 뺀다. claim의 주인은 `{ session: ses id, claim_seq, expires_at }`(옛 `connection: cac_`가 아니다). `CLAIM_DURATION_MS`(60분)·`CHECK_RESULTS`는 그대로 |
| `routes.ts` | `ticketCreate`(actor `agent`: `{ app, goal, check, evidence? }`), `ticketUpdate`(닫히기 전에 `{ ticket, goal?, check? }`, actor `agent`), `ticketList`(`{ app?, state? }`), `ticketShow`(`{ ticket }`. actor `user`, `coding_agent`, `agent`. 출력에 근거 annotation 값(메모, component, source 위치, release, screenshot 파일 경로)을 풀어 싣고 check 결과를 담는다), `ticketVerify`(actor `agent`. `{ ticket, base_revision, completion_seq, result: "verified" \| "failed", note? }`. 같은 tx에 `result: verified`면 `TicketVerified`), `ticketCancel`(actor `user`, `agent`. `{ ticket, reason(한 줄) }`). 칸 이름은 tool 입력과 같다. 어긋나면 보고 |
| `claims.ts` | `ticketClaim`, `ticketRenewClaim`, `ticketReportCompletion`(actor `coding_agent`. 입력은 지금 `ticketReportToolInputSchema`에서 문서 판 `outputs`(ver_)를 빼고 `release`, `summary`, `fix_records`, `verifications`는 그대로), `ticketUploadSummary`(그대로), `ticketExpireClaim`(actor `machine`), `ticketRecordChecks`(actor `machine`. 보고 접수 때 실행 조건을 돌린 결과를 기록만 한다. 상태를 확인됨·확인 실패로 바꾸지 않는다. `I2.6#28`). `ticketReleaseClaim`과 `ticketMakeReady`는 뺀다. `ticketRecordChecks`의 입력은 조건 번호 없이 `{ ticket, completion_seq, base_revision, result: pass\|fail\|inconclusive, reason, verification? }` 하나다(check가 하나이므로) |
| `ports.ts` | `TicketClaimCheck`(옛 `ports.ts`와 같되 `connection`이 `session`), `TicketSessionEnd`: `{ settle(session): Result<{ ticket: string \| null; reported: boolean }>; settleAll(): Result<number> }`(`settle`은 session이 끝났을 때 claim 반납, 보고가 없었으면 같은 tx에서 `CodingSessionEndedUnreported`를 낸다. `settleAll`은 기동 때 claim이 남은 모든 session을 정산하고 정산한 수를 돌려준다. 구현은 coding-agent-tickets) |
| `mod.ts` | 위를 모아 내보낸다. 새 route 배열 `TICKET_ROUTES`도 낸다 |

- 옛 ticket 화면 읽기(`ticket-screen.ts`)·수리 준비(`ticket-repair-prepare.ts`)·`repair-context.ts`는 새 폴더에 가져오지 않는다. `repair-context.ts`는 problems의 근거 읽기라 contract-releases-problems 몫이다(보고의 소유 바꾸기).

### shell IPC (더하기만)

- `packages/shell/ipc/terminal.ts`:
  - `terminalFocusSessionSchema = { session: ses id }`, `TerminalApi.focusSession(input): Promise<TerminalCall<TerminalReply>>`, channel 상수 `TERMINAL_FOCUS_SESSION_CHANNEL`. 그 session의 터미널 탭을 고른다(`I3.6#16`, S6 2장 5). 없으면 `TerminalReject`의 새 이유 `no_terminal`.
  - `TerminalRuntime`에 선택 칸 `coding_session?: { session: string; app: string; ticket: string; prompt: PromptOutcome }`. 옛 `coding?`은 두고 wave 3가 안 쓰게 한다. `launch_kind`는 그대로 `"shell" | "coding_tui"`다. coding 탭은 제목으로 구별하고(`U2.6#3`) 끝나면 session이 끝난 상태로만 보인다. 다시 시작은 없다.
- `packages/shell/ipc/coding.ts`: Settings가 제품마다 보이는 값. `HarnessSettingsView = { harness_id, label, discovery, version, version_result, login, can_launch, can_deliver_messages, reason: string \| null }`(`I2.6#20`, `I3.6#14`), `codingCallSchema`에 op `harnesses`(감지 결과 읽기)를 더한다. 옛 op(`connect`, `folders`, `start`, `sessions`)와 `ConnectRequest` 등은 두고 wave 3가 안 쓰게 한다.

### 등록

새 route를 `registry.ts`의 `ROUTES`에 넣으면 옛 route와 resource·method가 겹치거나 옛 consumer가 영향을 받으므로 **넣지 않는다**. 새 route 배열(`CODING_ROUTES`: hook, message, source-diff, harness-report, terminal result·exited)은 각 file에서 내보내고, 등록은 lead가 wave 3 merge 뒤에 한다.

## 할 일

1. `token.ts`: 위 모양. `CodingTokens`, `CodingSessionLookup`은 `definePort`로 만든다(`protocol/base/ports.ts`).
2. `cli-commands.ts`: 위 표대로 `CODING_CLI_COMMANDS`를 만든다. 입력 schema는 가능하면 새 `ticket/` route의 `input`을 재사용하고(`ticket show`는 `ticketShow.input` 등), `app *`·`problem *`·`package *`는 지금 `cli-app.ts`·`cli-core.ts`·`mcp-problem.ts`의 해당 입력을 옮겨 `withCommon` 꼴로 다시 짠다. 옛 file이 import하는 문서·series 계열 schema는 가져오지 않는다.
3. `hook.ts`, `message.ts`, `source-diff.ts`, `harness-report.ts`, `terminal-requests.ts`: 위 표대로.
4. `transport.ts`: 위 port.
5. `ticket/`: 위 표대로. 옛 file에서 옮길 때 문서 판·readiness·screen·automation·problem code 칸이 남지 않았는지 본다.
6. `shell/ipc/terminal.ts`, `shell/ipc/coding.ts`에 더한다. 옛 export는 지우지 않는다.
7. `grep -rn "mcp-core\|mcp-app\|mcp-problem\|mcp-session\|mcp-decisions" packages --include=*.ts`로 옛 mcp-*.ts 다섯을 import하는 곳을 적어 보고한다(`I1.6#2`).
8. (lead가 맞추며 더함) `ipc/terminal.ts`와 `preload/terminal-api.ts`에 `TerminalApi.onRuntime`을 더하고, runtime에 `title`과 `product`를 싣는다. renderer가 새 coding 탭을 아는 길이다(screens-project-terminal, screens-app-space-frame의 `useTerminalOpenRequests`). 이 IPC가 없으면 두 화면 task가 막힌다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 새 file에 `grep -n "readiness\|adoption\|human_confirmation\|reproduction_test\|check_failed\|LOPHN_CONNECTION\|connection:" packages/protocol/coding-agent/{token,cli-commands,hook,message,source-diff,harness-report,terminal-requests,transport}.ts packages/protocol/coding-agent/ticket/*.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것:
  - `packages/protocol/coding-agent/mod.ts` 목록에 새 file 추가(`ticket/`은 제외)
  - `packages/protocol/base/actor.ts`, `ids.ts`: `coding_agent:ses_…` principal 허용
  - Gateway frame 목록에 `codingTerminalFrameSchema`
  - 새 route 배열(`CODING_ROUTES`, `TICKET_ROUTES`)의 registry 교체 시점
  - shell main의 core route allowlist(`packages/shell/main/desktop/core/allowlist.ts`)에 `coding_agent_terminals.result`, `coding_agent_terminals.exited`, `coding_agent_harnesses.report`
- 안 쓰게 될 옛 export: `ticket-*.ts` 전체, `connections.ts`, `connection-auth.ts`, `sessions.ts`, `cli-*.ts`, `mcp-*.ts`, `output.ts`의 MCP 전용 type
- 정한 것:
  - ticket 상태 `confirmed` → `verified`, `check_failed` → `failed`. ticket 내용을 `goal`·`check`·`evidence`로 줄인 것(tool 입력에 맞춤)
  - 근거 kind에 `file`을 더한 것(S4 4장 "문제, 파일, annotation"을 따랐다)
  - CLI 명령 목록이 README 3장 #69보다 넓은 이유(`app`·`problem`·`release prepare`·`package`는 `I2.6#4~6`과 S7 4장이 요구한다), `ticket checks`·`ticket release`·`problem test`를 뺀 이유
  - `sdk` → `package` 이름 바꿈
  - `harness detect/refresh/install`을 local 명령으로 남긴 이유(감지·설치 코드가 Deno라 shell main이 import할 수 없어 CLI를 exec한다)
  - `coding_agent_sources.diff`라는 resource 이름. contract-releases-problems가 같은 읽기를 정의했으면 그쪽을 쓰고 이 route를 뺀다
- 계약 바꾸기 요청: 없음(wave 2)
