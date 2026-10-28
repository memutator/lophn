# remove-role: role을 없애고 place를 session으로 옮긴다

- **목표:** agent를 lophn과 사람이 만든 agent 둘로 줄인다. agent 정의는 전역에 둔다. session이 place(없음·project·app)를 갖고, tool·지침·skill·file 범위는 session의 place 종류가 정한다. 쓰이지 않는 coding session 층을 지운다.
- **재료:**
  - roadmap `project-docs/products/roadmap/remove-role.md`: 왜, 지금 코드(path:줄과 개수), 무엇을 만드나, 사람이 정한 것
  - architecture: `agent-definition.md`, `place-session.md`, `domain.md`, `agent-call.md`, `annotation.md`, `workflow.md`, `job.md`, `run.md`, `approval.md`, `activation.md`, `artifact.md`, `layers.md`, `coding-agent.md`, `terminal-agent.md`, `testing.md`
  - 제품: `project-docs/PRODUCT.md` 3·6절, `project-docs/products/AGENT-ROLE.md`
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`, `project-docs/context-component-registry.yaml`
- **범위 밖:**
  - agent 정의의 권한 칸
  - 터미널 agent 층(hook, 감지, 설치, 탭 icon·점·알림)
  - eval 돌리기
  - 새 e2e: 필요하면 lead가 사람에게 묻는다
  - migration과 옛 이름 읽기
- **돌리는 방식:** orchestrate skill대로 한다. worker는 `sonnet-high`다. 계약(protocol의 agent 주소, session 정체, 정의 꼴)을 먼저 고정해야 해서 brief를 쓴다.
- **단위와 순서:** brief 뼈대가 정한다(`tasks/`, `status.md`). 큰 줄기는 이렇다.
  - wave 1: 계약을 정한다. 새 꼴은 옛 꼴 옆에 더한다. coding session 층을 지운다.
  - wave 2: core 영역별로 구현한다(정의와 session, place 종류 표, 주소와 Router, workflow·flow, job·run, apps). wireframe도 이 wave다.
  - wave 3: shell renderer, CLI, eval scenario, test를 정리한다.
  - wave 4: 옛 계약과 남은 이름을 지운다.

## 정한 것

사람(2026-10-28): roadmap "정한 것 (사람)" 다섯 줄.

agent(planner, 2026-10-28). 근거는 줄마다 적는다. "속도"는 AGENTS.md "속도", 곧 가장 단순한 구현을 말한다.

### agent와 정의

- **정의 꼴은 하나다.** 지금 Operator 꼴(name, profile, model, skills, domains, mcp_servers, mcp_off, skip, 본문)을 그대로 쓴다.
  - 자리는 `<data>/agents/<id>.md`(올린 avatar는 그 옆)다. lophn은 `<data>/agents/lophn.md` 그대로다.
  - 근거: 정의가 전역이 되면 built-in 꼴과 Operator 꼴을 가를 이유가 없다(속도).
- **lophn은 고정 id를 가진 내장 정의다.**
  - 이름과 profile은 바꾸지 못하고, 지우지 못한다(`forbidden`). 나머지 칸은 다른 agent와 같다.
  - `AgentRef`는 agent id 하나다. 근거: role union이 없어지면 lophn만 갈라 둘 이유가 id 하나로 충분하다(속도).
- **agent 이름은 전역에 하나이고 `lophn`은 예약이다.** 근거: 주소가 이름이라 겹치면 받는 agent가 하나로 정해지지 않는다.
- **등록할 때 agent를 만들지 않는다.** `projectManagerProvisioningPort`, `withAppEngineer`, `ensureLophn` 밖의 built-in 생성을 지운다. 근거: 사람 결정(roadmap).
- **`operator.create`·`operator.update`는 `agent.create`·`agent.update`가 된다.**
  - 세 place 종류 목록에 모두 든다. 근거: 정의가 전역이라 어느 place에서 만들어도 같다.
  - `operatorPlaceAllowed`는 지운다. 근거: 정의가 place에 속하지 않으니 검사할 그릇이 없다.
  - 할당, 정의 층 MCP server, skip은 여전히 사람만 정한다. 근거: `agent-definition.md` "Operator 정의를 만들고 고치는 tool은 할당을 주지 못한다"는 그대로 지킨다.

### session과 place 종류

- **session의 정체는 (agent id, place)다.** place는 null(home), project, app이고 열 때 정해 바꾸지 않는다.
  - 근거: `place-session.md`의 "role과 place는 session을 열 때 정해지고 바뀌지 않는다"에서 role이 agent로 바뀔 뿐이다.
- **place 종류별 지침은 지금 role 지침에서 시작한다.**
  - home은 lophn 지침, project는 PM 지침, app은 AE 지침에서 role 말과 넘기기 규칙을 지운다.
  - Operator 지침에서 남길 말은 project와 app에 합친다. 정의 본문은 지금처럼 agent 층으로 이어 붙인다.
  - 근거: 짓기 절차를 app 지침에 그대로 두면 짓기 품질이 지금과 같다. skill로 빼면 읽지 않고 짓는 위험이 생긴다.
- **tool 목록 셋은 지금 role 목록에서 나온다.**
  - home은 lophn 목록, project는 PM 목록, app은 AE 목록에서 시작한다. 셋 모두에 job tool 넷과 `agent.create`·`agent.update`가 든다.
  - preview 호출 검사(`apps/calls/caller.ts:106`)는 app place session인지 본다.
  - 근거: 지금 role이 그 place 종류에서 하던 일을 그대로 받는다. Operator 목록은 그 부분집합이었다.
- **내장 skill은 place 종류로 준다.**
  - lophn 것은 home에 준다.
  - `guide-domains`는 셋 모두에 준다.
  - `guide-artifact`와 `kinds-yaml`은 project와 app에 준다.
  - `guide-workflows`와 `check-kinds`는 project에 준다.
  - `design-app`은 app에 준다.
  - 근거: 지금 role 배정을 place 종류로 옮긴 것이다.
- **credential 상한은 place 종류 목록의 route 합이다.** 조건은 지금처럼 session place에서 나온다.
- **file 범위는 place 종류로 정한다.**
  - home은 지금 lophn과 같다.
  - project는 지금 PM 범위에서 domain 폴더만 받은 domain의 것으로 좁힌다. app은 지금 AE 범위에서 같은 방법으로 좁힌다.
  - rewind의 쓰기 폴더는 지금처럼 그릇의 domain 폴더 전부로 넉넉히 잡는다.
  - 근거: `domain.md`의 "prompt·tool·file 범위의 단위는 맡은 domain이다".
- **받는 domain:** `domains`가 비면 place 그릇의 active domain 전부를 받는다. 있으면 그 가운데 place 그릇에 있는 것만 받고, 0개일 수 있다. home은 0개다.
  - 근거: 정의가 전역이라 "고르지 않음"과 "여기엔 해당 없음"을 갈라야 한다.
- **module `packages/core/agent-roles`는 `packages/core/agent-places`로 이름을 바꾼다.**
  - `AgentRoleTable`과 `ROLE_TABLE`도 role 낱말을 뺀 이름으로 바꾼다.
  - 근거: 남은 축이 place 종류뿐이다. 옛 이름이 남으면 뒤에 헷갈린다(AGENTS.md "호환성").

### 주소와 넘기기

- **call의 `to`는 `{session}`이나 `{agent, place?}`(+ `fallback`)다.**
  - `agent`는 이름이고, place가 없으면 home이다.
  - 주소용 `coding_agent`는 지운다.
  - 근거: 5.2 표의 "고르는 방법"이 agent 이름과 place 하나로 줄어든다.
- **domain 일을 받는 쪽은 주인 그릇 place의 lophn session이다.**
  - 코드에서는 주인 없는 artifact annotation이 여기로 간다.
  - package 문제와 공개 tool 바뀜 알림은 지침이 같은 곳을 말한다.
  - 근거: lophn은 늘 있는 agent라 받을 agent가 없어 실패하는 일이 없다.
- **앱 화면 annotation은 앱 title bar agent select가 고른 agent의, 그 앱 place session으로 간다.** 근거: 앱마다 정해진 AE가 없으니 사람이 보고 있는 agent가 받는 것이 맞다.
- **workflow 참가자는 `{agent, place?}`, `human`(`with`), `harness`다.**
  - `harness`는 지금처럼 선언만 받고 넘기지 못한다. place가 없으면 instance의 project다.
  - `packages/sdk/flow/wire.ts`의 사본도 같이 고친다.
  - `workflows/`는 그 project place의 session이 쓴다. `workflow.check`는 project 목록에 든다.
- **flow의 앱 tool 호출:** `workflow.yaml`의 `agent` 칸(없으면 lophn)이 가리키는 agent의 할당과, 그 agent가 그 project에서 받는 domain으로 거른다.
  - 근거: 지금 박혀 있는 PM 자리를 실제 agent로 바꾼다. 기본값이 lophn이면 칸을 안 써도 지금처럼 돈다.
- **job을 만든 쪽은 (agent, place)다.**
  - agent는 같은 agent, 같은 place가 만든 job만 다룬다. 사람은 모두 다룬다.
  - `runs.agent_key`도 같은 쌍으로 만든다.
  - 근거: 지금 "role + 그릇"과 같은 뜻이다.
- **CLI `lophn run`은 agent 이름과 place(`--project`, `--app`)를 받는다.** `pm:`, `ae:`, `operator:`는 지운다.

### 화면

- **Agents 탭은 전역 목록이다.** lophn과 사람이 만든 agent가 들어 있고, 편집 화면은 하나다. lophn은 이름과 profile 칸이 잠기고 지우기가 없다.
- **project 창 sidebar와 앱 agent select는 모든 agent를 보인다.** 고르면 그 place의 session을 연다.
  - 근거: 가장 단순하다(속도). agent가 많아져 불편하면 그때 줄인다.
- **문구:** "Operator"는 "Agent"가 되고 role label은 지운다. wireframe(`tools/wireframes`)을 먼저 고친다(`ui-design` skill). 문구는 `wording` skill대로 고친다.

### 저장과 test

- **schema:** 다음을 새 꼴로 고친다.
  - `sessions`의 `role`과 `operator` 열(`agent` 열로 바꾼다)
  - `jobs.creator_role`, `jobs.creator_id`
  - `runs.agent_key`
  - `agent_assignments.agent`
  - `agent_calls."to"`, `workflow_instances.participants`
  - `messages.from_kind`의 `coding_agent`
  - coding 표 셋은 지운다. schema step은 고치거나 지우고, 개발 data는 지운다. 근거: AGENTS.md "호환성".
- **test:**
  - role이 주제인 test는 지운다. 예: `tests/e2e/operator_test`, `pm-tools_test`, `core/agent-roles/tools/operator-place_test.ts`.
  - 주제가 남는 test는 주소만 고친다. 새 e2e는 만들지 않는다.
  - 위험 test는 셋이다: place 종류별 file 범위(폴더 밖 쓰기), credential 조건(다른 그릇 release·publish 막기), session 정체 불변. 지금 test가 이미 보면 옮겨 고치기만 한다.
  - 근거: AGENTS.md "속도"의 test 규칙.
- **eval:** `tests/eval/scenarios/<role>/`를 place 종류로 다시 쓴다. registry의 instruction과 `restore/operators.ts`도 같이 고친다. 돌리지는 않는다.

### 문서

worker는 `project-docs`를 고치지 않는다(orchestrate skill).

- **architecture 문서는 lead가 고친다.** 그 동작을 바꾼 task를 합칠 때 같이 고친다.
  - `coding-agent.md`는 coding session 층을 지울 때 지우거나 줄인다.
  - 남는 hook·감지·설치는 `terminal-agent.md`에 있다.
- **제품 문서는 계획이 끝난 뒤 planner가 `wrap-plan`으로 고친다.**
  - `products/AGENT-ROLE.md`는 `products/AGENT.md`로 다시 쓴다. role별 책임이던 것을 place 종류별 책임으로 바꾼다.
  - `PRODUCT.md` 3·6절을 고친다.
  - `context-component-registry.yaml`의 path와 `wrap-plan` skill의 `AGENT-ROLE.md` 언급을 고친다.

### 뼈대 검토 (agent, planner, 2026-10-28)

- **계약은 일부만 옛 꼴 옆에 둔다.**
  - agent 정체, 정의, 할당, session 열기, call 주소는 옛 꼴 옆에 더한다(`contract-agent`, `contract-session`).
  - event, snapshot, run, job, workflow의 꼴은 `contract-session`이 모양만 적는다. 실제 변경은 그것을 소유한 task(`runs-core`, `jobs-core`, `workflows-core`, `shell-events`)가 제자리에서 한다.
  - 근거: 같은 정체나 저장된 JSON이라 옛것과 새것이 같이 있을 수 없다. 모양은 wave 1에 고정되므로 "계약 먼저"는 지켜진다.
- **wave 2가 끝나도 main에 올리지 않는다. wave 2와 3을 함께 올린다.**
  - wave 2의 registry 교체 뒤에는 화면, shell main 알림, e2e, eval, CLI가 wave 3까지 옛 route를 부른다. type check는 통과하지만 `land.sh`의 e2e가 깨진다.
  - `sessions-core`와 `place-tools`는 이어서 합친다. 둘 사이에서는 turn이 돌지 않는다.
- **새 agent 값의 type 이름은 `AgentId`다.** 옛 `AgentRef`와 같이 있다가 wave 4에 `AgentRef`가 사라진다. 위 "`AgentRef`는 agent id 하나다"는 이 type을 말한다.
- **`ROLE_TABLE`·`AgentRoleTable`**: 정의가 전역이 되고도 남는 것이 있으면 role 낱말을 뺀 이름으로 바꾸고, 없으면 지운다(`agents-core`).
- **annotation 받는 쪽**:
  - project 파일에 단 annotation은 그 project place의 lophn session이 받는다. 근거: 위 "domain 일을 받는 쪽"과 같은 규칙이다.
  - flow가 place 없이 agent를 부르면 instance의 project다. workflow 참가자와 같다.
- **이름에서 role 낱말을 뺀다.**
  - 내장 skill `guide-roles-and-assignments`는 `guide-agents-and-assignments`가 된다.
  - prompt 층 이름 `role`·`role_prompt`는 `place_kind`·`place_kind_prompt`가 된다.
  - 근거: 끝남 grep이 role이라는 뜻을 남기지 않는다.
- **`coding_agent` actor 종류와 `cac` id 접두는 죽은 코드다.** wave 4(`cleanup-protocol`)가 지운다.
- **trace와 usage의 role 거르기는 대신할 것 없이 지운다.** 쓰는 곳이 core 안뿐이고, usage 쪽은 이미 "지원 안 함"이었다.
- **eval의 지난 기록은 고치지 않는다.**
  - 대상: `tests/eval/runs/`, scorecard, `tests/eval/experiments/*/{report.md,spec.json}`. 끝남 grep에서 뺀다.
  - commit 안 된 `tests/eval/materials/calendar-app-*`도 건드리지 않는다.
  - 근거: 기록은 그때의 사실이다.
- **coding 갈래 지우기는 lophn이 띄운 coding session에만 쓰이는 것만이다.** 사람이 앱 공간이나 project에서 직접 연 터미널, 그 탭의 hook·감지·알림은 남긴다(`terminal-agent.md`, 사람 2026-10-26).
- **wording catalog**: wave 2는 `wireframe-agents`, wave 4는 `cleanup-shell`이 맡는다. wave 3 화면 task는 catalog에 key를 더하기만 한다(orchestrate review의 예외).

### 살 검토 (agent, planner, 2026-10-28)

- **domain 지도의 할당 기준 사용 관계**: 정의에서 `domains`를 직접 고른 agent의 것만 센다. 실제 호출 기록으로 세는 관계는 그대로다(`place-scope`).
  - 근거: 받는 domain이 session의 place에 따라 달라서, 고르지 않은 agent(lophn 포함)를 할당만으로 세면 모든 domain을 쓰는 것처럼 나온다.
- **place 정보의 agent 목록은 이름만 싣는다.** 열린 session과 place는 싣지 않는다.
  - 근거: `agent-definition.md` "place 정보에는 잘 안 바뀌는 목록만 넣는다". agent 이름은 전역이고 place는 보내는 쪽이 고른다.
- **role 주제 test 안의 권한 경계 검사는 지우지 않고 옮긴다.**
  - `operator_test`의 검사(뺀 tool, 할당 없는 agent, 도중 할당 변경, domain 좁히기, 만들기 tool이 할당·MCP·skip을 못 줌)는 `app-call_test`와 `session_test`로 옮긴다.
  - `pm-tools_test`가 보던 버그(route 상한이 place의 자기 tool을 막음, 두 번 고친 것)도 같이 옮긴다.
  - 근거: `write-test` skill(권한 경계, 두 번 고친 bug).
- **eval의 끝남 grep에서 `tests/eval/registry/`와 `tests/eval/experiments/` 전체를 뺀다.** 지난 run이 참조하는 기록이다.
  - eval scenario의 실제 model은 agent 정의가 아니라 시험하는 session에 붙인다. 정의는 전역이라 call로 열린 다른 session까지 바뀐다.
- **[New app] 대화창은 남긴다.** 사람이 그 창으로 등록하면 그 앱 공간에 lophn session이 새로 열린다. roadmap이 이 길을 없애지 않았다.
- **런처 패널은 이번 계획에서 lophn 전용으로 남긴다.** 사람이 만든 agent의 home session이 lophn 얼굴로 보이는 것은 알려진 미완으로 받아 이슈로 올린다.
- **CLI `--session`은 `--agent`·`--project`·`--app`과 같이 쓰지 못한다.** session의 agent와 place는 열 때 정해진다.
- **뼈대 고친 것**: 살 단계가 "소유 줄 밖"으로 적은 file은 각 brief의 `- 추가 소유` 줄로 옮겼다. 선행은 셋을 더했다(`runs-core` ← `place-tools`, `jobs-core` ← `wireframe-sidebar`, `shell-desktop` ← `shell-workspace`). 같은 wave의 순서 없는 소유 겹침은 0이다. wave 2·3의 임시 다리와 옛 이름은 wave 4 brief 셋에 목록으로 넣었다.

## 사람이 정할 것

없다. 새 e2e가 필요하다고 판단되면 lead가 묻는다.

## lead가 할 일

- 합칠 때마다: `npm run check:full`, 그 task가 바꾼 동작의 architecture 문서. wave 1과 wave 4가 끝나면 `grep -rn "project_manager\|app_engineer\|Project Manager\|App Engineer" packages tools tests`로 남은 곳을 본다(eval의 지난 기록은 뺀다). wave 2가 끝나도 land하지 않고 wave 3과 함께 올린다.
- **registry 바꾸기**: 구현 task를 합칠 때 옛 route 상수를 새 상수로 바꿔 넣는다. 각 brief에 바꿀 항목이 적혀 있다. brief에 없어 놓치기 쉬운 것은 둘이다.
  - `agents-core`를 합칠 때: shell main의 schema 표 `packages/shell/main/desktop/core/routes.ts`의 `AGENT_ASSIGNMENT_ROUTES`도 바꾼다. 이 file은 소유 task가 없다.
  - `sessions-core`를 합칠 때: `SESSION_COMMANDS`(`protocol/lophn-agent/sessions.ts`) 안의 `sessionCompactRequests`는 상수 하나를 바꾸는 게 아니라 거르는 곳에서 빼야 한다.
- **`agent-places-rename`은 lead가 task branch에서 `project-docs`의 path를 고친 뒤 합친다.** worker는 `project-docs`를 고치지 않는데, `check-modules`와 `check-docs`가 옛 path를 본다. 고칠 곳은 brief "끝남"에 있다.
  - catalog: `module-catalog.yaml`의 path와 module, `boundary-catalog.yaml`의 boundary ID `agent-roles`를 `agent-places`로 바꾼다.
  - registry: `context-component-registry.yaml`의 `boundaries`와 `change_reasons.paths`.
  - 문서: architecture `kinds.md`, `job.md`, `agent-definition.md`, `place-session.md`, `domain.md`, 이슈 `issues/place-session.md`의 frontmatter와 본문.
- 다 끝나면:
  - changelog 열린 판(`project-docs/products/change-log/0.9.0.md`)에 항목을 덧붙인다. 위 "정한 것"을 결정으로 옮긴다.
  - roadmap `remove-role.md`와 이 계획 폴더를 지운다.
  - `boundary-catalog.yaml`과 `module-catalog.yaml`의 `agent-roles`를 고친다.
