# harness-gui

`claude gui`가 CLI 화면 대신 여는 lophn 창과 harness adapter. `project-docs/architecture/harness-gui.md`.

## 창에 CLI session id가 보이지 않아 다시 열 id를 모른다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/renderer]
```

지금: 다시 열기는 `claude gui --resume <id>`다(그 CLI 자신의 session id). Claude adapter(`packages/shell/main/extensions/bundled/harness-gui/claude.ts`)는 SDK의 `system/init`이 주는 `session_id`를 어디에도 내지 않고, `AcpSessionHandle`(`packages/protocol/extensions/acp-session.ts`)에는 창 제목이나 머리에 값을 줄 길이 없다. 창 제목은 harness 이름과 cwd 끝 폴더뿐이다.

영향: 사람이 GUI 창에서 한 대화를 GUI로 다시 열려면 id를 다른 곳(TUI의 `claude --resume` 목록, `~/.claude/projects/` file 이름)에서 찾아야 한다.

고치려면:
- handle에 CLI session id를 알리는 칸(`describe({resume})` 같은 것)을 더하고 창 머리에 "claude gui --resume <id>"를 복사할 수 있게 보인다. 중간(계약 하나, adapter 셋, 창 머리). 추천.
- adapter가 첫 turn 앞에 그 명령을 글로 쓴 agent message를 하나 낸다. 작음. 대화에 lophn이 만든 글이 섞인다.

## `claude`가 끝나면 그 창에서 더 이어 갈 수 없다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: `claude.ts`는 SDK의 `for await`가 끝나거나 throw하면 `dead`를 두고 실패한 turn을 하나 낸다. 그 뒤의 `send`는 사람 메시지를 보이고 곧바로 같은 오류로 실패한 turn이 된다(`case "send"`). 다시 띄우지 않는다.

영향: CLI가 죽거나 끝난 뒤에는 사람이 창을 닫고 `claude gui --resume <id>`로 다시 열어야 한다. 위 이슈 때문에 id도 모른다.

고치려면:
- 다음 `send`에서 같은 session id로 `resume`해 query를 다시 열고 그 메시지를 넣는다. 중간. 추천.
- 창에 "CLI가 끝났다"를 보이고 입력창을 막는다. 작음. 이어 가기는 여전히 안 된다.

## GUI 창에 남은 채팅 화면 칸 몇이 눌러도 아무 일이 없다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/renderer]
```

지금: 창은 lophn 채팅 화면(`AgentView`)을 source(`packages/shell/renderer/conversation/agent-tab-gui-source.ts`)만 바꿔 쓴다. source의 `external`이 lophn 전용 칸은 숨기지만, 아래 칸은 화면에 남고 뒤가 비어 있다.
- 실패한 turn의 Retry: source는 `retry` 입력을 보내지만 `claude.ts`의 입력 switch가 `default`로 버린다.
- 이미지 붙이기: source의 `uploadImage`가 없어 붙이면 오류가 보인다. adapter도 사람 메시지에서 글과 `resource` block만 넘긴다.
- tool 줄 펼치기: `toolCallBody`가 `not_found`라 입력·출력 본문이 없고 제목과 상태만 보인다(ACP는 본문을 싣지 않는다).
- edit 카드의 [Open]과 file 경로 누르기: 창에 file을 여는 host가 없다.

영향: 사람이 누르면 아무 일이 없거나 오류를 본다. 이미지를 보내지 못한다.

고치려면:
- Retry: adapter가 그 turn의 사람 메시지를 다시 보낸다. 작음. 추천.
- 이미지: 창의 이미지 올리기를 main으로 받고 adapter가 SDK의 image block으로 넣는다. 중간.
- tool 본문: adapter가 tool 입력·결과를 들고 handle에 본문 읽기를 더한다. 중간.
- [Open]: 창이 OS 기본 앱이나 lophn 문서 탭으로 연다. 작음.
- 당장 고치지 않는 칸은 `external`일 때 숨긴다. 작음.
