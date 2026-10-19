# test-restore: e2e와 eval을 domain 설계에 맞춰 되살린다

- **목표:** domain 개편 계획 여섯(`domain-kinds`, `domain-tools`, `domain-place`, `artifact`, `rewind-check`, `domain-entity`)은 e2e를 돌리지 않고 type만 맞췄다. eval 자료도 옛 선언을 쓴다.
  - core e2e를 새 설계에 맞춰 다시 써서 `deno task e2e`가 통과하게 한다. land.sh의 e2e 검사를 다시 켠다(`LOPHN_LAND_SKIP_E2E` 없이 land한다).
  - eval 자료·시나리오·check를 고쳐 eval experiment가 다시 돌게 한다.
- **재료:**
  - `project-docs/architecture/testing.md`(층, 앱 길, E2E 실행 폴더, case 고르는 규칙, 시간 예산 10분), `.claude/skills/write-test/SKILL.md`
  - `project-docs/architecture/eval.md`, `.claude/skills/eval-run/SKILL.md`
  - 새 설계: `project-docs/architecture/domain.md`, `kinds.md`, `app-call.md`, `artifact.md`, `activation.md`, `place-session.md`, `agent-definition.md`, `coding-agent.md`
  - 이슈: `project-docs/issues/eval.md`(다섯), `project-docs/issues/agent-call.md`("e2e의 Project Manager 줄…")
  - 지금 e2e 결과(2026-10-20, main `4023cec4d`): 29 file 가운데 26 file이 통과했다. 9분 19초 걸렸다.
    - 떨어진 셋(5 step)은 모두 agent가 받는 앱 tool 쪽이다. domain 단위 공개 tool 거르기와 Operator domain 좁히기가 들어온 뒤로 보인다.
      - `app-call_test.ts`: agent가 앱을 부른 기록이 0이다. allow-session-scope 둘은 권한 요청이 오지 않는다.
      - `app-data-rewind_test.ts`
      - `operator_test.ts`: tool 목록에 `add_item`·`list_items`가 없다.
    - 새 설계대로 숨겨진 것이면 test를 새 설계로 다시 쓴다. 제품 bug면 bug를 고친다. 이 구분이 첫 일이다.
    - log: `.dev-data/plan-test-restore/e2e-run.log`(main checkout, git 밖)
- **범위 밖:**
  - live test(`tests/live`)
  - 제품 동작 바꾸기. 예외는 e2e가 찾은 제품 bug를 고치는 것이다(testing.md 규칙 8).
- **돌리는 방식:** worker를 쓴다. orchestrate skill대로 한다. task id는 `tr-`로 시작한다.
- **시작 조건:** 열린 다른 계획이 없다(main `4023cec4d` 이후).

## 정한 것

- **옛 e2e는 고쳐 살리지 않는다.** 틀린 옛 test는 지우고 새 설계에 맞춰 다시 쓴다(AGENTS.md "호환성"). file마다 셋 가운데 하나다.
  - 그대로 통과: 손대지 않는다.
  - 지금 설계에 그 flow가 있다: 새 설계로 다시 쓴다.
  - 그 flow가 없어졌다: 지운다. 예: context, project 범위 app-api.
- **새 e2e flow 셋을 만든다**(사람이 셋 다 골랐다, 2026-10-20). process를 건너야만 깨지는 것들이다(testing.md 규칙 3).
  - Operator를 domain으로 좁히면 agent runtime child가 받는 prompt와 tool 목록에 그 domain 것만 있다.
  - coding agent가 coding token으로 core MCP endpoint를 불러 자기 앱 preview의 tool을 부른다. live로는 가지 않는다.
  - kind 파일 위반이 kinds worker process를 거쳐 domain problem으로 오른다.
- **시간 예산:** 전체 e2e는 10분 안이다. 지금 이미 9분 19초라 새 flow 셋을 그대로 더하면 넘는다. 새 flow는 이미 있는 file의 준비(앱 E2E 길 등)에 얹거나, 지금 file을 harness로 내리거나 묶어 자리를 만든다(testing.md).
- **새 e2e와 다시 쓴 e2e는 10번 연속 통과한 뒤 merge한다.** flaky한 것은 꺼 두지 않고 고치거나 지운다. e2e가 제품 bug를 찾으면 test를 맞추지 않고 bug를 고친다.
- **eval 자료:**
  - calendar-app, calendar-app-bug, notify-app, tax-kinds를 새 판(`2/`)으로 만든다. 옛 판(`1/`)은 지우지 않는다(eval material은 판이 불변이다). 새 판에서 바뀌는 것은 아래다.
    - tool 선언(`tools[]`, `domain`, `public`)
    - SDK 이름(`@lophn/cap-tool` 등)
    - App Engineer 문구
    - tax-kinds는 project 안 domain의 kind 파일
  - 그 자료를 쓰는 시나리오는 n을 올리고 새 판을 가리킨다.
- **eval 이슈는 정한 대로 고친다**(`issues/eval.md`의 "정한 것").
  - variant는 `deno task e2e:deps`를 돈다.
  - L7 check를 넓힌다.
  - T19-op은 막힌 상대를 이름으로 가리킨다.
  - `tests/eval/checks/calls.ts`의 `callAfterAppCreate`가 기대하는 project 입력을 새 `app.create` 모양에 맞춘다.
- **eval도 App Engineer를 되살린다(agent, brief 때).** 앱 일(ticket, coding agent에게 맡기기)은 App Engineer만 한다(`tool-lists.ts`). eval 참가자, 받는 쪽 place, 시나리오의 앱 일을 App Engineer로 옮기고, PM이 앱 일을 하던 CA1-ask·CA12는 `scenarios/app-engineer/`로 돌린다(`tr-eval-app-engineer`).
- **e2e가 찾은 제품 bug 하나(brief 때):** domain을 만들 때 kind 감시가 domain 폴더가 생기기 전에 열려, 처음 쓴 `kinds.yaml`을 다음 command까지 보지 못한다. `tr-e2e-kinds`가 먼저 실패를 확인하고 고친다.
- **e2e 시간은 unit으로 내려 먼저 줄인다(agent).** `reaction_test`의 crash-loop backoff(31초, 멈춘 적이 있다)를 supervisor unit으로 내리는 것이 첫 후보다(`tr-e2e-budget`).
- **진짜 provider를 불러도 된다(사람, 2026-10-20).** eval 줄이 land한 뒤 lead가 eval-run skill로 바꾼 시나리오를 진짜 model로 돌려 되살아났는지 본다. worker는 dry-run만 한다(registry에 동시에 쓰지 않게).
- **e2e 검사를 다시 켠다:** 이 계획의 마지막 land는 `LOPHN_LAND_SKIP_E2E` 없이 돈다. 앞 wave의 land는 e2e가 아직 깨져 있으면 `LOPHN_LAND_SKIP_E2E=1`로 돈다.

## brief

brief는 두 단계로 병렬로 쓴다(`project-docs/issues/planning.md`의 추천안을 이 계획에서 써 본다).
1. 뼈대 worker 하나가 e2e 결과와 코드를 보고 task id, 단위, wave, 선행, 소유, 계약, 한 줄 일만 쓴다.
2. 영역별 worker 여럿이 뼈대를 고정한 채 맡은 brief의 할 일, 읽을 것, 실제 path, 끝남, 위험 test를 채운다.

worker model은 사람이 정했다: Opus 5.5.

## lead가 할 일

- **merge 때마다:** 다시 쓴 e2e file을 10번 연속 돌린다(`deno task e2e:deps` 뒤 `deno test --allow-all --no-check tests/e2e/<file>`). 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않았는지 본다.
- **다 끝나면**
  - 전체 `deno task e2e`가 10분 안에 통과한다.
  - 마지막 land를 e2e 포함으로 한다.
  - `architecture/testing.md`(e2e file 목록과 앱 길)와 `architecture/eval.md`(자료 판)를 고친다. 이슈를 닫는다.
  - changelog `0.5.0`에 항목을 덧붙인다.
- **planner(`lophn-7e`)에게 묻는 것:** 위 셋 밖의 새 e2e flow, 시간 예산을 넘길 때. 사람에게 interview를 띄우지 않는다. push는 하지 않는다.
