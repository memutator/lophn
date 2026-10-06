# @lophn/ui-action

## 목적

앱 blueprint의 command 하나를 부르는 버튼과 확인 표시다(apps/sdk#R19). 확인
여부는 effect(read·write·external)가 아니라 apps/blueprint의 사람 확인 선언
`confirm`을 따른다. 호출은 앱 view의 `lophnApp.call` 하나로만 하고, confirm
command의 사람 확인 창과 approval은 lophn이 그 호출 안에서 연다. 앱 안에 따로
확인 dialog를 두지 않는다. 확인 호출의 접수와 approval 사용은 apps/invocations를
따른다. 조작은 lophn 화면과 같은 component다(apps/sdk#R20, R21).

## 공개 API와 type

```tsx
import { CommandButton, useCommand } from "@lophn/ui-action";
```

- `CommandButton({command, input?, children?, app?, onDone?, onFailed?, variant?, size?, disabled?, timer?})`
  — command 하나의 버튼이다.
  - `command`는 blueprint command 선언(`key`·`label`·`confirm`)이다. 버튼 글은
    `children`, 없으면 선언의 `label`이다.
  - `confirm: true`이면 방패 아이콘이 있고 hover에 "lophn asks you before this
    runs."가 보인다. 누르면 사람이 lophn 확인 창에서 정하는 동안 "Waiting for
    your confirmation."을 보인다. `confirm: false`이면 external이어도 표시 없이
    바로 부른다.
  - 부르는 동안 버튼은 눌리지 않고(`aria-busy`) 시계 아이콘을 보인다. 같은
    버튼을 다시 눌러도 두 번 부르지 않는다.
  - 실패하면 원문 없이 "<label> didn't finish. Try again."을 버튼 옆에 남기고
    다시 누를 수 있다. `onFailed`는 오류
    code(`invalid_input`·`forbidden`·`conflict`· `unavailable`)를 받는다.
  - `input`은 command 입력이거나 누를 때 입력을 만드는 함수다. 없으면
    `null`이다.
  - `app`은 `lophnApp`이다. 없으면 `window.lophnApp`을 쓴다.
- `useCommand(command, app?)` — `{state, run}`. 버튼이 아닌 trigger에서 같은
  pending·실패를 쓴다. `run(input)`은 `{ok: true, value}`나
  `{ok: false, code}`이고 기다리는 동안 다시 부르면 `undefined`다.
- `appBridge()` — `window.lophnApp`이다. 앱 view 밖이면 `undefined`다.
- `systemTimer`, type `Timer` — tooltip 지연을 재는 timer다. 테스트가 바꿔
  끼운다.
- type: `CommandSpec`, `CommandInput`, `AppBridge`, `CommandState`,
  `CommandResult`, `CommandButtonProps`, `UseCommand`

## 요구 permission

없다. 부르는 command의 permission과 확인은 그 앱의 blueprint 선언이 정한다.

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
external이지만 `confirm: false`인 동기화는 표시 없이 바로 부르고, write이지만
`confirm: true`인 보관은 확인 표시가 있다.

```tsx
import { CommandButton } from "@lophn/ui-action";

const archive = blueprint.commands.find((command) =>
  command.key === "archive-shipped"
)!;

<CommandButton
  command={archive}
  input={() => ({ orders: selected() })}
  onDone={reload}
/>;
```

문구는 앱의 message key로 주고 command key와 섞지 않는다(apps/sdk#R41).

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
