# score-shell

shell을 core의 부모가 아니라 ensure client로 바꾼다. Quit와 core 전체 중지를 나누고 로그인 시작은 ensure만 한 뒤 끝낸다.

- 단위: shell (wave 3)
- 선행: score-idle
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/core/`
  - `packages/shell/main/desktop/{main,quit,tray,autostart,launch-mode,single-instance,open-intent}.ts`
  - `packages/shell/main/desktop/wiring/{core,crash,app-views,secret-input,desktop}.ts`
  - `packages/shell/main/decision-handle/`
  - `packages/shell/main/secret-input/`
- 읽을 것:
  - `project-docs/plan/standalone-core/README.md`, `project-docs/products/roadmap/standalone-core.md`
  - architecture: `project-docs/architecture/{approval,event,platform,app-notice,coding-agent}.md`
  - boundary: `project-docs/boundary-catalog.yaml`의 `shell`, `core-api`, `event-stream`; module: `project-docs/module-catalog.yaml`의 `packages/shell/main`
  - `packages/shell/main/desktop/core/{supervise,connection,events,client,login-path}.ts`
  - `packages/shell/main/desktop/wiring/{context,core,crash,app-views,secret-input,desktop}.ts`
  - `packages/shell/main/desktop/{quit,tray,autostart,launch-mode,single-instance,main}.ts`
  - score-control의 실제 control·ensure export, `packages/protocol/events/gateway.ts`의 `closed(shutdown)`
- 계약:
  - 쓰는 것: 공용 ensure·control client·shell 전용 capability. renderer에는 기존 core IPC의 상태·event·call 결과만 준다.
  - 내놓는 것: 일반 Quit·Cmd+Q·`--quit`·will-quit는 shell 자원과 연결만 정리한다. tray·메뉴의 별도 `Stop lophn`은 core stop을 기다리고 shell도 끝낸다. 멈추는 동안 자기 reconnect는 core를 다시 띄우지 않는다.
  - 내놓는 것: `--core` 또는 macOS `wasOpenedAtLogin`은 ensure만 하고 바로 끝나는 intent다. 창·tray·terminal-host·extension 전체를 조립하지 않는다. shell single-instance lock은 남기며 이미 shell이 있어도 core-only intent가 창을 열지 않는다.

## 할 일

1. `supervise.ts`의 새 연결 경로는 spawn 소유권 대신 ensure·identify·connect를 쓴다. `connection.ts:130-181`의 hello 연결을 새 결과로 바꾸고, epoch가 바뀌면 session·Gateway·watch를 다시 만든다. 기존 `loginPathOf`의 macOS PATH 준비는 유지한다. token·capability는 main 메모리에만 둔다.
2. Gateway가 끊겼는데 identify가 답하면 Gateway만 다시 붙는다. identify가 사라지고 crash처럼 예고 없는 단절이면 ensure를 다시 한다. 동시 renderer 재연결로 ensure가 여러 번 돌지 않게 한다. 지금 `connection.ts:168`의 `core.phase !== stopped` 때문에 재연결이 영영 멈추는 길을 없애고 상태를 renderer에 알린다.
3. 명시 stop은 재시작 요청이 아니다. 자기 `Stop lophn` 때는 reconnect를 먼저 멈추고, 다른 client의 control stop은 기존 `closed(shutdown)`을 보고 자동 spawn을 하지 않는다. 판 교체로 새 core가 나타나면 identify로 다시 붙을 수 있게 하되, CLI core stop을 shell이 즉시 되살리는 loop를 만들지 않는다. 이 신호가 부족하면 lead에게 계약 변경을 요청한다.
4. `wiring/core.ts:74`의 `stop: core.shutdown()`은 detach로 바꾼다. `ctx.stopAll()`을 부르는 quit·will-quit·crash에서 control stop이 나가지 않게 한다. 터미널·pending save 확인은 지금 quit guard를 유지하고, `Stop lophn`은 확인이 취소되면 core도 그대로 둔다. stop 성공 전에 app을 끝내 응답·정리를 잃지 않는다. UI 문구 key는 lead에게 등록 요청으로 넘긴다.
5. `registerConfirmation`은 shell capability로만 등록한다. 일반 HTTP core call IPC에서 등록을 받을 수 없게 하고 `wiring/secret-input.ts`의 sender→실제 parent window 검사와 보호 입력 창 격리는 유지한다. capability는 renderer·extension host env로 넘기지 않는다. main이 여는 Gateway handshake에만 `x-lophn-shell-capability`를 싣고 window 닫힘과 Gateway 종료 때 미소비 handle·shell relay를 무효로 하는 새 경로를 잇는다.
6. `diagnostic`은 control JSON-line으로 옮겨 shell-view 수명 log와 shell-main crash 진단을 유지한다. `wiring/app-views.ts`의 진단 호출자는 같은 변경에서 맞춘다. 실패하면 진단만 잃고 core를 끄지 않는다.
7. `main.ts`는 full wiring 전에 core-only intent를 가른다. `launch-mode.ts`의 `TRAY_INTENT`, `.tray`와 `--tray`를 쓰는 곳을 전부 찾아 `--core`로 옮긴다. Linux desktop entry·Windows login item args를 바꾸고, argv를 못 받는 macOS는 `wasOpenedAtLogin`으로 같은 경로에 들어간다. second-instance의 core-only intent는 새 창 요청으로 해석하지 않는다.
8. 현재 켜진 autostart 등록은 업데이트 뒤에도 켜져 있어야 한다. 옛 등록을 새 intent로 한 번 다시 쓰고 제품 실행의 `--tray` fallback은 남기지 않는다. OS 등록은 ledger/data root 파일이 아니므로 data migration은 아니다. 개발·headless의 OS 등록 금지는 유지한다.
9. tools의 `verify-linux-install.ts`는 아직 옛 `spawnCore`를 import한다. 그 소비자가 옮겨질 때까지 export·type을 먼저 지우지 않는다. shell 자체는 옛 pipe를 더 이상 쓰지 않으며 남은 export·옛 test는 cleanup 목록으로 보고한다. platform-ipc 소유인 bridge·run-dir·terminal hook file은 고치지 않는다. 공용 context·i18n 등록은 lead에게 넘긴다.

## 끝남

- `npm run check`가 통과한다. renderer를 바꾸는 등록이 있으면 lead가 renderer build도 확인한다.
- 위험 test: 기존 decision-handle/secret-input test가 일반 renderer·앱 view·보호 창의 잘못된 sender로 사람 handle을 받지 못하는 경계를 계속 지킨다. 새 control handler의 같은 경계 test를 중복하지 않는다.
- 설계가 달라진 supervisor·quit·launch-mode 내부 구현 test는 새 설계로 억지로 살리지 않는다. 위험 없는 UI·문구 test는 새로 만들지 않는다.
- 사람에게 물을 것: 실제 Electron Quit·Stop lophn·crash 뒤 core 생존, 로그인 intent·second-instance를 보는 새 subprocess·브라우저·E2E test. 사람이 허락하지 않았으면 수동 확인 필요로 보고한다.
- 남지 않음: shell 정리에서 core.stop을 부르는 길, core-only intent가 창·tray·host를 여는 길, renderer HTTP token이 shell capability 대신 쓰이는 길.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 보고 꼴을 따른다. lead가 맞출 context·i18n 목록, 남은 옛 소비자와 export, 실제 OS/화면 확인 여부를 적는다.
