# sweep-connection-paths

폰과 다른 기계의 desktop이 컴퓨터에 직접 붙는 주소를 pairing 뒤에도 새로 알게 하고, 사람이 알려 줄 주소를 적을 수 있게 한다.

- 단위: connection-paths (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/remote.ts`
  - `packages/core/remote/{host.ts,host_test.ts}`
  - `packages/remote-client/`
  - `packages/protocol/remote/{frames.ts,channel.ts,mod.ts}`
  - `packages/core/config/shell-settings.ts`
  - `packages/mobile/src/pairing/`
  - `packages/mobile/src/screens/settings/`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(`fix`의 "한 것" 줄이 wave 1이 이미 한 부분이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 이 task는 아래 소유에 든 protocol, IPC, preload를 고쳐도 된다(wave 1이 계약 밖이라 못 한 일이다). 소유 밖의 계약은 고치지 않고 보고에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

1. 이슈 `phone-direct-addresses-fixed-at-pairing`: 붙을 때마다 컴퓨터가 지금 주소 후보를 알려 주고 client가 저장한 목록을 바꾼다. 컴퓨터 설정에 사람이 적는 주소 목록을 두어 interface 주소 앞에 싣는다(QR과 다시 알려 주는 목록 둘 다).
2. 설정 화면에 그 칸을 놓는 것은 `packages/shell/renderer/desktop/settings/remote/`(다른 task의 소유)라 하지 않는다. 설정 key와 CLI(`lophn settings set`)로 되게 하고 화면은 "넘길 줄"에 적는다.

알아 둘 것:
- 원칙(사람이 정했다): lophn은 사용자의 환경을 요구하지 않고 환경에 맞는 길을 준비한다. 길은 lophn이 스스로 고른다(지금처럼 직접 주소와 relay를 같이 걸고 먼저 붙는 쪽).
- 폰이 지금 길(Direct, Relay)을 보이는 것은 이미 있다(`screens/settings/index.tsx`).
- `packages/core/remote/devices.ts`와 pairing은 `sweep-phone-terminal-remote`의 것이다.
- 실제 relay에 붙지 않는다. 주소 목록은 사람이 적은 글이라 꼴만 검사하고(길이, 개수) 공격자로 보지 않는다.

## 끝남

- `npm run check:full`이 통과한다.
- 폰 앱을 고쳤으므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다(root check 밖이다).
- 위험 test: "폰이 저장한 주소 목록은 hello에서 기계 id를 대조한 연결에서 온 것으로만 바뀐다"(다른 기계가 주소를 바꿔치기하지 못한다)
- 항목마다 했는지, 못 했으면 왜인지가 보고에 있다.

## 보고

- 항목마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"
