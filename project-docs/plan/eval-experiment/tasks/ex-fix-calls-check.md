# ex-fix-calls-check

calendar-mvp·calendar-maintain의 program check `ae-calls-coding-only`(`tests/eval/checks/app/calls.ts` `aeCallsOnlyToCodingAgent`)가 맞는 call을 틀린 것으로 센다. calendar-mvp의 첫 run(`tests/eval/runs/run_01m57x8v9rfbxjq7nrrtj7f7ej.json`)에서 이 check가 "3개 중 2개"로 떨어졌다.
- 첫째는 App Engineer가 `to:{role:"coding_agent", place:{app}}, reply:"none"`으로 보내 `unavailable`로 실패한 call이다.
- 둘째는 이어 열린 coding session에 `to:{session:"ses_…"}, reply:"conversation"`으로 보낸 맞는 답이다.

check는 `to.role === "coding_agent"`만 맞다고 본다.

- 단위: ex-fix-calls-check (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/checks/app/calls.ts`(`aeCallsOnlyToCodingAgent`만)
  - `tests/eval/checks/app/calls_test.ts`(새 file)
- 읽을 것:
  - `tests/eval/types.ts`의 `SentCall`(`to`, `reply`, `outcome`, `state`, `receiver_session`), `TrialRecord.coding`(`CodingRecord`의 `session`)
  - `tests/eval/checks/app/fixtures.ts`(fixture의 App Engineer call 꼴)
  - `tests/eval/scenarios/calendar/calendar-mvp.scenario.ts`, `calendar-maintain.scenario.ts`(이 check를 쓰는 곳과 wrong fixture의 `fails`)
  - `project-docs/architecture/agent-call.md`(받는 쪽 꼴: 새 session은 role+place, 열린 session은 session id)
- 계약: `ProgramCheck` 꼴과 check id는 그대로다. 시나리오 file은 고치지 않는다(고치면 시나리오 n을 올려야 한다).

## 할 일

1. 보낼 때 실패한 call은 세지 않는다. `outcome`이 success가 아니거나 `state`가 `failed`인 call이다. 받는 쪽에 닿지 않았으니 "다른 곳에 맡겼다"가 아니다. 재시도 비용은 tool 정확도 수치가 센다.
2. 받는 쪽이 coding agent이면 맞다. `to.role === "coding_agent"`이거나, `to.session`이 그 trial의 coding session(`trial.coding[].session`) 가운데 하나다. 답 방식은 지금처럼 `conversation`이어야 한다.
3. 남은 call이 하나도 없으면 지금처럼 떨어진다("App Engineer가 보낸 call이 없음").
4. reason 글은 지금 꼴을 따르되 센 수와 뺀 수를 같이 적는다.

## 끝남

- `deno task check`가 통과한다. calendar-mvp·calendar-maintain의 fixture 확인(right는 통과, wrong은 이 check에서 떨어짐)이 그대로다: `ANTHROPIC_API_KEY= deno run --allow-all tests/eval/run.ts --scenario calendar-mvp`와 `--scenario calendar-maintain`. 이것은 key가 비어 provider를 부르지 않는다.
- 위험 test 하나: `calls_test.ts`가 손으로 만든 `TrialRecord`로 위 run의 순서(실패한 role+place call, 이어 `to:{session}` conversation call)를 통과시키고, lophn이나 다른 App Engineer에게 보낸 call은 떨어뜨린다. core·process·network를 쓰지 않는다.

## 보고

- 바꾼 file, 통과한 check
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
