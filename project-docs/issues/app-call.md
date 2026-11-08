# app-call

앱 tool 호출의 판정, 기록, write 직렬화와 changeset 기반 rewind. `project-docs/architecture/app-call.md`.

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

## 앱 e2e 여섯이 test 앱에 patch를 얹지 못하고 시작에서 실패한다

```yaml
kind: bug
modules: [tests]
```

지금: `npm run e2e`에서 앱을 띄우는 test 여섯(`app-activation_test`, `app-call_test`, `app-data-rewind_test`, `app-restart_test`의 셋)이 `createAppSource`(`tests/support/app/source.ts`)의 patch 단계에서 `…/source/lophn.ts에 patch 자리가 없다`로 끝난다. `patch-call.ts`, `patch-migration.ts`, `patch-restart.ts`, `patch-crash.ts`가 모두 `replaceOnce`로 `lophn.ts`의 같은 자리(`name: "add_item"` 묶음 앞)를 찾는다. 견본 `tests/support/app/sample/lophn.ts.tmpl`에는 그 글이 있으므로, core가 깐 template 위에 견본이 얹히는 순서나 결과가 patch가 기대하는 모양과 다른 것으로 보인다. 원인은 확인하지 못했다. main(`1716652a9`)에서도 같은 여섯이 같은 오류로 실패한다.

영향: 앱 tool 호출, release activation, 앱 data rewind, 앱 재시작의 e2e가 아무것도 검사하지 못한다. 이 길이 깨져도 land가 잡지 못한다.

고치려면:
- 작음(추천): 한 test의 data root(`/tmp/lophn-e2e-*/home/apps/<app>/source/lophn.ts`)를 열어 patch 직전 모양을 보고, 견본 overlay와 patch 자리를 다시 맞춘다.

## preview 화면은 operation을 부르지 못한다

```yaml
kind: bug
modules: [packages/shell/main, packages/core/apps]
```

- 지금: shell main의 화면 호출(`packages/shell/main/app-frame/app-call.ts`)은 view의 고정 선언을 `declaration-source.ts`로 읽는데, live release일 때만 읽는다. preview view에서는 `unavailable`이다. core의 `callPreview`는 person의 preview 호출을 받는다.
- 영향: 앱을 짓는 쪽이 preview에서 화면을 눌러 operation을 확인하지 못한다. agent는 `preview.call`로 부르지만 사람은 화면으로 확인할 길이 없다.
- 고치려면: `declaration-source.ts`가 preview bundle의 선언도 읽고 호출 대상을 `{mode: "preview", app, process_nonce}`로 보낸다. 작다.

## `@me` package가 다른 `@me`에 기대면 그 권한을 따라가지 않는다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: `package.publish`는 폴더 `package.json`의 `dependencies` 중 `@lophn/cap-*`만 보고 요구 권한을 검사한다(`packages/core/apps/packages/publish.ts`의 `dependencyNames`, `packages/core/apps/releases/sdk-permissions.ts`의 `missingCapPermission`). release 준비도 소비 앱이 직접 적은 `@me` 의존의 catalog `permissions`만 본다(`missingSdkPermission`).

영향: `@me/a`가 `net.fetch`를 적은 `@me/b`에 기대면서 자기 `permissions`에 `net.fetch`를 빼고 낼 수 있다. `@me/a`만 쓰는 소비 앱은 `net.fetch` 없이 release가 뜨고 실행 중 broker에서 거절된다.

고치려면:
- 작음(추천): publish 때 `@me/*` 의존의 정확한 판을 catalog에서 찾아 그 `permissions`도 입력이 덮는지 본다. 한 단계만 보면 된다(그 판도 publish 때 같은 검사를 지났으므로).

## 기동 옮기기가 옛 `@me` 판에 bundle blob을 못 붙일 수 있다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/main]
```

지금: bundle blob 이전에 낸 판은 기동 때 설치 사본에서 `package.json`의 `file:` 재작성을 되돌려 bundle byte를 다시 만든다(`packages/core/apps/packages/restore.ts`). `prepareCopyFiles`가 `package.json`을 `JSON.stringify(_, null, 2)`로 다시 쓰므로, 원래 파일이 그 모양이 아니었으면 hash가 `bundle_hash`와 달라 blob을 붙이지 못하고 기동마다 `me_copy_skipped`만 남긴다. `owner_app`이 null인 package도 건너뛴다.

영향: 그런 옛 판은 설치 사본이 유일한 byte로 남는다. 사본을 잃으면 그 판을 고정하려는 앱이 sync에서 `not_found`를 본다.

고치려면:
- 작음(추천): 사람의 data root에 `@me` 판이 있는지, 몇 개가 건너뛰어지는지 먼저 본다. 없거나 모두 붙었으면 kept로 닫는다.
- 남는 판이 있으면: 옛 판은 설치 사본 byte 자체를 blob으로 보존하는 별도 field를 둔다.

## 앱이 떠 있는 동안 grant를 거두면 계속 unavailable이다

```yaml
kind: bug
modules: [packages/core/apps, packages/shell/renderer]
```

지금: Access 탭의 Revoke(`packages/shell/renderer/app-frame/app-detail/core-source.ts` `revoke`)는 `app_grants.revoke`를 바로 보낸다. handler(`packages/core/apps/permissions/commands.ts`)는 앱의 마지막 process 사실(`lastProcessFact`, `permissions/store.ts`)이 `AppStarted`면 `unavailable`("process termination is not confirmed")로 거절한다. 주석이 말하는 "부르는 쪽(GrantApplier)이 stop으로 종료를 확인한다"의 그 부르는 쪽이 코드에 없다. `grep GrantApplier`는 그 주석 한 줄뿐이고, 앱 process를 멈추는 길(`supervisor.stop`, reconcile)은 revoke 앞에서 아무도 부르지 않는다.
- 앱이 떠 있으면 사실이 `AppStarted`라 revoke는 항상 거절된다. 화면은 `setProblem("revoke")` toast만 보이고 `requested`에 담지 않으므로 "정리 중"으로도 보이지 않는다.
- 사람이 앱 실행을 끄면 supervisor가 `record_stopped`를 남겨 그 뒤에야 거둘 수 있다. 화면이 그렇게 하라고 알려 주지는 않는다.
- 떠 있던 process가 crash loop로 멈추거나(`halt`) core가 `AppStopped` 없이 내려갔다 다시 뜨면, 앱이 안 도는데도 마지막 사실이 `AppStarted`로 남는다. `stopTracked`는 자식이 없으면 `record_stopped`를 건너뛰므로 실행을 꺼도 사실이 바뀌지 않아, 앱을 다시 켜서 멈추기 전에는 거둘 수 없다. (코드를 읽어 본 것이고 이 경로를 실행해 보지는 않았다.)

영향: 사람이 앱에 준 외부 net·secret·다른 앱 호출 권한을 거두는 유일한 길이 막혀 있다. 앱을 쓰는 중에는 거둘 수 없고, 권한 경계에서 사람이 한 결정이 반영되지 않는다.

고치려면:
- revoke를 받는 쪽에서 core가 supervisor에 그 앱을 멈추라고 요청하고(`pause`와 같은 종료 확인), `AppStopped`가 남은 뒤 `markRevoked`를 한다. 중간. 사람이 누른 한 번으로 끝난다. 추천.
- 마지막 사실이 아니라 supervisor의 지금 상태(살아 있는 child 유무)를 본다. 중간. crash·재시작 뒤 stale한 사실 문제도 같이 푼다. 위와 함께 하면 좋다.
- 화면이 "앱 실행을 끈 뒤 거두라"고 알린다. 작음. 권한을 거두려고 앱을 끄게 하므로 임시 방편이다.

## 앱 child가 exit 0으로 끝나면 다시 뜨지 않고 core도 모른다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: `packages/core/apps/runtime/processes/terminate.ts` `unexpected`는 의도하지 않은 종료 중 exit code가 0이 아닌 것만 예상 밖으로 본다. `packages/core/apps/runtime/supervisor/supervisor.ts` `onChildExit`는 `runtime.tracked = undefined`와 `exit` 관측을 낸 뒤 `unexpected`가 false면 바로 돌아온다. 그래서 `record_unavailable`도, backoff도, 재시작(`apply`)도 없다. app supervisor에는 주기적으로 다시 맞추는 sweep이 없다(다음 `reconcile`이 와야 다시 뜬다).

영향: AI가 쓴 앱 code가 `process.exit(0)`로 끝나거나 server가 정상 종료로 닫히면, 앱은 desired가 켜져 있는데 죽은 채로 남는다. core 원장의 마지막 사실은 `AppStarted`라 앱 상태는 "실행 중"으로 보이고, 이 앱의 tool 호출·화면은 실패한다. 사람은 실행을 껐다 켜기 전까지 원인을 볼 단서가 없다.

고치려면:
- 의도하지 않은 종료는 exit code와 상관없이 예상 밖으로 센다(`unexpected`에서 `exitCode !== 0` 조건을 뺀다). 작음. 추천. 앱 server가 0으로 끝나는 것도 정상이 아니다. backoff와 crash loop 한도가 이미 있어 무한히 다시 뜨지 않는다.
- 0이면 `record_unavailable`만 남기고 다시 띄우지 않는다. 작음. 사람이 이유를 보지만 앱은 여전히 죽어 있다.
