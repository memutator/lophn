# tr-e2e-app-fix

앱 data rewind와 앱 재시작 e2e를 새 app helper로 고친다. `reaction_test.ts`를 지우면서 그 안의 "앱이 계속 죽으면 `appRuntime`이 `unavailable/crash_loop`이고 Gateway가 `AppRestartHalted` 하나를 받는다"를 `app-restart_test.ts`의 단계로 옮긴다.

- 단위: e2e (wave 2)
- 선행: tr-support-app.
- 소유(이 task만 고친다):
  - `tests/e2e/app-data-rewind_test.ts`
  - `tests/e2e/app-restart_test.ts`
  - `tests/e2e/reaction_test.ts` (지운다)
  - `tests/support/app/patch-rewind.ts`
  - `tests/support/app/patch-restart.ts`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것"(지우는 e2e의 `reaction_test.ts`와 옮길 crash loop 사실, 앱 helper 하나). `project-docs/plan/test-restore/survey-e2e.md` §1의 5(app-data-rewind), 7(app-restart), 22(reaction) 줄
  - tr-support-app의 brief "내놓는 것"(`activateTestApp`, `TestApp`에 `gateway`가 없다, `sampleDomain`, `deps.ts`의 새 자리)
  - architecture: `project-docs/architecture/testing.md`("앱 길": agent가 앱 tool을 부르는 행은 앱 place의 Operator로, "case 고르는 규칙" 4·7), `project-docs/architecture/app-call.md`(app-runtime·app-data의 재시작과 rewind), `project-docs/architecture/approval.md` 25·35행(할당한 앱의 tool만 tool 목록에 뜬다. 할당 쓰기는 사람만)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `app-data`, `storage`, `child-supervision-protocol`, `event-stream`; `project-docs/module-catalog.yaml`의 `tests`
  - 코드(HEAD `85f19080e`)
    - `tests/e2e/app-data-rewind_test.ts`(머리 주석 10-11, `agentGrantsSet` import 21, `appCoreEnv` import 30, `let app` 109와 `app = live` 118, grant 줄 225-228, finally의 `app?.gateway.close()` 286)
    - `tests/e2e/app-restart_test.ts`(머리 주석 9, `appCoreEnv` import 22, `appPids` 43-53, `withSlowApp` 145-186과 그 finally의 `app?.gateway.close()` 181)
    - 옮길 단계: `tests/e2e/reaction_test.ts` 283-297(세 질문 주석), 299-310(`crash`), 313-322(`restarted`), 379-424(`crash-loop-halts`)
    - `packages/protocol/approvals/assignment.ts`(`agentAssignmentSet`: 입력 `{agent, entries: [{app, removed_tools}]}`, compare `{revision}`. 줄이 없는 agent는 revision 0)
    - `packages/protocol/events/transient.ts` 57-63(`AppRestartHalted`: subject 앱, payload `{release, crashes}`)
    - `packages/core/apps/runtime/supervisor/restart-policy.ts`(`CRASH_LIMIT` 5, 창 10분, backoff 1·2·4·8·16초. 순수 규칙이라 test가 import해도 된다), `packages/core/apps/runtime/commands.ts` 250-260(crash loop로 멈추면 `crashes: CRASH_LIMIT + 1`로 한 번 낸다)
    - `tests/support/gateway/mod.ts`(`connectGateway(core, { conditions })`, `next`, `frames`)
    - `tests/support/app/patch-rewind.ts` 1-3·20-21, `tests/support/app/patch-restart.ts` 1-3·16-17(slug를 폴더 이름에서 읽는 줄과 낡은 "platform app test"·mode `"test"` 주석)
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`activateTestApp`, `TestApp`, `waitRunning`), `deps.ts`(`appCoreEnv`), `patch-crash.ts`(`crashPatch`); `packages/protocol/approvals/assignment.ts`의 `agentAssignmentSet`(grant 대신); `packages/protocol/events/transient.ts`의 `AppRestartHalted`; `tests/support/gateway/mod.ts`(`connectGateway`)
    - tr-support-app의 `tests/support/app/source.ts`의 `sampleDomain(dir)`(견본 blueprint의 domain = 앱 slug)
  - 내놓는 것: 없음

## 할 일

근거: README "정한 것"(지우는 e2e, crash loop 사실을 `app-restart_test.ts`로), survey §1의 5·7·22 줄. 재는 것(data rewind의 한 transaction과 충돌 취소, 재시작 뒤 unknown write를 다시 보내지 않음과 process 하나)은 바꾸지 않는다. 앱은 tr-support-app의 helper로 올린다.

1. `tests/support/app/patch-rewind.ts`, `tests/support/app/patch-restart.ts`
   - `const slug = dir.split("/").at(-1);`을 `const slug = await sampleDomain(dir);`(`./source.ts`)로 바꾼다. 이유: source 폴더가 `<home>/apps/<app id>/source`라 마지막 조각은 `source`이고, 그 domain은 그 앱의 domain이 아니라 `release.record`가 거절한다(tr-support-app "정한 것" 3).
   - 주석을 지금 설계로 고친다: "platform app test(…)를 통과한다"는 "release 준비의 handler 검사(blueprint 선언과 등록 handler가 같다)를 통과한다"로. `patch-restart.ts` 2-3의 "platform app test(mode "test")의 rewind 검사는 … test에서는 기다리지 않는다"는 "live에서만 기다린다. preview에서 부르면 바로 답한다"로(handler의 `currentContext()?.mode === "live"` 조건은 그대로 둔다). `patch-rewind.ts` 2-3의 "되돌림"(옛 test runner의 rewind 증명)을 뺀다.
2. `tests/e2e/app-data-rewind_test.ts`
   - import: `agentGrantsSet` 대신 `agentAssignmentSet`(`packages/protocol/approvals/mod.ts`), `appCoreEnv`는 `../support/app/deps.ts`.
   - 225-228의 grant 줄을 할당으로 바꾼다. Operator session을 열기 전(tool 목록은 session 시작 때 고정된다)에 한 번:
     `await core.call(agentAssignmentSet, { agent: operator, entries: [{ app: live.app, removed_tools: [] }] }, { revision: 0 })`.
   - `TestApp`에 `gateway`가 없다. `let app`과 `app = live`, finally의 `await app?.gateway.close()`를 지운다.
   - 머리 주석 10-11: "앱 activation(`activateTestApp`)의 App Engineer 대답(`release_prepare`·`release_activate`)뿐이라 행의 상한(3)에 세지 않는다(`architecture/testing.md` "case 고르는 규칙" 4)". "README 정한 것 11"을 남기지 않는다.
   - test 이름, 행, 단정은 그대로다.
3. `tests/e2e/app-restart_test.ts`
   1. `appCoreEnv` import를 `../support/app/deps.ts`로, `withSlowApp` finally의 `app?.gateway.close()`를 지운다. 머리 주석 9를 2와 같은 꼴로 고친다(옛 글은 "Project Manager 대답", "README 정한 것 11").
   2. crash loop를 새 `Deno.test` 하나로 더한다. 이름: "E2E 앱 process가 거듭 죽으면 자동 재시작이 멈추고 Gateway가 AppRestartHalted 하나를 받는다".
      - 정한 것: 있는 두 행에 단계로 붙이지 않고 자기 core·앱을 띄우는 `Deno.test`로 둔다. 이유: crash loop는 10분 창 안의 예상 밖 종료를 센다(`restart-policy.ts`). 둘째 행의 SIGKILL이 같은 창에 들어가 멈추는 횟수가 행 순서에 묶인다. 준비는 `withSlowApp`과 같은 꼴(createRun, startFakeServer, `bootCore(run, { env: await appCoreEnv() })`, `connectFakeProvider`)이고 앱은 `activateTestApp(core, fake, { name: "Crasher", slug: "crasher", patch: crashPatch })`다.
      - 머리 주석에 세 질문 한 줄씩(`architecture/testing.md` "case 고르는 규칙" 1): contract `app-runtime`(10분 창 안의 예상 밖 종료가 `CRASH_LIMIT`을 넘으면 자동 재시작을 멈추고 `AppRestartHalted`를 한 번 낸다) / 회귀: 횟수가 어긋나 영영 되살리거나 너무 일찍 멈추는 것, 멈췄는데 알리지 않는 것 / 왜 지금 test로 못 잡나: 규칙은 순수 unit이 있지만 실제 process 종료 → supervisor → command → Bus → Gateway는 process를 건너야 이어서 보인다. reaction_test 283-297에서 problem·reaction·Project Manager 말은 뺀다.
      - 단계(fake 대답 없음. 앱 activation helper의 것뿐):
        1. `gateway = await connectGateway(core, { conditions: [{ types: ["AppRestartHalted"] }] })`.
        2. 시작 nonce는 `(await waitRunning(core, app)).process_nonce`. bundle 경로는 `withSlowApp` 159-163과 같이 읽는다.
        3. `for (let exit = 1; exit <= CRASH_LIMIT + 1; exit++)`: `crash`(reaction_test 299-310을 옮긴다: `appCallTool` `crash`, outcome은 `succeeded`나 `unknown`), `exit <= CRASH_LIMIT`이면 `restarted`(313-322를 옮긴다: 새 nonce가 running·ready·accepting, 제한 60초).
           - `CRASH_LIMIT`은 `packages/core/apps/runtime/supervisor/restart-policy.ts`에서 import한다. 정한 것: 옛 test의 상수 6을 박지 않는다. 이유: 규칙이 바뀌면 test가 따라간다.
        4. `halted = await gateway.next("event", (frame) => frame.event.type === "AppRestartHalted")`.
      - 단정(셋, 서로 다른 곳):
        - event: `halted.event`의 `subject`가 앱이고 `payload.crashes`가 `CRASH_LIMIT + 1`이다. route 단정 뒤에 `gateway.frames()`의 `AppRestartHalted`가 하나뿐이다.
        - route: `core.call(appRuntime, { app })`의 `state.state`가 `unavailable`이고 `state.reason?.code`가 `crash_loop`이다.
        - process: `appPids(bundle)`가 빈 목록이다(다시 띄우지 않았다).
      - finally에서 gateway, core, fake, run을 닫는다(`withSlowApp`의 순서).
4. `tests/e2e/reaction_test.ts`를 지운다(`git rm`). 근거: README "정한 것"(reaction, problem, `problem.body`가 없다). 옮긴 것은 3-2의 crash loop뿐이다.
5. 돌려 본다: `deno task e2e:deps` 한 번 뒤 `deno test --allow-all --no-check tests/e2e/app-data-rewind_test.ts`와 `deno test --allow-all --no-check tests/e2e/app-restart_test.ts`. 새 crash loop case는 `--filter "거듭 죽으면"`으로 세 번 연속 돌린다(10번은 lead가 merge 전에 돈다, `architecture/testing.md` "case 고르는 규칙" 7). 처음 돌 때 `app.create` 뒤 runtime 재시작(README "지켜볼 것" 첫 줄)이 흔들리면 helper(tr-support-app)의 `settle`이 덮는지 보고, 안 덮으면 test를 맞추지 말고 보고한다.

## 끝남

- `deno task check`가 통과한다(이 file들은 `NOT_CHECKED`와 `tests/e2e` 안이라 type check에 들지 않는다).
- `deno check tests/e2e/app-data-rewind_test.ts tests/e2e/app-restart_test.ts tests/support/app/patch-rewind.ts tests/support/app/patch-restart.ts`가 오류 없이 끝나고, 같은 file에 `deno fmt --check`와 `deno lint`가 통과한다.
- `deno task e2e:deps` 뒤 `deno test --allow-all --no-check tests/e2e/app-data-rewind_test.ts`와 `deno test --allow-all --no-check tests/e2e/app-restart_test.ts`가 통과한다. crash loop case가 세 번 연속 통과한다.
- 위험 test:
  - "여러 write의 앱 data rewind는 한 번에 되돌아가고, 충돌하면 아무것도 바꾸지 않고, 다른 write를 지우지 않는다"(`tests/e2e/app-data-rewind_test.ts`, 있는 test. 사용자 data를 잃는 규칙)
  - "앱 write 도중 core나 앱 process가 죽으면 그 호출은 unknown으로 닫혀 다시 가지 않고 앱 process는 하나만 뜬다"(`tests/e2e/app-restart_test.ts`의 있는 두 test)
  - "앱 process가 거듭 죽으면 자동 재시작이 멈추고 Gateway가 AppRestartHalted 하나를 받는다"(`tests/e2e/app-restart_test.ts`. reaction_test에서 옮긴다. program의 결정적 판정)
- 남지 않음:
  - `ls tests/e2e/reaction_test.ts`가 없음이다.
  - `grep -nE "agentGrantsSet|support/coding|gateway\.close\(\)\.catch|app\?\.gateway|README 정한 것|Project Manager" tests/e2e/app-data-rewind_test.ts tests/e2e/app-restart_test.ts`가 0줄이다.
  - `grep -nE 'split\("/"\)|platform app test|mode "test"' tests/support/app/patch-rewind.ts tests/support/app/patch-restart.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(위 `deno check`·fmt·lint, `deno task check`, e2e 두 file과 crash loop 세 번)
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(crash loop를 따로 `Deno.test`로 둔 것, `CRASH_LIMIT` import 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 잰 것: 세 test 각각 걸린 시간(e2e 전체 10분 예산, `architecture/testing.md` "층")
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
