# hr-screen-data

사람이 고른 hr-screen-wireframe의 모양에 실제 data를 잇는다: workspace source가 `ListRuns`를 읽고, sidebar의 session 목록에서 run이 연 session(`session_opened`)을 빼 그 run 아래로 옮긴다.

- 단위: screen (wave 3)
- 선행: hr-screen-wireframe. 사람이 gallery의 모양을 고른 뒤에 띄운다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/panel-sessions.ts`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/source.ts`
  - `packages/shell/renderer/workspace/core-source.ts`
  - `packages/shell/renderer/workspace/fake-source.ts`
  - `packages/shell/renderer/desktop/main.tsx`
- 읽을 것:
  - brief `project-docs/plan/headless-run/tasks/hr-screen-wireframe.md`의 "내놓는 것"과 "정한 것", 그 task가 merge한 gallery page `new-agent-sidebar-runs`, `new-app-runs`, `new-app-runs-empty`. 사람이 gallery에서 brief와 다른 모양을 골랐으면 lead가 이 brief 끝에 적는다
  - 계약: `project-docs/plan/headless-run/tasks/hr-contract-runs.md`의 `ListRuns`(`runs/list`, read, actor user, 입력 `{ session?, state?, cursor? }`, 출력 `withReadCommon({ runs })`, 새것이 앞)와 `runRecordSchema`
  - 계획: `project-docs/plan/headless-run/README.md` "뼈대 검토에서 정한 것"의 화면 줄(run이 연 session만 묶는다, `--session` session은 원래 자리)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - renderer:
    - `packages/shell/renderer/workspace/core-source.ts`의 `collect`(read page를 끝까지 모으는 꼴)와 응답 모양 interface들
    - `packages/shell/renderer/workspace/sidebar/panel-sessions.ts`의 `agentRow`·`panelSessions`. `agentRow`는 `packages/shell/renderer/workspace/use-tab-host-slices.ts`도 쓴다(이 task의 file이 아니다)
    - `packages/shell/renderer/workspace/workspace.tsx`의 `knownSessions` effect, `openSessionTab`, `<ProjectSidebar>` 자리
    - `packages/shell/renderer/desktop/main.tsx`의 `<AppSpace>`(`agents={workspace?.agentsSource}`처럼 넘긴다). 앞 계획 land 뒤 path 확인(`problem-remove`의 `pr-issues-ui-screen`이 이 file의 AppSpace props를 고친다)
    - hr-screen-wireframe이 만든 `packages/shell/renderer/workspace/sidebar/run-list.tsx`(`RunRecordView`), `use-agent-panel.ts`(`PanelRun`), `packages/shell/renderer/app-frame/app-runs.ts`(앱 공간이 읽는 때와 거르는 규칙)
  - renderer가 부를 수 있는 route: `packages/shell/main/desktop/core/allowlist.ts`, `packages/shell/main/desktop/core/routes.ts`(read는 `packages/protocol/mod.ts`의 `ALL_ROUTES`에 있으면 열린다)
- 계약:
  - 쓰는 것: hr-contract-runs의 `ListRuns`(`runs/list`, actor user)와 run 기록, hr-screen-wireframe의 run 묶음 props(`ProjectSidebar`의 `runs?: readonly PanelRun[]`, `PanelRun`, `RunRecordView`, `AppSpace`의 `runs?: () => Promise<ReadResult<readonly RunRecordView[]>>`)
  - 내놓는 것: 없음

## 정한 것

- **run 기록은 `WorkspaceSource` 하나가 읽는다.** project 창과 앱 공간이 같은 함수를 쓴다. 앱 공간에는 `desktop/main.tsx`가 `agents={workspace?.agentsSource}`처럼 넘긴다. 이유: 같은 route를 두 source가 따로 부르지 않는다. 앱 공간에서 거르고 줄로 옮기는 일은 hr-screen-wireframe의 `app-runs.ts`가 이미 한다.
- **다시 읽는 때(project 창): 처음과 `sessionStates`가 바뀔 때마다.** 이유: run event는 계약에 없다. session store는 `TurnStarted`·`TurnEnded`·물음 event로 바뀌고, agent run은 그 turn의 `TurnEnded`로 끝나므로 상태가 따라온다. 읽을 때마다 page를 처음부터 모은다(`collect`의 상한까지). sidebar는 그중 5개만 보인다(hr-screen-wireframe 정한 것 2).
- **tool run은 project sidebar에 넘기지 않는다.** 앱 공간 몫이다(hr-screen-wireframe 정한 것 3).

## 할 일

추가(planner, 살 단계 뒤): run은 `ListRuns`의 filter로 읽는다. 앱 space는 `place: {app}` 하나로, project sidebar는 `place: {project}`와 `agent: lophn`으로 읽는다. 모든 page를 읽어 화면에서 거르지 않는다.

1. `packages/shell/renderer/workspace/source.ts`: `WorkspaceSource`에 `runs(): Promise<ReadResult<readonly RunRecordView[]>>`를 더한다(주석: run 기록, 새것이 앞. project sidebar와 앱 공간이 읽는다). `RunRecordView`는 `./sidebar/run-list.tsx`에서 type으로 import한다.
2. `packages/shell/renderer/workspace/core-source.ts`: `collect(core, "runs", "list", {}, …)`로 page를 모으고 `RunRecordView`의 일곱 칸(`id`, `kind`, `target`, `session`, `session_opened`, `state`, `created_at`)만 옮긴다. 응답 모양 interface(`RunListValue`, `runs`와 `next_cursor`)를 다른 응답 모양 옆에 둔다. 실패는 다른 읽기와 같이 `{ ok: false, message: <오류 code> }`다.
3. `packages/shell/renderer/workspace/fake-source.ts`: `fakeWorkspaceSource`의 option에 `runs?: readonly RunRecordView[]`(기본 빈 목록)를 더하고 그대로 돌려준다. 기본값이라 dev:mock(`desktop/dev-seed.ts`는 fake를 펼쳐 쓴다)과 gallery의 `MockDesktop` page 모양은 바뀌지 않는다.
4. `packages/shell/renderer/workspace/sidebar/panel-sessions.ts`:
   - `agentRow(entry, agents, project)`의 몸을 agent ref(`CallAgent | null`)를 받는 함수로 떼고 `agentRow`는 그것을 부르게 한다. session과 run이 같은 규칙을 쓴다(사본을 만들지 않는다). `agentRow`의 signature는 그대로라 `use-tab-host-slices.ts`를 고치지 않는다.
   - `panelRuns(records, agents, project, sessions: readonly PanelSession[]): PanelRun[]`를 더한다. `kind`가 agent이고 위 함수가 agent 줄을 찾는 run만 남긴다(lophn, 이 project의 Project Manager, 이 project의 Operator). `agent`는 그 줄의 `assignment`, `at`은 `Date.parse(created_at)`, `session`은 `session_opened`이고 `sessions`에 그 id가 있으면 그 `PanelSession`, 아니면 null이다.
   - run이 연 session id 모음(`session_opened`인 run의 `session`)을 내는 작은 함수를 더한다.
5. `packages/shell/renderer/workspace/workspace.tsx`:
   - `source.runs()`를 처음과 `sessionStates`가 바뀔 때마다 읽어 state에 둔다(`knownSessions` effect와 같은 꼴, `live` guard, 실패하면 앞 값을 둔다).
   - `<ProjectSidebar>`에 `runs={panelRuns(...)}`를 넘기고, `sessions`에는 `panelSessions(...)`에서 run이 연 session을 뺀 것을 넘긴다. 같은 `panelSessions` 결과를 두 곳에 쓴다.
   - `openSessionTab`(toast, 시작 route)은 지금처럼 `panelSessions` 전체를 본다. run이 연 session도 탭으로 열려야 한다.
6. `packages/shell/renderer/desktop/main.tsx`: `<AppSpace>`에 `runs={workspace === undefined ? undefined : () => workspace.runs()}`를 넘긴다. 다른 줄은 고치지 않는다. 앞 계획 land 뒤 path 확인.
7. route가 열려 있는지 본다: `packages/protocol/mod.ts`의 `ALL_ROUTES`에 hr-contract-runs의 `RUN_ROUTES`가 없으면 renderer의 `read:runs/list`가 allowlist(`packages/shell/main/desktop/core/allowlist.ts`)에서 막힌다. 고치지 말고 "등록할 것"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고 gallery 모양이 바뀌지 않는다(이 task는 gallery file을 고치지 않는다).
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.
- 위험 test: 없음. 화면이다.
- 남지 않음:
  - `grep -rn '"runs",' packages/shell/renderer --include=*.ts --include=*.tsx`가 `packages/shell/renderer/workspace/core-source.ts` 한 곳이다(route를 부르는 곳이 하나다).
  - `grep -rln "session_opened" packages/shell/renderer`가 `workspace/core-source.ts`, `workspace/sidebar/panel-sessions.ts`, `workspace/sidebar/run-list.tsx`, `app-frame/app-runs.ts`뿐이다.
  - `git diff --name-only plan/headless-run...HEAD`에 `packages/shell/renderer/workspace/use-tab-host-slices.ts`가 없다.
- 실제 core에서 run을 만들어 화면을 보는 확인은 하지 않는다(model provider와 CLI를 부르는 확인은 사람이 한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. 할 일 7에서 `ALL_ROUTES`에 `RUN_ROUTES`가 없었으면 그것
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: hr-screen-wireframe의 props나 hr-contract-runs의 `ListRuns`를 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
