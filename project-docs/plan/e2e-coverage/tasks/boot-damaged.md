# boot-damaged

`tests/support/core/`에 bootCore의 변형을 더한다: core가 시작하지 못할 때 `start_failed` frame의 이유와 종료 코드를 돌려주는 `tryBootCore`, core process env에 값을 더하는 `env` 옵션, 질문을 기다리는 `waitQuestion`, 그리고 `until` export. 이 task는 `boot-rows`, `approval-rows`, `coding-role`, `test-app`이 쓴다.

- 단위: boot-damaged (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/core/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-bugs.md` 후보 `boot-failure-frame`
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 5(`second-core-same-root`)
  - `project-docs/plan/testing/tasks/e2e-support-core.md`
  - main의 `tests/support/core/{mod,process,human}.ts`(지금 계약: `createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`)
  - 코드: `packages/core/main/daemon/main.ts`(실패하면 `start_failed {reason}` frame을 쓰고 `Deno.exit(1)`), `packages/protocol/supervision/supervision.ts`(`START_FAILURE_REASONS`: `newer_schema`, `history_mismatch`, `damaged_original`, `other`), `packages/core/storage/migration/migrations.ts`(`startFailureReason`), `packages/base/install/instance-lock.ts`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(지금 계약: `createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `coreToMainMessageSchema`, `FrameDecoder`(`tests/support/core/process.ts`가 이미 읽는다).
  - 내놓는 것: 아래 "내놓는 것" 절

## 내놓는 것

```ts
// tests/support/core/mod.ts
type BootOptions = { settings?: Record<string, unknown>; env?: Record<string, string> };
// env는 core process의 env에 더하는 값이다(예 DENO_DIR, XDG_RUNTIME_DIR). LOPHN_HOME·HOME·PATH는 덮지 못한다(거절한다).
bootCore(run: Run, options?: BootOptions): Promise<Core>      // 지금 것에 env만 더한다

// tests/support/core/try-boot.ts
type StartFailure = "newer_schema" | "history_mismatch" | "damaged_original" | "other";
tryBootCore(run: Run, options?: BootOptions):
  Promise<{ ok: true; core: Core } | { ok: false; reason: StartFailure; exit: number | null }>
// start_failed frame을 받으면 core가 스스로 끝나기를(제한 시간 15초) 기다려 종료 코드를 돌려준다. SIGKILL하지 않는다.
// 끝나지 않으면 SIGKILL하고 reason과 함께 `exit: null`로 돌려준다. 어느 쪽이든 child가 남지 않는 것을 확인한다.

// tests/support/core/human.ts
export function until<T>(what: string, read: () => Promise<T | undefined>, timeoutMs?: number): Promise<T>;   // 지금 file 안의 것을 export
waitQuestion(core: Core, session: string): Promise<{ turn: string; tool_call: string }>   // waitPermission의 짝: session_snapshots/list의 questions[0]
```
`bootCore`가 hello 대신 `start_failed`를 받았을 때 던지는 오류 글(`core 시작 실패: <reason>`)은 그대로 둔다.

## 할 일

1. `process.ts`의 `spawnCore`가 `start_failed`를 던지는 대신 값으로 돌려주게 나누고(`bootCore`가 그것을 지금 오류로 바꿔 던진다), 돌려준 쪽이 child 종료를 기다린다. `try-boot.ts`가 그것을 쓴다. 근거: 실패하는 core를 30초(hello 제한)나 SIGKILL에 기대지 않고 본다.
2. `bootCore`/`spawnCore`에 `env` 옵션을 더한다. 근거: 앱 E2E는 core가 `DENO_DIR=.dev-data/e2e/deno-dir`과 `XDG_RUNTIME_DIR`(app test가 `systemd-run --user`로 메모리 상한을 건다. `packages/core/supervision/security/memory-limit.ts`)을 가져야 한다(README 정한 것 10).
3. `human.ts`에 `until`을 export하고 `waitQuestion`을 더한다. helper 열 개 한도(`e2e-support-core`)는 "사람 역할 helper"를 세는 것이라 `waitQuestion`은 `waitPermission`과 같은 snapshot 읽기이므로 예외로 둔다. 이유를 한 줄 주석으로 남긴다.
4. 자기 점검: 새 E2E를 더하지 않는다. 임시 script(commit하지 않음)로 (a) 쓰레기 byte가 든 `lophn.db`로 `tryBootCore` → `reason: "damaged_original"`, `exit`가 0이 아님, `processesOf(run.home)`가 빔, (b) 같은 run에 core가 떠 있는 채 `tryBootCore` → `ok: false`, (c) `bootCore(run, {env: {FOO: "1"}})`의 `/proc/<pid>/environ`에 `FOO=1`이 있음을 한 번 돌려 본다. 쓰는 쪽 E2E는 `boot-rows`와 `approval-rows`가 맡는다.
5. 지금 `tests/e2e/boot_test.ts`와 `tests/e2e/secret_test.ts`가 그대로 통과해야 한다(`deno test --allow-all --no-check tests/e2e/boot_test.ts tests/e2e/secret_test.ts`를 한 번 돌린다).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `server`·`supervision`(core가 시작하지 못할 때 이유를 shell main에 알리고 아무것도 안 쓰고 끝난다. 같은 data root에 둘째 instance는 안 뜬다).
- 현실적 회귀: `start_failed` 알림 모양이 바뀌어 shell main이 시작 실패 이유를 못 보이는 것, 시작에 실패한 core가 child를 남기는 것.
- 왜 지금 test가 못 잡나: 시작 실패 경로를 process로 보는 test가 없다. `bootCore`는 hello가 안 오면 30초 뒤 실패하는 것이 전부다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- 위의 임시 확인 (a)(b)(c)와 기존 `boot_test.ts`·`secret_test.ts`가 통과한다. 임시 script는 commit하지 않는다.
- 위험 test: 없음(support. `boot-rows`가 쓴다)

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
