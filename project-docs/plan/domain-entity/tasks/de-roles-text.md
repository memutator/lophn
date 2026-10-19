# de-roles-text

role 지침 글과 lophn의 사용 안내를 새 배분에 맞게 쓴다. App Engineer 지침을 되살리고(앱 일), Project Manager 지침에서 앱 일을 빼고 domain 일(kind 파일, `DOMAIN.md`, skill, artifact)을 넣고, Operator와 lophn 지침이 domain을 안다. 이 글들은 prompt에 들어가므로 영어이고, 개발자 영어 단어(domain, kind, tool, release)를 그대로 쓴다. `app-api`라는 말은 새로 쓰지 않는다(tool이라고 쓴다).

- 단위: roles (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`, `project-docs/architecture/kinds.md`, `project-docs/architecture/artifact.md`, `project-docs/architecture/app-call.md`, `project-docs/architecture/coding-agent.md`, `project-docs/architecture/annotation.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것"(전체), `project-docs/products/roadmap/domain.md`, `project-docs/products/AGENT-ROLE.md`
  - 본보기(글): 지금의 `packages/core/agent-roles/roles/project-manager/prompt.md`(172줄, 앱 일이 들어 있다)와 옛 App Engineer 지침 `git show 71c7bcad7^:packages/core/agent-roles/roles/app-engineer/prompt.md`(107줄). 그 뒤 land한 바뀐 점을 살린다: 말은 tool로, write tool ticket에는 examples를 쓴다("write tool → examples check"), 열린 problem·ticket 읽기, rewind 증명 알림, kind 글.
  - 규칙: `.claude/skills/wording/SKILL.md`는 화면 문구용이라 여기서는 안 쓴다. AGENTS.md "말"(개발자 영어)을 따른다
- 계약:
  - 쓰는 것: `de-roles-core`가 정한 role 목록(tool 이름), `de-place-restore`의 role 이름("App Engineer", "Project Manager", "Operator", "lophn"), `de-turn-domains`·`de-place-info`가 prompt에 싣는 것(지침 층 이름 "Domain instructions (DOMAIN.md)", place 정보의 "Domains" 절)
  - 내놓는 것: `roles/app-engineer/prompt.md`(새 file)와 `prompts.ts`의 `ROLE_PROMPTS`에 `app_engineer`, 새 안내 `roles/lophn/guides/domains.md`와 `guides.ts`의 `GUIDES`에 `domains`

## 할 일

1. `roles/app-engineer/prompt.md`: 옛 지침을 바탕으로 쓴다. 맡는 일: 그 앱의 ticket, blueprint(tool 선언과 `domain`), release, problem 상태, package publish, source 연결, 앱 Operator, 앱 annotation, coding agent에게 맡기기와 메시지 답하기, 그 앱의 domain(kind 파일, `DOMAIN.md`, skill, artifact). "tool을 선언할 때 `domain`은 그 tool이 다루는 객체의 domain이다. 앱을 만들면 앱 이름의 domain이 있다. 다른 domain이 필요하면 `domain.create`로 만든다." 다른 앱·project 일은 맡지 않는다. 다른 domain의 공개 tool을 grant로 받아 쓰는 법(비공개는 보이지 않는다)과 쓰는 쪽이 있는 공개 tool을 바꾸거나 지우면 막힌다는 것을 쓴다.
2. `roles/project-manager/prompt.md`: ticket, blueprint, release, problem, package, source 연결, coding agent, 앱 annotation 항목을 빼고 "What you do"를 project 일로 줄인다: project의 폴더, 그 project의 domain(`domain.create`로 만들기, `DOMAIN.md`·`kinds.yaml`·`skills/`·`artifacts/`는 domain 폴더에 file tool로 쓴다), kind 위반(`KindViolationFound`) 처리(`problem.list`에 `domain`을 주고 `kind.check`), Operator 만들기·고치기(`domains` 고르기). PM prompt에서 "앱 일은 그 앱의 App Engineer에게 맡긴다"를 한 줄 쓴다. "What kinds are" 절을 domain 기준으로 고친다(kind 파일은 domain마다 하나, glob은 그 domain 그릇의 폴더 기준).
3. `roles/operator/prompt.md`: "You work with the domains you were given" 한 절(prompt의 DOMAIN.md와 kind 글이 그 domain의 것이고, 다른 domain의 파일을 읽을 수는 있어도 맡은 것이 아니다. DOMAIN.md와 artifact는 쓸 수 있다). 쓰는 tool 이름의 말을 맞춘다.
4. `roles/lophn/prompt.md`와 `guides/`: lophn의 일에 "새 domain 제안, domain 나누기·합치기 제안, 재사용 판단, package로 빼기"를 쓴다(만들기는 PM·App Engineer가 하고 자르는 결정은 사람이 한다). 앱을 만들 때 project를 고르지 않는다. `roles-and-grants.md`에 App Engineer를 되살리고 grant 규칙(다른 domain은 public tool만)을 쓴다. `features-and-screens.md`·`questions-and-decisions.md`·`skills-and-mcp.md`(skill은 domain 폴더, 고른 domain의 것 가운데서 Operator가 고름)·`artifact.md`(artifact 자리 `domains/<dom>/artifacts/<name>/`, 쓰는 role, 받는 쪽)·`rewind.md`·`instructions.md`(지침 층 전역 → `LOPHN.md` → `DOMAIN.md` → agent)를 맞춘다. 새 안내 `guides/domains.md`: domain이 무엇인지(그릇 project·app 안의 책임 경계), 누가 만드는지, 한 domain은 한 그릇에만 있고 다른 그릇은 공개 tool을 grant로 받아 쓴다는 것, kind와 `DOMAIN.md`와 skill과 tool의 역할을 짧게. `guides.ts`의 `GUIDES`에 `domains`를 더하고 `guide.read`의 topic 목록 설명이 있으면 맞춘다.
5. `prompts.ts`: `ROLE_PROMPTS`에 `app_engineer`를 더하고 `PRODUCT_INSTRUCTIONS`의 "Use the app's app-api for app data"를 "Use the app's tools for app data"로 바꾼다(그 줄 한 곳만. 여덟 tag 목록은 그대로다).
6. 지침 글 안의 "Rules for apps and data" 절이 네 prompt에 반복돼 있으면 한 번만 고치고(예: "app-api" → "tool"), 바뀐 문구가 네 곳에서 같게 한다.
7. 이 task는 코드 동작을 바꾸지 않는다. 글이 가리키는 tool 이름은 `de-roles-core`의 목록, 층 이름은 `de-turn-domains`의 것과 맞는지 읽어 확인한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(글이다)
- 남지 않음: `grep -rn "app-api\|app_api" packages/core/agent-roles/roles`가 0줄이다. `grep -rn "this project's app\|the project's app\|project has one app" packages/core/agent-roles/roles`가 0줄이다. `grep -n "ticket\|blueprint\|release" packages/core/agent-roles/roles/project-manager/prompt.md`에 PM이 하는 일로 쓰인 줄이 없다(App Engineer에게 맡긴다는 줄은 있어도 된다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 새 안내 topic 이름과 내용 범위
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
