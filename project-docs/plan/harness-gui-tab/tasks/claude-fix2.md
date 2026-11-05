# claude-fix2

사람이 Claude GUI를 써 보고 찾은 것(README 정한 것 20, 21, 23, 24, 28, 29)을 Claude adapter에서 고친다. 지운 todo가 남는 것, Rewind 단추가 아무것도 하지 않는 것, `!`가 model로 가는 것, fast·thinking chip, resume이 없는 것, fork·rewind 뒤 표시가 없는 것이다. 조사는 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-claude.md`에 file:line과 함께 있다.

- 단위: adapter (wave 10)
- 선행: acp-round2
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/claude/`
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-claude.md`(§1-6과 끝의 계약 목록)
  - README 정한 것 20-30(`project-docs/plan/harness-gui-tab/README.md`)
  - architecture: `project-docs/architecture/harness-gui.md`의 "Claude Code adapter", `project-docs/architecture/acp.md`
  - SDK: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`의 `SDKUserMessage.shouldQuery`·`client_composed`(6650-6720줄 근처), `resumeSessionAt`·`resumeDropsTurn` 주석(2176-2232), `rewindFiles`·`RewindFilesResult`(3243, 3475), `listSessions`·`ListSessionsOptions`·`SDKSessionInfo`(1151-1194, 6191-6232), `forkSession`·`ForkSessionOptions`(858-887)
  - 녹화: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/claude-v2/`(`fast.jsonl`의 `supportedModels`, `todo.jsonl`, `clear_resume.jsonl`, `origin.jsonl`)와 scrub 규칙 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`
- 계약:
  - 쓰는 것(acp-round2가 wave 9에 정한다. 이름이 다르면 main이 맞다):
    - capability `shell`, `resume`
    - 입력 `run_shell {command}`, `open_session {cli_session}`
    - tool item `by: "agent" | "user"`
    - 갱신 `session_reset`
    - model 축 `kind: "choice" | "switch"`
    - `ACP_COMMAND_OPENS`의 `resume`
    - `HarnessGuiRun.sessions?(): Promise<{id, title, updated_at}[]>`, `HarnessGuiRun.rewindPreview?(message): Promise<{files: {path, change}[]}>`(`adapter.ts`)
  - 내놓는 것: Claude `HarnessGuiRun`의 `sessions`·`rewindPreview`. 그 밖에 다른 task가 기대는 것은 없다.

## 할 일

1. **todo `deleted`**(정한 것 29): `taskResult()`(지금 1051-1075줄)에서 `status === "deleted"`면 `lane.todos.delete(id)`로 목록에서 뺀다. CLI도 deleted task를 지운다(조사 §5). 주석의 "deleted는 cancelled다"를 고친다. 목록이 비면 `plan_changed {entries: []}`이다.
2. **rewind 미리보기와 결함**(정한 것 28, 조사 §1)
   - `HarnessGuiRun.rewindPreview(message)`를 채운다. `uuidOfMessage.get(message)`가 없으면 `{files: []}`이다. 있으면 `live.q.rewindFiles(uuid, {dryRun: true})`를 읽는다. `canRewind`면 `filesChanged`를 `{path, change}`로 옮긴다(`change`의 값은 acp-round2가 정한 것을 따른다. dry run은 파일마다 종류를 주지 않으니 모르면 "modified"다). `canRewind: false`면 빈 `files`이고 `error`를 info로 남긴다.
   - `assistantAround()`(지금 2315줄)가 "transcript에서 그 uuid를 못 찾음"과 "앞 assistant가 없음(첫 메시지)"을 갈라 돌려준다. `rewind()`(지금 2381줄)는 못 찾으면 warning info("Could not find this message in the transcript.")를 내고 멈춘다. 지금은 빈 새 session을 열어 대화를 잃은 것처럼 보인다.
   - rewind가 끝나면 info 한 줄 "Rewound to “{고른 메시지 첫 줄}”"(파일을 되돌렸으면 " · {n} files restored")을 내고 `refreshTitle()`을 부른다.
3. **fork 줄**(정한 것 28, 조사 §6): `fork()`(지금 2416줄) 뒤 `refreshTitle()`을 부른다(SDK가 제목을 "… (fork)"로 짓는다). info 한 줄 "Forked from “{앞 제목}”. The original session is unchanged."를 낸다. `/fork`(메시지 없음)에도 낸다.
4. **`!` shell**(정한 것 21, 조사 §2)
   - `CAPABILITIES`(지금 235줄)에 `shell: true`를 둔다.
   - `run_shell {command}`를 받으면 adapter가 start 인자의 `spawn`(탭 env, `cwd`)으로 `/bin/sh -c <command>`를 돌린다. tool item 하나(`by: "user"`, category command, 제목 `! <command>`)를 열고 stdout·stderr를 `body.output`에 쌓는다(`ACP_TOOL_BODY_LIMIT`). 끝나면 exit code로 상태를 닫는다. 도는 turn이 있어도 바로 돈다. 멈추기(`stop`)가 그 process group도 끈다.
   - 끝나면 input queue에 사람 메시지 둘을 넣는다. 첫째는 `<bash-input>{command}</bash-input>`이고 둘째는 `<bash-stdout>{out}</bash-stdout><bash-stderr>{err}</bash-stderr>`이다. 둘 다 `shouldQuery: false`, `client_composed: true`다(정한 것 21: model은 다음 turn에 본다. Claude 데스크톱 앱과 같다). `userMessage()`(지금 2213줄)에 이 두 칸을 받는 인자를 더한다. 사람 말풍선은 만들지 않는다(그 tool item이 사람 쪽 줄이다). 도는 turn이 있으면 그 turn이 끝난 뒤에 넣는다.
   - `send`로 `!`로 시작하는 글이 와도 model로 보내지 않는다. 화면은 `run_shell`을 보내지만 TUI에서 친 것처럼 글로 올 수 있다. 앞 `!`를 떼고 위와 같이 돌린다.
   - resume: `replay()`(지금 1990줄)에서 사람 entry의 글이 `<bash-input>`으로 시작하면 사람 메시지가 아니라 `by: "user"` tool item으로 그린다. 바로 뒤 `<bash-stdout>`·`<bash-stderr>` entry는 그 item의 출력으로 합친다. TUI에서 친 `!`도 같은 꼴로 기록되므로 같이 그려진다.
5. **fast·thinking을 model 축으로**(정한 것 24, 조사 §3)
   - `toggleList()`(지금 786줄)에서 fast·thinking을 지운다. Claude는 toggle이 남지 않으니 capability `toggles`를 끈다. `setToggle`의 fast·thinking 갈래도 지운다.
   - `modelGroups()`(지금 533줄)의 model마다 축을 더한다.
     - `supportsFastMode`인 model: `{id: "fast", label: "Speed", kind: "switch", values: [{value: "off", label: "Standard"}, {value: "on", label: "Fast"}]}`
     - `supportsThinkingOff`인 model에만: `{id: "thinking", label: "Thinking", kind: "switch", values: on/off}`. Opus·Sonnet·Haiku 5.5는 thinking을 끌 수 없으니 축이 없다.
     - effort 축은 `kind: "choice"`다.
   - 지금 값은 `currentModel()`의 `options`에 싣는다.
   - `set_model {model, options}`(지금 2561줄)에서 `options.fast`가 바뀌면 `applyFlagSettings({fastMode})`, `options.thinking`이 바뀌면 `setMaxThinkingTokens(null | 0)`이고 `carry`에 기억한다. 새 query의 `settings.fastMode`·`thinking`(지금 2076-2077줄)은 그대로 쓴다.
   - `tuiCommand()`(지금 2647줄)에 고른 값이 있을 때만 `--settings '{"fastMode":…,"alwaysThinkingEnabled":…}'`를 더한다(CLI flag 층이라 사람 설정 file에 쓰지 않는다). 이것으로 이슈 "Claude GUI의 fast·thinking이 TUI로 넘어가지 않는다"가 닫힌다.
6. **resume 목록과 바꾸기**(정한 것 23, 조사 §4)
   - capability `resume: true`.
   - `HarnessGuiRun.sessions()`는 `sdk.listSessions({dir: cwd, limit: 30, includeProgrammatic: true})`를 `lastModified` 내림차순으로 돌려준다. 칸은 `id: sessionId`, `title: customTitle ?? summary`, `updated_at: lastModified`의 ISO다. `includeProgrammatic`이 true라야 GUI session(entrypoint `sdk-cli`)과 TUI session이 다 보인다. 지금 session도 목록에 든다.
   - `open_session {cli_session}`: 지금 session이면 아무것도 하지 않는다. 아니면 `retire()` → `session_reset` 갱신 → 상태를 비운다(`/clear`의 `clear()`가 비우는 칸과 같다: totals, cost, contextUsage, titled, taskList, todos, goal) → `reopen(old, {resume: cli_session})` → `replay(cli_session)`. 그 뒤 `cli_session`·제목·model을 다시 낸다. `empty`는 false다.
   - 명령 표(지금 855-870줄의 `own(…)` 줄)에 `own("resume", "Resume an earlier session", "resume")`(`opens: "resume"`)를 더한다.
7. **녹화(lead가 돈다)**: `fixtures/claude/record.ts`에 scenario 넷을 더한다. 원본은 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/claude-v3/`에, model은 haiku다. worker는 돌리지 않는다. 할 일 1-6의 녹화에 기대지 않는 부분을 먼저 하고, record.ts를 commit한 뒤 **중간 보고**(scenario 이름, 각각 확인할 것, 돌리는 명령 한 줄)를 한다. lead가 원본 경로를 주면 test가 쓰는 줄만 scrub해 fixture로 옮긴다.
   - `shell_append`
     - 사람 메시지 둘(`<bash-input>ls</bash-input>`, `<bash-stdout>…</bash-stdout><bash-stderr></bash-stderr>`)을 `shouldQuery: false`, `client_composed: true`로 넣는다.
     - stream에 무엇이 오는지(result가 오는가, turn이 열리는가)를 본다.
     - 다음에 "What did the ls output show? One line."을 보내 model이 본 것을 확인한다.
     - 끝난 뒤 `getSessionMessages`의 그 entry 모양을 남긴다.
   - `sessions`: `listSessions({dir: cwd, includeProgrammatic: true})`와 `false`를 둘 다 읽어 칸과 GUI session이 드는지 남긴다(scratch dir 안 session만).
   - `rewind_preview`: 파일 하나를 고치게 한 뒤 그 사람 메시지 uuid로 `rewindFiles(uuid, {dryRun: true})`의 결과를 남긴다(실제 rewind는 하지 않는다).
   - `fork_title`: 한 turn 뒤 `forkSession(id, {dir})`과 그 새 id의 `getSessionInfo`(제목)를 남긴다.
   - 지키는 것(지금 recorder와 같다): 승인은 allow-once·session만 답한다. `updateSettings`·MCP 바꾸기를 부르지 않는다. `~/.claude`를 고치지 않는다. scratch cwd 안에서만 돈다.
8. 문서에 넣을 문장(lead가 `architecture/harness-gui.md`에 옮긴다)을 보고의 "넘길 줄"에 적는다: `!` 길, model 축(fast·thinking), resume, rewind 미리보기, fork·rewind 줄, `--settings` handoff.

## 끝남

- `npm run check`가 통과한다. `npm run check:full`과 `project-docs/plan/tools/lead/boot.sh`(boot 1·2 exit 0)도 통과한다.
- 위험 test(`claude_test.ts`, 둘):
  - "`run_shell`(그리고 `!`로 시작하는 `send`)은 input queue에 `shouldQuery: false`인 메시지만 넣고 turn을 여는 메시지를 넣지 않는다(그 명령이 model prompt로 가지 않는다)."
  - "`open_session`은 지금 session의 transcript를 바꾸는 SDK 호출(`forkSession`, `rewindFiles`, `renameSession`, `tagSession`)을 부르지 않고, 고른 id로 `resume`한 새 query를 연다."
- 남지 않음:
  - `grep -n "deleted는 cancelled" packages/shell/main/extensions/bundled/harness-gui/claude.ts`가 0줄이다.
  - `grep -n 'id: "fast"' packages/shell/main/extensions/bundled/harness-gui/claude.ts`가 축 정의 한 곳뿐이다(toggle 쪽에는 없다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 할 일 7의 중간 보고에는 scenario 목록과 돌리는 명령만 쓴다.
