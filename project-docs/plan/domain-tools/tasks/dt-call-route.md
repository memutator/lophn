# dt-call-route

호출 route `app.call_api`를 tool 호출 route `app.call_tool`로 바꾸고(Gate, write queue, invocation, changeset, rewind, unknown 처리는 그대로) 호출 길에서 project를 통째로 지운다. 지울 것은 호출 입력의 `project`, `pickProject`, 거절 code 셋, broker `projects/list`와 `app.projects`, 앱 process wire의 `context.project`, 앱 runtime의 project 전달이다. invocation 기록의 `project` 칸은 `dt-invocation-project`가 지우므로 이 task는 기록에 `null`을 넣는 데까지만 한다.

- 단위: domain-tools (wave 1)
- 선행: dt-decl
- 소유(이 task만 고친다):
  - `packages/protocol/apps/calls`
  - `packages/protocol/apps/registry.ts`
  - `packages/core/apps/calls`
  - `packages/core/apps/ports.ts`
  - `packages/core/apps/routes.ts`
  - `packages/core/apps/control.ts`
  - `packages/core/apps/register.ts`
  - `packages/core/apps/invocations/context.ts`
  - `packages/core/apps/invocations/ledger_test.ts`
  - `packages/core/apps/rewind/rewind_test.ts`
  - `packages/core/apps/permissions/mod.ts`
  - `packages/core/apps/permissions/broker/projects.ts`
  - `packages/core/apps/permissions/broker/server.ts`
  - `packages/core/apps/permissions/broker/apps-call.ts`
  - `packages/core/apps/preview/mod.ts`
  - `packages/core/apps/preview/adapters/projects.ts`
  - `packages/core/apps/preview/adapters/mod.ts`
  - `packages/core/apps/runtime/connect.ts`
  - `packages/core/apps/runtime/entrypoint/wire.ts`
  - `packages/core/apps/runtime/entrypoint/limits.ts`
  - `packages/core/apps/runtime/entrypoint/broker-client.ts`
  - `packages/core/apps/runtime/entrypoint/cap-host.ts`
  - `packages/core/apps/runtime/entrypoint/invoke.ts`
  - `packages/core/apps/runtime/entrypoint/startup.ts`
  - `packages/core/main/app-supervisor/assembly.ts`
  - `packages/core/main/app-supervisor/broker.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/main/daemon/wiring/projects.ts`
  - `packages/core/main/daemon/wiring/context.ts`
  - `packages/core/lophn-agent/tools/app-tools.ts`
  - `packages/shell/main/app-frame/app-call.ts`
  - `packages/shell/main/app-frame/app-call_test.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-rewind.ts`
  - `packages/shell/renderer/app-frame/app-detail/core-source.ts`
  - `packages/shell/renderer/app-frame/app-detail/source.ts`
  - `tests/eval/restore/app-data.ts`
  - `tests/eval/checks/app/live.ts`
  - `tests/eval/runner/steps.ts`
  - `tests/eval/types.ts`
  - `tests/e2e/app-call_test.ts`
  - `tests/e2e/app-release_test.ts`
  - `tests/support/app/patches.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(흐름, "project는 부른 쪽이 정한다" 절이 이 task에서 사라진다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `app-capability`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/products/roadmap/domain.md`의 "정한 것"(앱은 domain 하나에 묶이고 project별 data 나누기는 core가 지키지 못한다)
  - 계획: `project-docs/plan/domain-tools/README.md`의 "정한 것"과 "같이 도는 계획" 표(`lophn-agent/tools/app-tools.ts`, shell `app-detail/*`는 다른 계획도 닿으므로 위 최소 수정만 한다. `tests/eval/*`는 모든 계획이 닿는다)
  - 지금 코드: `packages/core/apps/calls/service.ts`(호출 길 전체), `packages/protocol/apps/calls/call.ts`
- 계약:
  - 쓰는 것: `dt-decl`의 `ToolDeclaration`, `toolNameSchema`(`packages/protocol/apps/channel-values.ts`)
  - 내놓는 것: 아래 "계약 모양"

## 계약 모양

**route**: resource `apps`, method `call_tool`, name `app.call_tool`(`defineMemory`, actors·errors는 지금 `app.call_api`와 같다: actors `user, agent, app`).
- 입력 `{ target, tool, input?, caller }`. `tool`은 `toolNameSchema`. `api`와 `project` 칸은 없다. `target`(live/preview)과 `caller`(person/agent/app)의 모양과 검증 규칙(주석에 적힌 caller 규칙)은 그대로다.
- 출력 `{ invocation: id | null, outcome }`. outcome 네 갈래(`succeeded/failed/denied/unknown`)는 그대로다.
- denial code는 `gate_blocked, rejected, cancelled, call_loop, call_too_deep, app_archived, app_unavailable, not_declared`다(`project_required`, `project_mismatch`, `project_not_found` 삭제).
- TS 이름: `appCallTool`, `ToolCallInput`, `ToolCallOutput`, `ToolOutcome`, `ToolDenial`, 출력 schema `toolCallOutputSchema`. `AppApiTarget`, `AppApiCaller`는 이름을 바꾸지 않는다(화면 file route 등 다른 곳이 쓴다).

**invocation operation**: `{ kind: "tool", tool: <name> }`(옛 `{ kind: "api", api }`). `start`, `data_change`는 그대로.

**broker**: 앱이 다른 앱을 부르는 broker 본문의 이름 칸 `api`는 그대로다(이름 경계는 `dt-decl` 계약 절). core로 가는 route 입력은 `tool`이다. `/_lophn/broker/projects/list` 경로, 입력·출력 schema(`brokerProjectsList*`), `ProjectSummary`와 route `app.projects`는 없어진다.

**process wire**(`ProcessCallRequest`): `context`에서 `project` 칸을 뺀다. `api` 칸은 그대로다.

## 할 일

1. protocol(`packages/protocol/apps/calls`): 위 계약대로 `call.ts`, `invocation.ts`(operation), `broker.ts`, `process-wire.ts`, `mod.ts`를 바꾸고 `project.ts`를 지운다. `packages/protocol/apps/registry.ts`의 route 목록에서 `appCallApi`→`appCallTool`, `appProjects`를 뺀다. invocation 스키마(`appInvocationSchema`)의 `project` 칸과 `app.invocations` 입력의 `project` 필터는 이 task에서 두고 `dt-invocation-project`가 지운다.
2. core 호출 길(`packages/core/apps/calls`): `service.ts`에서 `pickProject` 호출과 `project_not_found` 검사, `deps.projects`, `DENIAL_MESSAGES`의 project 셋을 지우고 `project.ts`를 지운다. `Flight.project`(`intake.ts`)와 부모 invocation에서 project 이어받기도 지운다. 기록 row의 `project`에는 `null`을 넣는다(`record.ts`의 `CallRecordBase`에서 칸을 빼고 row를 만드는 곳에서 `null` 고정). 호출 입력은 `tool`을 읽는다. `ports.ts`에서 `ProjectDirectory`, `routes.ts`에서 `projectsRead`·`PROJECTS_READ_KEY`·`callApiHandler`(→ `callToolHandler`)를 바꾼다. 설명 주석의 `app.call_api`·"project 정하기"도 고친다.
3. route 등록: `packages/core/apps/register.ts`(route 목록), `packages/core/apps/control.ts`(operation 정책에서 `appCallApi`→`appCallTool`, `appProjects` 삭제), `packages/core/main/daemon/wiring/apps.ts`(핸들러 key `["apps/call_tool", ...]`, `projectsRead` 등록 삭제, `ProjectDirectory` 주입 삭제), `packages/core/main/daemon/wiring/projects.ts`(`projectDirectory` provide 삭제)와 `wiring/context.ts`(`projectDirectory` 칸과 `ProjectDirectory` import 삭제). 이 셋은 공용 등록 file이다. 지우는 줄만 고치고 보고에 적는다.
4. broker와 supervisor: `packages/core/apps/permissions/broker/projects.ts`·`server.ts`·`apps-call.ts`, `packages/core/apps/permissions/mod.ts`의 export, `packages/core/main/app-supervisor/assembly.ts`(`appCall`은 `appCallTool` route를 `tool` 입력으로 부른다, `projects` port 삭제), `broker.ts`에서 project 목록 service를 지운다. preview 대역(`packages/core/apps/preview/adapters/projects.ts`, `adapters/mod.ts`, `preview/mod.ts`)도 지운다.
5. 앱 process 쪽: `packages/core/apps/runtime/entrypoint/wire.ts`(`context.project` 파싱 삭제), `limits.ts`(`projectsList` 경로), `broker-client.ts`(`projectsList()`), `cap-host.ts`(호출 문맥에서 `project`), `invoke.ts`(`port.run({... project ...})`), `startup.ts`(주석), `packages/core/apps/invocations/context.ts`(`InvocationContext.project`)를 지운다. SDK 쪽 사본(`packages/sdk/cap-app-api/context.ts` 등)은 `dt-sdk`가 같은 모양으로 맞춘다. 두 쪽은 duck typing으로 맞물려 따로 컴파일되므로 순서는 상관없다.
6. 보내는 쪽 최소 수정(소유 밖은 보고의 "넘길 줄"): `packages/core/lophn-agent/tools/app-tools.ts`(`appCallTool`, 입력 `tool`, `project` 보내기 삭제. 더 큰 재작성은 `dt-agent-tools`), `packages/shell/main/app-frame/app-call.ts`와 `app-call_test.ts`(method `"call_tool"`, `tool` 칸, `project` 보내기와 세 denial code 변환 삭제), `packages/shell/renderer/conversation/agent-tab-core-source-rewind.ts`와 `packages/shell/renderer/app-frame/app-detail/{core-source.ts,source.ts}`(operation `kind === "api"`→`"tool"`, `operation.api`→`operation.tool`. 이 셋은 string 비교라 컴파일이 못 잡는다. `grep -rn 'kind === "api"' packages`로 훑는다), `tests/eval/{restore/app-data.ts,checks/app/live.ts,runner/steps.ts}`(`appCallApi`·`AppApiCallInput`·`AppApiOutcome`), `tests/eval/types.ts`의 주석(`apps/call_api`).
7. 테스트: `packages/core/apps/calls/calls_test.ts`에서 project 관련 fixture(`projects` dep, `project_scope`)를 지운다. 그리고 위험 test 하나를 확인하거나 더한다(아래). `ledger_test.ts`, `rewind_test.ts`는 operation fixture를 `{ kind: "tool", tool }`로 바꾼다.
8. e2e에서 지운 기능의 흔적만 지운다(e2e를 돌리지도 고치지도 않는다): `tests/support/app/patches.ts`의 `projectScopePatch`와 이를 쓰는 `tests/e2e/app-call_test.ts`(116행 근처 patch, 265~292행 근처 `list_in_project` 단계), `tests/e2e/app-release_test.ts`(69행 근처)의 해당 부분.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "write tool 호출은 invocation을 남기고 응답의 changeset을 붙여 닫으며, 성공한 read는 기록을 남기지 않는다" — `calls_test.ts`에 이 두 가지를 한 번에 보는 test가 이미 있는지 먼저 본다(`grep -n "changeset" packages/core/apps/calls/calls_test.ts`). 없으면 ledger를 가짜로 둔 지금 `setup()`에 write 호출 하나와 read 호출 하나를 부르는 test 하나를 더한다. 이 test는 계획 README가 요구한 "write tool 호출이 invocation과 changeset을 남긴다"를 지킨다. 그 밖의 test는 만들지 않는다.
- 남지 않음:
  - `grep -rnE "call_api|appCallApi|AppApiCallInput|AppApiCallOutput|AppApiDenial\b|AppApiOutcome|callApiHandler" packages tools tests/eval --include=*.ts --include=*.tsx`가 0줄이다(`tests/eval`의 step 이름 `callApi`는 eval 안의 이름이라 걸리지 않는다).
  - `grep -rnE "project_required|project_mismatch|project_not_found|pickProject|ProjectDirectory|projectsRead|PROJECTS_READ_KEY|brokerProjectsList|projectsList|appProjects" packages --include=*.ts --include=*.tsx`가 0줄이다(`packages/core/lophn-agent/ports.ts`와 `places/ports.ts`의 별개 `ProjectDirectory`는 남는다. 이름이 같아도 이 task가 지운 것이 아니다).
  - `grep -rn 'kind: "api"\|kind === "api"' packages tests/eval`이 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `wiring/apps.ts`, `wiring/projects.ts`, `wiring/context.ts`에서 지운 줄(lead가 충돌을 풀 때 쓴다), `packages/protocol/apps/registry.ts`의 route 목록
- 안 쓰게 된 export: `appCallApi`와 `AppApiCallInput` 등 위 이름들(남이 쓰던 것은 지우지 않는다)
- 정한 것
- 넘길 줄: 소유 밖 file(`app-tools.ts`, shell의 `app-call.ts`·`app-detail/*`)에서 최소로 맞춘 곳
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 예) 앱 상세 화면의 project 열·필터는 `dt-invocation-project` 전까지 남는다. `app.projects` route가 없어 화면의 project 목록 읽기는 실패하고 빈 목록으로 처리된다
