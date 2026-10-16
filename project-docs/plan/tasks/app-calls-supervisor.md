# app-calls-supervisor

supervisor 쪽을 새 호출 모델로 바꾼다: core가 supervisor 제어 pipe의 op로 앱 process에 호출과 뒤집은 changeset 적용을 보내고, 앱 process는 core·supervisor만 부르는 control socket으로 줄어들고, 앱 사이 호출·후행 전달·confirm·automation·문서 저장 통로는 broker에서 걷고 core 호출 경로로 가는 `apps/call`과 `projects/list` 서비스를 더한다. 앱 process의 Deno 권한(flags)도 여기서 바꾸고 sandbox 경계를 표로 본다.

- 단위: app-calls (wave 3)
- 선행: approvals-app-grants (소유 겹침: `permissions/flags.ts`와 `permissions/broker/`를 그쪽이 먼저 고친다 — 쓰기 범위 좁히기, `problems.ts`·`secrets.ts`, `automations.ts`·`documents.ts` 지우기. merge된 뒤 이어서 고친다)
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/supervisor/`
  - `packages/core/apps/runtime/processes/`
  - `packages/core/apps/runtime/observations/`
  - `packages/core/apps/runtime/control-protocol.ts`
  - `packages/core/apps/runtime/supervisor-link.ts`
  - `packages/core/apps/runtime/core-link.ts`
  - `packages/core/main/app-supervisor/` (단 `data-runner.ts`는 releases-problems-activation 소유다)
  - `packages/core/apps/permissions/broker/` (approvals 몫인 `secrets.ts`, `apply-grant.ts`, `net-fetch.ts`는 읽기만 한다. `problems.ts`는 입력 검사 줄만 고친다. 아래 "손대는 선" 참고)
  - `packages/core/apps/permissions/flags.ts`
  - `packages/core/apps/permissions/sandbox-boundary_test.ts` (새 file)
  - `packages/core/apps/preview/launcher.ts`, `packages/core/apps/preview/flags.ts`, `packages/core/apps/preview/model.ts` (preview 자식을 supervisor가 띄우는 쪽이라 이 task가 같이 바꾼다. 나머지 preview는 app-calls-preview)
- 읽을 것:
  - spec: S5 2~4·7장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.5#1`(`app-supervisor/pairs.ts`, `broker/apps-connect.ts`, `pairSocketFlags`), `I1.5#4`(`apps.view_closed` op), `I1.5#6`(`broker/apps-confirm.ts`와 supervisor의 confirm 쪽), `I1.5#15`(`broker/invocations.ts`, `app-supervisor/main.ts`의 `delivery/sender.ts` 사용), `I1.5#18`, `I2.5#8`(flags·spawn·시작 입력), `I2.5#10`, `I2.5#18`(이름), `I3.1#8`(crash loop로 멈출 때 한 번 알리기), `I3.5#6`(op), `I3.5#12`, `I2.7#9`(supervisor의 정지). 문맥으로 `I1.5#11`(`broker/automations.ts`), `I1.5#13`(`broker/documents.ts`, `adapters/documents-save.ts`)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #7(core → 앱 process는 supervisor 제어 pipe의 op), #8
  - 지금 코드: 위 소유 path 전부. 옛 sandbox test(`git show 13a7365e^:packages/core/apps/permissions/broker/fs-boundary_test.ts`)
- 계약:
  - 쓰는 것: `core/apps/ports.ts`의 `AppProcessLink`(구현해서 내놓는다), `protocol/apps/calls/process-wire.ts`의 `PROCESS_PATHS`·`ProcessCallRequest`·`ProcessCallResponse`·`ProcessApplyRequest`·`ProcessApplyResponse`·`appProcessStartInputSchema`, `protocol/apps/calls/broker.ts`의 `APP_BROKER_PATHS`·`brokerAppCallInputSchema`·`brokerProjectsListOutputSchema`·`brokerReportProblemInputSchema`, 이름 `AppRestartHalted`는 contract-events의 것(core 쪽 command가 내보내므로 이 task는 부르지 않는다)
  - 내놓는 것: `createAppProcessLink(...)`(`supervisor-link.ts`에서. app-calls-assembly가 `AppProcessLink`로 core에 잇는다), supervisor op `apps.call`·`apps.apply`, broker 서비스 `apps/call`·`projects/list`, `appFlags`의 새 인자(`controlSocket`)

## 할 일

1. 제어 op (`I3.5#6`)
   - `control-protocol.ts`: `SUPERVISOR_OPS`에 `call: "apps.call"`(입력 `{target, request: ProcessCallRequest}`, 출력 `{sent: false, error} | {sent: true, response: ProcessCallResponse | null}`)와 `apply: "apps.apply"`(입력 `{app, request: ProcessApplyRequest}`)를 더하고 `viewClosed`와 그 input schema를 지운다(`I1.5#4`).
   - `supervisor-link.ts`: 위 두 op를 부르는 `AppProcessLink` 구현. supervisor가 없거나 답하지 않으면 `sent: false`(unavailable), 보낸 뒤 답이 끊기면 `sent: true, response: null`. `viewClosed` 요청을 지운다.
   - `desiredAppSchema`·`previewLaunchSchema`의 `commands` 칸 이름은 releases와 core 조립이 만드는 값이라 이 task에서 바꾸지 않는다. 보고에 적는다.
2. supervisor (`runtime/supervisor/`, `processes/`)
   - preview 자식도 같은 시작 입력과 flags를 쓰도록 `preview/launcher.ts`·`flags.ts`·`model.ts`(`PreviewLaunch`·`PreviewChildIdentity`)에서 `directSocket`·endpoint 칸을 뺀다. 같은 앱의 preview는 하나만 쥐는 규칙은 그대로.
   - 앱 process 시작 입력을 `appProcessStartInputSchema` 모양으로 만든다(`verify_key`·`direct_socket` 없음, `control_socket` 있음). socket 경로는 시작마다 새로 정한다(지금 `directSocket`과 같은 방식).
   - `supervisor.ts`가 core 호출을 앱 process에 중계한다: `apps.call` → 그 process의 control socket `PROCESS_PATHS.call` POST, `apps.apply` → `PROCESS_PATHS.apply` POST. 응답 상한을 둔다. 앱이 멈췄거나 아직 ready가 아니면 `sent: false`, 보낸 뒤 연결이 끊기거나 시간이 넘으면 `response: null`.
   - `view-closed` 중계와 `endpoint`를 core에 알리는 것을 걷는다. 관측 wire(`observationWireSchema`)의 `endpoint`는 protocol 계약이 아직 요구하므로 빈 문자열로 보낸다.
   - crash loop로 멈출 때(`CRASH_LOOP`, `supervisor.ts`) core에 `record_unavailable`을 한 번만 보낸다(`I3.1#8`). domain event `AppRestartHalted`는 core의 command(app-calls-assembly)가 낸다.
   - 정지(`pause`/`stop`)는 지금대로 둔다: 접수를 닫고 비우는 일은 core의 `AppIntake`가 먼저 하고(`I3.5#12`, `I2.7#9`), supervisor는 비운 뒤 정지만 한다. 앱 process가 shutdown 유예를 넘기면 강제 종료한다.
3. `core/main/app-supervisor/` (`I2.5#10`, `I1.5#1`, `I1.5#15`, `I1.5#18`)
   - 지운다: `pairs.ts`(앱 쌍 연결 준비·confirm 어댑터), `main.ts`와 `assembly.ts`의 `delivery/sender.ts` 사용과 invocation 서비스 감싸기, `access.ts`의 "부를 수 있는 다른 앱" 계산과 `assembly.ts`의 그 연결(`I1.5#18`), `preview-broker.ts`의 쌍·confirm·automation·문서 쪽.
   - broker 조립(`broker.ts`, `assembly.ts`)은 남는 서비스(`net`, `secrets`, `problems`, ready, control watch)에 새 서비스 `apps/call`·`projects/list`를 더해 잇는다. 새 서비스는 그 자식의 app credential로 core의 `app.call_api`(`apps/call_api` memory route)와 `app.projects`를 부른다. credential을 만드는 쪽(`appCredentialIssuer`)은 app-calls-assembly 몫이므로 여기서는 `access.ts`의 `CorePost`처럼 주입 함수 `callCore(path, bearer, body)`와 `bearer()`로 받는다.
4. `permissions/broker/` (`I2.5#10`)
   - 지운다: `apps-connect.ts`, `apps-confirm.ts`, `invocations.ts`의 `InvocationBroker`·전달 쪽. `server.ts`의 `BROKER_ROUTES`·`BrokerServices`·`routes()`에서 그 route와 서비스를 뺀다. `automations.ts`·`documents.ts`와 `adapters/documents-save.ts`는 approvals-app-grants(또는 wave 1)가 이미 지웠어야 한다. 남아 있으면 지운다.
   - 더한다: `apps-call.ts`(`APP_BROKER_PATHS.call`: 요청을 `brokerAppCallInputSchema`로 검사하고 core 호출 경로로 넘긴다. 신원은 자식 연결이 정하고 본문의 `parent_invocation`은 core가 확인한다), `projects.ts`(`APP_BROKER_PATHS.projects`).
   - `problems.ts`: approvals-app-grants가 "선언한 code만 보고" guard를 걷은 뒤, 입력 검사를 `protocol/apps/calls/broker.ts`의 `brokerReportProblemInputSchema`(이름과 message를 싣는 새 모양)로 바꾼다. 출력과 접수 쪽은 그대로.
   - 손대는 선: `secrets.ts`, `apply-grant.ts`, `net-fetch.ts`는 고치지 않는다(읽기만). 이 file들이 `./invocations.ts`에서 `BrokerChild` 등을 import하면 `invocations.ts`를 지우지 말고 그 type만 남긴 채(`BrokerChild`, `BrokerSession` 한정) 이름과 모양을 바꾸지 않는다. `permissions/mod.ts`(approvals 소유)가 지운 서비스의 export를 내보내면 그 줄만 지우고 보고한다(소유 겹침, lead가 merge에서 푼다).
5. `permissions/flags.ts` (`I2.5#8`, `I1.5#1`) — approvals-app-grants가 쓰기 범위를 좁힌 뒤의 file에서 한다.
   - `AppPaths.directSocket`을 `controlSocket`으로 바꾸고 `socketFlags`의 이름 인자도 맞춘다. `pairSocketFlags`를 지운다. 문서 저장 주석을 정리한다. 앱 process가 여는 socket은 broker socket 하나와 control socket 하나다.
6. 위험 test 한 file `packages/core/apps/permissions/sandbox-boundary_test.ts`
   - 옛 `fs-boundary_test.ts`의 꼴로 한다: 실제 Deno process를 한 번 띄워 probe 하나가 여러 경우를 표로 돌려주고, 제품이 쓰는 `appFlags`·`socketFlags` 그대로 flag를 만든다. 임시 폴더에서만 돈다(`clearEnv`, 임시 HOME). 사람 data root는 열지 않는다.
   - 행: 옛 행(자기 bundle 읽기, 자기 data 읽기·쓰기·만들기·목록, bundle 쓰기 거절, source·다른 앱 DB·log·platform DB·자격 파일·platform root·`..` 우회 거절, 환경의 credential, subprocess)에 더해 "다른 앱의 control socket에 연결 거절", "자기 control socket 연결 허락", "임의 unix socket 연결 거절"을 본다.
   - subprocess를 띄우는 test라 AGENTS.md상 새로 만들 때 사람에게 묻는 대상이다. 이 plan(`/home/pyosechang/projects/lophn/project-docs/plan/README.md` 2.5의 앱 호출 단위 위험 test)이 옛 `fs-boundary` 꼴의 sandbox 경계 test를 정했으므로 만든다. 이 한 file이 앱 단위에서 subprocess를 띄우는 유일한 test다.
7. 지우기 규칙: 지우거나 이름을 바꾸는 export는 `grep -rn`으로 소유 밖 import를 먼저 본다. 있으면 지우지 않고 보고한다. 예: `core/apps/runtime/{connect,commands,reads}.ts`는 app-calls-assembly 소유다(여기서 import하는 이름을 바꾸지 않는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/apps/permissions/sandbox-boundary_test.ts`): "운영 앱 process는 자기 bundle과 data 폴더 밖, 다른 앱의 socket, platform 자원, 자격 파일에 닿지 못하고 자기 두 socket만 쓴다"
- 남지 않음: `grep -rniE "direct_socket|directSocket|pairSocket|apps-connect|apps-confirm|automations|documentsSave|viewClosed|view_closed" packages/core/main/app-supervisor packages/core/apps/runtime/supervisor packages/core/apps/runtime/processes packages/core/apps/permissions/broker packages/core/apps/permissions/flags.ts`가 0줄이다(소유 밖이 import해서 남긴 것은 제외하고 보고).

## 보고

- 바꾼 file
- 등록할 것: core 조립의 supervisor op 처리(`apps.call`·`apps.apply`)와 `AppProcessLink` 연결, broker의 `callCore`·`bearer` 주입(app-calls-assembly). `permissions/mod.ts`에서 지운 export 줄
- 안 쓰게 된 export: 소유 밖이 아직 import하는 `DIRECT_SOCKET_PATHS`의 invoke 계열, `BROKER_SOCKET_PATHS`의 지운 서비스, `protocol/apps/broker.ts`의 지운 서비스 schema(cleanup)
- 정한 것: control socket의 응답 상한과 시간 초과 값, 앱이 ready가 아닐 때 `sent: false`로 본 것
- 계약 바꾸기 요청(wave 3): `process-wire`·`AppProcessLink`에서 모자란 칸, 관측 wire의 `endpoint`를 지울 것
