# rp-eval-operator

O4를 돌고 있는 앱 위에 다시 짓고, 월말정리 Operator를 앱 place에 둔다.

- 단위: eval (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/operator/`
  - `tests/eval/restore/operators.ts`
  - `tests/eval/materials/operators-home/5/` (새 판)
- 읽을 것:
  - `project-docs/plan/repair/README.md`의 "정한 것"(O4, 월말정리)
  - 이슈: `project-docs/issues/eval.md`의 "월말정리 Operator가 앱이 아니라 앱 옆 project에 놓인다"
  - architecture: `project-docs/architecture/eval.md`, `project-docs/architecture/domain.md`(Operator는 정의의 domains ∩ 그릇의 domain)
  - 본보기: `tests/eval/scenarios/calendar/common.ts`의 `createCalendarOperator`(앱 place Operator), `tests/eval/scenarios/calendar/calendar-diagnose.scenario.ts`(`calendar-app-bug@2`, 심긴 bug), `tests/eval/materials/operators-home/4/`
  - run 기록(읽기만): `tests/eval/runs/`의 O4 run(Operator가 `domain_list`, `app_get` 등으로 꺼진 가계부와 0개 problem만 보고 끝났다)

## 할 일

1. `operators-home@5`: `4/`를 복사해 월말정리의 place를 `{app: "가계부"}`로 바꾼다. `material.json`과 contentHash는 다른 판을 만든 길(`tests/eval/restore/manifest.ts`)대로 잰다. 옛 판은 지우지 않는다.
2. `restore/operators.ts`의 `restoreOperators`: place `app`을 `world.apps`로 푼다.
3. `scenarios/operator/common.ts`의 `OP_월말정리` place를 앱으로. 이 Operator를 쓰는 시나리오(O4, O6, O7, T19-op)를 `operators-home@5`로.
4. O4를 다시 쓴다: 사람이 "앱 tool 결과가 이상하다"를 볼 수 있는 world. `calendar-app-bug@2`(돌고 있는 앱, `next_week`에서 틀린 결과)와 그 앱 place의 Operator로, 사람 요청이 그 틀린 값을 드러내게 한다. 재는 것은 그대로다: Operator가 고치려 하지 않고 그 앱의 App Engineer에게 call로 맡긴다(`call-to-...-ae`, `relays-request`). 시나리오 머리 주석의 "tool이 실제로는 없다" 한계 줄을 지운다.
5. 바뀐 시나리오의 `n`을 올린다.

## 끝남

- `deno task check:full`이 통과한다.
- dry-run: O4, O6, O7, T19-op의 world가 풀리고, 월말정리의 `agentDefinitionRead` `effective.domains`에 가계부 앱의 domain이 있다. O4 world에서 앱 tool을 부르면 심긴 틀린 값이 나온다. `validateFixtures`가 `{ ok: true }`다.
- 위험 test: 없음.
- `deno task eval`, `eval:experiment`, `eval:gate`, `tests/eval/run.ts`를 돌리지 않는다(진짜 provider). 확인은 no-model dry-run(git 밖 `.dev-data/<id>/dry-run.ts`를 `--env-file` 없이 `deno run --allow-all`로, `resolveVariant` → `prepareTrialWorld` → `releaseWorld`)과 fixture check다. `tests/eval/registry/`는 고치지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴대로(바꾼 file, 통과한 check, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
