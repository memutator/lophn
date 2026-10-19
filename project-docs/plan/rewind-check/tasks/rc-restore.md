# rc-restore

app test driver가 examples 호출마다 받은 write changeset을 버리지 않게 하고, 모은 changeset을 최신부터 뒤집어 적용해 첫 호출 전 상태로 돌아오는지 보는 driver 메서드 `restore`를 더한다. examples 검사가 그것을 쓰는 일은 `rc-examples-restore`가 한다.

- 단위: rewind-check (wave 1)
- 선행: rc-wire. `work/app-driver.ts`를 같이 고친다.
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/harness/driver.ts`
  - `packages/core/problems/tests/harness/rpc.ts`
  - `packages/core/problems/tests/work/app-driver.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(changeset은 최신부터 뒤집어 한 transaction으로 적용하고, 충돌하면 통째로 취소한다)
  - 계획: `project-docs/plan/rewind-check/README.md`의 "진단"(c)
  - 지금 코드: `harness/driver.ts`(`CallOutcome`, `AppDriver`, `RewindRun`), `harness/rpc.ts`(`METHODS`, `rpcDriver`), `work/app-driver.ts`(`call`, `rewind`가 쓰는 `invertAll`·`/_lophn/control/apply`·`dataState()`), `packages/core/apps/runtime/entrypoint/invoke.ts`(write 응답의 `changeset`, base64)
- 계약:
  - 쓰는 것: 앱 runtime의 write 응답 `changeset`
  - 내놓는 것(다른 task가 기댄다):
    - `CallOutcome`의 `ok` 갈래에 `changeset?: string`(base64. write·external 호출이 DB를 바꿨을 때만).
    - `AppDriver.restore(changesets: readonly string[]): Promise<RestoreRun>`. `RestoreRun = { applied: boolean; restored: boolean; reason: string }`. 받은 순서가 호출 순서이고 최신부터 뒤집는다. 비교 기준은 driver가 처음 앱을 부르기 전에 잡은 DB 상태(`dataState()`)다.

## 할 일

1. `driver.ts`: 위 type을 더한다.
2. `app-driver.ts`: `call()`이 응답의 `changeset`을 `CallOutcome`에 싣는다. `restore`를 구현한다(첫 호출 전 상태를 잡아 두고, `invertAll`로 뒤집어 `/_lophn/control/apply`로 한 번에 적용, `dataState()` 비교). 이미 `rewind`가 같은 일을 하므로 그 코드를 함께 쓰게 정리한다(사본을 만들지 않는다).
3. `rpc.ts`: `restore`를 표와 `rpcDriver`에 더한다.
4. `AppDriver`를 구현하는 가짜(test의 fake driver)가 type 때문에 깨지면 그 줄만 최소로 맞추고 "넘길 줄"에 적는다(`harness/checks_test.ts`·`examples_test.ts`는 다른 task도 고친다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 — 판정은 `rc-examples-restore`의 test가 본다. 이 task는 driver 길이고 `rewind` 검사가 같은 뒤집기 길을 이미 쓴다.
- 확인: 진단 script(`/home/pyosechang/projects/lophn/.claude/worktrees/plan-rewind-check/.dev-data/rc-diagnose/repro.ts`, git 밖)를 이 worktree로 돌려 template 앱의 app test가 여전히 `pass`인지 본다. commit하지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
