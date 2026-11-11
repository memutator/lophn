# @lophn/declaration 4.5.1

Previous: 4.5.0
Breaking: no. Move together with `@lophn/app-ui` 2.14.1. Ambiguous CLI names and flags are now rejected.

The declaration validator now rejects commands such as `add_event` and `add-event` in the same app because both become the CLI command `add-event`. It also rejects top-level input fields that become the same flag, including a boolean's negative flag (`enabled` and `no_enabled`). Nested object keys are JSON keys, so they do not compete for flags.

Keep declaration names and handler names as they are. CLI calls split `.` into words and replace `_` with `-`. JSON input keeps the declared field names.

```text
# before: invalid CLI spelling
lophn calendar add_event --start_time 11:00
lophn masup quota.list

# after
lophn calendar add-event --start-time 11:00
lophn masup quota list
```

Use `lophn <slug> --help` to read the current commands. A new session is not required after activating a new app command.

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.5.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.14.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.5.1",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.14.1",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). An existing app with distinct CLI names needs no other code change. If validation finds a collision, give one command or field a distinct name and update its handler and references before preparing the next release. Existing supported SDK versions remain supported.

## Instruction diff

Update command examples in your app's `AGENTS.md` to the CLI spellings above. Keep handler IDs and JSON field names unchanged. Do not open a new session just to discover a newly activated app command; read the app's help again.

```diff
# @lophn/declaration guide.md
@@ -115,2 +115,10 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
     handler는 이름 하나로 등록한다. 이름을 두 목록에 같이 쓰지 못한다.
+  - CLI에서는 command 이름의 `.`을 낱말 경계로, `_`를 `-`로 바꾼다.
+    `add_event`는 `lophn <slug> add-event`, `quota.list`는 `lophn <slug> quota list`다.
+    입력 필드 `start_time`의 flag는 `--start-time`이다. JSON 입력과 handler 이름은 원래 이름을 쓴다.
+    실제 호출법은 `lophn <slug> --help`로 확인한다. 앱 command는 호출마다 현재 선언과 할당을 읽으므로
+    새 command를 쓰려고 새 session을 열 필요는 없다.
+  - CLI로 바꾼 뒤 같은 이름이 되는 command(`add_event`와 `add-event`)나 같은 flag가 되는
+    최상위 입력 필드(`start_time`과 `start-time`, boolean `enabled`와 `no_enabled`)는 선언 오류다.
+    필드 충돌 검사는 JSON 안의 nested object에는 적용하지 않는다.
 - `permissions` — 앱이 바깥에 닿는 자원이다. 항목은 `{kind, scope, reason}`이고
```
