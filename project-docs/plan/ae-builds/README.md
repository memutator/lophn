# ae-builds: App Engineer가 앱을 직접 짓고, ticket과 test runner를 지운다

- **목표:** App Engineer가 사람의 말에서 앱을 설계하고, 직접 짓고, release를 준비하고, preview에서 확인한 뒤 `release.activate`로 올린다. coding agent, ticket, claim, examples, 검증 기록, test runner 없이 한 바퀴가 돈다.
- **재료:**
  - roadmap `project-docs/products/roadmap/problem-ticket.md` 전체. "지우는 것" 표, "정한 것(사람)", "정한 것(agent)", "App Engineer 혼자 코딩한 실험", "단계"의 `ae-builds`가 근거다.
  - roadmap `agent-definition.md`("instruction은 한 번만 말한다"의 App Engineer 지침, "tool", "단계"의 `ae-builds`), `approval.md`(activation 동의, "시킨 것이 승낙이다"), `app-preview.md`(preview의 지금 모양)
  - 이슈: `project-docs/issues/agent-definition.md`의 "Anthropic 요청이 대화에 cache 표시를 달지 않아…", `coding-agent.md`의 "example을 고친 reported ticket을 다시 넘기면…", "`app.link_source`가 없는 폴더를 받아…", "지운 배포 skill의 얇은 사본이 사람 home에 남는다"
  - architecture: `activation.md`, `app-call.md`, `coding-agent.md`, `agent-call.md`, `agent-definition.md`, `domain.md`, `event.md`, `testing.md`
  - `project-docs/boundary-catalog.yaml`과 `project-docs/module-catalog.yaml`의 apps(`app-tickets`, `app-releases`), problems, coding-agent, router
- **범위 밖:**
  - coding agent 연결 장치(PTY launch, hook, 도는 중 메시지, harness 물음, 설치, coding token과 CLI의 ticket 밖 명령). 크기는 보류다(roadmap "정할 것" 1).
  - Reactor 자체(`reactor-remove`). 이 계획은 reaction을 하나도 남기지 않을 뿐 Reactor와 cursor는 둔다.
  - instruction, skill, command의 정리(`agent-definition`). 이 계획은 App Engineer 지침과 ticket에 걸린 지침 줄만 고친다.
  - preview annotation과 preview를 사람에게 보이는 길(`app-preview.md`)
  - eval과 e2e test(사람)
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `ab-`로 시작한다.
- **시작 조건:** `approval-simplify`가 land했다(main `dd956b49f`, 2026-10-21). activation 동의, 앱 호출 판정, 대기 목록 file이 겹쳐서 그 뒤에 연다.
- **brief의 기준:** brief는 main `dd956b49f` 기준으로 썼다.

## 정한 것

roadmap `problem-ticket.md`의 "정한 것(사람)"과 "정한 것(agent)"을 그대로 따른다. 아래는 이 계획에서 더 정한 것이다(agent, 2026-10-21. 사람이 맡긴 낮은 수준의 선택).

- **먼저 App Engineer가 코딩하는 데 걸리는 것을 고친다**(roadmap "실험").
  - turn 한도: 제품 기본 `model_attempts`를 30에서 150으로 올린다. role마다 다른 한도는 두지 않는다. 근거: 실험에서 앱 하나에 model call 85번이 들었다. `active_ms`(30분)와 `stall_ms`는 그대로라 오래 도는 turn은 거기서 멈춘다.
  - 대화 cache: Anthropic 요청의 마지막 message 마지막 content block에 cache 표시를 단다(이슈의 추천).
  - 입력 없는 tool은 입력 없음, `null`, `{}`를 모두 받는다.
  - shell에서 앱 test를 돌릴 수 있게 lophn이 쓰는 `deno`가 있는 폴더를 `shell.run`의 PATH에 넣는다.
- **App Engineer의 새 tool**
  - preview: `preview.start`, `preview.call`(preview에 뜬 앱의 tool 부르기), `preview.stop`. preview의 모양(fixture data, net과 secret 대역, 앱마다 하나)은 그대로다. 여는 쪽에 App Engineer를 더한다.
  - release: `release.prepare`(앱 source의 지금 commit으로 bundle을 만들고 data 검사까지 한 번에 끝낸다)와 `release.activate`.
- **release 준비는 한 단계다.** 준비와 마무리를 합친다. 검사는 그 자리에서 한다: 의존성은 manifest로, migration은 activation과 같은 `migrateAppDatabase`를 fixture DB에 걸어서, blueprint와 handler 일치는 preview launcher로 봉인된 bundle을 띄워 tool 선언을 대조해서 본다. 떨어지면 준비가 실패로 돌아가고 release는 `prepared`가 되지 않는다.
- **공개 tool 막기는 준비 결과의 알림이다.** 다른 domain이 쓰는 공개 tool을 지우는 release면 준비 결과에 그 tool과 쓰는 쪽을 싣는다. 막지 않는다.
- **`release.activate`의 결과**
  - activation이 끝나면 그 결과(active, 실패와 이유)를 돌려준다.
  - 사람의 activation 동의가 필요하면(`approval-simplify`의 activation 동의 대기) 기다리지 않고 "동의 대기"로 돌려준다. 동의 뒤의 결과는 사람이 화면에서 본다. program이 App Engineer를 다시 부르지 않는다(roadmap "program이 agent를 부르지 않는다").
  - 그래서 `ReleaseActivationFailed` reaction과 reaction 설정(grant 종류 `reaction`, Settings › Reactions)을 지운다.
- **App Engineer가 coding agent에게 맡기는 흐름을 막는다.**
  - call의 받는 곳이 role `coding_agent`로 풀리면 Router가 `invalid_input`으로 거절하고 call 행을 쓰지 않는다. 권한 문제가 아니다.
  - 지침과 tool 설명에서 coding agent에게 맡기기를 지운다.
  - ticket에만 쓰이던 CLI 명령, event, coding agent skill `lophn-build-app`을 지운다. 사람 home에 남는 얇은 사본 이슈는 `lophn-build-app`까지 같이 다룬다.
  - 사람이 터미널 탭에서 자기 coding agent를 쓰는 길(PRODUCT 6절)과 연결 장치는 그대로다.
  - 연결 장치는 `packages/core/apps/tickets/coding/`에서 `packages/core/apps/coding/`으로 옮긴다. apps boundary 안이라 catalog와 check-deps를 고치지 않는다.
  - 연결 장치는 ticket을 모른다. coding launch는 ticket 대신 call 본문을 첫 prompt로 받는다(coding 표의 `ticket` 칸은 `prompt`).
  - ticket에 묶인 끝 셋(완료 보고, claim 만료, 보고 없는 끝)은 하나가 된다(roadmap "coding session 끝은 하나다"). **새 event를 두지 않고 그 command가 같은 tx에서 맡긴 call을 `done`으로 닫는다.** 맡긴 App Engineer에게는 마지막 메시지와 함께 한 번 알린다. 근거: `coding/close-call.ts`에 event 없이 닫는 길이 이미 있고, event를 새로 만들면 `reactor-remove`가 바로 지운다. 성공인지는 program이 판정하지 않으니 `done`이다.
  - Router가 `coding_agent`를 받지 않으므로 launch와 메시지 길은 부르는 곳이 없어진다. 연결의 크기가 정해질 때까지 그대로 둔다(사람의 보류).
- **source 폴더 만들기를 `app.create`로 옮긴다.** 근거: roadmap. 첫 넘기기가 없어진다. `app.connect_source`는 받은 폴더가 commit이 있는 git 저장소인지 본다(이슈 "`app.link_source`가 없는 폴더를 받아…"의 고침).
- **App Engineer 지침을 다시 쓴다.** 흐름은 설계(재사용 → 모델 → journey → 화면 → tool) → 코드 → 앱 test(shell) → `release.prepare` → preview에서 확인 → `release.activate`다. "짓기 전에 설계한다"를 둔다. 설계는 앱 source에 file로 둔다. 목표는 지금의 반 정도다. lophn과 PM 지침의 ticket 줄도 지운다.
- **화면:** coding 터미널 탭 제목과 toast의 ticket, 대화의 근거 chip의 ticket 갈래, Settings › Reactions를 지운다(앱 상세에 따로 ticket 화면은 없다). `ui-design` skill로 gallery부터 고친다. 문구는 `wording` skill이다.
- **옛 표, event, route, schema step은 migration 없이 고치거나 지운다**(AGENTS.md "호환성").

### 뼈대 검토에서 정한 것 (agent, 2026-10-21)

- **`release.prepare`의 검사 실패는 오류 code가 아니라 결과 `{status: "failed", stage, reason}`이다.** model은 오류 code마다 정해진 글만 받아서, 오류로 돌려주면 이유가 가려진다.
- **`release.activate`는 core memory route이고 activation이 끝날 때까지 기다린다.** 기다림에는 상한을 둔다. 넘으면 `running`을 돌려주고 App Engineer는 `app.status`로 본다. 지금 machine의 commit command는 `release.record`로 이름을 바꾼다.
- **`release.prepare`의 handler 검사는 preview service로 봉인된 bundle을 띄운다.** 앱마다 preview가 하나라 그 앱의 지금 preview를 바꾼다. App Engineer는 준비 뒤에 preview를 다시 띄워 확인하므로 받아들인다.
- **`previews.start`의 입력 `fixture_hash`는 `fixture`(bundle 안 path)가 된다.** agent가 fixture를 이름으로 고른다.
- **CLI는 ticket 명령과 함께 `app test*`, `release prepare/status`, `guide`를 지운다.** 받는 route나 skill이 없어진다. `harness install`의 출력 꼴은 그대로라 Settings › Coding agents 화면은 고치지 않는다.
- **지우기가 끌고 오는 것도 지운다:** `package.publish`의 `tests`, blueprint read의 `evidence.test`, `writesTestResult`, check-deps의 `problems` 줄.
- **`packages/core/problems/`는 통째로 지운다.** `packages/protocol/problems/`에는 SDK와 앱 log가 쓰는 file(`sdk-report`, `sdk-problem`, `exception-observation`)만 남는다.
- **입력 없는 tool의 너그러움은 agent 쪽(`parseToolArgs`, adapter의 JSON 검사)과 앱 tool의 `validateInput` 둘 다에 둔다.** 실험에서 걸린 곳이 앱 tool 입력 검사였고, App Engineer가 이제 그 코드를 직접 부른다.
- **`<lophn-reaction>` 설명 줄을 `PRODUCT_INSTRUCTIONS`에서 지운다.** Router가 `coding_agent`를 받지 않으니 lophn agent가 reaction을 받을 길이 없다. 코드 길은 연결 장치와 함께 그대로 둔다.
- **source 폴더를 만들 때 repo-local git 설정(`user.name`, `user.email`, `commit.gpgsign=false`)을 쓴다.** App Engineer가 `shell.run`으로 commit해야 `release.prepare`가 HEAD로 짓는다. 사람에게 전역 git 설정이 없어도 commit이 된다.
- **앱 source 폴더의 `AGENTS.md`는 누가 고치든 맞는 말만 둔다.** 이제 App Engineer가 읽는다. "App Engineer에게 `message send`로 물어라"를 지운다.
- **domain event 목록을 비우지 않는다.** ticket event와 `VerificationRecorded`를 지우면 `DOMAIN_EVENTS`가 비어 Reactor와 그 test가 compile되지 않는다. `ab-ticket-delete`가 `CodingSessionEndedUnreported`를 정의만 있는 `CodingSessionEnded`(`{app}`, subject `ses`)로 바꿔 남긴다. 내는 곳도 받는 곳도 없고, `reactor-remove`가 Reactor와 함께 지운다. 근거: Reactor 지우기를 이 계획으로 당겨도 마지막 event를 지우는 merge와 Reactor를 지우는 merge 사이가 비어 같은 자리표가 필요하다.
- **wave 2에서 공개 tool 막기를 지우고 wave 3에서 알림이 온다.** plan branch 안의 틈이라 괜찮다. 다 merge한 뒤 한 번에 land한다.

## 사람이 정할 것

- 없음. coding agent 연결의 크기(roadmap "정할 것" 1)는 보류이고 이 계획은 연결 장치를 건드리지 않는다.

## 순서

- wave와 선행은 tasks의 brief가 정한다.
- App Engineer가 코딩하는 데 걸리는 것(turn 한도, cache, 입력 없는 tool, shell PATH)을 먼저 한다. 그 뒤 새 tool과 release 길을 더하고, ticket·examples·test runner를 지우고, 지침과 화면을 맞춘다.

## lead가 할 일

- merge할 때마다 바뀐 곳의 test를 돌린다. e2e와 eval은 돌리지 않는다(사람).
- land는 `LOPHN_LAND_SKIP_E2E=1 land.sh ae-builds`다. 사람이 lead session에 "e2e를 건너뛰고 land해도 된다"고 직접 말해야 한다(orchestrate skill).
- `ab-release-prepare`는 file 약 25개로 크다. 한 session에 안 끝나면 brief의 나눔 안(prepare child의 검사, supervisor의 실패 이유 전달, preview 검사를 wave 4 task로)대로 쪼갠다.
- worker는 `project-docs`를 고치지 못한다. brief에 "lead가 이 task branch에서 merge 전에 고친다"고 적힌 문서 줄(`ab-coding-move`, `ab-cli`, `ab-source`, `ab-runner-delete`)은 lead가 그 merge에서 고친다. 지운 path를 가리키는 문서 줄은 docs check가 떨어뜨린다.
- 조립 목록 등록은 brief의 "등록할 것"을 따른다: `assembly.ts`(tickets, coding path, problems, wiring), `protocol/mod.ts`(problems ROUTES), `protocol/coding-agent/mod.ts`(`CODING_SKILL_NAMES`).
- 다 끝나면
  - 문서: `architecture/coding-agent.md`, `activation.md`, `testing.md`, `event.md`, `domain.md`(공개 tool 막기), `app-call.md`(preview를 부르는 쪽), `layers.md`(problems → apps feature 의존이 없어진다), `agent-definition.md`(조립 그림에 대화의 cache 경계), `annotation.md`(ticket 근거 ref)
  - `project-docs/products/AGENT-ROLE.md`: P6, P8, L4, A1~A16, K1~K5, T20, 5절 그림, 6절
  - `project-docs/boundary-catalog.yaml`(`app-tickets`, `problems`의 test runner 몫), `project-docs/module-catalog.yaml`. `packages/core/problems` 줄은 `ab-runner-delete`와 같은 merge에서 지운다. 늦으면 `check-modules`가 없는 path로 떨어진다.
  - `project-docs/PRODUCT.md` 6절의 MVP 목록("ticket")
  - roadmap `problem-ticket.md`와 `agent-definition.md`에서 land된 것을 지운다.
  - 이슈를 닫는다(`issue` skill): 위 "재료"의 이슈 가운데 이 계획이 고친 것
  - test runner를 지우고 남는 죽은 갈래를 이슈 하나로 올린다: 앱 runtime mode `"test"`, data job kind `"test"`, identity flag `test_runner_only`·`test_runner`, shell의 `DBUS_SESSION_BUS_ADDRESS` env 허용, `applyMemoryLimit`, registration의 `workers` 칸(`ab-runner-delete` 보고)
  - 사람에게 알린다: `~/.lophn/settings.json`에 `reactions.release_activation_failed` 줄이 있으면 settings file 전체가 `unknown_key`로 거절되어 모든 설정이 기본값이 된다. 그 줄을 지워야 한다(호환 장치는 두지 않는다).
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- 사람에게 묻는 것: push. 그 밖은 planner에게 묻는다.
