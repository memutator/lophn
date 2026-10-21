# ad-builtin-skills

guide 10편과 role command 셋(`new-app`, `repair-app`, `check-kinds`)을 내장 skill로 옮기고 `guide.read`를 지운다. 필요할 때 읽는 길이 `skill.read` 하나가 되고, 사람이 부르는 것도 skill 하나로 모인다. 내장 skill마다 role을 적어 lophn 사용법은 lophn에게만, artifact 쓰는 법은 artifact를 쓰는 role에게만 간다. role command 자체(`ROLE_COMMANDS`)는 ad-commands가 지운다. 그 사이에는 role command와 같은 이름의 skill이 `/` registry에서 예약 이름으로 빠질 뿐 깨지지 않는다.

- 단위: builtin-skills (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/skills`(새 꾸러미 13개. `kinds-yaml`은 고치지 않는다)
  - `packages/core/agent-roles/roles/lophn/guides`(지운다)
  - `packages/core/agent-roles/roles/guides.ts`(지운다)
  - `packages/core/agent-roles/tools/guide.ts`(지운다)
  - `packages/core/agent-roles/tools/settings.ts`(새 file)
  - `packages/core/agent-roles/tools/mod.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/protocol/lophn-agent/skill-settings.ts`
  - `packages/core/agent-roles/roles/{lophn,project-manager,app-engineer,operator}/prompt.md`(`guide.read`를 부르는 줄만)
- 읽을 것:
  - 계획: `project-docs/plan/agent-definition/README.md`의 "정한 것"(guide skill 이름 `guide-<지금 guide 이름>`, role command 셋은 같은 이름, `repair-app`에서 lophn은 고치지 않는다, 내장 skill은 모두 `can_disable: false`, `BUILTIN_SKILLS`의 `description` 칸 지우기)
  - roadmap: `project-docs/products/roadmap/agent-definition.md`의 "guide는 skill이 된다", "command는 '사람이 이름으로 부르는 skill'이다"
  - 앞 계획: changelog `project-docs/products/change-log/0.6.0.md`의 마지막 항목 "App Engineer가 앱을 직접 짓고, ticket과 test runner를 지운다"(App Engineer가 설계하고 코드를 쓰고 `release.prepare`·preview·`release.activate`로 올린다. 공개 tool을 지우는 release는 막지 않고 준비 결과 `removed_public_tools`에 tool과 쓰는 domain 이름을 싣는다. `project-docs/architecture/activation.md` 42줄). ae-builds가 guide의 ticket·coding agent 넘기기·공개 tool 막기 줄을 이미 고쳤다. 할 일 10은 남은 한 줄이다.
  - architecture: `project-docs/architecture/agent-definition.md`의 "지침 층은 덮지 않고 이어 붙인다"(끌 수 없는 내장 skill은 사람 skill이 같은 이름으로 덮지 못한다, 내장 skill 폴더는 role 층이 정한다), "skill은 목록(이름과 설명)만 prompt에 넣고 본문은 tool로 읽는다", "agent 정의의 `domains`와 `skills`"(끌 수 없는 내장 skill은 고르지 않아도 늘 받는다), "role의 tool 목록은 코드가 고정하고"(목록 이름마다 정의가 있다). `project-docs/architecture/approval.md` 첫 절(MCP server는 설정한 층이 곧 할당, 할당한 tool은 묻지 않는다. 할 일 4가 이것으로 guide 한 줄을 맞춘다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `agent-tool-spi`. `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 코드
    - 본보기 꾸러미: `packages/core/agent-roles/skills/kinds-yaml/SKILL.md`(frontmatter 꼴), `packages/core/agent-roles/skills/root.ts`(`BUNDLED_SKILLS_ROOT`)
    - 옮길 글: `packages/core/agent-roles/roles/lophn/guides/*.md` 10편, `packages/core/agent-roles/roles/guides.ts`(24-35 topic 이름표)
    - role command 글: `packages/core/agent-roles/commands.ts`의 `NEW_APP_PROMPT`(7-8), `REPAIR_APP_PROMPT`(10-11), `CHECK_KINDS_PROMPT`(13-14), title·description(36-57)
    - 지울 tool: `packages/core/agent-roles/tools/guide.ts`(`guide.read` 19-44, 옮길 `settings.get` 45-63, `nonblank` 14-16), `packages/core/agent-roles/tools/mod.ts`
    - tool 목록: `packages/core/agent-roles/tool-lists.ts`의 `READ_TOOLS`(26-41, `guide.read` 38), `TOOL_ORDER`(90-138, `guide.read` 132). ticket tool은 ae-builds가 지웠고 App Engineer 쓰기 tool에 `release.prepare`·`release.activate`·`preview.*`가 있다(이 task와 상관없다).
    - 내장 skill 선언: `packages/protocol/lophn-agent/skill-settings.ts` 20-29(`BUILTIN_SKILLS`)
    - 선언을 읽는 곳(고치지 않는다): `packages/core/lophn-agent/extensions/skills.ts`의 `parseSkillFrontmatter`, `declaredBuiltin`·`undeclaredBuiltinReason`(내장 폴더에 있어도 선언 안 된 이름은 빠진다), `builtinForRole`, `mergeSkillLayers`, `SKILL_BODY_MAX_BYTES`. ad-discovery가 같은 file을 고치므로 줄이 아니라 이름으로 찾는다. `packages/shell/renderer/workspace/agents/core-extensions.ts`의 `readSkills`(`BUILTIN_SKILLS`의 `roles`만 읽는다), `packages/shell/renderer/workspace/agents/views.ts` 37줄
    - 예약 이름: `packages/core/lophn-agent/commands/registry.ts`의 `buildRegistry`(116-153). role command와 같은 이름의 skill은 메뉴에서 빠지고 notice가 된다.
    - 목록 ↔ 정의 test: `packages/core/main/agent-tools_test.ts`("role 목록의 모든 이름에 정의가 있고 모든 정의가 어느 role 목록에 있다")
- 계약:
  - 쓰는 것:
    - 꾸러미 꼴: `<이름>/SKILL.md`, frontmatter는 한 줄짜리 `name`과 `description`(`parseSkillFrontmatter`, 이름 `^[a-z0-9]+(-[a-z0-9]+)*$`, 설명 1~1024자), 본문 24 KiB 이하. 내장 폴더는 `BUNDLED_SKILLS_ROOT`(`packages/core/agent-roles/skills/root.ts`)다.
    - role command 글: `packages/core/agent-roles/commands.ts`의 `NEW_APP_PROMPT`, `REPAIR_APP_PROMPT`, `CHECK_KINDS_PROMPT`와 그 title·description(읽기만 한다)
  - 내놓는 것:
    - `BUILTIN_SKILLS: readonly { name: string; roles: readonly Role[]; can_disable: false; menu: boolean }[]`. `description` 칸을 지운다(읽는 곳이 없고 설명은 SKILL.md frontmatter 하나에 둔다). 모두 `can_disable: false`다(정의 편집 화면이 이미 "내장 skill은 끌 수 없다"로 그린다. `packages/shell/renderer/workspace/agents/views.ts` 37줄).
    - `menu`는 사람이 `/`로 부르는 내장 skill인지다. `new-app`, `repair-app`, `check-kinds`(옛 role command)만 `true`이고 `guide-*` 열 개와 `kinds-yaml`은 `false`다(model이 읽는 안내라 사람은 말로 묻는다). ad-commands의 registry가 `menu: false`인 내장 skill을 `/` 메뉴에서 뺀다. prompt의 skill 목록과 `skill.read`는 `menu`를 보지 않는다. 이 task는 칸만 두고 읽는 곳은 만들지 않는다.
    - 내장 skill과 role
      - lophn: `guide-features-and-screens`, `guide-roles-and-assignments`, `guide-questions-and-decisions`, `guide-settings`, `guide-connections`, `guide-skills-and-mcp`, `guide-instructions`, `guide-rewind`, `new-app`, `repair-app`
      - lophn, project_manager, app_engineer: `guide-domains`
      - project_manager, app_engineer, operator: `guide-artifact`
      - project_manager: `check-kinds`
      - project_manager, app_engineer: `kinds-yaml`(그대로, `menu: false`)
    - tool `guide.read`가 없다(정의, `READ_TOOLS`, `TOOL_ORDER` 어디에도). `settings.get`은 `packages/core/agent-roles/tools/settings.ts`의 `SETTINGS_TOOLS`이고 `ROLE_AGENT_TOOLS`가 그것을 펼친다.
    - role 지침 넷에 `guide.read`가 없다. artifact 줄은 `guide-artifact` skill을, lophn의 사용법 줄은 `guide-*` skill과 `settings.get`을 가리킨다.

## 할 일

줄 번호는 main `15f282fcd`(ae-builds land 뒤) 기준이다. guide의 줄 번호(할 일 2·4·10)는 frontmatter를 달기 전 `roles/lophn/guides/<topic>.md`의 줄이다(frontmatter 네 줄과 빈 줄 하나를 달면 다섯 줄 밀린다). ae-builds는 `commands.ts`(`NEW_APP_PROMPT`·`REPAIR_APP_PROMPT`·`CHECK_KINDS_PROMPT`)와 `skill-settings.ts`를 고치지 않았다.

1. guide 10편을 꾸러미로 옮긴다. 폴더를 만들고 `git mv packages/core/agent-roles/roles/lophn/guides/<topic>.md packages/core/agent-roles/skills/guide-<topic>/SKILL.md`로 옮긴 뒤 frontmatter를 단다. `name`은 `guide-<topic>`이다. guide에는 설명 칸이 없으니 `description`은 제목과 첫 문단에서 쓴 영어 한 줄이다. 아래는 제안이고 다듬어도 된다. 설명은 prompt의 skill 목록에 실려 agent가 언제 읽을지 고르는 근거다.

   | guide file | skill | roles | description(제안) |
   |---|---|---|---|
   | `features-and-screens.md` | `guide-features-and-screens` | lophn | How lophn is laid out for the person: the Launcher, project and app windows, Projects, Apps, Agents, Settings, the waiting list, and what a conversation shows. |
   | `roles-and-grants.md`(skill 폴더 이름은 `guide-roles-and-assignments`. guide 제목이 이미 "Roles and assignments"다) | `guide-roles-and-assignments` | lophn | The four roles (lophn, Project Manager, App Engineer, Operator), what an agent definition holds, how apps and MCP servers are assigned to an agent, and how agents call each other. |
   | `questions-and-decisions.md` | `guide-questions-and-decisions` | lophn | How agents ask the person: question cards, shell permission requests, the waiting list, and the decisions only the person makes on a screen. |
   | `settings.md` | `guide-settings` | lophn | How to explain a setting from its public definition and current value (settings.get), and how the person changes settings. |
   | `connections.md` | `guide-connections` | lophn | Connecting models: which services and local models lophn supports, API keys and sign-in, the protected entry field, accounts and models. |
   | `skills-and-mcp.md` | `guide-skills-and-mcp` | lophn | What skills and MCP servers are, the skill layers (built-in, global, domain), the slash menu, and how the person adds, signs in to and assigns MCP servers. |
   | `instructions.md` | `guide-instructions` | lophn | The instruction layers (role, global, project LOPHN.md, domain DOMAIN.md, agent), who edits each, and when an edit is read. |
   | `rewind.md` | `guide-rewind` | lophn | Session rewind and app rewind: what goes back, what stays, and that only the person can rewind. |
   | `domains.md` | `guide-domains` | lophn, project_manager, app_engineer | What a domain is (a boundary of meaning and responsibility inside a project or app), what it holds, who makes and writes it, and what each agent sees of it. |
   | `artifact.md` | `guide-artifact` | project_manager, app_engineer, operator | Write an artifact: a static HTML page in a domain's artifacts folder that shows the person a result on screen. Where it goes, its folder and data, the sealed view and theme tokens. |

   - frontmatter는 `kinds-yaml/SKILL.md` 1-4줄 꼴 그대로다(`---`, `name: …`, `description: …`, `---`). 값은 한 줄 plain scalar다. `|`, `>`, `[`, `{`, 따옴표로 시작하지 않는다(`parseSkillFrontmatter`가 거절하면 그 꾸러미가 말없이 빠진다).
   - 본문(`# Rewind` 같은 제목부터)은 그대로 둔다. 고치는 줄은 아래 2·4·10뿐이다.
2. 본문의 guide 가리킴을 고친다. skill은 그 skill을 받는 role이 모두 받는 skill만 이름으로 가리킨다. 아니면 가리킴을 지운다(받지 않은 skill을 가리키면 `skill.read`가 `not_found`다).
   - `guide-features-and-screens` 3-6: "This guide explains … these guides …" → "The `guide-*` skills explain how to use lophn. They do not invent …"과 "If neither these skills nor the public Settings definitions say something, lophn says it does not know."
   - `guide-features-and-screens` 23-24 "(see the Domains guide)" → "(see the skill `guide-domains`)", 43 "(see the Rewind guide)" → "(see the skill `guide-rewind`)". 둘 다 lophn이 받는다.
   - `guide-settings` 35 "described in Connections" → "described in the skill `guide-connections`".
   - `guide-connections` 34-35 "This guide cannot show it." → "lophn cannot show it."
   - `guide-domains` 16-17, 18-19, 20-21의 "(see the Instructions guide)", "(see the Skills and MCP guide)", "(see the Artifact guide)"는 지운다. `guide-instructions`·`guide-skills-and-mcp`는 lophn만, `guide-artifact`는 lophn이 받지 않는다.
3. role command 꾸러미 셋을 쓴다. 사람이 `/이름 글`로 부르면 skill 이름과 뒤의 글이 사람 메시지로 들어온다(ad-commands가 잇는다). 본문은 그 메시지를 받은 agent가 따를 절차다. role 지침의 문단을 그대로 베끼지 않는다. 지침에 있는 순서와 규칙은 "your instructions"로 가리킨다.
   - `new-app`(lophn). description 제안: "Start a new app with the person: find out what it should do, check what already exists, then register it and hand it to its App Engineer."
     1. 사람이 명령 뒤에 쓴 글이 있으면 거기서 시작하고, 이미 말한 것을 다시 묻지 않는다. 앱이 무엇을 하고 누구를 위한 것인지 `ask`로 한 번에 하나씩 묻는다(`NEW_APP_PROMPT`).
     2. 있는 것을 먼저 본다: place 정보의 domain 지도, `app.list`·`app.get`·`app.tools`, `package.list`. 지침의 순서(있는 앱 고치기, package 위에 짓기, 새 앱)로 비교해 추천하고 `ask`로 고르게 한다.
     3. 새 앱이면 이름을 정해 `app.create`로 등록한다(같은 이름의 domain이 있으면 실패하니 다른 이름).
     4. 고른 앱의 App Engineer에게 `call`(`to:{role:"app_engineer", place:{app:"<app 이름>"}}`, 답 없음)로 넘긴다. 본문에는 사람이 원한 것을 사람의 말로, 정한 것과 정하지 않은 것을 적는다. 앱을 자세히 설계하지 않는다(App Engineer의 일).
     5. 누가 맡았고 사람이 어디서 이어 볼지(앱 창의 App Engineer 대화)를 말한다.
   - `repair-app`(lophn). lophn은 고치지 않는다(README "정한 것", lophn 지침 "What you do not do"). description 제안: "Find out what went wrong in one of the person's apps from its status, log and failed calls, tell the person what you found, and hand the fix to that app's App Engineer."
     1. 어느 앱인지: 사람의 글에서 찾고, 없으면 `app.list`를 읽고 `ask`로 하나 묻는다.
     2. 읽는다: `app.get`, `app.status`, `app.logs`(최근 오류, `since`로 좁힌다), `app.invocations`(`status: "failed"`).
     3. 사람에게 알린다: 확인한 것과 추정을 나누고, 읽지 않은 숫자는 "not confirmed"라고 한다. 원인을 해석하거나 코드를 고치지 않는다.
     4. 그 앱의 App Engineer에게 `call`(답 없음)로 넘긴다. 본문은 짧게, 근거는 invocation id와 log 시각으로 가리킨다. 대화를 붙여 넣지 않는다.
     5. App Engineer가 맡았다고 사람에게 말한다.
   - `check-kinds`(project_manager). description 제안: "Check every domain of the project against its kinds and say, for each violation, whether the kinds file or the document is wrong."
     1. place 정보의 domain마다 `kind.check`(`domain`을 준다)를 부른다.
     2. 위반마다 kinds file과 문서 가운데 무엇이 틀렸는지, 무엇을 바꾸겠는지 말한다(`CHECK_KINDS_PROMPT`). 사람의 문서는 고치지 않는다.
     3. kinds file을 바꿔야 하면 skill `kinds-yaml`을 따른다. domain마다 요약한다.
     - ad-instructions가 kind 위반 다루기를 `kinds-yaml`의 절로 옮기고 이 skill이 그 절을 가리키게 고친다. 여기서는 위 셋이면 된다.
4. 내장 skill이 모두 끌 수 없게 되고 approval이 바뀐 데 맞춰 `guide-skills-and-mcp`의 낡은 줄을 고친다(정한 것 참고).
   - 18-20 "If the same name appears in more than one layer, the last layer wins (domain over global over built-in)." → domain이 global을 덮고, built-in skill은 같은 이름의 사람 skill에 덮이지 않는다(`mergeSkillLayers`).
   - 24-25 "A built-in skill the role needs to work cannot be turned off." → "Built-in skills cannot be turned off."
   - 27-29 → "Typing `/` in the composer lists the session commands and then the skills you can call by name. Built-in guidance skills are not in that list; ask the agent in words. A skill named like a session command is left out of that list." role 명령과 "you are told"를 지운다(ad-commands가 role 명령과 `notices`를 지우고 `menu: false` 내장 skill을 메뉴에서 뺀다. 그 task는 이 file을 소유하지 않는다).
   - 40-44 "Any other tool is treated as external, which asks you each time unless you choose Allow always …" → `architecture/approval.md` 첫 절대로: 할당한 MCP tool은 묻지 않고 돈다, server를 끄는 것은 `mcp_off`다. 같은 말이 `guide-roles-and-assignments` 41-46과 `guide-questions-and-decisions` 36-38에 이미 있다.
5. `packages/protocol/lophn-agent/skill-settings.ts`의 `BUILTIN_SKILLS`(20-29)를 위 계약 표 14줄로 바꾼다. 줄마다 `menu`를 적는다(`new-app`, `repair-app`, `check-kinds`만 `true`). `description` 칸과 20줄 주석("description은 skill 목록에 들어가는 영어 한 줄이다")을 지우고, 주석에 "모두 끌 수 없다. 설명은 SKILL.md frontmatter에 있다. `menu`는 사람이 `/`로 부르는 skill인지이고 prompt 목록에는 닿지 않는다"를 쓴다. type은 `Role`(`./places.ts`)로 적는다(`as const satisfies …` 등 꼴은 worker가 고른다). `menu`를 읽는 코드는 쓰지 않는다(ad-commands).
6. `settings.get`을 옮긴다.
   - `packages/core/agent-roles/tools/settings.ts`(새 file): `tools/guide.ts`의 `nonblank`(14-16)와 `settings.get` 정의(45-63)를 그대로 옮겨 `export const SETTINGS_TOOLS: readonly ToolDefinition[]`로 낸다. import는 `ok`, `settingsList`, `defineTool`·`fitted`·`readOf`·`ToolDefinition`(`../../lophn-agent/tools/spi.ts`), `z`만이다.
   - `packages/core/agent-roles/tools/mod.ts`: `GUIDE_TOOLS` import와 펼침을 `SETTINGS_TOOLS`로 바꾼다. 순서는 뜻이 없다(`main/agent-tools.ts`가 `TOOL_ORDER`로 다시 정렬한다).
   - `packages/core/agent-roles/tools/guide.ts`와 `packages/core/agent-roles/roles/guides.ts`를 지운다. `roles/lophn/guides/` 폴더가 비었는지 본다.
7. `packages/core/agent-roles/tool-lists.ts`: `READ_TOOLS`의 `"guide.read"`(38)와 `TOOL_ORDER`의 `"guide.read"`(132)를 지운다.
8. role 지침 넷의 `guide.read` 줄만 바꾼다. 다른 줄은 ad-instructions가 고친다.
   - `roles/lophn/prompt.md` 45-47 → "When the person asks how to use lophn or what a setting means, read the matching `guide-*` skill with `skill.read` and the setting with `settings.get`. If they do not say it, say you do not know."
   - `roles/project-manager/prompt.md` 78-79, `roles/operator/prompt.md` 32-33의 "Read `guide.read` topic `artifact` before you write it." → "Read the skill `guide-artifact` before you write it."
   - `roles/app-engineer/prompt.md` 117-118의 "; read `guide.read` topic `artifact` first." → "; read the skill `guide-artifact` first."
9. 사이 상태를 확인만 한다(고치지 않는다).
   - ad-commands 전에는 `new-app`·`repair-app`·`check-kinds` skill이 `/` 메뉴에서 role 명령의 예약 이름으로 빠진다(`buildRegistry`). `/new-app`은 아직 `NEW_APP_PROMPT`를 보낸다. `menu: false`인 `guide-*`는 아직 메뉴의 Skills 묶음에 뜬다(ad-commands가 뺀다).
   - ad-discovery 전에는 turn prompt의 skill 목록이 role 없이 찾아 다른 role의 내장 skill도 뜬다(지금 `kinds-yaml`과 같은 bug, ad-discovery가 고친다).
10. `guide-artifact` 136줄 "- Do not write app code."를 지운다. 이 skill을 받는 App Engineer는 이제 앱 code를 쓴다(changelog 0.6.0). 바로 위 134-135줄("A screen like that is an app, which the App Engineer of an app builds.")은 ae-builds가 이미 고쳤으니 그대로 둔다.
    - ae-builds가 이미 고친 것(다시 고치지 않는다): `guide-roles-and-assignments` 22-26(설계하고 코드와 blueprint를 쓰고 preview에서 확인하고 올린다)과 50-52, `guide-domains` 41-43(공개 tool을 지우는 release는 막지 않고 준비할 때 App Engineer가 쓰는 쪽을 본다. `removed_public_tools`의 `{tool, domains}`와 맞다), `guide-features-and-screens` 27-29.
    - `guide-questions-and-decisions` 33-34(coding agent가 자기 terminal에서 묻는 것)와 `guide-instructions` 3-4(지침은 coding agent의 `AGENTS.md`가 아니다)는 그대로 둔다. 사람이 terminal 탭에서 쓰는 coding agent와 연결 장치는 남고, 지침 층이 `AGENTS.md`를 읽지 않는 것도 그대로다(`architecture/agent-definition.md` 37줄).

정한 것:
- **skill은 받는 role이 같은 skill만 가리킨다.** 할 일 2. 건너 role의 가리킴은 이름만 바꾸면 `not_found`로 끝난다.
- **옮기면서 낡은 사실 몇 줄을 고친다**(할 일 4, 10). 내장 skill을 모두 끌 수 없게 하는 것은 이 task이고, MCP 묻기는 `approval-simplify`가, App Engineer가 직접 짓는 것은 `ae-builds`가 이미 바꿨다. lophn과 App Engineer가 이 글을 읽고 따르므로 틀린 줄을 옮기지 않는다. 그 밖의 본문은 고치지 않는다.
- **`guide-skills-and-mcp`의 `/` 메뉴 줄은 ad-commands 뒤의 모양으로 쓴다.** 그 task는 이 file을 소유하지 않는다. 그 사이에 role 명령이 메뉴에 남아 있어도 틀린 말은 아니다("session commands"는 built-in만 가리킨다).

## 끝남

- `deno task check`가 통과한다. `deno test --no-check packages/core/main/agent-tools_test.ts packages/core/agent-roles packages/core/lophn-agent/extensions`가 통과한다(목록 ↔ 정의, wire 이름, skill 층 합치기).
- 위험 test: 없음. role 거르기("skill에 role을 적으면 다른 role의 prompt와 `/` 메뉴에 뜨지 않는다")는 ad-discovery가 쓴다. 선언과 폴더가 맞는지는 저장소 file을 글로 읽는 검사라 test로 두지 않고(AGENTS.md "속도") 아래 일회 확인으로 본다.
- 일회 확인(commit하지 않는다). 저장소 root에서:

  ```sh
  deno eval --ext=ts '
  import { BUILTIN_SKILLS } from "./packages/protocol/lophn-agent/skill-settings.ts";
  import { BUNDLED_SKILLS_ROOT } from "./packages/core/agent-roles/skills/root.ts";
  import { parseSkillFrontmatter, SKILL_BODY_MAX_BYTES } from "./packages/core/lophn-agent/extensions/skills.ts";
  const declared = new Set(BUILTIN_SKILLS.map((s) => s.name));
  for (const e of Deno.readDirSync(BUNDLED_SKILLS_ROOT)) {
    if (!e.isDirectory) continue;
    const text = Deno.readTextFileSync(`${BUNDLED_SKILLS_ROOT}/${e.name}/SKILL.md`);
    const p = parseSkillFrontmatter(text);
    console.log(e.name, p.ok ? p.value.name === e.name : p.error, declared.has(e.name), new TextEncoder().encode(text).length <= SKILL_BODY_MAX_BYTES);
  }
  for (const s of BUILTIN_SKILLS) console.log(s.name, s.roles.join(","), s.can_disable, s.menu);'
  ```

  폴더 14개가 모두 `true true true`이고, 선언 14줄이 위 계약의 role과 같고 `can_disable`은 모두 `false`, `menu`는 `new-app`·`repair-app`·`check-kinds`만 `true`다.
- 남지 않음:
  - `git grep -nE "guide\.read|guideTopics|GUIDE_TOOLS|roles/guides|lophn/guides" -- packages tools`가 0줄이다. `guideText`는 `packages/core/apps/packages/publish.ts`에 같은 이름의 다른 함수가 있어 `git grep -n "guideText" -- packages/core/agent-roles`로 본다(0줄).
  - `git grep -nE "see the .* guide|these guides|This guide" -- packages/core/agent-roles/skills`가 0줄이다.
  - `tests/eval`에 남은 것(`tests/eval/versions/components.ts`, `tests/eval/versions/files.ts`, `tests/eval/versions/versions_test.ts`, `tests/eval/experiment/variant/texts.ts`, `tests/eval/scenarios/lophn/L6.scenario.ts`, `tests/eval/registry/tool/guide.read.json`, `tests/eval/registry/instruction/*.json`)은 check 밖이라(`tools/check.ts`의 `NOT_CHECKED`) 고치지 않고 보고만 한다.

## 보고

- 바꾼 file(옮긴 guide 10편은 `git mv`로 옮겼는지)
- 통과한 check(`deno task check`, 위 `deno test`, 일회 확인 출력)
- 등록할 것: 없을 것이다(`tools/mod.ts`가 `SETTINGS_TOOLS`를 펼친다). 있으면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(description 글을 제안에서 바꿨으면 그 이유)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. `tests/eval`에 남은 `guide.read`·`guideText`·`guideTopics` 줄 목록
- 계약 바꾸기 요청: 고정된 계약(skill 이름, role, `BUILTIN_SKILLS` 꼴, `SETTINGS_TOOLS`)을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"(할 일 9의 사이 상태는 적지 않아도 된다)
