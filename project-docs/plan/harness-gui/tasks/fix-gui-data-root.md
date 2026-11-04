# fix-gui-data-root

개발 앱의 lophn 터미널 탭에서 `claude gui`를 치면 개발 앱이 아니라 `~/.lophn`의 lophn(설치본)에 창 요청이 간다. 설치본이 꺼져 있으면 저장소의 개발 code가 사람의 실제 `~/.lophn`으로 뜬다.

- 단위: fix (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/terminal-host/shell-integration.ts`
  - `packages/shell/main/desktop/wiring/agent.ts`(`writeShellInit` 호출 줄만)
  - `packages/cli/commands/gui.ts`
  - `packages/cli/commands/gui_test.ts`(새 file, 아래 위험 test만)
- 읽을 것:
  - `project-docs/architecture/harness-gui.md`("`lophn gui`는 core 자격이 없어도 된다", "터미널 함수는 `gui`만 가로챈다"), `project-docs/architecture/terminal-agent.md`(shell 시작 층)
  - `packages/shell/terminal-host/env.ts`(터미널 env가 `LOPHN_*`를 지운다), `packages/base/install/linux-install.ts`의 `devCliLauncher`(`H="${LOPHN_HOME:-$HOME/.lophn}"`), `tools/dev.ts`(개발 data root는 `<root>/.dev-data`, `LOPHN_DEV_HOME`, `dev:mock`)
- 계약: 없음

## 지금

shell 시작 층의 `claude`·`codex`·`opencode` 함수는 `gui`면 `command '<cli>' gui <harness> "$@"`를 부른다. 터미널 env에는 `LOPHN_HOME`이 없어 CLI launcher가 `~/.lophn`을 잡고, `launchDesktop`(`gui.ts`)이 그 env로 Electron을 띄운다. data root가 다르면 single-instance lock이 달라 요청이 그 data root의 앱으로 간다. 사람이 확인했다: 설치본이 떠 있었고 설치본의 Home 창이 떴다.

## 할 일

1. `writeShellInit`이 shell main의 data root를 받아, gui 분기가 `LOPHN_HOME='<data root>'`를 붙여 CLI를 부르게 한다(sh와 fish 둘 다, 따옴표 처리는 지금 CLI 경로와 같게). `agent.ts`는 shell main이 쓰는 data root를 넘긴다. gui가 아닌 호출은 지금 그대로다.
2. `gui.ts`: 저장소 실행(shell main bundle이 있는 경우)인데 `LOPHN_HOME`이 없거나 사람의 기본 data root(`<home>/.lophn`)이면 앱을 띄우지 않고 `invalid_input`으로 끝낸다. 문구는 개발 앱의 터미널 탭에서 치거나 `LOPHN_HOME`을 주라고 말한다. 설치본은 그대로다. 이 판단에 쓰는 env와 home은 인자로 받는다(test가 넣을 수 있게).
3. 고친 시작 층을 bash에서 가짜 명령으로 돌려 `claude gui --resume "a b"`가 `LOPHN_HOME=<data root>`와 같은 인자로 CLI에 닿는지 본다(앞 task가 한 방법과 같다). Electron이나 앱은 띄우지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "저장소 실행의 `lophn gui`는 `LOPHN_HOME`이 없거나 `<home>/.lophn`이면 앱을 띄우지 않는다"(launch를 가짜로 넣어 부르지 않았는지 본다).
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로.
