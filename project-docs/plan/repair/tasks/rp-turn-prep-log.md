# rp-turn-prep-log

turn 준비가 예외로 끝나면 diagnostic log에 분류 한 줄을 남긴다.

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/main/agent-runtime/`
- 읽을 것:
  - 이슈: `project-docs/issues/agent-definition.md`의 "turn 준비가 예외로 끝나면 아무 기록 없이 매 주기 다시 시도한다"(추천: 첫째)
  - 코드: `packages/core/main/agent-runtime/product-driver.ts`의 `startTurnPump`(예외를 삼키는 곳), `packages/core/diagnostics`(처리 못한 예외를 남기는 길)

## 할 일

1. `startTurnPump`가 `driver.startNext()`의 예외를 삼키는 곳에서 diagnostic log에 분류 한 줄(어느 단계, 오류 이름과 message)을 남긴다. 같은 예외가 매 주기 되풀이되면 줄도 되풀이되니, 같은 오류가 이어지면 처음 한 번만 남긴다.
2. 실패한 turn으로 닫는 둘째 안은 하지 않는다(이슈의 추천).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴대로(바꾼 file, 통과한 check, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
