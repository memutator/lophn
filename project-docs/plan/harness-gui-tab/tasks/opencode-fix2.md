# opencode-fix2

사람이 OpenCode GUI를 써 보고 찾은 것(README 정한 것 20, 21, 23, 28)과 열린 이슈 "OpenCode server 명령과 skill에 인자 hint가 없다"를 OpenCode adapter에서 고친다: `!` 결과가 agent 것처럼 그려지고 사람 말 아래에 남음, resume 목록 없음, fork 뒤 표시 없음, 인자를 받는 명령을 메뉴로 부를 수 없음. 조사는 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-others.md`의 §2, §3, §4에 file:line과 함께 있다.

- 단위: adapter (wave 10)
- 선행: acp-round2
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/opencode_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/opencode/`
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-others.md`(§1 OpenCode, §2 표의 OpenCode 줄과 "추천", §3 OpenCode, §4, 끝의 계약 목록)
  - README 정한 것 20-30(`project-docs/plan/harness-gui-tab/README.md`), 이슈 `project-docs/issues/harness-gui.md`의 "OpenCode server 명령과 skill에 인자 hint가 없다"
  - architecture: `project-docs/architecture/harness-gui.md`의 "OpenCode adapter", `project-docs/architecture/acp.md`
  - OpenCode source(lab 2.2.5, 설치는 2.1.4): `/home/pyosechang/projects/harness-lab/open-code/open-code-cli/packages/`
    - `protocol/src/groups/session.ts:111-140`(`session.list`, `SessionsQuery`), `schema/src/session.ts:32-110`(`Session.Info`, `ListFilter`: `directory`, `parentID`, `order`, `search`)
    - `protocol/src/groups/command.ts`, `schema/src/command.ts`(`Command.Info`는 `name`·`description`뿐이고 template이 없다)
    - `core/src/config/plugin/command.ts:138-205`(명령 file `{command,commands}/**/*.md`, `$ARGUMENTS`·`$<n>` 치환, 자리표시가 없으면 친 글을 뒤에 붙인다)
    - `protocol/src/groups/session.ts:379`(`session.skill`은 `{id, resume}`뿐이라 인자를 받지 않는다)
    - `core/src/session/runner/to-llm-message.ts:282-289`(shell message가 model에 가는 꼴)
  - 녹화: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/opencode-v2/`와 scrub 규칙 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`
- 계약:
  - 쓰는 것(acp-round2가 wave 9에 정한다. 이름이 다르면 main이 맞다):
    - capability `shell`, `resume`
    - 입력 `run_shell {command}`, `open_session {cli_session}`
    - tool item `by: "agent" | "user"`
    - 갱신 `session_reset`
    - `ACP_COMMAND_OPENS`의 `resume`
    - `HarnessGuiRun.sessions?(): Promise<{id, title, updated_at}[]>`(`adapter.ts`)
  - 내놓는 것: OpenCode `HarnessGuiRun`의 `sessions`. 그 밖에 다른 task가 기대는 것은 없다.

## 할 일

1. **`!` shell**(정한 것 21, 조사 §2)
   - `CAPABILITIES`(지금 276줄)에 `shell: true`.
   - `run_shell {command}`를 받으면 `api.shell(sessionId, {command})`(지금 `sendPrompt`의 `!` 분기, 2081줄)를 보낸다. `sendPrompt`로 `!` 글이 와도 같은 함수로 간다.
   - `shellLine()`(지금 1597-1627줄)이 여는 tool item을 `by: "user"`로 내고 제목을 `! <command>`로 한다. 사람 말풍선을 따로 만들지 않는다(그 줄이 사람 쪽 줄이다). 도는 execution이 없어 adapter가 연 turn이면 끝에 turn_end notice("Worked for")를 내지 않는다.
   - replay(`replayMessage`의 `case "shell"`, 지금 2015줄)도 같은 `by: "user"` 줄이다.
   - model은 다음 turn에 그 shell message를 사람 메시지로 본다(OpenCode가 한다. 조사 §2). adapter는 따로 할 것이 없다.
2. **resume 목록**(정한 것 23, 조사 §3 OpenCode)
   - `CAPABILITIES.resume: true`. `CLIENT_COMMANDS`(지금 317줄)에 `resume`(`opens: "resume"`, 설명 "Open an earlier session in this folder")을 더한다.
   - `createApi`에 `sessions(query)`: `GET /api/session`에 `{directory: cwd, parentID: "null", order: "desc", limit: 30}`. 답 `data[]`를 `{id, title: title || "(untitled)", updated_at: ISO(time.updated)}`로 옮긴다. 자식(subagent) session은 `parentID=null`로 빠진다.
   - 설치 2.1.4의 query 이름은 녹화가 없어 모른다(lab 2.2.5 기준이다). 녹화가 오기 전에는 lab 모양대로 짜고, 답이 400이면 query 없이 다시 불러 `directory`·`parentID`로 거른다(정한 것으로 보고).
   - `open_session {cli_session}`: 도는 execution이 있으면 info로 거절한다. 아니면 `moveTo(cli_session, 첫 항목 id)`(지금 2136줄. fork·new가 쓴다)로 바꾸고 `session_reset`을 낸 뒤 `replay()`로 그 session의 message를 그린다. `moveTo`가 지금 하는 "사람 메시지 순서로 짝짓기"(fork용)는 open에서는 하지 않는다(다른 대화다). `tuiCommand`(지금 2569줄)는 이미 지금 `sessionId`를 쓴다.
3. **fork 줄**(정한 것 28, 조사 §4): `fork()`(지금 2168줄) 뒤 info "Forked from “{앞 제목}”. The original session is unchanged."를 낸다. `moveTo`가 새 session 제목을 이미 낸다. `/fork`(메시지 없음)에도 같다.
4. **명령 인자 hint**(이슈, 조사 결과)
   - server `GET /api/command`의 `Command.Info`에는 template이 없다. 그래서 adapter가 명령 file을 직접 읽는다.
   - `OpencodeDeps`(지금 242줄)에 `readCommandTemplates(dirs: string[]): Promise<Map<string, string>>`을 더하고 `realDeps`가 `{dir}/{command,commands}/**/*.md`를 읽어 file 이름(확장자 뺀 상대 경로, `/`는 OpenCode가 쓰는 이름 규칙대로)을 template 본문에 짝짓는다. 읽는 폴더는 `~/.config/opencode`와 `<cwd>/.opencode`다(OpenCode가 읽는 나머지 폴더는 다루지 않는다. 정한 것으로 보고).
   - server 명령 줄(지금 1711-1714줄의 `slash(...)`)에 template이 `$ARGUMENTS`나 `$<숫자>`를 가지면 `argument_hint: "[args]"`를 둔다. 내장 `review`는 file이 없으니 표로 `"[commit|branch|pr]"`을 둔다.
   - skill은 `session.skill {id, resume}`이 인자를 받지 않아 hint를 두지 않는다. 이슈의 skill 부분은 "인자를 받지 않는다"로 닫는다(lead가 이슈를 고친다. 보고에 적는다).
5. **test**(`opencode_test.ts`): 위험 test 하나.
   - "`!ls`는 `POST …/shell`로만 가고 `…/prompt`로 가지 않는다. 그 shell은 `by: "user"` tool item 하나이고 사람 말풍선이 없다"(손으로 만든 `session.shell.started`·`ended` 두 줄).
   resume·hint는 test하지 않는다.

## 녹화

설치 2.1.4의 session 목록 모양을 알려면 녹화가 하나 필요하다(model 호출 없음). lead가 돌리고 원본은 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/opencode-v3/`에 둔다. worker는 돌리지 않는다. `fixtures/opencode/record.ts`에 scenario를 더하고 중간 보고로 돌리는 명령 한 줄을 알린다.
- `list`: scratch 폴더에서 session 둘을 만들고(prompt 없이 `POST /api/session`) `GET /api/session?directory=<scratch>&parentID=null&order=desc&limit=5`와 query 없는 `GET /api/session`. 확인할 것: query 이름이 맞는지, 답의 `time.updated` 단위, `title` 기본값.
- `shell_live`: `POST …/shell {command: "ls"}` 뒤 `GET …/message`. 확인할 것: shell message가 사람 message보다 먼저인지(여기서는 사람 message가 없다), `session.shell.*` 이벤트 모양.
지키는 것: 지금 `record.ts`의 scratch 폴더 규칙(`mkdtemp` + `git init`)과 `always`·session 규칙을 보내지 않는 것을 그대로 쓴다. `shell_live`는 model을 부르지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 위 하나.
- 남지 않음: `grep -n "startsWith(\"!\")" packages/shell/main/extensions/bundled/harness-gui/opencode.ts`가 `run_shell`과 같은 함수로 가는 줄 하나뿐이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 특히 녹화 scenario 목록(중간 보고), 2.1.4의 session 목록 query가 lab과 같은지, 명령 file을 읽는 폴더를 둘로 줄인 것, 이슈의 skill 부분을 닫는 문장.
