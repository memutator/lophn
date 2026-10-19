# dp-eval

eval 자료와 test support에서 App Engineer와 앱 place를 PM 하나로 합친다. App Engineer 시나리오를 Project Manager 시나리오로 옮기고, 앱을 만드는 시나리오는 project를 먼저 고르는 흐름(`app.create`에 project)을 따른다. 이 task는 eval을 돌리지 않는다(실제 model 호출은 사람에게 묻는다). 코드가 type check를 통과하고 시나리오·확인·자료의 이름이 새 세계와 맞는 것까지가 일이다.

- 단위: evals (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/`
  - `tests/support/`
- 읽을 것:
  - architecture: `project-docs/architecture/eval.md`, `project-docs/architecture/testing.md`
  - boundary·module: `project-docs/module-catalog.yaml`의 `tests`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것"과 `tests/eval/*` 줄, `project-docs/products/AGENT-ROLE.md`의 A 줄(PM의 일로 옮겨진 것)
  - 쓰기 전: `.claude/skills/eval-experiment/SKILL.md`, `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `{ role: "project_manager", project }`가 App Engineer의 일을 받는다. `app.create`는 `project`를 받는다(`dp-app-project`). 앱 data·release 사본은 `<data>/projects/<prj>/app/` 아래다(`dp-storage-apps`).
  - 내놓는 것: 없음

## 할 일

(아래 `scenarios/`, `checks/` 같은 짧은 path는 `tests/eval/` 아래다.)

1. `tests/eval/scenarios/app-engineer/`(A1-ask, A12, A14-other, common)를 `scenarios/project-manager/`로 합친다: 시나리오가 부르는 agent를 PM으로, 그 project와 앱을 setup이 만들게 한다. 이름은 PM 쪽 규칙(`C8`, `C9-other`)과 겹치지 않게 정한다(`scenarios/app-engineer/`는 없어진다. 이 폴더는 `project-docs/architecture/eval.md` 71째 줄이 가리키니 보고에 적는다). `scenarios/{lophn,operator,calendar}/`의 `common.ts`와 시나리오(`L4-new`, `L4-app`, `L8`, `O4`, `calendar-*`, `spec.ts`)의 `app_engineer` 수신자·확인을 PM으로 바꾼다. 앱 place에 놓이던 Operator는 그 project로 옮긴다.
2. 확인·수집·복원: `checks/{calls,fixtures}.ts`와 `checks/app/{calls,judge-input,match,observe}.ts`, `collect/read.ts`, `restore/{operators,mod,package,save,setup}.ts`, `runner/{roots,steps}.ts`, `coding/driver/{driver,focus}.ts`, `types.ts`(179째 줄 `PlaceName`의 `kind: "app"`. 430째 줄 `MaterialKind`의 `"app"`은 재료 종류라 그대로)의 `app_engineer`·앱 place를 PM·project로 바꾼다. 앱 data 경로 `…/apps/<id>/data/app.sqlite`(`checks/app/observe.ts` 140째 줄)는 `appDataFolder`(`packages/protocol/apps/app-storage.ts`)로 만든다. `restore/{apps,call,active-app}.ts`는 `dp-app-project`가 이미 project 등록을 넣었으니 그 위에 PM 이름만 맞춘다.
3. 버전·변이: `versions/components.ts`와 `experiment/variant/texts.ts`의 `ROLES`(`app_engineer` 항목), `versions/versions_test.ts`(191째 줄), `runner/roots_test.ts`, `provider/attach.ts`의 `skills_off`(agent 정의 층의 것이면 `skills`)를 맞춘다. 읽을 prompt 이름이 `project_manager`뿐이다.
4. 자료: `materials/calendar-call/1/files/call.json`, `criteria/{asked-again,card-covered,root-cause}.json`의 App Engineer 표기를 PM으로. 이미 기록된 `tests/eval/runs/`, `tests/eval/registry/`, `tests/eval/experiments/`, `tests/eval/scorecards/`는 지난 기록이라 고치지 않는다.
5. `tests/support/app/activate.ts`와 `tests/support/coding/hand-off.ts`: 앱 test 준비의 agent grant(`agent: { role: "app_engineer", app }`)와 ticket을 만드는 쪽을 PM으로 바꾼다. 앱을 만들기 전에 project를 등록하는 줄은 `dp-app-project`가 넣었다.
6. 설계와 맞지 않는 옛 test는 고치지 말고 지운다. `tests/e2e`는 이 계획이 고치지 않는다(plan README "e2e").
7. 합집합이 아직 남아 있다: protocol의 `Role`·`Place`는 `dp-place-protocol`이 마지막에 줄인다. 그때까지 `app_engineer`·앱 place가 type에 있어 exhaustive `switch`나 `Record<Role, …>`가 오류를 내면 그 갈래만 새 로직 없이 남긴다(null, 빈 값). 남긴 곳은 보고의 "넘길 줄"에 file:줄로 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rln "app_engineer\|App Engineer" tests/eval tests/support --include=*.ts --include=*.json | grep -v "tests/eval/runs/\|tests/eval/registry/\|tests/eval/experiments/\|tests/eval/scorecards/"`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: PM 시나리오의 이름 규칙 / 지운 시나리오
- 넘길 줄: `project-docs/architecture/eval.md` 71째 줄(`scenarios/app-engineer/`)과 `.claude/skills/eval-run`·`eval-experiment`의 App Engineer 문장은 lead가 고친다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: eval을 돌리지 않았다. 새 PM 시나리오의 판정은 실행 전 검증이다
