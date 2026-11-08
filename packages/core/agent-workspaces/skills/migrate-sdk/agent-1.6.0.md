# @lophn/agent 1.6.0

Previous: 1.5.0
Breaking: no

No API change. What changed is the guidance lophn gives you: the lophn that builds and migrates this app now has a memory, a small notes file that lophn puts in its system prompt at the start of each session. It writes the person's decisions there (whether to update the SDK, which features to adopt) and looks there before it asks the person again.

Nothing is required of an existing app's code.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Change your habits to match:

- Before you ask the person about a migration or a feature, look in your Memory for what they already decided about this app. If they settled it, follow it and say only that you did.
- When the person answers, write the decision in your Memory with `agent.memory`. Keep it short: the file is limited to 8 KiB.

```diff
diff --git a/packages/core/agent-workspaces/skills/migrate-sdk/SKILL.md b/packages/core/agent-workspaces/skills/migrate-sdk/SKILL.md
--- a/packages/core/agent-workspaces/skills/migrate-sdk/SKILL.md
+++ b/packages/core/agent-workspaces/skills/migrate-sdk/SKILL.md
@@ -111,5 +111,8 @@ be lost before you activate; if you are not sure, do not drop it.
 
 If the app uses something the notes do not cover, or a note's change would
-change what the app does, stop and ask the person (`ask`). Do not guess.
+change what the app does, first look in your Memory for what the person already
+decided about it. If they settled it, follow that and say only that you did. If
+not, stop and ask the person (`ask`); do not guess. When they answer, write the
+decision in your Memory with `agent.memory`.
 
 ## 11. Features chosen by the person
@@ -119,7 +122,8 @@ released and working, as a separate change. Each feature is a proposal the
 person picked from a short description, not a finished spec: confirm what they
 want in this app's conversation (`ask` for the open choices, such as the
-threshold or whether it is persistent), design it with the `design-app` skill,
-read the notes of the version that adds it for the exact API, then implement,
-check, preview and release as in steps 6 and 7. If a feature does not fit once
+threshold or whether it is persistent; skip a choice your Memory already holds,
+follow it, and write each new answer there with `agent.memory`), design it with
+the `design-app` skill, read the notes of the version that adds it for the exact
+API, then implement, check, preview and release as in steps 6 and 7. If a feature does not fit once
 you see the code, say so and skip it instead of forcing it.
 
diff --git a/packages/sdk/agent/guide.md b/packages/sdk/agent/guide.md
--- a/packages/sdk/agent/guide.md
+++ b/packages/sdk/agent/guide.md
@@ -71,4 +71,6 @@ import { contextBlock, useAgentSession } from "@lophn/agent";
   절에 절차를 적는다. lophn 기본 agent를 상대로 쓰지 않는다: 제품 규칙과 tool이
   매 turn마다 실려 느리고 비싸다.
+- 앱을 짓고 옮기는 lophn은 사람이 정한 것(SDK를 올릴지, 어떤 기능을 쓸지)을 자기 memory(`agent.memory`)에
+  적고, 사람에게 다시 묻기 전에 memory부터 본다. 이미 정한 것은 묻지 않는다.
 - `contextBlock({name, mimeType, text})` — 화면의 context(보고 있는 글, 고른 항목)를
   `resource` block으로 싼다. 같은 `name`이 한 메시지에서 구별되게 짓는다.
```
