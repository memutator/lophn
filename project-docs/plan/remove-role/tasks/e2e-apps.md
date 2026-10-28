# e2e-apps

앱·파일·secret·권한 쪽 e2e와 live suite를 새 계약으로 옮긴다. 고치는 것은 주소와 session 정체, route 상수, tool 목록 함수뿐이다. 새 e2e는 만들지 않는다.

- 단위: e2e (wave 3)
- 선행: e2e-agents. 공용 support의 새 도우미를 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/{app-call,app-data-rewind,secret,oauth,file-write,shell-rule,gateway}_test.ts`
  - `tests/e2e/{app-release,app-restart,app-activation}_test.ts` (test 이름과 주석의 role 말만)
  - `tests/live/suite.ts`
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `tests/live/{chatgpt,anthropic,openai}_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/testing.md`("앱 길", "case 고르는 규칙", "돌리는 때"), `project-docs/architecture/approval.md`("할당"), `project-docs/architecture/place-session.md`("place 폴더가 범위"), `project-docs/architecture/domain.md`(받는 domain, 비공개·공개 tool). 이 문서들의 role 말은 lead가 고친다.
  - skill: `.claude/skills/write-test/SKILL.md`(특히 "지우는 test가 지키던 권한 경계 검사까지 같이 없애지 않는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `agent-tools`, `domains`, `agents`, `app-runtime`, `app-releases`, `app-data`, `secrets`, `run-loop`. `project-docs/module-catalog.yaml`의 `tests`
  - 제품 결정: `project-docs/plan/remove-role/README.md`의 "session과 place 종류"(file 범위, 받는 domain), "agent와 정의"(할당·정의 층 MCP server·skip은 사람만 정한다), "저장과 test"
  - 계약 모양: `project-docs/plan/remove-role/tasks/e2e-agents.md`("할 일"의 공통 바꿈표와 `openPlaceSession`), `project-docs/plan/remove-role/tasks/contract-agent.md`(`agentCreate`, `assignmentGet`, `assignmentSet`, `LOPHN_AGENT_ID`), `project-docs/plan/remove-role/tasks/contract-session.md`(`placeSessionRead`), `project-docs/plan/remove-role/tasks/place-tools.md`(`placeToolNames`)
  - 코드: `tests/support/core/human.ts`(`openPlaceSession`, e2e-agents가 더했다), `tests/support/app/activate.ts`(`startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`), `tests/support/app/patch-domain.ts`(`domainPatch`), `packages/core/agent-places/place/instruction-rules.ts`(agents-core가 바꾼 `agentFilePathOf`), git 기록의 `tests/e2e/operator_test.ts`(e2e-agents가 지웠다. `git log --diff-filter=D --format=%h -- tests/e2e/operator_test.ts`로 지운 commit `<c>`를 찾아 `git show <c>^:tests/e2e/operator_test.ts`로 연다), 아래 "할 일"의 file 전부
- 계약:
  - 쓰는 것: `e2e-agents`의 support 도우미. `contract-agent`의 `agentCreate`, `assignmentSet`. `contract-session`의 `PLACE_SESSION_ROUTES`. `place-tools`의 `placeToolNames`.
  - 내놓는 것: 없음

## 할 일

`{ role: … }` 주소, Operator 만들기, 옛 route 상수를 새 꼴로 바꾸고 test가 지키던 경계 검사는 남긴다. 바꿈은 `e2e-agents.md` "할 일"의 공통 바꿈표를 그대로 쓴다. 앱 tool을 부르는 agent는 test가 `agentCreate`로 만들고 사람이 할당한 agent이고(`testing.md` "앱 길"), 그 앱 place에서 session을 연다. 정의에 `domains`가 없으면 앱의 active domain을 모두 받는다(README "받는 domain").

1. `tests/e2e/app-call_test.ts`(주소 고치기):
   - `operatorCreate { id, place, definition }` → `agentCreate { id, definition: { name: "Caller", body } }`, `agentAssignmentSet { agent: ref }` → `assignmentSet { agent: <agt id>, entries }`(compare `{ revision: 0 }`), session은 `openPlaceSession(c, agent, { kind: "app", id })`.
   - 머리 주석의 "agent는 앱 place의 Operator다"와 "App Engineer 대답" → "test가 만든 agent의 앱 place session", "앱 place lophn session의 대답".
2. `tests/e2e/app-call_test.ts`(옮겨 온 할당 경계 행, operator_test에서):
   - 준비를 operator_test의 준비로 바꾼다: `activateTestApp` 대신 `startTestApp`(patch는 지금 `callPatch`·`netFetchPatch`에 `domainPatch(SECOND)`를 더한 것) → `domainCreate { name: SECOND, title, purpose, owner: { kind: "app", id } }` → `deliverRelease` → `approveActivation` → `waitRunning`. 둘째 domain은 release 준비 전에 있어야 한다(앱 tool의 domain은 그 앱의 active domain이다).
   - operator_test의 `operatorWith`를 `agentWith(core, place, name, entries | null, domains?)`로 옮긴다(`agentCreate` → `entries`가 있으면 `assignmentSet` → `openPlaceSession`).
   - 행 넷을 `t.test`로 옮기고 단정은 그대로 둔다. 기대하는 tool 이름 목록은 이 앱(`calls`와 `SECOND`)의 선언으로 다시 적는다.
     - `removed-tool`: 할당에서 뺀 tool은 요청에 없고, model이 그래도 부르면 `not_found`이고 invocation이 없고 앱 data가 그대로다.
     - `domain-narrowed`: `domains`를 앱 slug domain 하나로 좁힌 agent의 요청에는 그 domain의 `DOMAIN.md`와 tool, 다른 domain의 공개 tool만 있다.
     - `no-assignment`: 할당 없이 만든 agent에는 앱 tool이 없고, `assignmentGet`이 `entries: []`, `revision: 0`이다.
     - `assignment-added`: session 도중 할당을 더해도 `tools[]`는 그대로이고 notice는 `tools_changed`와 tool 이름만 담고 앱의 tool 설명을 담지 않는다.
   - 머리 주석에 이 행들의 세 질문을 operator_test 것에서 옮긴다(boundary `approvals`·`agent-tools`, `run-loop`, `domains`). `pm-creates-operator` 행은 옮기지 않는다(e2e-agents가 `session_test.ts`로 옮겼다).
3. `tests/e2e/app-data-rewind_test.ts`: 1과 같은 모양으로 `Writer` agent를 만들고 할당하고 그 앱 place session을 연다. 주석의 "앱 place Operator session"·"App Engineer 대답"을 맞춘다.
4. `tests/e2e/secret_test.ts`: lophn session은 home, PM session은 그 project place의 lophn session이다. `agentSessionRead` → `placeSessionRead`.
5. `tests/e2e/oauth_test.ts`: lophn session 넷을 home의 `openPlaceSession(core, LOPHN_AGENT_ID)`로.
6. `tests/e2e/file-write_test.ts`(위험 경계: place 종류별 file 범위):
   - session은 그 project place의 lophn session이다. 정의 file은 그 session의 agent 정의, 곧 agents-core가 바꾼 `agentFilePathOf`로 구한 lophn 정의 file(`<data>/agents/lophn.md`)이다. "자기 agent 정의 file에 쓰지 못한다" 단정은 그대로다.
   - test 이름 셋의 "PM은" → "project place session은". 단정과 행은 하나도 빼지 않는다.
7. `tests/e2e/shell-rule_test.ts`, `tests/e2e/gateway_test.ts`: PM session → 그 project place의 lophn session. `agentSessionRead` → `placeSessionRead`. test 이름·주석의 PM 말.
8. `tests/e2e/{app-release,app-restart,app-activation}_test.ts`: test 이름과 주석의 "App Engineer"만 "앱 place session"(또는 "앱 place의 lophn")으로 바꾼다. `aeTurn`·`aeToolResult` 같은 support 이름과 code는 건드리지 않는다.
9. `tests/live/suite.ts`: wave 2(place-tools, place-scope, agent-places-rename)가 tool 목록 함수(`placeToolNames("project")`), prompt 층 이름(`place_kind`), import 경로를 이미 바꿨다. 남은 role 말(예 "실제 role(project_manager)의 tool 묶음이다" → "project place 종류의 tool 묶음이다")만 고친다. live test는 진짜 provider를 부르니 돌리지 않는다(type check만).

## 정한 것

- operator_test의 할당 경계 행 넷을 `app-call_test.ts`로 옮긴다. 이유: README는 operator_test를 role 주제로 지우라고 했지만 이 행들이 보는 것(뺀 tool이 실행되지 않음, 할당 없는 agent에 앱 tool이 없음, session 도중 할당이 바뀌어도 목록이 그대로이고 notice에 앱 글이 없음, 받는 domain의 비공개 tool)은 role이 아니라 할당과 domain의 권한 경계이고 다른 e2e가 보지 않는다(write-test "지우는 test가 지키던 권한 경계 검사까지 같이 없애지 않는다"). `app-call_test.ts`는 이미 `approvals`(할당이 agent의 앱 호출을 연다)를 contract로 갖고 같은 core·앱을 쓰므로 core 기동과 앱 activation 하나가 준다. 새 flow가 아니다.
- 앱 tool을 부르는 agent는 lophn이 아니라 test가 만든 agent다. 이유: 할당이 test의 준비이고, lophn에 할당을 주면 같은 core의 다른 행(앱 place lophn session의 release turn)의 tool 목록까지 바뀐다.

## 끝남

- `npm run check`가 통과한다(`tests/e2e`, `tests/live`는 type check에 든다).
- 고친 e2e가 돈다: `npm run e2e:deps`를 한 번 돌린 뒤
  `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test --test-concurrency=1 tests/e2e/{app-call,app-data-rewind,secret,oauth,file-write,shell-rule,gateway,app-release,app-restart,app-activation}_test.ts`
  가 통과한다. 이 task가 e2e의 마지막이므로 끝으로 전체 `npm run e2e`(`land.sh`가 도는 것과 같은 명령, 예산 10분)가 통과한다. 떨어지면 단정을 풀거나 기다림을 넣어 맞추지 않는다. core 쪽 bug로 보이면 고치지 말고 "알려진 미완 동작"에 재현 명령과 함께 적는다.
- 위험 test: 새로 쓰지 않는다. 옮긴 `app-call_test.ts`의 `removed-tool`·`no-assignment`·`assignment-added`·`domain-narrowed` 행과 그대로 둔 `file-write_test.ts` 세 test(place 폴더 밖·data root·자기 정의 file에 쓰지 못한다)가 통과한다.
- 남지 않음(아래 `<files>`는 `tests/e2e/{app-call,app-data-rewind,secret,oauth,file-write,shell-rule,gateway,app-release,app-restart,app-activation}_test.ts tests/live/suite.ts`):
  - `grep -rn 'project_manager\|app_engineer\|Project Manager\|App Engineer\|Operator\|operator\|role: "lophn"\|agentSessionRead\|agentAssignment\|builtinToolNames\|openSession(' <files>`가 0줄이다.
  - `grep -rnw 'PM\|AE' <files>`가 0줄이다.
  - `grep -n 'role' tests/live/suite.ts`는 model 메시지의 `role: "user"`·`"assistant"` 줄만 낸다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
