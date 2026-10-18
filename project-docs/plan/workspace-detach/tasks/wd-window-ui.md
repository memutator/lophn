# wd-window-ui

detached 창 안의 화면을 만든다. 이 창은 탭 하나만 그린다: 위 bar(`TopBar`)에 탭 제목과 [Dock], 창 단추가 있고, 본문은 그 탭의 kind가 그린다. hash route `#detached=<탭 key>`로 시작하고, 탭 값과 transfer는 main에서 `take()`로 받는다. [Dock]과 창 닫기(×)는 같은 흐름이다: kind의 `transfer`가 낸 값을 `dock()`으로 main에 넘긴다.

- 단위: wd-window-ui (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/detached/detached-space.tsx`
  - `packages/shell/renderer/workspace/detached/detached-space.module.css`
  - `packages/shell/renderer/desktop/router.ts`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/design/wording/catalog/project.ts`
  - `packages/design/wording/catalog/project.placeholders.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 4(창, 창을 닫을 때, 탭 옮기기), 5(wording), "정한 것"(detached 창은 탭 하나만, [×]는 dock)
  - 계획: `project-docs/plan/workspace-detach/README.md`의 "정한 것"
  - wording 규칙: `.claude/skills/wording/SKILL.md`
  - 본보기(화면): `tools/wireframes/pages/screens/project-float/pages.tsx`의 floated terminal 모양(패널 bar의 제목·단추). detached 창의 gallery page는 `wd-gallery`가 만든다. 이 task는 gallery를 고치지 않는다.
  - 지금 코드(이 brief는 아래를 열어 확인한 것이다):
    - 시작 자리: `renderer/desktop/entry.tsx`가 `location.hash`(`#project=`, `#app=`, `#settings`)로 시작 `Route`를 고른다. `router.ts`는 `Route` type과 `openProject` 같은 builder만 있다(roadmap은 router.ts가 hash를 읽는다고 쓰지만 실제로는 entry.tsx다). `main.tsx`의 `Desktop`이 route별 `space`를 정하고, `DesktopIntents`·`ToastHost`·`PaletteProvider`를 같이 그린다.
    - 탭 그리기: `renderer/workspace/kinds/kind.ts`의 `TabKindDef`(`render(tab, active, host)`, `keep(tab, shown, host)`, `iconOf`, `icon`, `transfer`, `receive`)와 `registry.ts`의 `tabKindOf`, `host.ts`의 `TabHost`(이 task가 만드는 detached 창의 host가 채워야 하는 모양). `Workspace`(`workspace.tsx`)가 `host`를 만드는 방법(`contexts`·`agents`·`agentView` slice, `useSidebarAgents`, `useSessions`, `useConversation`, `createViewCovers`, `createViewKeeps`, `ViewCoversProvider`, `ViewKeepsProvider`)을 읽고 필요한 만큼만 따라 만든다.
    - 상단 bar: `renderer/desktop/top-bar/top-bar.tsx`의 `TopBar`(`leading`, `trailing`), `window-controls.tsx`(닫기가 `lophnWindow.close()` → main의 `window.close()`).
    - 창 안 상태: `renderer/desktop/main.tsx`의 `Desktop`은 core 연결이 준비돼야(`live`) 공간을 그린다.
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: `wd-contract`의 `LophnDetachedApi`(`take`, `dock`, `changed`, `openTab`, `remove`, `subscribe`), `DetachedEvent`, `TabKindDef.transfer`/`receive`, `TabHost`(`keeps` 포함), `WorkspaceProps.detached`. `wd-layout`의 `WorkspaceView`(`detached: []`).
  - 내놓는 것: `Route`에 `detached` 공간(`openDetached(key)`)과 `Desktop`의 `detached?: LophnDetachedApi` prop. `wd-gallery`가 `openDetached`와 이 prop으로 gallery page를 만든다.

```ts
// router.ts
type Space = /* 지금 */ | "detached";
interface Route { /* 지금 */ readonly detached?: string }   // 탭 key
export function openDetached(key: string): Route;
// main.tsx — DesktopProps에 더한다
detached?: LophnDetachedApi;   // Workspace에도 그대로 넘긴다(WorkspaceProps.detached)
// renderer/workspace/detached/detached-space.tsx
export function DetachedSpace(props: {
  api: LophnDetachedApi;
  workspace: WorkspaceSource;
  editor?: EditorDeps;
  terminal?: TerminalDeps;
  agentViewSource?: AgentTabSourceFactory;
}): ReactElement;
```

## 할 일

1. `router.ts`: `Space`에 `"detached"`, `Route.detached`, `openDetached(key)`.
2. `entry.tsx`: `location.hash.startsWith("#detached=")`면 `openDetached(decodeURIComponent(…))`로 시작한다(`seed`나 `mock`이 우선이 아니다. 다른 hash 분기와 같은 사슬에 넣는다). `bridges`에 `lophnDetached?: LophnDetachedApi`를 더해 `Desktop`의 `detached` prop으로 넘긴다. 시작 hash의 key는 route를 고르는 용도뿐이고 탭 값은 `take()`로 받는다.
3. `main.tsx`: `DesktopProps.detached`. project 공간은 `<Workspace detached={detached} …>`로 넘긴다. `route.space === "detached"`이고 `detached`와 `workspace`가 있고 core가 `live`이면 `space = <DetachedSpace …>`. 아직 `live`가 아니면 `null`을 그린다(런처로 떨어지지 않는다). 이 route일 때는 `DesktopIntents`와 `ToastHost`를 그리지 않는다(toast와 전역 palette가 detached 창에서 route를 바꾸거나 toast를 겹으로 띄우지 않게). 그 밖의 `Desktop` 동작(appearance 적용, overlay modal 표시, `PaletteProvider`)은 그대로 둔다.
4. `detached-space.tsx`:
   - 마운트하면 `api.take()`로 `{ project, tab, transfer }`를 받는다(받는 동안 Loading, 실패하면 `ErrorState`와 창을 닫는 길). `tabKindOf(tab.kind)`를 찾고 `transfer`가 null이 아니고 `receive`가 있으면 그릴 때 한 번 `receive`를 부른다(`tab`은 `TabItem`으로 본다).
   - `host: TabHost`를 만든다. 탭은 한 개뿐인 `view`(panes 하나, floats·detached 비어 있음)다. `projectId`는 받은 project, `projectTitle`은 `workspace.project(project)`에서 읽는다. `props`는 `WorkspaceProps`에서 kind가 읽는 것(`projectId`, `source`, `editor`, `terminal`, `agentViewSource`)만 채우고 나머지는 빈 함수로 둔다. `contexts`·`agents`·`agentView` slice는 `Workspace`의 것을 따라 같은 source로 만든다(복사한 줄은 보고에 적는다). 앱 화면을 여는 길(`onSettings` 등)은 아무것도 하지 않는다. `keeps`는 이 창의 `createViewKeeps`(닫기는 `appViews?.views.closeView`)이고 `ViewCoversProvider`·`ViewKeepsProvider`로 감싼다.
   - `host`의 동작: `patchTab`은 이 창의 탭 값을 바꾸고 `api.changed({ tab })`로 project 창에 알린다(`later` 옵션은 무시하고 매번 보낸다). `openTab(tab)`은 `api.openTab({ tab })`(project 창에 docked로 열린다). `removeTab(key)`는 `api.remove()`(이 탭을 닫는다. 창도 닫힌다). `document.noteReadPosition`은 아무것도 하지 않는다.
   - 본문: `def.keep?.(tab, true, host) ?? def.render?.(tab, true, host)`(`active`는 늘 true). 둘 다 null이면 제목만.
   - 위 bar: `TopBar`의 `leading`에 탭 아이콘(`def.iconOf?.(tab, host) ?? <Icon icon={def.icon} …>`)과 제목, `trailing`에 [Dock] `IconButton`(`workspaceIcons.dock`, wording key는 아래, `data-detached-action="dock"`).
   - dock 흐름: `const transfer = def?.transfer ? await def.transfer(tab, host) : { value: null, views: [] }`. null이면 아무것도 하지 않는다(창과 탭 그대로). 아니면 `api.dock({ tab: 지금 탭, transfer })`. 이미 도는 중이면 다시 시작하지 않는다. `api.subscribe`로 `dock-request` event를 받아 같은 흐름을 돈다(OS 창 닫기). `dock`이 거절되면 창을 그대로 둔다.
5. wording: `project-workspace.button.detached-dock`("Dock")를 `catalog/project.ts`에 더하고 `deno task wording`으로 `project.placeholders.ts`를 다시 만든다(손으로 고치지 않는다). 아이콘 단추의 label·tooltip에 쓴다.
6. CSS: `detached-space.module.css`. 본문은 창 전체를 채우고 `TopBar` 아래 높이를 쓴다. 다른 화면의 module css와 같은 토큰을 쓴다.
7. 확인은 `deno task wireframes`가 아니라 type·bundle로 한다(gallery page는 `wd-gallery`가 만든다). Electron을 띄워 확인하지 않는다.

## 정한 것

- detached 창은 `Desktop`의 route로 둔다(agent). appearance 적용, core 연결, overlay modal 표시가 이미 거기 있고 새 root를 만들면 같은 일을 다시 해야 한다. 대신 toast와 전역 palette intent는 이 route에서 끈다.
- detached 창에서 `openTab`은 project 창에 docked로 연다(agent). 이 창에는 탭 줄이 없다. agent의 새 탭 key(`agent:<agent>:<n>`)는 이 창의 단일 탭 `view`를 보고 정해 project 창의 key와 겹칠 수 있다: 겹치면 project 창이 그 탭을 새로 만들지 않고 고른다. 막지 않는다(알려진 미완 동작에 적는다).
- `removeTab`은 확인 없이 탭을 닫는다(agent). 이 길을 쓰는 kind(agent `closeTab`, editor의 파일 삭제 뒤, app panel의 앱 고르기 [Close])는 이미 사람이 닫기를 고른 것이다. terminal은 이 길을 쓰지 않는다.
- Settings·Instructions로 가는 길(agent의 `/skills` 등)은 detached 창에서 아무것도 하지 않는다(agent). 이 창에는 route가 하나뿐이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 화면과 창 흐름은 test하지 않는다(write-test).
- 남지 않음: 없음(더하는 것뿐이다).
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성(`deno task wording`)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: `Workspace`에서 따라 만든 slice 줄(contexts·agents·agentView). 무엇을 복사했고 어디에 중복인지 적는다.
- **알려진 미완 동작**: detached 창에서 연 agent 새 탭의 key 겹침, Electron에서 손으로 확인하지 못한 것. 없으면 "없음"
