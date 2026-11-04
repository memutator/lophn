# screen-sdk

화면 쪽: 새 SDK `@lophn/agent`로 앱이 context와 action을 등록하고, shell main이 core의 `ScreenRequested`를 그 앱의 열린 화면들에 보내고 답을 core로 돌려준다.

- 단위: screen (wave 2)
- 선행: screen-core.
- 소유(이 task만 고친다):
  - 새 `packages/sdk/agent/**`(`package.json`, `mod.ts`, `guide.md`)
  - `packages/protocol/shell/app-bridge-types.ts`, `packages/shell/preload/app-tool.ts`, 새 `packages/shell/ipc/app-agent.ts`
  - `packages/shell/main/app-frame/{registry,agent-screen}.ts`(+test), `packages/shell/main/desktop/wiring/app-views.ts`
  - template `packages/core/apps/packages/template/app/{package.json.tmpl,lophn.ts.tmpl,AGENTS.md.tmpl}`, `packages/core/agent-places/skills/design-app/SKILL.md`, `tests/support/app/sample/lophn.ts.tmpl`, `packages/core/apps/releases/ui-build/build.ts`(`FIXED_UI_DEPENDENCIES`), `packages/core/apps/releases/bundle/dependencies_test.ts`, `package-lock.json`
- 읽을 것:
  - architecture: `project-docs/architecture/ui-kit.md`, `project-docs/architecture/app-call.md`, `project-docs/architecture/annotation.md`
  - 선례: `packages/sdk/app-ui/`(bridge type을 복사해 둔다), `registry.ts`의 `AppViewContents.send`(annotate가 쓰는 guest push), `desktop/wiring/app-views.ts:296`(`AppViewChanged` relay)
  - 실수 기록: `project-docs/issues/mistakes.md`의 SDK pin을 빠뜨린 일
  - 제품 결정: 계획 README 정한 것 2~6
- 계약:
  - 쓰는 것: `screen-core`의 `ScreenRequested`, `ScreenAnswer`
  - 내놓는 것: `useAgentContext(key, value)`, `useAgentAction(name, {description, inputSchema}, handler)`

## 할 일

1. SDK: hook 둘. 화면이 등록한 context와 action을 bridge에 알린다. type은 package 안에 복사한다.
2. bridge·preload: 화면 → main은 IPC, main → 화면은 `AppViewContents.send`.
3. shell main: `ScreenRequested`를 받아 registry에서 그 앱의 열린 화면(숨겨 둔 화면 포함, live·preview 표시)을 찾고 보낸다. 답은 물은 화면에서 온 것만 받는다. 화면이 없으면 바로 `unavailable`. 모아서 `ScreenAnswer`로 core에.
4. pin: 새 SDK를 template, sample, `FIXED_UI_DEPENDENCIES`, lockfile에 올린다. 끝나기 전에 `grep -rn "@lophn/agent" --include=package.json`과 깨끗한 worktree의 `npm ci`로 빠진 곳을 본다.
5. 글: template `AGENTS.md.tmpl`과 `design-app` skill에 hook 쓰는 법 한 절.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "shell은 물은 화면의 답만 받고, 화면이 없으면 `unavailable`이고, 상한을 넘는 답은 거절한다"(fake registry, `registry_test.ts` 꼴)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 새 E2E·Electron test가 필요하면 만들지 말고 적는다.
