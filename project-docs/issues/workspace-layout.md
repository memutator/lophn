# workspace-layout

project 창의 탭 자리(docked, floated, minimized)와 layout 저장. architecture: `project-docs/architecture/workspace-layout.md`.

## 접어 둔 app panel을 다시 펴면 view 상태가 접을 때의 것이다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: `EmbeddedView`(`renderer/app-frame/embedded-view.tsx`)는 mount된 동안만 `subscribeViewState`를 듣는다. Float·Dock·접기로 unmount되면 view는 `ViewKeeps`(`renderer/app-frame/view-keeps.ts`)에 `state`와 함께 보관되고, 그동안 main이 보낸 state(`viewHealth`의 unresponsive·crashed, `connectionState`)는 아무도 받지 않는다. 다시 mount하면 `take`가 준 보관 `state`를 그대로 보인다.

영향: minimized나 다른 자리로 옮기는 사이에 app view가 죽거나 연결이 끊기면, 다시 편 탭이 "정상"으로 보이고 [새 view 열기]가 안 나온다. 사람은 빈 화면이나 멈춘 앱을 보고 탭을 닫았다 열어야 한다.

고치려면: `ViewKeeps`가 보관하는 동안 `subscribeViewState`를 하나 들어 그 session의 `state`를 갱신한다(추천, 몇 줄). 또는 `take` 뒤에 main에 지금 state를 묻는다(새 IPC가 필요하다).
