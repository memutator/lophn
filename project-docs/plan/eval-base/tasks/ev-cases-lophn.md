# ev-cases-lophn

lophn 하나에 진짜 model을 붙이고 사람 말 한 줄을 보내는 case 다섯(L1, L4-app, L4-new, L5, L8)을 쓴다. 준비는 재료(앱, project)뿐이다.

- 단위: ev-cases (wave 5)
- 선행: ev-run, ev-world, ev-checks, ev-steps
- 소유(이 task만 고친다):
  - `tests/eval/cases/{L1,L4-app,L4-new,L5,L8}.ts`
- 읽을 것:
  - 계획: `project-docs/plan/eval-base/README.md`, `project-docs/products/roadmap/eval.md`의 "책임에 따른 call: 작은 판단 case"(아래 표의 원본)와 "case 고르는 규칙"(특히 2·3·4)
  - 조사: `project-docs/plan/eval-base/research/roles-and-outcomes.md` 1절(항목별 tool과 관찰 결과), 3절(role별 tool 목록, `call` 입력 모양), 7절(점검할 수 있는 것과 없는 것)
  - 본보기: `tests/eval/cases/L6.ts`(ev-run이 만든 첫 case. 이 꼴을 그대로 따른다)
  - 확인 함수와 fixture: `tests/eval/checks.ts`, `tests/eval/fixtures.ts`(ev-checks), 재료: `tests/eval/materials/`(ev-world)와 `ev-world.md`의 표
  - role 지침과 tool: `packages/core/agent-roles/roles/lophn/prompt.md`, `packages/core/agent-roles/tool-lists.ts`, `packages/core/agent-roles/tools/operator-place.ts`, `project-docs/products/AGENT-ROLE.md`(case가 나온 줄)
  - 계약: `tests/eval/types.ts`(`Scenario`, `Check`, `Fixture`, `Target`)
- 계약:
  - 쓰는 것: `tests/eval/types.ts`, `tests/eval/checks.ts`, `tests/eval/fixtures.ts`, `tests/eval/steps.ts`, 재료 이름@n, `tests/eval/run.ts`(`--check`, `--fake`)
  - 내놓는 것: `tests/eval/cases/*.ts` — 각 file이 `export default`로 `Scenario` 하나를 낸다. `loadScenarios()`가 폴더를 읽어 모은다(목록 file이 없다).

## case

| id | 대상 | world | 사람 말 | check(결과) | proposal |
|---|---|---|---|---|---|
| L1 | lophn | `[]` | 가계부 비슷한 걸 만들고 싶은데 아직 잘 모르겠어 | `ask` 1번 이상. `app.create` 0. call 0 | true |
| L4-app | lophn | `apps-home@1` | 가계부 앱에 월별 지출 합계 화면을 넣고 싶어 | 가계부 App Engineer에게 call 정확히 하나, 답 방식 `none`. 다른 받는 쪽 call 0. `app.create` 0 | true |
| L4-new | lophn | `apps-home@1` | 사진 앨범 앱을 새로 만들어 줘 | `app.create` 정확히 하나, 그 뒤(`toolOrder`) 새 앱(`app.create` 결과의 id → `names.apps`의 이름)의 App Engineer에게 `none` call | true |
| L5 | lophn | `project-tax@1` | 세무 프로젝트 문서에서 공제 한도 자료를 모아 기획에 써 줘 | project `tax`의 Project Manager에게 답 방식 `result` call | true |
| L8 | lophn | `apps-home@1`, `project-tax@1` | 가계부 앱에 월말 정리용 Operator를 만들어 줘 | 가계부 App Engineer에게 call(답 방식은 보지 않는다). 다른 받는 쪽 call 0 | false |

- L1: 진짜 model이 `ask`를 부르면 turn이 질문 대기로 서므로 driver가 turn을 끊는다(`stopped_on_question`). 정상이다. `ask` 호출은 ledger에 남는다.
- L4-new는 앱 이름을 model이 정한다. 확인은 case file 안의 `Check`로 쓴다: `app.create` call의 `output`(OUTPUT_TOOLS)에서 새 앱 id를 읽고 `record.names.apps[id]`로 이름을 얻어 그 이름의 App Engineer로 간 `none` call을 찾는다. `app.create` 입력 모양은 `packages/core/apps/agent-tools/app.ts`.
- 사람이 정한 줄은 L8뿐이다(`proposal: false`). 나머지는 AGENT-ROLE의 "(제안)" 줄이라 떨어지면 지침이나 그 줄이 틀렸을 수 있다(case 규칙 4).
- lophn가 어길 수 있는 tool은 `call`과 `app.create`뿐이다(lophn은 `file.write`·`ticket.*`·`operator.*`가 없다. `tool-lists.ts`).

## 할 일

1. 아래 표의 case마다 `tests/eval/cases/<id>.ts`를 `L6.ts`와 같은 꼴로 쓴다(`export default` 하나가 `Scenario`).
   - 사람 말은 표의 글 그대로 한 줄이다. 바꾸지 않는다.
   - `world`는 표의 재료 이름@1이다. `setup`은 표에 있는 것만 쓴다.
   - `checks`는 1~3개다. 결과(call의 받는 쪽, 답 방식, tool 사용)만 채점하고 모델이 쓴 글은 단정하지 않는다. 표에 없는 `checks.ts`의 함수로 모자라면 case file 안에 `Check`를 직접 쓴다(순수 함수).
   - `wrong`은 그 case가 떨어뜨려야 하는 record 하나와 `fails`(떨어져야 할 check id)다. `right`는 모든 check를 통과하는 record다. `fixtures.ts`로 3~8줄에 쓴다.
   - `proposal`은 표의 값이다. `trials: 3`.
   - 파일 머리 주석 한 줄: "어길 수 있는 tool: …" — case 규칙 2에 따라 pass 조건이 그 agent의 tool로 어길 수 있는 것인지 `tool-lists.ts`와 `operator-place.ts`로 확인한 결과를 적는다. program이 이미 막는 것(grant, Gate, role의 tool 목록, 폴더 scope, `operatorPlaceAllowed`)을 pass 조건으로 삼지 않는다. 그런 줄을 찾으면 쓰지 말고 보고한다.
2. 확인(진짜 provider 없이, 진짜 key와 `.env`는 쓰지 않는다):
   - `deno run -A tests/eval/run.ts --check`: 자체 점검(`right` 통과, `wrong` 떨어짐)과 재료 hash가 통과한다.
   - `deno run -A tests/eval/run.ts --fake --case <id,…> --trials 1`: core를 띄워 재료를 되살리고 setup을 하고 session에 model을 붙여 끝까지 돌고 grader가 판정을 낸다(판정이 실패여도 된다. 모든 session이 text 한 줄로만 답한다). 던지면 이유(준비 오류인지, 이름이 world와 다른지)를 찾아 고친다. 제품 쪽 문제로 보이면 고치지 말고 보고한다.
   - 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않았다.
3. 소유 밖 file(`checks.ts` 등)이 모자라면 고치지 말고 "계약 바꾸기 요청"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- `--check`가 통과하고 `--fake`가 이 task의 case마다 끝까지 돈다.
- 위험 test: 없음. grader의 정확성은 case마다 `right`/`wrong` 점검(`--check`)으로 본다.
- 남지 않음: 진짜 provider를 부르지 않았다. scratch를 commit하지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: 문서에 답이 없어 정한 것(check id)
- 계약 바꾸기 요청: `checks.ts`·`fixtures.ts`에 더해야 할 것
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 없음이면 "없음". case 규칙 2에 걸려 쓰지 못한 pass 조건이 있으면 여기 적는다
