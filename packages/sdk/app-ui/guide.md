# @lophn/app-ui

## 목적

앱 view의 bridge(`lophnApp`)를 쓰는 UI 둘이다. 선언한 operation 하나를 부르는
`OperationButton`·`useOperation`과 앱 화면 root의 `AppErrorBoundary`다. 화면은
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
- type: `OperationSpec`, `OperationInput`, `AppBridge`, `OperationState`,
  `OperationResult`, `OperationButtonProps`, `UseOperation`,
  `AppErrorBoundaryProps`

## 요구 permission

없다. 부르는 operation의 permission은 그 앱의 선언이 정한다. `AppErrorBoundary`의
오류 전달은 플랫폼이 이미 여는 통로라 따로 선언하지 않는다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer                 | version |
| -------------------- | ------- |
| `react`              | 19.3.0  |
| `lucide-react`       | 1.51.0  |
| `@lophn/declaration` | 2.0.0   |
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

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
