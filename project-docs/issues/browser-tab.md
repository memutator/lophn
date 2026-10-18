# browser-tab

workspace의 browser 탭(`<webview>` 탭, native popup·DevTools view, bookmark). architecture는 `project-docs/architecture/browser-tab.md`.

## pane 안의 DOM이 docked browser page와 겹치면 page 밑에 그려진다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: 보통 browser 탭의 `<webview>`는 pane 안이 아니라 floats 층(`packages/shell/renderer/workspace/floats/floats.module.css`, `--z-sticky`) 안의 webview host(`packages/shell/renderer/browser/webview-host.tsx`)에 있고, pane 탭이면 z-index 1로 탭 자리 사각형에 놓인다. floats 층이 pane보다 DOM 뒤에 있어 pane 안에서 portal이 아닌 요소가 그 사각형과 겹치면 page 밑에 깔린다. 예: pane 둘 사이 경계의 잡는 띠(`packages/shell/renderer/workspace/panes/panes.module.css`의 `.grab`, `--z-sticky`, 경계 양쪽으로 반씩)는 browser page 쪽 절반이 가려지고, 탭을 끌 때 pane 위에 그리는 drop 표시도 그 자리에서는 안 보인다.

영향: browser 탭 옆 pane 경계를 잡을 수 있는 폭이 반으로 준다. 탭을 browser page 위로 끌 때 어디에 떨어질지 보이지 않는다.

고치려면:
- (추천, 작음) 경계 잡는 띠와 drop 표시처럼 page 위에 와야 하는 pane 요소를 floats 층보다 위 높이로 portal하거나, 그 요소만 webview host보다 높은 z-index를 갖는 층에 그린다.
- (중간) docked 탭의 `<webview>`를 pane 높이에 두는 그릇을 따로 둔다. Float·Dock 때 그릇이 바뀌면 다시 load되므로 floats 층과 한 stacking context를 유지하는 구조를 다시 짜야 한다.

## 크기 준 popup이 뜬 직후 adopt 전에 Dock·Float하면 그 탭이 오류 화면이 된다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: `packages/shell/renderer/browser/browser-tab.tsx`는 popup 탭이 다시 mount되면 `ViewKeeps`에서 view를 꺼내고, 없으면 `adopt`를 다시 부른다. popup이 뜬 뒤 첫 `adopt` 답이 오기 전에 사람이 Dock·Float해서 다시 mount되면, 옛 mount의 늦은 답이 view를 보관하기 전에 새 mount가 `adopt`를 다시 불러 main(`packages/shell/main/browser/registry.ts`의 `adopt`)이 `forbidden`(이미 adopt됨)으로 거절한다. 거절된 탭은 빈 `<webview>` 탭으로 바뀐다.

영향: 로그인 popup을 뜨자마자 옮기면 로그인 화면을 잃고 빈 탭이 남는다. 몇 ms 안에 옮겨야 생긴다.

고치려면: (추천, 작음) 진행 중인 adopt를 탭 key로 `ViewKeeps` 옆에 들고, 다시 mount된 쪽이 그 promise를 기다리게 한다.
