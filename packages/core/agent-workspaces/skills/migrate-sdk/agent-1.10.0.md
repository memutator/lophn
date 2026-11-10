# @lophn/agent 1.10.0

Previous: 1.9.0
Breaking: no

No API change. What changed is the guidance lophn gives you about SDK updates: lophn now records, for every app, which SDK versions the person's decision covered and what became of each feature Home handed over. When Home hands you features, you report the result of each one with a command, so Home can see whether it is done. The decision to update or leave an app and the progress of a feature are not memory notes, neither in the global memory nor in yours: they are in lophn's records and are read with `lophn app sdk-status`.

Nothing is required of an existing app's code.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Change your habits to match:

- When a handoff from Home lists features, each has an ID (`sdf_...`). After you know what became of one, run `lophn app sdk-feature <feature ID> --state done|changed|skipped --note "<one line>"`. `done` is built as proposed, `changed` is built differently after talking to the person, `skipped` is not built. A feature without a result stays open and Home treats it as unfinished.
- Keep in your Memory only what the person chose inside this app (a threshold, a shortcut key). Do not write "the person agreed to update the SDK" or a feature's progress there: lophn records those. The global memory does not hold them either.
- The migration itself needs no report: it shows as the new pin once the release is live.

```diff
diff --git a/packages/core/agent-workspaces/prompts/app.md b/packages/core/agent-workspaces/prompts/app.md
--- a/packages/core/agent-workspaces/prompts/app.md
+++ b/packages/core/agent-workspaces/prompts/app.md
@@ -148,6 +148,8 @@ Do not write down:
 - What belongs to another workspace. Do not copy another workspace's content
   here; ask it with `lophn call send`.
 - Guesses. A note is a decision only if the person made it.
+- SDK update decisions and the progress of features lophn at home handed you:
+  lophn records them, and you report each feature with `lophn app sdk-feature`.
 - The list of logins is read with `lophn login list`, so do not copy it here.
   Write only the choice: which login is for which job.
 
diff --git a/packages/core/agent-workspaces/skills/migrate-sdk/SKILL.md b/packages/core/agent-workspaces/skills/migrate-sdk/SKILL.md
--- a/packages/core/agent-workspaces/skills/migrate-sdk/SKILL.md
+++ b/packages/core/agent-workspaces/skills/migrate-sdk/SKILL.md
@@ -11,10 +11,11 @@ what changed in each version is in note files beside this file.
 
 If you are lophn at Home, you do not change apps (you cannot read their
 source). Read the `update-apps` skill: it looks at all apps as a whole, decides
-per app whether to migrate, adopt new features or leave it, asks the person, and
-hands each chosen app to lophn at that app (`lophn call send`, no reply
-expected) with the required migration, the chosen features, the target
-versions, the note files and "follow the migrate-sdk skill". Skip archived apps.
+per app whether to migrate, adopt new features or leave it, asks the person,
+records each decision with `lophn app sdk-decide`, and that one command hands the
+app to lophn at that app (no reply expected) with the target versions, the note
+files, the chosen features (each with an ID) and "follow the migrate-sdk skill".
+Skip archived apps.
 
 If you are lophn at the app, do steps 1 to 12 for this app only.
 
@@ -119,21 +120,33 @@ decision in your Memory with `agent.memory`.
 
 ## 11. Features chosen by the person
 
-Only if the handoff from Home lists features. Do this after the migration is
-released and working, as a separate change. Each feature is a proposal the
+Only if the handoff from Home lists features (each has an ID like `sdf_...`).
+Do this after the migration is released and working, as a separate change. Each
+feature is a proposal the
 person picked from a short description, not a finished spec: confirm what they
 want in this app's conversation (`ask` for the open choices, such as the
 threshold or whether it is persistent; skip a choice your Memory already holds,
 follow it, and write each new answer there with `agent.memory`), design it with
 the `design-app` skill, read the notes of the version that adds it for the exact
 API, then implement, check, preview and release as in steps 6 and 7. If a feature does not fit once
-you see the code, say so and skip it instead of forcing it.
+you see the code, say so and skip it instead of forcing it. What the person
+decides about a feature's details (a threshold, a shortcut key) is a preference
+only you can keep: it goes in your Memory as above, not in the report.
 
 ## 12. Report
 
 Tell the person in their words what changed in the app for them: whether it
 runs as before, what they can now do, and what to try. List each chosen feature
 as done, changed after talking to the person, or skipped with the reason. If
-something was left undone, say what and why. Put the package versions, the code
-changes and what you verified (check, tests, preview) in the commit message, and
-give them to the person only if they ask.
+something was left undone, say what and why.
+
+Record the result of each feature the handoff listed, so lophn at Home can see
+it: `lophn app sdk-feature <feature ID> --state done|changed|skipped --note
+"<one line>"`. `done` is built as proposed, `changed` is built differently after
+talking to the person, `skipped` is not built. Do it for every listed feature
+once its outcome is known, also when you skip it. A feature without a result
+stays `open` and Home treats it as unfinished. The migration itself needs no
+report: it shows as the new pin once the release is live.
+
+Put the package versions, the code changes and what you verified (check, tests,
+preview) in the commit message, and give them to the person only if they ask.
diff --git a/packages/sdk/agent/guide.md b/packages/sdk/agent/guide.md
--- a/packages/sdk/agent/guide.md
+++ b/packages/sdk/agent/guide.md
@@ -71,9 +71,11 @@ import { contextBlock, useAgentSession } from "@lophn/agent";
   handle을 `agent`에 준다. 앱을 짓는 agent의 `design-app` skill이 "앱 안 agent"
   절에 절차를 적는다. lophn 기본 agent를 상대로 쓰지 않는다: 제품 규칙과 tool이
   매 turn마다 실려 느리고 비싸다.
-- 앱을 짓고 옮기는 lophn은 사람이 정한 것(SDK를 올릴지, 어떤 기능을 쓸지)을 자기 memory(`agent.memory`)에
-  적고, 사람에게 다시 묻기 전에 memory부터 본다. 이미 정한 것은 묻지 않는다. 모든 workspace가
-  읽는 global memory(Home이 씀)도 같은 prompt에 실리니, workspace를 건너는 사실은 거기서 먼저 본다.
+- 앱을 짓고 옮기는 lophn은 사람이 그 앱에서 고른 세부(임계값, 단축키)를 자기 memory(`agent.memory`)에
+  적고, 사람에게 다시 묻기 전에 memory부터 본다. 모든 workspace가 읽는 global memory(Home이 씀)도
+  같은 prompt에 실리니, workspace를 건너는 사실은 거기서 먼저 본다. SDK를 올릴지·어떤 기능을 쓸지의
+  결정과 진행은 memory가 아니라 lophn이 기록한다(`lophn app sdk-status`로 읽는다): Home이 넘긴 기능마다
+  결과를 `lophn app sdk-feature`로 낸다.
 - `contextBlock({name, mimeType, text})` — 화면의 context(보고 있는 글, 고른 항목)를
   `resource` block으로 싼다. 같은 `name`이 한 메시지에서 구별되게 짓는다.
 - 꼴은 JSON schema의 부분이다: `type`(object, array, string, number, integer,
```
