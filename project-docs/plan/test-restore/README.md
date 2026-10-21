# test-restore: e2e와 eval을 개편 뒤 설계에 맞추고 check에 되돌린다

- **목표:**
  - primitive 개편(changelog 0.6.0의 `problem-remove`부터 `agent-definition`까지) 동안 check에서 뺀 e2e와 eval을 지금 설계에 맞춘다. 맞는 것은 고치고, 지킬 것이 없어진 것은 지우고, 흐름이 바뀐 것은 다시 쓴다.
  - `tools/check.ts`의 `NOT_CHECKED`를 비운다(`NOT_IN_CHECK`는 개편 전처럼 `tests/e2e`, `tests/live`만 남는다. e2e는 `deno task e2e`로만 돈다). land가 다시 e2e를 돈다.
  - Agents 탭 Instructions 카드가 LOPHN.md 내용을 읽게 고친다.
- **재료:**
  - 이 폴더의 `survey-e2e.md`와 `survey-eval.md`: main `6451cb17f`에서 file마다 무엇을 재고, 어느 지운 계약에 걸렸고, keep·fix·delete·rewrite 가운데 무엇인지 조사한 표다(영어). brief는 이 표를 출발점으로 쓰되 path와 이름은 코드에서 다시 확인한다.
  - changelog `project-docs/products/change-log/0.6.0.md`의 마지막 일곱 항목(problem-remove, approval-simplify, ae-builds, reactor-remove, agent-definition, 그 뒤 고친 것 둘)
  - architecture: `testing.md`(test 층, e2e 길, `tests/support`), `eval.md`, `approval.md`(turn request, shell 규칙, floor), `activation.md`(동의, `waiting_consent`), `app-call.md`(preview), `agent-definition.md`(skill, `guide-*`)
  - roadmap `project-docs/products/roadmap/eval.md`(case 표. 머리의 상태 줄대로 개편 전 계약이 남아 있다)
  - 이슈: `project-docs/issues/agent-definition.md`의 "Agents 탭의 Instructions 카드가 LOPHN.md 내용을 늘 비워 보인다", `project-docs/issues/eval.md`
  - 사람 메모(저장소 root, commit하지 않은 file. 읽기만 한다): `ISSUE-calendar-without-calendar.md`(화면 judge가 캘린더를 목록으로 만든 앱을 통과시켰다), `ISSUE-human-request-abstraction.md`(사람 말에 tool 명세를 넣었다, agent가 domain 모델링과 앱 설계를 하지 않는다)
- **범위 밖:**
  - 진짜 model로 eval 돌리기(사람. `eval-run` skill)
  - 시나리오의 사람 말과 check를 tool 이름이 아닌 결과로 다시 쓰기(`SAY_MAINTAIN`, `CARD_MAINTAIN`, `CARD_DIAGNOSE`, `REPEAT_SCRIPT` 등)와 Claude Code baseline. 사람의 실험 일이다.
  - App Engineer 지침의 화면 규칙 고치기(`ISSUE-calendar-without-calendar.md`의 "지침이 주 화면을 정하지 않는다")
  - coding agent 연결의 크기(roadmap `problem-ticket.md` "정할 것" 1)
  - 사람이 commit하지 않은 eval 재료 `tests/eval/materials/calendar-app-dev/`, `tests/eval/materials/calendar-app-user/`와 root의 `ISSUE-*.md`. 건드리지 않는다.
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `tr-`로 시작한다.
- **시작 조건:** 열 수 있다. 다른 계획이 돌지 않는다(main `6451cb17f` 뒤).

## 정한 것

사람이 정한 것(2026-10-22):
- **e2e 다섯을 새 흐름으로 다시 쓴다.** 무엇을 확인하는지는 아래 표다. 다섯 모두 지금 있는 e2e를 바꾸는 것이고, 새 file은 shell 규칙 하나다.

  | e2e | 확인하는 것 |
  |---|---|
  | `app-activation` | migration이 실패하면 data와 앞 release가 남고 실패가 `release_activate` 결과의 `migration_failed`(단계와 SQLite 오류 글)와 release `failure`에 실린다. 선언을 넓히면 `waiting_consent`이고, 새 release가 나오면 옛 동의 줄이 닫힌다(늦은 동의는 `conflict`). 되돌리기, drain 동안 잡아 둔 호출, 재시작 뒤에도 남는 허락은 그대로 본다 |
  | `app-release` | template 앱으로 `release.prepare` → `preview.start`·`preview.call`·`preview.stop`(live ledger와 data는 그대로) → `release.activate` → 동의 allow·reject. bundle file 수, source map, 읽기 전용 sdk. 준비가 떨어지면 `{status:"failed", stage, reason}`이고 release 행이 없다 |
  | `operator` | 할당의 `removed_tools`로 뺀 tool이 보이지 않는다, domain 좁히기, 할당 없음, session 중 바뀌면 알림. `operator.create`는 묻지 않는다 |
  | `app-call` | agent가 앱 부르기, 큰 changeset, 사람이 부르기, net·secret loopback, 너무 큰 입력. 묻는 단계 둘은 뺀다 |
  | `kinds` | kind 위반이면 Gateway가 남지 않는 `KindViolationFound {domain, count}` 하나를 받고, problem과 PM session은 생기지 않는다. 켠 뒤 첫 sync는 기준만 잡는다 |
  | (새) `shell-rule` | shell `ask`에 `always`로 답하면 Settings `approvals.shell_rules`에 규칙이 남아 같은 명령을 다시 묻지 않는다(재시작 뒤에도). skip이어도 floor deny(`rm -rf ~`)는 막힌다 |
- **eval의 화면 채점은 코드가 아니라 설계를 본다.** `app-design` judge(`tests/eval/criteria/app-design.json`)는 App Engineer가 쓴 `DESIGN.md`의 Journeys와 Screens를 사람의 요청과 견준다: 그 종류의 앱이 처음 여는 주 화면을 골랐나, 사람이 한 말의 일을 그 화면에서 하나. 근거: 코드를 읽은 judge가 캘린더를 목록으로 만든 앱을 "fits"로 통과시켰다(`ISSUE-calendar-without-calendar.md`). 주 화면을 정하는 것은 코드 전의 결정이다.
- **program check 하나를 더한다:** 첫 `release.prepare` 전에 앱 source root에 `DESIGN.md`가 있고 일곱 절(Purpose, Reuse, Model, Journeys, Screens, Tools, Failure branches. App Engineer 지침 `packages/core/agent-roles/roles/app-engineer/prompt.md`의 순서)이 있다. App Engineer가 설계 없이 코드부터 쓰는 것을 잡는다(`ISSUE-calendar-without-calendar.md` 5).

agent가 정한 것(2026-10-22):
- **지우는 e2e:** `coding_test.ts`(ticket, claim, CLI. coding session을 띄우는 길이 없다), `call-gate_test.ts`(agent call은 묻지도 막지도 않는다, `architecture/approval.md`), `reaction_test.ts`(reaction, problem, `problem.body`가 없다), `approval_test.ts`의 `allow-once-consumed`(fingerprint와 함께 없어졌다). `reaction_test.ts`의 "앱이 계속 죽으면 `appRuntime`이 `unavailable/crash_loop`이고 Gateway가 `AppRestartHalted` 하나를 받는다"는 `app-restart_test.ts`로 옮긴다. 근거: AGENTS.md "호환성"(틀린 옛 test는 살리지 않는다).
- **지우는 eval:** coding agent driver와 metrics(`tests/eval/coding/`), `eval:attach`, coding 갈래 type(`CodingParticipant`, `CodingTrace`, `CodingRecord`), ticket·problem check(`checks/app/tickets.ts`, `checks/app/observe.ts`와 그 test, `readProblem`, `aeCallsOnlyToCodingAgent`, `addCodingCall`), restore의 `setup.ts`(`openProblem`, `openTicket`, `excludeCall`)·`call.ts`·`deliver.ts`, material 종류 `call`과 save 종류 `call`, 시나리오 `T19-lophn`·`T19-op`. 근거: coding session을 띄우는 길이 없고(Router가 `coding_agent` call을 거절한다), 거절당한 call을 만들 수 없다. coding agent 연결을 살리기로 하면 그때 새로 쓴다.
- **앱을 운영으로 올리는 test helper는 하나다(`tests/support/app/activate.ts`).** `release.prepare`와 `release.activate`는 agent만 부르므로 가짜 model lane이 App Engineer로 부르고, 동의는 `activations.consents`를 읽어 `activation.consent`(`requested_at` 비교)로 한다. e2e와 eval restore(`tests/eval/restore/active-app.ts` 등)가 같이 쓴다. eval이 쓰는 이름(`tool`, `appProjectName`, `openAppProject`, `approveActivation`, `deliverRelease`, `waitRunning`, `TestApp`)은 되도록 그대로 둔다. test만을 위한 machine actor를 제품 route에 더하지 않는다.
- **허락을 묻게 하는 e2e는 file 쓰기 대신 shell 규칙에 걸리는 명령을 쓴다.** 지금은 file 쓰기가 묻지 않는다. 공통 helper 하나가 `shell_run "rm -r <미리 만든 폴더>"` 호출을 낸다. 이름 바꾸기: `"allow"` → `"once"`, `permission_requests` → `turn_requests`, `PermissionRequested` → `TurnRequestOpened`, `approvalsDecideTurn` → `turnRequestDecide`.
- **`tests/support/coding/{deps,prepare-deps}.ts`는 `tests/support/app/`으로 옮긴다.** `deno.json`의 `e2e:deps` path를 같이 고친다. 나머지 `tests/support/coding/`(cli, hand-off, mcp)과 `tests/support/gateway/shell.ts`, `tests/support/app/patch-report.ts`는 지운다. `patch-reaction`은 `patch-crash`가 된다.
- **eval runner의 idle·stuck 한도는 시나리오마다 정한다.** 긴 한도가 coding participant에 묶여 있었다(`tests/eval/runner/steps.ts`, `experiment/parallel/kind.ts`). App Engineer가 짓는 시나리오는 15~60분 걸린다.
- **eval의 version 목록을 지금 tool과 skill에 맞춘다.** `versions/files.ts`의 `TOOL_FILES`(ticket, problems, guide를 빼고 preview, runtime, settings를 더한다), `guide` version 종류를 지운다(guide는 내장 skill이다), `experiment/variant/texts.ts`의 지운 `guides.ts` import. registry json(`registry/tool/ticket.*.json`, `guide.read.json`, `registry/guide/*`)은 지금 정의에 맞춘다.
- **eval experiment gate의 `e2e` 단계는 남긴다.** e2e가 다시 돈다.
- **calendar-user와 calendar-dev의 앱 등록은 새 material `calendar-blank@1`이 한다.** 지우는 `call` material이 하던 일이다. judge `card-covered`는 `DESIGN.md`를, `root-cause`는 App Engineer의 마지막 답과 고친 diff를 읽는다(ticket이 없다).
- **Agents 탭 Instructions 카드는 `instructions.open`이 주는 path를 이미 있는 file read IPC(`FILE_READ_CHANNEL`, `packages/shell/main/editor/ipc.ts`)로 읽는다.** renderer의 `Link.worker`(`packages/shell/renderer/workspace/agents/core-link.ts`)와 IPC kind `"worker"`(`packages/shell/ipc/core.ts`)를 지운다. 근거: 이슈의 추천안. core route를 넓히지 않는다.
- **`NOT_CHECKED`를 비우고 `NOT_IN_CHECK = ["tests/e2e", "tests/live"]`로 둔다(개편 전 값).** `deno task e2e`는 `--no-check`라 e2e의 type 오류는 `deno task check`만 잡는다. 지금 `tests/support/core/try-boot.ts`, `tests/support/fake-oauth`, `tests/support/annotation/upload.ts`, `tests/support/gateway/mod.ts`는 이미 compile된다.

## 지켜볼 것

- `app.create` 직후 약 1초 동안 App Engineer의 agent runtime 자식이 다시 뜬다(새 source가 그 place 폴더라서). 그 사이 시작한 turn이 끊길 수 있다. 처음 드러날 곳: `registration_test`, `annotation_test`, `agent-call_test`의 operator-to-app-ae. flake이면 test에 `settle`을 넣고, lead는 사람이 쓸 때도 생기는지 보고 제품 이슈로 올린다.
- `release.prepare`는 build, migration 검사, preview 시작을 tool 호출 하나 안에서 한다. tool 호출 한도를 넘으면 helper가 다른 길(예: `release.get` 폴링)을 써야 한다.
- `deno task e2e:deps`의 offline 의존 cache가 `release.prepare`의 migration 검사와 preview 시작까지 덮는지 첫 run이 정한다.
- `tests/support/coding/cli_test.ts`는 지금 `NOT_CHECKED`에 가려 실패하고 있다. 지우는 file이다.

## 사람이 정할 것

- 없음.

## 순서

- wave와 선행은 tasks의 brief가 정한다. 공통 helper(`tests/support/app/activate.ts`, 묻게 하는 shell helper)를 먼저 두고, e2e와 eval restore가 그 위에서 돈다. `NOT_CHECKED` 비우기는 마지막이다.

## lead가 할 일

- merge할 때마다 바뀐 곳의 unit test와, 바뀐 e2e file만 `deno test --allow-all --no-check tests/e2e/<file>`로 돌린다. eval은 `tr-eval-human`과 `tr-eval-restore`가 merge되기 전에는 import도 되지 않으니 type check까지만 본다. 진짜 model eval은 돌리지 않는다(사람).
- `deno.json`(`e2e:deps` path, `eval:attach` 지우기)은 lead가 고친다(orchestrate skill의 등록 file).
- land는 끝에 한 번, e2e를 돌리는 `land.sh test-restore`다. 중간 wave 뒤에는 옛 e2e가 남아 land가 멈추므로 land하지 않는다. `LOPHN_LAND_SKIP_E2E`를 쓰지 않는다.
- 다 끝나면
  - 문서: `architecture/testing.md`(앱 길, `tests/support` 표), `architecture/eval.md`(coding driver, human role 동의, restore, judge, DESIGN.md check), roadmap `eval.md`(case 표와 머리의 상태 줄), `.claude/skills/write-test/SKILL.md` 88-89, `.claude/skills/eval-run/SKILL.md`의 coding 절과 동의 답하기
  - 뒤 계획 README의 `LOPHN_LAND_SKIP_E2E` 줄(`headless-run` 72, `schedule-job` 87, `workflow` 64)을 지운다. e2e가 다시 돈다.
  - 이슈: `issues/agent-definition.md`의 Instructions 카드 이슈를 닫고, `issues/eval.md`의 coding token 이중 셈은 driver를 지워 닫는다(`issue` skill). 지켜볼 것에서 드러난 제품 문제는 새 이슈로 올린다.
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- 사람에게 묻는 것: push. 그 밖은 planner에게 묻는다.
