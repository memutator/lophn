# tab-owner-hand

사람이 browser 탭을 이 기계의 session에 넘기고 되찾는다. 길은 셋이다: 탭을 sidebar의 session 줄에 끌어 놓기, 그 agent의 주인 chip에 끌어 놓기, 탭 menu의 "Hand to". 넘겨도 탭의 자리와 key는 그대로이고 주인만 바뀐다. 넘겨받은 탭은 agent가 그 page를 다룰 수 있도록 core 표에 오르고(page를 창이 살려 두고, view session과 상태를 알린다), 창이 core에 다시 붙으면 다시 알린다. 사람은 Take control로 끼어들고 "Take back"으로 되찾는다.

- 단위: tab-owner (wave 3)
- 선행: tab-owner-core, tab-owner-screen, tab-owner-sidebar. `tabs/hand`, 주인 chip과 `useOwner()`, sidebar의 session 줄이 거기서 온다.
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/core/allowlist.ts`
  - `packages/shell/renderer/workspace/hand.ts`
  - `packages/shell/renderer/workspace/use-surface-requests.ts`
  - `packages/shell/renderer/app-frame/workspace-views.tsx`
  - `packages/shell/renderer/app-frame/webview-host.tsx`
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/shell/renderer/browser/browser-chrome.tsx`
  - `packages/shell/renderer/shell/tab-menu.tsx`
  - `packages/shell/renderer/shell/tab-drag.tsx`
  - `packages/shell/renderer/shell/left-sidebar.tsx`
  - `packages/shell/renderer/shell/taskbar/float-chips.tsx`
  - `packages/shell/renderer/workspace/workspace-window.tsx`
  - `tools/wireframes/pages/screens/shell.tsx`
  - `tools/wireframes/pages/screens/shell/shell-scene.tsx`
  - `project-docs/flows/areas/shell-workspace.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/tab-scope/README.md`("주인은 두 곳에 있고 뜻은 하나다", "넘기기는 browser 탭만이고 주인이 바뀐다")
  - 제품 결정: `project-docs/products/roadmap/tab-owner.md`의 "넘기기"와 "정한 것" 2·5·6·7
  - architecture: `project-docs/architecture/workspace-layout.md`의 "`<webview>` 그릇과 층 순서", "agent가 연 탭"(창 단위 receiver, 상한 12, 닫힘 알림), `project-docs/architecture/browser-tab.md`의 지키는 것 34·35·37·40(take control)·41
  - 이슈: `project-docs/issues/agent-browser-page-duplicated-across-windows.yaml`(같은 workspace를 두 창이 mount하면 page가 둘. 넘긴 탭도 같은 bind 규칙을 탄다. 이 task는 고치지 않는다)
  - skill: `.claude/skills/ui-design/SKILL.md`
  - 코드: `packages/shell/renderer/workspace/use-surface-requests.ts`(`useAgentControl`, host 탭 닫힘 알림), `packages/shell/renderer/app-frame/workspace-views.tsx`(`isAgentPage`, 상한, `subscribeState`의 `host:` 판정), `packages/shell/renderer/app-frame/webview-host.tsx`(`agent: kind === "browser" && key.startsWith("host:")`), `packages/shell/renderer/shell/tab-drag.tsx`(`data-drop-workspace` 끌어 놓기), `packages/shell/renderer/shell/tab-menu.tsx`, `packages/shell/main/desktop/core/allowlist.ts`(`RENDERER_MEMORY_ROUTES`), `packages/shell/renderer/desktop/connection/events/store.ts`(`syncOnReady`, core에 다시 붙음)
- 계약:
  - 쓰는 것: route `tabs/hand`(입력 `{tab?, session, workspace, profile?, url}`, 출력 `{tab}`, 사람만. 없는·닫힌 session은 `not_found`, agent가 연 탭은 `conflict`. `tab-owner-core`), `shell:surface-report`의 `{tab, state: "closed"}`(core 표에서 뺀다)와 `{bind: {tab, view_session}}`(그대로), `TabItem.owner`·`handedTab`·`hostTabOf()`(`tab-owner-layout`), `useOwner()`와 주인 chip(`tab-owner-screen`), sidebar session 줄(`tab-owner-sidebar`).
  - lead가 이 wave를 띄우기 전에 catalog에 넣어 두는 key(이 task는 catalog를 고치지 않는다. 이 wave의 catalog는 `browser-profile-settings`가 고친다): `"shell.button.tab-hand": "Hand to"`, `"shell.button.tab-take-back": "Take back"`, `"shell.text.tab-hand-none": "No running session on this computer"`, `"shell.toast.tab-hand-failed": "Couldn't hand this tab over. Try again."`. 다른 문구가 꼭 필요하면 "계약 바꾸기 요청"에 적는다.
  - 내놓는 것: 없음(화면과 창 쪽 동작).

## 할 일

1. `allowlist.ts`의 `RENDERER_MEMORY_ROUTES`에 `"memory:tabs/hand"`를 더한다(머리 주석 목록에도 한 줄).
2. `workspace/hand.ts`(새 file): `handTab(core, tab: TabItem, session, workspace)`가 `tabs/hand`를 부르고(`tab: hostTabOf(tab) ?? undefined`, `profile: fields.profile`, `url: fields.url`) 성공하면 그 탭에 `owner: session, handedTab: <id>`를 적는다. 되찾기(`takeBack`)는 `owner`·`handedTab`을 지운다(아래 3이 core에 알린다). 넘길 수 있는 탭: kind `browser`이고 transient·native popup이 아니며, 주인이 없거나(사람) 이미 넘긴 탭. agent가 연 탭(주인이 있고 `handedTab`이 없는 `host:` 탭)은 넘기지 않는다.
3. core 탭 id를 `hostTabOf()` 하나로 찾게 옮긴다: `use-surface-requests.ts`의 닫힘 알림(창의 탭에서 core 탭 id가 사라지면 `closed`. 닫기와 되찾기가 같은 길), `useAgentControl`(key 대신 core 탭 id를 받는다), `workspace-views.tsx`의 상태 알림·`touch`·`keyOf`가 key → core 탭 id를 창의 탭 값에서 읽는다, `webview-host.tsx`의 `agent` 판정은 `host:` key이거나 넘긴 탭이다(넘긴 탭의 page도 workspace를 떠나도 살고 agent page 상한 12에 센다. `setAgentPage(key, on)` 같은 손잡이로 넘기고 되찾을 때 바꾼다). 상한으로 넘긴 탭의 page를 놓으면 core에 `closed`를 알리고 그 탭의 `owner`·`handedTab`을 지운다(탭은 사람의 것이라 layout에서 빼지 않는다).
4. 다시 알리기(README 정한 것 1): 창이 workspace layout을 다 읽었을 때와 core에 다시 붙었을 때(`syncOnReady`와 같은 ready 신호) 그 창의 layout(모든 desk의 tabs·floats·detached)과 전역 float에서 `handedTab`이 있는 탭마다 `tabs/hand {tab, session: owner, workspace, profile, url}`을 부른다. `not_found`(session이 끝남)나 `conflict`면 그 탭의 `owner`·`handedTab`을 지운다.
5. 넘기는 길 셋: `tab-menu.tsx`에 "Hand to" 하위 menu(이 기계의 열린 lophn session. 지금 workspace의 것이 먼저, 이름과 `useOwner()` 얼굴, 없으면 `shell.text.tab-hand-none`)와 넘긴 탭의 "Take back". `tab-drag.tsx`가 `[data-drop-session]`(값은 session id) 위에 놓으면 넘기기로 끝낸다(workspace 줄 놓기와 같은 꼴). `left-sidebar.tsx`의 이 기계 lophn session 줄과 `float-chips.tsx`의 주인 chip에 `data-drop-session`을 단다. `workspace-window.tsx`가 menu 상태(`TabMenuState`에 `handable`, `handed`)와 놓기를 `hand.ts`로 잇고, 실패하면 `shell.toast.tab-hand-failed` toast를 띄운다.
6. take control 줄: 넘긴 탭에서 agent가 다루기 시작하면 지금 줄([Take control]·[Hand back])이 그대로 서고, 넘긴 탭이면 줄에 [Take back]을 더한다(`browser-chrome.tsx`의 `AgentControlBar`, `browser-tab.tsx`, `kinds/browser.tsx`가 `handedTab`을 넘긴다).
6-1. (lead가 더함, `tab-owner-core`의 독립 review가 찾음) 넘긴 탭은 page가 스스로 닫지 못한다. 지금은 주인 agent가 `lophn browser evaluate <탭> "window.close()"`를 돌리거나 그런 page로 가면 page의 close 요청 → `browser-tab.tsx`의 `onCloseRequested` → `kinds/browser.tsx`가 `host.removeTab`을 불러 사람의 탭이 사라지고 core의 "넘겨받은 탭은 닫지 못한다"가 뚫린다. `kinds/browser.tsx`의 `onCloseRequested`가 `handedTab`이 있는 탭이면 닫지 않는다(page의 요청을 무시한다). 사람이 탭을 닫는 길(탭의 X, 단축키)은 그대로다.
7. gallery: `shell.tsx`에 넘긴 browser 탭(주인 avatar, take control 줄의 Take back)과 "Hand to" 하위 menu를 편 상태를 drive로 보이는 page를 더한다(id `shell-tab-hand`). fake data는 `shell/shell-scene.tsx`와 `tools/wireframes/mock/tab-owners.ts`(wave 2가 만든 file. 읽기만 하고 모자라면 shell-scene 안에 둔다).
7-1. (lead가 더함, `tab-owner-sidebar`를 받으며) gallery의 `shell-left-sidebar-project`(빠른 실행 줄을 보이는 page)가 팀 tree 전용 data로 바뀌어 전에 보이던 것(Home의 session, desk 묶음 이름 줄 Main·weekly-review, workflow 줄, coding agent 줄, Recent, 다른 workspace Grocery·Orders)이 사라졌다. `tab-owner-sidebar`는 `shell.tsx`를 고칠 수 없어 그 page를 빌려 썼다. 그 page를 전의 data로 되돌리고, 팀 tree와 편 session 줄은 새 page `shell-left-sidebar-team`(제목 "Shell · Left sidebar · Team", 설명은 한국어 한두 문장: coordinator 밑에 자식과 손자가 들여쓰기로 서고, 편 줄 아래에 그 session이 주인인 탭이 나온다)으로 옮긴다. 추가 소유: `tools/wireframes/pages/screens/shell/sidebar-scene.tsx`, `tools/wireframes/mock/team-tree.ts`. 두 page를 찍어 본다.
8. flows `shell-workspace.yaml`: 사람이 탭을 넘기는 동작(세 길)과 되찾기를 `ui:` flow로 쓰고 `route:tabs/hand`를 `uses`에 단다. `node tools/flows.ts check`.

정한 것:
- 되찾기는 core에 새 route를 두지 않고 닫힘 알림(`closed`)으로 표에서 뺀다. 창의 탭에서 core 탭 id가 사라지는 일은 닫기와 되찾기가 같다.
- "Hand to"에는 lophn session만 선다. 터미널의 coding agent는 사람 token으로 돌아 주인이 사람이라 넘길 상대가 아니다.

## 끝남

- `npm run check`가 통과하고 `node packages/shell/renderer/build.ts`가 된다.
- 위험 test: 없음(넘겨받은 탭을 agent가 닫지 못하는 것과 `tabs/hand`의 검사는 core의 queue test가 본다).
- 남지 않음: `grep -rn 'startsWith("host:")\|"host:".length' packages/shell/renderer/app-frame packages/shell/renderer/workspace/use-surface-requests.ts`가 `webview-host.tsx`의 agent 판정 밖에서 0줄이다(core 탭 id는 `hostTabOf()`로만 찾는다).
- `npm run wireframes`가 되고 gallery의 `shell-tab-hand`가 고친 renderer component로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
