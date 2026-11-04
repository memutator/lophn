# gui-protocol

extension이 CLI session 하나를 ACP로 내고 그 화면의 입력을 받는 계약을 만든다. `lophn gui <harness>`가 lophn 창을 여는 길과 extension `harness-gui`의 뼈대도 둔다. adapter와 창은 다음 wave다.

- 단위: gui (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/extensions/manifest.ts`
  - `packages/protocol/extensions/acp-session.ts`(새 file)
  - `packages/protocol/extensions/mod.ts`
  - `packages/shell/main/desktop/wiring/extensions.ts`
  - `packages/shell/main/desktop/open-intent.ts`
  - `packages/shell/main/desktop/single-instance.ts`
  - `packages/shell/main/build.ts`(`extensionEntries`에 한 줄)
  - `packages/shell/main/extensions/bundled/harness-gui/{manifest.json,index.ts,adapter.ts}`
  - `packages/core/config/shell-settings.ts`(설정 선언 한 줄)
  - `packages/cli/commands/gui.ts`(새 file), `packages/cli/commands/mod.ts`
- 읽을 것:
  - 계획: `project-docs/plan/harness-gui/README.md`의 정한 것 3~6
  - architecture: `project-docs/architecture/extension.md`, `acp.md`
  - ACP 꼴: `packages/protocol/acp/`(`AcpState`, `AcpUpdate`, `AcpInput`, `reduceAcp`)
- 계약:
  - 쓰는 것: `packages/protocol/acp/`. 모양은 바꾸지 않는다.
  - 내놓는 것:
    - `ExtensionContext.acp.open({harness, cwd, title}) → AcpSessionHandle`. handle은 `{id, publish(update: AcpUpdate), onInput(listener: (input: AcpInput) => void), onClose(listener), close()}`다. `id`는 lophn session id가 아니라 이 창 하나의 id다. shell main이 handle의 update를 그 창으로 보내고, 창의 입력을 listener로 준다. 창을 닫으면 `onClose`가 불린다.
    - `HarnessGuiAdapter`(`bundled/harness-gui/adapter.ts`): `start({cwd, resume?, session: AcpSessionHandle, spawn, clock, ids}) → Promise<Result<{stop(): void}>>`. harness마다 하나이고 다음 task들이 채운다. 이 task는 표(`claude`, `codex`, `opencode` → adapter)만 두고 셋 다 `unavailable`을 돌려준다.
    - open intent `--harness-gui <harness> --cwd <dir> [--resume <id>]`. 첫 실행과 second-instance 둘 다 읽는다. 받으면 extension `harness-gui`의 `open`을 부른다. 꺼져 있으면 창 대신 Settings › System › Extensions를 연다.
    - CLI `lophn gui <harness> [--resume <id>]`: core 자격 없이 lophn 앱 실행 파일을 위 intent로 띄운다(이미 떠 있으면 second-instance가 받는다). cwd는 친 곳이다.
    - 설정 `extensions.harness-gui.enabled`(기본 false).

## 할 일

1. 위 계약을 만든다. `ExtensionContext`에 `acp`를 더하고, shell main(`wiring/extensions.ts`)이 handle을 만들어 창 쪽에 넘기는 자리를 둔다. 창이 아직 없으니 이 task에서는 handle의 update를 쌓아 두는 in-memory 쪽까지만 만들고, 창을 여는 함수는 `gui-window`가 채울 port로 둔다.
2. extension `harness-gui`: manifest(`provides`: harness GUI), `index.ts`의 `activate`가 open intent를 받아 adapter 표를 부른다. `build.ts`의 `extensionEntries`와 판 검사에 들어간다.
3. extension code는 `ctx`로만 lophn에 닿는다(`tools/check-deps.ts` rule `extension`).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(계약과 뼈대다). open intent 읽기는 기존 test 꼴에 case를 더한다.
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로.
