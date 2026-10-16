# coding-agent-settings

Settings가 제품마다 보이는 coding harness 상태(감지, version, 로그인, 맡길 수 있는지, turn 끝 신호가 있는지)의 shell main 쪽을 만든다. 감지는 CLI `lophn harness detect|refresh`를 exec로 부르고 그 결과를 core에 알린다(README 3장 #60). 사람이 만들던 연결(connection)과 [Start] 흐름은 지운다.

- 단위: coding-agent (wave 3)
- 선행: 없음. 계약 고정 뒤에 열린다. CLI는 계약의 입출력으로 fake한다.
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/coding-connection.ts`
  - `packages/shell/main/desktop/coding-ipc.ts`
- 읽을 것:
  - spec: S6 2장 1, 4장(찾기), 12장 1 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - inventory: `I1.6#9`(사람이 직접 시작하는 길: 이 두 file의 `start`·`folders`·`sessions` 호출), `I1.6#16`(Settings가 맡는 harness 관리), `I2.6#20`(version·로그인을 따로 보인다), `I3.6#14`(turn 끝 신호 유무 표시)
  - 결정: `../README.md` 3장 #60
  - 계약: `packages/shell/ipc/coding.ts`(`HarnessSettingsView`, op `harnesses`), `packages/protocol/coding-agent/{harness-report,harness-adapter,cli-commands}.ts`(`harnessReport`, `canLaunch`, `canDeliverMessages`, `harness detect`·`refresh` 출력)
- 계약:
  - 쓰는 것: 위 계약. core 호출은 shell main이 가진 사람 token의 client를 인자로 받는다.
  - 내놓는 것: `codingCall`의 `harnesses` op 처리: 감지 결과를 `HarnessSettingsView[]`로 돌려준다. renderer source(screens-workspace)가 이 op를 부른다.

## 할 일

1. **감지**(`coding-connection.ts`):
   - 지금의 `connect`(연결 생성, 설치, doctor), `folders`, 연결 intent(`CONNECT_INTENT`), `detectionSchema` 중 연결에 쓰이던 부분을 지운다(`I1.6#9`, `I1.6#16`).
   - 남기는 것은 `lophn harness detect --json`과 `harness refresh --json`을 execFile로 부르는 일(timeout과 출력 상한을 둔다)이다. 처음 호출은 `detect`, 사람이 누른 [Detect again]만 `refresh`다. 화면이 열릴 때 자동 재감지는 없다. CLI가 실패하거나 출력 모양이 틀리면 `unknown`으로 두고 이유를 `HarnessSettingsView.reason`에 싣는다.
   - 감지 결과를 `harnessReport` route로 core에 알린다(`detect`와 `refresh`마다). core가 닿지 않으면 Settings 표시는 그대로 하고 알리기만 실패로 둔다.
   - `HarnessSettingsView`를 만든다: `discovery`, `version`, `login`(확인 못하면 확인 못함, `I2.6#20`), `can_launch`(= `canLaunch(harness)`), `can_deliver_messages`(= `canDeliverMessages(harness)`, `I3.6#14`). 맡길 수 없는 제품과 turn 끝 신호가 없는 제품은 `reason`에 이유를 적는다(S6 2장 1: "이 harness는 turn 끝을 알리지 않는다").
2. **IPC**(`coding-ipc.ts`): `codingCallSchema`의 `harnesses`와 `refresh` op만 처리한다. 옛 op(`connect`, `folders`, `start`, `sessions`)는 거절 대신 지운다. renderer 입력 검사는 기존 guard를 따른다. 사람이 [Start]를 누르는 길은 없다(S6 2장: App Engineer가 맡길 때만 process가 열린다).
3. 옛 `ConnectView`·`FolderChoiceView`·`SessionView`·`StartView`를 쓰던 코드를 이 두 file에서 걷어 낸다. `packages/shell/ipc/coding.ts`의 옛 export는 건드리지 않는다(계약).

- (lead가 더함, screens-workspace-settings의 계약 바꾸기 요청, lead 승인) Settings › Coding agents가 `lophnCoding.harnesses()`·`refresh()`가 `HarnessSettingsView[]`를 돌려준다고 보고 부른다. preload `CodingApi`에 `harnesses(): Promise<CodingReply<readonly HarnessSettingsView[]>>`를 더하고 `refresh`의 반환을 맞춘다(계약 file 추가 소유). main `coding-ipc.ts`가 `harnesses` op를 받게 한다. `HarnessSettingsView`에 감지 시각(`observed_at`)과 찾은 실행 파일 경로를 실을 수 있으면 싣는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -n "CONNECT_INTENT\|connectRequestSchema\|human_start\|connection install\|doctor\|folders" packages/shell/main/desktop/coding-connection.ts packages/shell/main/desktop/coding-ipc.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `packages/shell/main/desktop/main.ts`가 옛 `createCodingConnection`·`codingSessions`·`createChildRegistrar`·`createCodingStart` 등을 import한다. 새 모양으로 바꾸는 일과 `packages/shell/main/desktop/core/allowlist.ts`의 `coding_agent_connections.create`·`CONNECTION_INTENT` 정리는 platform 단위 몫이다. `packages/shell/main/confirmation/kinds/connection-revoke.ts`와 renderer `settings/connections/*`(옛 연결 화면과 `core-source.ts`)는 screens-data와 screens-workspace 몫이다. 이 task가 지운 export 이름을 보고에 적는다.
- 안 쓰게 된 export: `packages/shell/ipc/coding.ts`의 `ConnectRequest`·`ConnectView`·`FolderChoiceView`·`SessionView`·`StartView`·옛 op들
- 정한 것:
  - 처음 감지를 누가 언제 부르는지(Settings가 열릴 때 호출하는지, shell main이 core에 붙는 때 한 번 부르는지). core가 `not_connected`로 맡기기를 거절하지 않으려면 맡기기 전에 감지 보고가 있어야 한다. shell main 시작 때 한 번 부르는 방식을 권한다.
  - CLI exec의 timeout
- 계약 바꾸기 요청: `HarnessSettingsView`에 칸이 더 필요하면 여기에 적는다.
