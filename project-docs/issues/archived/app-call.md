# app-call (닫음)

## 앱 rewind가 안 된다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/lophn-agent, packages/core/main]
closed: fixed
guard: 없음
```

지금: session rewind는 파일과 대화만 되돌린다. 앱 데이터 되돌리기 요청은 wiring(`ctx.peek.appRewind`)이 비어 늘 `unavailable`로 rejected가 남는다.

영향: 앱 데이터는 rewind로 되돌릴 수 없다.

고치려면: 앱 rewind 계약을 짓고 wiring을 채운다.

닫음: `core/main/daemon/wiring/apps.ts`가 `createAppRewind`로 만든 값을 `ctx.provide("appRewind", rewind)`로 내놓고, `wiring/lophn-agent-session.ts`의 `requestRewind`가 `ctx.peek.appRewind.apply(app, from, "user")`를 부른다. 앱 module 쪽 계약(`apps/rewind`, `appRewind` route)도 등록돼 있다. 연결 자체를 보는 test는 없다(`apps/rewind/rewind_test.ts`는 앱 rewind, `lophn-agent/session/rewind/rewind_test.ts`는 가짜 `requestRewind`).

## 앱 rewind 요청(`rewind_apps` 표)이 wiring 없이 늘 rejected다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: 앱 rewind 요청(`rewind_apps` 표, background, accepted/applied/rejected)을 두었는데 지금은 wiring이 없어 늘 rejected.

영향: 쓰이지 않는 표와 흐름이다.

고치려면: MVP는 앱 rewind를 빼고 파일·대화만 되돌린다(`apps` 입력과 표를 지움).

닫음: 지우지 않고 wiring을 채웠다(위 "앱 rewind가 안 된다"). `lophn-agent/session/rewind/commands.ts` `handleApps`가 `rewind_apps`에 앱별 결과(accepted에서 applied/rejected)를 기록한다.

## 큰 앱 호출 changeset이 supervisor control frame을 못 지난다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/supervision, packages/protocol]
closed: fixed
guard: fit_test.ts
```

지금: changeset 상한은 호출당 8MiB(`invocations/changesets.ts` `CHANGESET_MAX_BYTES`)인데, 호출 응답은 changeset을 base64로 싣고 supervisor control frame 하나(`CONTROL_MAX_BYTES` 256KiB, `protocol/base/frame.ts`)를 지난다. `runtime/supervisor/relay.ts`는 응답 상한을 `CONTROL_MAX_BYTES - 1024`로 두고, 넘으면 `{ sent: true, response: null }`이라 호출이 "결과 모름"으로 닫힌다. 원본 changeset이 약 190KiB를 넘는 write가 이렇게 된다. 앱 쪽(`runtime/entrypoint`)은 changeset 크기를 보고 줄이지 않는다.

영향: write는 DB에 반영됐는데 invocation은 unknown에 changeset 없음이다. 범위에 그런 write가 있으면 rewind가 통째로 막혀 그 앱은 그 시점 이전으로 못 돌아간다. 사람이 data를 잃을 수 있는 쪽이다.

고치려면:
- 앱 process가 응답을 만들 때 changeset이 frame에 안 들어가면 changeset을 빼고 "너무 큼"으로 알린다. core는 이미 있는 `too_large` 경로(`changesetVerdict`)로 "DB를 되돌리지 못함" 표시만 하고 rewind를 막지 않는다. 작음.
- changeset을 frame 밖(blob 준비 통로, 파일)으로 넘긴다. 8MiB까지 되돌릴 수 있다. 큼(supervisor를 지나지 않는 통로 설계).
- `CHANGESET_MAX_BYTES`를 frame에 맞춰 낮춘다(작음. 위 첫 안과 같이 가야 앱이 알 수 있음).
추천: 첫 안으로 막힘을 표시로 바꾸고, 큰 write가 실제로 나오면 둘째 안으로 간다. rewind 적용 쪽(`APPLY_BODY_MAX_BYTES` 64MiB)이 control frame을 지나는지도 같이 확인한다.

정한 것: frame에 안 들어가는 changeset은 앱이 빼고 too_large로 알린다. core는 그 write만 "되돌리지 못함"으로 표시하고 나머지 rewind는 막지 않는다.

닫음: 앱 process(`entrypoint/fit.ts`의 `fitChangeset`)가 응답이 `CALL_RESPONSE_MAX_BYTES`(control frame 256KiB에서 1KiB를 뺀 값)를 넘으면 changeset을 빼고 `changeset_dropped: "too_large"`를 싣는다. 호출은 결과 모름이 아니라 `succeeded`/`failed`로 닫히고 요약에 `changeset_dropped`가 남는다. 그 write만 되돌리지 못하고 나머지 rewind는 막지 않는다.

## rewind 적용 요청이 control frame 256KiB를 넘을 수 있다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/main]
closed: fixed
guard: packages/core/apps/runtime/supervisor-link_test.ts
```

지금: `core/apps/rewind/run.ts`의 `link.apply`가 되돌릴 changeset을 모두 base64로 한 요청에 담는다(`runtime/supervisor-link.ts`의 `apps.apply`, `runtime/control-protocol.ts`의 `applyInputSchema`, `main/app-supervisor/assembly.ts`). 이 요청은 core와 supervisor 사이 control pipe의 json frame 하나라 `protocol/base/frame.ts`의 `CONTROL_MAX_BYTES`(256KiB)를 넘으면 `encodeFrame`이 `control frame exceeds limit`로 throw한다. `entrypoint/limits.ts`의 `APPLY_BODY_MAX_BYTES`(64MiB)는 supervisor와 앱 process 사이 socket의 한도라 이 frame을 막지 못한다. 호출 하나의 changeset은 이제 frame 안에 들지만(too_large로 뺌) 여러 write를 한꺼번에 되돌리면 합이 넘을 수 있다. 코드로만 따라갔고 재현하지 않았다.

영향: 사람이 여러 write를 되돌리려 하면 rewind 적용이 통째로 실패한다. 요청이 나가기 전에 부호화에서 실패하므로 앱 data는 바뀌지 않는다. throw가 `channel.request`에서 어떤 오류 코드로 바뀌는지는 따라가지 않았다.

고치려면:
- changeset을 write 하나씩 나눠 보낸다(중간. 중간에 실패하면 일부만 되돌린 상태가 된다).
- apply 본문을 bytes frame stream으로 보낸다(중간). 추천.

닫음: `apps.apply`는 json 요청(`worker_request`에 `channel`, payload는 `{ app }`만)을 먼저 보내고 본문(`ProcessApplyRequest` JSON)을 같은 channel의 `bytes` frame(`STREAM_CHUNK_MAX_BYTES` 단위, 쓰기가 끝나야 다음)과 `end`로 보낸다. 보내다 실패하거나 기한이 지나면 core가 `abort`를 보내고 `unavailable`로 끝낸다. supervisor(`supervisor/control-link.ts`)는 `end`까지 모았다가 op 처리기에 body로 넘긴다. 뒤집은 changeset 전부가 한 transaction으로 가는 것은 그대로다. 같은 변경에서 core가 `CALL_BODY_MAX_BYTES`를 넘는 호출 입력을 보내기 전에 `invalid_input`으로 거절한다.

## changeset을 빼도 `result`가 control frame을 넘으면 결과 모름으로 닫힌다

```yaml
kind: bug
modules: [packages/core/apps]
closed: fixed
guard: packages/core/apps/runtime/entrypoint/fit_test.ts
```

지금: 앱 호출 결과 값 상한 `RESULT_MAX_BYTES`(1MiB, `entrypoint/limits.ts`)가 응답이 지나는 control frame(256KiB)보다 크다. `fitChangeset`은 changeset만 빼므로 `result`가 256KiB 근처를 넘으면 relay가 응답을 거절하고 호출이 결과 모름(`unknown`)으로 닫힌다.

영향: 큰 읽기 결과를 내는 앱 호출이 실패가 아니라 결과 모름이 되고, write라면 rewind가 막힌다.

고치려면:
- `RESULT_MAX_BYTES`를 frame 한도 아래로 낮춘다(작음). 추천.
- 응답을 bytes frame stream으로 보낸다(중간).

닫음: `RESULT_MAX_BYTES`는 `CALL_RESPONSE_MAX_BYTES - 1024`(결과 밖 칸 몫)라 상한 안의 결과는 changeset을 빼면 늘 control frame에 든다. 같은 이유로 입력 상한 `CALL_BODY_MAX_BYTES`도 `CONTROL_MAX_BYTES - 2 * 1024`(target·envelope 몫)로 낮췄고, core가 그보다 큰 입력은 보내기 전에 `invalid_input`으로 거절한다(`createAppProcessLink.call`). 큰 값은 blob이나 file로 넘긴다.

## 앱 secret 값과 OAuth sign-in을 지울 길이 없다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/apps, packages/core/secrets]
closed: fixed
guard: packages/core/apps/oauth/service_test.ts "signing out removes the tokens and keeps the client"
```

지금: 앱 Access 탭은 값 넣기([Set value], [Set client secret], [Sign in])만 있다. shell에서 `secrets/delete`를 부르는 곳은 provider 설정(`packages/shell/renderer/desktop/settings/providers/core-source.ts`)뿐이다. grant를 [Revoke]해도 core는 `secrets.json`의 값을 지우지 않는다. 앱 OAuth token은 refresh가 거절될 때만 지워진다.

영향: 사람이 앱의 Google sign-in을 끝내거나(sign-out) 넣은 API key를 지우려면 서비스 쪽에서 client나 token을 폐기해야 한다. lophn 안에 refresh token이 남아 있고 화면은 계속 "Signed in"이다.

고치려면:
- 작음(추천): secret 줄에 [Sign out]·[Remove value]를 둔다. plain은 `secrets/delete`, OAuth는 새 route `apps.oauth_sign_out`이 vault의 `remove`(access·refresh·meta)를 부른다. client id·secret은 남긴다. wireframe을 먼저 고친다.
- 중간: grant를 [Revoke]하면 그 secret 값과 OAuth token을 같이 지운다. 같은 이름을 선언한 다른 앱도 같은 값을 쓰므로(앱 secret 이름은 전역이다) 다른 앱이 쓰는 값까지 지워진다.

닫음: 첫째 안으로 고쳤다. 앱 Access 탭의 plain secret 줄은 값이 있으면 [Remove value]가 `secrets/delete`를 부른다. OAuth 줄은 `signed_in`·`failed`일 때 [Sign out]이 새 route `apps.oauth_sign_out`(`packages/protocol/apps/oauth.ts`)을 부르고, core(`packages/core/apps/oauth/service.ts`)가 `createMcpOAuth`의 `signOut`으로 진행 중인 시도와 실패 기억을 버리고 vault의 access·refresh·meta를 지운다. client id와 client secret은 남는다. grant [Revoke]는 값을 지우지 않는다(앱 secret 이름은 전역이라 다른 앱이 같은 값을 쓴다).

## app.status 요약이 `[object Object]`를 돌려준다

```yaml
kind: bug
modules: [packages/core/apps]
closed: fixed
guard: packages/core/apps/agent-tools/runtime_test.ts "app.status 요약이 상태 이름과 이유를 보이고 [object Object]를 싣지 않는다"
```

지금: `packages/core/apps/agent-tools/runtime.ts`의 `app.status` handler가 `fitted(\`app ${input.app} is ${body.state}\`, body)`를 부른다. `body.state`는 문자열이 아니라 `{ state, termination_pending, reason? }` 객체다(`packages/protocol/apps/runtime.ts`의 `runtimeStateSchema`). 그래서 요약이 `app app_01m661c1… is [object Object]`가 된다. 실제 session에서 네 번 모두 그 문장이었다.

영향: model이 결과를 읽을 때 요약 줄에서는 앱 상태를 알 수 없고 뒤 `content`를 따로 읽어야 한다. 요약은 tool 결과 목록과 turn 기록에 그대로 남는 줄이라, 나중에 기록만 보고 진단할 때 상태가 보이지 않는다. `app.status`는 앱이 뜨지 않을 때 agent가 가장 먼저 부르는 tool이다.

고치려면:
- 작음(추천): `${body.state.state}`로 고치고, `reason`이 있으면 덧붙인다(`app X is unavailable (reason)`). handler 한 줄이다.
- 작음: 요약 함수를 protocol에 두고 output schema에서 만든다. 한 곳에서만 쓰는 요약에 공용 장치를 두는 것은 과하다.
- 추천: 앞의 것.

닫음: `runtime.ts`의 `app.status` 요약이 `body.state.state`를 쓰고, `reason`이 있으면 ` (<code>: <summary>)`를 덧붙인다. 예: `app app_x is unavailable (crash_loop: unexpected exits exceeded five within ten minutes)`.

## 서비스가 sign-in을 거절해도 "시간이 지났다"로 보인다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/apps]
closed: fixed
guard: 없음
```

지금: 사람이 browser에서 [거부]를 누르면 발급자가 loopback으로 `error=access_denied`를 돌려준다. `openCallbackListener`(`packages/core/lophn-agent/extensions/mcp-auth-control.ts`)는 그 요청을 `refused`로 받아 `receive`를 실패로 끝내고, `createMcpAuth`의 `complete`(`packages/core/lophn-agent/extensions/mcp-auth.ts`)는 받기 실패를 모두 `callback_timeout`으로 적는다. 앱 Access 탭과 MCP 상태가 같은 code를 쓴다.

영향: 사람이 거절했는데 앱 Access 탭은 "Sign-in timed out. Try again."을 보인다. 사람은 왜 끝났는지 모르고 다시 같은 sign-in을 연다.

고치려면:
- 작음(추천): listener가 거절을 `forbidden`으로, 시한·취소를 `unavailable`로 이미 나눠 돌려준다. `complete`가 `forbidden`이면 `exchange_failed`(문구 "The service rejected the sign-in.")로 적는다. 실패 이유 enum은 그대로다.
- 작음: 이유 `denied`를 `McpAuthFailure`와 `APP_OAUTH_FAILURES`에 더하고 문구를 하나 더한다. 계약과 화면 둘을 고친다.

닫음: `createMcpAuth`의 `complete`가 받기 실패의 `forbidden`(발급자가 거절)을 `exchange_failed`("The service rejected the sign-in.")로 적는다. 시한·취소(`unavailable`)는 `callback_timeout` 그대로다. 실패 이유 enum은 바뀌지 않았다.

## 새 data root에는 옛 SDK 판이 없어 그 판에 고정된 앱이 준비되지 않음

```yaml
kind: bug
modules: [packages/core/apps/packages]
closed: fixed
guard: 없음
```

지금: SDK package마다 source 폴더가 하나라 `installSdkCopies`(`packages/core/apps/packages/install.ts`)는 지금 판만 `<data root>/sdk/<이름>/<판>`에 깐다. 옛 판 사본은 지우지 않으므로 이미 쓰던 data root에서는 `@lophn/declaration` 2.0.0, `@lophn/app-ui` 2.0.0에 고정된 앱이 그대로 돈다. 새 data root에는 2.1.0만 있어, 2.0.0에 고정된 앱 source를 연결하면 release 준비의 SDK sync가 `not_found`로 실패한다.

영향: 다른 기계나 새 data root로 옮긴 사람의 옛 앱이 의존 판을 올리기 전까지 준비되지 않는다. 판을 올릴 때마다 같다.

고치려면: (가) 옛 판 사본을 제품에 같이 싣는다(SDK 폴더를 판마다 두거나 release 때 사본을 남긴다). (나) 준비 실패 이유에 "앱의 SDK 판을 지금 판으로 올린다"를 싣는다. 추천은 (나): 가장 단순하고 앱 agent가 바로 고친다.

닫음: (나)로 했다. SDK sync의 `not_found`가 앱이 고정한 `<package>@<판>`, 깔린 판 목록, "앱의 의존 판을 깔린 판으로 올린다(새 SDK는 code를 고쳐야 할 수 있다)"를 싣고, release 준비(`from-source.ts`)가 그 글을 `sdk_not_installed: …` 이유에 그대로 넘긴다. 옛 판 사본은 여전히 싣지 않는다. 본문의 판 숫자는 그때 것이다(지금 `@lophn/declaration` 3.0.0, `@lophn/app-ui` 2.2.0).
