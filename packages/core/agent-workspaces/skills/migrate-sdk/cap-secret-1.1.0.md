# @lophn/cap-secret 1.1.0

Previous: 1.0.0
Breaking: no

Teaches the habit for a missing secret value or sign-in: ask the person in the conversation with `lophn ask secret` instead of telling them to go to the app's Access tab. The code API is unchanged.

When the app needs a secret value, run `lophn ask secret --secret <name>` (in the app's own workspace the app is implied). A card shows where the value will be sent; the person types it in a protected window and you get `{stored: true}`. If the secret is declared with `oauth`, the same command shows a [Sign in] card and you get `{signed_in: true}`. For an OAuth secret the client id (and the client secret, if the service needs one) must already be set on the Access tab; without a client id the command fails with `conflict`. `{cancelled: true}` means no; `{unattended: true}` means nobody is here, so do not retry. A failed command of the app now carries `missing` (the empty secret and the `lophn ask secret` line to run) in its result when a secret value or sign-in was the reason; run that line. Never ask for the value in the conversation.

Nothing is required of an existing app. Stop telling the person to open the Access tab to type an API key; request it instead.

## Instruction diff

Change your own guidance, not the app's code: when a declared secret has no value yet, request it with `lophn ask secret` as below. If the app's `AGENTS.md` or notes tell the person to type values on the Access tab, change them to this.

```diff
+- 값이 아직 없으면 앱의 lophn agent가 `lophn ask secret --secret <name>`로
+  사람에게 청한다. 대화에 card가 뜨고 사람이 보호 창에 값을 넣으며, agent는
+  `stored`만 받는다. 값을 대화로 받지 않는다. 선언에 `oauth`가 있으면 같은
+  명령이 [Sign in] card를 띄우고 agent는 `signed_in`을 받는다. 값이나 sign-in이
+  없어 앱 command가 실패하면 agent가 받는 결과의 `missing`이 그 자리와 명령을
+  알려 주므로 앱이 오류 글로 안내할 필요는 없다.
 ...
-  id와 client secret을 앱 Access 탭에 넣은 뒤 [Sign in]을 누른다. lophn이 PKCE로
-  browser를 열고 loopback으로 돌아온 code를 token으로 바꾼다.
+  id와 client secret을 앱 Access 탭에 넣는다(client id가 없으면 `lophn ask
+  secret`이 `conflict`로 거절한다). 그 뒤 [Sign in]을 누르거나 앱의 lophn agent가
+  `lophn ask secret --secret <name>`로 대화에 [Sign in] card를 띄운다. lophn이
+  PKCE로 browser를 열고 loopback으로 돌아온 code를 token으로 바꾼다.
```
