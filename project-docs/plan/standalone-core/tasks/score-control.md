# score-control

core control 계약과 서버, shell·CLI가 같이 부를 ensure를 더한다. socket에 붙었다는 사실과 사람 결정 handle을 등록할 권한을 구별한다.

- 단위: control (wave 1)
- 선행: 없음. 외부 선행 `platform-ipc` 전체 land는 README대로 lead가 확인한다.
- 소유(이 task만 고친다):
  - `packages/protocol/client/`
  - `packages/protocol/supervision/core-control.ts` (새 file)
  - `packages/core/server/control/` (새 폴더)
  - `packages/core/server/{server,socket}.ts`
  - `packages/core/server/identity/registry.ts`
  - `packages/core/server/identity/confirmation.ts`
  - `packages/core/main/daemon/control.ts` (새 file)
  - `packages/core/main/daemon/core.ts`
  - `packages/core/main/daemon/main.ts`
  - `packages/core/main/daemon/parent.ts`
- 읽을 것:
  - `project-docs/plan/standalone-core/README.md`, `project-docs/products/roadmap/standalone-core.md`
  - architecture: `project-docs/architecture/{approval,platform,layers,run}.md`
  - boundary: `project-docs/boundary-catalog.yaml`의 `core-api`, `child-supervision-protocol`, `coding-agent-cli-interface`; module: `project-docs/module-catalog.yaml`의 `packages/protocol`, `packages/core/server`, `packages/core/main`
  - `packages/core/install-and-update/{instance-lock,data-root}.ts`, `packages/core/main/daemon/{runtime,parent}.ts`
  - `packages/protocol/base/confirmation-handle.ts`, `packages/protocol/supervision/supervision.ts:433-457`
  - `packages/shell/main/desktop/wiring/secret-input.ts`, `packages/shell/main/decision-handle/{ipc,issue}.ts`, `packages/core/server/identity/confirmation-bridge.ts`
- 계약:
  - 쓰는 것: platform-ipc가 옮긴 socket 자리 export와 `ipcPath`, data root별 `acquireInstanceLock`; 기존 loopback HTTP·WebSocket API.
  - 내놓는 것: JSON 한 줄 요청 하나·Result 응답 하나. 공통 오류 코드 일곱만 쓴다. `identify` 결과는 `{product_version, protocol_version, core_epoch, api_url, state: starting|ready|stopping}`이고 credential이 없다. `connect` 결과는 `{user_token, api_url, core_epoch}`다. `stop`은 기존 shutdown barrier를 시작하며 client는 identify가 사라지고 lock이 풀릴 때까지 기다린다. `diagnostic`은 지금 main이 보내는 안전 진단 둘만 받는다.
  - 내놓는 것: connect 요청은 `{type: connect, client: cli|shell}`이고 `shell`의 connect 결과에만 `shell_capability`를 더 준다. control의 `confirmation_handle_register`는 이 capability와 기존 등록 payload를 받아 `{confirmation, expires_at}`을 돌려주고, `confirmation_handle_close_window`는 capability와 `window_id`로 해당 창만 무효로 한다. user token과 scope를 공유하지 않고 HTTP·Gateway·worker route에는 등록 길이 없다. capability는 응답을 받은 main 메모리에만 두고 argv·env·file·renderer·log로 내지 않는다.
  - 내놓는 것: `ensureCore`와 control client를 `packages/protocol/client/`에 둔다. IO는 `dial`, `spawnDetached`, Clock·timer port로 받으며 node/Electron·runtime 전역을 import하지 않는다. shell·CLI adapter가 같은 함수에 의존한다. 반환은 `{api_url, core_epoch, user_token}`과 shell일 때만 private capability다. 제품 판은 root package version, protocol 판은 이 계약의 상수다.

## 할 일

1. 먼저 platform-ipc의 실제 land한 export를 읽는다. 기존 `packages/core/apps/runtime/processes/socket-dir.ts`나 shell의 run-dir 규칙을 복사하거나 고치지 않는다. core socket은 공용 규칙으로 `core`라는 이름을 낸다. control은 `net` JSON-line이고 `packages/core/server/serve.ts:65`의 HTTP unix transport와는 별개다. API transport 전환을 섞지 않는다.
2. `core.ts:101-119`처럼 instance lock을 잡은 뒤에만 socket 잔여물을 치우고 listen한다. 진 core는 살아 있는 core의 socket·runtime file을 건드리지 않는다. migration 전 `starting`, API·wiring·afterReady 뒤 `ready`, shutdown 때 `stopping`을 낸다. 시작 실패·정상 종료에 자기 listener·socket을 닫은 뒤 lock을 푼다.
3. `parent.ts:26-68`의 user operation 계산과 registry issue→revalidate→runtime.record 순서를 새 connect 발급에 재사용한다. CLI user의 `conditions.process`는 `cli`, shell user는 `electron-main`이다. `registry.ts:156-160`의 user process 존재 조건을 없애거나 secret adapter의 machine process/task 검사를 느슨하게 하지 않는다. `electron-main` 문자열을 권한 증명으로 쓰지 않는다.
4. **shell capability는 control `connect {client: shell}`에서만 나온다.** 경계는 control socket(같은 사용자, POSIX 0700 폴더, win32 named pipe)과 다른 길이 없다는 것이다. OS peer 신원 검증은 하지 않는다(README 정한 것). HTTP·Gateway route, agent·worker credential, CLI에서 capability를 얻거나 handle을 등록하는 길을 만들지 않는다. CLI adapter는 `client: shell`을 보내지 않는다.
5. handle의 대상·content hash·allowed decisions·120초 TTL·한 번 소비와 실패 시 예약 해제는 그대로다(`confirmation.ts`). shell 연결 수명이 끝나거나 epoch가 바뀌면 그 shell의 capability·미소비 handle을 무효로 한다. 요청 한 줄 socket을 닫는 것을 shell 전체 종료로 해석하지 않는다. shell main은 Gateway handshake의 `x-lophn-shell-capability` header로 자기 수명을 묶고 core는 capability를 검증한 그 Gateway의 종료 때만 handle을 비운다. HTTP user token만 가진 다른 Gateway가 shell을 흉내 내거나 shell handle을 지울 수 없어야 한다. 창 닫기는 해당 window만 무효로 하는 control 요청으로 잇는다. 등록 결과는 지금 `runtime.confirmation` bridge로 넘긴다. core가 살아남아도 shell view relay가 연결된 채 남지 않도록 같은 shell 종료에서 `runtime.memory.disconnect()`도 잇는다(`core.ts:272`의 지금 core 종료 전용 처리를 분리한다).
6. ensure는 identify→판 대조→connect를 한다. 응답이 없으면 POSIX 새 session, win32 detached+windowsHide로 띄우고 stdout 첫 JSON 줄 `ready` 또는 `start_failed {reason}`만 읽은 뒤 stream과 child 참조를 놓는다. token은 첫 줄에 넣지 않는다. stderr가 닫히지 않아 launcher 수명이 core에 묶이거나 출력 pipe backpressure가 core를 막지 않게 한다. lock conflict로 진 시작은 identify 재시도로 합류한다. pid file·HTTP health probe로 liveness를 대신하지 않는다.
7. 판이 다르면 control stop→종료 확인→새 시작을 한 번 한다. 자동으로 run을 재실행하지 않는다. `START_FAILURE_REASONS`의 schema 실패를 유지해 shell이 지금 실패 화면을 보일 수 있게 한다. 준비 중인 core에는 두 번째 core를 반복 spawn하지 않는다.
8. 옛 소비자가 아직 있으므로 기존 parent 계약과 launcher는 이 task에서 삭제하지 않는다. 새 standalone 시작과 옛 parent wiring을 조립에서 잠시 분리하고, 그 전환 표식을 보고에 적어 cleanup이 전부 지우게 한다. 최종 제품의 호환 mode나 v2 route는 만들지 않는다. 등록 목록 변경은 lead에게 넘긴다.

## 끝남

- `npm run check`가 통과하고 기존 소비자가 type check·기동을 깨뜨리지 않는다.
- 위험 test: "HTTP user token·agent·worker·`client: cli` connect의 credential로는 handle을 등록하지 못하고 shell capability만 등록한다"를 서버 없는 control handler test 한 개의 table로 본다. 잘못 발급된 connect가 경계를 우회하는 행도 넣는다.
- 위험 test: "진 core 시작은 살아 있는 core의 socket·credential을 지우지 않는다"는 기존 instance-lock 경계 test를 먼저 찾아 중복하지 않는다.
- 사람에게 물을 것: 두 ensure의 동시 detached 시작, socket ACL을 보는 새 subprocess·서버 test/E2E. 허락 전에는 새로 만들지 않는다.
- 남지 않음: credential이 identify·startup stdout·진단·오류에 나오는 길, control `connect {client: shell}` 밖에서 shell capability를 받는 길.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 보고 꼴을 따른다. 실제 공용 socket export, 새 client export·schema·일시 전환 wiring, lead가 등록할 목록을 꼭 적는다.
