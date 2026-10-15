# @lophn/cap-secret

## 목적

grant 범위의 secret 사용 client다(apps/sdk#R31). secret 값은 읽을 수 없다. 이
client는 "이 secret을 이 목적지로 보낼 때 플랫폼 전송부가 인증 값을 붙여 달라"는
요청 하나만 내고 안전한 사용 결과만 받는다. secret의 생성·교체·삭제와 원값 읽기
통로는 없다. 그것은 사람의 확인과 OS 보관 경계를 지난다. import는 grant를 주지
않는다.

## 공개 API와 type

```ts
import { useSecret } from "@lophn/cap-secret";
```

- `useSecret({ name, destination: { host, port } })` — app-api handler 안에서 부른다.
  `{ used: true }`를 돌려준다. 목적지는 https이고 `net.fetch` grant가 허락한
  정확한 host·port여야 한다. 호출마다 사람 확인을 받지 않고, app-api를 부른
  쪽(사람 화면·agent·다른 앱)으로 막지도 않는다.
- `createSecretClient({ host?, standIn? })` — host를 바꿔 끼운다.
- `createSecretStandIn({ allowed? })` — preview·test의 대역이다. live가 아닌
  mode에서는 broker에도 외부에도 나가지 않고 `{ used: true, standIn: true }`만
  돌려주며 받은 요청을 `uses`에 남긴다.
- 거절은 `CapabilityError`다. `forbidden`이면 `permission`(`secret.use` 또는
  `net.fetch`)과 `scope`(`{ name }` 또는 `{ host, port }`)를 알린다. 값은
  오류에도 없다. 전송이 끊기면 `error.outcome === "unknown"`이고 자동으로 다시
  부르지 않는다.
- `checkDeclaration(blueprint)` — 이 package를 쓰는 선언이 `secret.use`와
  `net.fetch`를 빠뜨렸는지 검사한다.
- type: `SecretClient`, `SecretUseRequest`, `SecretUseResult`, `SecretStandIn`,
  `CapabilityError`, `DeclarationCheck`

## 요구 permission

`secret.use`(선언한 secret 이름)와 그 목적지의 `net.fetch`(정확한 host·port).

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { useSecret } from "@lophn/cap-secret";

await useSecret({
  name: "calendar.token",
  destination: { host: "api.example.com", port: 443 },
});
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
