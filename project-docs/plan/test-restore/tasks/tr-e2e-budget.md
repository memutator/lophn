# tr-e2e-budget

wave 1이 모두 merge된 뒤 전체 `deno task e2e`가 9분을 넘을 때만 띄운다. 비싼 file을 묶거나 행을 harness로 내려 전체를 9분 안으로 만든다. 9분 안이면 lead가 띄우지 않고 status 기록에 잰 시간을 남긴다.

- 단위: e2e (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/`
  - `tests/support/`
  - `tests/harness/`
  - `packages/core/apps/runtime/supervisor/`의 `*_test.ts`(후보 D)
  - `packages/core/apps/releases/activation/`의 `*_test.ts`(후보 E)
- 읽을 것:
  - AGENTS.md, `.claude/skills/write-test/SKILL.md`("모양": 준비는 file당 한 번, 여러 경우는 표로)
  - architecture: `project-docs/architecture/testing.md`("층"의 시간 예산, "case 고르는 규칙" 3·4·5, "앱 길")
  - lead가 status 기록에 남긴 wave 1 뒤 전체 e2e 시간과 log, wave 1 전 log `.dev-data/plan-test-restore/e2e-run.log`(main checkout, git 밖)
  - 본보기: `tests/e2e/app-activation_test.ts`(core 하나·앱 하나에 행을 표 순서로 잇고 `reboot`으로 재시작을 넘는 꼴), `tests/e2e/coding_test.ts`(core 하나에 ROWS table)
- 계약:
  - 쓰는 것: `project-docs/architecture/testing.md`의 시간 예산과 case 고르는 규칙

## 할 일

판단 규칙(testing.md 규칙 3): core E2E에는 process 경계를 건너야만 깨지는 것만 둔다. 묶을 때는 같은 준비(core, 앱, patch)를 쓰는 행을 한 core·한 앱에 잇는다. 행이 지키던 경계 단정(disk, ledger·event, fake가 받은 요청)은 하나도 빼지 않고 옮긴다. 묶은 file의 머리 주석은 각 행의 세 질문을 그대로 남긴다.

1. 잰다. `deno task e2e:deps` 뒤 `deno task e2e > .dev-data/e2e-budget.log 2>&1`. file마다 시간을 더해 lead가 남긴 수와 견주고, 9분까지 줄일 몫을 정한다. 9분 안이면 2로 가지 않고 그 결과만 보고한다.
   - 뼈대의 예산 셈(wave 1 전 log 9분 19초 기준): `app-call`의 실패 둘이 30초씩 기다린 약 1분이 빠지고, `operator`·`app-data-rewind`가 끝까지 돌면 약 +20초, 새 flow 셋이 약 +25초다. 예상은 약 8분 50초다. 이보다 크게 넘으면 어느 file이 늘었는지 먼저 본다.
2. 후보를 D(아래 3) → A → B → C → E 순서로 하나씩 적용하고, 하나마다 그 file을 10번 돌린다. 9분 안(여유 15초)이 되면 멈춘다. 시간은 wave 1 전 log 기준 예상이다.
   - A. `tests/e2e/app-restart_test.ts`(22초, test 둘이 `withSlowApp`으로 core와 `slowPatch` 앱을 따로 띄운다): `Deno.test` 하나·core 하나·앱 하나로 묶는다. "앱 process만 죽는" 행을 먼저, "core가 죽었다 켜지는" 행을 뒤에 두고, 재시작은 `app-activation_test.ts`의 `reboot`처럼 같은 run에 `bootCore(run, { env })` 뒤 Gateway를 다시 붙인다. 각 행의 단정(호출이 unknown으로 닫힘, 다시 가지 않음, 앱 process 하나)은 그대로. 예상 −9초.
   - B. `tests/e2e/app-release_test.ts`(33초): 둘째 test(examples)를 첫 test의 core로 옮긴다. "맞는 예시" 행은 첫 test의 `Notes` 전달에 `check: { kind: "examples", steps: [{ tool: "list_items", expect: { rows: [], coverage: "complete" } }] }`를 주고, `verifyTicket` 전에 `ticketShow`의 `check_result.result`가 `pass`가 되기를 기다린다(activation 요청은 verified 뒤에만 와서 첫 test의 단정이 그대로다). "틀린 예시" 행은 `Todos` 뒤에 셋째 앱으로 같은 core에서 돌리고(앞 앱의 Gateway를 닫는다) `tc_verify`의 `conflict` 단정을 그대로 둔다. `coding-mcp-preview-only` step(`tr-e2e-coding-mcp`)은 `Notes`가 live로 뜬 뒤라 건드리지 않는다. 예상 −10초(core 기동 하나, 앱 하나).
   - C. 앱이 없는 작은 file에서 test마다 core를 새로 띄우는 것을 file당 core 하나와 `t.step` 행으로 묶는다: `tests/e2e/stop_test.ts`(test 5, 각자 `bootCore`·`inProject`), `tests/e2e/file-write_test.ts`(test 3, `scope`가 test마다 core), `tests/e2e/approval_test.ts`(test 3). 행마다 project와 session을 새로 쓰고, 새 data root가 있어야 하는 행만 따로 둔다. 예상 −15초(core 기동 하나에 약 2~3초). data root 전체를 key로 훑는 `secret_test.ts`·`oauth_test.ts`는 행끼리 key가 섞이므로 묶지 않는다.
3. unit으로 내리는 후보. planner가 소유를 넓혔다(2026-10-20). D를 맨 먼저 한다: 가장 크고 동시 실행에서 멈춘 적이 있다. 내리는 unit은 그 module 옆에 둔다(write-test). 2와 3을 다 해도 9분을 넘으면 더 줄이지 말고 보고한다.
   - D. `tests/e2e/reaction_test.ts`의 `crash-loop-halts`(31초): 실제 backoff 1+2+4+8+16초를 기다린다(`packages/core/apps/runtime/supervisor/restart-policy.ts`의 `backoffMs`, `CRASH_LIMIT`). supervisor는 `clock`과 `wait`를 주입받으므로(`SupervisorDeps.wait`: "테스트가 시간을 건너뛰게 한다") "한도를 넘으면 자동 재시작을 멈추고 `crash_loop`를 한 번 알린다"를 `packages/core/apps/runtime/supervisor/` 옆 unit으로 내리고 e2e에는 `crash-opens-problem`(앱 process → problem → Project Manager)을 남긴다. 잃는 것: supervisor의 `crash_loop` 보고 → core의 `AppRestartHalted`와 runtime `unavailable/crash_loop`가 process를 건너는 단정. 이 단계는 동시 실행에서 한 번 멈춘 적도 있다(`.claude/skills/orchestrate/SKILL.md` 131줄). 예상 −31초.
   - E. `tests/e2e/app-activation_test.ts`의 `supersedes-pending`(release 둘, 약 12초): 더 새 release가 시작하면 앞 보류 activation request가 취소되는 판정을 `packages/core/apps/releases/activation/` 옆 unit으로 내린다. 예상 −12초.
4. 바꾼 file마다 10번 연속 통과를 본 뒤, 마지막에 전체 `deno task e2e`를 한 번 더 돌려 시간을 잰다.

## 끝남

- `deno task check:full`이 통과한다.
- `deno task e2e:deps` 뒤 전체 `deno task e2e`가 통과하고 9분 안이다(출력 끝 줄의 시간).
- 바꾼 e2e file마다 `deno test --allow-all --no-check tests/e2e/<file>`이 10번 연속 통과한다. 끝난 뒤 `/tmp/lophn-e2e-*`와 core process(`pgrep -f packages/core/main/daemon/main.ts`)가 남지 않는다.
- 위험 test: 없음(새 위험이 없다. 묶은 행의 단정은 그대로 옮긴다).

## 보고

- 바꾼 file
- 통과한 check, 전과 뒤의 전체 시간과 file별 시간, 10번 돌린 결과
- 등록할 것: `project-docs/architecture/testing.md`의 e2e file 목록과 묶은 행(lead가 계획 끝에 고친다)
- 안 쓰게 된 export(`tests/support`에서 쓰는 곳이 없어진 helper. 남이 쓰던 것은 지우지 않는다)
- 정한 것: 적용한 후보와 멈춘 자리, 묶으면서 행 순서를 정한 이유
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 후보를 다 해도 남는 몫과 예상 시간
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
