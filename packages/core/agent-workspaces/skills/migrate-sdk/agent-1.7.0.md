# @lophn/agent 1.7.0

Previous: 1.6.0
Breaking: no

No API change. The agent runtime named `bare` is now named `custom`. It is the same thing: an agent whose system prompt is only its instruction body and that loads only the tools and skills the person picked. Agents lophn already stored with `runtime: bare` are renamed to `runtime: custom` when lophn starts, so nothing breaks.

Nothing is required of an existing app's code. If the app's own text or notes call its in-app agent a "bare agent", call it a "custom agent".

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Change your habits to match:

- When the app needs its own agent (opponent, coach, reviewer), create a custom agent in this app's workspace (`runtime: custom`, `tools: []`). Never write `runtime: bare`: lophn no longer accepts that value.
- In your `AGENTS.md`, update the lophn-managed line below to say "custom agent".

```diff
diff --git a/packages/core/agent-workspaces/skills/design-app/SKILL.md b/packages/core/agent-workspaces/skills/design-app/SKILL.md
--- a/packages/core/agent-workspaces/skills/design-app/SKILL.md
+++ b/packages/core/agent-workspaces/skills/design-app/SKILL.md
@@ -223,7 +223,7 @@ about it.
-2. Make it bare (`runtime: bare`) with `tools: []` and text modality. A bare
+2. Make it custom (`runtime: custom`) with `tools: []` and text modality. A custom
diff --git a/packages/core/apps/packages/template/app/AGENTS.md.tmpl b/packages/core/apps/packages/template/app/AGENTS.md.tmpl
--- a/packages/core/apps/packages/template/app/AGENTS.md.tmpl
+++ b/packages/core/apps/packages/template/app/AGENTS.md.tmpl
@@ -41,7 +41,7 @@ Package를 쓴다.
-  `lophn agent create <handle>`로 bare agent(지침만 싣고 `tools: []`)를 만들고 그 handle을
+  `lophn agent create <handle>`로 custom agent(지침만 싣고 `tools: []`)를 만들고 그 handle을
diff --git a/packages/sdk/agent/guide.md b/packages/sdk/agent/guide.md
--- a/packages/sdk/agent/guide.md
+++ b/packages/sdk/agent/guide.md
@@ -65,7 +65,7 @@ import { contextBlock, useAgentSession } from "@lophn/agent";
-- 앱 안에서 쓸 agent(상대 선수, 코치, 검토자)는 **bare agent를 이 앱 workspace에서
+- 앱 안에서 쓸 agent(상대 선수, 코치, 검토자)는 **custom agent를 이 앱 workspace에서
```
