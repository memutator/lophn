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
