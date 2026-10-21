# ad-commands

`/` 명령을 session 조작 built-in과 skill 두 갈래로 줄이고, `/이름 글`의 글을 skill 메시지 뒤에 잇는다. role command(`ROLE_COMMANDS`, `prompt` action), 만드는 곳이 없는 `tool` action, 메뉴가 읽지 않는 `skill_origin`과 `while_running`, core route가 없는 `/recap`, 읽는 화면이 없는 `notices`를 지운다. 출처가 둘뿐이고 built-in의 id와 skill의 이름이 늘 `name`과 같아 `action`도 지운다. `/` 메뉴 모양이 바뀌므로(묶음 셋 → 둘, Recap 없음) `ui-design` skill로 gallery부터 고치고, 문구는 `wording` skill을 따른다.

- 단위: commands (wave 2)
- 선행: ad-builtin-skills, ad-discovery. ad-builtin-skills가 role command와 같은 이름의 내장 skill을 먼저 두고, ad-discovery와 `register.ts`를 나눠 쓴다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{commands.ts,command-filter.ts}`
  - `packages/core/lophn-agent/commands`
  - `packages/core/lophn-agent/register.ts`(`roleCommands` port와 `createCommandReads` 줄)
  - `packages/core/main/daemon/wiring/lophn-agent-team.ts`
  - `packages/core/agent-roles/commands.ts`(지운다)
  - `packages/shell/renderer/conversation/{agent-tab-core-source-commands.ts,agent-tab-core-source.ts,agent-tab-source.ts,agent-tab-fake-source.ts,agent-tab-fake-commands.ts,agent-view.tsx,agent-view.module.css}`
  - `packages/shell/renderer/conversation/slash-menu`
  - `packages/shell/renderer/conversation/composer/agent-composer.tsx`(recap을 말하는 주석 한 줄만)
  - `packages/shell/renderer/conversation/recap`(지운다)
  - `tools/wireframes/mock/agents-data.ts`
  - `tools/wireframes/pages/screens/{agent.tsx,agent-pages.tsx,agent-chat.tsx,conversation.tsx}`
  - `tools/wireframes/pages/screens/agent-tab/scenes.tsx`
  - `packages/design/wording/catalog/{conversation.ts,conversation.placeholders.ts}`(같이 쓰는 file)
- 읽을 것:
  - 계획: `project-docs/plan/agent-definition/README.md`의 "정한 것"(`/이름 글`의 메시지 꼴, role command가 같은 이름의 내장 skill이 된다, guide skill 이름 `guide-<이름>`, 내장 skill은 끌 수 없고 이름이 같으면 내장이 이긴다, 지우는 칸과 갈래, `/` 메뉴 항목과 두 묶음, 화면은 gallery부터). planner가 살 단계 뒤에 더 정한 것: 내장 skill은 `BUILTIN_SKILLS`의 `menu` 칸이 `true`일 때만 `/` 메뉴에 뜬다(`new-app`, `repair-app`, `check-kinds`만 `true`. `guide-*`와 `kinds-yaml`은 model이 읽는 안내라 사람은 말로 묻는다). 사람이 쓴 skill(전역, domain)은 늘 뜨고, model의 prompt skill 목록은 바뀌지 않는다.
  - roadmap: `project-docs/products/roadmap/agent-definition.md`의 "command는 '사람이 이름으로 부르는 skill'이다", "지금 코드"의 `/` 메뉴 줄, "정한 것(agent)"의 `/recap` 지우기
  - architecture: `project-docs/architecture/agent-definition.md` 35줄(끌 수 없는 내장 skill은 같은 이름의 사람 skill이 덮지 못한다), 73줄(prompt의 skill 목록, `skill.read`, `/` 메뉴가 같은 `skillReceived`를 쓴다)
  - 선행 brief: `ad-builtin-skills.md`(내장 skill 이름과 role, `BUILTIN_SKILLS`와 그 `menu` 칸), `ad-discovery.md`(`commandSkillsOf(entries, chosen, domains)`, `register.ts`의 `/` 메뉴 skill 목록이 role을 받는다)
  - skill: `.claude/skills/ui-design/SKILL.md`(gallery는 renderer component를 fake source와 고정 data로 그린다, "확인"), `.claude/skills/wording/SKILL.md`("key를 지우기 전에", "손으로 생성물을 고치지 않는다"), `.claude/skills/write-test/SKILL.md`("쓰지 않는 test")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `lophn-agent`, `shell`; `project-docs/module-catalog.yaml`의 `packages/protocol`, `packages/core/agent-roles`, `packages/core/lophn-agent`, `packages/shell/renderer`, `packages/design`, `tools`
  - 코드(줄은 main `15f282fcd` 기준. `register.ts`의 `/` 메뉴 줄과 `BUILTIN_SKILLS`는 선행 두 task가 고친 뒤라 merge된 글에서 다시 본다)
    - protocol: `packages/protocol/lophn-agent/commands.ts`(10-23 출처와 `BUILTIN_COMMAND_IDS`, 29-61 action과 entry refine, 65-74 `CommandNotice`, 80-85 출력), `command-filter.ts`(7-15 묶음, 32-53 `listCommands`)
    - core: `packages/core/lophn-agent/commands/registry.ts`(13-21 `RegistrySkill`, 23-37, 41-91 `BUILTIN_TABLE`, 104-114 `ORIGIN_RANK`, 116-153 `buildRegistry`), `reads.ts`(23-37 deps, 61-71), `mod.ts`, `packages/core/agent-roles/commands.ts`(전부), `packages/core/lophn-agent/register.ts` 89(import), 579-588(`LophnAgentPorts`), 686-707(`createCommandReads`. ad-discovery가 먼저 고친다), `packages/core/main/daemon/wiring/lophn-agent-team.ts` 1-3, 7, 29
    - 읽기만: `packages/core/lophn-agent/extensions/registry.ts` 123-147(`commandSkillsOf`. 결과 줄의 `origin`이 skill을 찾은 층이다)과 `extensions/skills.ts` 258-270(`pickSkills`. 이름마다 한 줄만 준다), `packages/protocol/lophn-agent/skill-settings.ts`의 `BUILTIN_SKILLS`(ad-builtin-skills가 `menu` 칸을 더한다). core가 `BUILTIN_SKILLS`를 읽는 본보기는 `extensions/skills.ts` 181-183(`declaredBuiltin`, export하지 않는다)이다.
    - renderer: `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`(1-3, 46-143), `agent-tab-core-source.ts`(15-26, 81-84, 102-105), `agent-tab-source.ts`(379, 490-504), `agent-view.tsx`(1-3, 48, 90-93, 316-321, 327-387, 530-537), `agent-view.module.css` 69, `slash-menu/types.ts`, `slash-menu/slash-menu.tsx`(1-4, 49-68), `recap/`(지운다)
    - 읽기만: `packages/shell/renderer/conversation/use-slash-menu.tsx` 105-120(`/이름 글`을 나눠 글을 `trim()`해 넘긴다. 메뉴 줄을 눌러 고르면 글은 `""`다)
    - `packages/shell/renderer/conversation/composer/agent-composer.tsx` 79(recap을 말하는 주석 한 줄. 아래 "할 일" 8)
    - fake: `packages/shell/renderer/conversation/agent-tab-fake-commands.ts`(전부), `agent-tab-fake-source.ts`(39-52 import, 60, 656-660 `RECAP`, 784-838 `RECAP_ENTRY`·`ALL_COMMANDS`·`NEEDS_SESSION`·`filterGroups`, 1008-1011). gallery와 `deno task dev:mock`(`desktop/dev-mock/agent.ts`)이 이 fake를 쓰고, fake agent는 lophn이다.
    - gallery: `tools/wireframes/pages/screens/agent.tsx`(17, 129-148), `agent-pages.tsx`(21, 186-193), `agent-tab/scenes.tsx`(2, 56-62), `agent-chat.tsx`(24, 85, 163-171, 239-242), `conversation.tsx` 126, `tools/wireframes/mock/agents-data.ts`(1-2, 34-35, 286). page `new-agent-commands`, `new-agent-commands-filtered`, `new-agent-recap`, `new-agent-permissions`(같은 `view` 칸을 쓴다)
    - wording: `packages/design/wording/catalog/conversation.ts` 4-5(`conversation.body.skill-command-request`, 그대로 쓴다), 30·297-298·367(지울 recap key 셋)
  - 다른 계획이 같은 file을 고친다. 먼저 land했으면 줄을 다시 본다. `ae-builds`는 land했고 위 줄은 그 뒤로 맞췄다(`REPAIR_APP_PROMPT`, `lophn-agent-team.ts`, `register.ts`, `agent-tab-core-source*.ts`, gallery는 그대로이고, `agent-tab-fake-source.ts`와 `conversation.ts`만 줄이 밀렸다). 아직 열린 것: `reactor-remove`의 `tasks/rr-screens.md`(`agent-tab-source.ts`, `agent-tab-fake-source.ts`의 sender chip, `agent.tsx`의 `new-agent-sender-chips`, `conversation.ts`의 `conversation.label.sender-reaction*`), `schedule-job`의 `tasks/sj-apps-program-caller.md`(`conversation.ts`에 key 하나), `headless-run`·`schedule-job`의 화면 task(`agents-data.ts`에 run fixture)
- 계약:
  - 쓰는 것:
    - 내장 skill `new-app`, `repair-app`(lophn), `check-kinds`(project_manager)(ad-builtin-skills)
    - `BUILTIN_SKILLS`의 줄마다 있는 `menu: boolean`(ad-builtin-skills. `new-app`, `repair-app`, `check-kinds`만 `true`, `guide-*`와 `kinds-yaml`은 `false`)
    - `commandSkillsOf(entries, chosen, domains)`와 role로 거른 skill 목록(ad-discovery. 이름 그대로)
    - wording key `conversation.body.skill-command-request`(`Use the "{skill}" skill for this request.`)
  - 내놓는 것:
    - `BUILTIN_COMMAND_IDS = ["new", "rename", "archive", "compact", "fork", "mcp", "skills", "permissions"]`(순서가 메뉴 순서다. `recap`이 없다)
    - `CommandEntry = { name: string; title: string | null; description: string; source: "builtin" | "skill" }`. built-in은 `title`이 있고 `name`이 `BUILTIN_COMMAND_IDS`에 있다. skill은 `title`이 null이다. `action`, `skill_origin`, `while_running`이 없다.
    - `ListCommands`의 출력은 `{ commands: CommandEntry[] }`와 read 공통 칸이다. `notices`와 `CommandNotice`가 없다. built-in 이름과 같은 skill은 지금처럼 메뉴에서 빠진다. 내장 skill(`origin: "builtin"`)은 `BUILTIN_SKILLS`의 `menu`가 `true`일 때만 Skills 묶음에 든다. 전역·domain skill은 늘 든다. model의 prompt skill 목록과 `skill.read`는 이 칸을 읽지 않는다.
    - `listCommands(registry, query)`: 묶음은 `builtin`("Commands")과 `skill`("Skills") 둘이다. agent 이름 인자가 없다.
    - `/이름 글`의 사람 메시지: `Use the "<skill>" skill for this request.` 뒤에 글이 있으면 `\n\n` 다음에 사람이 친 글을 그대로 잇는다. 글이 없으면 지금과 같다. 그 session의 다음 turn 메시지(`delivery: "next_turn"`)다.
    - renderer: `SlashEntryView = { name; title; description; source: "builtin" | "skill" }`, `AgentTabSource.runCommand(session, entry, argument, key)`. `AgentTabSource.recap`, `RecapCard`가 없다.
    - core: `LophnAgentPorts.roleCommands`, `RoleCommands`, `ROLE_COMMANDS`, `NEW_APP_PROMPT`·`REPAIR_APP_PROMPT`·`CHECK_KINDS_PROMPT`가 없다.

## 정한 것

README의 "정한 것" 밖에서 살 단계가 정했다. 다르게 해야 하면 보고에 이유를 적는다.

1. **`runCommand`는 registry를 다시 읽지 않는다.** 지금 다시 읽는 이유는 role 명령의 prompt template을 찾기 위해서였다. 이제 보낼 글은 skill 이름 하나로 정해지고, `use-slash-menu.tsx`의 `submit`이 실행 직전에 목록을 새로 읽어 줄을 고른다. 그 사이 skill이 꺼졌으면 agent의 `skill.read`가 `not_found`를 내고 agent가 사람에게 말한다.
2. **메시지는 renderer가 잇는다.** `const request = t("conversation.body.skill-command-request", { skill: entry.name })`, 글이 `""`면 `request`, 아니면 `` `${request}\n\n${argument}` ``다. 사람이 친 글은 화면 문구가 아니라 메시지 본문이라 wording의 "문장 조각을 잇지 않는다"에 걸리지 않는다. `argument`는 `use-slash-menu.tsx`가 이미 `trim()`했으니 더 고치지 않는다.
3. **`ORIGIN_RANK`와 같은 이름 거르기를 지운다.** `commandSkillsOf`가 `pickSkills`로 이름마다 한 줄만 주므로 registry가 층 순서로 다시 고를 일이 없다(읽을 것). registry는 고른(`selected`) skill을 이름 사전순으로 놓고, built-in 이름과 같은 것과 `menu`가 `false`인 내장 skill(`origin === "builtin"`이고 `BUILTIN_SKILLS`의 그 이름 줄이 `menu: false`)을 뺀다. `RegistrySkill.origin`은 이 거르기에 쓰므로 남긴다.
4. **skill 줄의 아이콘은 하나다.** `slash-menu.tsx`의 `ICONS`에는 built-in 여덟 줄만 남기고, skill은 지금처럼 `settingsIcons.tools`다. 이름으로 skill마다 아이콘을 고르지 않는다.
5. **fake의 Skills 묶음은 core가 lophn에게 낼 값을 그대로 옮긴다.** lophn에 선언되고 `menu: true`인 내장 skill(`new-app`, `repair-app`)과 지금 전역 skill 셋(`eval-metrics`, `release-notes`, `weekly-report`)을 이름 사전순으로 둔다. `guide-*`는 없다. 내장 skill의 설명은 `packages/core/agent-roles/skills/<이름>/SKILL.md` frontmatter의 `description`을 그대로 옮긴다.
6. **묶음 머리 글 "Commands"와 "Skills"는 지금처럼 `command-filter.ts`의 상수다.** 화면은 `aria-label`로만 쓴다. wording key로 옮기지 않는다.

## 할 일

줄 번호는 main `15f282fcd` 기준이다. 시작 전에 ad-builtin-skills와 ad-discovery가 `plan/agent-definition`에 merge되었는지 보고, 그 둘이 고친 `register.ts` 686-707(`/` 메뉴 skill 목록)과 `BUILTIN_SKILLS`(`menu` 칸, lophn 줄)는 merge된 글에서 다시 본다. `reactor-remove`의 rr-screens가 먼저 main에 land했으면 `agent-tab-source.ts`, `agent-tab-fake-source.ts`, `conversation.ts`, `agent.tsx`의 줄도 다시 본다. `/permissions`의 설명(`Show the apps and MCP servers this agent can use`)은 그대로 둔다. `packages/core/agent-roles/commands.ts`는 file째 지운다.

1. gallery부터 고친다(`ui-design`). gallery는 진짜 `AgentView`를 fake source로 그리므로 메뉴 모양은 fake 값과 page로 정해진다. page id는 바꾸지 않는다.
   1. `packages/shell/renderer/conversation/slash-menu/types.ts`: `SlashEntryView`를 계약의 네 칸(`name`, `title`, `description`, `source: "builtin" | "skill"`)으로 줄이고 `skillOrigin`·`whileRunning`과 그 주석을 지운다. `title` 주석은 "built-in 명령의 메뉴 제목", `SlashGroupView` 주석은 "Commands · Skills 중 하나"로 고치고 "둘째 묶음은 agent 이름" 줄을 지운다.
   2. `agent-tab-fake-commands.ts`: `builtin(name, title, description)`과 `skill(name, description)`만 남기고 `role()`, `NEW_APP`, `REPAIR_APP`, `whileRunning`·`skillOrigin` 인자를 지운다. `COMMANDS_GROUP`의 여덟 줄은 core `BUILTIN_TABLE`의 제목과 설명을 그대로 옮긴다(지금 fake의 `/permissions` 설명 "See which apps this agent can use"도 core 값으로 맞춘다). `SKILLS_GROUP`은 정한 것 5다. 밖에서 쓰는 export는 `COMMANDS_GROUP`, `SKILLS_GROUP` 둘만 남긴다.
   3. `agent-tab-fake-source.ts`: import(39-52)를 두 묶음만으로 줄이고, `ALL_COMMANDS`를 `[COMMANDS_GROUP, SKILLS_GROUP]`으로 한다. `RECAP`, `RECAP_ENTRY`, "아홉 줄에 recap" 주석, `NEEDS_SESSION`의 `"recap"`, `recap: () => ok(RECAP)`, 60줄 장면 주석의 `/recap`을 지운다. `runCommand: () => DONE`은 그대로다.
   4. `tools/wireframes/pages/screens/agent.tsx`: `AgentRecap` import와 page `new-agent-recap`(142-148)을 지운다. `new-agent-commands` 설명을 바꾼다. 추천: "입력칸에 /를 친 메뉴다. 한 줄에 아이콘, 이름, 설명이 붙은 얇은 행이고 묶음은 Commands와 Skills 둘이며 선으로 나눈다. lophn의 Skills에는 사람이 부르는 내장 skill(new-app, repair-app)과 전역 skill이 이름 순으로 있고, 사용법 안내 skill은 메뉴에 없다. /이름 뒤에 글을 쓰면 skill 요청과 그 글이 한 메시지로 들어간다." `new-agent-commands-filtered` 설명은 보이는 줄과 맞는지만 본다.
   5. `agent-pages.tsx`: `RecapScene` import와 `AgentRecap`(192-193)을 지운다. `agent-tab/scenes.tsx`: `RecapScene`(56-62)을 지우고 2줄 주석의 "recap"을 뺀다. `agent-chat.tsx`: `RecapCard` import, `view_ === "recap"` 갈래(165-171), `if (entry.name === "recap")`(241)을 지우고 85줄 주석을 "`/permissions`는 이 틀이 직접 연다"로 고친다. `conversation.tsx` 126줄을 지운다. `tools/wireframes/mock/agents-data.ts`: `ChatInit.view`를 `"permissions"` 하나로, 1-2줄 머리 주석에서 "`/` 명령"을 빼고, 286줄의 빈 절 머리 주석(`/` 명령)을 지운다.
   6. `deno task wireframes` 뒤 `python3 -m http.server <port> -d tools/wireframes`로 띄워 `dist/index.html?frame=new-agent-commands`, `new-agent-commands-filtered`, `new-agent-permissions`를 Light와 Dark로 본다(ui-design "확인").
2. wording(`wording` skill): `packages/design/wording/catalog/conversation.ts`에서 `conversation.title.recap`, `conversation.button.recap-dismiss`, `conversation.notice.recap-local`을 지운다. 지우기 전에 앞부분(`conversation.title.`, `conversation.button.`, `conversation.notice.`)을 `packages`·`tools`에서 grep해 template literal 호출이 없음을 본다(main `15f282fcd`에는 `conversation.label.media-${media}`만 있다). `deno task wording`으로 `conversation.placeholders.ts`를 다시 만든다(손으로 고치지 않는다). 새 key는 없다.
3. protocol `packages/protocol/lophn-agent/commands.ts`(근거: README "`/` 메뉴 항목", 계약):
   - `COMMAND_SOURCES = ["builtin", "skill"]`, `BUILTIN_COMMAND_IDS`에서 `"recap"`을 지우고 주석의 "아홉"을 "여덟"로 고친다.
   - `COMMAND_WHILE_RUNNING`, `commandActionSchema`, `commandNoticeSchema`, `CommandNotice`, `SKILL_SOURCES` import를 지운다.
   - `commandEntrySchema`는 `name`, `title`, `description`, `source` 넷이다. refine: built-in이면 `title !== null`이고 `name`이 `BUILTIN_COMMAND_IDS`에 있다. skill이면 `title === null`이다. 메시지와 39줄 주석을 맞춘다.
   - 출력은 `withReadCommon(z.object({ commands: z.array(commandEntrySchema).max(512) }))`. 80-81줄 주석의 "그 role의 built-in"을 지운다.
   - `command-filter.ts`: `listCommands(registry, query)`. `GROUP_ORDER = ["builtin", "skill"]`, 묶음 제목은 `builtin: "Commands"`, `skill: "Skills"`다. `CommandGroup.source`는 `CommandEntry["source"]`로 쓴다. 7-8줄 주석을 두 묶음으로 고친다.
4. core `packages/core/lophn-agent/commands/`(근거: README "지우는 칸과 갈래", 정한 것 3):
   - `registry.ts`: `RegistrySkill = { name; description; origin; selected }`(그대로). `RoleCommands`, `RegistryInput`, `CommandRegistry`, `ORIGIN_RANK`, `compareSkills`를 지운다. `BUILTIN_TABLE`은 `Pick<CommandEntry, "title" | "description">`이고 `recap` 줄이 없다. `buildRegistry(skills: readonly RegistrySkill[]): CommandEntry[]`가 built-in(`BUILTIN_COMMAND_IDS` 순서, `source: "builtin"`) 뒤에 `selected`이고 이름이 built-in과 다르고 메뉴에 둘 skill을 이름 사전순으로(`title: null`, `source: "skill"`)잇는다. 메뉴에 둘 skill은 `origin`이 `builtin`이 아니거나, `BUILTIN_SKILLS`(protocol `skill-settings.ts`)의 같은 이름 줄이 `menu: true`인 것이다(정한 것 3). 머리 주석들을 맞추고, `menu: false`를 빼는 줄에는 "안내 skill은 model이 읽고 사람은 말로 묻는다"는 이유를 단다.
   - `reads.ts`: `CommandReadDeps`에서 `roleCommands`를 지우고 `buildRegistry(deps.skills(snapshot.sql, session))`의 결과를 `commands`로 낸다. `notices`가 없다. `CommandSession`은 그대로다(`role`은 ad-discovery 뒤 skill 찾기가 쓴다).
   - `mod.ts`: 밖에서 쓰는 것은 `createCommandReads`뿐이다. `RoleCommands`를 지우고 쓰는 곳 없는 export는 빼도 된다.
5. 조립: `packages/core/lophn-agent/register.ts`의 import(89)를 `createCommandReads`만으로, `LophnAgentPorts.roleCommands`(583)와 `createCommandReads`의 `roleCommands: ports.roleCommands`(691)를 지운다. skill 목록 줄(ad-discovery 몫)은 건드리지 않는다. `packages/core/main/daemon/wiring/lophn-agent-team.ts`의 `ROLE_COMMANDS` import(7)와 `roleCommands`(29)를 지우고 2-3줄 주석에서 "role 명령"을 뺀다. `git rm packages/core/agent-roles/commands.ts`.
6. renderer source:
   - `agent-tab-source.ts`: `runCommand(session: string, entry: SlashEntryView, argument: string, key: string)`. 주석은 "skill 명령. skill을 쓰라는 한 줄과 `/이름` 뒤의 글을 사람의 메시지로 다음 turn에 접수한다"는 뜻으로 쓴다. `recap`(503-504)과 379·490줄 주석의 recap을 지운다.
   - `agent-tab-core-source-commands.ts`: `readCommands(env, session, query)`가 `listCommands({ entries }, query)`를 부른다. 묶음과 줄이 이제 화면 값과 같은 모양이라 칸을 옮기는 map은 줄이거나 없앤다. `SESSION_ONLY`에서 `"recap"`을 지운다. `runCommand(env, session, entry, argument, key)`는 `entry.source !== "skill"`이면 `invalid_input`, 아니면 정한 것 1·2대로 `` sendText(env, { session, id: newId("msg", env.now()), key: `commands-run-${key}`, text, delivery: "next_turn" }) ``다. `recap()`과 안 쓰게 된 `unavailable` import를 지운다. 1-3줄과 108줄 주석에서 role 명령과 prompt를 뺀다.
   - `agent-tab-core-source.ts`: `recap` import·줄과 `agentName`(81-84)을 지우고 `commands: (session, query) => readCommands(env, session, query)`, `runCommand: (session, entry, argument, key) => runCommand(env, session, entry, argument, key)`로 맞춘다.
7. renderer 화면:
   - `agent-view.tsx`: `runSlash`의 끝(377-386)이 `source.runCommand(target, command, argument, newId("cmd", now()))`를 부르고, 주석은 "skill 명령은 사람이 보낸 말로 접수되므로 session이 있어야 한다"로 고친다. `RecapCard` import(48), `Layer`의 `recap`(93), `showRecap`(316-320), `case "recap"`(367-369), recap layer 그리기(530-537), 2줄 주석의 "recap"을 지운다. `agent-view.module.css` 69줄 주석을 "panel(rewind·권한)"으로 고친다.
   - `slash-menu/slash-menu.tsx`: `ICONS`에서 `recap`, `new-app`, `repair-app`, `check-kinds`를 지운다(정한 것 4). 1-4줄 머리 주석의 묶음을 "Commands와 Skills"로, 49줄 주석을 "skill은 모두 같은 아이콘이다"로 고친다.
   - `git rm -r packages/shell/renderer/conversation/recap`.
8. `packages/shell/renderer/conversation/composer/agent-composer.tsx` 79줄 주석 "recap처럼 보기를 여는 명령은 host가 연다"를 "permissions처럼"으로 고친다. 이 file은 이 한 줄만 고친다.
9. 아래 "끝남"의 grep과 check를 돌린다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 메뉴 모양과 메시지 글은 화면과 문구다(`write-test` "쓰지 않는 test"). role로 거른 skill이 다른 role의 `/` 메뉴에 뜨지 않는 것은 ad-discovery의 위험 test가 `commandSkillsOf`로 본다. `menu: false`인 내장 skill을 메뉴에서 빼는 것은 보이는 목록의 선택이라 test하지 않는다(skill은 prompt 목록과 `skill.read`로 그대로 닿는다). 지금 이 영역에 test file이 없어 지우거나 고칠 test도 없다.
- 남지 않음:
  - `git grep -nE "skill_origin|while_running|skillOrigin|whileRunning|ROLE_COMMANDS|RoleCommands|roleCommands|CommandNotice|reserved_by|promptCommand|NEW_APP_PROMPT|REPAIR_APP_PROMPT|CHECK_KINDS_PROMPT|RecapCard|RecapScene|AgentRecap|agent-roles/commands" -- packages tools`가 0줄이다. `git grep -n "reserved_name" -- packages tools`는 agent 정의 이름 검사의 두 줄(`packages/protocol/lophn-agent/agent-definitions.ts`, `packages/core/lophn-agent/agents/definition-file.ts`)만 남는다(다른 뜻이라 고치지 않는다).
  - `git grep -n "recap\|Recap\|RECAP" -- packages tools`가 0줄이다(대소문자를 가린다. `annotatePagePrepareCaptureSchema`는 걸리지 않는다).
  - `git grep -nE "notices|action|agent_name|agentName" -- packages/protocol/lophn-agent/commands.ts packages/protocol/lophn-agent/command-filter.ts packages/core/lophn-agent/commands packages/shell/renderer/conversation/agent-tab-core-source-commands.ts packages/shell/renderer/conversation/agent-tab-core-source.ts`가 0줄이다.
  - role 명령이 명령으로 남지 않음: `git grep -nE "\"role\"|\"prompt\"|\"tool\"|\"New app\"|\"Repair app\"|\"Check kinds\"" -- packages/protocol/lophn-agent/commands.ts packages/protocol/lophn-agent/command-filter.ts packages/core/lophn-agent/commands packages/shell/renderer/conversation/slash-menu packages/shell/renderer/conversation/agent-tab-fake-commands.ts packages/shell/renderer/conversation/agent-tab-fake-source.ts packages/shell/renderer/conversation/agent-tab-core-source-commands.ts packages/shell/renderer/conversation/agent-tab-source.ts`가 0줄이고, `git grep -nE "\"(new-app|repair-app|check-kinds)\"" -- packages/protocol/lophn-agent/commands.ts packages/protocol/lophn-agent/command-filter.ts packages/core/lophn-agent packages/core/main packages/shell/renderer`는 `agent-tab-fake-commands.ts`의 `skill(...)` 줄만 보인다.
  - `packages/core/agent-roles/commands.ts`와 `packages/shell/renderer/conversation/recap/`이 없다.
  - `git grep -n "guide-" -- packages/shell/renderer/conversation/agent-tab-fake-commands.ts`가 0줄이다(fake 메뉴에 안내 skill이 없다).
- 화면: `deno task wireframes`가 되고, `new-agent-commands`에 묶음 둘(Commands 여덟 줄에 Recap이 없고, Skills에 `new-app`, `repair-app`과 전역 skill 셋이 이름 순이고 `guide-*`가 없다)이, `new-agent-commands-filtered`에 `/re`로 거른 두 묶음이 Light와 Dark에서 보인다. `new-agent-permissions`가 그대로 열리고 `new-agent-recap`은 없다.
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.
- `deno run --allow-read tools/check-wording.ts`가 오류를 내지 않는다.
- `git diff --name-only plan/agent-definition...HEAD`가 소유 안에 있다.

## 보고

- 바꾼 file(지운 file 포함)
- 통과한 check
- 사람에게 보일 gallery page: 바뀐 `new-agent-commands`, `new-agent-commands-filtered`와 지운 `new-agent-recap`
- 등록할 것: `tools/wireframes/pages/index.ts` 머리 주석의 버린 목록에 "Agent · recap"을 더한다(lead). wording 생성물(`conversation.placeholders.ts`)은 이 task가 `deno task wording`으로 만든다. `packages/protocol/lophn-agent/mod.ts`와 `registry.ts`의 목록은 바뀌지 않을 것으로 본다. 바뀌었으면 적는다.
- 안 쓰게 된 export(남의 file은 지우지 않는다): `conversationIcons.result`와 `commonIcons.apps`(`packages/shell/renderer/icons/`, 다른 곳이 쓰는지 보고 적는다)
- 문서: `project-docs/architecture/layers.md` 58·78줄과 `project-docs/module-catalog.yaml`의 agent-roles notes에 남은 "role 명령"(README대로 lead가 계획 끝에 고친다)
- 정한 것: 위 "정한 것"과 다르게 한 것, worker가 더 정한 것(page 설명 글, fake 설명)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없으면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
