# @lophn/agent 1.17.0

Previous: 1.16.0
Breaking: no

`SessionInfo` adds an optional `workflow` field (`{ project, workflow, instance, step } | null`), returned by `sessions.list()`, `useSessions()`, and `session.*` events:

- When a workflow hands a step to a session (or that session spawns a child with `team spawn`), `workflow` holds `{ project, workflow, instance, step }`, where `step` reflects the latest step handed to that session.
- Normal sessions and `terminal` sessions have `workflow: null`. GUI-tab sessions (`claude gui`, `codex gui`) appear as `terminal` sessions and also have `workflow: null`.

```ts
// after: read which workflow instance and step a session belongs to
import { sessions } from "@lophn/agent/process";

const listed = await sessions.list();
if (listed.ok) {
  for (const info of listed.value.sessions) {
    if (info.workflow) {
      console.log(info.session, info.workflow.workflow, info.workflow.step);
    }
  }
}
```

Nothing is required of an existing app. Apps that do not read `SessionInfo.workflow` continue to work unchanged.

## Instruction diff

Update the `.lophn/sdk/agent/.../guide.md` version reference in your app's `AGENTS.md` (inside the lophn-managed block) when bumping `@lophn/agent` to `1.17.0`, and note the new `workflow` field on `SessionInfo` in the SDK guide:

```diff
# @lophn/agent guide.md
@@ -114,7 +114,8 @@
 - **앱 process**는 `@lophn/agent/process`의 `sessions`(`list`·`status`·`stop`, React 없이)를 쓴다. 부모 invocation이 돌고 있지 않아도 된다(시작 code, timer).
   - `sessions.list(filter?)` → `{ok, value: {sessions}}`. session 한 줄은 `{session, kind("lophn"|"harness"|"terminal"), agent, harness, workspace, title,
-    state("running"|"waiting"|"idle"|"unknown"), waiting_for("approval"|"question"|null), last_active_at, spawned_by, cwd, folders, terminal}`이다.
+    state("running"|"waiting"|"idle"|"unknown"), waiting_for("approval"|"question"|null), last_active_at, spawned_by, cwd, folders, terminal, workflow}`이다.
     `terminal`은 터미널 탭의 coding agent일 때 `{harness, cli_session, tab, shell_pid}`다(`shell_pid`는 PTY shell이고 CLI 자신이 아니다).
-    탭이 GUI view(`claude gui`·`codex gui`)이면 `title`, `state`, `terminal.cli_session`은 GUI가 아는 값(제목, turn 단계)이다.
+    `workflow`는 workflow step이 넘겼거나 그 세션이 `team spawn`으로 연 자식 세션일 때 `{project, workflow, instance, step}`이고 아니면 `null`이다.
+    탭이 GUI view(`claude gui`·`codex gui`)이면 `title`, `state`, `terminal.cli_session`은 GUI가 아는 값(제목, turn 단계)이며 `terminal` 세션으로 나타나므로 `workflow`는 `null`이다.
   - **process를 session에 잇는 법.** 환경 표지를 먼저 본다. lophn agent의 `shell.run`과 그 아래 process, headless harness CLI와 그 아래 process는
```
