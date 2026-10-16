# @lophn/ui-layout

## 목적

앱 shell·tab·sidebar·grid·card와 5가지 페이지 틀(읽기·dashboard·목록과
상세·표·폼)이다. 모두 창이 아니라 넣은 영역의 폭에 반응하고 패널
320px·카드 240px부터 페이지 가로 scroll 없이 읽기와 조작을 준다.
탭·카드·페이지 틀은 lophn 화면과 같은 component이고 시각 값의 정본은
shell/design-system이다.

## 공개 API와 type

```tsx
import {
  AppShell,
  Card,
  DashboardCell,
  DashboardFrame,
  FormFrame,
  Grid,
  ListDetailFrame,
  ReadingFrame,
  Sidebar,
  Tab,
  TableFrame,
  TabList,
  TabPanel,
  Tabs,
  useContainerSpace,
} from "@lophn/ui-layout";
```

- `AppShell({title, actions, nav, children})` — 앱 view 안의 화면 틀이다. 바깥
  크롬은 lophn이 그리고 앱은 이 머리부터 그린다. 넣은 영역이 640px 미만이면
  `nav`를 본문 위 한 줄로 옮긴다.
- `Sidebar({items, current, onSelect})` — 앱 화면 사이의 이동이다. 전체에서는
  세로 목록, 패널·카드에서는 그 줄 안에서만 가로로 scroll한다.
- `useContainerSpace()`, `containerSpace(width)` — 지금 놓인 영역이
  `"card"`(240~319px)·`"panel"`(320~639px)·`"full"`(640px~) 중 무엇인지다.
- `Grid` — 240px 이상의 칸을 영역 폭에 맞게 채운다. 좁으면 한 줄 한 칸이다.
- `Card` — 독립 객체 하나를 묶는다. 카드 안 카드는 만들지 않는다.
- `List`, `ListItem({title, meta, selected, onSelect})` — 목록과 상세의
  목록이다.
- `Tabs`, `TabList`, `Tab({value, size})`, `TabPanel` — 일반 탭이다. 탭이 칸보다
  많으면 탭 줄이 가로로 scroll한다.
- 페이지 틀 5가지. 칸 640px 미만은 양쪽 16px, 이상은 32px 여백이다.
  - `ReadingFrame({width, header, toc})` — 본문 600·680·800px과 목차 220px. 폭이
    모자라면 목차가 머리로 간다.
  - `DashboardFrame`, `DashboardCell({span})` — 최대 1440px·12열·간격 16px.
    640px 미만은 한 줄 한 칸이다.
  - `ListDetailFrame({list, detail, active, onBack})` — 목록 360px과 상세. 640px
    미만은 `active` 한 쪽만 보이고 상세에 [Back]이 있다.
  - `TableFrame({header})` — 전체 폭 표. 표 안쪽이 scroll한다.
  - `FormFrame({header})` — 폭 640px 폼.
- type: `AppShellProps`, `SidebarProps`, `SidebarItem`, `GridProps`,
  `ContainerSpace`, `CardProps`, `TabsProps`, `TabProps`, `DashboardSpan`,
  `ListItemProps`, `ListDetailFrameProps`, `ReadingFrameProps`, `ReadingWidth`;
  값 `READING_WIDTHS`

## 요구 permission

없다. 그리기는 React의 일이다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer                | version |
| ------------------- | ------- |
| `react`             | 19.3.0  |
| `lucide-react`      | 1.51.0  |
| `@lophn/tokens`     | 1.0.0   |
| `@lophn/ui-control` | 1.0.0   |

## 예제

`examples/orders-app.tsx`가 sidebar로 5가지 페이지 틀을 오가고 같은 화면을
전체·320px 패널·240px 카드에 넣는다.

```tsx
import { AppShell, FormFrame, Sidebar } from "@lophn/ui-layout";

<AppShell
  title={t("app.title.screen")}
  nav={<Sidebar items={pages} current={page} onSelect={setPage} />}
>
  <FormFrame header={<h2>{t("app.heading.settings")}</h2>}>…</FormFrame>
</AppShell>;
```

문구는 앱의 message key로 주고 화면 id(`current`, `items[].id`)는 문구와 따로
둔다.

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
