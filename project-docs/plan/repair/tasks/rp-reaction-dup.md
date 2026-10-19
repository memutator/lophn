# rp-reaction-dup

examples 실패로 열린 reaction이 같은 앱에 AE session을 하나 더 열어, 두 session이 같은 ticket을 서로 반대로 고친 것을 고친다.

- 단위: core (wave 1)
- 선행: rp-app-test-stuck. `packages/core/problems/tests/`를 그 task가 먼저 고친다.
- 소유(이 task만 고친다):
  - `packages/core/events/reactor/`
  - `packages/core/problems/tests/unproven.ts`
- 읽을 것:
  - `project-docs/plan/repair/README.md`의 "정한 것"(두 AE session)
  - architecture: `project-docs/architecture/event.md`(reaction), `project-docs/architecture/agent-call.md`(call과 받는 session), `project-docs/architecture/activation.md`(`rewind_unproven`)
  - 코드: `packages/core/events/reactor/session-opening.ts`(`ProblemOpened` → program call), `packages/core/problems/tests/unproven.ts`
  - run 기록(읽기만): `/home/pyosechang/projects/lophn/.dev-data/eval/run_01m5ap0n66bjha1wp8bh1y4d3c/`. 18:25 AE1이 ticket을 verify 실패로 둔 뒤 `rewind_unproven` reaction이 AE2를 열었고, 18:29에 둘이 같은 ticket의 examples를 반대로 고쳤다.

## 할 일

1. 기록과 코드로 흐름을 확인한다: 누가 언제 열렸고, AE1은 examples 결과를 이미 받고 있었나.
2. 가장 작은 고침을 고른다. 후보: examples run의 `rewind_unproven`처럼 그 ticket을 verify하는 session이 이미 결과를 받는 problem은 reaction이 새 session을 열지 않는다. 다른 후보가 더 작으면 그것으로.
3. 고침이 제품 동작을 고르는 것이면(예: 같은 agent의 열린 session으로 보낼지) 고치기 전에 lead에게 보고하고 기다린다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "examples 실패 하나로 같은 ticket을 맡는 AE session이 둘이 되지 않는다"

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴대로(바꾼 file, 통과한 check, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
