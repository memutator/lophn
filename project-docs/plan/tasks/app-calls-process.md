# app-calls-process

앱 process 쪽을 새 호출 모델로 바꾼다: 직접 통로(서명 연결, proof, 화면 byte, 후행 전달)를 걷고, supervisor만 부르는 control socket에서 core가 보낸 호출을 받아 돌려주고, SDK가 write·external·앱 시작 동안 SQLite session으로 changeset을 떠서 결과와 함께 돌려주고, 뒤집은 changeset을 한 transaction으로 적용한다. SDK의 `cap-schedule`을 `cap-app-api`로 바꾸고 `cap-project`를 새로 만든다.

- 단위: app-calls (wave 3)
- 선행: 없음 (wave 1의 remove-app-extras가 `cap-schedule`의 `screen-context.ts`·`revert.ts`와 automation 쪽을 먼저 걷었어야 한다. 남아 있으면 이 task가 지운다)
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/entrypoint/` (전부)
  - `packages/core/apps/invocations/context.ts`
  - `packages/sdk/cap-schedule/` (지운다) → `packages/sdk/cap-app-api/` (새 폴더로 옮긴다)
  - `packages/sdk/cap-project/` (새 폴더)
  - `packages/sdk/cap-store/`, `packages/sdk/cap-fs/`, `packages/sdk/cap-net/`, `packages/sdk/cap-secret/`
- 읽을 것:
  - spec: S5 3·4·6·7장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - spec: S7 6장(`Migration`의 손실 선언) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`, 계약 `packages/protocol/apps/activation/migration.ts`(contract-releases-problems-releases)
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I2.5#7`, `I2.5#8`(앱 process 쪽), `I2.5#9`, `I2.5#14`, `I3.5#6`(받는 쪽), `I3.5#7`, `I3.5#13`, `I3.5#16`(SDK 쪽), `I3.5#17`, `I1.5#3`(`entrypoint/{signature,verify}.ts`), `I1.5#4`(`entrypoint/control.ts`의 view-closed), `I1.5#6`(`confirm-marker.ts`와 proof 분기), `I1.5#9`(`invoke.ts`의 confirm 분기), `I2.5#18`(이름)
  - 받는 줄(assignment.md에서는 remove-app-extras 몫이지만 남는 package를 바꾸는 일이라 이 task가 한다. 보고에 적혀 있다): `I2.5#12`(SDK app-api 등록과 dispatch: 패키지 이름 바꾸기, 호출 문맥에 `project`), `I2.5#13`(SDK의 다른 앱 호출을 core 경로로), `I2.5#15`의 SDK 쪽(`cap-secret`. approvals-app-grants가 broker의 secret 요청 모양을 바꾸지 않기로 했으므로 SDK도 바꾸지 않는다. 확인만 한다)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #7, #8, #18, #51
  - 지금 코드: `packages/core/apps/runtime/entrypoint/*`, `packages/sdk/cap-schedule/*`, `packages/sdk/cap-store/*`
- 계약:
  - 쓰는 것: `protocol/apps/calls/process-wire.ts`의 `PROCESS_PATHS`·`processCallRequestSchema`·`processCallResponseSchema`·`processApplyRequestSchema`·`processApplyResponseSchema`·`appProcessStartInputSchema`, `protocol/apps/calls/broker.ts`의 `APP_BROKER_PATHS`·`brokerAppCallInputSchema`·`brokerProjectsListOutputSchema`·`brokerReportProblemInputSchema`, `protocol/apps/calls/project.ts`의 `projectSummarySchema`, `protocol/apps/broker.ts`의 `brokerReadyInputSchema`(`start_changeset` 포함). 앱 process는 zod를 쓰지 않으므로 위 schema와 같은 모양을 손으로 검사하는 `wire.ts`에 둔다(옛 `wire-check.ts`의 방식).
  - 내놓는 것: supervisor가 부르는 control socket(`PROCESS_PATHS.call`·`apply`와 probe·open·close·shutdown), 앱 시작 stdin 입력 `appProcessStartInputSchema` 모양을 읽는 `parseAppStart`, SDK 공개 이름(아래), `entrypoint/main.ts`의 `run()`(release 준비가 만드는 진입 file `lophn-entry.ts`와 problems test runner가 이 이름과 경로를 부른다. 바꾸지 않는다).

## 할 일

### A. 앱 process (`core/apps/runtime/entrypoint/`)

1. 받는 쪽을 바꾼다 (`I2.5#7`, `I2.5#8`, `I3.5#6`)
   - `direct-server.ts`를 `control-server.ts`로 바꾼다: `control_socket` 하나만 열고, 서명·Authorization 검사 없이 supervisor가 보낸 요청만 받는다. 경로는 `PROCESS_PATHS.call`, `PROCESS_PATHS.apply`, 옛 probe·open·close·shutdown(`DIRECT_SOCKET_PATHS` 중 control 것만).
   - `invoke.ts`: `call` 요청 하나 = invocation 하나. 요청을 검사하고(`wire.ts`), 등록된 handler를 `api`로 찾아 `runWith(context)`로 돌린다. blueprint 입력 검사와 default 적용은 지금처럼 `validateInput`으로 한다. handler가 던진 `AppApiRejection`(옛 `CommandRejection`)은 `error {code, message}`, 그 밖의 throw는 `internal`. 결과가 상한(`limits.ts`)을 넘으면 `error`.
   - `context.effect`가 `write`·`external`이면 SDK session을 걸고(아래 B), 끝나면 changeset을 base64로 응답에 싣는다. 실패 응답에도 싣는다. `read`는 session을 걸지 않는다(S5 6장: 선언을 믿는다). write·external은 이 process 안에서도 한 번에 하나만 돌게 문(mutex)을 둔다: core가 줄을 세우지만 session이 연결 단위라 겹치면 한 changeset에 섞이기 때문이다.
   - `apply.ts`(새): `apply` 요청의 changeset 목록을 받은 순서대로 한 transaction 안에서 `applyChangeset`한다. 하나라도 충돌하면 `ROLLBACK`하고 `conflict {message}`, 모두 되면 `applied {count}`. 적용하는 동안 다른 호출은 없다(core가 접수를 닫았다). SDK `cap-store`가 쥔 연결을 쓴다.
2. 걷어 낸다 (`I1.5#3`, `I1.5#4`, `I1.5#6`, `I1.5#9`)
   - 지운다: `signature.ts`, `verify.ts`, `confirm-marker.ts`, `command-body.ts`, `screens.ts`, `screen-files.ts`(화면 byte는 core가 내준다. 결정 #8), `automation.ts`, `clock-gate.ts`, `schedule.ts`(이름은 `cap-app-api` port로 바뀐다), `direct-server.ts`.
   - `state.ts`: 서명 key, view 목록, confirm marker, 호출 기록(`InvocationRecord`)과 후행 전달 상태를 뺀다. 접수 여부, 도는 호출 수, write mutex만 남긴다.
   - `control.ts`: `view-closed`를 지운다(`I1.5#4`). open·close는 view 개념 없이 접수 열고 닫기만 한다.
   - `broker-client.ts`: `submitInvocation`, `appsConnect`, confirm, automation, 문서 저장 호출을 지우고 `appsCall(body)`(`APP_BROKER_PATHS.call`)와 `projectsList()`(`APP_BROKER_PATHS.projects`)를 더한다. ready 통보에 `start_changeset`을 싣는 칸을 더한다.
3. 시작 (`I2.5#9`)
   - `start-input.ts`: `appProcessStartInputSchema` 모양으로 바꾼다(`verify_key`·`direct_socket` 없음, `control_socket` 있음).
   - `startup.ts`·`main.ts`: 앱 코드를 불러오는 동안(등록 handler가 DB를 쓸 수 있는 구간) write session을 걸고, 끝나면 changeset이 있으면 ready 통보의 `start_changeset`에 base64로 싣는다. pair port, screen context host, automation timer, 화면 서버 설치를 걷는다. `commandsMatchBlueprint`는 `app_api` 이름 목록 비교로 바꾼다. `run()`의 이름·경로는 그대로.
4. 호출 문맥 (`I3.5#17`, `I2.5#12`)
   - `invocations/context.ts`의 `InvocationContext`에 `project: string | null`을 더하고, `caller`는 core가 준 부른 쪽 요약으로 바꾼다. `RegisteredHandler.command`는 `api`로. `SCHEDULE_PORT` 심볼 이름은 `Symbol.for("lophn.cap-app-api")`로 바꾸고 SDK와 같은 값으로 맞춘다.
   - `cap-host.ts`: host port에서 문서 저장을 뺀다. `post(path, body)`·`current()`는 유지, `store`(session을 걸고 changeset을 떼는 훅)를 더한다.

### B. SDK

5. `packages/sdk/cap-store/` (`I2.5#14`, `I3.5#7`, `I3.5#13`)
   - `openStore`가 호출마다 새 `DatabaseSync`를 열던 것을 이 process의 연결 하나를 돌려주는 것으로 바꾼다(앱 data는 앱 DB 하나). `host.ts`에 runtime이 쓰는 훅을 둔다: `beginChangeset()` → 그 연결에 `createSession()`을 건다(`lophn_data_schema` 표와 `sqlite_*`는 뺀다. 표마다 session을 만들고 changeset을 이어 붙여도 된다), `endChangeset(): Uint8Array | null`(변경이 없으면 null, 예외가 나도 session을 닫는다), `applyChangesets(list)`(위 `apply.ts`가 쓴다).
   - PRIMARY KEY 없는 표의 변경은 session이 기록하지 않는다(S5 6장). 그래서 migration이 PRIMARY KEY 없는 표를 만들면 실패해야 한다: `Migration` type을 `protocol/apps/activation/migration.ts`(contract-releases-problems-releases)의 `Migration`(`from`, `to`, `sql`, `loss`)으로 바꾸고, `migrate`는 단계마다 같은 transaction 안에서 새로 생긴 표를 `pragma table_info`로 훑어 `tablesWithoutPrimaryKey`가 돌려주는 표가 있으면 그 단계를 rollback하고 `invalid_input`(`MIGRATION_PRIMARY_KEY_REQUIRED`)으로 실패한다. `migrationOfSql`을 `cap-store`에서 다시 내보낸다(템플릿이 `@lophn/cap-store`에서 가져다 쓴다. releases-problems-template). core의 data worker 쪽 같은 검사는 releases-problems-activation 몫이다. `cap-store/guide.md`에 적는다.
6. `packages/sdk/cap-schedule/` → `packages/sdk/cap-app-api/` (`I2.5#12`, `I2.5#13`, 결정 #18)
   - `git mv`로 옮기고 아래 이름으로 바꾼다: `command()` → `appApi()`, `registeredCommands` → `registeredAppApis`, `CommandRejection` → `AppApiRejection`, `connectAppCommands` → `connectAppApi`. `currentContext()`·`runWith()`는 유지하고 문맥에 `project`가 들어간다. `results.ts`(read 결과 모양)·`trace.ts`·`rejection.ts`는 이름만 맞춘다.
   - `connect.ts`: 다른 앱 호출을 직접 socket 대신 host port의 `post(APP_BROKER_PATHS.call, {target_app, api, input, parent_invocation})`로 보낸다. 부모 invocation은 현재 호출 문맥에서 자동으로 붙는다. 결과 모름(`ResultLost`)은 core가 돌려준 `unknown` outcome이다. 준비 요청, confirm poll, `PairPort`를 지운다.
   - 이미 없어졌어야 할 것이 남아 있으면 지운다: `revert.ts`(`withRevert`), `screen-context.ts`.
   - `deno.json`의 package 이름·workspace 등록은 lead 몫이다. 고치지 않고 보고에 적는다.
7. `packages/sdk/cap-project/` (새, `I3.5#16`): `listProjects(): Promise<ProjectSummary[]>`(보관한 project도 싣는다), `currentProject(): string | null`(호출 문맥의 project). host port의 `post(APP_BROKER_PATHS.projects, {})`를 부른다. `cap-net/host.ts`·`cap-secret/host.ts`의 host port 꼴을 따른다. `mod.ts`, `guide.md`(짧게).
8. `cap-fs`, `cap-net`, `cap-secret`: 문서 저장·직접 통로에 기대는 코드가 있으면 걷는다. 바뀌는 것이 없으면 그대로 둔다. `cap-secret/secret.ts`의 `use({name, destination})`은 approvals-app-grants가 broker의 요청 모양을 그대로 두므로 바꾸지 않는다(`I2.5#15`).
9. 지우기 규칙: 지우거나 이름을 바꾸는 export는 `grep -rn`으로 소유 밖 import를 먼저 본다(예: `core/apps/runtime/supervisor/`가 `entrypoint/`의 상수를 import하면 app-calls-supervisor가 같은 시기에 고친다). 있으면 지우지 않고 보고한다.
10. 위험 test 한 file `packages/sdk/cap-store/changeset_test.ts` (in-memory `node:sqlite`. PRIMARY KEY test는 같은 file의 표에 넣는다)

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/sdk/cap-store/changeset_test.ts`):
  - "write 동안의 변경이 changeset으로 나오고 `lophn_data_schema` 표의 변경은 빠진다"
  - "여러 changeset 가운데 하나라도 충돌하면 하나도 적용하지 않고 DB가 그대로다"
  - "PRIMARY KEY 없는 표를 만드는 migration은 실패하고 그 단계는 rollback된다"
- 남지 않음: `grep -rniE "verify_key|direct_socket|confirm|signature|automation|view_session|withRevert|cap-schedule" packages/core/apps/runtime/entrypoint packages/sdk/cap-*`가 0줄이다(소유 밖이 import해서 남긴 것은 제외하고 보고).

## 보고

- 바꾼 file
- 등록할 것: `deno.json` workspace의 `packages/sdk/cap-schedule` → `packages/sdk/cap-app-api`, 새 `packages/sdk/cap-project`, 앱 import map(`core/apps/packages/template/pin.ts`, `app/deno.json.tmpl`)의 package 이름과 SDK 안내(releases-problems 몫). template의 `registerCommands`·`command(` 호출(releases-problems)
- 안 쓰게 된 export: 소유 밖이 아직 import하는 옛 이름 (`invocations/mod.ts`가 `context.ts`를 내보내는 줄은 app-calls-invocations가 맞춘다)
- 정한 것: SDK 공개 이름(`appApi`, `registeredAppApis`, `AppApiRejection`, `connectAppApi`, `cap-project`의 두 함수), 앱 시작 session 구간, write mutex, 표마다 session을 거는 방식
- 계약 바꾸기 요청(wave 3): `process-wire`에서 모자란 칸
