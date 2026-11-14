# sync-lists

agent, project, 앱 목록과 session 이름을 공통 읽기로 옮긴다.

- 단위: sync (wave 3)
- 선행: sync-read.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/shell/{use-left-sidebar.ts,workspaces-panel.tsx}`
  - `packages/shell/renderer/workspace/agents/`
  - `packages/shell/renderer/apps/`
  - `packages/shell/renderer/workspace/` 아래 project 설정 화면
- 읽을 것:
  - 계획 README "정한 것"
  - roadmap: `project-docs/products/roadmap/screen-sync.md`의 "지금 코드 › 읽는 쪽"
- 계약:
  - 쓰는 것: `useCoreRead`
  - 내놓는 것: 없음

## 할 일

1. 손으로 짠 effect와 `reads` counter, 자기가 쓴 뒤의 `reload`를 `useCoreRead`로 바꾼다: agent 목록(`workspace/agents/agents-page.tsx`), project와 앱 목록(`shell/use-left-sidebar.ts`, `shell/workspaces-panel.tsx`), project 설정 화면, `apps/`.
2. session 이름을 창 focus에 다시 읽는 것(`use-left-sidebar.ts`의 "다른 창에서 바꾼 이름은 이 창에 event가 없다")을 지우고 `useCoreRead`로 받는다.
3. shell이 정본인 것(다른 workspace의 탭 layout, 전역 float)의 focus 다시 읽기는 그대로 둔다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- 소유 path에 core 목록을 mount에서만 읽는 effect가 남지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.

## lead가 더함

- wave 3의 셋(`sync-lists`, `sync-app-detail`, `sync-settings`)이 같이 돈다. route 정의(`changes`, `reads`)는 고치지 않는다. 빠졌거나 틀린 `changes`·`reads`는 "계약 바꾸기 요청"에 적으면 lead가 plan branch에 작은 commit으로 고치고 알린다.
- 화면이 `useCoreRead`로 바뀌면 gallery page가 그 route의 답을 fake source(`createFakeSource`의 route 답, `sync-read`가 더함)로 준다. 추가 소유: 옮긴 화면만 그리는 `tools/wireframes/`의 page·mock file. 다른 wave 3 task의 화면도 그리는 file(`tools/wireframes/mock/mock-desktop.tsx`, `shell-data.tsx`, `pages/screens/project-window.tsx` 같은 것)은 고치지 않는다. 답은 새 file `tools/wireframes/mock/core-answers/sync-lists.ts`에 두고 어디에 끼울지를 보고의 "등록할 것"에 적는다.
- 끝나기 전에 `npm run wireframes`와 `node tools/wireframes/smoke.ts`가 통과하고, 옮긴 화면의 gallery page가 옮기기 전처럼 채워져 보인다(빈 목록이나 failed가 아니다).
- 화면이 지금 기능마다의 `source.ts`·`core-source.ts`를 거쳐 읽으면, 그 읽기를 `useCoreRead`로 바꾸고 쓰는 곳이 없어진 source 함수와 그 fake는 지운다. 쓰기(command 호출)는 그대로 둔다.
