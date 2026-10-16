# fix-apps

계약 고정 전 고침. app-api key의 이름과 검사를 한 벌로, 앱 grant 읽기 출력을 새 모양으로, activation 이름과 묻는 판정의 연결, coding CLI가 가리키는 route, 제보 IPC의 기존 문제 칸, problems의 옛 binding 칸, 확인 IPC 사본을 고친다.

- 단위: contract-app-calls (계약 고정 전 고침)
- 소유(이 task만 고친다):
  - `packages/protocol/apps/{permissions,grants,channel-values}.ts`, `packages/protocol/apps/calls/`, `packages/protocol/apps/activation/`, `packages/protocol/apps/blueprint/app-api.ts`
  - `packages/protocol/approvals/{intent,grants}.ts`
  - `packages/protocol/events/domain.ts`
  - `packages/protocol/coding-agent/cli-commands.ts`
  - `packages/protocol/shell/{app-bridge,feedback,confirmation}.ts`, `packages/shell/ipc/{feedback,confirmation}.ts`
  - `packages/protocol/problems/{snapshots,sdk-report}.ts`
  - `packages/core/apps/ports.ts`
  - 이름을 바꾼 것을 쓰는 줄(core, shell, renderer, tools 어디든. 그 줄만)
- 읽을 것:
  - spec: `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md` 4·5장, `approval.md` 4·5장, `activation.md` 6장, `coding-agent.md` 5장
  - 원래 brief: `/home/pyosechang/projects/lophn/project-docs/plan/tasks/contract-app-calls-{api,ports,shell}.md`, `contract-approvals.md`, `contract-releases-problems-{releases,feedback}.md`, `contract-coding-routes.md`, `approvals-app-grants.md`(wave 3의 `compareDeclarations`)
  - 공통 규칙: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`
- 계약: 아래 할 일이 정하는 모양을 내놓는다.

## 할 일

1. **app-api key 한 벌.** 이름은 `appApiKeySchema` 하나(검사 하나: 앞뒤 공백 없음, 제어 문자 없음, `*` 없음, 빈 값 없음)를 한 곳에 정의하고 새 계약이 모두 그것을 쓴다. 지금 `channel-values.ts`의 `commandKeySchema`, `permissions.ts`의 지역 `commandKeySchema`, `blueprint/app-api.ts`의 `nonBlank`, `approvals/intent.ts`·`grants.ts`의 `z.string().min(1)`이 서로 다르다. 칸 이름도 맞춘다: app.call grant scope의 `commands` → `app_apis`(`permissions.ts`), activation의 `added_app_apis[].command` → `api`, `calls/call.ts`·`protocol/shell/app-bridge.ts`의 `commandKeySchema` 별칭을 걷는다. 옛 `commandKeySchema`는 옛 file이 쓰는 동안 남기되 새 계약은 쓰지 않는다.
2. **activation 이름.** `activation.ts`의 `activationRunSchema`·`ActivationRun`을 `activationAttempt...`로 바꾼다. `activation.ts`·`data-job.ts`의 손으로 쓴 id regex(`vrf_`, `app_`, `rel_`, `inv_`)는 `idSchema`로 바꾼다.
3. **묻는 판정을 한 곳으로(lead 결정).** activation이 사람에게 묻는지는 grant 덮음으로 정한다: 새 release의 선언 가운데 지금 active grant가 덮지 않는 항목이 있으면 묻는다. `first`(이전 release 없음)면 선언이 없어도 묻는다. loss step이 있으면 묻는다. 이전 release와 선언을 따로 비교하지 않는다. 그래서:
   - `ActivationComparison`의 주석을 이 규칙으로 고친다(`added_resources`는 "active grant가 덮지 않는 선언", `added_app_apis`도 같다).
   - `approvals/intent.ts`의 activation intent `input`이 `activationComparisonSchema`를 따르게 한다(refine 또는 그 schema를 쓴다).
   - Gate 판정은 "activation이면 `first`이거나 세 목록 중 하나라도 비어 있지 않을 때 ask"다. 주석에 적는다.
4. **앱 grant 읽기·거두기 출력.** `grantsList`·`grantRevoke`의 출력을 옛 `grantSchema` 대신 `appGrantSchema`(`apps/grants.ts`)로 한다. 옛 칸(`approval`, `created_by`, `revoked_by`)이 꼭 필요하면 이유를 보고한다.
5. **coding CLI route.** `cli-commands.ts`의 `app blueprint`는 `appAppApi`(`app.app_api`)로, `app invocations`는 `appInvocations`로 바꾼다.
6. **제보의 기존 문제.** `protocol/shell/feedback.ts`와 `shell/ipc/feedback.ts`의 `feedbackSendSchema`, `sendFeedback`에 `existing_problem: prb id | null`을 더한다. ipc의 `FEEDBACK_PROBLEM_MESSAGE`(옛 problem code 문구)를 걷고, 새 계약의 `FEEDBACK_PROBLEM_NAME`과 맞춘다. 두 file의 `beginFeedback` 서명을 같게 한다.
7. **problems의 옛 binding.** `problems/snapshots.ts`의 `binding: "sdk_context"|"view_context"` 칸과 `sdk-report.ts`의 같은 칸을 지운다(서명 연결은 걷었다). `problem-feedback.ts`의 `view.binding`은 다른 것이라 남긴다.
8. **확인 IPC 사본.** `shell/ipc/confirmation.ts`의 decision handle 요청 `choice` enum을 `protocol/shell/confirmation.ts`와 같게 한다(`restore_all`, `messages_only`, `summarize` 포함). reply type도 맞춘다. 옛 칸 `automation`, `requirement`는 뺀다.
9. **domain event 코드.** `events/domain.ts`의 `ReleaseActivationFailed.failure.code`를 `ACTIVATION_FAILURE_CODES` enum으로 한다(순환이 생기면 string으로 두고 보고).
10. **app port.** `core/apps/ports.ts`의 비공개 id alias를 `protocol/base/ids.ts`의 `Id<"app">` 등으로 바꾼다. `CallerDirectory.agentToolCall`이 `agent: string`과 자기 place 모양을 돌려주는 것을 `AgentRef`와 protocol `Place`로 바꾼다. `AppRewind.run`은 `apply`로 바꾼다.

## 끝남

- `deno task check`가 통과한다. `deno run -A tools/check-deps.ts`가 통과한다.
- 새 계약에 `commandKeySchema`, `command:`(app-api 뜻), `activationRun`이 남지 않는다. `shell/ipc/feedback.ts`에 `FEEDBACK_PROBLEM_MESSAGE`가 없다.
- 위험 test: 없음.

## 보고

- 바꾼 file
- 등록할 것
- 이름을 바꾸며 고친 core·shell·renderer 줄
- 정한 것
- 계약 바꾸기 요청: 없으면 "없음"
