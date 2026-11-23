# @lophn/agent 1.18.0

Previous: 1.17.0
Breaking: no

No API change. This release updates the guidance lophn gives app agents for public contract changes, follow-up reporting, and stale workaround cleanup:

- **Post-activation contract cascade**: `lophn release prepare` now reports `contract_changes` (removed or changed public commands, public skills, and declared events with their `external_user_count`). Check `contract_changes` to catch accidental removals or unintended breaking edits before activating. For intentional breaking changes, activate directly without waiting for pre-activation consensus from other workspaces; once activated, lophn automatically records follow-up items and routes handoffs to affected workspaces.
- **Unified follow-up reporting**: inspect open handoffs with `lophn follow-up list` and report each item (`fup_...`) with `lophn follow-up report <id> --state done|changed|skipped --outcome "<one line>"` instead of `lophn app sdk-feature`.
- **Ownership-split cleanup & scoped custom agents**: when removing obsolete workarounds, edit `memory.md` (`agent.memory`) and generated app skills directly and report what changed; propose edits to person-owned `LOPHN.md` only (never edit it directly); keep app-scoped `runtime: custom` agents updated with `agent.update`.

Nothing is required of an existing app's code.

## Instruction diff

Update the lophn-managed block in your app's `AGENTS.md` (including the `.lophn/sdk/agent/1.18.0/guide.md` reference and the `contract_changes` / `lophn follow-up report` lines below) and follow these habits on future releases and handoffs:

```diff
# app prompt
@@ -62,3 +63,3 @@
    id. `failed` gives `stage` and `reason`: fix, commit, prepare again. It
-   replaces the app's preview. For `removed_public_tools` and `removed_public_skills` see "What you do".
+   replaces the app's preview. Check `contract_changes` before activating (see "What you do").
@@ -143,12 +149,19 @@
-- Public commands and public skills are promises; write them in `DESIGN.md`.
-  `removed_public_tools` lists each public command a release removes;
-  `removed_public_skills` does the same for public skills. The program does not
-  block it. Other apps and projects may use them. Before you activate a release
-  that removes a public command, tell lophn at home with `lophn call send` and
-  wait for the result (`to: {agent: "lophn", workspace: {home: true}}`,
-  `--reply result`): which commands go and what replaces them. Home finds who
-  uses them, asks lophn there and gives you their answers. If one cannot move
-  off a command, bring the command back. Do not ask the person: this is your
-  decision.
+- Public commands, public skills, and declared events are promises; write them in
+  `DESIGN.md`. `lophn release prepare` reports `contract_changes` (each removed
+  or changed public command, skill, or event with its `external_user_count`,
+  without revealing other workspace names). Check `contract_changes` before
+  activating to catch accidental removals or unintended breaking edits. If a
+  breaking change is intentional, activate directly without waiting for
+  pre-activation consent from other workspaces; once activated, core
+  automatically records `follow_up_items` and routes handoffs to affected
+  workspaces.
+- When you receive a follow-up handoff (an SDK or platform update, a deletion
+  cascade, or another app's changed contract), check `lophn follow-up list`,
+  apply the needed changes (including updating app-scoped `runtime: custom`
+  agents via `agent.update`), and report each item with
+  `lophn follow-up report <id> --state done|changed|skipped --outcome "<one line>"`.
+  When cleaning up stale notes or workarounds: edit agent-owned files
+  (`memory.md` via `agent.memory`, generated app skills) directly and report
+  what changed; never auto-edit person-owned `LOPHN.md` (propose edits only).
@@ -195,4 +209,5 @@
-- SDK update decisions and the progress of features lophn at home handed you:
-  lophn records them, and you report each feature with `lophn app sdk-feature`.
+- Update decisions and the progress of follow-up items handed to this app:
+  lophn records them (`lophn follow-up list`), and you report each item with
+  `lophn follow-up report`.

# design-app SKILL.md
@@ -97,5 +97,4 @@
-A change that removes a public skill or a command it calls shows in
-`removed_public_skills` or `removed_public_tools` at release prepare. Keep the
-skill and its commands in step.
+Removing or changing a public skill or command shows in `contract_changes` at
+release prepare. Keep the skill and its commands in step.

# migrate-sdk SKILL.md
@@ -142,9 +178,9 @@
-Record the result of each feature the handoff listed, so lophn at Home can see
-it: `lophn app sdk-feature <feature ID> --state done|changed|skipped --note
-"<one line>"`. `done` is built as proposed, `changed` is built differently after
-talking to the person, `skipped` is not built. Do it for every listed feature
-once its outcome is known, also when you skip it. A feature without a result
-stays `open` and Home treats it as unfinished. The migration itself needs no
-report: it shows as the new pin once the release is live.
+Record the result of each follow-up item the handoff listed, so lophn at Home
+can see it: `lophn follow-up report <id> --state done|changed|skipped --outcome "<one line>"`.
+`done` is built as proposed, `changed` is built differently after talking to the
+person, `skipped` is not built. Do it for every listed item once its outcome is
+known, also when you skip it. An item without a result stays `open` and Home
+treats it as unfinished. The migration itself needs no report: it shows as the
+new pin once the release is live.

# AGENTS.md (lophn-managed block)
@@ -100,3 +100,7 @@
   변경이나 ignore하지 않은 새 file이 있으면 거절하므로 고친 것은 모두 commit한 뒤
-  준비한다.
+  준비한다. 공개 command·skill·event를 지우거나 바꾸면 `lophn release prepare`의
+  `contract_changes`로 실수 여부만 확인하고, 의도한 변경이면 사전 합의 대기 없이
+  activate한다(activate 직후 core가 영향 그릇의 follow-up과 handoff를 자동 기록·전달한다).
+- 넘겨받은 후속 작업(`lophn follow-up list`)은 끝난 뒤
+  `lophn follow-up report <id> --state done|changed|skipped --outcome "<한 줄>"`로 보고한다.

# @lophn/agent guide.md
@@ -78,5 +78,9 @@
   적고, 사람에게 다시 묻기 전에 memory부터 본다. 모든 workspace가 읽는 global memory(Home이 씀)도
-  같은 prompt에 실리니, workspace를 건너는 사실은 거기서 먼저 본다. SDK를 올릴지·어떤 기능을 쓸지의
-  결정과 진행은 memory가 아니라 lophn이 기록한다(`lophn app sdk-status`로 읽는다): Home이 넘긴 기능마다
-  결과를 `lophn app sdk-feature`로 낸다.
+  같은 prompt에 실리니, workspace를 건너는 사실은 거기서 먼저 본다. 업데이트 결정과 맡겨진 후속 작업은
+  memory가 아니라 lophn이 기록한다(`lophn app sdk-status`, `lophn follow-up list`): 넘겨받은 항목마다
+  결과를 `lophn follow-up report <id> --state done|changed|skipped --outcome "<한 줄>"`로 낸다.
+  공개 command·skill·event를 지우거나 바꾸는 release는 `lophn release prepare`의 `contract_changes`로
+  실수 삭제만 먼저 확인하고, 의도한 변경이면 사전 합의 대기 없이 바로 activate한다(activate 직후 core가
+  영향 그릇의 follow-up과 handoff를 자동 연결한다). 옛 우회 메모 정리 시 `memory.md`와 생성 skill은
+  직접 고치고 보고하며, 사람 소유의 `LOPHN.md`는 제안만 한다.
```
