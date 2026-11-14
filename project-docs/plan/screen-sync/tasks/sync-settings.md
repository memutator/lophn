# sync-settings

설정 화면(provider, model, 기기, agent, skill)과 sign-in을 공통 읽기로 옮긴다.

- 단위: sync (wave 3)
- 선행: sync-read.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/`(`use-reload.ts`는 빼고)
  - `packages/shell/renderer/conversation/use-slash-menu.tsx`
- 읽을 것:
  - 계획 README "정한 것"
  - roadmap: `project-docs/products/roadmap/screen-sync.md`의 "지금 코드 › 읽는 쪽"
  - issue: `project-docs/issues/provider-id-overwrite.yaml`
- 계약:
  - 쓰는 것: `useCoreRead`
  - 내놓는 것: 없음

## 할 일

1. mount, 창 focus, 자기가 쓴 뒤에만 읽는 화면을 `useCoreRead`로 바꾼다: `providers/provider-list.tsx`, `agents/agents-panel.tsx`, `browser/device-rows.tsx`, model 고르기, skill 목록.
2. `sign-in.ts`의 2초 polling을 지우고 OAuth 상태를 `useCoreRead`로 받는다. OAuth가 끝날 때 도는 route가 맞는 `changes`를 내는지 확인하고, 내지 않으면 "계약 바꾸기 요청"에 적는다.
3. `useReload`를 쓰는 panel 여섯(appearance, general, keyboard, connections, shell-rules, extension-packages)을 `useCoreRead`로 바꾼다. `use-reload.ts`는 지우지 않는다(`sync-fold`가 지운다).
4. `provider-id-overwrite`가 이 변경으로 고쳐지는지 보고에 적는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 소유 path에서 `grep -rn "useReload\|POLL_MS"`가 0줄이다(`use-reload.ts` 빼고).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
