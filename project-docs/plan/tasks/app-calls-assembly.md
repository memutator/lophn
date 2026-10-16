# app-calls-assembly

app-calls의 새 module들(호출 경로, invocations, rewind, screens)을 core에 잇고, 옛 직접 통로·서명 연결·confirm·revert 조립을 걷는다. `core/apps/control.ts`와 `register.ts`를 새 route 집합으로 다시 맞추고, blueprint 읽기를 새 `app_api` 모양으로 바꾸고, 앱 시작과 crash loop 때 필요한 command를 고친다. 지울 수 있는 것만 지우고 남이 쓰는 것은 남겨 보고한다.

- 단위: app-calls (wave 3)
- 선행: app-calls-path, app-calls-invocations, app-calls-rewind, app-calls-process, app-calls-supervisor, app-calls-preview, app-calls-screens (이 task가 그 module들의 `mod.ts`를 import하고, 그 module들이 쓰던 옛 export를 마지막에 지운다)
- 소유(이 task만 고친다):
  - `packages/core/apps/control.ts`, `packages/core/apps/register.ts`, `packages/core/apps/mod.ts`
  - `packages/core/apps/connections/` (지운다. 단 `operations.ts`는 남긴다. 아래 8)
  - `packages/core/apps/revert/` (지운다. 아래 8의 조건)
  - `packages/core/apps/blueprint/`
  - `packages/core/apps/registration/`
  - `packages/core/apps/runtime/connect.ts`, `commands.ts`, `reads.ts`, `model.ts`, `mod.ts`, `signing.ts`, `client/`
  - `packages/core/main/daemon/wiring/apps.ts`, `packages/core/main/daemon/wiring/apps-revert.ts` (core-wiring-split이 만든 apps module의 wiring file. 꼴은 `core-wiring-split.md`의 `Wiring` 약속을 따른다)
- 읽을 것:
  - spec: S5 2·3·4·5·9장, S1 5·7장(`AppRestartHalted`, `AppViewChanged`) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`, `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.5#1`, `I1.5#3`, `I1.5#4`, `I1.5#5`, `I1.5#6`, `I1.5#7`, `I1.5#9`(`core/apps/blueprint`), `I1.2#14`(approvals가 넘긴 `runtime/connect.ts`의 `agent.commands` grant 판정 부분. connect를 걷으면 같이 없어진다), `I2.5#11`, `I2.5#18`, `I2.5#22`, `I3.1#8`(command 쪽), `I3.5#16`(core의 `app.projects` handler 쪽). 문맥으로 `I1.6#26`(아래 8)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #3, #7, #8, #17, #18
  - 지금 코드: 위 소유 path. 특히 `control.ts`의 `createAppsControl`(약 650줄), `appsOperationPolicies`, `register.ts`
- 계약:
  - 쓰는 것: 앞선 task들이 내놓은 `createAppCalls`(`core/apps/calls`), `createInvocationLedger`·읽기 handler·schema step·blob 선언(`core/apps/invocations`), `createAppRewind`·handler·schema step·`closeInterruptedRewinds`(`core/apps/rewind`), `serveScreenFile`(`core/apps/screens`), `createAppProcessLink`(`core/apps/runtime/supervisor-link.ts`), `core/apps/ports.ts`의 모든 port, `protocol/apps/calls`의 route 8개, `protocol/apps/blueprint`의 `appAppApi`와 `validateBlueprint`. 다른 단위의 구현이 필요한 port(`Approvals`(contract-approvals), `CallerDirectory`, `ProjectDirectory`, `BundleLocator`, `AppViewSignal`)는 인자로 받는다.
  - 내놓는 것: apps module의 `Wiring`(`wiring/apps.ts`). `assembly.ts`의 `WIRINGS`에 이미 한 줄이 있으면 그대로, 없으면 lead가 더한다. 다른 단위의 구현은 `WiringContext`의 이름 있는 칸으로 받는다.

## 할 일

1. route와 handler를 새 집합으로 맞춘다 (`I2.5#11`)
   - 더한다: `app.call_api`(memory. handler는 `AppApiCallPath.call`. `auth`는 요청의 actor와 credential에서 만든다), `app.rewind_plan`·`app.rewind`·`app.rewinds`, `app.invocations`·`app.invocation`, `app.projects`(handler는 `ProjectDirectory.list`를 `projectSummarySchema`로 줄여 돌려준다. `I3.5#16`), `app.app_api`(blueprint 읽기. 아래 3), `app.screen_file`(file route. `serveScreenFile`을 올린다. file route를 올리는 방식이 app-calls-screens 보고대로 막혀 있으면 가능한 만큼 하고 막힌 모양을 보고한다).
   - 걷어 낸다: `POST /v1/apps/connect`(memory route `appConnect`)와 그 어댑터, `appViewClosed`, `appAgentConfirmProof`, `invocation.record_*`·`accept_confirm` 등록, 앱 쌍 준비·confirm 어댑터(`createConfirmAdapters`, `ledgerConfirmTargets`), connection `sweep`, `connections/` 서비스 조립 (`I1.5#1`, `I1.5#3`, `I1.5#4`, `I1.5#6`).
   - `appsOperationPolicies()`(operation별 허락 actor 목록)를 새 route에 맞춘다: `app.call_api`는 machine(앱 child credential 발급 경로), agent, app(child)이 받고, `app.projects`는 app child가 받는다. 앱 child credential(`APP_CHILD_OPERATIONS`)에 둘을 더한다. 지운 route의 항목을 뺀다.
2. 앱 시작과 crash loop (`I3.1#8`, `I2.5#9`)
   - `runtime/commands.ts`의 `app.record_started`: 입력에 `start_changeset`이 있으면 앱 시작 invocation(`operation start`, 효과 write)을 `InvocationLedger`로 남기고 changeset을 붙인다. 시작 이유는 `activation`(release가 이전 관측과 다름)이나 `restart`.
   - `app.record_unavailable`이 crash loop로 멈춤(`CRASH_LOOP` reason)을 알릴 때 같은 transaction에서 domain event `AppRestartHalted`를 낸다. event 정의와 payload는 contract-events가 `protocol/events`에 둔 것을 쓴다.
   - `runtime/reads.ts`·`model.ts`는 관측의 `endpoint`를 쓰지 않게 하고(값은 빈 문자열로 온다), `commands` 칸 이름은 그대로 둔다(releases와 `DesiredApp`이 쓰는 이름이라 cleanup이 바꾼다).
3. `core/apps/blueprint/` — 새 `app_api` 모양 (`I1.5#9`, `I2.5#18`)
   - `extract.ts`·`extract-child.ts`는 `protocol/apps/blueprint/`의 `validateBlueprint`·`canonicalJson`을 쓴다. `extract-child.ts`는 권한 없는 자식이라 zod 없는 파일(`protocol/apps/blueprint/value.ts`)만 직접 import한다.
   - `describe.ts`: 설명이 비어 있는 곳을 `app_api`(`app_api.<key>.input.<필드>`) 기준으로 센다. `reads.ts`: `app.app_api` handler. release에 고정된 blueprint에서 `appAppApi.output`을 만든다. 옛 `app.blueprint` handler 등록은 지운다. `protocol/apps/registry.ts`에서 옛 route를 빼는 일은 lead 몫이다(보고). `mod.ts`는 새 type을 내보낸다.
4. `registration/` (`I2.5#22`) — `app.create`의 `requireWriter`: user와 agent(lophn의 앱 만들기 tool)를 받는다. coding agent는 받지 않는다(token이 앱 하나를 열 뿐이라 새 앱을 등록하지 않는다. S6). route 선언의 `coding_agent` 항목은 coding-agent 단위가 정리한다.
5. `register.ts` — ledger 등록 목록(command, read, schema step, event, blob 선언)을 새 module 것으로 바꾼다: invocations(읽기, schema step, `INVOCATION_BLOB_*`), rewind(command, 읽기, schema step), 지운 것(옛 invocation command, 옛 invocation event 네 개, 옛 connection 것)을 뺀다. `mod.ts`는 새 module을 내보내고 `connections`를 뺀다.
6. `wiring/apps.ts` — `Wiring { name: "apps" }` 한 칸을 새 module로 채운다. `schemaSteps`(invocations, rewind), `operations`(`appsOperationPolicies()`), `records`(core 안 machine 자격), `build`(`Built.memory`에 `app.call_api`, `Built.fileStreams` 또는 지금 file route를 올리는 칸에 `app.screen_file`, `Built.reads`에 invocations·rewind·`app.projects`·`app.app_api`, `Built.writer`에 `withReleasePreparation`과 rewind command), `start`(invocations 재시작 점검 `sweepInterruptedInvocations`, `closeInterruptedRewinds()`), `closeIntake`/`closeChildren`(지금 `appsControl.stop()` 위치). 다른 module에서 받아야 하는 값(`Approvals`(contract-approvals), `CallerDirectory`, `ProjectDirectory`, `BundleLocator`, `AppViewSignal`, releases 쪽에 넘길 `AppIntake`·`InvocationLedger`)은 `WiringContext`에 이름 있는 칸으로 읽고(wiring끼리 import하지 않는다), 칸이 없으면 `wiring/context.ts`(lead 소유)에 더해 달라고 보고한다. `AppIntake`·`InvocationLedger`·`AppRewind`는 releases-problems와 places-sessions가 쓸 수 있게 `WiringContext`의 칸으로 내놓는다고 보고한다.
   - `wiring/apps-revert.ts`: `revert/`를 지우면 같이 지운다. 아직 남기면 그대로 두고 보고한다.
7. `runtime/` 정리 (`I1.5#3`, `I1.5#5`): `connect.ts`에서 서명 연결·`appConnect` 처리를 걷고 `ProcessSource` 관측 부분만 남긴다. `signing.ts`를 지운다. `client/`(Deno runtime client)는 `core/lophn-agent/tools/app-toolkit.ts`(agent-tools)와 `core/problems/tests/work/app-driver.ts`(releases-problems)가 import하므로 소유 밖 import가 사라질 때까지 지우지 않고 보고한다.
8. 지우기
   - 지우기 규칙: 지우는 file은 `grep -rn "<경로>" packages tools`로 소유 밖 import를 먼저 본다. 있으면 지우지 않고 보고한다.
   - `connections/`: `confirm*.ts`, `client.ts`, `origin.ts`, `prepare.ts`, `resolve.ts`, `mod.ts`를 지운다. `operations.ts`(coding agent 통로 상한 정책. `core/main/daemon`이 import한다)는 지우지 않는다: S6의 token 범위가 이 정책을 대신하는지는 coding-agent 단위가 정한다(`I1.6#26`을 그쪽에 넘겼다). 보고에 적는다.
   - `revert/`: `core/server/credentials.ts`(`APP_REVERT_PRINCIPAL`)와 `core/main/worker/main.ts`(`revert/worker/run.ts`)가 import한다. 그 file들이 이미 고쳐졌으면 지우고, 아니면 남기고 보고한다.

- (lead가 더함, app-calls-path가 넘긴 것) `createAppCalls(deps)`(`core/apps/calls/mod.ts`)를 조립한다. `deps.apps: AppStates`(`activeRelease`, `archived`)는 앱 module 읽기로 끼운다. preview 호출의 선언 찾기는 지금 활성 release로 근사한다. 앱 시작 invocation(supervisor가 `begin`한 것)을 calls의 도는 호출 표에 등록하는 길을 app-calls-supervisor와 맞춘다(없으면 앱 시작 중 다른 앱 호출이 forbidden이다).

- (lead가 더함, app-calls-invocations가 넘긴 것) `createInvocationLedger({sql, transaction, blobs})`를 조립하고 `start`에서 `closeUnfinishedInvocations(ledger, now)`를 부른다. `INVOCATION_BLOB_PURPOSES`(`app_changeset`, 8MiB)를 blob 준비 통로에 등록한다. ledger 쓰기가 writer Worker 안에서만 돈다면 invocations·rewind의 동기 port(`begin`, `markReverted`, rewind의 `sql`)를 어떻게 잇는지 한 번에 정한다(main thread 쓰기 연결 또는 내부 command). frame에 안 들어가는 changeset은 앱 process가 run 폴더에 file로 쓰고 supervisor가 읽어 bytes로 넘기는 길도 여기서 놓는다(lead 결정). `control.ts`의 `applyApprovedAction`·`createApprovalRequest`·`invocationAcceptConfirm` scope 줄과 `apps/connections/`의 옛 confirm file을 지운다.

- (lead가 더함, releases-problems-intake가 넘긴 것) `core/apps/control.ts`의 `APP_CHILD_OPERATIONS`와 그 OperationPolicy가 옛 `reportProblem.name`이다. 앱 자격에 `problemReport.name`(`problem.report`)을 넣는다(지금 broker의 보고가 forbidden이다). 앱 process `entrypoint/main.ts`의 `problemReportBody`는 `code` 대신 `name`·`message`를 보낸다. app-calls-supervisor가 넘긴 것: `startControlServer`를 `publishReady`보다 먼저 연다(start changeset이 `record_started`에 빠지지 않게).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 조립이다. 위험한 판정은 앞선 task들의 test가 본다.
- 남지 않음: `grep -rniE "app\.connect|appConnect|viewClosed|accept_confirm|confirmProof|connections/" packages/core/apps packages/core/main/daemon`이 0줄이다(소유 밖 import로 남긴 것은 제외하고 보고).

## 보고

- 바꾼 file
- 등록할 것: `wiring/context.ts`(lead)에 더할 `WiringContext` 칸 목록과 그 칸을 채우는 단위, `protocol/apps/registry.ts`에서 옛 route(`appBlueprint`, `appConnect`, `appViewClosed`, `appAgentConfirmProof`, `INVOCATION_ROUTES`, `PAIR_ROUTES`, `INVOCATION_EVENTS`) 제거와 `appAppApi` 등록(lead)
- 안 쓰게 된 export: 소유 밖이 아직 import해서 남긴 옛 file(`connections/operations.ts`, `runtime/client/`, `revert/`의 남은 것)과 import하는 곳
- 정한 것: 앱 시작 invocation의 이유(`activation`/`restart`) 판정, 앱 child credential의 operation 목록
- 계약 바꾸기 요청(wave 3): route·port에서 모자란 칸, `app.screen_file` file route 등록 모양
