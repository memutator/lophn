# ao-oauth-wiring

`ao-oauth-service`를 core에 끼운다: 앱 OAuth route 넷의 등록과 handler, `apps.secret_value` handler의 refresh hook, 발급자 호출 대기열과 loopback listener 연결, 종료 때 기다리는 sign-in 닫기.

- 단위: ao-oauth (wave 2)
- 선행: `ao-oauth-service`. service의 `createAppOAuth` 모양이 있어야 끼운다.
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/apps/register.ts`
- 읽을 것:
  - 계획: `project-docs/plan/app-oauth/README.md`의 "정한 것"의 화면(sign-in), token
  - architecture: `project-docs/architecture/agent-definition.md`(발급자 호출 대기열), `project-docs/architecture/app-call.md`(secret 값 길)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/main`(조립만 한다. 업무 규칙을 두지 않는다. wiring file끼리 import하지 않는다), `project-docs/boundary-catalog.yaml`의 `apps`
  - 계약: `packages/core/apps/oauth/mod.ts`(`AppOAuthDeps`, `AppOAuth`), `packages/protocol/apps/oauth.ts`(route 넷)
  - 코드: `packages/core/main/daemon/assembly.ts`의 `WIRINGS` 순서와 머리 주석(읽는 쪽 wiring이 쓰는 쪽 뒤라는 규칙), `packages/core/main/daemon/wiring/secrets.ts`(`secretsWiring`: 앱 secret allowance가 `openConnection(ctx.ledgerPath)`로 `releaseDeclarations.get`과 `secretAllowanceOver`를 하는 꼴. `declared`가 같은 방식이다), `packages/core/main/daemon/wiring/lophn-agent.ts`(`lophnAgentProviderLoginWiring`: `issuerRequests`를 만든다. `openCallbackListener`와 `ctx.random` 쓰는 법), `packages/core/main/daemon/wiring/context.ts`(`Late` 칸, `ctx.peek`, `closeWork`·`closeChildren` hook), `packages/core/main/daemon/core.ts`(memory route와 handler가 맞는지 기동 때 대조), `packages/core/apps/permissions/effective.ts`(`effectiveScope`), `packages/core/apps/permissions/store.ts`(`loadGrants`)
- 계약:
  - 쓰는 것: `ao-oauth-service`가 내놓은 `createAppOAuth`, `AppOAuthDeps`, `AppOAuth`.
  - 내놓는 것: 없음(조립만).

## 할 일

1. `wiring/apps.ts`: `createAppOAuth`를 `build(ctx)`에서 만든다.
   - `secrets: ctx.secretStore`, `nowMs: () => ctx.clock.nowMs()`, `random: ctx.random`, `openListener: openCallbackListener`(`lophn-agent/extensions/mcp-auth-control.ts`에서. `lophn-agent.ts` wiring이 같은 식으로 import한다).
   - `fetch`: **`ctx.issuerRequests`를 build 시점에 읽지 않는다.** `appsWiring`은 `lophnAgentProviderLoginWiring`(그 칸을 만든다)보다 먼저 build된다. 부를 때 읽는 래퍼 `(url, init) => ctx.issuerRequests.fetch(url, init)`로 쓴다. 칸을 앞으로 옮기려고 `WIRINGS` 순서를 바꾸지 않는다(쓰기 앞 처리기의 안팎 순서가 바뀐다).
   - `declared(app)`: `openConnection(ctx.ledgerPath)`로 읽는 연결을 열고 `releaseDeclarations.get(sql, app)`의 permissions 가운데 `secret.use`이면서 `scope.oauth`가 있는 것마다 `{ name, oauth, granted }`를 만든다. `granted`는 `loadGrants(sql, { app, status: "active" })`와 `effectiveScope`로 계산한 `access`에 같은 scope(canonical 비교, `oauth` 포함)가 있는지다(`secretsWiring`의 allowance와 같은 판정). 연결은 `finally`에서 닫는다. 선언이 없으면(현재 release 없음) 빈 목록.
2. `memory` 목록에 service의 `handlers` 넷(`apps/oauth_client_set|oauth_begin|oauth_cancel|oauth_state`)을 더하고, `secretValueHandler({ ..., prepare: (input) => oauth.prepare(input) })`로 hook을 단다.
3. 종료: 기다리는 sign-in(listener)이 남지 않게 `closeWork()`(또는 알맞은 종료 hook. 이미 있는 것을 쓴다)에서 `oauth.endAll()`을 부른다.
4. `apps/register.ts`: `memoryRoutes`에 `appOAuthClientSet`, `appOAuthBegin`, `appOAuthCancel`, `appOAuthState`를 더한다(handler는 wiring이 붙인다는 주석이 `appsSecretValue` 옆에 있다. 같은 꼴). 둘이 어긋나면 core 기동이 `memory route와 handler가 맞지 않는다`로 멈춘다.
5. worktree에서 `project-docs/plan/tools/lead/boot.sh`로 core가 두 번 뜨는지 본다. core를 손으로 띄우지 않고, 실제 `~/.lophn`을 건드리지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(조립만이다. 위험 test는 `ao-oauth-service`에 있다).
- `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 둘 다 찍는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(종료 hook 선택)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
