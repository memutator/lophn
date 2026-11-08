# bu-device

사람이 Settings > Browser에 자기 기기(이름, 크기, DPR, OS)를 등록하고, preview 탭에서 기기를 고르면 폰 테두리 안에 그 크기·DPR·touch·user agent로 emulation한다. `lophn tab open --preview <app> --device <name>`이 그 기기로 연다.

- 단위: bu-device (wave 4)
- 선행: bu-cdp. preview 탭과 shell의 debugger 붙이기를 그 위에서 고친다.
- 소유(이 task만 고친다):
  - `packages/core/config/shell-settings.ts`
  - `packages/protocol/lophn-agent/host-queue.ts`(preview target의 `device`만)
  - `packages/core/main/daemon/wiring/host-queue.ts`(device 확인만)
  - `packages/cli/commands/tab.ts`(`--device`만)
  - `packages/shell/renderer/desktop/settings/browser/`
  - `packages/shell/renderer/workspace/{app-preview-tab.tsx,app-preview-tab.module.css}`
  - `packages/shell/renderer/workspace/kinds/app-preview.tsx`, `packages/shell/renderer/workspace/use-surface-requests.ts`
  - `packages/shell/main/browser/agent/emulation.ts`(새로), `packages/shell/main/browser/agent/{driver,electron-page}.ts`(추가 소유: debugger를 emulation과 같이 쓰는 곳만)
  - `packages/shell/ipc/surface.ts`, `packages/shell/preload/surface-api.ts`, `packages/shell/main/desktop/wiring/surface.ts`(emulation channel만)
  - `packages/design/i18n/catalog/{app-space,browser}.ts`
  - `tools/wireframes/pages/screens/app-space/`(preview 탭 기기 고르기·폰 테두리), `tools/wireframes/pages/screens/settings-pages.tsx`(Browser의 기기 목록)
- 읽을 것:
  - 계획: `project-docs/plan/browser-use/README.md`, `project-docs/products/roadmap/browser-use.md`("무엇을 만드나" 5, "정한 것" 13), `project-docs/products/roadmap/mobile.md`(pairing이 나중에 채운다는 것만)
  - architecture: `project-docs/architecture/{browser-tab,workspace-layout}.md`
  - 본보기: `packages/core/config/shell-settings.ts`(shell 설정 선언), `packages/shell/renderer/desktop/settings/browser/`(지금 Browser pane), `packages/shell/main/browser/agent/`(`bu-cdp`의 debugger 붙이기)
  - skill: `ui-design`, `write-test`, `run`
- 계약:
  - 쓰는 것: `bu-preview`의 kind `app_preview`와 preview target, `bu-cdp`의 debugger 붙이기
  - 내놓는 것:
    - 설정 `shell.devices`: `[{name: string(1..40, 목록 안에서 하나), width: int(200..2000), height: int(200..3000), dpr: number(1..4), os: "ios" | "android"}]`, 상한 32, 기본 `[]`.
    - preview target `{ preview: { app, device: string | null } }`. `--device`가 없으면 null(desktop 크기).

## 할 일

1. 설정 `shell.devices`를 선언하고 Settings > Browser에 기기 목록(더하기, 고치기, 지우기)을 둔다. 일반 기기 표(iPhone·Galaxy 목록)나 반응형 검사는 두지 않는다(roadmap "하지 않는 것"). 새 설정 key라 기본값이 있어 data step은 필요 없다(있으면 보고).
2. preview 탭: 안내 줄에 기기 고르기(Desktop + 등록한 기기). 고르면 view를 그 크기의 폰 테두리 안에 놓고 main에 emulation을 건다. Desktop으로 돌아가면 푼다. 고른 기기는 탭 상태에만 둔다(저장하지 않는 탭이다).
3. emulation(`emulation.ts`): 그 view의 webContents에 크기·DPR(`Emulation.setDeviceMetricsOverride`, `mobile: true`), touch(`Emulation.setTouchEmulationEnabled`, `Emulation.setEmitTouchEventsForMouse`), user agent(OS별 고정 문자열 하나씩)를 건다. debugger는 `bu-cdp`의 붙이기를 같이 쓴다(webContents 하나에 debugger 하나). DevTools가 열려 있어 못 붙으면 탭에 "DevTools를 닫아야 기기 크기를 건다"를 보인다. 앱 live view에는 걸지 않는다.
4. `--device <name>`: core가 `shell.devices`에서 이름을 찾고 없으면 `not_found`("no device named <name>; register it in Settings > Browser"). renderer가 그 기기로 탭을 연다.
5. agent의 screenshot·snapshot·act가 emulation된 크기에서 그대로 돈다(좌표는 emulation 뒤 CSS px).

## lead가 더함 (bu-cdp 뒤)

6. debugger 붙이기는 `packages/shell/main/browser/agent/{electron-page,driver}.ts`에 있다(`electronPage(contents).attach`, driver의 탭 session). webContents 하나에 debugger 하나라 emulation은 driver가 쓰는 같은 붙이기를 거친다. 두 번 attach하지 않는다. agent가 아직 다루지 않은 preview 탭에서도 emulation을 걸 수 있어야 한다(사람이 기기를 고를 때).
7. preview 탭의 view는 앱 view registry에서 찾는다(driver의 preview 찾기와 같은 길, `mode: "preview"`만). 앱 live view에는 emulation을 걸지 않는다.
8. 진짜 Electron 확인은 lead의 확인 script를 쓴다: `/home/pyosechang/projects/lophn/.claude/worktrees/plan-browser-use/.dev-data/verify/harness.ts`(core, fake model, 준비된 release가 있는 앱, headless shell, 사람 CLI `h.cli`)와 본보기 `preview-check.ts`, 뒤 탭 확인 `.dev-data/verify/ghost/`. 네 worktree의 `.dev-data/bu-device/`로 복사해 쓴다. 매번 `node packages/shell/renderer/build.ts`, `node packages/shell/main/build.ts` 뒤 돌린다.
9. "남지 않음" grep은 `tests/`까지 본다(main 절차가 바뀌었다: land가 계획 끝 한 번이라 e2e의 옛 기대값이 늦게 드러난다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(사람 data를 잃거나 경계를 넘는 규칙이 없다). 설정 schema가 틀린 값(크기 밖, 이름 겹침)을 거절하는 것은 schema가 본다.
- (화면) `npm run wireframes`가 되고 gallery의 preview 탭(기기 고른 상태)과 Settings > Browser 기기 목록이 renderer와 같은 component로 그려진다.
- 진짜 Electron 확인: dev로 띄우고 Settings에서 기기 하나(예: 390×844, DPR 3, ios)를 등록 → `tab open --preview <app> --device <name>` → preview가 폰 테두리 안에 그 크기로 그려지고 `browser evaluate <tab> 'innerWidth + "x" + innerHeight + "@" + devicePixelRatio'`가 `390x844@3`, `navigator.userAgent`가 iOS 문자열 → `screenshot`이 그 크기 → Desktop으로 돌리면 풀린다. 못 돌린 단계는 "확인 못 함"에 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 확인 못 함: 진짜 Electron에서 못 본 단계
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
