# screen-rest

`screen-lists`가 남긴 목록 쪽 일을 끝낸다. `screen-lists`는 `screen-terminals`보다 먼저 시작해 다른 기계의 터미널을 목록에 반만 붙였다. 이 task는 다른 기계의 터미널과 coding agent를 sidebar 목록에 온전히 붙이고, 다른 기계에서 바뀐 session 이름을 따라오게 하고, 명령 palette에 다른 기계의 project를 넣고, 탭과 card에 보이는 기계 꼬리표를 하나로 맞춘다.

- 단위: screen (wave 3)
- 선행: screen-lists, screen-terminals, screen-apps
- 소유(이 task만 고친다):
  - `packages/shell/renderer/shell/{use-left-sidebar.ts,left-sidebar-workspaces.ts,left-sidebar.tsx,left-sidebar.module.css,left-sidebar-model.ts,sidebar-memory.tsx,tab-strip.tsx,tab-strip.module.css}`
  - `packages/shell/renderer/workspace/sidebar/`
  - `packages/shell/renderer/workspace/kinds/{terminal.tsx,agent.tsx,app.tsx,app-screen.tsx}`(card 머리의 기계 꼬리표와 탭의 꼬리표 칸만)
  - `packages/shell/renderer/terminal/terminal-tab.tsx`(card 머리의 기계 꼬리표만)
  - `packages/shell/renderer/desktop/palette/`(다른 기계의 project 줄만)
  - `packages/design/i18n/catalog/{left-sidebar,remote-desk}.ts`
  - `tools/wireframes/pages/screens/shell/machines-scene.tsx`, `tools/wireframes/mock/machines-data.ts`
  - `project-docs/flows/areas/shell-desktop.yaml`(`machine-lists` flow만)
- 읽을 것:
  - 계획 README "정한 것", `screen-lists` brief와 `screen-terminals` brief(`project-docs/plan/one-screen/tasks/`)
  - architecture: `project-identity.md`("한 창의 목록"), `terminal-agent.md`("다른 기계의 터미널"), `remote.md`
  - code: `packages/shell/renderer/shell/use-left-sidebar.ts`(`MachineListsProvider`, 기계마다의 숨은 reader), `packages/shell/renderer/desktop/machines/{scope.tsx,data.ts,tab-scope.tsx}`(`machineData(machine).terminal`), `packages/shell/renderer/terminal/{machine-deps.ts,screen-copy.ts,store.ts}`, 폰이 기계마다 `coding_sessions/list`를 읽는 길(`packages/mobile/src/data/every.tsx`)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/flows/SKILL.md`
- 계약:
  - 쓰는 것: `MachineScope`·`useMachineHub`·`machineData`, `MachineTag`(`left-sidebar.tsx`), 기기 route 목록의 `terminals/list`·`coding_sessions/list`와 event `TerminalRuntimeChanged`·`StateChanged{coding_sessions}`
  - 내놓는 것: 없음

## 할 일

1. 다른 기계의 터미널 줄: sidebar가 그 기계의 터미널 store(`machineData(machine).terminal`)를 읽어 줄을 세우고, 그 store가 바뀌면 다시 그린다. 줄을 고르면 그 기계의 탭(`TabItem.machine`)으로 열고 그 기계의 store를 쓴다(지금은 이 workspace의 store를 쓴다).
2. 다른 기계의 coding agent: 그 기계의 화면에서 시작한 coding agent session도 목록에 선다. 기계마다 `coding_sessions/list`를 읽고 `StateChanged{coding_sessions}`에 다시 읽는다(폰이 하는 길과 같다).
3. session 이름: 다른 기계에서 바꾼 이름이 그 기계의 event로 바로 따라온다. 이름을 읽는 hook 둘이 memory 칸 하나를 같이 써 workspace를 바꾸면 이름이 잠깐 다시 읽히는 것도 고친다.
4. palette: 다른 기계의 project가 꼬리표와 함께 나오고, 고르면 목록에서 고른 것과 같은 길로 연다.
5. 꼬리표를 하나로: 다른 기계의 탭은 탭 strip의 이름 옆에 `MachineTag` 칩을 단다. 터미널 card 머리의 "Home server"와 앱 card 머리의 "On Home server"를 같은 칩으로 바꾼다. 이 컴퓨터의 것에는 달지 않는다.
6. 안 쓰게 된 것: `SidebarValues`의 `projects`·`apps` 칸(`sidebar-memory.tsx`)과 `SettingsFrame`의 `machines` prop이 정말 쓰는 곳이 없으면 지운다.
7. wireframe page(`shell-left-sidebar-machines` 등)에 다른 기계의 터미널 줄과 탭 꼬리표가 보이게 mock을 고치고 직접 찍어 본다. flows의 `machine-lists`를 맞춘다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`와 `npm run wireframes`가 된다.
- 위험 test: 없음(화면이다). 다른 기계의 줄을 고를 때 틀린 기계의 store를 쓰지 않는 것은 type으로 막는다(줄이 자기 기계를 들고 다닌다).
- subprocess·서버 test와 E2E는 만들지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
