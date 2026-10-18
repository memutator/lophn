# ev-driver

시나리오의 trial 하나를 처음부터 끝까지 돌린다: 새 root에 core를 띄우고, provider를 연결하고, 재료를 되살리고, setup을 하고, session에 model을 붙여 사람 말을 보내고, 질문·허락을 정해진 규칙으로 처리하며 기다리고, 돈 상한을 지키고, record를 모으고, 모두 정리한다.

- 단위: ev (wave 3)
- 선행: ev-collect, ev-restore, ev-provider
- 소유(이 task만 고친다):
  - `tests/eval/drive.ts`
  - `tests/eval/env-hash.ts`
- 읽을 것:
  - 계획: `project-docs/plan/eval-base/README.md`(정한 것 3·4·6·7, 사람이 정할 것 2), `project-docs/products/roadmap/eval.md`의 "지켜야 할 것", "시나리오 꼴"(`real`이 아닌 agent는 model이 없어 `model_required`로 turn이 시작하지 않는다), "비용과 시간 어림"
  - 조사: `project-docs/plan/eval-base/research/infra.md` 2절(`bootCore`, `createRun`, `settings` 옵션), 3절(model 선택 층, `lophn-agent.run.model_attempts` 기본 30), 5절(읽을 수 있는 것), "What an eval runner needs" 4·6
  - 본보기: `tests/support/core/{mod,human,process}.ts`, `tests/e2e/approval_test.ts`(질문·허락이 오는 turn), `tests/live/budget.ts`(상한을 세는 모양)
  - 코드: `packages/core/lophn-agent/run-loop/limits.ts`(설정 key 이름), `packages/protocol/events/mod.ts`의 `sessionSnapshotsList`
  - 계약: `tests/eval/types.ts`, `tests/eval/collect.ts`(`collectSession`, `readNames`, `sumMetrics`), `tests/eval/material/restore.ts`(`restoreWorld`), `tests/eval/steps.ts`(`refOf`)
- 계약:
  - 쓰는 것: 위 module들, `tests/support/core`(`createRun`, `bootCore`, `connectFakeProvider`, `connectRealProvider`, `changeModel`, `openSession`, `say`, `stopTurn`, `decide`, `until`), `tests/support/fake-server`, `packages/base`의 `Clock`·`sha256Hex`
  - 내놓는 것:
    - `runTrial(opts: TrialOptions): Promise<RunRecord>`
      ```ts
      type TrialOptions = {
        scenario: Scenario; trial: number; clock: Clock; lophn_commit: string;
        mode: { kind: "fake" } | { kind: "real"; definition: "anthropic" | "openai"; key: string; model_name: string; option_values?: Record<string, string> };
        spend: { left(): number; add(amount: number): void };   // USD. left()가 0 이하가 되면 멈춘다
        materials_root?: string;
        limits?: { model_attempts?: number; turn_ms?: number };  // 기본 12, 240_000
        fake_script?: Step[];   // fake 모드에서만. 기본은 대본 없음(fallback text). 이 task의 확인용이고 run.ts는 쓰지 않는다
      };
      ```
    - `environmentHashes(home: string): Promise<{ sdk_hash: string; template_hash: string }>`: `<home>/sdk`와 `<home>/templates/app`의 파일을 byte 순으로 정렬해 `sha256Hex(bundleBytes(files))`로 잰다(`bundleBytes`는 `packages/core/apps/packages/install.ts`).

## 할 일

1. `drive.ts`의 `runTrial`을 쓴다. 순서:
   1. `createRun()`, `startFakeServer()`(fake 모드는 아래 4번의 fallback 옵션), `bootCore(run, { settings: { "lophn-agent.model.catalog_auto_update": false, "lophn-agent.run.model_attempts": limits.model_attempts } })`. 사람의 `~/.lophn`과 `.env`는 읽지 않는다. key는 `opts.mode`로만 받는다.
   2. `connectFakeProvider(core, fake, { default: false })`로 되살리기용 provider(`restoreModel`). 진짜 model용은 `fake` 모드면 `connectRealProvider(core, { definition: "anthropic", key: "fake-key", model_name: "claude-sonnet-4-5", endpoint: fake.url })`, `real` 모드면 key로 진짜 endpoint에 연결한다. 어느 쪽도 전역 기본 model을 정하지 않는다(`ev-provider`).
   3. `restoreWorld`로 `scenario.world`를 되살린다. `scenario.setup`을 차례로 부른다. 둘 다 fake 대본만 쓰고 진짜 model을 쓰지 않는다.
   4. `scenario.steps`의 `say`마다: 그 target이 `scenario.real`에 있으면 `openSession(core, refOf(...))` 뒤 `changeModel`로 진짜 model(fake 모드는 두 번째 fake provider)을 붙인다. `real`에 없으면 던진다. `fake` 모드의 fake server는 `startFakeServer({ fallback: { kind: "text", text: "ok" } })`로 띄워 대본이 없는 모든 요청에 text 한 줄로 답한다(case별 대본은 없다). 되살리기·setup의 대본(PM, `seedTicket`)이 queue에서 먼저 쓰이고 queue가 비면 fallback이다. 보내기 직전 `fake.reset()`을 한 번 한다. `say`로 보낸다.
   5. 기다림(아래 규칙)을 돈다. turn이 끝나면 다음 step으로 간다.
   6. `collectSession`을 real target마다 불러 `RunRecord`를 만든다: `names = readNames`, `env = { lophn_commit, ...environmentHashes(run.home) }`, `world`는 `restoreWorld`가 준 것, `metrics = sumMetrics(...)`, `ended_by`는 아래.
   7. 정리(`finally`): `core.stop()`, `fake.close()`, `run.remove()`. 중간에 던지면 `core.logPath`의 끝 40줄을 오류 메시지에 담고 다시 던진다. 정리까지 끝난 뒤 `/tmp/lophn-e2e-*`가 남지 않아야 한다.
2. 기다림 규칙. turn이 끝날 때까지 250 ms 간격으로 읽는다(`until`의 `timeoutMs`를 `limits.turn_ms`로).
   - 허락 요청이 와 있으면 `decide(..., "reject")`한다(Gate가 사람에게 묻는 call은 거절로 처리해 world를 바꾸지 않는다. 기록은 ledger의 tool call `decision: ask`로 남는다). 요청은 `sessionSnapshotsList({sessions:[session]})`의 `permission_requests`다.
   - 질문이 와 있으면(`questions`) 답하지 않고 그 turn을 `stopTurn`한다. `ended_by = "stopped_on_question"`. 질문은 ledger의 `ask` tool call 입력으로 남는다. "사람이 질문에 답해 주는" 시나리오는 이 계획에 없다.
   - 돈 상한: 읽을 때마다 `modelCallList({session})`의 `cost`(`reported`·`estimated`)를 합해 이 trial의 쓴 돈과 `spend.left()`를 견준다. 넘으면 `stopTurn`하고 `ended_by = "spend_cap"`. 끝난 trial의 합계를 `spend.add`로 더한다. cost가 `unknown`인 호출은 0으로 세되 한 번 경고를 찍는다.
   - 제한 시간이 지나면 `stopTurn`하고 `ended_by = "timeout"`. 그 밖에는 `completed`(turn이 스스로 끝남. 실패한 turn도 포함. 이유는 turn outcome에 있다).
   - 받는 쪽 session(call로 열린 App Engineer·PM)은 model이 없어 turn이 시작하지 않는다. 기다리지 않는다.
3. `env-hash.ts`: `environmentHashes`.
4. 확인(진짜 provider 없이). scratch(`.dev-data/ev-driver/check.ts`, commit하지 않는다)에서 시나리오를 손으로 만든다(world `[]`, real `lophn`, say 한 줄, `fake_script`는 `call`을 project PM에게 → text). world가 필요하면 `ev-restore`의 확인처럼 임시 재료를 쓴다. `runTrial`을 `fake` 모드로 돌려: ① `RunRecord.sessions[0].calls[0].record.to`가 맞다 ② fake가 `ask`를 부르는 시나리오는 `stopped_on_question`으로 끝난다 ③ lophn → PM grant를 `ask`로 한 시나리오는 Gate가 묻는 call을 거절하고 turn이 이어 끝난다(`tests/e2e/call-gate_test.ts`의 `callAndDecide`) ④ `spend.left()`가 0이면 `spend_cap`으로 끝난다(`left`를 0으로 주고 본다. fake의 cost가 `unknown`이면 이 확인은 `left()`가 처음부터 0 이하인 경우를 시작 전에 막는지로 대신한다) ⑤ 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 없다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 새 file은 `tests/eval`이라 check의 test discovery 밖이다. 사람의 root를 건드리지 않는 것은 `createRun`만 쓰는 구조로 지키고 확인 4⑤가 본다.
- 남지 않음: scratch를 commit하지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: 기다림 간격, 기본 한도, 중간 오류의 모양
- 계약 바꾸기 요청: `TrialOptions`나 `types.ts`를 바꿔야 하면 여기 적는다
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: cost가 `unknown`이면 상한이 못 막는다는 것, 질문에 답하는 시나리오가 없다는 것
