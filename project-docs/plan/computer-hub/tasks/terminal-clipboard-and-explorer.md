# terminal-clipboard-and-explorer

- 단위: terminals, project_files, shell clipboard & explorer (wave 1)
- 선행: 없음
- 목표: 터미널 이미지 paste/drop, OSC 52 1 MiB 쓰기 + `@xterm/headless` remote toast + 설정 스위치, Linux headless PATH clipboard shim, remote Explorer copy/paste(`write_bytes`/`copy` + `isLocal` 제한 해제)를 구현한다.
- 소유:
  - `packages/core/terminals/`
  - `packages/core/main/daemon/wiring/terminals.ts`
  - `packages/core/projects/files/`
  - `packages/shell/main/desktop/terminal-clipboard.ts`
  - `packages/shell/main/desktop/wiring/terminal.ts`
  - `packages/shell/renderer/terminal/`
  - `packages/shell/renderer/desktop/machines/remote-files.ts`
  - `packages/shell/renderer/desktop/machines/remote-files_test.ts`
  - `packages/shell/renderer/workspace/sidebar/explorer.tsx`
  - `packages/design/i18n/catalog/shell.ts`
- 참조:
  - `packages/protocol/coding-agent/terminals.ts`
  - `packages/protocol/events/transient.ts`
  - `packages/protocol/projects/project-files.ts`
  - `packages/shell/ipc/terminal.ts`
  - `packages/shell/preload/terminal-api.ts`
  - `packages/shell/main/desktop/core/connection.ts`
  - `packages/core/config/shell-settings.ts`
  - `packages/core/terminal-view/`
  - `project-docs/products/roadmap/computer-hub.md`

## 구현

1. **터미널 이미지 붙여넣기 & drop (`terminals/paste_image`)**:
   - `packages/core/terminals/`: `terminals/paste_image` handler를 구현한다(허용 MIME: `image/png`, `image/jpeg`, `image/webp`; max decoded bytes 10 MiB 내외, core 임시 디렉터리 예: `<dataRoot>/tmp/terminal-paste/`에 안전한 확장자로 저장 후 오래된 임시 파일은 정리하고 경로 + byte 크기 반환; `packages/core/terminals/routes.ts`에서 `allowed(principal, input.shell_capability)`로 입력/capability 권한 검사). `wiring/terminals.ts`의 Step 0 stub을 실제 handler로 교체하고, remote call 시 terminal input 권한을 동일하게 확인한다.
   - `packages/shell/renderer/terminal/` (`xterm-view.ts` 등): paste event(클립보드 이미지) 및 drag-and-drop 파일/이미지를 잡아 `window.lophnTerminal.pasteImage`로 넘기고 반환된 경로를 터미널 입력으로 넣는다.
   - non-mac(Linux/Windows)에서 터미널 포커스 중 `Ctrl+V`를 눌렀을 때(설정에 따라 copy/paste 단축키가 `Ctrl+Shift+V`일 때) 사용자에게 1회/가벼운 toast 힌트(`Ctrl+Shift+V` 안내)를 띄운다.

2. **OSC 52 1 MiB 쓰기 + `shell.terminal.osc52_clipboard` + remote toast**:
   - `packages/shell/renderer/terminal/` (`xterm-view.ts`):
     - OSC 52 (`ESC ] 52 ; ... BEL/ST`) write를 최대 **1 MiB**까지 허용하고, 기존 `pointerup` 등 불필요한 게이트를 제거한다. 읽기 요청(`?`)은 계속 차단한다.
     - `shell.terminal.osc52_clipboard` 설정이 `false`면 OSC 52 클립보드 쓰기를 무시한다(기본 `true`).
   - Remote 터미널(`@xterm/headless`, `packages/core/terminals/` 또는 `packages/core/terminal-view/` 참조 — 단 `packages/core/terminal-view/`를 고쳐야 한다면 소유 범위 확인, 가능하면 `packages/core/terminals/` host 출력/OSC 감시에서 `TerminalClipboardWritten` transient event 발행!):
     - 참고: remote terminal 화면에서 OSC 52가 들어오면 `@xterm/headless`/output 감시가 `TerminalClipboardWritten` event를 발행하고, 수신한 shell renderer/desktop이 토스트 알림("클립보드 복사 요청(X bytes)" 등)을 띄워준다. (필요 시 `terminal-view`가 직접 parser를 갖는 구조라면 최소 인터페이스로 연결하거나 `terminals/`에서 파싱; 만약 `packages/core/terminal-view/` 수정이 꼭 필요하면 먼저 확인 후 최소화.)

3. **Linux headless PATH clipboard shim (`packages/core/terminals/person-env.ts` / host)**:
   - Linux에서 `DISPLAY`와 `WAYLAND_DISPLAY`가 모두 없는 headless/SSH 세션으로 열린 터미널의 `person-env` PATH 앞에 shim 스크립트(`pbcopy`, `xclip`, `xsel`, `wl-copy` — 기존 시스템 바이너리가 없고 DISPLAY/WAYLAND_DISPLAY가 비었을 때만 fallback 또는 `/dev/tty`로 OSC 52 이스케이프 시퀀스를 뱉는 안전한 쉘 shim)를 배치한다.

4. **Remote Explorer Copy/Paste (`project_files/write_bytes`, `project_files/copy`, `explorer.tsx`)**:
   - `packages/core/projects/files/mod.ts`: Step 0의 `writeBytes`·`copy` stub을 실제 구현으로 바꾼다(폴더 경계·symlink 탈출 검사 철저, `files_test.ts`에 경계·symlink 테스트 추가).
   - `packages/shell/renderer/desktop/machines/remote-files.ts`: `writeBytes`, `copy` client helper 연결 및 `remote-files_test.ts` 보강.
   - `packages/shell/renderer/workspace/sidebar/explorer.tsx`: 기존 `if (!isLocal) return` / `isLocal` 차단을 `!readOnly` 기반으로 열어, 쓰기 허락(`grant !== "denied" && !writeForbidden`)이 있는 원격 project Explorer에서도 파일 붙여넣기(이미지/바이너리/텍스트)/복사/드롭이 동작하게 한다.

5. **Flows**:
   - Step 0의 `project-docs/flows/areas/projects.yaml`, `harness.yaml` stub 문구는 Wrap-up에서 일괄 정돈하되 error outcome은 route 계약과 일치시킨다.

## 완료 기준

- `node --test packages/core/terminals/*_test.ts packages/core/projects/files/files_test.ts packages/shell/renderer/desktop/machines/remote-files_test.ts packages/core/main/daemon/wiring/terminals_test.ts` 통과
- `node packages/shell/renderer/build.ts && npm run check` 통과
