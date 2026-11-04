# fix-gui-dev-sandbox

개발 앱의 lophn 터미널 탭에서 `claude gui`를 치면 창이 뜨지 않는다. `lophn gui`가 띄운 Electron이 sandbox 오류로 argv를 넘기기 전에 죽는다.

- 단위: fix (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/cli/commands/gui.ts`
- 읽을 것:
  - `project-docs/architecture/harness-gui.md`("`lophn gui`는 core 자격이 없어도 된다", "터미널 함수는 `gui`만 가로챈다")
  - `tools/dev.ts`의 `--no-sandbox` 판단, `packages/shell/terminal-host/env.ts`(터미널 env가 `ELECTRON_*`·`LOPHN_*`를 지운다)
- 계약: 없음

## 지금

`launchDesktop`(`gui.ts`)은 저장소 실행일 때 env `ELECTRON_NO_SANDBOX=1`이 있어야 `--no-sandbox`를 붙인다. 터미널 탭 env에는 `ELECTRON_*`가 없다. 이 기계(Ubuntu, `kernel.apparmor_restrict_unprivileged_userns=1`, `node_modules/electron/dist/chrome-sandbox`가 setuid 아님)에서 flag 없는 개발 Electron은 `FATAL ... setuid_sandbox_host.cc ... The SUID sandbox helper binary was found, but is not configured correctly`로 exit 133이다(lead가 display 없이 확인). CLI는 spawn이 됐으니 "opened"를 찍는다.

## 할 일

1. 저장소 실행(shell main bundle이 있는 경우)에서는 `--no-sandbox`를 늘 붙인다. 설치본은 그대로다. 주석의 이유를 고친다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: `ELECTRON_NO_SANDBOX`를 `gui.ts`에서 grep해 0줄.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로.
