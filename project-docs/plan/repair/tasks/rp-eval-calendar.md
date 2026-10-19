# rp-eval-calendar

calendar 시나리오의 틀린 check와 judge 입력을 고친다.

- 단위: eval (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/calendar/`
  - `tests/eval/checks/app/`
- 읽을 것:
  - `project-docs/plan/repair/README.md`의 "정한 것"(calendar 셋)
  - architecture: `project-docs/architecture/eval.md`("버전은 hash로 고정한다", "case마다 right/wrong fixture를 둔다")
  - run 기록(main checkout, 읽기만): `tests/eval/runs/`와 `/home/pyosechang/projects/lophn/.dev-data/eval/run_01m5ap0n66bjha1wp8bh1y4d3c/`(calendar-mvp)

## 할 일

1. `calendar-api.scenario.ts`: check `list-after-add`(27줄 근처, `appToolOrder`)와 그것만 떨어뜨리던 wrong fixture(36, 40줄 근처)를 지운다. `added`, `listed`, `event-in-calendar`는 둔다. `appToolOrder`를 쓰는 곳이 없어지면 `checks/app/calls.ts`에서 지운다.
2. `calendar-mvp.scenario.ts`(61줄 근처)와 `checks/app/judge-input.ts`의 `askedAgainInput`(96~99줄 근처): 요청을 lophn session의 보낸 call에서 찾지 말고, `deliver`한 call 본문(`tests/eval/materials/calendar-call/3/files/call.json`의 body)을 인자로 받게 한다. 다른 시나리오(`calendar-maintain`)의 쓰임도 맞춘다.
3. `checks/app/observe.ts`의 `observe-names-in-ticket`(184~204줄 근처): 앱이 보고한 problem 이름만 센다. platform problem(`rewind_unproven` 등, problem의 출처 칸으로 가른다)은 뺀다. `observe_test.ts`에 platform problem이 섞인 행 하나를 더한다.
4. 같은 폴더의 helper가 바뀌면 시나리오 넷 모두 hash가 바뀐다. 바뀐 시나리오의 `n`을 하나씩 올린다.

## 끝남

- `deno task check:full`이 통과한다(`tests/eval/checks/app/*_test.ts` 포함).
- `validateFixtures`가 calendar 넷에서 `{ ok: true }`다(dry-run 스크립트에서).
- 위험 test: 없음.
- `deno task eval`, `eval:experiment`, `eval:gate`, `tests/eval/run.ts`를 돌리지 않는다(진짜 provider). 확인은 no-model dry-run(git 밖 `.dev-data/<id>/dry-run.ts`를 `--env-file` 없이 `deno run --allow-all`로, `resolveVariant` → `prepareTrialWorld` → `releaseWorld`)과 fixture check다. `tests/eval/registry/`는 고치지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴대로(바꾼 file, 통과한 check, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
