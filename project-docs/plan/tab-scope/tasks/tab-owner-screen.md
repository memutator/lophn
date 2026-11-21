# tab-owner-screen

화면이 탭의 주인과 browser profile을 그린다. agent가 연 탭에 주인을 적고, 탭 줄과 group 칸의 머리, float bar, detached 창 제목, 전역 float이 주인 avatar를 보이고, 접힌 float chip을 주인마다 하나로 묶고, "Agent is controlling this tab"이 어느 agent인지 말한다. browser 탭 머리에 profile(기본이 아닐 때)을 보이고, 새 browser 탭을 열 때 profile을 고른다.

- 단위: tab-owner (wave 2)
- 선행: tab-owner-core, tab-owner-layout, browser-profile-partitions. 주인 칸(`TabItem.owner`), `tab_open`의 `owner`, `fields.profile`과 `useBrowserProfiles()`가 그 셋에서 온다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/use-surface-requests.ts`
  - `packages/shell/renderer/app-frame/workspace-views.tsx`
  - `packages/shell/renderer/workspace/kinds/agent.tsx`
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/parts/agent-session/owner.tsx`
  - `packages/shell/renderer/shell/tab-strip.tsx`
  - `packages/shell/renderer/shell/tab-strip.module.css`
  - `packages/shell/renderer/shell/content-card.tsx`
  - `packages/shell/renderer/shell/content-card.module.css`
  - `packages/shell/renderer/shell/float-layer.tsx`
  - `packages/shell/renderer/shell/float-layer.module.css`
  - `packages/shell/renderer/shell/taskbar/float-chips.tsx`
  - `packages/shell/renderer/shell/taskbar/float-chips.module.css`
  - `packages/shell/renderer/shell/taskbar/taskbar.tsx`
  - `packages/shell/renderer/shell/global-floats/global-float-layer.tsx`
  - `packages/shell/renderer/shell/global-floats/global-float-layer.module.css`
  - `packages/shell/renderer/workspace/detached/detached-space.tsx`
  - `packages/shell/renderer/workspace/detached/detached-space.module.css`
  - `packages/shell/renderer/browser/browser-chrome.tsx`
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/shell/renderer/browser/browser-tab.module.css`
  - `packages/shell/renderer/workspace/app-preview-tab.tsx`
  - `packages/shell/renderer/workspace/add-tab-menu.tsx`
  - `packages/shell/renderer/workspace/workspace-window.tsx`
  - `packages/design/i18n/catalog`
  - `tools/wireframes/pages/screens/shell.tsx`
  - `tools/wireframes/pages/screens/shell/shell-scene.tsx`
  - `tools/wireframes/pages/screens/project-float/pages.tsx`
  - `tools/wireframes/pages/screens/project-detached/pages.tsx`
  - `tools/wireframes/pages/screens/browser/pages.tsx`
  - `tools/wireframes/mock/tab-owners.ts`
- 읽을 것:
  - 계획: `project-docs/plan/tab-scope/README.md`("주인은 두 곳에 있고 뜻은 하나다", "탭의 profile")
  - 제품 결정: `project-docs/products/roadmap/tab-owner.md`의 "화면이 주인을 그린다", `project-docs/products/roadmap/browser-profile.md`의 "다는 자리"
  - architecture: `project-docs/architecture/workspace-layout.md`의 "float"(전역 float), "detached 창", "agent가 연 탭"
  - skill: `.claude/skills/ui-design/SKILL.md`(gallery는 실제 renderer component를 fake source로 그린다. 화면 규칙)
  - 코드: `packages/shell/renderer/workspace/use-surface-requests.ts`(`placementOf`, 갈래마다 탭 열기), `packages/shell/renderer/workspace/workspace-window.tsx`의 `stripTab`(약 1647줄), `floatChips`·`globalChips`(약 3084줄), `NewTabMenu`의 `onBrowser`(약 3215줄), `packages/shell/renderer/shell/taskbar/float-chips.tsx`, `packages/shell/renderer/parts/agent-session/agent-session.tsx`(`AgentFace`, `AgentFaceIcon`), `packages/shell/renderer/shell/left-sidebar-workspaces.ts`(session → agent 얼굴을 짓는 법), `packages/shell/renderer/desktop/connection/events/hooks.tsx`(`useSessions`)
- 계약:
  - 쓰는 것: `TabItem.owner`·`handedTab`·`hostTabOf()`(`packages/shell/renderer/workspace/model.ts`, `tab-owner-layout`), `tab_open` payload의 `owner?: ses_`(`packages/protocol/lophn-agent/host-queue.ts`), 탭 값 `fields.profile`, `openBrowserTab(host, url, {profile})`, `useBrowserProfiles()`·`partitionOf()`(`packages/shell/renderer/browser/profiles.tsx`, `browser-profile-partitions`).
  - 내놓는 것: `packages/shell/renderer/parts/agent-session/owner.tsx`(새 file) — `useOwner(owner: string | undefined): { name: string; face: AgentFace } | null`(session의 agent 이름과 얼굴. 모르는 session은 이름 "Agent"와 기본 얼굴), `OwnerMark`(avatar 하나를 그리는 작은 component). gallery·fake는 context로 고정 값을 준다. wave 3의 `tab-owner-hand`가 chip과 menu에서 쓴다. `FloatChip`에 주인 묶음을 더한 모양(아래 4).

## 할 일

1. 주인 적기: `use-surface-requests.ts`의 모든 갈래(session, terminal, preview, artifact, browser, mount 전에 만든 page의 자리 잡기)가 열린 탭 값에 `owner: request.payload.owner`를 단다(없으면 칸이 없다). 이미 이 창에 있는 host 탭에 `tab_open`이 다시 오면(preview·artifact 주인 바뀜) `patchTab`으로 `owner`만 고친다. session 탭은 `kinds/agent.tsx`의 `SessionTabOpen`에 `owner?: string`을 더해 `openSession`이 단다. `workspace-views.tsx`의 `HostPlacement`에 `owner: string | null`을 더해 미뤄 둔 자리에도 간다.
2. 주인 얼굴: `parts/agent-session/owner.tsx`를 만든다. 주인이 없는 탭(사람)은 아무것도 그리지 않는다.
3. 탭 줄과 group 칸 머리: `stripTab`이 `StripTab`에 주인을 싣고 `tab-strip.tsx`가 kind 아이콘 옆에 작은 avatar를 그린다(tooltip에 이름). `content-card.tsx`의 칸 머리도 같다. browser 탭이면 기본이 아닌 profile을 색 점과 이름 tooltip으로 같은 자리에 보인다(`useBrowserProfiles()`로 이름·색을 찾고 목록에 없으면 보이지 않는다).
4. 접힌 float chip: `FloatChip`에 `owner?: string`과 `count`를 더한다. `workspace-window.tsx`가 전역 float과 이 desk의 접힌 float 가운데 주인이 있는 것을 주인마다 chip 하나(avatar와 개수)로 묶고, 사람의 float은 지금처럼 하나씩 둔다. 주인 chip을 누르면 그 주인의 접힌 탭 목록(design `Menu`, 전역 float은 지금 표시처럼 지구 표시)이 펴지고 하나를 고르면 그 float을 편다. 작업 표시줄(`taskbar.tsx`)과 작업 표시줄이 꺼졌을 때의 tab 줄 끝이 같은 component다. 4개 넘으면 +N 규칙은 chip 단위로 그대로다.
5. float bar(`float-layer.tsx`의 제목), detached 창 제목(`detached-space.tsx`), 전역 float bar(`global-float-layer.tsx`)에 주인 avatar와 이름을 제목 앞에 둔다.
6. take control 줄: `browser-chrome.tsx`의 `AgentControlBar`가 주인 이름을 받아 "{name} is controlling this tab"으로 말한다. browser 탭(`browser-tab.tsx`, `kinds/browser.tsx`의 `keep`이 `tab.owner`를 넘긴다)과 preview 탭(`app-preview-tab.tsx`)이 같이 쓴다. 이름을 모르면 "An agent"로 말한다.
7. 새 browser 탭의 profile 고르기: `add-tab-menu.tsx`의 Browser 항목은 profile이 하나라도 있으면 Default와 profile들을 고르는 하위 menu가 되고, 고르면 `openBrowserTab(host, undefined, {profile})`로 연다. 없으면 지금처럼 한 번에 연다.
8. i18n: `packages/design/i18n/catalog/`의 `browser.ts`(controlling 문장, profile 이름 tooltip, Default)와 `shell.ts`(주인 chip의 이름·개수, 주인 이름 tooltip)에 key를 더한다. 이 wave의 catalog는 이 task만 고친다. 다만 lead가 이 wave 전에 넣어 두는 `left-sidebar.button.session-tabs-show`·`left-sidebar.button.session-tabs-hide`(같은 wave의 `tab-owner-sidebar`가 쓴다)는 지우지 않는다.
9. gallery: `tools/wireframes/mock/tab-owners.ts`(새 file)에 주인 두 session(이름·얼굴), 주인 있는 탭과 접힌 float, profile 하나를 두고 `shell.tsx`의 `shell-project`·`shell-floats`·`shell-global-float`·`shell-taskbar`와 `project-float/pages.tsx`, `project-detached/pages.tsx`, `browser/pages.tsx`(take control 줄)가 그 값으로 주인과 profile을 그리게 한다. 주인 chip을 편 상태를 drive로 보이는 page 하나를 `shell.tsx`에 더한다(id `shell-owner-chip`).

정한 것:
- 새 탭에서 profile을 고르는 자리는 + menu의 Browser 하나다. 빠른 실행의 New browser와 단축키는 기본 profile로 연다(고르는 길을 늘리지 않는다).
- 주인 묶음은 전역 float과 desk float을 가리지 않고 같은 주인이면 한 chip이다(chip이 주인을 보이는 것이 roadmap의 뜻이라서). 목록 안에서 전역 float은 표시로 가른다.

## 끝남

- `npm run check`가 통과하고 `node packages/shell/renderer/build.ts`가 된다.
- 위험 test: 없음.
- 남지 않음: 없음.
- `npm run wireframes`가 되고 gallery의 `shell-project`, `shell-floats`, `shell-global-float`, `shell-taskbar`, `shell-owner-chip`, project-float·project-detached page, browser take control page가 고친 renderer component로 주인과 profile을 그린다.

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
