# contract-app-calls-api

core를 거치는 app-api 호출, invocation 기록, changeset과 rewind, project 범위 app-api, 앱 process 통로(wire)의 모양을 새 파일로 고정한다(S5). 옛 invocation·connection·revert 모양은 지우지 않고 옆에 둔다. 구현은 넣지 않는다.

- 단위: contract-app-calls (wave 2)
- 선행: contract-releases-problems-problems (아래 5의 앱 보고 broker 입력이 그 task의 `problemReportInputSchema`를 쓴다). 또 lead가 task를 띄우기 전에 `packages/protocol/base/ids.ts`의 `ID_PREFIXES`에 `rwd: "Rewind"` 한 줄을 더해 둔다(`idSchema`가 이 표에 있는 접두사만 받는다).
- 소유(이 task만 고친다):
  - `packages/protocol/apps/calls/` (새 폴더. 아래 파일)
  - `packages/protocol/apps/runtime.ts` (`appRecordStartedInputSchema`에 optional 칸 하나만 더한다)
  - `packages/protocol/apps/broker.ts` (`brokerReadyInputSchema`에 optional 칸 하나만 더한다)
  - `packages/protocol/apps/apps.ts` (`appCreate.actors`에 `"agent"` 한 항목만 더한다)
- 읽을 것:
  - spec: S5 2~8장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - spec: S2 3~5장(효과, Gate 입력) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.5#2`, `I1.5#16`, `I1.5#17`, `I1.5#21`, `I2.5#1`, `I2.5#5`, `I2.5#8`, `I2.5#9`, `I2.5#20`. 문맥으로 `I2.5#22`(앱 등록 actor. core 쪽은 app-calls-assembly, 계약 쪽은 이 task의 9번)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #7(core → 앱 process는 supervisor 제어 pipe의 op), #8(`/screens`는 core가 UI bundle 사본을 내준다), #17(`AppViewChanged`), #18(command → app-api), #51(changeset은 blob store)
  - 지금 코드: `packages/protocol/apps/{invocations,channel,channel-values,direct-socket,broker,app-start,runtime,registry}.ts`, 본보기 `packages/protocol/coding-agent/ticket-claims.ts`(upload + 준비 blob)
- 계약:
  - 쓰는 것: `protocol/base/route.ts`의 `defineMemory`·`defineRead`·`defineCommand`·`defineFile`, `protocol/projects/values.ts`의 `projectIdSchema`·`appIdSchema`, `protocol/apps/channel-values.ts`의 `invocationIdSchema`·`releaseIdSchema`·`toolCallIdSchema`·`runtimeModeSchema`·`screenKeySchema`·`commandKeySchema`(app-api key 검사로 재사용), `protocol/apps/invocations.ts`의 `invocationSummarySchema`(재사용). event는 만들지 않는다: S1 5장대로 app-api 호출은 invocation이 맡고 domain event가 아니다. 앱 view를 다시 그리라는 `AppViewChanged`는 contract-events의 것이다.
  - 내놓는 것: 아래 "할 일"의 이름과 칸. wave 3의 app-calls-*, agent-tools(app-api tool), places-sessions(session rewind의 앱 고르기), releases-problems(activation drain), screens-app-space(Activity 탭)가 이 모양에 기댄다.

## 할 일

새 파일은 모두 `packages/protocol/apps/calls/` 아래다. zod schema와 type만 둔다. 이름에 `new`·`v2`를 넣지 않는다. 옛 export와 이름이 겹치지 않게 아래 이름을 그대로 쓴다.

1. `caller.ts` — 부른 쪽 (S5 4장, `I2.5#1`)
   - `appApiCallerSchema` = `kind`로 가르는 union, strict.
     - `person`: `{view_session}` (앱 화면을 연 사람. 앱·release·mode·project는 호출 입력의 `target`·`project`가 싣는다)
     - `agent`: `{session: idSchema("ses"), turn: idSchema("run"), tool_call: toolCallIdSchema}`
     - `app`: `{app, release, parent_invocation: invocationIdSchema | null}`
   - turn ID의 접두사는 contract-events·contract-calls-places가 정하면 lead가 계약 고정 때 맞춘다. 지금은 `idSchema("run")`를 `turn` 칸에 쓴다.

2. `call.ts` — 호출 route (S5 4장 순서 1~7, `I2.5#27`의 route 쪽)
   - `appApiKeySchema` = `commandKeySchema`를 그대로 가리키는 이름.
   - `appApiTargetSchema` = `mode`로 가르는 union: `live: {mode, app, release: releaseIdSchema | null}`(null이면 지금 활성 release), `preview: {mode, app, process_nonce}`.
   - `appApiCallInputSchema` (strict) = `{target, api, input?: json, project?: projectIdSchema | null, caller: appApiCallerSchema}`
     - 주석으로 규칙을 적는다: `caller.kind`는 route의 actor와 맞아야 한다(user ↔ person, agent ↔ agent, app ↔ app). 맞지 않으면 core가 forbidden으로 거절한다. `agent`와 `app`은 `target.mode`가 live이고 `release`가 null이다. `app`은 `project`를 싣지 않는다(core가 부른 invocation의 project를 넘긴다). project에 놓인 agent가 `project`를 싣고 놓인 project와 다르면 conflict다.
   - `APP_API_DENIAL_CODES` = `["gate_blocked","rejected","cancelled","call_loop","call_too_deep","project_required","project_mismatch","project_not_found","app_archived","app_unavailable","not_declared"]` 와 `appApiDenialSchema {code, message}` (Gate 막음, 사람 거절(S2 6장), 호출 루프·깊이(S5 4장, `I2.5#20`), project 규칙 위반, 앱 멈춤).
   - `appApiCallOutputSchema` = `{invocation: invocationIdSchema | null, outcome}`, `outcome`은 `status`로 가르는 union:
     - `succeeded {result: json}`
     - `failed {error: {code: string, message: string}}` (앱 handler가 낸 오류)
     - `denied {denial: appApiDenialSchema}` (handler까지 가지 못함)
     - `unknown {reason: "unavailable" | "connection_lost" | "core_restarted" | "timeout"}` (결과 모름. S5 4장 끝)
     - `invocation`은 기록을 남기지 않은 성공한 읽기에서만 null이다(S5 5장).
   - `appCallApi` = `defineMemory({resource: "apps", method: "call_api", name: "app.call_api", actors: ["user","agent","app"], errors: ["invalid_input","forbidden","unauthorized","not_found","unavailable"]})`.

3. `invocation.ts` — invocation 기록 (S5 5장, `I2.5#1`, `I2.5#5`, `I1.5#16`, `I1.5#17`)
   - `appInvocationOperationSchema` = `api {api}` | `start {reason: "activation" | "restart"}` | `data_change {from, to}`(옛 모양 그대로. S7 소관)
   - `appInvocationStatusSchema` = `running | succeeded | failed | denied | unknown` (옛 `accepted`는 없다)
   - `invocationEffectSchema` = `read | write | external`
   - `appInvocationSchema` = `{id, app, release, mode: runtimeModeSchema, operation, caller: appApiCallerSchema | null, project: projectIdSchema | null, effect, status, started_at | null, finished_at | null, input_hash: sha256 | null, summary: invocationSummarySchema, detail_hash | null, changeset: {hash: sha256, size_bytes} | null, reverted_by: idSchema("rwd") | null}`
     - `caller`가 null이면 앱 시작과 data_change다(옛 `system`·`direct`·`automation` 호출자는 없다).
     - refine: `changeset`은 `effect`가 read가 아닐 때만, `finished_at`은 `running`이 아닐 때만, `reverted_by`는 `succeeded`·`failed`·`unknown`일 때만 있다.
   - 읽기 둘. 옛 `invocations.list`·`invocations.get`과 이름이 겹치지 않게 resource `apps`에 둔다.
     - `appInvocations` = `defineRead({resource: "apps", method: "invocations", name: "app.invocations"})`. 입력 `{app?, project?, session?, turn?, effect?, status?, reverted?: boolean, mode?, release?, cursor?, limit? ≤ 200}`. 출력 `withReadCommon({invocations: appInvocationSchema[]})`. `session`·`turn` 필터는 S8이 쓰는 "session·turn별 write 목록"이다(S5 8장).
     - `appInvocation` = `defineRead({method: "invocation", name: "app.invocation"})`. 입력 `{invocation}`, 출력 `withReadCommon({invocation: appInvocationSchema | null})`.
     - actors `["user","coding_agent","agent","machine"]`, 열람 범위 판정은 구현이 한다.
   - 기록을 남기는 command route는 만들지 않는다. 호출 경로가 core 안에서 직접 남긴다(`I2.5#3`).

4. `rewind.ts` — changeset과 rewind (S5 6·7장)
   - `changesetRefSchema` = `{hash: sha256, size_bytes}` (blob store 참조. 저장 방식은 wave 3의 app-calls-invocations가 정한다).
   - `rewindPlanItemSchema` = `{invocation, started_at, operation, caller | null, effect, reverts_db: boolean, external: boolean, running: boolean}`. `external`은 "되돌아가지 않는 바깥 효과가 있다"는 표시이고 그 invocation의 DB 변경은 `reverts_db`로 되돌아간다.
   - `rewindPlanSchema` = `{app, release, from_invocation, items: rewindPlanItemSchema[] (오래된 것부터), blocked: null | {reason: "unrecoverable_write", invocation}}`. `blocked`는 범위 안에 결과 모르는 write·external·앱 시작이 changeset 없이 닫혀 있는 경우다(S5 7장: "되돌릴 수 없음").
   - `rewindSchema` = `{id: idSchema("rwd"), app, release, from_invocation, requested_by: actorSchema, status: "applying" | "applied" | "cancelled", reason: {code: "conflict" | "app_unavailable" | "core_restarted", message} | null, invocations: invocationIdSchema[], started_at, finished_at | null}` (`invocations`는 되돌린 목록)
   - route
     - `appRewindPlan` = `defineRead({method: "rewind_plan", name: "app.rewind_plan", actors: ["user"]})`, 입력 `{app, from_invocation}`. 고를 수 없는 것(preview·test, 이전 release, data_change, 이미 되돌림)은 `invalid_input`.
     - `appRewind` = `defineCommand({method: "rewind", name: "app.rewind", actors: ["user"], errors: ["forbidden","invalid_input","not_found","conflict","unavailable"]})`, 입력 `{app, from_invocation}`, 출력 `rewindSchema`. 앱 rewind는 사람만 한다(S5 11장 1)
     - `appRewinds` = `defineRead({method: "rewinds", name: "app.rewinds"})`, 입력 `{app, invocation?, cursor?, limit?}`, 출력 `withReadCommon({rewinds})`.
   - 되돌린 뒤 열린 앱 화면을 다시 그리는 신호는 `AppViewChanged{reason: rewind}`다. 여기서 정하지 않는다.

5. `project.ts` — project 범위 app-api와 `cap-project` (S5 4장, `I2.12#3`는 contract-app-calls-shell)
   - `projectSummarySchema` = `{id: projectIdSchema, name, purpose, archived: boolean}`
   - `appProjects` = `defineRead({method: "projects", name: "app.projects", actors: ["app","user"]})`, 입력 `{}`(strict), 출력 `withReadCommon({projects: projectSummarySchema[]})`. 보관한 project도 싣는다(앱 data는 남는다).

5b. `broker.ts` — 앱 process가 broker socket으로 부르는 새 서비스의 모양
   - 앱의 문제 보고 broker 입력(S7의 새 보고 모양을 나르는 것): `brokerReportProblemInputSchema = problemReportInputSchema.extend({process_nonce, mode})`. `problemReportInputSchema`는 contract-releases-problems-problems가 `protocol/problems/problem-report.ts`에 둔 것(이름이 달라졌으면 그 file을 따른다)이고, `process_nonce`·`mode`는 옛 `broker.ts`의 `childFields`와 같다. 출력은 옛 `brokerProblemReportOutputSchema`와 같은 접수 값. 옛 `brokerProblemReportInputSchema`(선언 code를 싣는 것)는 쓰는 곳이 있어 지우지 않고 지울 목록에 적는다. 새 경로 상수 `APP_BROKER_PATHS.problemsReport`는 옛 경로 `/_lophn/broker/problems/report`를 그대로 가리킨다.
   - 앱 process가 broker로 부르는 경로와 모양: `APP_BROKER_PATHS = {call: "/_lophn/broker/apps/call", projects: "/_lophn/broker/projects/list", problemsReport: "/_lophn/broker/problems/report"}`, `brokerAppCallInputSchema = {target_app, api, input?, parent_invocation: invocationIdSchema | null}`(project 칸이 없다), 출력은 `appApiCallOutputSchema`, `brokerProjectsListOutputSchema = {projects}`.

6. `process-wire.ts` — core ↔ 앱 process (S5 3·6·7장, `I2.5#8`, `I2.5#9`)
   - `PROCESS_PATHS = {call: "/_lophn/control/call", apply: "/_lophn/control/apply"}`. 앱 process는 supervisor만 이 socket으로 부른다. probe·open·close·shutdown은 옛 `DIRECT_SOCKET_PATHS`를 그대로 쓴다.
   - `processCallRequestSchema` = `{invocation, api, input?, context: {app, release | null, mode, project | null, effect, caller | null}}`
   - `processCallResponseSchema` = `status`로 가르는 union: `ok {result: json, changeset: base64 | null}`, `error {error: {code, message}, changeset: base64 | null}` (실패한 write도 DB가 일부 바뀌었을 수 있으므로 changeset을 싣는다)
   - `processApplyRequestSchema` = `{changesets: base64[]}` (core가 이미 최신부터 뒤집은 것, 적용 순서 그대로), `processApplyResponseSchema` = `applied {count}` | `conflict {message}` (충돌이면 하나도 적용하지 않은 것이다)
   - `appProcessStartInputSchema` = 옛 `appStartInputSchema`에서 `verify_key`와 `direct_socket`을 빼고 `control_socket`을 더한 것. `encodeAppProcessStart`·`decodeAppProcessStart`.
   - changeset 크기 상한은 두지 않는다(wave 3의 app-calls가 release마다 정한다, 결정 #51). 상수도 만들지 않는다.
   - 앱 시작이 DB를 바꿨을 때 그 changeset이 ready 통보를 타고 core의 앱 시작 invocation에 붙는다(`I2.5#9`). `runtime.ts`의 `appRecordStartedInputSchema`와 `broker.ts`의 `brokerReadyInputSchema`에 `start_changeset: z.string().nullable().optional()`(base64)를 `attestation` 바깥 칸으로 더한다. `readyAttestation`에는 더하지 않는다(probe 출력과 release 기록에도 쓰인다). 다른 것은 고치지 않는다.

7. `screen.ts` — 화면 byte (결정 #8)
   - `appScreenFile` = `defineFile({resource: "apps", method: "screen_file", name: "app.screen_file", actors: ["user"]})`, 입력 `{target: appApiTargetSchema, screen: screenKeySchema, path: string}` (`path`는 그 screen 아래 상대 경로). `defineFile`을 쓰는 곳 하나를 보고 content type 선언 방식을 따른다. 실패는 `invalid_input`, `not_found`, `unavailable`.

8. `mod.ts`에서 위 파일(`caller`, `call`, `invocation`, `rewind`, `project`, `broker`, `process-wire`, `screen`)을 모두 내보내고, `appCallApi`, `appInvocations`, `appInvocation`, `appRewindPlan`, `appRewind`, `appRewinds`, `appProjects`, `appScreenFile`을 `registry.ts`의 `ROUTES`에 더한다. `protocol/apps/mod.ts`의 `export * from "./calls/mod.ts"` 한 줄은 lead가 더한다(보고).

9. `apps.ts`의 `appCreate.actors`를 `["user","coding_agent","agent"]`로 한다(`I2.5#22`: 새 앱은 lophn이 등록한다. `coding_agent`를 뺄지는 coding-agent 단위가 정한다). 다른 route는 고치지 않는다.
10. 지울 목록 정리. 코드는 지우지 않는다. 다음 중 새 계약이 대신해 쓸모없어진 옛 export를 파일별로 보고에 적는다(wave 3의 app-calls-*가 쓰는 곳을 그치고 cleanup이 지운다): `protocol/apps/pair-routes.ts` 전부, `direct-socket.ts`의 invoke·cancel·status·screen·view-closed와 `commandRevertResult`, `broker.ts`의 `brokerInvocationSubmit*`·`brokerAutomation*`·`brokerAppsConnect*`·`brokerAppsConfirm*`·`brokerDocumentSave*`, `channel.ts`의 `AppConnection`·서명 envelope·`confirm proof`·`callOrigin`, `channel-client.ts`, `app-start.ts`의 `verify_key`·`direct_socket`, `invocations.ts` 전부(`invocationSummarySchema`는 새 파일이 쓰므로 남긴다), `registry.ts`의 `INVOCATION_EVENTS` 네 개, `apps.ts`·`channel.ts`의 `appConnect`·`appViewClosed`·`appAgentConfirmProof`, `runtime.ts`의 `appAutomations`·`appExport`, `channel-values.ts`의 `AUTOMATION_*`·`CONFIRM_MARKER_LIMIT`·`DIRECT_SOCKET_PATHS` 일부·`BROKER_SOCKET_PATHS` 일부.
11. (lead가 맞추며 더함) 새 route를 `protocol/apps/registry.ts`의 `ROUTES`에 넣는 일은 등록이라 lead가 한다. 보고의 "등록할 것"에 route 이름을 적는다.
12. (lead가 맞추며 더함) turn id는 contract-calls-places-turns의 `trn` 접두사를 쓴다(`idSchema("run")`를 쓰지 않는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. schema와 type만 둔다. refine이 판정하는 규칙(위 3의 칸 조합)은 schema가 이미 보장하므로 test하지 않는다.
- 남지 않음: 새 파일(`calls/`)에 `command`·`confirm`·`revert`·`automation` 낱말이 없다. `grep -rniE "confirm|revert|automation|\bcommand\b" packages/protocol/apps/calls`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/apps/mod.ts`에 `export * from "./calls/mod.ts"`(lead). `ID_PREFIXES`의 `rwd`.
- 안 쓰게 된 export: 10의 목록
- 정한 것: 문서에 답이 없어 정한 것(예: 앱 보고 broker 입력을 `problemReportInputSchema` 기반의 새 이름으로 옆에 둔 것, `data_change`를 operation에 남긴 것, `denied` 상태를 남긴 것, 호출 거절 code 목록, 결과 모름 reason 목록)
- 계약 바꾸기 요청: contract-events·contract-calls-places와 이름이 어긋난 곳(turn ID, session ID)
