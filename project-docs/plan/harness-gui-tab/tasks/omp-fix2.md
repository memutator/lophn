# omp-fix2

사람이 omp GUI를 써 보고 찾은 것(README 정한 것 20, 21, 23, 24, 28, 29)과 열린 이슈 "omp에서 model turn 없이 `!cmd`만 한 session은 다시 열 수 없다"를 omp adapter에서 고친다: fast·slow가 composer chip임, `!` 결과가 사람 말보다 먼저 agent 것으로 그려지고 접혀 있음, resume 목록 없음, fork 뒤 표시 없음, `/changelog` 같은 markdown 출력이 글자 그대로 보임. 조사는 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-others.md`의 §1 omp, §2, §3 omp, §4, §5에 file:line과 함께 있다.

- 단위: adapter (wave 10)
- 선행: acp-round2
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/omp.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/omp_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/omp/`
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-others.md`(§1 omp, §2 표의 omp 줄과 "추천", §3 omp, §4, §5, 끝의 계약 목록)
  - README 정한 것 20-30(`project-docs/plan/harness-gui-tab/README.md`), 이슈 `project-docs/issues/harness-gui.md`의 "omp에서 model turn 없이 `!cmd`만 한 session은 다시 열 수 없다"
  - architecture: `project-docs/architecture/harness-gui.md`의 "omp adapter", `project-docs/architecture/acp.md`
  - omp source(lab 18.14.2, 설치는 18.8.7): `/home/pyosechang/projects/harness-lab/omp/omp-cli/packages/coding-agent/src/`
    - `session/model-controls.ts:817`(`setFastMode`: provider family의 `priority` tier), `session/agent-session.ts:11840-11890`(slow: OpenAI `flex` 또는 Anthropic 전역 설정)
    - `session/session-manager.ts:3626`·`session/session-context.ts:326`(`service_tier_change` entry가 resume 때 되살아남)
    - `modes/rpc/rpc-mode.ts:2298-2320`(`set_fast_mode`·`set_slow_mode`), `modes/rpc/rpc-types.ts:62,132`(`open_session`, `switch_session {sessionPath}`), `modes/rpc/wire/state.ts:107-124`(get_state의 `sessionFile`, fast·slow 칸)
    - `modes/rpc/wire/frames.ts:130`(`command_output`은 `{type, text}`뿐)
  - 사람 session 파일 모양(읽기만): `~/.omp/agent/sessions/<폴더>/*.jsonl`의 첫 두 줄(`{type: "title", title, updatedAt}`, `{type: "session", id, cwd, timestamp}`)
  - 녹화: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/omp-v2/`(`fast.jsonl`, `bash.jsonl`, `stats.jsonl`의 `sessionFile`)와 scrub 규칙
- 계약:
  - 쓰는 것(acp-round2가 wave 9에 정한다. 이름이 다르면 main이 맞다):
    - capability `shell`, `resume`
    - 입력 `run_shell {command}`, `open_session {cli_session}`
    - tool item `by: "agent" | "user"`
    - 갱신 `session_reset`
    - model 축 `kind: "choice" | "switch"`
    - `ACP_COMMAND_OPENS`의 `resume`
    - `HarnessGuiRun.sessions?(): Promise<{id, title, updated_at}[]>`(`adapter.ts`)
  - 내놓는 것: omp `HarnessGuiRun`의 `sessions`. 그 밖에 다른 task가 기대는 것은 없다.

## 할 일

1. **Speed 축**(정한 것 24, 조사 §1 omp)
   - `meta()`의 `toggles`(지금 1257-1275줄)에서 fast와 slow를 뺀다. toggle이 하나도 안 남으면 `capabilities.toggles: false`다.
   - 지금 model의 축(지금 1237줄, thinking effort 뒤)에 `{id: "speed", label: "Speed", kind: "choice", values}`를 더한다. values는 Standard(`standard`)와 Fast(`fast`)이고, `st.slowModeSupported && st.slowModeScope === "session"`일 때만 Slow(`slow`)를 더한다. Anthropic slow(전역 설정을 쓴다)는 계속 내지 않는다.
   - 지금 값 `options.speed`: `slowModeEnabled`면 `slow`, `fastModeEnabled`면 `fast`, 아니면 `standard`.
   - 다른 model 줄에는 Speed 축을 두지 않는다(ModelInfo에 tier 정보가 없다). 고른 뒤 `refresh()`가 다시 그린다.
   - `set_model`에서 `options.speed`가 지금 값과 다르면 `set_fast_mode`·`set_slow_mode`를 보낸다(fast로 가면 slow를 끄고, slow로 가면 fast를 끈다). 오류면 지금처럼 warning info를 내고 `refresh()`로 축 값을 되돌린다. `set_toggle`의 fast·slow 분기(지금 2557-2567줄)는 지운다.
   - TUI로 넘길 때 flag가 필요 없다(session file의 `service_tier_change`가 resume 때 되살아난다).
2. **`!` 순서와 사람 줄**(정한 것 21, 조사 §2)
   - `capabilities.shell: true`.
   - `run_shell {command}`와 `send`의 `!` 글(지금 2366-2370줄)은 `bashCommand()`(지금 2142줄)로 간다.
   - `bashCommand()`가 여는 tool item을 `by: "user"`로 내고 제목을 `! <command>`로 한다. 사람 말풍선은 만들지 않는다. 그 줄을 먼저 열고(지금처럼) 답이 오면 출력을 `body.output`에 넣고 닫는다. 그래서 사람이 친 명령 줄이 먼저 서고 출력은 그 줄 안에 펼쳐진다(펼치는 것은 화면 몫이다).
   - `bashTurn`(adapter가 연 turn)에는 끝에 turn_end notice를 내지 않는다.
   - replay의 `bashExecution`(지금 810-822줄)도 `by: "user"` 줄이다.
3. **`!`만 한 session의 TUI**(이슈): model turn이 한 번이라도 끝났는지 기억한다(`agent_end`, 지금 729·1877줄. replay에 assistant가 있으면 끝난 것이다). 없으면 `tuiCommand`(지금 2615줄)가 `--resume` 없이 `omp`를 띄우고 info "omp has not saved this session yet (no model turn), so the terminal view starts a new session."을 낸다. 이슈는 lead가 닫는다(보고에 적는다).
4. **resume 목록**(정한 것 23, 조사 §3 omp)
   - `capabilities.resume: true`. adapter 명령 표에 `resume`(`opens: "resume"`, 설명 "Open an earlier session in this folder")을 더한다.
   - `HarnessGuiRun.sessions()`: `get_state.sessionFile`의 폴더를 읽는다(폴더 이름은 omp의 migration·hash 규칙이라 직접 만들지 않는다). `*.jsonl`마다 첫 두 줄만 읽어 `{type: "title"}`의 `title`·`updatedAt`과 `{type: "session"}`의 `id`·`timestamp`로 `{id, title, updated_at}`를 만든다. title 줄이 없으면 title은 "(untitled)", updated_at은 session timestamp다. updated_at 내림차순 30개다. file 읽기는 `OmpIo`(지금 48줄)에 `readDir`와 처음 몇 KB만 읽는 함수를 더해 받는다(AGENTS.md "코드": 파일 시스템은 인자로).
   - `sessionFile`이 없으면(아직 저장 안 됨) 지금 session 폴더를 모르므로 빈 목록이다(정한 것으로 보고).
   - `open_session {cli_session}`: 도는 turn이 있으면 `idleOnly`(지금 2134줄)로 거절한다. 아니면 목록에서 그 id의 file 경로로 `switch_session {sessionPath}`를 보낸다(process를 다시 띄우지 않는다). 성공하면 `session_reset`을 내고 `refresh()`, `get_messages`로 replay, `userIds`를 새 session 것으로 다시 만든다. `cancelled`면 info다.
5. **fork 줄**(정한 것 28, 조사 §4): `forkAt()`(지금 2252줄)이 성공하면 info "Forked from “{앞 제목}”. The original session is unchanged."를 낸다. `/fork`(target null)에도 같다(지금은 화면에 아무 변화가 없다). 새 제목은 `refresh()`의 `sessionName`이다.
6. **명령 출력 markdown**(정한 것 29, 조사 §5): `commandOutput()`(지금 972-984줄)의 format 판단을 바꾼다. ANSI escape를 지우기 전 원문에 escape가 없고, 줄 머리가 `#`, `- `, `* `, `|`, `1. `인 줄이 둘 이상이거나 ```로 시작하면 `markdown`, 아니면 `preformatted`다. `/changelog`(`## [18.8.5]`, `- Fixed …`)가 markdown으로 간다. `/context`의 막대(ANSI)는 preformatted 그대로다.
7. **test**(`omp_test.ts`): 위험 test 둘.
   - "`!ls`는 `bash`로만 가고 `prompt`로 가지 않는다. 그 줄은 `by: "user"` tool item이고 사람 말풍선이 없다"(지금 있는 `!ls` test를 고친다).
   - "model turn이 끝나지 않은 session의 `tuiCommand`에는 `--resume`이 없다".
   Speed·markdown 판단은 test하지 않는다.

## 녹화

새 model 호출 녹화는 필요 없다. session 목록은 사람 session 폴더의 file 모양으로 짠다. `switch_session`의 답과 그 뒤 이벤트를 보려면 model 없는 녹화 하나가 있으면 좋다(lead가 river deepseek flash로 띄우되 prompt를 보내지 않는다. 원본은 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/omp-v3/`). worker는 돌리지 않는다. `fixtures/omp/record.ts`에 scenario를 더하고 중간 보고로 돌리는 명령 한 줄을 알린다.
- `switch`: `--session-dir`에 저장된 session 둘(앞 녹화 `omp-v2/sessions/`의 file을 scratch로 복사)을 두고 하나로 띄운 뒤 `get_state` → `switch_session {sessionPath: 다른 file}` → `get_state` → `get_messages`. 확인할 것: 답의 `cancelled`, 뒤따르는 이벤트(`available_commands_update` 등), `sessionId`가 바뀌는지.
지키는 것: 사람 `~/.omp`의 session 폴더에 쓰지 않는다(`--session-dir`은 scratch). role·approval 설정 file을 쓰지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 위 둘.
- 남지 않음: `grep -n "set_fast_mode\|set_slow_mode" packages/shell/main/extensions/bundled/harness-gui/omp.ts`가 `set_model`의 Speed 분기에만 있다. `grep -n "id: \"fast\"\|id: \"slow\"" packages/shell/main/extensions/bundled/harness-gui/omp.ts`가 toggle에 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 특히 녹화 scenario(중간 보고), `sessionFile`이 없을 때 빈 목록으로 둔 것, markdown 판단 규칙, 이슈를 닫는 문장.
