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

다시 정한 것(사람, 2026-10-19): 검사 입력을 새로 만들지 않고, 실제로 성공한 write 호출을 되돌려 본다.
- 앱 자신의 test(ticket check `app_test`)나 ticket `examples`가 부른 write 호출의 changeset을 뒤집어 적용해, 호출 전 상태로 돌아오는지 본다.
- 어디서도 성공적으로 불린 적 없는 write tool은 "증명 못 함"으로 problem에 알리고, activation을 막지 않는다.
- tool 선언에 test 전용 fixture 칸은 두지 않는다. 운영과 무관한 data가 선언에 들어가고, 앞 호출이 만든 id를 고정 값으로 맞출 수 없다.
- 먼저 할 것:
  1. template `add_item`(앞선 상태가 필요 없는 tool)이 왜 실패했는지 진단한다. 입력 문제가 아닌 다른 bug일 수 있다.
  2. 검사 detail이 coding·user token 모두에 `forbidden`인 것도 같이 본다.
  3. harness가 앱 test·examples 안의 호출마다 changeset을 받을 수 있는지 확인한다.
