# tab-owner-sidebar

왼쪽 sidebar가 팀과 탭을 그린다. session 줄을 펴면 그 session이 주인인 탭이 자리(탭 줄, group 칸, float, 접힌 float, detached)와 상관없이 나오고, 누르면 그 탭으로 간다(접힌 float이면 편다). 팀(spawn tree)을 desk 묶음 아래에 들여쓰기로 그린다. 화면이 `spawned_by`를 읽도록 session 상태 계약에 더한다.

- 단위: tab-owner (wave 2)
- 선행: tab-owner-layout. 탭의 주인(`TabItem.owner`)이 거기서 온다.
- 소유(이 task만 고친다):
  - `packages/protocol/events/snapshot.ts`
  - `packages/protocol/events/agent.ts`
  - `packages/core/lophn-agent/workspaces/lifecycle.ts`
  - `packages/core/main/daemon/wiring/session-snapshots.ts`
  - `packages/shell/renderer/desktop/connection/events/sessions-store.ts`
  - `packages/shell/renderer/desktop/connection/events/fake-source.ts`
  - `packages/shell/renderer/desktop/connection/waiting/fake-source.ts`
  - `packages/shell/renderer/shell/left-sidebar.tsx`
  - `packages/shell/renderer/shell/left-sidebar.module.css`
  - `packages/shell/renderer/shell/left-sidebar-model.ts`
  - `packages/shell/renderer/shell/left-sidebar-workspaces.ts`
  - `packages/shell/renderer/shell/use-left-sidebar.ts`
  - `packages/shell/renderer/workspace/sidebar/workspace-left-sidebar.tsx`
  - `tools/wireframes/pages/screens/shell/sidebar-scene.tsx`
  - `tools/wireframes/pages/screens/app-space/space.tsx`
  - `tools/wireframes/mock/team-tree.ts`
  - `project-docs/flows/areas/shell-workspace.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/tab-scope/README.md`("팀 tree는 sidebar의 desk 아래에 그린다. `spawned_by`를 화면이 읽을 길이 없으면 session 목록 계약에 더한다")
  - 제품 결정: `project-docs/products/roadmap/tab-owner.md`의 "화면이 주인을 그린다"의 sidebar 줄
  - architecture: `project-docs/architecture/workspace-layout.md`의 "workspace, desk, 탭의 자리"(sidebar의 session 줄), `project-docs/architecture/agent-call.md`의 팀(`team spawn`, `spawned_by`)
  - skill: `.claude/skills/ui-design/SKILL.md`
  - 코드: `packages/protocol/events/snapshot.ts`(`sessionSnapshotSchema`), `packages/protocol/events/agent.ts`(`SessionStarted`), `packages/core/lophn-agent/workspaces/lifecycle.ts`(`SessionStarted`을 내는 곳, 약 160줄), `packages/core/main/daemon/wiring/session-snapshots.ts`(snapshot을 짓는 곳), `packages/shell/renderer/desktop/connection/events/sessions-store.ts`, `packages/shell/renderer/shell/left-sidebar-workspaces.ts`(`layoutDesks`, desk 묶음과 줄 순서 규칙), `packages/shell/renderer/workspace/sidebar/workspace-left-sidebar.tsx`(`onTab`, 다른 workspace의 탭을 고르고 가는 길(약 600줄))
- 계약:
  - 쓰는 것: `TabItem.owner`(`packages/shell/renderer/workspace/model.ts`). 이 wave에서 같이 도는 `tab-owner-screen`의 `useOwner()`는 쓰지 않는다(줄의 얼굴은 지금 sidebar가 짓는 그대로다).
  - 내놓는 것(계약 변경. 이 task가 정확히 이 모양으로 고친다):
    - `sessionSnapshotSchema`(`packages/protocol/events/snapshot.ts`)에 `spawned_by: idSchema("ses").nullable()`.
    - `SessionStarted` payload(`packages/protocol/events/agent.ts`)에 `spawned_by: idSchema("ses").nullable()`. agent event는 저장하지 않고 메모리로만 흘러 옛 기록이 없다.
    - renderer `SessionEntry`(`sessions-store.ts`)에 `readonly spawnedBy: string | null`.
  - lead가 이 wave를 띄우기 전에 catalog `packages/design/i18n/catalog/left-sidebar.ts`에 두 key를 넣어 둔다: `"left-sidebar.button.session-tabs-show": "Show tabs"`, `"left-sidebar.button.session-tabs-hide": "Hide tabs"`. 이 task는 catalog를 고치지 않는다(이 wave의 catalog는 `tab-owner-screen`이 고친다). 다른 문구가 꼭 필요하면 고치지 말고 보고의 "계약 바꾸기 요청"에 key와 문장을 적는다.

## 할 일

1. 계약: snapshot과 `SessionStarted`에 `spawned_by`를 더하고 core의 두 곳(`workspaces/lifecycle.ts`의 publish는 `row.spawned_by`, `session-snapshots.ts`는 session row의 `spawned_by`)이 채운다. fake(`events/fake-source.ts`, `waiting/fake-source.ts`, `tools/wireframes/pages/screens/app-space/space.tsx`)는 `null`을 넣는다. type check가 더 찾는 곳은 같은 값으로 맞추고 보고의 "넘길 줄"에 적는다.
2. `sessions-store.ts`가 snapshot과 event에서 `spawnedBy`를 든다.
3. 팀 tree: `left-sidebar-workspaces.ts`가 desk 묶음마다 부모(`spawnedBy`)가 같은 묶음에 있는 session 줄을 그 부모 줄 아래로 옮긴다. `SidebarSession`에 `children?: readonly SidebarSession[]`를 더하고 `left-sidebar.tsx`가 한 단계마다 들여쓴다. 부모가 다른 desk·workspace에 있거나 끝났으면 자기 묶음의 맨 위 단계에 선다. 줄 순서 규칙(id 순, 상태가 바뀌어도 자리를 지킨다)은 단계마다 그대로다.
4. session의 탭: `layoutDesks()`가 `LayoutDesks`에 `owned: ReadonlyMap<string, readonly OwnedTab[]>`(session id → 그 session이 주인인 탭의 key, title, kind, desk, 자리 tab|float|minimized|detached)를 더해 모은다(`workspace-window.tsx`가 부르는 모양은 그대로라 그 file을 고치지 않는다). 다른 workspace는 sidebar가 이미 읽는 layout 값에서 같은 함수로 모은다. 전역 float은 이 task가 고치는 file 안에서 닿으면 넣고, 닿지 않으면 넣지 않고 보고에 적는다.
5. `left-sidebar.tsx`: 주인 탭이 있는 session 줄에 펼침 단추(aria-label은 위 두 key)를 두고, 펴면 줄 아래에 탭 줄(kind 아이콘과 title)을 그린다. 펼침은 창 메모리(`useRemembered`)에 둔다. 탭 줄을 누르면 지금 workspace면 `onTab(key)`(접힌 float은 펴고 detached면 그 창을 앞으로), 다른 workspace면 지금 다른 workspace 탭을 고르는 길(그 layout에 고른 탭을 쓰고 그 workspace로 간다)을 쓴다. 이 길이 접힌 float을 펴지 못하면 보고에 적는다.
6. gallery: `tools/wireframes/mock/team-tree.ts`(새 file)에 coordinator 하나와 자식 둘(하나는 손자 하나), 주인 탭(browser 접힌 float 하나, 탭 하나)을 두고 `sidebar-scene.tsx`의 project sidebar가 tree와 편 줄 하나를 그리게 한다. 새 page가 필요하면 `shell.tsx`는 같은 wave의 `tab-owner-screen` 것이니 고치지 말고 보고의 "등록할 것"에 page 항목을 적는다.
7. flows `shell-workspace.yaml`: 사람이 session 줄을 펴서 탭으로 가는 동작을 `ui:` flow로 쓰고(sidebar의 session 줄 flow가 있으면 그 outcome에 더한다) 팀 tree를 그 flow의 steps에 적는다. `node tools/flows.ts check`.

정한 것:
- 팀 tree는 같은 desk 묶음 안에서만 들여쓴다. 묶음을 건너 줄을 옮기면 desk 묶음(탭이 있는 desk)의 뜻이 흐려진다.
- 펼친 목록에 그 session 자기 대화 탭은 넣지 않는다(줄 자체가 그 탭이다). 주인이 그 session인 다른 탭(자식의 대화 탭 포함)은 넣는다.

## 끝남

- `npm run check`가 통과하고 `node packages/shell/renderer/build.ts`가 된다.
- 위험 test: 없음.
- 남지 않음: 없음.
- `npm run wireframes`가 되고 gallery의 project sidebar page(`sidebar-scene.tsx`를 쓰는 page)가 고친 `LeftSidebar`로 팀 tree와 편 session 줄의 탭을 그린다.

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
