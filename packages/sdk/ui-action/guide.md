# @lophn/ui-action

## 목적

앱 blueprint의 app-api 하나를 부르는 버튼이다. 호출은 앱 view의 `lophnApp.call`
하나로만 한다. 호출이 허락되는지, 사람이 정해야 하는지는 lophn이 정하고 앱 안에
따로 확인 dialog를 두지 않는다. 조작은 lophn 화면과 같은 component다.

## 공개 API와 type

```tsx
import { AppApiButton, useAppApi } from "@lophn/ui-action";
```

- `AppApiButton({api, input?, children?, app?, onDone?, onFailed?, variant?, size?, disabled?})`
  — app-api 하나의 버튼이다.
  - `api`는 blueprint app-api 선언의 `key`·`label`이다. 버튼 글은 `children`,
    없으면 선언의 `label`이다.
  - 부르는 동안 버튼은 눌리지 않고(`aria-busy`) 시계 아이콘을 보인다. 같은
    버튼을 다시 눌러도 두 번 부르지 않는다.
  - 실패하면 원문 없이 "<label> didn't finish. Try again."을 버튼 옆에 남기고
    다시 누를 수 있다. `onFailed`는 오류
    code(`invalid_input`·`forbidden`·`conflict`· `unavailable`)를 받는다.
  - `input`은 app-api 입력이거나 누를 때 입력을 만드는 함수다. 없으면
    `null`이다.
  - `app`은 `lophnApp`이다. 없으면 `window.lophnApp`을 쓴다.
- `useAppApi(api, app?)` — `{state, run}`. 버튼이 아닌 trigger에서 같은
  pending·실패를 쓴다. `run(input)`은 `{ok: true, value}`나
  `{ok: false, code}`이고 기다리는 동안 다시 부르면 `undefined`다.
- `appBridge()` — `window.lophnApp`이다. 앱 view 밖이면 `undefined`다.
- type: `AppApiSpec`, `AppApiInput`, `AppBridge`, `AppApiState`, `AppApiResult`,
  `AppApiButtonProps`, `UseAppApi`

## 요구 permission

없다. 부르는 app-api의 permission은 그 앱의 blueprint 선언이 정한다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer               | version |
| ------------------ | ------- |
| `react`            | 19.3.0  |
| `lucide-react`     | 1.51.0  |
| `@lophn/tokens`    | 1.0.0   |
| `@lophn/blueprint` | 1.0.0   |

## 예제

`examples/order-actions.tsx`가 blueprint 선언으로 버튼 둘을 만든다.

```tsx
import { AppApiButton } from "@lophn/ui-action";

const archive = blueprint.app_api.find((api) => api.key === "archive-shipped")!;

<AppApiButton
  api={archive}
  input={() => ({ orders: selected() })}
  onDone={reload}
/>;
```

문구는 앱의 message key로 주고 app-api key와 섞지 않는다.

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
