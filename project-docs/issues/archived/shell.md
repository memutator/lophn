# shell (닫음)

## 앱 바로가기를 둘 곳이 없다

```yaml
kind: bug
modules: [packages/shell/renderer]
closed: fixed
guard: 없음
```

지금: 앱 바로가기를 위쪽 바에서 뺀 뒤 옮길 곳을 정하지 않았다.

영향: 앱 공간으로 갈 수 없다.

닫음: 앱으로 가는 길이 셋 있다. launcher의 `AppsSection`(`desktop/launcher/apps-section.tsx`)이 앱 카드를 보이고 누르면 `onApp`으로 앱 공간을 연다. lophn space의 Apps 화면(`desktop/lophn-space/apps/apps-screen.tsx`)에 `onOpen`이 있다. palette(`desktop/palette/lophn-scope.ts`)에 `app` 항목이 있다. 위쪽 바(`top-bar.tsx`)에는 앱 진입이 없다.
