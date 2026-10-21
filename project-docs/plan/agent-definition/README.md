# agent-definition: command는 skill이고, guide는 skill이 되고, 지침은 한 번만 말한다

- **목표:** agent 정의를 instruction, skill, tool, command 넷으로 맞춘다.
  - `/이름 글`로 부르면 skill과 뒤의 글이 함께 사람 메시지로 들어간다.
  - role command와 guide를 내장 skill로 옮기고 `guide.read`를 지운다.
  - 모든 role에 같은 말은 `PRODUCT_INSTRUCTIONS` 한 곳에 둔다.
  - 쓰이지 않는 칸과 갈래, `/recap`을 지우고 skill 찾기를 하나로 합친다.
- **재료:**
  - roadmap `project-docs/products/roadmap/agent-definition.md` 전체. "모양", "정한 것(사람)", "정한 것(agent)", "단계"의 새 계획 `agent-definition`이 근거다.
  - roadmap `approval.md`(Operator 정의의 skip 기본값 칸은 사람만 쓴다. `approval-simplify`가 만든다)
  - architecture: `agent-definition.md`(지침 층, skill, command), `place-session.md`
  - changelog `project-docs/products/change-log/0.6.0.md`의 마지막 항목 "App Engineer가 앱을 직접 짓고, ticket과 test runner를 지운다"(`ae-builds`가 바꾼 App Engineer 지침, role tool 목록, guide 줄. 지운 계획 폴더 `plan/ae-builds/`를 대신한다)
  - `project-docs/boundary-catalog.yaml`과 `project-docs/module-catalog.yaml`의 agent-roles, lophn-agent(agents, extensions, instructions, prompt-assembly, commands)
- **범위 밖:**
  - App Engineer 지침 다시 쓰기와 ticket 줄 지우기(`ae-builds`가 했다. changelog 0.6.0). 이 계획은 그 뒤의 지침(main `15f282fcd`)에서 겹친 말만 걷어 낸다.
  - 정의 칸, 끄기 층, 개인 skill 보관함, profile 그림(roadmap "정한 것": 그대로 둔다)
  - workflow 연락처 절(`workflow`)
  - eval과 e2e test(사람)
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `ad-`로 시작한다.
- **시작 조건:** 열 수 있다. 앞 계획 `ae-builds`는 land했다(main `15f282fcd`). `reactor-remove`와는 순서가 상관없다. 두 계획이 같이 고치는 file이 있다: `packages/core/lophn-agent/run-loop/prepare.ts`(rr-program-from ↔ ad-discovery, ad-fields), `packages/shell/renderer/conversation/{agent-tab-source.ts,agent-tab-fake-source.ts}`, `packages/design/wording/catalog/conversation.ts`와 생성물 `conversation.placeholders.ts`, `tools/wireframes/pages/screens/agent.tsx`(rr-screens ↔ ad-commands). 같이 돌면 `status.py ready`가 소유가 겹치는 task를 함께 띄우지 않고, 뒤에 merge하는 쪽이 줄을 다시 본다.
- **brief의 기준:** brief는 main `15f282fcd`(2026-10-21, `ae-builds` land 뒤) 기준으로 다시 맞췄다. `ae-builds`가 이미 한 일(App Engineer 지침 140줄, lophn·PM의 ticket 줄, `tool-lists.ts`의 ticket tool, guide의 ticket·coding agent 넘기기·공개 tool 막기 줄, `PRODUCT_INSTRUCTIONS`의 `<lophn-reaction>` 줄)은 brief에서 뺐다. 처음 쓴 기준은 `dd956b49f`이고, ae-builds가 고치지 않은 file(`lophn-agent/extensions/`, `register.ts`, `prepare.ts`, `product-driver.ts`, `agent-values.ts`, `lophn-agent/commands/`, protocol `commands.ts`, `agent-roles/commands.ts`, `skill-settings.ts`)의 줄은 그대로다.

## 정한 것

roadmap `agent-definition.md`의 "정한 것(사람)"과 "정한 것(agent)"을 그대로 따른다. 아래는 이 계획에서 더 정한 것이다(agent, 2026-10-21).

- **`/이름 글`의 사람 메시지 꼴은 하나다.** skill command는 지금 글(`Use the "{skill}" skill for this request.`) 뒤에 빈 줄 하나를 두고 사람이 친 글을 잇는다. 글이 없으면 지금과 같다. role command가 skill로 옮겨 가므로 갈래는 skill 하나다.
- **guide 10편은 내장 skill이 된다.** 이름은 `guide-<지금 guide 이름>`이다. `roles-and-grants`만 `guide-roles-and-assignments`다(제목이 이미 그렇다). guide에는 설명 칸이 없으니 제목과 첫 문단에서 한 줄을 쓴다. role을 적는다(지금 `kinds-yaml`처럼). lophn 사용법은 lophn에게만, `domains`는 lophn·PM·App Engineer에게, artifact 쓰는 법은 PM·App Engineer·Operator에게 간다. 근거: roadmap "guide는 skill이 된다". 이름 앞의 `guide-`는 skill이 곧 `/` 명령이라 `/rewind`가 rewind를 하는 것처럼 읽히지 않게 하려는 것이다.
- **role command `new-app`, `repair-app`(lophn), `check-kinds`(PM)는 같은 이름의 내장 skill이 된다.** `repair-app`에서 lophn은 고치지 않는다. 앱 상태, log, invocation을 읽어 사람에게 알리고 고치기는 그 앱의 App Engineer에게 call한다.
- **내장 guide skill(`guide-*`)과 `kinds-yaml`은 `/` 메뉴에 띄우지 않는다.** model이 읽는 안내이고 사람은 말로 묻는다. `BUILTIN_SKILLS` 항목에 `menu`(boolean)를 두고, 옛 role command 셋(`new-app`, `repair-app`, `check-kinds`)만 `true`다. 사람이 쓴 skill(전역, domain)은 늘 뜬다. model의 prompt skill 목록은 그대로다. 근거: 띄우면 lophn의 메뉴에 끌 수 없는 `guide-*` 아홉 줄이 생긴다.
- **내장 skill은 모두 끌 수 없다(`can_disable: false`).** 정의 편집 화면이 이미 그렇게 그린다(`workspace/agents/views.ts`). 사람의 skill이 내장과 이름이 같으면 내장이 이긴다.
- **`BUILTIN_SKILLS`의 `description` 칸을 지운다.** 읽는 곳이 없고 설명은 SKILL.md frontmatter에만 둔다.
- **`PRODUCT_INSTRUCTIONS`로 옮길 말은 role 지침 넷에 같은 뜻으로 두 번 이상 있는 문단이다**("Calls", "앱과 data 규칙", "결정은 하나씩", artifact 한 줄). 한 role에만 있는 말은 그 role에 둔다.
- **domain 폴더 설명과 kind 다루기는 PM과 App Engineer 지침에서 빼고 내장 skill로 둔다**(`kinds-yaml`과 domain guide에서 온 skill).
- **지우는 칸과 갈래**: 기본 schema의 `safe_tools`와 `permissions`, command의 `tool` 갈래, `skill_origin`, `while_running`, `/recap`. 읽는 곳을 함께 지운다.
- **skill 찾기는 동기 구현 하나(`extensions/skills.ts`의 `discoverSkills`)로 합치고 `skills-sync.ts`를 지운다.** 근거: core의 read handler(`ReadSkills`, `ListCommands`, agents read)는 동기라 비동기를 부를 수 없고, agent runtime의 turn 준비는 동기도 부를 수 있다. 비동기에만 있던 `content_hash`(읽는 곳 없음)와 붙인 `.md`의 실행 검사는 지운다.
- **내장 skill의 role 거르기를 찾기 안으로 옮긴다.** 지금 turn prompt 목록과 agents read의 skill 수는 `role: null`로 읽어서, `kinds-yaml`이 lophn과 Operator의 prompt에 뜨지만 `skill.read`는 `not_found`를 낸다. 내장이 13개로 늘면 더 커지는 bug라 같이 고친다.
- **`/` 메뉴 항목은 `{name, title, description, source: builtin | skill}`이다.** `action`과 `ListCommands.notices`는 읽는 화면이 없어 지운다. 메뉴는 Commands와 Skills 두 묶음이다.
- **정의 편집 화면은 고치지 않는다.** 칸과 배치가 그대로이고, 보이는 내장 skill 줄만 바뀐다.
- **화면:** `/` 메뉴와 정의 편집 화면이 바뀌면 `ui-design` skill로 gallery부터 고친다. 문구는 `wording` skill이다.
- **지운 skill `lophn-build-app`이 맡던 화면 kit과 token 안내를 앱 template의 `AGENTS.md`(lophn-managed 절)에 되살린다.** ae-builds 뒤 그 말이 어디에도 없어 App Engineer가 지은 앱이 사람이 고른 accent·배경·글꼴을 따르지 않을 수 있다. App Engineer 지침은 짓기 전에 그 file을 읽게 한다. 지침을 다루는 `ad-instructions`가 함께 한다.
- **위험 test는 roadmap대로 둘이다.** skill에 role을 적으면 다른 role의 prompt와 `/` 메뉴에 뜨지 않는다. Operator 정의의 skip 기본값 칸은 PM과 App Engineer의 tool로 쓸 수 없다(이미 `approval-simplify`의 test가 보면 더하지 않는다).

## 사람이 정할 것

- 없음.

## 순서

- wave와 선행은 tasks의 brief가 정한다.

## lead가 할 일

- merge할 때마다 바뀐 곳의 test를 돌린다. e2e와 eval은 돌리지 않는다(사람).
- land는 `LOPHN_LAND_SKIP_E2E=1 land.sh agent-definition`이다. 사람이 lead session에 "e2e를 건너뛰고 land해도 된다"고 직접 말해야 한다(orchestrate skill).
- 다 끝나면
  - 문서: `architecture/agent-definition.md`(guide, skill, command, 지침 층), `layers.md`(role command, guide tool), `artifact.md`(내장 artifact guide의 path), `eval.md`(`guide.read`), `appearance.md` "사용자 앱에 닿는 길"(앱 template의 `AGENTS.md`가 token 변수를 시킨다)
  - `project-docs/module-catalog.yaml`의 agent-roles 설명("role prompt·guide", "role 명령")
  - eval은 `guideText`·`guideTopics` import와 L6의 `guide.read` 기대 때문에 깨진다. check 밖이고 사람이 고친다.
  - `project-docs/products/AGENT-ROLE.md`(L6의 "제품 안내", L7)
  - roadmap `agent-definition.md`를 지운다(다 land했으면).
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- 사람에게 묻는 것: push. 그 밖은 planner에게 묻는다.
