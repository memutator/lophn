# activation

ticket 확인됨 뒤 prepared release를 운영 앱으로 올리는 순서와 실패 복구. `project-docs/architecture/activation.md`.

## write app-api의 rewind 검사가 fail로 나온다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps]
```

지금: harness `rewind` 검사(`core/problems/tests/harness/checks.ts` `rewind`, `work/app-driver.ts` `rewind`)가 write app-api를 선언 순서대로 하나씩 부른다. 입력은 `validValue(declaration.input)`로 만든 값이라, 앞선 상태(이미 있는 행 등)가 있어야 성공하는 api는 호출이 실패하고 검사는 `fixture 입력의 호출이 성공하지 못했다`로 fail이다. `app-test/generate.ts`는 write가 하나라도 있으면 이 검사를 필수로 둔다.

영향: 정상인 앱도 release 준비의 test가 fail이라 coding agent가 앱 code를 왜곡하거나 막힌다. 앱이 입력을 줄 길이 없다.

고치려면:
- 실제로 막히는 앱이 나올 때까지 둔다(비용 0).
- 앱이 write api마다 fixture 입력을 선언하게 한다(blueprint 확장, 중간 크기).
- 호출이 `invalid_input`/`not_found`로 거절되면 fail 대신 not_applicable로 둔다(작음. 그러나 rewind를 증명 못 한 채 통과).
추천: 막힌 앱이 생길 때까지 둔다.

정한 것: 실제로 막히는 앱이 나올 때까지 둔다.

## activation이 가끔 새 앱의 ready를 못 보고 start_failed로 끝난다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/main/app-supervisor]
```

지금: activation 허락 뒤 release가 `failed`, failure `{code: "start_failed", summary: "the new app did not become ready"}`로 끝나고 runtime은 `preparing`에 머문다. `tests/e2e/app-sandbox_test.ts`를 약 200번 돌린 중 5번 났고 부하(load average 6~10)가 높을 때 잦았다. core.log는 비고 앱 stderr를 볼 길이 없어 원인은 모른다. 의심: `packages/core/main/app-supervisor/assembly.ts`의 `probeChild`(ready 기한, "exited before ready"), `packages/core/apps/releases/activation/orchestrator.ts`의 `startCandidate`.

영향: 사람이 허락한 release가 이유 없이 실패로 남고 App Engineer에게 `ReleaseActivationFailed` reaction이 간다. 앱 E2E가 모두 이 길을 지나 가끔 실패한다.

고치려면: 반복 실행으로 재현해 ready 관측과 기한 중 어디서 놓치는지 찾는다. 앱 stderr를 실패 진단에 남기면 다음 원인 찾기가 싸진다.

## running으로 보인 직후의 앱 call이 app_unavailable로 거절된다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: 앱 상태가 `running`·ready·accepting으로 읽힌 직후의 `appCallApi`가 `{status: "denied", denial: {code: "app_unavailable", message: "the app is not running"}}`다. `tests/e2e/app-sandbox_test.ts`를 약 200번 돌린 중 3번 났다. 의심: `packages/core/apps/calls/service.ts`에서 `deps.link.call`이 `sent: false`를 돌려주는 곳. 후보 관측의 ready·accepting과 운영 link 등록(`openAfterCommit`) 사이에 틈이 있을 수 있다.

영향: activation이 끝났다고 보고 부른 사람·agent의 첫 call이 거절된다. 앱 E2E가 가끔 실패한다.

고치려면: 상태가 running으로 보이는 시점과 call link가 열리는 시점을 같은 commit 뒤로 맞춘다.
