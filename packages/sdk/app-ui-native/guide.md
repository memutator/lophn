# @lophn/app-ui-native

## 목적

앱의 폰 화면(`src/screens/<key>/phone.tsx`, 선언의 `places: ["phone"]`)이 앱 bridge(`lophnApp`)를 쓰는
hook과 단추다. 선언한 operation 하나를 부르는 `OperationButton`·`useOperation`, 화면이 열린
자리·인자·workspace를 읽는 `usePlace`, 앱 event를 받는 `useEvent`다. 화면은 operation만 부르고, 호출은
`lophnApp.callOperation` 하나로만 한다. 폰 기능(진동, 클립보드, code 스캔, 링크, 공유, 위치, 연결 상태)은 이 package가
아니라 `@lophn/cap-phone`의 함수로 쓴다(화면 bundle에 묶이는 순수 JS이고 `phone.use` 선언이 필요하다). 호출이 허락되는지, 사람이 정해야 하는지는 lophn이 정하고 앱 안에
따로 확인 dialog를 두지 않는다.

hook은 desktop 화면의 `@lophn/app-ui`가 가진 DOM 없는 file 그대로다(설치 사본 안 `vendor/`에 같은 byte로
담긴다). 폰의 guest runtime과 desktop preview가 같은 전역 `lophnApp`을 주므로 같은 hook이 둘 다에서 돈다.
단추는 폰 kit `@lophn/ui-native`의 `Button`·`Text`로 그린다. 이 package는 폰 화면 전용이라 `@lophn/app-ui`와
한 화면에 섞지 않는다. desktop 화면(`main.tsx`)은 `@lophn/app-ui`, 폰 화면(`phone.tsx`)은 이 package다.

폰 앱이 같은 판을 이미 가지고 있다. 그래서 화면 bundle(`phone.js`)에 이 package가 들어가지 않는다(build가
external로 두고 폰이 내준다). 이 package를 설치하는 것은 type 검사와 desktop preview를 위해서다. 새 판으로 지은
화면은 옛 폰 앱에서 열리지 않을 수 있다(폰 앱을 올려야 한다).

## 공개 API와 type

```tsx
import {
  OperationButton,
  useEvent,
  useOperation,
  usePlace,
} from "@lophn/app-ui-native";
```

- `OperationButton({operation, input?, children?, app?, onDone?, onFailed?, variant?, size?, disabled?})`
  — operation 하나의 단추다.
  - `operation`은 선언한 operation의 `name`·`title`이다. 단추 글은 `children`, 없으면 선언의 `title`이다.
  - 부르는 동안 단추는 눌리지 않고 같은 단추를 다시 눌러도 두 번 부르지 않는다.
  - 실패하면 원문 없이 "<label> didn't finish. Try again."을 단추 옆에 남기고 다시 누를 수 있다.
    `onFailed`는 오류 code(`invalid_input`·`forbidden`·`conflict`·`unavailable` 등)를 받는다.
  - `input`은 operation 입력이거나 누를 때 입력을 만드는 함수다. 없으면 `null`이다.
  - `variant`·`size`는 kit `Button`의 것이다(`primary`·`secondary`·`ghost`·`danger`, `sm`·`md`·`lg`).
    화면의 주 행동은 `size="lg"`(54)를 준다.
  - `app`은 `lophnApp`이다. 없으면 전역 `lophnApp`을 쓴다.
- `useOperation(operation, app?)` — `{state, run}`. 단추가 아닌 trigger에서 같은 pending·실패를 쓴다.
  `run(input)`은 `{ok: true, value}`나 `{ok: false, code}`이고 기다리는 동안 다시 부르면 `undefined`다.
- `appBridge()` — 전역 `lophnApp`이다(`callOperation(operation, input)`). 선언에 없는 이름과 command는
  `forbidden`이다. operation의 입력은 앱 process가 검사하지 않으므로 handler가 직접 확인한다.
- `usePlace()` — `{place, params, workspace}`. 폰 화면에서 `place`는 `"phone"`이다. `params`는 화면 선언의
  `params` schema를 통과한 인자이고 없으면 `{}`다. 열릴 때 정해지고 화면이 열려 있는 동안 바뀌지 않는다.
- `useEvent(source, event, listener)` — 앱 event를 받는다. `source`는 event를 낸 앱의 slug, 또는 lophn이
  내는 event의 `"lophn"`이다. listener는 부를 때의 가장 최근 것을 쓰므로 그릴 때마다 새로 넘겨도 된다.
- type: `OperationSpec`, `OperationInput`, `OperationResult`, `OperationState`, `UseOperation`, `AppBridge`,
  `EventBridge`, `Place`, `PlaceValue`, `PlaceWorkspace`, `OperationButtonProps`

`useTabHead`·`useCommand`·`useProjects`·`useKeepAlive`·`AppErrorBoundary`는 없다. 폰에 그 bridge가 없고,
root의 오류 경계는 폰 앱의 base가 둔다. 폰 화면의 머리 줄은 lophn이 그리고 앱은 머리 줄을 그리지 않는다
(`@lophn/ui-native` guide의 폰 규칙).

규칙:

- 화면은 operation만 부른다. data는 bridge(operation의 결과와 event)로만 받는다. network가 없다. 폰 기능은
  `@lophn/cap-phone`이 낸다(`phone.use` 선언). 사진, file, 카메라 촬영은 아직 없다.
- 선언에 없는 operation 이름과 command는 `forbidden`이다.
- event는 앱 선언의 `subscriptions`에 같은 (source, event)가 있어야 오고, 화면이 떠 있는 동안만 받는다.
  놓친 event는 다시 오지 않으므로 처음 값은 operation으로 읽는다(앱이 발행하는 값을 read operation으로도 내놓는다).
- `lophnApp`은 화면의 첫 render 전에 서 있다(폰 앱이 `init`을 받은 뒤에야 화면을 그린다). 그래서
  `usePlace()`는 첫 render부터 값을 준다.
- 문구(실패 문장)는 lophn 화면과 같은 key를 쓰고 폰의 언어로 보인다. 앱 자기 화면의 문구는 앱이 그대로 쓴다.

## 요구 permission

없다. 부르는 operation의 permission은 그 앱의 선언이 정한다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다. 폰 화면이 있는 앱은 이 package를 `@lophn/ui-native`와 같이
`devDependencies`에 둔다(`dependencies`가 아니다. `@lophn/ui-native`의 guide가 이유와 나머지 peer의 표를 준다).

| peer                 | version |
| -------------------- | ------- |
| `@lophn/ui-native`   | 0.4.0   |
| `react-native`       | 0.88.1  |
| `react`              | 19.3.0  |
| `@lophn/declaration` | 5.0.0 (이 package가 의존으로 가져온다) |
| `@lophn/i18n`        | 1.0.0 (이 package가 의존으로 가져온다) |

앱 `package.json`과 `lophn.ts`는 `@lophn/ui-native`와 같은 방식으로 이 package를 더한다.

```json
"devDependencies": {
  "@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.10.1"
}
```

```ts
sdk_dependencies: [
  { name: "@lophn/app-ui-native", version: "1.10.1" },
],
```

## 사용

`usePlace`로 인자를 읽고, `OperationButton`·`useOperation`으로 operation을 부르고, `useEvent`로 event를
받는다. `src/screens/orders/phone.tsx`:

```tsx
import { useState } from "react";
import { Group, Row, Screen, Text } from "@lophn/ui-native";
import {
  OperationButton,
  type OperationSpec,
  useEvent,
  useOperation,
  usePlace,
} from "@lophn/app-ui-native";

// 선언의 operations에 있는 이름과 title이다.
const archive: OperationSpec = { name: "archive-shipped", title: "Archive shipped" };
const list: OperationSpec = { name: "list-orders", title: "List orders" };

export default function Orders() {
  const { params } = usePlace();
  const status = typeof params.status === "string" ? params.status : "open";
  const [orders, setOrders] = useState<{ id: string }[]>([]);
  const load = useOperation(list);

  const reload = async () => {
    const result = await load.run({ status });
    if (result?.ok) setOrders(result.value as { id: string }[]);
  };
  // 앱이 선언의 subscriptions에 적은 event만 온다. 처음 값은 위 operation으로 읽는다.
  useEvent("orders", "changed", () => void reload());

  return (
    <Screen scroll>
      <Group>
        {orders.map((order) => (
          <Row key={order.id} title={`Order ${order.id}`} />
        ))}
      </Group>
      <OperationButton
        operation={archive}
        size="lg"
        input={() => ({ status })}
        onDone={() => void reload()}
      >
        Archive shipped
      </OperationButton>
      {load.state.status === "failed" && <Text tone="critical">Couldn't load orders.</Text>}
    </Screen>
  );
}
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예:
`app-ui-native-1.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다. 이 판으로 지은 화면은 이 판보다 옛 폰 앱에서 열리지
  않을 수 있다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.

같이 움직이는 판: 이 package는 `@lophn/declaration`(정확한 판)에 기대고 hook의 file이 `@lophn/app-ui`와
같은 byte이므로, declaration 판을 올리면 이 package도 함께 올린다. `@lophn/ui-native`의 `Button`을 쓰므로
그 판과 폰 앱에서 같이 움직인다.
