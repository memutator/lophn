# @lophn/cap-tool 2.3.0

Previous: 2.2.0
Breaking: no.

`connectCommands` takes an optional third argument `{ on }` that calls the app on another computer, and `AppCaller` has a new kind, `remote`, for a call that came from another computer. Nothing changes for an app that does not use them.

```ts
// Before
const studio = connectCommands("notes", ["note.create"]);

// After: the same command on the computer named "Studio" (a computer name, `mch_` or `dev_` id)
const studio = connectCommands("notes", ["note.create"], { on: "Studio" });
```

Change the same version in `package.json` (`file:.lophn/sdk/cap-tool/2.3.0`) and in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app.

A handler that switches on `currentContext()?.caller?.kind` should handle `remote` (`{ kind: "remote", machine, device, requester }`, where `requester` is `screen`, `terminal`, `agent` or `app`) the way it handles `person` or `agent`, or refuse it. An `event` caller can carry `machine`, the computer the event came from. A call to another computer ends `unavailable` on the phone.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits:

- To call an app on another computer, pass `{ on }` to `connectCommands`; do not build a second path for it. Do not trust `requester` for anything the core did not already allow: the core decides who may call.

```diff
# @lophn/cap-tool guide.md
@@ -41,3 +41,3 @@ import {
   값을 넣지 않는다.
-- `connectCommands(app, commands)` — 다른 앱의 command를 부르는 client를 준비한다.
+- `connectCommands(app, commands, options?)` — 다른 앱의 command를 부르는 client를 준비한다.
   `call(name, input?)`은 core를 거쳐 간다. 열지 않은 이름은 `forbidden`
@@ -48,3 +48,4 @@ import {
   모름) 가운데 하나다. `unknown`은 자동으로 다시 부르지 않는다. 호출 자체가
-  실패하면 `ok: false`다.
+  실패하면 `ok: false`다. `options.on`은 다른 기계(컴퓨터 이름, `mch_`, `dev_`)의
+  앱을 부른다("다른 기계의 앱 부르기").
 - `publish(name, payload)` — 선언의 `events`에 있는 event를 낸다(아래 "앱 event"). `{ok, value: {publication,
@@ -60,2 +61,12 @@ import {
 
+## 다른 기계의 앱 부르기
+
+`connectCommands(app, commands, { on: "Studio" })`는 `on`이 가리키는 다른 컴퓨터의 같은 앱 command를 부른다. `on`은 그 컴퓨터의
+이름이나 `mch_`·`dev_` id다(이름이 같은 컴퓨터가 둘이면 `invalid_input`이고 후보가 돌아온다). 이 컴퓨터를 고르면 `invalid_input`이다
+(`on`을 빼면 된다). 기계를 풀고 넘기는 것은 core이고, 부르는 앱은 허락이나 신원을 정하지 않는다. 받는 기계 쪽 호출은 앱이 아니라
+core가 정한 요청한 쪽과 함께 오므로, 받는 앱의 handler에서 `currentContext().caller`는 `{ kind: "remote", machine, device, requester }`다.
+`requester`는 `{ kind: "screen" }`(그 기계의 사람 화면), `{ kind: "terminal" }`(사람의 터미널),
+`{ kind: "agent", agent, session, name }`, `{ kind: "app", app }` 가운데 하나다. 다른 앱 호출과 같이 폰에서는 `unavailable`이다.
+다른 기계에서 온 event의 caller에는 그 난 기계가 `machine`으로 실린다.
+
 ## 앱 event
```
