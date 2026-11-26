# 원격 기계(headless VM)에서 쓰는 lophn의 clipboard UX: 조사 메모

다른 session이 이어서 작업하라고 남긴 조사 결과다. 2026-11-26 main(`061d19966`) 기준이다. 코드는 아직 고치지 않았다.

## 상황

- 사람이 dogfooding에 쓰는 VM은 KVM이고 화면이 없다(`systemd-detect-virt` = `kvm`, `DISPLAY`·`WAYLAND_DISPLAY` 없음, `xclip`·`xsel`·`wl-copy` 없음). 거기서 `/opt/lophn/lophn-desktop`의 core(daemon, terminals host, agent-runtime)만 돈다.
- 사람은 다른 컴퓨터의 lophn desktop 창에서 이 기계에 붙어(remote) 터미널, harness GUI, Explorer, page view를 쓴다.
- 사람의 질문은 "clipboard가 불편한데, VM 설정을 사람이 해야 하는가, lophn이 책임져야 하는가"였다.

## 결론

**lophn 책임이다.** headless VM에는 OS clipboard가 아예 없어서 사람이 켜거나 설치할 것이 없다. 사람 컴퓨터의 clipboard와 VM 안 program을 이을 수 있는 것은 양쪽 끝(shell 창과 core)을 모두 가진 lophn뿐이다.

사람 책임이 되는 경우는 VM에 데스크톱을 띄우고 그 안에서 lophn 창을 직접 여는 경우뿐이다. 이때 host와 guest 사이 clipboard 공유는 VM 프로그램(spice-vdagent, guest additions 등)의 설정이다. 지금 쓰는 방식은 이 경우가 아니다.

설계 근거: `project-docs/architecture/terminal-agent.md` 13번과 22번은 clipboard를 "OS에 붙은 것이라 core로 가지 않는다"고 정해 shell에 남겼다. 그래서 shell 창이 있는 컴퓨터의 clipboard만 다룬다. 원격 기계 쪽 program이 clipboard를 쓰거나 읽는 길은 OSC 52 하나뿐이다.

## 항목별 상세

### 1. 터미널 글 복사·붙여넣기: 동작한다. 단축키 안내가 약하다

- `packages/shell/renderer/terminal/xterm-view.ts:775-785`: `copySelection()`은 xterm 선택을, `paste()`는 `clipboard.paste()` 글을 `term.paste`(bracketed paste)로 보낸다.
- `packages/shell/renderer/terminal/terminal-tab.tsx:174-184`: focus된 터미널이 `terminal.copy`·`terminal.paste` command를 등록한다. 키 이름은 `packages/shell/renderer/desktop/settings/keyboard/model.ts:296-303`에 있다.
- `packages/shell/main/desktop/wiring/terminal.ts:241-253`, `packages/shell/main/desktop/terminal-clipboard.ts`: shell main이 Electron `clipboard.readText()`·`writeText()`를 쓴다. **글만 다룬다.**
- 설계: `terminal-agent.md` 13번. Linux·Windows는 Ctrl+Shift+C/V, macOS는 Cmd+C/V다. 그냥 Ctrl+V는 PTY로 `^V`가 간다.
- UX 문제: Windows·Linux 사람은 Ctrl+V를 누르고 "붙여넣기가 안 된다"고 느끼기 쉽다. 이 문제는 원격이 아니어도 같다.

### 2. TUI가 키보드로 하는 복사(OSC 52)는 버려진다: lophn 정책 때문

- `packages/shell/renderer/terminal/xterm-view.ts:509-519`: `pointerup` 때 `armed = true`가 되고, `keydown` 때 `armed = false`가 된다.
- 같은 file `:566-578`: OSC 52 handler는 `armed`일 때 첫 쓰기 하나만 `clipboard.copy`로 보낸다. 읽기(`?`)에는 답하지 않는다.
- 설계: `terminal-agent.md` 13번의 하위 항목과 결정(232행)이다. "출력은 인터넷에서 온 글일 수 있어 아무 때나 clipboard를 바꾸게 두지 않는다." `products/change-log/0.22/terminal-reattach-mouse-emoji-copy.yaml`도 같은 내용이다.
- 결과: Claude Code에서 마우스로 드래그한 복사는 된다. Claude Code `/copy`, vim·neovim의 `"+y`(OSC 52 clipboard provider), tmux `set-clipboard`처럼 **키를 눌러 시작한 복사는 조용히 사라진다.** headless VM에서는 OSC 52가 터미널 program이 사람 clipboard에 닿는 유일한 길이라 피해가 크다.
- 방향 후보(보안 목적 유지):
  - (a) 사람이 그 터미널에서 키를 누른 직후의 짧은 창(예: 몇 초) 안에 온 OSC 52 쓰기도 받는다. 지금 `keydown`이 disarm하는 것과 반대다.
  - (b) arm되지 않은 OSC 52가 오면 탭 위 toast로 "이 프로그램이 clipboard에 쓰려 합니다 [복사]"를 보이고, 사람이 누를 때 쓴다.
  - 어느 쪽이든 `terminal-agent.md` 13번과 232행 결정을 같은 변경에서 고친다.
- 확인 방법: 앱을 `LOPHN_TERMINAL_TRACE=1`로 띄우면 `<data root>/logs/terminal-trace.jsonl`에 `{"e":"osc52","armed":false}` 줄이 남는다(`change-log/0.22/terminal-trace-env-log.yaml`).

### 3. 터미널의 coding agent(Claude Code 등)에 이미지 붙여넣기: 길이 없다

- Claude Code는 Linux에서 이미지 붙여넣기 때 자기가 도는 기계의 clipboard(`xclip`·`wl-paste`)를 읽는다. VM에는 clipboard가 없어 실패한다.
- lophn 터미널 붙여넣기는 글만 보낸다(`terminal-clipboard.ts`의 `readText`, `xterm-view.ts:780-785`).
- 터미널 탭에는 이미지 drop을 받는 handler도 없다(`terminal-tab.tsx`에 drop·paste 처리 없음).
- 이 불편은 SSH로 Claude Code를 쓰는 사람들도 똑같이 겪는다. lophn은 양쪽 끝을 가져서 풀 수 있다.
- 방향 후보: 터미널에서 붙여넣기할 때 clipboard에 이미지가 있으면(또는 이미지 file을 drop하면) shell이 bytes를 터미널을 가진 기계에 올린다. 올리는 곳은 core가 정하는 임시 경로(예: data root 아래 또는 `/tmp/lophn-<uid>/…`)다. 그 다음 그 **경로를 글로 붙여넣는다.** Claude Code·Codex는 붙여넣은 이미지 경로를 첨부로 받는다.
  - 이 컴퓨터의 터미널이어도 같은 길로 하면 한 길로 맞는다.
  - 새 route가 생기므로 `project-docs/flows/`와 `terminal-agent.md`를 같은 변경에서 고친다.
  - 쓰기 권한은 그 기계의 터미널 입력 허락(`terminal-agent.md` 85행 근처)과 맞춘다.
  - 지금 clipboard IPC는 글만 다루고 shell 창은 `navigator.clipboard.read`가 막혀 있다(`overlay-security`). 그래서 이미지 읽기는 main의 `clipboard.readImage()` 또는 DOM `paste` 이벤트의 `clipboardData.files`로 받아야 한다. Explorer가 쓰는 방식이 뒤의 것이다(`workspace-layout.md:133`).

### 4. 원격 Explorer: OS clipboard 복사·붙여넣기를 숨긴다

- `packages/shell/renderer/workspace/sidebar/explorer.tsx:381`: `isLocal = here && source.remote !== true`.
- 같은 file `:1252-1260`: copy·cut·paste가 모두 `!isLocal`이면 return한다. 원격 기계에서는 스크린샷 같은 이미지나 경로를 붙여 file을 만들 수 없다.
- 설계: `project-docs/architecture/workspace-layout.md:132`("다른 기계의 Explorer는 로컬 OS 전용 동작(… OS 클립보드 복사·붙여넣기 …)을 숨기고"), `:133`(clipboard 모델).
- 방향 후보: 붙여넣기의 이미지 bytes는 이미 `paste` 이벤트로 renderer에 있다. 이것을 그 기계의 `project_files/write|create`(쓰기 허락이 있는 기기)로 보내면 원격에서도 된다. 경로 복사는 글이라 원격에서도 막을 이유가 약하다. 앱 안 copy/cut state로 하는 같은 기계 안 복사·이동도 원격 file route로 할 수 있다.

### 5. 원격 page view(다른 기계의 browser page): 붙여넣기만 되고 복사는 안 된다

- `packages/shell/renderer/browser/page-view/page-view.tsx:232-235`: `onPaste`가 이 컴퓨터 clipboard의 글을 `sendText`로 보낸다.
- 설계: `project-docs/architecture/browser-tab.md` 71번 desktop 항목(168행), 결정(300행: "그 기계의 clipboard에 닿는 길은 없다").
- page에서 고른 글을 사람 clipboard로 가져오는 길이 없다. 우선순위는 낮다.

### 6. VM 안의 agent·script가 `xclip`·`pbcopy`로 "복사했다"고 할 때

- VM에는 clipboard가 없어서 어디에도 가지 않는다. agent가 "clipboard에 복사했어요"라고 말해도 사람 쪽에는 없다.
- 방향 후보: lophn shell-init(`/tmp/lophn-<uid>/…/shell-init/bash.sh` 등. 원본은 core terminals 쪽)이 화면 없는 기계에서 `pbcopy`·`xclip -i` 대신 OSC 52를 내보내는 shim을 PATH에 둔다. 다만 2번 정책 때문에 지금은 버려진다. 2번이 먼저다.

### 7. harness GUI(`claude gui` 등) 채팅창에 이미지 붙여넣기: 아마 된다(원격 미확인)

- `packages/shell/renderer/conversation/composer/agent-composer.tsx:564-569`: `paste` 이벤트의 `clipboardData.files`를 첨부로 붙인다. bytes가 창 쪽에서 오므로 원격 기계의 GUI 탭에서도 될 가능성이 크다.
- 원격 기계에서 직접 확인하지 않았다. 첨부가 그 기계 core로 실제로 넘어가는지 먼저 확인할 것.

## 추천 순서

1. **3번: 터미널 coding agent에 이미지 넣기.** 원격 coding agent 사용에서 가장 자주 막힌다.
2. **2번: 키보드로 시작한 OSC 52 받기.** 보안 결정을 바꾸는 일이라 `terminal-agent.md` 결정을 같이 고친다.
3. 4번(원격 Explorer 붙여넣기), 6번(shim), 5번(page 복사) 순서.
4. 1번의 단축키 안내(터미널에서 Ctrl+V를 누르면 Ctrl+Shift+V를 알려 주는 정도)는 작은 일이라 아무 때나 해도 된다.

사람이 실제로 막힌 것이 어느 항목인지는 아직 듣지 못했다. 순서는 사람 답을 듣고 바꿀 수 있다. 착수할 때는 항목마다 `project-docs/issues/`에 이슈를 올리고(`issue` skill), 이 file은 지운다.
