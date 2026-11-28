# @lophn/declaration 6.2.0

Previous: 6.1.0
Breaking: no. Move together with `@lophn/app-ui` 2.26.2 or `@lophn/app-ui-native` 1.12.2 (they depend on this exact version).

An app's public skill now reaches other agents by deployment, not by assignment. `lophn app share` is gone. A person or an agent runs `lophn skill deploy <app> <skill> --to <where>` after the release is active; the built-in skill `deploy-skill` says where and how. Deployed skills follow the app's active release and receivers cannot edit them. An app with no public skill cannot be deployed: an attended agent's call to its commands from outside asks the person each time, and jobs and flows are refused. The declaration itself did not change.

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/6.1.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/6.2.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`).

Nothing is required of an existing app. Do these when you next work on it:

- Cover every command the app offers to agents outside it with a public skill (`skills: [{ name, public: true, commands }]`, `.lophn/skills/<name>/SKILL.md`), release it, then deploy it (`deploy-skill`). Read `write-skill` to write it.
- Where the app's `AGENTS.md` or `DESIGN.md` says "Shared skills" or tells you to run `lophn app share`, follow the instruction diff below.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`: in the lophn-managed part, replace the `lophn app share` bullet with the `deploy-skill` bullet and change the guide path example to `6.2.0`. From now on, never run `lophn app share`; deploy with `lophn skill deploy`. Name the DESIGN.md section "Public skills".

```diff
# design-app skill
@@ -2,3 +2,3 @@
 name: design-app
-description: Design an app or a change in DESIGN.md before building it: operations vs commands, shared skills, desktop and phone screens (@lophn/ui-native, @lophn/app-ui-native), phone native features (@lophn/cap-phone) and app files (@lophn/cap-store), widgets, runs_on phone backends, cross-computer table sync and across_machines events, and in-app custom agents.
+description: Design an app or a change in DESIGN.md before building it: operations vs commands, public skills, desktop and phone screens (@lophn/ui-native, @lophn/app-ui-native), phone native features (@lophn/cap-phone) and app files (@lophn/cap-store), widgets, runs_on phone backends, cross-computer table sync and across_machines events, and in-app custom agents.
 ---
@@ -45,4 +45,4 @@ Sections, in this order:
      output, rules, public or not.
-   - Shared skills: the skills the app gives to other agents (see "Sharing
-     with other agents"): name, who it is for, the commands it calls.
+   - Public skills: the skills other agents receive (see "Public skills for
+     other agents"): name, who it is for, the commands it calls.
 7. Failure branches: refusals, failed outside calls, silent fallbacks. Name each
@@ -76,3 +76,3 @@ An app has two layers. Give each action to the right one.
 
-## Sharing with other agents
+## Public skills for other agents
 
@@ -83,15 +83,12 @@ agent that files the person's receipts, are examples. If it is:
 1. Make the commands it needs public, and keep them few.
-2. Write `.lophn/skills/<name>/SKILL.md`: when to use the skill, which commands
-   it calls with `lophn <app> <command>`, and how to read their results.
-   The description says only what the skill does. Commit the folder; release
-   prepare fails when it is missing from the commit.
+2. Write `.lophn/skills/<name>/SKILL.md` (read `write-skill`): when to use the
+   skill, which commands it calls with `lophn <app> <command>`, and how to read
+   their results. The description says when to read it. Commit the folder;
+   release prepare fails when it is missing from the commit.
 3. Declare it in `lophn.ts` `skills: [{name, public: true, commands}]`.
    `commands` are the public commands of this app that the skill calls.
-4. Write it under "Shared skills" in DESIGN.md.
-5. Run `lophn app share --agent <handle>... [--coding-agents] --reason <text>`
-   for the agents that should get it, before or after `release activate`. It only
-   opens a request; nothing is given until the person approves. If the
-   activation is waiting for consent, the request is shown on that consent and
-   approved with it, so do not ask the person to approve sharing separately.
-   Otherwise it waits in the waiting list; tell the person.
+4. Write it under "Public skills" in DESIGN.md.
+5. After `release activate`, read `deploy-skill` to give it to the agents that
+   should have it. An app with no public skill cannot be deployed, and every
+   attended outside call to its commands asks the person, and jobs and flows are refused.
 
@@ -354,3 +351,3 @@ about it.
    command of this app's workspace and this app's own commands (it may call
-   them without anyone assigning them). `tools` cannot name commands: it takes
+   them without a deployed skill). `tools` cannot name commands: it takes
    only built-in tool names, `mcp__<server>__<tool>` and `ext__<id>__<tool>`.
# app AGENTS.md template
@@ -58,3 +58,3 @@ Package를 쓴다.
   보이고, 값은 앱 코드가 검사한다. 쓰는 법과 예는 설치 사본의
-  `guide.md`(`.lophn/sdk/agent/1.19.0/guide.md`)다.
+  `guide.md`(`.lophn/sdk/agent/1.21.0/guide.md`)다.
 - token과 기본 글꼴은 `@lophn/ui/tokens.css`·`base.css`로 받는다. 앱의 chrome(버튼,
@@ -158,7 +158,6 @@ Package를 쓴다.
   `DESIGN.md`에도 적는다.
-- release를 활성화한 뒤 `lophn app share --agent <name>... [--coding-agents] --reason <글>`로
-  받을 agent를 제안한다. 요청은 사람이 승인해야 효력이 있고, 그제야 할당과 skill 복사가
-  일어난다. activation 동의가 기다리는 중이면 그 동의와 한 번에 승인되니 따로 승인을
-  부탁하지 않는다(activation 전에 먼저 청해도 된다). `--coding-agents`는 사람의 coding agent의 skill 폴더에
-  public skill을 복사한다.
+- release를 활성화한 뒤 내장 skill `deploy-skill`을 읽고 `lophn skill deploy <앱> <skill> --to <어디>`로
+  그 skill을 받을 agent·workspace·전역·사람의 coding agent(`harness`)에 배포한다. 이 앱 workspace의
+  agent는 `harness`만 빼고 묻지 않고 배포한다(`harness`는 늘 사람에게 묻는다). 배포한 skill은 받는 쪽이 고치지 못하고 앱의 active release를 따라간다.
+  public skill이 없는 앱은 배포할 수 없다: 사람이 지켜보는 agent의 밖 호출은 매번 사람에게 묻고, job·flow의 호출은 막힌다.
 
# declaration guide
@@ -82,4 +82,6 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   한다. 없는 command나 비공개 command를 쓰는 public skill은 선언 오류다.
-  공개 skill을 지우는 release는 막지 않고, 그 앱을 할당받은 agent가 있으면 준비 결과의
-  `removed_public_skills`에 그 skill이 실린다.
+  공개 skill을 지우는 release는 막지 않고, 그 앱의 skill이 배포된 agent가 있으면 준비 결과의
+  `removed_public_skills`에 그 skill이 실린다. 배포는 `lophn skill deploy`이고(내장 skill `deploy-skill`),
+  public skill이 없는 앱은 배포할 수 없다: 사람이 지켜보는 agent의 밖 호출은 매번 사람에게 묻고, job·flow의 호출은 막힌다.
+  flow의 `tool()`은 그 flow의 agent에게 그 workspace에서 그 앱의 skill이 어느 층(전역, workspace, agent)으로든 닿고 꺼져 있지 않을 때 부를 수 있다.
 - `keys` — 앱이 내는 key(단축키) 목록이다. 항목은 `{id, title, key: {mac?, other}, context?}`다.
@@ -182,3 +184,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
     입력 필드 `start_time`의 flag는 `--start-time`이다. JSON 입력과 handler 이름은 원래 이름을 쓴다.
-    실제 호출법은 `lophn <slug> --help`로 확인한다. 앱 command는 호출마다 현재 선언과 할당을 읽으므로
+    실제 호출법은 `lophn <slug> --help`로 확인한다. 앱 command는 호출마다 현재 선언과 배포를 읽으므로
     새 command를 쓰려고 새 session을 열 필요는 없다.
```
