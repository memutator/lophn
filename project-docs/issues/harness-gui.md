# harness-gui

`claude gui`가 CLI 화면 대신 여는 lophn 창과 harness adapter. `project-docs/architecture/harness-gui.md`.

## 창에 CLI session id가 보이지 않아 다시 열 id를 모른다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/renderer]
```

지금: 다시 열기는 `claude gui --resume <id>`다(그 CLI 자신의 session id, codex는 thread id, opencode는 session id). adapter 셋(`packages/shell/main/extensions/bundled/harness-gui/claude.ts`, `codex.ts`, `opencode.ts`)은 그 id를 어디에도 내지 않고, `AcpSessionHandle`(`packages/protocol/extensions/acp-session.ts`)에는 창 제목이나 머리에 값을 줄 길이 없다. 창 제목은 harness 이름과 cwd 끝 폴더뿐이다.

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

## CLI가 사람에게 묻는 요청이 질문 카드로 오지 않고 turn이 실패한다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: `codex.ts`는 승인 두 꼴(`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`) 밖의 서버 요청에 `-32601` 오류로 답한다. 그중 `item/tool/requestUserInput`이 Codex가 사람에게 묻는 요청이다. `opencode.ts`도 모르는 요청에 같은 오류로 답하고 OpenCode의 질문(elicitation) extension을 옮기지 않는다. 두 adapter 모두 `answer` 입력을 버린다. Claude만 AskUserQuestion을 질문 카드로 옮긴다.

영향: Codex나 OpenCode가 진행 중에 사람에게 물으면 창에 질문 카드가 뜨지 않고 그 tool이 오류로 끝나 turn이 실패하거나 엉뚱하게 이어진다.

고치려면:
- 그 요청을 ACP `question_asked`로 내고 `answer` 입력을 요청의 응답으로 돌려준다. 중간(harness마다 요청 꼴이 다르다). 추천.

## adapter 셋이 줄 세우기 code를 따로 가진다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: 도는 중에 보낸 메시지를 줄에 세우고 고치고 옮기고 turn 뒤에 보내는 code(`resendQueue`와 `edit_queued`·`move_queued` 처리)가 `claude.ts`, `codex.ts`, `opencode.ts`에 각자 복사돼 있다. 뒤의 둘이 `claude.ts`를 본떠 썼다.

영향: 줄 세우기 bug를 고치면 세 곳을 같이 고쳐야 하고, 하나만 고치면 harness마다 동작이 갈린다.

고치려면:
- 같은 폴더에 줄 file 하나(queue와 그 입력 처리, 다음 turn에 넣을 callback을 받는다)를 두고 셋이 쓴다. 작음. 추천.

## Codex subagent 이벤트가 lane이 열리기 전이나 다시 연 뒤에 빠진다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: `codex.ts`는 `spawnAgent` item이 끝나 자식 thread id를 본 뒤에 자식 lane을 연다. 그 전에 온 자식 thread 이벤트는 모르는 thread라 버린다. 다시 열면(resume) 자식 대화를 `thread/turns/list`로 다시 그리지만 자식 thread를 구독하지 않는다.

영향: 녹화에서는 순서가 맞았지만 보장되지 않는다. 자식의 첫 메시지·tool 줄이 subagent 보기에서 빠질 수 있다. GUI를 다시 연 뒤 아직 도는 subagent는 흘러나오지 않고 끝날 때까지 멈춘 것처럼 보인다.

고치려면: 모르는 thread의 이벤트를 짧게 쌓아 두고 spawn item이 그 thread id를 알리면 lane에 붓는다. resume 때 도는 자식(`agentsStates`)마다 `thread/resume`으로 구독한다. 작음.

## Claude GUI의 `!`는 한 번마다 새 shell이고 출력이 끝나야 보인다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: `claude.ts`는 `!`마다 `/bin/sh -c`를 새로 띄우고 출력을 process가 끝날 때 tool item `body`에 한 번에 싣는다(ACP에 도는 tool의 본문 갱신이 없다).

영향: `!cd sub` 뒤의 `!ls`는 원래 폴더에서 돈다(Claude Code TUI는 bash mode의 `cd`가 이어진다). 오래 도는 `!` 명령은 끝날 때까지 출력이 비어 보인다.

고치려면: cwd만 이어 가려면 adapter가 `cd`로 시작하는 명령의 결과 cwd를 기억한다. 출력 흐름은 tool body를 덧붙이는 갱신이 ACP에 생길 때 같이 한다. 작음.
