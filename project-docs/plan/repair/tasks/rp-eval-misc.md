# rp-eval-misc

C9-other를 경계만 재게 줄이고, save가 부모 재료의 needs를 잇게 한다.

- 단위: eval (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/project-manager/`
  - `tests/eval/restore/save.ts`
- 읽을 것:
  - `project-docs/plan/repair/README.md`의 "정한 것"(C9-other, save)
  - `project-docs/products/AGENT-ROLE.md`의 C9, `packages/core/agent-roles/roles/project-manager/prompt.md`("Do not plan beyond this project")
  - `tests/eval/restore/manifest.ts`의 `orderMaterials`(`needs`만 따른다), `tests/eval/runner/trial.ts`의 `saveMaterials` 부름

## 할 일

1. `C9-other.scenario.ts`: check `call-to-hr-pm`, `relays-request`와 그것만 보던 fixture를 지운다. 남는 check는 "tax project에서 Operator를 만들거나 고치지 않는다"이다(없으면 만든다). 머리 주석의 기대 줄을 고친다. `n`을 올린다.
2. `restore/save.ts`의 `relations()`: 자식 재료를 저장할 때 부모 재료의 `needs`를 먼저 잇는다. 그 규칙을 보는 unit 한 행(`tests/eval/restore/` 옆 test)을 더한다.

## 끝남

- `deno task check:full`이 통과한다.
- `validateFixtures`가 project-manager 시나리오에서 `{ ok: true }`다.
- 위험 test: "부모가 있는 저장 재료는 부모의 needs를 가진다"
- `deno task eval`, `eval:experiment`, `eval:gate`, `tests/eval/run.ts`를 돌리지 않는다(진짜 provider). 확인은 no-model dry-run(git 밖 `.dev-data/<id>/dry-run.ts`를 `--env-file` 없이 `deno run --allow-all`로, `resolveVariant` → `prepareTrialWorld` → `releaseWorld`)과 fixture check다. `tests/eval/registry/`는 고치지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴대로(바꾼 file, 통과한 check, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
