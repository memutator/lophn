# @lophn/cap-tool 2.2.0

Previous: 2.1.0
Breaking: no.

The package now has a phone entry (`exports` with the `lophn-phone` condition) so the same backend can run on the phone. Nothing changes for an app that runs on the computer.

On the phone, `connectCommands`, `publish` and `subscribe` end `unavailable`, and calls run one at a time. A handler that imports a `node:` module does not start there.

Change the same version in `package.json` (`file:.lophn/sdk/cap-tool/2.2.0`) and in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits:

- Do not rely on other-app calls or app events in code that may run on the phone; they end `unavailable` there. Do not import `node:` modules in handlers.

```diff
# @lophn/cap-tool guide.md
@@ -92,2 +92,6 @@ read handler는 DB를 바꾸지 않는다고 선언을 믿는다.
 
+앱 backend가 폰에서 돌 때도 같은 API이고, 호출은 하나씩 돈다. 폰에서는 다른 앱 호출
+(`connectCommands`)과 event 발행·구독(`publish`, `subscribe`)이 `unavailable`로 끝난다.
+handler가 `node:` module을 import하면 폰에서 뜨지 않는다.
+
 ## 요구 permission
```
