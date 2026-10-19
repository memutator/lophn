# rp-ae-read-shape

App Engineer 지침에 read tool 결과 모양을 적어 examples `expect`를 맞게 쓰게 한다.

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/app-engineer/prompt.md`
- 읽을 것:
  - `project-docs/plan/repair/README.md`의 "정한 것"(App Engineer 지침)
  - `packages/sdk/cap-tool/results.ts`(read 결과 `{rows, coverage, freshness, continuation}`), `packages/core/problems/tests/harness/examples.ts`(`expect`를 어떻게 맞추나: 부분 일치인지 전체 일치인지)
  - `project-docs/architecture/activation.md`(examples), `tests/e2e/app-release_test.ts`의 examples(`expect: { rows: [], coverage: "complete" }`)
  - run 기록(읽기만): `/home/pyosechang/projects/lophn/.dev-data/eval/run_01m5ap0n66bjha1wp8bh1y4d3c/`(AE가 `expect`를 맨 배열로 썼다)

## 할 일

1. 지침의 examples를 말하는 곳(79줄 근처 "expect four weekly rows")에 한두 문장을 더한다: read tool은 `{ "rows": [...], ... }`를 돌려주고, `expect`는 그 모양으로 쓴다(맞추는 규칙이 부분 일치면 그것도 한 줄로). 예 하나.
2. 지침 snapshot이나 test가 있으면 맞춘다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴대로(바꾼 file, 통과한 check, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
