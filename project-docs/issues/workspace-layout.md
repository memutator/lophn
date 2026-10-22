# workspace-layout

project 창의 탭 자리(docked, floated, minimized)와 layout 저장. architecture: `project-docs/architecture/workspace-layout.md`.

## desk를 떠났다 돌아오면 일반 browser 탭의 page가 다시 load된다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

- 지금: `packages/shell/renderer/workspace/workspace.tsx`의 view 해제 effect가 `<webview>`를 남길 탭(`shown`)을 보이는 desk의 pane과 floats로만 잡는다. 다른 desk로 가면 떠난 desk의 browser 탭 `<webview>`가 `webviews.release`로 놓인다. app panel·artifact의 native view는 `allDeskTabs`로 판정해 desk를 건너도 산다.
- 영향: workflow desk와 Main을 오가면 그 browser 탭에 쓰던 form, scroll, 로그인 전 흐름을 잃고 page가 url로 다시 load된다. cookie는 partition에 남는다.
- 고치려면: (작음~중간) `shown`을 모든 desk의 pane·floats로 넓혀 `<webview>`를 숨긴 채 둔다. floats 층의 `<webview>` 그릇이 보이지 않는 desk의 탭 자리를 알지 못하므로 숨김 상태를 그릇에 넘겨야 한다(`renderer/browser/webview-host.tsx`). 추천: 사람이 실제로 불편을 말할 때 한다.

## 다른 desk에 있는 terminal이 연 URL은 browser 탭이 아니라 OS browser로 열린다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

- 지금: `packages/shell/renderer/terminal/use-bridge-open-requests.ts`의 `openBridgeUrl`이 그 terminal을 `allTabs(host.view)`(보이는 desk)에서만 찾는다. 다른 desk에 있으면 false를 돌려 ack하지 않고, main(`packages/shell/main/browser-bridge/bridge.ts`)이 1.5초 뒤 `declined`로 답해 shim이 OS browser로 연다.
- 영향: 링크를 browser 탭으로 열게 설정한 사람이 숨은 desk의 terminal에서 연 URL(예: CLI login)이 OS browser에 열린다. URL은 잃지 않는다.
- 고치려면: (작음) terminal을 `host.windowTabs()`에서 찾고, 그 terminal의 desk에 browser 탭을 연다. 지금 `openAcrossDesks`는 어디에도 없는 새 탭을 보이는 desk에 붙이므로 desk를 정하는 인자가 필요하다. 추천: 작음 안.

## workflow 폴더 이름을 바꾸면 그 desk가 Main으로 합쳐진다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

- 지금: desk key가 workflow 이름이다. `packages/shell/renderer/workspace/workspace.tsx`의 `mergeVanished`가 workflow 목록을 읽을 때마다 목록에 없는 desk를 `mergeDeskIntoDefault`로 Main에 합친다. 이름을 바꾼 workflow는 옛 이름이 목록에서 사라져 합쳐지고, 새 이름은 빈 새 desk가 된다.
- 영향: 그 workflow desk에 늘어놓은 탭 배치(pane, floated, detached)가 Main에 섞인다. 탭은 잃지 않는다.
- 고치려면: (중간) desk key로 쓸 바뀌지 않는 workflow id가 있어야 한다. 지금 workflow는 폴더 이름(`name`)으로만 가리킨다(`packages/shell/renderer/workspace/source.ts`의 `WorkflowEntryView`. `key`도 `<project 이름>/<name>`이다). 추천: 이름 바꾸기가 실제로 잦아질 때 한다.
