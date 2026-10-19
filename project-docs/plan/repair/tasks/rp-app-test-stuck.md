# rp-app-test-stuck

rework에서 받은 `app test` 요청이 시작하지 않은 원인을 찾아 고친다.

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/`
  - `packages/core/apps/releases/`
- 읽을 것:
  - `project-docs/plan/repair/README.md`의 "정한 것"(app test)
  - architecture: `project-docs/architecture/activation.md`(release 준비, app test, examples)
  - run 기록(main checkout, 읽기만): `/home/pyosechang/projects/lophn/.dev-data/eval/run_01m5ap0n66bjha1wp8bh1y4d3c/`. rework coding session `ses_01m5apj2q6…`이 `app test` 요청 t-1을 받았는데 `started_at`이 null, `as_of_seq`가 208에 머물렀다. 같은 commit(b707270)을 다시 준비한 것이 의심된다(확인 전). core log에 오류 줄은 없다. 그 run의 data root에 db가 남아 있으면 sqlite로 읽는다.

## 할 일

1. 기록과 코드로 원인을 찾는다: 요청이 들어온 뒤 runner가 집어 가는 길(대기열, 같은 bundle·commit의 중복 판정, idempotency key)에서 어디서 멈췄나.
2. 원인을 재현하는 unit을 먼저 쓰고(실패 확인), 고친다.
3. 원인을 못 찾으면 고치지 말고 찾은 사실과 남은 가설을 보고한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "같은 commit으로 다시 준비한 release의 app test 요청도 시작한다"(원인이 그것이면)

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴대로(바꾼 file, 통과한 check, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
