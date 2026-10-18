# workspace-layout

project 창의 탭 자리(docked, floated, minimized)와 layout 저장. architecture: `project-docs/architecture/workspace-layout.md`.

## 다시 띄운 plain terminal과 app panel 탭의 제목이 비어 있다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

- 지금: `renderer/workspace/kinds/terminal.tsx`의 `fromStored`는 coding이 아닌 terminal을 `title: ""`로 되살리고, 제목은 PTY가 뜬 뒤 `onStarted`의 `patchTab`이 채운다. `kinds/app-panel.tsx`는 `toStored`에 제목을 남기지 않고 `fromStored`가 `title: ""`를 내며, 앱을 고를 때 말고는 제목을 채우는 곳이 없다. 탭 줄(`parts/tab-strip/tab-strip.tsx`), floated 패널 bar(`workspace/floats/floats.tsx`), 접힌 span(`workspace/minimized/minimized-bar.tsx`)은 `tab.title`을 그대로 그린다.
- 영향: lophn을 다시 띄우면 고르지 않은 terminal 탭, 접힌 terminal span, app panel 탭과 그 패널 bar·span이 아이콘만 남고 이름이 없다(접힌 terminal은 mount되지 않아 펴기 전까지 그대로다). app panel이 docked면 breadcrumbs 끝도 빈다. 사람이 어느 패널인지 모르고 span을 하나씩 눌러 봐야 한다. gallery `new-float-minimized`가 이 때문에 coding terminal만 쓴다.
- 고치려면:
  - 작음(추천): 두 kind의 `toStored`·`fromStored`가 제목을 저장하고 되살린다. layout schema의 그 kind 탭 schema에 `title` 칸을 더한다(판 2 안에서, 개발 data는 지운다).
  - 작음: 그리는 세 곳이 빈 제목이면 kind 이름(`tabKindLabel`)을 쓴다. 저장은 그대로지만 terminal 여럿이 모두 "Terminal"로 보인다.
