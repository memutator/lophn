# fix-rewind-check

releases-problems-tests(`8f618d2a`)가 앱 test의 `rewind` 검사를 정의만 두고 write app-api가 있으면 inconclusive로 남겼다. changeset 뒤집기(`invertAll`·`invertChangeset`)가 `core/apps/rewind/invert.ts`에만 있어 test runner(problems)가 쓸 수 없기 때문이다. 그래서 write app-api가 있는 앱은 release 준비가 막힌다. 순수 함수를 base로 옮기고 검사를 짓는다.

- 단위: releases-problems (wave 3 계약 고침)
- 소유(이 task만 고친다):
  - `packages/core/apps/rewind/invert.ts` → `packages/base/`의 알맞은 곳으로 옮기기(IO 없는 순수 함수만)와 그것을 import하는 줄
  - `packages/core/problems/tests/app-test/generate.ts`, `packages/core/problems/tests/work/app-driver.ts`, `harness/` 의 rewind 검사
- 읽을 것: releases-problems-tests brief와 그 결과(`git show 8f618d2a --stat`), `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`
- 계약: 바꾸지 않는다.

## 할 일

1. `invert.ts`를 base로 옮기고 core apps rewind가 그것을 쓰게 한다.
2. `app-test/generate.ts`에서 `rewind`의 precomputed를 지우고 harness 검사로 바꾼다.
3. `work/app-driver.ts`에 write app-api 호출, `call` 응답의 `changeset` 뒤집기, `/_lophn/control/apply`, 전후 DB 상태 비교를 더한다. 필요한 만큼 fixture 입력과 앞선 상태를 만드는 `prepare`를 되살린다. 가장 단순하게 짠다.

## 끝남

- `deno task check:full`이 통과한다. core가 기동 오류 없이 뜬다.
- 위험 test: "뒤집은 changeset을 적용하면 앱 DB가 호출 전 상태로 돌아간다" 1개(이미 있는 test가 보면 새로 쓰지 않는다).
