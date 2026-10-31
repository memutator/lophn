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
