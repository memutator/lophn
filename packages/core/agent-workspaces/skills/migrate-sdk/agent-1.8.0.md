# @lophn/agent 1.8.0

Previous: 1.7.0
Breaking: no

No API change. A custom agent (`runtime: custom`) now always has the `lophn` tool: every lophn command of its workspace and the commands of this app, exactly what the default lophn agent can call. Before, it had the tool only when its `tools` named individual commands (`call.reply`, `tab.open`, `<slug>.<command>`). `tools` no longer takes command names: saving one is `invalid_input`, and command names already stored in an agent's `tools` are removed when lophn starts. `tools` still takes built-in tool names, `mcp__<server>__<tool>` and `ext__<id>__<tool>`. What a custom agent still does not load: the product rules, instruction layers, workspace info and workspace memory.

Nothing is required of an existing app's code. An in-app agent that was created with `tools: []` now also has the `lophn` tool, so tell it in its instructions to answer directly and call no `lophn` command unless the app needs it to.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Change your habits to match:

- Never put commands in a custom agent's `tools`. When the agent must act on app data, it already has the commands: say in its instructions when to call which.
- Tell an in-app agent that only answers JSON to answer directly and not to call any `lophn` command.
- In your `AGENTS.md`, update the lophn-managed line below.

```diff
diff --git a/packages/core/agent-workspaces/skills/design-app/SKILL.md b/packages/core/agent-workspaces/skills/design-app/SKILL.md
--- a/packages/core/agent-workspaces/skills/design-app/SKILL.md
+++ b/packages/core/agent-workspaces/skills/design-app/SKILL.md
@@ -226,12 +226,16 @@ about it.
 2. Make it custom (`runtime: custom`) with `tools: []` and text modality. A custom
-   agent gets only the instructions you write. Write them as a role, not a
-   chat: who it is, what the app sends it (name each context block), the exact
-   reply shape (the JSON fields and their meaning), and "do not use tools" is
-   unnecessary because it has none. Add a one-line `description`.
+   agent gets only the instructions you write and the `lophn` tool (see step 3);
+   it has no file, shell or web tools unless you pick them. Write the
+   instructions as a role, not a chat: who it is, what the app sends it (name
+   each context block), the exact reply shape (the JSON fields and their
+   meaning), and that it answers directly without calling any `lophn` command
+   unless step 3 applies. Add a one-line `description`.
 3. Prefer "the app assembles the context, the agent answers JSON". The screen
    sends the board, the draft or the history as context blocks and asks for a
-   reply schema. Give the agent commands only when it must act on app data; then
-   pick only this app's commands in `tools` (the app's own agent may call its
-   own commands without anyone assigning them) and say in the instructions when
-   to call which.
+   reply schema. A custom agent always has the `lophn` tool with every lophn
+   command of this app's workspace and this app's own commands (it may call
+   them without anyone assigning them). `tools` cannot name commands: it takes
+   only built-in tool names, `mcp__<server>__<tool>` and `ext__<id>__<tool>`.
+   When the agent must act on app data, say in the instructions when to call
+   which command.
diff --git a/packages/core/apps/packages/template/app/AGENTS.md.tmpl b/packages/core/apps/packages/template/app/AGENTS.md.tmpl
--- a/packages/core/apps/packages/template/app/AGENTS.md.tmpl
+++ b/packages/core/apps/packages/template/app/AGENTS.md.tmpl
@@ -43,3 +43,3 @@ Package를 쓴다.
-  `lophn agent create <handle>`로 custom agent(지침만 싣고 `tools: []`)를 만들고 그 handle을
+  `lophn agent create <handle>`로 custom agent(지침과 `lophn` tool만 싣고 `tools: []`)를 만들고 그 handle을
diff --git a/packages/sdk/agent/guide.md b/packages/sdk/agent/guide.md
--- a/packages/sdk/agent/guide.md
+++ b/packages/sdk/agent/guide.md
@@ -68,3 +68,4 @@ import { contextBlock, useAgentSession } from "@lophn/agent";
 - 앱 안에서 쓸 agent(상대 선수, 코치, 검토자)는 **custom agent를 이 앱 workspace에서
-  먼저 만들고**(`lophn agent create`, 지침에 역할과 답 꼴을 쓰고 `tools: []`) 그
+  먼저 만들고**(`lophn agent create`, 지침에 역할과 답 꼴을 쓰고 `tools: []`. custom은
+  `lophn` tool을 늘 받으니 명령을 부를 일이 없으면 지침에 그렇게 쓴다) 그
```
