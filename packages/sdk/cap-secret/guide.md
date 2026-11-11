# @lophn/cap-secret

## 목적

grant 범위의 secret 사용 client다. secret 값은 읽을 수 없다. 이 client는 "이
secret을 이 목적지로 보낼 때 플랫폼 전송부가 인증 값을 붙여 달라"는 요청 하나만
내고 안전한 사용 결과만 받는다. 값은 `netFetch`가 보낼 때 lophn이 붙인다.
secret의 생성·교체·삭제와 원값 읽기 통로는 없다. 그것은 사람의 확인과 OS 보관
경계를 지난다. import는 grant를 주지 않는다.

## 공개 API와 type

```ts
import { useSecret } from "@lophn/cap-secret";
```

- `useSecret({ name, destination: { host, port } })` — tool handler 안에서
  부른다. `{ used: true }`를 돌려준다. `useSecret`을 부른 같은 command 안에서 그
  destination으로 `netFetch`하면 lophn이 `Authorization: Bearer <값>`으로
  붙인다. 값은 앱에 없다. 다른 command나 다른 목적지(redirect로 바뀐 곳
  포함)에는 붙지 않고, 준비한 값은 60초 뒤 사라진다. 사람이 앱 Access 탭에서
  넣은 값(OAuth secret이면 sign-in한 access token)과 선언의
  `secret.use`·`net.fetch`, 사람의 허락이 필요하다. 목적지는 https이고 이 기계
  밖으로 나가지 않는 loopback만 http이며, `net.fetch` grant가 허락한 정확한
  host·port여야 한다. 호출마다 사람 확인을 받지 않고, tool을 부른 쪽(사람
  화면·agent·다른 앱)으로 막지도 않는다.
- 값이 아직 없으면 앱의 lophn agent가 `lophn ask secret --secret <name>`로
  사람에게 청한다. 대화에 card가 뜨고 사람이 보호 창에 값을 넣으며, agent는
  `stored`만 받는다. 값을 대화로 받지 않는다. 선언에 `oauth`가 있으면 같은
  명령이 [Sign in] card를 띄우고 agent는 `signed_in`을 받는다.
- `createSecretClient({ host?, standIn? })` — host를 바꿔 끼운다.
- `createSecretStandIn({ allowed? })` — preview·test의 대역이다. live가 아닌
  mode에서는 broker에도 외부에도 나가지 않고 `{ used: true, standIn: true }`만
  돌려주며 받은 요청을 `uses`에 남긴다.
- 거절은 `CapabilityError`다. `forbidden`이면 `permission`(`secret.use` 또는
  `net.fetch`)과 `scope`(`{ name }` 또는 `{ host, port }`)를 알린다. 값은
  오류에도 없다. 전송이 끊기면 `error.outcome === "unknown"`이고 자동으로 다시
  부르지 않는다. OAuth secret에 sign-in이 필요하면(한 적 없음, 서비스가
  sign-in을 끝냄) `conflict`이고 message는 `oauth sign-in required`다. 앱은
  사람에게 앱 Access 탭에서 다시 sign-in하라고 알린다.
- `checkDeclaration(declaration)` — 이 package를 쓰는 선언이 `secret.use`와
  `net.fetch`를 빠뜨렸는지 검사한다.
- type: `SecretClient`, `SecretUseRequest`, `SecretUseResult`, `SecretStandIn`,
  `CapabilityError`, `DeclarationCheck`

## OAuth secret

Google Drive처럼 OAuth로 여는 서비스는 선언의 `secret.use`에 `oauth`를 둔다.
표준 authorization code와 PKCE다.

```ts
{
  kind: "secret.use",
  scope: {
    name: "gdrive",
    oauth: {
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      // refresh token을 받으려고 Google에만 더하는 parameter다.
      params: { access_type: "offline", prompt: "consent" },
    },
  },
  reason: "Drive에 파일을 올린다",
}
```

- 사람이 그 서비스에 OAuth client를 만들고(Google Cloud는 "Desktop app") client
  id와 client secret을 앱 Access 탭에 넣는다(client id가 없으면 `lophn ask
  secret`이 `conflict`로 거절한다). 그 뒤 [Sign in]을 누르거나 앱의 lophn agent가
  `lophn ask secret --secret <name>`로 대화에 [Sign in] card를 띄운다. lophn이
  PKCE로 browser를 열고 loopback으로 돌아온 code를 token으로 바꾼다.
- 앱은 지금처럼 `useSecret({ name: "gdrive", destination })`만 부른다. lophn이
  access token을 붙이기 직전에 만료가 5분 안이면 refresh한다. 앱은 token도
  refresh token도 보지 못한다.
- API host(예: `www.googleapis.com:443`)는 따로 `net.fetch`로 선언한다. token
  끝점은 lophn이 부르므로 `net.fetch`가 필요 없다.
- Google Cloud project의 OAuth 동의 화면이 외부(External) 사용자 유형이고 게시
  상태가 "Testing"이면 Google이 주는 refresh token은 7일 뒤 끊긴다(이름·email·
  profile scope만 요청하면 예외다. Google 문서 "Using OAuth 2.0 to Access Google
  APIs"). 그러면 7일마다 refresh가 거절되어 사람이 다시 sign-in해야 한다.
- 서비스가 refresh를 거절하면(400·401·`invalid_grant`) sign-in이 끝나고
  `useSecret`이 `conflict`로 거절된다. 서비스에 닿지 못하면 아직 만료 전인
  token을 그대로 쓰고, 만료 뒤면 `unavailable`이다.
- `oauth` 칸을 바꾸면 늘어난 선언이라 activation 때 사람에게 다시 묻고, 사람은
  다시 sign-in한다.

## 요구 permission

`secret.use`(선언한 secret 이름)와 그 목적지의 `net.fetch`(정확한 host·port).

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { useSecret } from "@lophn/cap-secret";

import { netFetch } from "@lophn/cap-net";

const destination = { host: "api.example.com", port: 443 };
await useSecret({ name: "calendar.token", destination });
// lophn이 Authorization: Bearer <값>을 붙여 보낸다.
const events = await netFetch({ ...destination, path: "/events" });
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
