# approval-rows

`tests/e2e/approval_test.ts`에 행을 더한다: `ask` tool 왕복(사람이 답하면 다음 model 요청에 답이 실리고, 기다리는 중 사람이 말하면 질문이 닫히고 그 말이 결과가 된다), 그리고 "한 번 허락"은 한 번만 쓰이고 같은 쓰기를 다시 하면 다시 묻는다.

- 단위: approval-rows (wave 2)
- 선행: boot-damaged. `waitQuestion`을 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/approval_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/tools/questions/`
  - `packages/core/approvals/turn-requests.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 4절 `allow-once-consumed`; `candidates-invariants.md` 후보 9(`ask-roundtrip`); `candidates-bugs.md` 후보 `ask-roundtrip`; `candidates-product.md` 후보 `ask-answer`
  - architecture: `project-docs/architecture/agent-definition.md`("사람에게 묻는 중 사람이 그 session에 메시지를 보내면 기다림을 끝내고 그 메시지를 tool 결과로 넘긴다"), `project-docs/architecture/place-session.md`(대기 질문은 재시작에 cancelled)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `agent-sessions`, `approvals`
  - 코드: `packages/protocol/lophn-agent/ask-tool.ts`(`askInputSchema`, `askRead`, `askAnswer`: 모두 `{session, tool_call}`로 찾고 메모리 route, 결과 outcome `submitted`·`cancelled`·`human_message`), `packages/core/lophn-agent/tools/questions/{mod,wait}.ts`, `packages/protocol/events/snapshot.ts`(`questions[] {group, turn, tool_call}`)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`)(`boot-damaged`가 더하는 `waitQuestion`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `askRead`·`askAnswer`·`toolCallList`·`turnRead`·`sendMessage`(`packages/protocol/lophn-agent/mod.ts`), `sessionSnapshotsList`.
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `tests/e2e/approval_test.ts`가 main에 있어야 한다(계획 `testing`의 `e2e-approval`가 land한 뒤). 없으면 시작하지 말고 보고한다. 이 brief의 "지금 모양"은 branch `e2e/e2e-approval`에서 본 것이므로 main의 file을 먼저 읽고 어긋나면 main을 따른다. 지금 file은 `LOPHN.md` 쓰기를 허락/거절하는 table이다. 이 task는 별도 `Deno.test` 하나로 `ask` 행 둘을 더한다(같은 file 위쪽 helper `exists`·`toolResultOf`는 재사용한다. 준비는 다시 쓰지 않는다).
2. `ask`는 project가 필요 없다. `openSession(core, { role: "lophn" })`로 연다.
3. 행 표. 두 행이 core 하나를 공유한다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `ask-answered` | `say` → `waitQuestion` → `askRead`(질문 내용 확인) → `askAnswer {answers: [{question, status: "answered", answer: ["A"]}]}` → `waitTurnEnd` | ① tool `ask {questions: [{question: "Which?", header: "Pick", options: [{label: "A", description: "first"}, {label: "B", description: "second"}], multiSelect: false}]}` ② text | fake: 둘째 요청의 `tool_result`를 JSON으로 읽어 `outcome`이 `submitted`이고 `answers`에 `A`가 있다 / ledger: turn이 `completed`이고 `toolCallList`의 `ask` call이 `success`이며 snapshot의 `questions`가 비었다 / route: 이제 `askRead`가 `not_found`(메모리 묶음이 풀렸다) | 후보 9. 사람이 agent에게 결정을 주는 유일한 길 |
| `ask-human-message` | `say` → `waitQuestion` → `say`(같은 session에 사람 메시지) → `waitTurnEnd` | ① 같은 `ask` ② text | fake: 둘째 요청의 `tool_result`의 `outcome`이 `human_message`이고 `message`에 보낸 글이 있다 / ledger: `ask` call이 `success`이고 snapshot의 `questions`가 비었다 / route: `askRead`가 `not_found` | 후보 9, `agent-definition.md` |

4. 두 번째 `say`가 새 turn을 여는지 tool 결과가 되는지는 문서가 "기다림을 끝내고 그 메시지를 tool 결과로 넘긴다"이다. 어긋나면(둘 다 되거나 새 turn이 열리면) 제품 bug다.
   셋째 행 `allow-once-consumed`(`candidates-docs.md` 4절, approval.md 176행). 별도 `Deno.test`, 준비는 이 file 위쪽 `writeAndDecide`처럼 project 폴더와 PM session을 쓴다:

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `allow-once-consumed` | `openSession(PM)` → `say` → `waitPermission`(request #1) → `decide(allow)` → 곧바로 `waitPermission`(request #2, #1과 다른 id) → `decide(allow)` → `waitTurnEnd` | ① tool `file_write LOPHN.md` 두 번(call id `t1`, `t2`, 내용 `rules-1`, `rules-2`)을 한 reply로 ② text | route: 두 request의 id가 다르다(첫 허락이 둘째 쓰기에 쓰이지 않았다) / disk: 최종 `LOPHN.md`가 `rules-2`다 / fake: 둘째 요청에 `t1`, `t2`의 tool_result가 모두 있다 | `allow-once-consumed`. 허락은 그 intent에 한 번만(approval.md). 같은 쓰기를 다시 하면 다시 묻는다 |

5. `kill` 뒤 `cancelled`(후보 9의 셋째 행)는 `restart-rows`의 몫이 아니고 README 목록에도 없다. 넣지 않는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-tools`(`ask`는 turn을 세우고 사람의 답이나 메시지가 tool 결과로 돌아간다), `agent-sessions`(질문은 core 메모리이고 snapshot이 목록을 낸다).
- 현실적 회귀: 답이 model 요청에 실리지 않아 turn이 영영 멈추는 것, 기다림이 끝나지 않는 것, 사람이 말하면 질문이 안 닫혀 snapshot에 낡은 질문이 남는 것.
- 왜 지금 test가 못 잡나: `ask`의 대기는 runtime child의 긴 호출(`ask/wait`)과 core 메모리, 사람 route가 이어져야 보인다. harness는 `QuestionResolved` 처리를 본다 해도 왕복은 process다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/approval_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/approval_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "agent의 질문에 사람이 답하거나 말하면 turn이 이어 가고 질문이 닫힌다"

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
