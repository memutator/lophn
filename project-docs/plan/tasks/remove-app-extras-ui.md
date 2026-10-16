# remove-app-extras-ui

앱 공간(app-detail)에서 Automations 탭, Tasks 탭, Data 탭을 지운다. 앱 automation은 보류라 코드도 지우고, ticket은 사람 화면에 따로 보이지 않으며 사람은 ticket을 만들지 않는다. 앱 data export는 모두 지운다. 나머지 탭(Access, Activity, Connections, Issues, Version)은 wave 3 screens-app-space 몫이라 건드리지 않는다.

- 단위: remove-app-extras (wave 1)
- 선행: remove-platform-renderer (같은 renderer file `desktop/entry.tsx`·`main.tsx`·`dev-mock/*`를 고쳐서 순서를 건다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/app-frame/app-detail/automations/`
  - `packages/shell/renderer/app-frame/app-detail/tasks/`
  - `packages/shell/renderer/app-frame/app-detail/data/`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다. 모두 지운 탭을 쓰던 곳이다):
  - 앱 공간(screens-app-space 몫): `packages/shell/renderer/app-frame/app-detail/{app-detail.tsx, source.ts, core-source.ts, testdata/fake-source.ts}`, `packages/shell/renderer/app-frame/app-space.tsx`
  - Workspace(screens-workspace 몫): `packages/shell/renderer/desktop/{entry.tsx, main.tsx}`, `desktop/dev-mock/{app-space.ts, mod.ts}`
  - 등록(lead): `packages/shell/renderer/desktop/router.ts`의 `taskTarget`
- 읽을 것:
  - spec: 없음. 삭제 목록 — `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장(export 전부), 2장(앱 automation)
  - inventory: `U1.4#1`, 그리고 ownership 폴더가 이 단위라 이 task가 하는 `U1.4#4`(Tasks 탭 전부)와 `U1.4#8`(Data 탭 전체) — `../assignment.md`에서 이 task가 맡은 줄. 표는 `/home/pyosechang/projects/lophn/project-docs/tmp/ui-inventory.md` 1.4장
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만 한다)

## 할 일

1. 세 폴더를 지운다. (U1.4#1, U1.4#4, U1.4#8)
   - `automations/automations-tab.tsx`
   - `tasks/`(`tasks-tab.tsx`, `task-detail.tsx`, `start-panel.tsx`, `model.ts`, `source.ts`, `core-source.ts`, `testdata/`)
   - `data/data-tab.tsx`
2. 추가 소유가 승인됐으면 쓰던 곳을 고친다.
   - `app-detail.tsx`: Automations·Data·Tasks 탭과 panel, `tasks` prop, `initialTab`의 `tasks` 값. Access·Activity·Connections·Issues·Version 탭은 그대로 둔다.
   - `source.ts`·`core-source.ts`·`testdata/fake-source.ts`: `automations` 읽기, `exportApp`, Data 탭이 읽던 항목.
   - `app-space.tsx`: `tasks` source prop, `taskTarget`, `initialTask`, `initialCreate`, Tasks 탭으로 여는 분기.
   - `desktop/main.tsx`: `tasks` source, `lophn://…/<ticket id>`·`<app id>` Task 링크 처리(앱 공간의 Tasks 탭으로 가는 분기. 읽지 못하면 things-to-confirm으로 가던 분기도). `desktop/entry.tsx`의 `tasks` core source 연결, `dev-mock/{app-space,mod}.ts`의 해당 항목. `router.ts`의 `taskTarget`은 "등록할 것"이다. check가 깨지지 않을 만큼만 뺀다.
3. wording key는 고치지 않는다(wording-split의 생성물). 쓰는 곳 없는 key는 cleanup이 지운다.
4. 문자열로만 남은 것을 grep으로 찾는다: `lophn://` Task 링크 형식, 탭 이름 `"tasks"`·`"automations"`·`"data"`.
5. `deno task check`를 돈다. `deno task wireframes`도 돌려 gallery의 `app-space` page가 그려지는지 본다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "TasksTab\|TasksSource\|AutomationsTab\|DataTab\|taskTarget\|initialTask\|exportApp" packages tools`가 0줄이다(`router.ts`의 `taskTarget`만 등록 file이라 남아도 된다. 남았으면 보고에 적는다).

## 보고

- 바꾼 file
- 등록할 것: `desktop/router.ts`의 `taskTarget` 항목, gallery에 지운 탭을 직접 그리는 page가 있으면 그 이름
- 안 쓰게 된 export: `confirmation/kinds/release-activation/release-activation.tsx`가 automation 요약을 보이면 그 이름(screens-data 몫), `app-detail/model.ts`의 `taskChecksText`와 Version 탭의 Task 확인 줄(`U1.4#6`, screens-app-space)
- 정한 것: 없으면 "없음"
- 걱정: Tasks 탭이 coding agent를 시작하던 화면이다. 맡기는 길은 wave 3 coding-agent·screens-conversation이 새로 짓는다. 그 사이 화면에서 coding agent를 시작할 수 없다
- 계약 바꾸기 요청: 없음
