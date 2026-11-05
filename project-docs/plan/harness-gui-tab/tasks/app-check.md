# app-check

끝났다고 말하기 전에 실제 앱으로 확인하는 script를 둔다(README 정한 것 19). E2E 꼴이고 사람이 허락했다. script가 하는 일:

- 개발 앱(Electron, data root는 `.dev-data`)을 띄운다.
- project place의 터미널 탭에서 `claude gui`·`codex gui`·`opencode gui`·`omp gui`를 친다.
- CLI마다 기능 목록을 하나씩 해 보고 화면을 찍는다.

기능 목록도 이 task가 만든다. 정한 것 14-17에서 사람이 찾은 것과 고친 것이 다 들어간다:

- 명령 세 갈래와 그 출력
- `/` palette 순위
- vendor 아이콘
- subagent, todo, background task와 멈추기
- 켜고 끄기, goal, role
- 사용 한도
- thread index와 bookmark
- GUI↔TUI toggle

실제 CLI는 싼 model로 부른다:

- Claude: haiku
- OpenCode: `openrouter/deepseek/deepseek-v4.1-flash-1017`
- Codex·omp: 그 CLI의 가장 싼 model

worker는 실제 CLI와 model provider를 부르지 않는다. 돌리는 것은 lead다. wave 5-7이 다 merge된 뒤에 시작한다.

- 단위: check (wave 8)
- 선행: thread-index. 앞 wave는 모두 먼저 merge된다.
- 소유(이 task만 고친다):
  - `tools/app-check/`(새로: app driver, 실행 script, CLI별 기능 목록)
- 맞출 곳(그 줄만): `tools/dev.ts`(앱을 띄우는 함수를 export해야 하면 그 줄만)
- 읽을 것:
  - README 정한 것 14-19
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/`:
    - `audit-{claude,codex,opencode,omp}.md`의 §1·§2(기능표와 명령 분류). 기능 목록의 원천이다
    - `ui-reference.md` §0·§1·§3
  - 앱 띄우기: `tools/dev.ts`(`.dev-data` data root, fake provider, `LOPHN_LIVE_PROVIDER`), 기존 E2E 지원 `tests/support/app/`
  - architecture: `project-docs/architecture/harness-gui.md`, `terminal-agent.md`(탭의 `gui` 함수와 hook socket)
- 계약:
  - 쓰는 것:
    - wave 5-7이 merge된 앱
    - 사람 PATH의 `claude`·`codex`·`opencode`·`omp`
  - 내놓는 것:
    - lead가 돌리는 명령 하나. harness를 골라 돌릴 수 있다. `package.json` script 줄은 lead가 넣는다
    - 화면 사진은 `.dev-data/app-check/<시각>/`에 남는다. 저장소에도 `~/.lophn`에도 쓰지 않는다
    - 기능 목록 줄마다 통과·실패·사진 경로를 담은 보고
    - driver를 고르는 것은 이 task다(Playwright의 Electron driver를 판 고정 새 의존성으로, 또는 Electron `--remote-debugging-port`와 CDP). 새 의존성은 보고하면 lead가 `package.json`에 넣는다

할 일: (살 단계가 채운다)
