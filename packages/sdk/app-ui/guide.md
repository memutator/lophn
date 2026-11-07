# @lophn/app-ui

## 목적

앱 view의 bridge(`lophnApp`)를 쓰는 UI 셋이다. 선언한 operation 하나를 부르는
`OperationButton`·`useOperation`, 앱 화면 root의 `AppErrorBoundary`, 화면의 머리
조작을 lophn 탭 머리 줄에 올리는 `useTabHead`, 화면이 열린 자리·인자·workspace를 읽는
`usePlace`, 일이 도는 동안 page를 살려 두는 `useKeepAlive`다. 화면은
operation만 부르고, 호출은 앱 view의 `lophnApp.callOperation` 하나로만 한다.
호출이 허락되는지, 사람이 정해야 하는지는 lophn이 정하고 앱 안에 따로 확인
dialog를 두지 않는다. 조작은 lophn 화면과 같은 component(`@lophn/ui`)다. bridge가
필요 없는 UI(레이아웃·필터·ReadState·toast 등)는 `@lophn/ui/<분류>`에 있다.

## 공개 API와 type

```tsx
import {
  AppErrorBoundary,
  OperationButton,
  useOperation,
} from "@lophn/app-ui";
```

- `OperationButton({operation, input?, children?, app?, onDone?, onFailed?, variant?, size?, disabled?})`
  — operation 하나의 버튼이다.
  - `operation`은 선언한 operation의 `name`·`title`이다. 버튼 글은 `children`,
    없으면 선언의 `title`이다. DOM에는 `data-operation={operation.name}`이 붙는다.
  - 부르는 동안 버튼은 눌리지 않고(`aria-busy`) 시계 아이콘을 보인다. 같은
    버튼을 다시 눌러도 두 번 부르지 않는다.
  - 실패하면 원문 없이 "<label> didn't finish. Try again."을 버튼 옆에 남기고
    다시 누를 수 있다. `onFailed`는 오류
    code(`invalid_input`·`forbidden`·`conflict`· `unavailable`)를 받는다.
  - `input`은 operation 입력이거나 누를 때 입력을 만드는 함수다. 없으면 `null`이다.
  - `app`은 `lophnApp`이다. 없으면 `window.lophnApp`을 쓴다.
- `useOperation(operation, app?)` — `{state, run}`. 버튼이 아닌 trigger에서 같은
  pending·실패를 쓴다. `run(input)`은 `{ok: true, value}`나
  `{ok: false, code}`이고 기다리는 동안 다시 부르면 `undefined`다.
- `appBridge()` — `window.lophnApp`이다(`callOperation(operation, input)`). 앱 view
  밖이면 `undefined`다. 선언에 없는 이름과 command는 `forbidden`이다. operation의
  입력은 앱 process가 검사하지 않으므로 handler가 직접 확인한다.
- `AppErrorBoundary({children})` — 앱 화면 root의 오류 경계다. 앱 진입에서
  root를 감싼다. 아래에서 render 오류가 나면 `window`에 `RENDER_ERROR_EVENT`
  (`lophn:render-error`) DOM event를 보낸다. `detail`은 오류의 `name`과
  `message`다. lophn의 앱 preload가 그것을 앱 log의 `view_error` 줄로 넘기므로
  앱이 따로 보고하지 않아도 된다. 화면에는 원문 오류 없이 "Couldn't show this
  screen."과 [Try again]만 보인다.
- 두 component의 문구(실패 문장과 [Try again])는 lophn 화면과 같은 언어로
  보인다. lophn이 앱 view 문서의 `<html data-lophn-locale>`에 그 언어를 적고,
  값이 없으면(앱 view 밖) en이다. 앱 자기 화면의 문구는 앱이 그대로 쓴다.
- `useTabHead(head, handlers?, app?)` — 화면이 lophn 탭(앱 화면 탭, 앱 panel
  탭)으로 열렸을 때 그 탭의 머리 줄(← →, 경로, ⋯ 메뉴가 있는 줄)에 `head`를
  올린다. 앱 머리 줄과 lophn 머리 줄이 두 줄로 쌓이지 않게 한다.
  - `head`는 글과 id뿐이다. `crumbs`(앱 이름 뒤 경로), `tabs`(`{items,
    selected}`, 경로 뒤 탭), `status`(오른쪽 상태 글), `actions`(⋯ 앞 단추.
    `primary`·`busy`·`disabled`), `menu`(⋯ 메뉴 맨 위 묶음), `nav`(`{canBack,
    canForward}`. 주면 ← →가 앱 안의 뒤로·앞으로가 된다). 항목은 `{id, label}`
    이고 글은 80자, 항목은 24개까지 보인다. 아이콘과 React 요소는 싣지 못한다.
  - `handlers`는 `onTab(id)`·`onAction(id)`·`onMenu(id)`·`onBack()`·
    `onForward()`다.
  - 돌려주는 값은 lophn이 지금 그 머리 줄을 그리는지다. 앱 창, 떠 있는 패널,
    세션 카드처럼 머리 줄이 없는 곳이면 false이고, 화면이 같은 조작을 스스로
    그린다. `null`이나 화면이 사라지면 내린다. `head`는 값이 바뀔 때만 다시
    올린다.
- `usePlace()` — 이 화면이 열릴 때 정해진 `{place, params, workspace}`다. 읽기만
  하고 화면이 열려 있는 동안 바뀌지 않는다(dock·desk float·전역 float는 모두
  `panel`이라 자리가 바뀌는 경우가 없다).
  - `place`는 `tab`·`panel`·`card`·`sidebar`·`tray`다. 앱 view 밖이거나 lophn이
    준 값이 틀리면 `null`이다. 선언에 적은 자리(`places`)에서만 열린다.
  - `params`는 화면 선언의 `params` schema를 lophn이 이미 검사한 인자다. 인자 없이
    열렸으면 `{}`다. 값을 쓰기 전에 앱이 다시 검사할 필요는 없다.
  - `workspace`는 `{kind: "project" | "home" | "app", id, folders}`다. 앱 sidebar
    panel처럼 모든 workspace에 나오는 화면이 이걸 보고 맞춘다. `folders`는
    project의 등록 폴더 path 목록이고 Home과 앱 workspace는 `[]`이다. workspace를
    모르는 자리(앱 전용 창, 전역 float)에서는 `null`이다.
- `useKeepAlive(active, app?)` — `active`인 동안 사람이 이 화면이 있는 workspace를
  떠나도(다른 project로 가도) lophn이 page를 숨겨 살려 두고, 돌아오면 다시 load하지
  않는다. 기본은 떠나면 page를 놓고 돌아오면 다시 load한다. 다시 load하면 화면
  state와 진행 중인 일(agent 답을 기다리는 중, 업로드)이 사라지므로 그런 일이 도는
  동안만 켜고 끝나면 `false`로 둔다.
  - 살려 두는 page는 창마다 6개까지이고 넘치면 가장 오래 안 본 것부터 놓인다. 그
    탭을 사람이 닫으면 바로 놓인다. 놓인 화면은 다시 열 때 새로 load된다. 그래서
    살려 두기에 기대지 말고 되살릴 것(session 이름 등)은 앱이 저장한다.
  - page가 새로 load되면 신호가 꺼지고, 화면이 사라지거나 `active`가 `false`가 되면
    내려간다. 앱 view 밖이면 아무 일도 하지 않는다.
- type: `KeepAliveBridge`, `Place`, `PlaceJson`, `PlaceValue`, `PlaceWorkspace`, `OperationSpec`, `OperationInput`, `AppBridge`, `OperationState`,
  `OperationResult`, `OperationButtonProps`, `UseOperation`,
  `AppErrorBoundaryProps`, `TabHead`, `TabHeadItem`, `TabHeadAction`,
  `TabHeadEvent`, `TabHeadHandlers`, `TabHeadBridge`

## 요구 permission

없다. 부르는 operation의 permission은 그 앱의 선언이 정한다. `AppErrorBoundary`의
오류 전달은 플랫폼이 이미 여는 통로라 따로 선언하지 않는다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer                 | version |
| -------------------- | ------- |
| `react`              | 19.3.0  |
| `lucide-react`       | 1.51.0  |
| `@lophn/declaration` | 4.0.0   |
| `@lophn/ui`          | 1.1.0   |
| `@lophn/i18n`        | 1.0.0   |

## 사용

선언으로 버튼을 만들고 앱 root를 경계로 감싼다.

```tsx
import { AppErrorBoundary, OperationButton } from "@lophn/app-ui";

const archive = declaration.operations.find((operation) =>
  operation.name === "archive-shipped"
)!;

createRoot(element).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

<OperationButton
  operation={archive}
  input={() => ({ orders: selected() })}
  onDone={reload}
/>;
```

문구는 앱의 message key로 주고 operation 이름과 섞지 않는다.

화면 안 보기 탭과 주 행동은 lophn 탭 머리 줄에 올리고, 올리지 못한 곳에서만
스스로 그린다.

```tsx
import { useTabHead, useOperation } from "@lophn/app-ui";

const collect = useOperation(collectOperation);
const inHead = useTabHead(
  {
    tabs: { items: VIEWS, selected: view },
    status: summary,
    actions: [{
      id: "collect",
      label: "Collect now",
      primary: true,
      busy: collect.state.status === "pending",
    }],
  },
  {
    onTab: setView,
    onAction: (id) => id === "collect" && void collect.run(null),
  },
);

return (
  // title과 actions를 다 빼면 AppShell은 자기 머리 줄을 그리지 않는다.
  <AppShell
    title={inHead ? undefined : "Usage"}
    actions={inHead ? undefined : <CollectButton />}
  >
    {inHead ? null : <ViewTabs />}
    …
  </AppShell>
);
```

자리마다 다른 꼴로 그리고, 크기는 자리가 아니라 CSS container query로 맞춘다.
같은 자리도 칸의 크기가 다르다(sidebar 폭, float 크기). 그래서 `place`는 어떤
정보를 보일지(카드는 요약, tab은 전체)를 고르는 데 쓰고, 배치는 container query가
정한다.

```tsx
import { usePlace } from "@lophn/app-ui";

function Orders() {
  const { place, params } = usePlace();
  const status = typeof params.status === "string" ? params.status : "open";
  // card는 요약 한 줄, 나머지는 표.
  return (
    <div className="orders">
      {place === "card" ? <Summary status={status} /> : <Table status={status} />}
    </div>
  );
}
```

```css
.orders { container-type: inline-size; }
/* 좁은 칸(sidebar, 작은 float)에서는 열을 줄인다. */
@container (max-width: 360px) {
  .orders .col-secondary { display: none; }
}
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
