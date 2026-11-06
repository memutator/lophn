# harness-gui

닫은 이슈. 열린 것은 `project-docs/issues/harness-gui.md`.

## 창에 CLI session id가 보이지 않아 다시 열 id를 모른다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/renderer]
closed: fixed
guard: 없음
```

지금: 다시 열기는 `claude gui --resume <id>`다(그 CLI 자신의 session id, codex는 thread id, opencode는 session id). adapter 셋(`packages/shell/main/extensions/bundled/harness-gui/claude.ts`, `codex.ts`, `opencode.ts`)은 그 id를 어디에도 내지 않고, `AcpSessionHandle`(`packages/protocol/extensions/acp-session.ts`)에는 창 제목이나 머리에 값을 줄 길이 없다. 창 제목은 harness 이름과 cwd 끝 폴더뿐이다.

영향: 사람이 GUI 창에서 한 대화를 GUI로 다시 열려면 id를 다른 곳(TUI의 `claude --resume` 목록, `~/.claude/projects/` file 이름)에서 찾아야 한다.

고치려면:
- handle에 CLI session id를 알리는 칸(`describe({resume})` 같은 것)을 더하고 창 머리에 "claude gui --resume <id>"를 복사할 수 있게 보인다. 중간(계약 하나, adapter 셋, 창 머리). 추천.
- adapter가 첫 turn 앞에 그 명령을 글로 쓴 agent message를 하나 낸다. 작음. 대화에 lophn이 만든 글이 섞인다.

닫음: 별도 창이 없어졌다(계획 harness-gui-tab). GUI는 그 CLI를 친 터미널 탭 안에서 열리고, tracker가 탭의 CLI session id를 안다. 탭 머리 toggle이 같은 session으로 TUI와 오가고, 머리 session menu와 `/resume`이 그 CLI가 이 폴더에서 가진 지난 session을 보이고 같은 탭에서 바꾼다(`open_session`).

## GUI 창에 남은 채팅 화면 칸 몇이 눌러도 아무 일이 없다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/renderer]
closed: fixed
guard: 없음
```

지금: 창은 lophn 채팅 화면(`AgentView`)을 source(`packages/shell/renderer/conversation/agent-tab-gui-source.ts`)만 바꿔 쓴다. source의 `external`이 lophn 전용 칸은 숨기지만, 아래 칸은 화면에 남고 뒤가 비어 있다.
- 실패한 turn의 Retry: source는 `retry` 입력을 보내지만 `claude.ts`의 입력 switch가 `default`로 버린다(`codex.ts`, `opencode.ts`는 그 turn의 사람 메시지를 다시 보낸다).
- 줄에 선 메시지의 "지금 보내기": source는 `send_queued`를 보내지만 `claude.ts`와 `opencode.ts`가 버린다(SDK와 표준 protocol에 steer가 없다. `codex.ts`는 `turn/steer`로 넣는다).
- 이미지 붙이기: source의 `uploadImage`가 없어 붙이면 오류가 보인다. adapter도 사람 메시지에서 글과 `resource` block만 넘긴다.
- tool 줄 펼치기: `toolCallBody`가 `not_found`라 입력·출력 본문이 없고 제목과 상태만 보인다(ACP는 본문을 싣지 않는다).
- edit 카드의 [Open]과 file 경로 누르기: 창에 file을 여는 host가 없다.

영향: 사람이 누르면 아무 일이 없거나 오류를 본다. 이미지를 보내지 못한다.

고치려면:
- Retry: `claude.ts`도 codex·opencode처럼 그 turn의 사람 메시지를 다시 보낸다. 작음. 추천.
- 지금 보내기: steer가 없는 harness에서는 adapter가 표에 그 능력을 내고 창이 단추를 숨긴다. 작음.
- 이미지: 창의 이미지 올리기를 main으로 받고 adapter가 SDK의 image block으로 넣는다. 중간.
- tool 본문: adapter가 tool 입력·결과를 들고 handle에 본문 읽기를 더한다. 중간.
- [Open]: 창이 OS 기본 앱이나 lophn 문서 탭으로 연다. 작음.
- 당장 고치지 않는 칸은 `external`일 때 숨긴다. 작음.

닫음: 계획 harness-gui-tab. Claude도 `retry`를 그 turn의 사람 메시지로 다시 보낸다. 지금 보내기는 Claude `cancelAsyncMessage`, OpenCode `delivery: "steer"`로 한다. 이미지는 GUI source의 `uploadImage`가 main이 쓴 tmp file의 `file://` link를 싣는다. tool 본문은 ACP tool item `body`다. [Open]과 file 경로는 탭 host의 `openFile`이다. `external` 숨김은 capability 검사로 바뀌었다.

## CLI가 사람에게 묻는 요청이 질문 카드로 오지 않고 turn이 실패한다

```yaml
kind: bug
modules: [packages/shell/main]
closed: fixed
guard: `codex_test.ts`(requestUserInput)
```

지금: `codex.ts`는 승인 두 꼴(`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`) 밖의 서버 요청에 `-32601` 오류로 답한다. 그중 `item/tool/requestUserInput`이 Codex가 사람에게 묻는 요청이다. `opencode.ts`도 모르는 요청에 같은 오류로 답하고 OpenCode의 질문(elicitation) extension을 옮기지 않는다. 두 adapter 모두 `answer` 입력을 버린다. Claude만 AskUserQuestion을 질문 카드로 옮긴다.

영향: Codex나 OpenCode가 진행 중에 사람에게 물으면 창에 질문 카드가 뜨지 않고 그 tool이 오류로 끝나 turn이 실패하거나 엉뚱하게 이어진다.

고치려면:
- 그 요청을 ACP `question_asked`로 내고 `answer` 입력을 요청의 응답으로 돌려준다. 중간(harness마다 요청 꼴이 다르다). 추천.

닫음: 계획 harness-gui-tab. Codex `item/tool/requestUserInput`은 질문 카드이고 답을 질문 id로 돌려준다. OpenCode는 server API로 다시 짜며 `form.created`가 카드를 열고 `form.reply`·`form.cancel`로 답한다. omp `ask`도 질문 카드다.
