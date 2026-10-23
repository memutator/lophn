# app-call

앱 tool 호출의 판정, 기록, write 직렬화와 changeset 기반 rewind. `project-docs/architecture/app-call.md`.

## 서비스가 sign-in을 거절해도 "시간이 지났다"로 보인다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/apps]
```

지금: 사람이 browser에서 [거부]를 누르면 발급자가 loopback으로 `error=access_denied`를 돌려준다. `openCallbackListener`(`packages/core/lophn-agent/extensions/mcp-auth-control.ts`)는 그 요청을 `refused`로 받아 `receive`를 실패로 끝내고, `createMcpAuth`의 `complete`(`packages/core/lophn-agent/extensions/mcp-auth.ts`)는 받기 실패를 모두 `callback_timeout`으로 적는다. 앱 Access 탭과 MCP 상태가 같은 code를 쓴다.

영향: 사람이 거절했는데 앱 Access 탭은 "Sign-in timed out. Try again."을 보인다. 사람은 왜 끝났는지 모르고 다시 같은 sign-in을 연다.

고치려면:
- 작음(추천): listener가 거절을 `forbidden`으로, 시한·취소를 `unavailable`로 이미 나눠 돌려준다. `complete`가 `forbidden`이면 `exchange_failed`(문구 "The service rejected the sign-in.")로 적는다. 실패 이유 enum은 그대로다.
- 작음: 이유 `denied`를 `McpAuthFailure`와 `APP_OAUTH_FAILURES`에 더하고 문구를 하나 더한다. 계약과 화면 둘을 고친다.

## core를 다시 켜면 sign-in 실패 이유가 사라진다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/apps]
```

지금: 실패 이유는 `createMcpOAuth`(`packages/core/lophn-agent/extensions/mcp-oauth.ts`)의 메모리 `failures` map에만 있다. refresh가 거절되면 token을 지우고 `failed`/`refresh_rejected`를 두는데, core가 다시 뜨면 map이 비고 token도 없어 `oauth_state`가 `none`을 낸다.

영향: 서비스가 sign-in을 끝냈다는 것을 사람이 보기 전에 core가 다시 켜지면, 앱 Access 탭은 "Not signed in"만 보인다. 앱은 `conflict`(`oauth sign-in required`)를 받으므로 동작은 같고, 잃는 것은 이유 글이다.

고치려면:
- 작음(추천): 실패 이유를 `app-oauth.<이름>.meta` 자리에 남긴다. 지울 때 meta를 `{ failed: reason }`으로 바꿔 쓰고 `report`가 읽는다. MCP는 지금처럼 메모리에 둔다.
- 두지 않음: 이유 글만 잃고 다시 sign-in하면 풀리니 kept로 닫는다.

## 앱 secret 값과 OAuth sign-in을 지울 길이 없다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/apps, packages/core/secrets]
```

지금: 앱 Access 탭은 값 넣기([Set value], [Set client secret], [Sign in])만 있다. shell에서 `secrets/delete`를 부르는 곳은 provider 설정(`packages/shell/renderer/desktop/settings/providers/core-source.ts`)뿐이다. grant를 [Revoke]해도 core는 `secrets.json`의 값을 지우지 않는다. 앱 OAuth token은 refresh가 거절될 때만 지워진다.

영향: 사람이 앱의 Google sign-in을 끝내거나(sign-out) 넣은 API key를 지우려면 서비스 쪽에서 client나 token을 폐기해야 한다. lophn 안에 refresh token이 남아 있고 화면은 계속 "Signed in"이다.

고치려면:
- 작음(추천): secret 줄에 [Sign out]·[Remove value]를 둔다. plain은 `secrets/delete`, OAuth는 새 route `apps.oauth_sign_out`이 vault의 `remove`(access·refresh·meta)를 부른다. client id·secret은 남긴다. wireframe을 먼저 고친다.
- 중간: grant를 [Revoke]하면 그 secret 값과 OAuth token을 같이 지운다. 같은 이름을 선언한 다른 앱도 같은 값을 쓰므로(앱 secret 이름은 전역이다) 다른 앱이 쓰는 값까지 지워진다.
