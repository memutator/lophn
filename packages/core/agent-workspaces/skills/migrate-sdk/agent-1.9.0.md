# @lophn/agent 1.9.0

Previous: 1.8.0
Breaking: no

No API change. What changed is the guidance lophn gives you: the Memory block in your system prompt now has up to three sources, in this order: `global memory`, `workspace memory`, `agent memory`. The global memory is the notes lophn at home keeps. It holds facts that cross workspaces (the person's accounts and preferences, the map of the workspaces, what the person decided about each app). You can read it but not write it.

Nothing is required of an existing app's code.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Change your habits to match:

- Look in the global memory before you ask the person about a fact that crosses workspaces. If it is not there, ask the person. Do not call lophn at home for it: a call without a workspace from this app reaches this app's own lophn, not lophn at home.
- Write to your memory only what belongs to this app. Do not copy the global memory into it.
- The list of logins is read with `lophn login list`; do not copy it into memory. Write only the choice of which login is for which job.
- To bring something to lophn at home (reuse across apps, a new project, a public command removal), tell the person instead of sending a call.

```diff
--- a/packages/core/agent-workspaces/prompts/app.md
+++ b/packages/core/agent-workspaces/prompts/app.md
@@ -102,5 +102,4 @@ information). Use `lophn app link-source` only for an existing git repo with a c
   `removed_public_skills` does the same for public skills. The program does not
-  block it. Other apps and projects may use them. Before you activate, tell lophn
-  at home, which sees who uses each public command (`to: {agent: "lophn"}`),
-  with `lophn call send`, no reply expected, and ask the person, or bring the
+  block it. Other apps and projects may use them. Before you activate, ask the
+  person (lophn at home sees who uses each public command), or bring the
   command back.
@@ -120,3 +119,5 @@ Your memory is the notes this app keeps between sessions. It is in your system
 prompt under "Memory", and every agent in this app sees it. You write it with
-`agent.memory`; what you write shows from the next session, not in this one.
+`agent.memory`; what you write shows from the next session, not in this one. The
+global memory is also in "Memory". It is read-only for you: lophn at home writes
+it, and it holds the facts that cross workspaces.
 
@@ -126,4 +127,4 @@ Write down:
 - A pointer: what to ask whom, when the answer lives elsewhere.
-- What you do not know about other workspaces is asked of lophn at home
-  (`to: {agent: "lophn"}`); write down whom to ask, not the answer.
+- A fact that crosses workspaces is in the global memory. If it is not there,
+  ask the person.
 
@@ -135,2 +136,4 @@ Do not write down:
 - Guesses. A note is a decision only if the person made it.
+- The list of logins is read with `lophn login list`, so do not copy it here.
+  Write only the choice: which login is for which job.
 
@@ -142,4 +145,3 @@ rejected with the current size, so replace or drop stale notes first.
 - Do not plan beyond the app. Reuse across apps and a new
-  project go to lophn at home (`to: {agent: "lophn"}`) with `lophn call send`, no reply
-  expected. Material for the app to read goes to lophn at that project with
+  project go to the person, who asks lophn at home. Material for the app to read goes to lophn at that project with
   `lophn call send`, result expected.
```
