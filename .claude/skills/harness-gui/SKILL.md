---
name: harness-gui
description: lophn harness GUI(터미널 탭에서 `claude gui`·`codex gui`·`opencode gui`·`omp gui`로 여는 채팅 화면)를 고치거나 기능을 더할 때 쓴다. extension harness-gui의 adapter와 그 녹화·fixture, 탭 쪽 동작(toggle, 탭 이름, 되살리기), GUI가 쓰는 ACP session 기능을 바꿀 때, 사람이 GUI의 bug나 빠진 기능을 말했을 때.
---

# harness-gui

harness GUI는 사람이 설치한 CLI(Claude Code, Codex, OpenCode, omp, Antigravity `agy`)를 lophn 채팅 화면으로 보인다. 기준은 사람이 정했다: **그 CLI에서 되는 것은 GUI에서도 된다**(desktop app이 본보기). 이 skill은 harness-gui, harness-gui-tab 두 계획과 그 뒤 고침에서 쓴 순서와 실수를 모은다.

## 먼저 읽을 것

- `project-docs/architecture/harness-gui.md`: 설계(문제, 모델, 지키는 것, 결정). 고치기 전에 "지키는 것"을 읽는다.
- `.claude/skills/harness-gui/reference.md`: file·함수·CLI 호출, 탭의 흐름, adapter마다의 구현 세부.
- `project-docs/architecture/acp.md`: GUI와 lophn agent가 같이 쓰는 계약(session meta, 입력 표).
- `project-docs/architecture/agent-chat.md`: 화면(`AgentView`) 규칙. 없는 기능의 칸은 capability로 숨긴다.
- 열린 문제: `node tools/records.ts issues --topic harness-gui --status open`.

| 고칠 것 | 곳 |
|---|---|
| 계약 | `packages/protocol/acp/`, `packages/protocol/extensions/acp-session.ts` |
| CLI 하나의 동작 | `packages/shell/main/extensions/bundled/harness-gui/`의 `<harness>.ts`, 그 test, `fixtures/<harness>/` |
| 탭(handle, toggle, view, 되살리기) | `packages/shell/main/terminal/gui.ts`, `packages/shell/ipc/harness-gui.ts`, `packages/shell/renderer/terminal/terminal-gui.tsx` |
| 폰으로 올리기(handle의 snapshot·갱신을 `/host-link`로, 폰의 입력·switch·열기 받기) | `packages/shell/main/terminal/coding-relay.ts`, `coding-open.ts`, core 쪽 `packages/core/coding-relay/` |
| 화면이 GUI에 묻는 읽기 | `packages/shell/renderer/conversation/agent-tab-gui-source.ts` |
| 화면 | `packages/shell/renderer/conversation/` (lophn agent와 같이 쓴다) |
| 터미널 함수 | `packages/shell/terminal-host/shell-integration.ts` |
| gallery | `tools/wireframes/pages/screens/harness-gui.tsx` |

## 기능을 더하거나 고치는 순서

1. **조사 먼저.** 그 CLI의 TUI, first party desktop app(Claude, Codex), third party(happy, emdash), 사람이 준 harness 조사 자료에서 그 기능이 어떻게 보이고 무엇을 하는지 본다. 조사는 sonnet이 아니라 fork(이 session의 model과 effort를 물려받는다)로 띄운다(사람이 정함). 조사 없이 짠 첫 판은 command가 아무것도 안 했고, subagent·todo 화면이 없었고, vendor icon 대신 글자 avatar를 그렸다. 원인을 모를 때도 추측으로 고치기 전에 남이 어떻게 했는지부터 본다. streaming 끊김, steer, 긴 대화 성능은 셋 다 이렇게 풀렸다.
   - **reference는 `../harness-lab`(`/home/pyosechang/projects/harness-lab`)이다.** 읽기만 하고 그곳의 `AGENTS.md`를 따른다(실행, build, 설치 금지). 앱 하나에 fork 하나씩 동시에 띄우고, 우리 bug 증상과 우리 쪽 구조를 같이 넘긴다.

     | 앱 | 곳 | 이번에 쓸모 있던 것 |
     |---|---|---|
     | Claude desktop | `claude-code/derived/claude-code-desktopapp/` (minified) | Agent SDK를 쓰는 방식(steer detach, send now), streaming throttle, 직접 짠 virtualizer, streaming markdown parser, 줄 단위 code highlight |
     | Codex desktop | `codex/derived/codex-desktopapp/app/` (minified) | rAF frame queue, turn virtualizer와 page 읽기, markdown prefix cache |
     | omp desktop | `omp/omp-desktopapp-nornzach/`, `omp/omp-desktopapp-apoc/` | 32ms 묶기, 걸린 timer를 지우지 않는 throttle, streaming 꼬리 다듬기 |
     | t3code | `t3code/t3code-web/` | snapshot 뒤 live, 50ms 묶기, 받은 메시지 표시(`createdBy`), Claude steer(`now`) |
     | emdash | `emdash/emdash-desktopapp/` | main이 접은 상태와 page, queue와 "Cancel & Send" |
     | happy | `happy/` | 최근 page와 `after_seq`, `pending_steering` |
     | Claude Code CLI 내부 | `$(readlink -f $(which claude))` (Bun 단일 exe) | TUI steer(`sendQueuedNow`), `interrupt {send_now}` 같은 SDK에 없는 control |

   - minified bundle과 CLI exe는 grep·ugrep이 정규식 한도로 멈춘다. `python3 -I`로 `mmap`·`m.find(b'…')` 앞뒤 수백 byte를 찍는다.
   - fork 보고도 추정이 섞인다. 우리 동작을 바꾸는 결론은 녹화나 측정으로 확인한 뒤에 따른다. "`now`가 Bash를 끊는다"(t3code)와 "`interrupt {send_now}`가 TUI와 같다"(CLI 코드)는 녹화에서 둘 다 기대와 달랐다.
2. **다섯 다 본다.** 기능 하나는 CLI 다섯에서 다 되거나, 안 되는 CLI에서는 capability로 칸을 숨긴다. 한 CLI에서 찾은 bug는 나머지에서도 확인한다. `agent-thread.tsx`에 `case "info"`가 없어 넷 모두 command 출력이 사라진 적이 있다.
3. **session 기능은 ACP로.** model, mode, 명령, rewind, fork, compact, 사용량, 제목처럼 lophn agent에도 있는 것은 ACP 계약에 올려 둘이 같이 쓴다. GUI만의 옆길을 만들지 않는다. 순서는 계약 → core와 adapter → 화면이고, 계약을 바꾸면 쓰는 쪽을 같은 변경에서 고친다.
4. **있는 것을 쓴다.** vendor icon(`packages/shell/renderer/parts/vendor-icon/vendor-icon.tsx`), 머리의 뒤로 가기, 있는 popover와 model picker를 쓴다. 사람이 돌려보낸 것: 이중 머리, 회색 원 안의 icon, 글자 "C" avatar, Claude에만 붙은 fast·thinking 칩(model picker의 축으로 옮겼다).
5. **명령은 prompt가 아니다.** `/` 명령은 `run_command`로 adapter가 처리하고, 결과는 `command_output` notice로 보인다. 명령을 prompt로 보내는 adapter는 bug다. palette는 이름이 정확히 같은 것을 맨 위에 둔다.
6. **adapter 동작은 진짜 CLI를 녹화한 fixture로 test한다.** recorder는 `fixtures/<harness>/record.ts`이고 쓰는 법은 file 머리에 있다. 녹화는 실제 model을 부른다.
   - 사람의 허락을 먼저 받는다. 허락 전에는 문서와 type으로 만든 fixture를 쓰고 그렇다고 말한다.
   - 싼 model만 쓴다.
     - Claude: haiku
     - Codex: 가장 싼 것(gpt-6-luna)
     - OpenCode: `openrouter/deepseek/deepseek-v4.1-flash-1017`
     - omp: `river/deepseek-ai/DeepSeek-V4.1-Flash-1017`
     - Antigravity: `gemini-3.8-flash` + thought_level `low`(recorder가 늘 바꾼다). free tier quota를 쓰고 503 과부하가 보통 답 글로 올 수 있다
   - gemini-4-argon은 비싸서 쓰지 않는다. model id는 첫 `/`에서만 자른다(provider 뒤에 `/`가 또 있다).
   - OpenCode 기본 model `openrouter/inclusionai/ling-3.0-tiny`는 context 오류로 녹화가 멈췄다.
   - `RECORD_OUT`은 worktree 밖에 둔다. worktree는 merge 때 지워져 원본 녹화를 잃은 적이 있다.
   - 녹화는 빈 임시 cwd에서 돌린다. OpenCode의 init이 worktree에 AGENTS.md를 쓴 적이 있다.
   - 영구 규칙 승인(always, execpolicy, network amendment)을 보내지 않는다.
   - agy는 녹화 대화를 사람의 `~/.gemini/antigravity-cli/`에 쓴다(auth가 거기 있어 따로 둘 수 없다). recorder가 만든 대화 id를 `created.txt`에 적고 끝에 그것만 지운다. 녹화를 fixture로 옮길 때 `session/list` 답에서 사람의 다른 대화를 빼고 home 경로를 가린다.
   - 사람의 전역 harness 설정은 건드리지 않는다. omp role은 session 안의 `/switch @role`로만 바꾼다.
   - 계획으로 돌릴 때는 녹화를 lead가 돌리고 path를 worker에게 넘긴다.
   - agent가 녹화 명령을 돌리면 권한 분류기가 실제 model 호출("Real-World Transactions")로 막는다. 우회하지 않고 사람에게 `! cd <worktree> && RECORD_OUT=<dir> node …/record.ts <scenario>` 한 줄을 주어 돌리게 한다.
   - 기다리는 명령으로 `sleep`을 쓰지 않는다. 사람 설정의 hook이 standalone `sleep`을 막아 tool이 돌지 않았다. `timeout N …`도 쓰지 않는다. `timeout`은 따로 process group을 만들어, CLI가 tool을 끊거나 옮겨도 살아남아 결과를 그르쳤다. `ping -c 40 127.0.0.1`처럼 평범한 foreground 명령을 쓴다.
   - 사람이 쓰던 실제 session의 transcript(`~/.claude/projects/<cwd>/<id>.jsonl`, 읽기만)가 live 동작의 좋은 증거다. user entry의 `origin`·`promptSource`·`turnOrigin`, `queue-operation`(enqueue·dequeue·remove), tool_result의 시각으로 steer가 언제 닿았는지, 알림이 어떻게 기록됐는지 알 수 있다.

## 확인

- **`npm run check`는 GUI가 되는지 보여 주지 않는다.** 화면을 바꿨으면 gallery를 찍어 본다.
  ```
  npm run wireframes
  PYTHONUNBUFFERED=1 timeout 900 python3 -m http.server 0 -d tools/wireframes/dist   # 찍힌 port를 쓴다
  google-chrome --headless=new --no-sandbox --disable-gpu --user-data-dir=<scratch>/chrome \
    --window-size=1600,1200 --virtual-time-budget=9000 --screenshot=<out>.png \
    "http://127.0.0.1:<port>/index.html#/<page-id>"
  ```
  - headless에서는 `?frame=<id>`로 찍으면 layout이 깨지니 `#/<page-id>`를 쓴다.
  - page id는 `tools/wireframes/pages/screens/harness-gui.tsx`에 있다.
- **실제 앱 확인은 사람이 한다**(사람: "내가 검증하는 게 더 빠르고 정확함"). 앱을 몰아 확인하는 script는 만들다 멈췄다.
  - 끝나면 사람에게 CLI마다 해 볼 것을 목록으로 준다. 무엇을 치고, 무엇이 보여야 하는지 쓴다.
  - 보고에는 무엇으로 확인했는지(test, 녹화, gallery)와 실제 앱에서는 못 봤다는 것을 쓴다.
- **탭 상태를 바꾸면 이것들을 같이 본다.** 다른 workspace에 갔다 오기, 창 다시 load, GUI↔TUI toggle 두 번, GUI와 CLI 양쪽에서 rename, 탭을 다른 창으로 옮기기.
  - 탭 layout은 view를 저장하지 않는다. 그래서 저장본에서 다시 만든 탭이 GUI를 잃었고, `harness-gui:tab-current`로 고쳤다.
  - GUI일 때는 TUI가 터미널 제목을 알리지 않는다. 그래서 탭 이름이 폴더 경로로 남았고, ACP session 제목을 따르게 고쳤다.
- **dev 앱 띄우기**
  - root checkout에서는 먼저 `npm install`을 한다. Agent SDK가 없으면 build가 멈춘다.
  - worktree에서는 `ELECTRON_NO_SANDBOX=1 npm run dev`로 띄운다. worktree의 chrome-sandbox는 root 소유가 아니다.
  - 같은 data root로 이미 떠 있는 dev 앱이 있으면 `npm run dev`가 그 process를 죽인다(이슈 `node tools/records.ts issues --topic code-health`).
- **설치본**
  - `npm run package`를 돌리면 build/linux/lophn_<판>_amd64.deb가 나온다.
  - 판 번호가 같으면 apt가 설치를 건너뛴다. `sudo apt install --reinstall ./build/linux/lophn_<판>_amd64.deb`로 덮어쓴다.
  - 설치 뒤 앱을 완전히 끄고 다시 켜야 새 판이 뜬다.

## 자주 틀린 곳

- **터미널 탭 안에서 lophn을 부르는 code는 CLI 경로와 data root를 shell main에서 받는다.** 터미널 env에는 `LOPHN_*`가 없다. 그래서 그냥 `lophn`을 부르면 설치본(`~/.lophn`)으로 간다. 첫 판에서 개발 앱의 `claude gui`가 설치본 Home 창을 띄웠다(이슈 `terminal-gui-opens-installed-app`).
- **새 ACP item·notice 종류를 더하면 끝까지 그려지는지 본다.** reducer(`packages/protocol/acp/reduce.ts`), `packages/shell/renderer/conversation/thread-layout.ts`, `agent-thread.tsx` 셋을 다 본다. 하나라도 빠지면 조용히 사라진다.
- **화면의 기능을 켰으면 끝까지 이어졌는지 본다.** GUI source의 읽기가 늘 `unavailable`이면 그 기능은 고장 난 것처럼 보인다. Claude rewind가 그랬다. source → main IPC → `run`의 메서드까지 이어졌는지 확인한다.
- **CLI마다 겪은 것**
  - Claude: SDK mode에는 todo tool이 없다. `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`을 준다.
  - Claude steer: SDK mode의 CLI는 TUI와 달리 메시지가 와도 도는 foreground tool을 스스로 background로 보내지 않는다. 그대로면 `next`든 `now`든 Bash가 끝나야 닿는다. 되는 길은 Claude desktop과 같이 `next`로 넣고 3초 넘게 돈 tool을 **tool_use id로** `q.backgroundTasks(id)`하는 것이다. id 없는 `backgroundTasks()`는 task만 등록하고 tool 호출을 풀지 않았고, control 요청 `interrupt {send_now, message_uuid}`는 tool을 멈췄다(녹화 `fixtures/claude/steer_*.jsonl`).
  - Claude transcript: `getSessionMessages`에는 `cost-state`, user entry의 `origin`, `requestId`가 없다. 원본 줄은 `importSessionToStore`(@alpha)로 메모리 store에 받는다. TUI↔GUI로 다시 뜬 CLI는 앞 process가 띄운 task의 알림을 `origin` 없이 `promptSource: "sdk"`로 적으니, 받은 메시지는 글 꼴(`<task-notification>`)로도 가른다.
  - Claude usage: `message.usage`는 content block마다 같은 API 메시지가 반복된다. 합칠 때는 `message.id`와 `requestId`로 중복을 뺀다(t3code 주석: 안 빼면 약 2.4배).
  - Codex: shell item의 command는 `/bin/bash -lc`로 감싼 것이다. 화면에는 사람이 친 명령을 보인다.
  - omp: 없는 path로 `switch_session`하면 조용히 새 session을 만든다. 바꾼 뒤 id를 확인하고, 틀리면 되돌린다.
- **CSS: 한 줄이어야 하는 줄(tool 줄, Working 줄)**
  - 줄 전체에 `white-space: nowrap`을 준다.
  - 줄어들 칸 하나에만 `min-width: 0`과 ellipsis를 준다.
  - 나머지 칸은 `flex-shrink: 0`으로 둔다.
- **biome의 `--write` 뒤에는 diff를 본다.** 상관없는 줄(import 순서)이 바뀌었으면 되돌린다.
- **GUI가 ACP 입력에 싣는 id는 schema를 통과해야 한다.** 화면의 session key를 `ses_${handle}`(handle이 `win_<ULID>`)로 만들었더니 `ses_win_…`이 `idSchema("ses")`에 떨어져 main이 모든 입력을 거절했고, 화면은 "couldn't confirm this message arrived"만 보였다. `guiSessionId`와 그 test가 지킨다.
- **handle의 상태나 갱신의 모양을 바꾸면 폰도 같은 것을 받는다.** shell main이 handle마다 snapshot과 20ms 묶음의 갱신을 core에 올리고 core가 같은 reducer로 접어 폰에 낸다(`architecture/harness-gui.md`의 "폰이 보는 coding session"). adapter가 갱신을 낸다고 끝이 아니라 그 갱신이 core 사본에서도 접히고 redaction을 거친다. 입력을 더하면 `coding_input`으로 오는 것도 `acpInputSchema`를 통과한다.
- **화면 성능은 추측하지 말고 잰다.** gallery page `harness-gui-perf`(긴 대화 + 20ms 글 조각 + 입력)를 headless Chrome CDP로 돌려 main thread 바쁜 시간, 50ms 넘는 frame, 키→paint를 잰다. probe는 commit하지 않았으니 `.dev-data`에 다시 만든다(`perf-stream-lag` worktree가 남아 있으면 그곳 `.dev-data/perf-stream-lag/run.sh`). 화면을 바꾼 뒤 한 번 돌린다. 측정에서 나온 함정:
  - Context 값을 render마다 새로 만들면 그 값을 쓰는 component가 memo를 건너 모두 다시 그린다. `fillShell` 하나로 대화의 모든 markdown이 글자마다 다시 그려졌다.
  - throttle은 걸어 둔 timer를 새 값마다 지우고 다시 걸면 안 된다. 갱신이 그리기보다 잦으면 끝까지 한 번도 터지지 않아, 글이 첫 조각만 보이다 끝에 한꺼번에 나왔다. 최신 값을 ref에 두고 걸린 것은 그대로 둔다(Claude·Codex·omp desktop이 모두 이렇다).
  - 갱신 묶음마다 동기 commit 하나가 난다. 글 조각은 store에서 약 40ms로 묶어 알린다.

## 사람과

- 늘 한국어로 답한다. worker에게는 영어로 쓴다.
- 고를 것을 내밀기 전에 무엇이 어떻게 돌아가는지 먼저 설명한다. 사람이 물은 것에 먼저 답하고, 정하지 않은 것을 혼자 진행하지 않는다.
- UX가 걸린 것은 사람이 생각한 모양을 먼저 확인한다. 첫 판은 GUI를 따로 뜨는 창으로 만들었다. 사람이 원한 것은 그 탭이 GUI로 바뀌고 toggle되는 것이었다.
- 작은 고침은 작게 한다(사람: "좀 간소하게 작업해, 작은 거잖아"). 화면 몇 줄이면 계획이나 worker 없이 바로 고치고 check를 돌린다.
- push는 요청마다 묻는다. 한 번 받은 허락은 그때의 commit까지다. workflow file이 든 commit을 push하려면 gh token에 `workflow` scope가 있어야 한다.
- 사람이 GUI를 써 보며(dogfooding) 찾는 속도가 고치는 속도보다 빠르다(사람: "버그 고치는 속도보다 내가 버그를 '발견'하는 속도가 더 빠르다"). 새로 찾은 것은 바로 계획을 열지 말고 원인만 짧게 확인해 `project-docs/issues/<id>.yaml`(`topic: harness-gui`)에 쌓고, 사람이 정한 때에 묶어서 고친다. 매일 쓰는 길(보내기, steer, 멈추기, 탭 오가기, resume, streaming)이 깨지는 것이 먼저다.
- 고친 것이 새 bug를 낸 일이 여러 번이다(입력 전체 거절, 대화 전체 다시 그리기). worker 보고와 check만 믿지 않고, 그 변경이 지나는 실제 길(IPC 경계, Context 값, 측정)을 lead가 diff에서 확인한다.
