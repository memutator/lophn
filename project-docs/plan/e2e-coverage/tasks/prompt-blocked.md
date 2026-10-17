# prompt-blocked

project의 `LOPHN.md`를 못 읽으면 그 turn이 시작되지 않고 이유가 남으며 model 요청이 하나도 나가지 않는 것을 `tests/e2e/prompt-blocked_test.ts` 하나로 본다. 사람이 쓴 지침을 조용히 빼고 일하면 사람이 모른다.

- 단위: prompt-blocked (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/prompt-blocked_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/instructions/`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 7절 `instructions-unreadable-no-turn`
  - architecture: `project-docs/architecture/agent-definition.md`("사람이 쓴 지침은 조용히 빼지 않는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `agent-sessions`
  - 코드: `packages/core/lophn-agent/instructions/{files,turn}.ts`(`openFile`: 파일이 없으면 `null`, 있는데 읽지 못하거나 일반 파일이 아니면 `unavailable`. `readTurnInstructions`는 한 층이라도 `unavailable`이면 `blocked`), `packages/core/lophn-agent/run-loop/prepare.ts`(`closeUnstarted`: `blocked`면 turn 행을 `failed`/`configuration_unavailable`로 만들어 닫고, 이유는 turn 기준 blob의 `why: "instructions_blocked"`로 남긴다), `packages/protocol/lophn-agent/turn-reads.ts`(`turnBodyView`는 user가 읽는 `turn_basis`), `packages/protocol/lophn-agent/turn-values.ts`(`TurnRecord.outcome`)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.journal`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: 위 support와 `turnBodyView`(`packages/protocol/lophn-agent/mod.ts`). 새 helper를 만들지 않는다.
  - 내놓는 것: 없음(test file만)

## 층을 정한 이유

core E2E다. 지침 file은 core의 reader Worker가 읽고(`unavailable`), 그 결과로 turn을 시작하지 않는 판단은 runtime child의 `prepare`가 하고, turn 행은 core의 ledger에 닫힌다. 이 셋이 process를 건너 이어진다. `readTurnInstructions`만의 경우의 수는 `instructions/` 옆 unit으로 늘릴 수 있다(이 task에서 만들지 않는다).

## 할 일

1. 새 file이다. `Deno.test` 하나. 준비: `bootCore` → `connectFakeProvider` → project 폴더 `proj` → **`proj/LOPHN.md`를 file이 아니라 폴더로 만든다**(`Deno.mkdir`) → `openProject` → `openSession(PM)`. 폴더로 만드는 이유: 문서의 예(권한 000)는 root로 도는 환경에서 읽혀 버린다. 폴더는 `openFile`이 항상 `unavailable`로 본다. (권한 000으로 바꾸고 싶으면 `Deno.uid() === 0`일 때의 실패를 먼저 보고한다.)
2. 행 하나(표).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `instructions-unreadable-no-turn` | `say` → `waitTurnEnd`(0) → `turnBodyView {kind: "turn_basis", id: <turn>}` | 없음(`fake.script`를 부르지 않는다. 요청이 오면 빈 queue라 400이고 단정 3이 빨강이다) | ledger: 그 turn이 `finished`이고 `outcome`이 `{kind: "failed", reason: "configuration_unavailable"}`다 / route: `turnBodyView`의 `value.why`가 `"instructions_blocked"`다(문구인 `detail`은 단정하지 않는다) / fake: `journal()`이 비었다(model 요청 0) | `agent-definition.md` "한 층이라도 못 읽거나 상한을 넘으면 turn을 시작하지 않는다". `configuration_unavailable`은 model이 없을 때도 쓰는 reason이라 이유는 `why`로 가린다 |

3. 이유를 읽는 route가 안 열리면(`turnBodyView`가 `not_found`) 제품 결함 후보다. test를 고치지 말고 보고한다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `run-loop`(사람이 쓴 지침을 못 읽으면 turn을 시작하지 않고 이유를 남긴다), `agent-sessions`(시작하지 못한 turn도 닫힌 행으로 남는다).
- 현실적 회귀: 읽기 실패를 "지침 없음"으로 보고 지침 없이 일을 시작하는 수정(사람의 규칙이 조용히 빠진다), 시작하지 못한 turn이 running으로 남아 다음 `turns/start`가 `conflict`가 되는 것.
- 왜 지금 test로 못 잡나: `read_test`는 읽기 권한만 보고 `readTurnInstructions`와 `closeUnstarted`를 잇는 test가 없다. reader Worker(core)의 `unavailable`이 runtime child를 거쳐 ledger의 turn 행이 되는 길은 process를 건너야 보인다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/prompt-blocked_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/prompt-blocked_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "읽지 못한 지침은 조용히 빠지지 않는다: turn이 시작되지 않고 이유가 남으며 model 요청이 나가지 않는다"

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
