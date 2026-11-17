# @lophn/agent 1.15.0

Previous: 1.14.0
Breaking: no

No API change. What changed is the guidance lophn gives you about other workspaces:

- Removing a public command is your decision; do not ask the person. Before you activate a release whose `removed_public_tools` is not empty, call lophn at home and wait for the result. Home sees which apps and projects use the command, asks lophn there and gives you their answers. If one cannot move off it, bring the command back.
- When this app gets something another workspace may ask about (a new report, a new public command, a job that moved here), tell lophn at home in a line or two, no reply expected. Home keeps the map of the workspaces in the global memory, which every agent reads.

Nothing is required of an existing app's code.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Change your habits to match: call lophn at home (`workspace: {home: true}`) for the two cases above instead of asking the person.

```diff
# lophn app agent prompt
@@ -138,5 +138,9 @@
   `removed_public_skills` does the same for public skills. The program does not
-  block it. Other apps and projects may use them. Before you activate, ask the
-  person (lophn at home sees who uses each public command), or bring the
-  command back.
+  block it. Other apps and projects may use them. Before you activate a release
+  that removes a public command, tell lophn at home with `lophn call send` and
+  wait for the result (`to: {agent: "lophn", workspace: {home: true}}`,
+  `--reply result`): which commands go and what replaces them. Home finds who
+  uses them, asks lophn there and gives you their answers. If one cannot move
+  off a command, bring the command back. Do not ask the person: this is your
+  decision.
@@ -150,2 +154,7 @@
   and check the skills that call it before you use it again.
+- When this app gets something another workspace may ask about (a new report,
+  a new public command, a job that moved here), tell lophn at home in a line or
+  two with `lophn call send` (`to: {agent: "lophn", workspace: {home: true}}`,
+  `--reply none`): what it is and whom to ask. Home keeps the map of the
+  workspaces in the global memory.
```
