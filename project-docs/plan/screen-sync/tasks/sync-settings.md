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

## lead가 더함

- wave 3의 셋(`sync-lists`, `sync-app-detail`, `sync-settings`)이 같이 돈다. route 정의(`changes`, `reads`)는 고치지 않는다. 빠졌거나 틀린 `changes`·`reads`는 "계약 바꾸기 요청"에 적으면 lead가 plan branch에 작은 commit으로 고치고 알린다.
- 화면이 `useCoreRead`로 바뀌면 gallery page가 그 route의 답을 fake source(`createFakeSource`의 route 답, `sync-read`가 더함)로 준다. 추가 소유: 옮긴 화면만 그리는 `tools/wireframes/`의 page·mock file. 다른 wave 3 task의 화면도 그리는 file(`tools/wireframes/mock/mock-desktop.tsx`, `shell-data.tsx`, `pages/screens/project-window.tsx` 같은 것)은 고치지 않는다. 답은 새 file `tools/wireframes/mock/core-answers/sync-settings.ts`에 두고 어디에 끼울지를 보고의 "등록할 것"에 적는다.
- 끝나기 전에 `npm run wireframes`와 `node tools/wireframes/smoke.ts`가 통과하고, 옮긴 화면의 gallery page가 옮기기 전처럼 채워져 보인다(빈 목록이나 failed가 아니다).
- 화면이 지금 기능마다의 `source.ts`·`core-source.ts`를 거쳐 읽으면, 그 읽기를 `useCoreRead`로 바꾸고 쓰는 곳이 없어진 source 함수와 그 fake는 지운다. 쓰기(command 호출)는 그대로 둔다.
- 앱 OAuth 로그인이 끝나면 core가 `secrets`(id는 secret 이름)를 낸다. `sign-in.ts`의 앱 OAuth 2초 polling은 이것으로 바꾼다. provider device login의 `providers/login-complete` 반복은 화면 polling이 아니라 발급자를 미는 일이라 그대로 둔다.
- `settings`의 id는 지금 null이다(`sync-fold`가 key로 바꾼다). 설정 화면은 key로 거르지 않고 `settings` 전체에 다시 읽는다.
