# place-prompts

place 종류 셋의 지침 글을 지금 role 지침에서 다시 쓴다: home은 lophn 지침, project는 PM 지침, app은 AE 지침에서 role 말과 넘기기 규칙을 지우고 Operator 지침에서 남길 말을 project·app에 합친다. `PRODUCT_INSTRUCTIONS`, 내장 skill 글, tool 설명의 role 말도 고친다. 짓기 절차는 app 지침에 그대로 둔다.

- 단위: places (wave 2)
- 선행: place-scope. 지침을 place 종류로 고르는 함수가 먼저 있어야 한다.
- 소유(이 task만 고친다):
  - `packages/core/agent-places/roles` (옮겨서 없앤다)
  - `packages/core/agent-places/prompts` (새 자리: home·project·app 지침과 `prompts.ts`)
  - `packages/core/agent-places/skills`
  - `packages/core/agent-places/tools/{kind,instructions,settings,agent}.ts` (tool 설명 글만)
  - `packages/core/apps/agent-tools/app.ts` (`app.create` 설명)
  - `packages/core/domains/agent-tools.ts` (설명과 주석)
  - `packages/protocol/lophn-agent/skill-settings.ts` (이름을 바꾼 guide skill 한 줄)
  - `packages/sdk/declaration/guide.md`
  - `tests/eval/versions/{files,components,versions_test}.ts`, `tests/eval/experiment/gate/gate_test.ts`, `tests/eval/experiment/variant/texts.ts` (넘길 줄: 지침 file 자리)
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/core/main/agent-runtime/product-driver.ts`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "agent와 정의"(lophn 고정, `agent.create`·`agent.update`), "session과 place 종류"(place 종류별 지침, tool 목록 셋, 내장 skill, 받는 domain), "주소와 넘기기"(call의 `to`, domain 일은 주인 그릇 place의 lophn, 앱 annotation, workflow 참가자, flow의 앱 tool 호출), "뼈대 검토"(annotation 받는 쪽, 이름에서 role 낱말 빼기). roadmap `project-docs/products/roadmap/remove-role.md`의 "왜"와 "정한 것 (사람)"(새 앱은 home의 lophn이 등록하고 그 앱 place의 lophn session에 맡긴다). 앞 task brief `tasks/{contract-session,place-tools,place-scope}.md`의 "내놓는 것"(call 주소 꼴, workflow 참가자 꼴, place 종류별 tool 목록, `placePrompt`).
  - 제품: `project-docs/products/AGENT-ROLE.md` 2~5절(규칙 L·O·A·C·W·J·T. 할 일 6번 표가 어디로 가는지 정한다).
  - architecture: `project-docs/architecture/agent-definition.md`의 "모든 role에 같은 말은 제품 고정 규칙(`PRODUCT_INSTRUCTIONS`) 한 곳에 둔다"와 "사용 안내는 내장 skill이다", `project-docs/architecture/domain.md` "지키는 것"(쓰는 쪽, 받는 쪽, 공개 tool, package 주인), `project-docs/architecture/workflow.md`(선언 칸, 참가자 풀기, flow의 앱 tool 호출), `project-docs/architecture/artifact.md`("annotation을 받는 쪽은 그 폴더에 마지막으로 쓴 session이다"), `project-docs/architecture/kinds.md`.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`(이 module, 이름은 lead가 고친다)와 `agent-tool-spi`. `project-docs/module-catalog.yaml`의 `packages/core/agent-roles` 줄 notes(지금 `agent-places`).
  - 코드: `packages/core/agent-places/roles/{lophn,project-manager,app-engineer,operator}/prompt.md`, `roles/prompts.ts`(`placePrompt`, `PRODUCT_INSTRUCTIONS`), `packages/core/agent-places/skills/*/SKILL.md`, `packages/core/agent-places/tool-lists.ts`(`placeToolNames`, place-tools가 만든 종류별 목록), `packages/protocol/lophn-agent/skill-settings.ts`(`BUILTIN_SKILLS`), `packages/core/agent-places/tools/{kind,instructions,settings,agent}.ts`, `packages/core/apps/agent-tools/app.ts`(`app.create`), `packages/core/domains/agent-tools.ts`, `packages/sdk/declaration/guide.md`, `packages/core/lophn-agent/tools/bundles/call.ts`(router-core가 고친 `call` 설명. 지침의 `to` 예가 이것과 같은 꼴이어야 한다), `tests/eval/versions/{files,components,versions_test}.ts`, `tests/eval/experiment/{gate/gate_test,variant/texts}.ts`.
- 계약:
  - 쓰는 것: `place-scope`의 `placePrompt(kind)`. `place-tools`의 place 종류별 tool 목록(지침이 말하는 tool이 그 목록에 있어야 한다).
  - 내놓는 것:
    - 지침 file 자리는 `packages/core/agent-places/prompts/`다(`roles/`는 없다). 지침은 role 이름(lophn을 뺀 Project Manager, App Engineer, Operator)과 role 사이 넘기기를 말하지 않는다. 정의 본문은 지금처럼 agent 층으로 이어 붙는다.
    - 새 앱 흐름 글: home의 lophn이 `app.create`로 등록하고 그 앱 place의 lophn session에 call로 맡긴다(README 사람 결정). domain 일(package 문제, 공개 tool 바뀜 알림)은 주인 그릇 place의 lophn session으로 보낸다.
    - 내장 skill `guide-roles-and-assignments`는 role 낱말을 뺀 이름으로 바꾼다(새 이름은 보고에 적는다). eval scenario가 이 이름을 쓰는 곳은 `eval-scenarios`가 고친다.

## 할 일

지침 글은 model이 읽는 영어다. 아래에 적은 줄만 바꾸고 나머지 줄은 그대로 둔다(줄 번호는 지금 file 기준). 넘기는 곳은 늘 agent 이름과 place로 적는다: `to: {agent: "lophn", place: {app: "<name>"}}`, `{project: "<name>"}`, place가 없으면 home. 같은 그릇의 domain 일, package 문제, 공개 tool 바뀜 알림은 그 그릇 place의 lophn이 받는다(README "domain 일을 받는 쪽은 주인 그릇 place의 lophn session이다"). 글에서 product를 말하는 "lophn"과 agent를 말하는 lophn이 헷갈리면 agent 쪽을 `to` 예나 "the agent lophn"으로 쓴다.

1. **자리 옮기기**(계약 "지침 file 자리는 `packages/core/agent-places/prompts/`다").
   - `git mv`로 `roles/prompts.ts` → `prompts/prompts.ts`, `roles/lophn/prompt.md` → `prompts/home.md`, `roles/project-manager/prompt.md` → `prompts/project.md`, `roles/app-engineer/prompt.md` → `prompts/app.md`. `roles/operator/prompt.md`는 `git rm`한다(남길 말은 3·4번에서 합친다). `roles/`가 남지 않는다.
   - `prompts.ts`: `placePrompt(kind)`가 `./<kind>.md`를 읽는다(`PLACE_KINDS`로 Map을 만든다). place-scope가 둔 home → lophn 같은 옮김 표는 지운다. 주석의 "role 지침"을 "place 종류 지침"으로 고친다.
2. **`prompts/home.md`**(지금 lophn 지침. README "home은 lophn 지침에서 role 말과 넘기기 규칙을 지운다").
   - 1줄 `# lophn` → `# Home`.
   - 3–7줄: "You are lophn … There is one lophn for the whole product … You are not placed in one project or app."를 place 말로 바꾼다. 예: "You work at home: this conversation is not in a project or an app. The person comes here first. You help them use lophn: you turn what they want into a plan, hand the work to the project or app it belongs to, and answer questions about how lophn works and how their apps are doing." 정의 본문과 place 정보가 agent 이름을 주므로 여기서 이름을 말하지 않는다.
   - 11–17, 18–24, 31–32, 44–56줄: 그대로(L1, L2, L9, L3, L6, L7, `instructions.read`, `call` 글, 근거).
   - 25–30줄: 끝 문장 "Making a domain is done by the Project Manager of a project or the App Engineer of an app, not by you."만 바꾼다. 예: "A domain is made in a conversation at its project or app, not here: once the person decides, hand it to lophn there with `call`."
   - 33–38줄(L4): "hand it to that app's App Engineer … the App Engineer designs and builds it"를 "hand it to lophn at that app with `call` (`to: {agent: "lophn", place: {app: "<the app's name>"}}`) and no reply expected; the conversation there designs, builds and releases it"로 바꾼다. 새 앱 등록(`app.create`) 문장들은 그대로다.
   - 39–41줄(L5): "give it to that project's Project Manager"를 "give it to lophn at that project (`to: {agent: "lophn", place: {project: "<the project's name>"}}`)"로 바꾼다.
   - 42–43줄(L8, Operator를 PM·AE에게 청하기): 지운다. agent 만들기는 5번의 고정 규칙이 말한다.
   - 57–60줄: "Those belong to the app's App Engineer."를 "That work is done in a conversation at the app."으로 바꾼다.
3. **`prompts/project.md`**(지금 PM 지침 + Operator 지침에서 남길 말. README "Operator 지침에서 남길 말은 project와 app에 합친다").
   - 1줄 `# Project Manager` → `# Project`.
   - 3–9줄: "You are the Project Manager of one project. Each project has one Project Manager, created when the project is registered."와 "an app has its own App Engineer, and you give app work to it"를 지운다. 예: "You work in one project. You look after the project's folders and the domains you work with: what each domain means, which documents are items of which kind, which fields each kind has, the skills for its work and the result pages written for it. You read the project's `LOPHN.md` as part of your instructions. You work only on this project. Work on an app's code is done in a conversation at that app."
   - 11–16줄("When you start work"): "(lophn, an Operator)"를 지운다. annotation 문장은 "A note the person left on an artifact of the project (an annotation) reaches the conversation that last wrote that artifact, or lophn in this project when none did."로 바꾼다(README "뼈대 검토" annotation 받는 쪽, `artifact.md`).
   - 18–22줄("Domains"): "Your place information lists the project's domains with their folders."를 받은 domain 말로 바꾸고 Operator 지침 8–16줄의 뜻을 합친다. 예: "Your place information lists the domains you work with and their folders: the ones your definition names, or all domains of the project when it names none. Your prompt carries only their `DOMAIN.md` and kinds, and you see their skills and tools plus the public tools of other domains the person assigned to you. You may be able to read other files of the project, but domains that are not listed are not yours."
   - 24–28줄("Workflows"): "Making and keeping this project's workflows is yours"를 "Making and keeping this project's workflows is done here"로 바꾼다. 나머지는 그대로다.
   - 32–38줄: 그대로(C24, C1, C6).
   - 39–42줄(C10, O4): "Work on an app (its declaration, a release, a package, a bug in it) goes to lophn at that app with `call` (`to: {agent: "lophn", place: {app: "<the app's name>"}}`) and no reply expected. If you cannot continue until it is fixed, ask for a result and continue when it returns."(O5를 합친다).
   - 43–45줄: "Only lophn registers an app. Give it to lophn"을 "A new app is registered at home: give it to lophn there (`to: {agent: "lophn"}`, no place)"로 바꾼다.
   - "What you do"에 Operator 지침에서 세 줄을 더한다:
     - O1·Operator 21–22·28줄: "When the person gives you a job, do it with the kinds of your domains and the tools you were given. Read before you judge, and leave the result where the person can see it, with the evidence you read."
     - C27·Operator 25–27줄: "When you hear that a public tool your domains use has changed, read the change and check the skills that call it before you use it again."
     - C26: "A problem in a package goes to lophn at the app that owns it (`owner_app` from `package.get`) with `call`, no reply expected."
   - 49줄: 그대로. 50–51줄: "Its App Engineer builds it."를 지운다("Do not do an app's work here: no declaration, release or app code. Do not run tests, build or preview."). 52–54줄(C8): "go to lophn with `call`"을 "go to lophn at home (`to: {agent: "lophn"}`) with `call`"로 바꾼다.
   - Operator 지침에서 버리는 줄: 3–6줄(정의), 17줄과 23–24줄(쓰기 범위. place 정보와 file 범위가 말한다), 32–35줄(앱 버그를 AE에게. 위 39–42줄로 합쳤다).
4. **`prompts/app.md`**(지금 AE 지침 + Operator 지침에서 남길 말. 짓기 절차는 그대로: README "짓기 절차를 app 지침에 그대로 두면 짓기 품질이 지금과 같다").
   - 1줄 `# App Engineer` → `# App`.
   - 3–7줄: "You are the App Engineer of one app. Each app has one, created when the app is registered."를 지운다. 예: "You work in one app. You design the app, write its code, test it, prepare a release, check it in a preview and activate it. When the app misbehaves, you find the cause and fix it. You also look after the domains you work with. You work only on this app."
   - 11–14줄: "(lophn, an Operator)"를 지우고 annotation은 "when the person leaves a note on the app's screen (an annotation) for the agent picked in the app's title bar"로 바꾼다(README "앱 화면 annotation은 앱 title bar agent select가 고른 agent의 그 앱 place session으로 간다"). "lophn does not open a session when the app keeps crashing"은 "The program does not open a conversation when the app keeps crashing"으로 바꾼다(E2).
   - 18–21줄: "Your place information lists the domains with their folders."를 3번 project의 받은 domain 문장과 같은 뜻으로 바꾼다("… or all domains of the app when it names none").
   - 23–67줄("Designing the app", "Building and releasing"): 한 글자도 바꾸지 않는다.
   - 71–84줄: 그대로.
   - 85–89줄(A21): "tell each such domain's owner (Project Manager or App Engineer) with `call`"을 "tell lophn at each such domain's project or app (`domain.get` gives the owner) with `call`"로 바꾼다.
   - 90–91줄(A20): "goes to that app's App Engineer"를 "goes to lophn at that app"으로 바꾼다.
   - "What you do"에 3번과 같은 O1 줄과 C27 줄을 더한다. Operator의 앱 버그 줄(O4·O5)은 더하지 않는다: 이 앱의 버그는 찾은 agent가 고친다(roadmap "왜").
   - 95–97줄(A12, A13): "go to lophn with `call`"을 "go to lophn at home (`to: {agent: "lophn"}`) with `call`"로, "goes to that project's Project Manager"를 "goes to lophn at that project"로 바꾼다. 98줄은 그대로다.
5. **`PRODUCT_INSTRUCTIONS`**(`prompts/prompts.ts`). 근거: `agent-definition.md` "모든 role에 같은 말은 제품 고정 규칙 한 곳에 둔다", README "`agent.create`·`agent.update`는 세 place 종류 목록에 모두 든다".
   - "A domain's `DOMAIN.md`, kinds file and skills are written only by the Project Manager of its project or the App Engineer of its app. If one that is not yours has to change, give it to that agent with `call`." → "A domain's `DOMAIN.md`, kinds file and skills are written only in a conversation at its project or app, by an agent that works with that domain. If one that is not yours has to change, give it to lophn at that project or app with `call`."
   - "If you have `operator.create`: …" 줄 → 세 종류 모두 가진 tool이라 "If you have" 없이 쓴다. 예: "When the person wants a new agent or a change to one, use `agent.create` or `agent.update`. Choose the domains it works with in `domains`, or leave it out for all domains of the project or app it works in. You cannot give an agent access; the person assigns that."
   - "`call` hands work to another agent. Choose the receiver by the app or project the work is about." → "`call` hands work to an agent at a place: `to: {agent: "<name>", place: {project: "<name>"}}` or `{app: "<name>"}`, or no place for home. Choose the place by the project or app the work is about." 뒤 문장("A call you send does not make you wait …")은 그대로다. `to`의 꼴은 `call` tool 설명(router-core)과 같아야 한다.
   - 나머지 줄(tag 설명, `ask`, 용어, 할당 제안, `guide-artifact`의 "If you have", step, 막힌 일을 돌려 시키지 않기)은 그대로다.
6. **AGENT-ROLE 규칙이 가는 곳**(2–5번을 쓸 때 대조한다. 표에 없는 규칙은 지침 글이 아니다).

   | 규칙 | 가는 곳 |
   |---|---|
   | L1 L2 L3 L6 L7 L9 L10, P2(`instructions.read`) | home 그대로 |
   | L4 L5 L11 | home, 받는 쪽만 "그 그릇 place의 lophn" |
   | L8, A14, C9 | 없어진다. `PRODUCT_INSTRUCTIONS`의 `agent.create` 줄 |
   | O1, C27 | project·app "What you do" |
   | O4 O5 | project: 앱 일은 그 앱의 lophn, 결과가 필요하면 result. app: 없어진다(찾은 agent가 고친다) |
   | O6 | `PRODUCT_INSTRUCTIONS`의 domain 줄(받은 domain은 직접 쓰고, 아니면 그 그릇의 lophn) |
   | O7, C7, C25, T19, W1–W5 | `PRODUCT_INSTRUCTIONS` 그대로 |
   | A1–A11 A15 A18 A19, E2, H10 | app 그대로(E2는 "The program") |
   | A12 A13 A20 A21 | app, 받는 쪽만 "home의 lophn"·"그 그릇의 lophn" |
   | C1 C6 C24 C29, P9(`LOPHN.md`) | project 그대로 |
   | C8 C10 C26 | project, 받는 쪽만 "home의 lophn"·"그 그릇의 lophn" |
   | C2 C3 | `kinds-yaml` skill(지침에 없다, 그대로) |
   | C28 | `guide-artifact` skill |
   | A17, J1–J6, K1–K5, W6 | 지침 글 없음(credential, tool 목록, coding 층, flow) |

7. **내장 skill 글**(`packages/core/agent-places/skills/`). 근거: README "이름에서 role 낱말을 뺀다", "domain 일을 받는 쪽", "workflow 참가자", "flow의 앱 tool 호출". 아래 줄만 고친다.
   - `guide-roles-and-assignments/` → `git mv`로 `guide-agents-and-assignments/`(README "뼈대 검토"). frontmatter `name`과 `description`(예: "The agents (lophn and the ones you make), where a conversation works (home, a project, an app), what an agent definition holds, how apps and MCP servers are assigned, and how agents call each other."). 제목 `# Agents and assignments`. "The four roles" 절은 새로 쓴다: lophn은 늘 있는 내장 agent이고 이름과 그림을 바꾸거나 지울 수 없다. 사람이 만든 agent는 이름이 전체에서 하나이고 `lophn`은 쓸 수 없다. 정의는 project나 앱에 속하지 않는다. 대화(session)는 열 때 place가 정해진다: 런처는 home, project 창은 그 project, 앱 창은 그 앱. place 종류가 내장 tool, 내장 지침, 내장 skill, 쓸 수 있는 폴더를 정하고 같은 종류면 agent가 누구든 같다. home은 기획하고 앱을 등록하고 사용법과 앱 상태를 답하며 project 폴더를 읽기만 한다. project는 project 폴더, 맡은 domain(kind, `DOMAIN.md`, skill, artifact), workflow를 다룬다. app은 앱을 설계하고 짓고 release하고 그 domain을 다룬다. 새 앱은 home의 lophn에게 청하면 등록하고 그 앱의 lophn에게 맡긴다. "Agent definition and assignment" 절: "for an Operator, the domains it works with"를 "the domains it works with (none means all domains of the project or app a conversation opens in)"로, "The built-in instructions of the four roles"를 "The built-in instructions of each place"로, "the Operator's definition"을 "the agent's definition"으로, "the App Engineer sees the users of that tool"을 "the conversation that prepares the release sees the users of that tool"로 고친다. "Calls between agents" 절에 받는 쪽을 agent 이름과 place로 고른다는 한 문장을 더한다.
   - `guide-features-and-screens/SKILL.md` 16–18줄: "the App Engineer and Operators for that app"을 "the agents you talk to about that app"으로. 28–30줄: "you ask Project Manager"를 "you ask an agent in the project window"로. 32–34줄: "you ask its App Engineer, which designs and builds it"를 "you ask an agent in its app window, or lophn, which registers a new app and hands it to the app"으로.
   - `guide-instructions/SKILL.md` 3줄 description의 "(role, …)"를 "(place, …)"로. 15–16줄: "The built-in instructions of the agent's role"을 "The built-in instructions of the place the conversation works in (home, a project or an app)"로. 19–22줄: "An agent placed in the project reads it … lophn, which is not placed in a project, reads it with a tool …"를 "An agent working in the project reads it as part of its prompt. At home an agent reads it with a tool when it works on that project."로. 26–27줄: "lophn has no domain layer."를 "At home there is no domain layer."로. 41–43줄: "`DOMAIN.md` is written by the Project Manager or App Engineer that looks after the domain"을 "`DOMAIN.md` is written by an agent that works with the domain in its project or app"로.
   - `guide-domains/SKILL.md`(세 place 종류 모두 받는다) 39–50줄("Who makes and writes it"): "The Project Manager makes the domains of a project and the App Engineer makes the domains of an app"를 "An agent working in a project or an app makes that place's domains"로, "They write"를 "It writes … of the domains it works with"로, Operator 문장을 "When a domain it does not work with has to change, it asks lophn at that project or app."로. 56–59줄: "the App Engineer sees the users"를 "the conversation that prepares the release sees the users"로. 61–68줄("What an agent sees"): "A Project Manager or App Engineer sees all the domains of its place. An Operator sees the domains named in its definition, or all of them if none are named."를 "An agent in a project or an app sees the domains named in its definition that belong to that place, or all of them if none are named. At home it works with no domain."로.
   - `guide-skills-and-mcp/SKILL.md` 20–23줄: "written by the Project Manager or App Engineer that looks after it"를 "written by an agent that works with that domain"으로, "so an Operator chooses among the skills of the domains it was given"을 지운다.
   - `guide-artifact/SKILL.md` 25–30줄("Who writes"): "An agent working in a project or app writes the artifacts of the domains it works with. At home an agent writes no files."로. 197–198줄: Operator 문장을 지운다. 207–212줄: "(a Project Manager, App Engineer or Operator)"를 지우고 "the Project Manager of the project or the App Engineer of the app that holds the domain gets them"을 "lophn at the project or app that holds the domain gets them"으로. 216–217줄: "which the App Engineer of an app builds"를 "which is built in a conversation at that app"으로.
   - `guide-workflows/SKILL.md`(contract-session의 workflow 목표 꼴):
     - 34–50줄 선언: `participants`를 "a map from a key you choose to `{ agent, place? }`, `{ kind: human }` or `{ kind: harness }`"로. `agent`는 agent 이름, `place`는 `{project: <name>}`이나 `{app: <name>}`, 없으면 이 instance의 project다(home이 아니다). `harness`는 선언만 되고 step을 넘기지 못한다는 줄은 남긴다. 칸 목록에 `agent`(flow가 앱 tool을 부를 때 쓰는 할당과 domain의 agent 이름, 없으면 lophn)를 더한다.
     - 58–62줄 예: `me: { kind: human }`, `experimenter: { agent: experimenter }`, `runner: { agent: eval-runner }`.
     - 97–99줄: flow에서 lophn이 읽는 칸에 `agent`를 더한다.
     - 106줄: `agent: { agent: "lophn", place: { app: "notes" } }`. 122–124줄: "`agent` is `{ agent, place? }` (place left out means this instance's project)".
     - 149–154줄("Allotment"): "as the PM of this project and the domains you hold"를 "of the agent named in `agent` of `workflow.yaml` (lophn when left out) and the domains that agent works with in this project"로, "ask the person with `ask` to allot that app to you"를 "choose that agent and ask the person with `ask` to assign the app to it"로.
   - `kinds-yaml/SKILL.md` 12–13줄: "You write it as the Project Manager or the App Engineer of that project or app."를 "You write it in a conversation at that project or app."으로.
   - `new-app/SKILL.md`(home): description의 "hand it to its App Engineer"를 "hand it to lophn at the new app"으로. 20–24줄: `to: {agent: "lophn", place: {app: "<app name>"}}`, "that is the App Engineer's work"를 "that is done in the app's conversation"으로. 25–27줄: "by picking the App Engineer in the app window"를 "by opening the app and picking lophn in the app window"로.
   - `repair-app/SKILL.md`(home): description, 7–8줄, 18줄, 21줄의 "the app's App Engineer"를 "lophn at that app"(`to: {agent: "lophn", place: {app: "<app name>"}}`)으로.
   - `check-kinds`, `design-app`, `guide-connections`, `guide-questions-and-decisions`, `guide-rewind`, `guide-settings`: role 말이 없다. 끝남 grep으로 확인만 한다.
   - `packages/protocol/lophn-agent/skill-settings.ts`: `BUILTIN_SKILLS`의 `"guide-roles-and-assignments"` 한 줄을 `"guide-agents-and-assignments"`로 바꾼다(`roles`·`places` 칸은 건드리지 않는다).
8. **tool 설명과 주석**(소유 줄의 "설명 글만". 동작은 바꾸지 않는다).
   - `packages/core/apps/agent-tools/app.ts`의 `app.create` 설명: "and its App Engineer looks after it"를 지우고 "Work on the app is done in a conversation at the app's place."를 넣는다. 나머지 문장은 그대로다.
   - `packages/core/domains/agent-tools.ts` 23–24줄 주석: "project place는 PM(과 Operator)의 project, app place는 App Engineer의 앱이다. place가 없는 lophn은 그릇이 없다"를 "session의 place가 그릇이다. place가 없는 home session은 그릇이 없다"로. `domain.list` 설명의 "(all domains if you have no place)"는 그대로다.
   - `packages/core/agent-places/tools/instructions.ts` 14줄 주석: "lophn만 갖는다. 다른 role은 …"을 "home place 종류만 갖는다. project place의 session은 project 지침을 prompt로 받는다"로.
   - `packages/core/agent-places/tools/agent.ts`(agents-core가 만든 `agent.create`·`agent.update`): 설명과 주석에 Operator, Project Manager, App Engineer, role 말이 남았으면 고친다(예: "Create an agent. Give its name (unique; `lophn` is reserved), profile, model, skills, domains (none means all domains of the project or app it works in), mcp_off and instructions (body). Its assignments are given by the person.").
   - `tools/kind.ts`, `tools/settings.ts`: 지금 role 말이 없다. 끝남 grep으로 확인만 한다.
9. **`packages/sdk/declaration/guide.md`** 35–36줄: "사람이나 App Engineer가 `domain.create`로 만든 뒤 쓴다"를 "사람이나 그 앱 place의 session이 `domain.create`로 만든 뒤 쓴다"로.
10. **eval 넘길 줄**(지침 file 자리와 함수 이름만. 지난 기록 `tests/eval/{runs,scorecards,experiments}/`는 건드리지 않는다).
    - `tests/eval/versions/files.ts`: `ROLES` 상수를 `PROMPTS = "packages/core/agent-places/prompts"`로, `INSTRUCTION`을 `^${PROMPTS}/(home|project|app)\.md$`로, `${ROLES}/prompts.ts`를 `${PROMPTS}/prompts.ts`로.
    - `tests/eval/versions/components.ts`, `tests/eval/experiment/variant/texts.ts`: `placePrompt` import 경로를 `prompts/prompts.ts`로.
    - `tests/eval/versions/versions_test.ts`: import 경로, `classifyPath` 표의 `roles/lophn/prompt.md`·`roles/prompts.ts` 줄을 `prompts/home.md`·`prompts/prompts.ts`로. (place-scope가 이미 `placePrompt("home")`과 `role_prompts`의 종류 key로 바꿨으면 그대로 둔다.)
    - `tests/eval/experiment/gate/gate_test.ts` 58줄: `packages/core/agent-places/prompts/home.md`.
    - `tests/eval/scenarios/`의 skill 이름(`L6.scenario.ts`)은 `eval-scenarios`가 고친다(계약).
11. **tool 이름 대조**(계약 "지침이 말하는 tool이 그 목록에 있어야 한다"). 새 `home.md`·`project.md`·`app.md`와 home·project·app이 받는 skill 글에서 backtick으로 적은 tool 이름을 `placeToolNames(kind)`와 댄다. 한 번 돌리는 script는 worktree의 `.dev-data/place-prompts/`에 두고 commit하지 않는다. test로 만들지 않는다. 목록에 없는 tool을 말하면 글을 고친다(지금 home에는 `file.write`·`domain.create`가, project에는 `app.tools`·`release.*`·`preview.*`가 없다).
12. **소유 줄에 없는데 이 task의 바꿈으로 깨지는 file**(뼈대 검토 보고 대상). 띄우기 전에 lead가 소유에 넣는다. 넣지 않았으면 고치지 말고 보고의 "계약 바꾸기 요청"에 적는다.
    - `packages/core/main/agent-runtime/product-driver.ts`: `placePrompt` import 경로 `../../agent-places/roles/prompts.ts` → `../../agent-places/prompts/prompts.ts`.

## 정한 것 (brief를 쓴 agent, 2026-10-28)

1. **지침 file은 `prompts/{home,project,app}.md` 셋이다.** 이유: place 종류가 셋으로 고정이고 종류마다 file 하나라 폴더를 따로 둘 까닭이 없다. 이름이 `PlaceKind` 값과 같아 `prompts.ts`가 표 없이 고른다.
2. **`agent.create` 줄은 "If you have" 없이 고정 규칙에 둔다.** 이유: 세 종류 목록에 모두 든다(README). `agent-definition.md`는 모든 종류에 같은 말을 고정 규칙에, 일부 종류에만 맞는 말을 "If you have …" 꼴로 둔다.
3. **app 지침에는 Operator의 "앱 버그는 넘긴다" 줄(O4·O5)을 합치지 않는다.** 이유: app place의 session은 앱 tool과 짓기 절차를 다 받으므로 찾은 agent가 고친다(roadmap "왜": "role이 없으면 버그를 찾은 agent가 고친다"). project 지침에서는 앱 일을 그 앱의 lophn에게 넘기는 줄로 남긴다(project 목록에 release·preview tool이 없다).
4. **지침은 agent 이름을 말하지 않는다.** home 지침의 "You are lophn"을 지운다. 이유: 같은 종류의 session은 agent가 누구든 같은 지침을 받는다(roadmap "무엇을 만드나" 3). 이름은 place 정보 첫 줄(`You are <name>.`, place-scope)과 정의 본문이 준다.

**뼈대 검토로 더한 일 (planner):** `guide-questions-and-decisions/SKILL.md:38`의 "coding agent 물음이 대기 목록에 보인다"는 coding session 층을 지우면 틀린 말이 된다(wave 1 `coding-shell`). 그 줄을 지운다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. 지침과 skill 글은 문구라 test하지 않는다(write-test). `tests/eval/versions/versions_test.ts`와 `gate_test.ts`는 경로만 고쳐 통과한다.
- 남지 않음(모두 0줄):
  - `test ! -e packages/core/agent-places/roles && test ! -e packages/core/agent-places/skills/guide-roles-and-assignments && echo ok`가 `ok`를 찍는다.
  - `grep -rn "Project Manager\|App Engineer\|Operator\|project_manager\|app_engineer\|operator\.create" packages/core/agent-places/prompts packages/core/agent-places/skills packages/core/agent-places/tools/{kind,instructions,settings,agent}.ts packages/core/apps/agent-tools/app.ts packages/core/domains/agent-tools.ts packages/sdk/declaration/guide.md`
  - `grep -rnw "role\|roles\|PM\|AE" packages/core/agent-places/prompts packages/core/agent-places/skills`
  - `grep -rn "guide-roles-and-assignments\|agent-places/roles\|agent-roles/roles" packages tests/eval/versions tests/eval/experiment`

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
