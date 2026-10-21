# tr-check-enable

`tools/check.ts`의 `NOT_CHECKED`를 지워 `tests/e2e`, `tests/eval`, `tests/support` 전체가 다시 type check되게 한다. `deno test` discovery에서는 지금처럼 `tests/e2e`와 `tests/live`만 뺀다. 남은 type·lint·test 오류를 고쳐 `deno task check`와 `deno task e2e`가 통과하게 한다. 사람이 commit하지 않은 재료(calendar-app-dev, calendar-app-user)는 건드리지 않는다.

- 단위: check (wave 3)
- 선행: 없음. wave 2까지의 모든 task가 merged여야 열린다(wave가 막는다).
- 소유(이 task만 고친다):
  - `tools/check.ts`
  - `tests/e2e`
  - `tests/eval`
  - `tests/support`
- 계약:
  - 쓰는 것: 앞 task 모두가 내놓은 helper와 type
  - 내놓는 것: `NOT_CHECKED`가 없고 `NOT_IN_CHECK`는 `["tests/e2e", "tests/live"]`다. land(`land.sh test-restore`)가 `LOPHN_LAND_SKIP_E2E` 없이 돈다.

## 할 일

`NOT_CHECKED`를 지우고 `deno task check`와 `deno task e2e`를 끝까지 돌려 남은 오류(지켜볼 것의 `registration_test`·`annotation_test` flake 포함)를 고친다.
