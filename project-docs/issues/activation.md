# activation

ticket 확인됨 뒤 prepared release를 운영 앱으로 올리는 순서와 실패 복구. `project-docs/architecture/activation.md`.

## write app-api의 rewind 검사가 fail로 나온다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps]
```

지금: harness `rewind` 검사(`core/problems/tests/harness/checks.ts` `rewind`, `work/app-driver.ts` `rewind`)가 write app-api를 선언 순서대로 하나씩 부른다. 입력은 `validValue(declaration.inputSchema)`로 만든 값이라, 앞선 상태(이미 있는 행 등)가 있어야 성공하는 api는 호출이 실패하고 검사는 `fixture 입력의 호출이 성공하지 못했다`로 fail이다. `app-test/generate.ts`는 write가 하나라도 있으면 이 검사를 필수로 둔다.

영향: 정상인 앱도 release 준비의 test가 fail이라 coding agent가 앱 code를 왜곡하거나 막힌다. 앱이 입력을 줄 길이 없다.

고치려면:
- 실제로 막히는 앱이 나올 때까지 둔다(비용 0).
- 앱이 write api마다 fixture 입력을 선언하게 한다(blueprint 확장, 중간 크기).
- 호출이 `invalid_input`/`not_found`로 거절되면 fail 대신 not_applicable로 둔다(작음. 그러나 rewind를 증명 못 한 채 통과).
추천: 막힌 앱이 생길 때까지 둔다.

정한 것: 실제로 막히는 앱이 나올 때까지 둔다.

막힌 앱이 나왔다: 계획 `domain-tools`의 손 확인에서 내장 template 앱(write tool `add_item`)이 release 준비의 app test에서 "필수 검사 1개가 통과하지 못했다: rewind"로 떨어져 활성화되지 않았다. e2e `tests/e2e/app-release_test.ts`의 두 test도 같은 문구로 떨어진다. rewind 호출이 왜 실패했는지는 보지 못했다(검사 detail은 coding·user token 모두 `forbidden`). 정한 것을 다시 정해야 한다.

바로잡음(계획 `rewind-check`의 진단): 위 실패는 이 이슈의 입력 문제가 아니었다. 계획 `domain-tools`가 process wire에서 `context.project`를 지웠는데 `packages/core/problems/tests/work/app-driver.ts`가 아직 `project: null`을 실어, 앱 runtime이 harness의 모든 호출을 400 `invalid_input "call request is invalid"`로 거절했다. 세 줄을 지우면 template 앱은 통과한다. 이 이슈(만든 입력이 앞선 상태를 요구하는 tool에서 실패함)는 그대로 남고 아래 다시 정한 것으로 고친다.

다시 정한 것(사람, 2026-10-19): 검사 입력을 새로 만들지 않고, 실제로 성공한 write 호출을 되돌려 본다.
- 앱 자신의 test(ticket check `app_test`)나 ticket `examples`가 부른 write 호출의 changeset을 뒤집어 적용해, 호출 전 상태로 돌아오는지 본다.
- 만든 입력의 호출 자체가 실패한 write tool은 fail이 아니라 "증명 못 함"이다. activation을 막지 않는다.
- 증명 못 한 tool은 examples ticket일 때만 problem으로 알린다(planner, 계획 `rewind-check` 진단 뒤). examples run이 끝날 때 같은 (app, bundle_hash) app test의 증명 못 함에서 그 examples가 되돌리기를 증명한 tool을 뺀 것만 낸다. examples가 아닌 ticket은 app test 증거와 pass 이유 한 줄로만 남긴다.
  - 근거: release마다 그대로 올리면 examples가 이미 증명한 tool도 매번 경고가 되어 아무도 보지 않게 된다. examples run과 app test는 (app, bundle_hash)로 이미 이어져 있어 problems 안에서 차이를 낼 수 있다. examples가 아닌 ticket을 activation 때 알리려면 activation이 모르는 app test 증거와 ticket check 종류를 apps → problems 경계 너머로 이어야 해 비싸다. 그 ticket은 업무 규칙 확인이 애초에 없고 examples를 넣는 것이 증명하는 길이다.
- tool 선언에 test 전용 fixture 칸은 두지 않는다. 운영과 무관한 data가 선언에 들어가고, 앞 호출이 만든 id를 고정 값으로 맞출 수 없다.
- 먼저 할 것:
  1. template `add_item`(앞선 상태가 필요 없는 tool)이 왜 실패했는지 진단한다. 입력 문제가 아닌 다른 bug일 수 있다.
  2. 검사 detail이 coding·user token 모두에 `forbidden`인 것도 같이 본다.
  3. harness가 앱 test·examples 안의 호출마다 changeset을 받을 수 있는지 확인한다.

## app test 검사별 detail을 아무도 읽지 못한다

```yaml
kind: defect
modules: [packages/core/problems, packages/core/storage]
```

지금: 검사마다의 이유와 증거는 verification의 `observations` blob에 있다. 그 칸은 `general_read: false`로 등록돼(`packages/core/problems/tests/blobs.ts`의 `TEST_BLOB_FIELDS`) `blob.read`가 어느 actor에게도 주지 않는다(`packages/core/storage/blobs/refs.ts`의 `generalReadAllowed`). `GetVerification`의 `detail: true`는 별도 권한을 보지만(`packages/core/problems/tests/reads.ts`의 `readVerification`) 허락돼도 hash만 든 같은 Verification을 돌려준다. 그래서 detail은 disk에서만 읽힌다.

영향: 검사가 떨어진 이유를 coding agent와 사람이 화면·CLI로 볼 수 없다. 계획 `rewind-check` 진단은 data root의 blob 파일을 직접 열어 원인을 찾았다. 계획 `rewind-check`의 `rc-wire`가 fail 이유 한 줄에 검사별 이유를 실어 지금 필요한 만큼은 보인다.

고치려면:
- 그대로 둔다(비용 0). fail 이유 한 줄이 검사별 이유를 싣는다. 추천.
- `detail: true`가 허락된 자격에 observations 내용을 싣는다(작음~중간. 그 blob에 앱 출력이 들어 있어 누가 읽을지 정해야 한다).

## examples가 아닌 ticket의 release에서 "증명 못 함" write tool을 알리지 않는다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps]
```

지금: app test `rewind` 검사가 만든 입력의 호출이 실패한 write tool을 "증명 못 함"으로 두고(증거 `unproven`, pass 이유 한 줄), problem은 examples ticket의 examples run이 끝날 때만 낸다(위 "write app-api의 rewind 검사가 fail로 나온다"의 정한 것). check가 `app_test`·`text`인 ticket의 release는 증명 못 한 write tool이 있어도 problem이 없다.

영향: examples 없이 활성화된 release의 write tool은 되돌리기가 틀려도 아무도 모른다. rewind가 그 tool의 호출을 틀리게 되돌리면 사람이 고른 시점의 앱 data가 어긋난다.

고치려면:
- activation 때 그 release의 app test 증거에서 `unproven`을 읽어 problem으로 낸다(중간. activation(`packages/core/apps/releases/activation`)이 app test 증거를 모르므로 apps → problems port가 필요하다).
- App Engineer 지침이 write tool을 바꾸는 ticket에 examples check를 쓰게 한다(작음. 지침 문장. planner가 domain-place의 지침 land 뒤 넣는다).
