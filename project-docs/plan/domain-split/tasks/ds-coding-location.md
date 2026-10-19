# ds-coding-location

coding session의 자리를 domain으로 두고, 터미널과 작업 폴더는 앱 source가 든 project에 연다. session의 place는 앱이 묶인 domain이다(R 상태에서 이미 `{kind:"domain"}`이고 받는 쪽은 그 domain의 Domain Engineer다). 새로 하는 일은 터미널이다: 앱 source 폴더가 이은 project의 폴더 안에 있으면 core가 실행 계획에 그 project id를 싣고, shell이 그 terminal의 `project`로 삼아 그 project 창이 coding 탭을 받는다. source가 lophn 자리(`<data>/domains/<dom>/app/source`, core가 만든 기본 자리)에 있으면 project가 없어 지금처럼 앱 공간이 받는다.

- 단위: coding (wave 4)
- 선행: ds-project-registry
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/launch-plan.ts`
  - `packages/core/apps/tickets/coding`
  - `packages/core/main/daemon/wiring/lophn-agent-registration.ts`
  - `packages/shell/terminal-host`
  - `packages/shell/main/terminal`
  - `packages/shell/renderer/terminal`
  - `packages/shell/renderer/app-frame/app-space.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/domain-split/README.md`("정한 것"의 coding agent), `tasks/ds-project-registry.md`(`domainProjectOfPath`)
  - architecture: `project-docs/architecture/coding-agent.md`("흐름": 터미널 탭, cwd = 앱 source; "source 폴더가 없는 앱은 맡길 때 core가 만든다"; "coding session의 place는 …"), `place-session.md`, `layers.md`("domain module끼리 import 금지": apps는 domains를 import하지 않는다. 다른 module의 값은 port로 받는다)
  - 코드: `packages/core/apps/tickets/coding/{launch,store,scaffold-source,close-call,message}.ts`(앱의 domain 찾기는 `appDomainOf` — R 이름), `packages/protocol/coding-agent/launch-plan.ts`(`CodingLaunchPlan`, `launchPlanOf`), `packages/shell/terminal-host/{launch-plan,coding-types,main}.ts`(`project: ""`인 곳), `packages/shell/renderer/terminal/use-terminal-open-requests.ts`, `packages/shell/renderer/app-frame/app-space.tsx`(coding 터미널을 받는 `useTerminalOpenRequests` 쓰는 곳), `packages/shell/renderer/workspace/workspace.tsx`(project 창의 같은 filter. 이 file은 `ds-shell-window`가 고친다)
  - 본보기(포트): `packages/core/apps/registration/ports.ts`의 `appProjectLookupPort`(R 뒤 이름 `appDomainLookupPort`)와 그것을 꽂는 `packages/core/main/daemon/wiring/lophn-agent-registration.ts`
- 계약:
  - 쓰는 것: `domainProjectOfPath(sql, domain, path)`(`packages/core/domains/lookups.ts`), `appDomainOf`(`packages/core/apps/lookups.ts`, R 이름).
  - 내놓는 것: 실행 계획의 `project: string | null`(`prj_…`), `TerminalRuntime.project`(`packages/shell/ipc/terminal.ts`의 기존 칸)가 coding 터미널에서도 그 값이다. project 창(`ds-shell-window`)은 `runtime.project === 창의 project id`로 받는다.

## 정한 것

- 사람이 쓴 README 결정("terminal과 작업 폴더는 앱 source가 든 project에 열린다")을 코드에 옮기는 해석이다. 작업 폴더(cwd)는 지금처럼 앱 source 절대 경로다. 달라지는 것은 어느 창이 탭을 받는가다.
- 앱 source가 든 project = 앱의 domain에 이은 active project 가운데 폴더 안에 source가 있는 project(가장 안쪽 폴더). domain에 이어지지 않은 project의 폴더 안에 있어도 그 project는 아니다.
- project가 있으면 project 창만 coding 탭을 받고 앱 공간은 받지 않는다(같은 PTY가 두 창에 붙지 않게). project가 없으면(`null`) 앱 공간이 받는다(지금과 같다).
- coding session의 place와 받는 쪽(완료 보고, 메시지)은 바뀌지 않는다: 앱이 묶인 domain의 Domain Engineer다(`store.ts`의 `codingPlace`, `close-call.ts`, `message.ts`).

## 할 일

1. **계획.** `packages/protocol/coding-agent/launch-plan.ts`의 `CodingLaunchPlan`·`codingLaunchPlanSchema`·`launchPlanOf`에 `project: idSchema("prj").nullable()`을 더한다. 쓰는 곳(`terminal-host/launch-plan.ts`, test)을 같은 변경에서 고친다(`v2`를 만들지 않는다).
2. **core.** `apps/tickets/coding/launch.ts`의 `resolveLaunch`가 앱의 domain과 source 경로로 project를 찾아 계획에 싣는다. apps는 domains를 import하지 못하므로 port(`codingProjectLookupPort` 같은 이름)를 `apps/tickets/coding/`에 정의하고, `wiring/lophn-agent-registration.ts`가 `domainProjectOfPath`로 구현해 꽂는다(`appDomainLookupPort`와 같은 길). 근거: `layers.md`의 module 간 import 규칙.
3. **shell main.** `terminal-host/launch-plan.ts`의 `prepare`가 계획의 `project`를 view(`coding-types.ts`의 `CodingPlanView`)에 싣고, `terminal-host/main.ts`가 coding runtime을 만들 때 `project: ""` 대신 그 값(없으면 `""`)을 넣는다. 주석("plan에는 project가 없다")을 고친다. `main/terminal/coding/requests.ts`는 계획을 그대로 넘기므로 바뀌는 것이 없는지 확인한다.
4. **renderer.** `app-frame/app-space.tsx`의 `useTerminalOpenRequests` 콜백이 `request.runtime.project !== ""`이면 받지 않는다. `renderer/terminal/`에서 이 규칙과 어긋나는 곳이 없는지 본다. project 창 쪽 filter(`workspace.tsx`)는 `ds-shell-window`가 이미 `prj_`로 맞춘다. 두 task가 같은 wave라 한쪽이 먼저 merge되면 그 사이에는 coding 탭이 어느 창에도 안 뜰 수 있다(둘이 다 merge되면 맞다).
5. **test.** 위험 test 하나: `apps/tickets/coding/coding_test.ts`에서 앱 source가 domain에 이은 project의 폴더 안이면 계획의 `project`가 그 project, 이어지지 않은 project의 폴더 안이거나 lophn 자리면 `null`이다. 이미 있는 test가 계획 모양에 묶여 있으면 새 칸에 맞춘다.

## 끝남

- `deno task check`가 통과한다. core 기동은 `project-docs/plan/tools/lead/boot.sh`로 본다.
- 위험 test: "coding 계획의 project는 앱의 domain에 이은 project만 가리킨다".
- 남지 않음: `grep -rn "plan에는 project가 없다" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: project가 `null`일 때의 수신 규칙, port 이름
- 넘길 줄: 없음
- 계약 바꾸기 요청: 있으면 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: project가 둘 이상 같은 폴더를 가질 때 가장 안쪽 하나만 받는다. 그 밖에 안 되는 동작.
