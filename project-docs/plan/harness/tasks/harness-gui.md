# harness-gui

lophn 터미널에서 `<harness> gui`를 치면 lophn 창에 그 harness의 ACP session이 열린다. 대화 화면이 harness session을 그리고, 설정 화면에서 harness를 켠다.

- 단위: harness (wave 5)
- 선행: harness-acp.
- 소유(이 task만 고친다):
  - `packages/shell/terminal-host/shell-integration.ts`(bash·zsh·fish의 `claude` 함수와 `gui` 하위 명령)
  - `packages/shell/main/terminal/**`(hook socket으로 gui 요청 받기), `packages/shell/main/harness/**`(gui 시작)
  - `packages/shell/renderer/conversation/**`(harness session에서 model 고르기, skill, rewind, compact를 숨긴다), `packages/shell/renderer/desktop/settings/**`(harness 켜기), `packages/design/i18n/catalog/**`
- 읽을 것:
  - architecture: `project-docs/architecture/terminal-agent.md`, `agent-chat.md`
  - 제품 결정: 계획 README 정한 것 1, 4, 범위 밖(lophn 밖 터미널은 하지 않는다)
- 계약:
  - 쓰는 것: `harness-acp`의 host
  - 내놓는 것: 없음

## 할 일

1. shell 함수: `claude gui`, `codex gui`, `opencode gui`는 hook socket으로 shell main에 알리고 끝난다. 다른 인자는 지금처럼 원래 CLI로 간다.
2. shell main: 그 터미널의 cwd가 이은 project 폴더 안이면 그 project place, 아니면 home으로 harness session을 열고 ACP host를 시작하고 그 session 탭을 연다.
3. 대화 화면: harness session은 같은 source로 그린다. lophn에만 있는 조작은 숨긴다. TUI 열기 단추는 외부 session id로 resume한다(`HARNESS_ADAPTERS`).
4. 설정: harness 켜기와 감지한 harness 목록.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(화면, shell 함수는 기존 test 꼴이 있으면 따른다)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
