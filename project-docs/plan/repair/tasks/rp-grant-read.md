# rp-grant-read

grant read가 lophn-agent의 `sessions` 표를 SQL로 읽지 않고 lophn-agent가 낸 read를 쓰게 한다.

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/approvals/grants/`
  - `packages/core/lophn-agent/session/actor-ref.ts` (새 file)
  - `packages/core/main/daemon/wiring/approvals.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/approval.md`의 "grant read가 `sessions` 표를 SQL로 직접 읽는다"(추천: lophn-agent가 actor→ref read를 내고 approvals가 부른다)
  - architecture: `project-docs/architecture/approval.md`, `project-docs/architecture/layers.md`(module이 남의 표를 SQL로 읽지 않는다)
  - 코드: `packages/core/approvals/grants/reads.ts`의 `agentGrantsGetRead`, `reads_test.ts`

## 할 일

1. lophn-agent에 session id → agent ref를 푸는 함수(또는 port 구현)를 둔다(`actor-ref.ts`).
2. approvals는 port로 받고, wiring(`approvals.ts`)이 끼운다. approvals가 lophn-agent를 import하지 않는다.
3. `reads_test.ts`의 SQL 흉내를 port 가짜로 바꾼다.

## 끝남

- `deno task check`가 통과한다(`check-deps` 포함).
- 남지 않음: `grep -rn "from sessions" packages/core/approvals`가 0줄이다.
- 위험 test: "grant read는 actor의 ref를 port로 풀고, 풀지 못하면 forbidden이다"(권한 경계)

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴대로(바꾼 file, 통과한 check, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
