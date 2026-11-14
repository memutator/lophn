# remote-core

- 목표: 폰이 core에 붙는 바탕을 만든다. core가 remote listener를 열고, QR로 pairing한 기기가 암호화된 연결 하나로 route를 부르고 event를 받는다. 폰 앱은 이 계획에 없고 Node client로 확인한다. 나란히, 폰에서 앱 backend를 돌릴 수 있는지 확인한다.
- 재료: `project-docs/products/roadmap/mobile.md`(설계안, 지금 코드, 비교), `project-docs/architecture/{platform,event,approval}.md`, `../harness-lab/_report/remote-control/{orca,paseo,omp}.md`
- 범위 밖: 폰 앱 껍데기와 remote 화면, push, harness GUI 중계, core가 폰에 보내는 요청, 앱 화면 asset stream, relay, 기기 정보를 앱 agent 지침에 넣기. 모두 roadmap의 뒤 단계다.

## 정한 것

- **listener.** 설정 `remote.enabled`(기본 꺼짐)가 켜졌을 때만 core가 따로 WebSocket listener를 연다. port는 설정 `remote.port`(기본 7432), 모든 interface에 bind, path는 `/remote`다. 지금 API listener(loopback, `Host`·`Origin` 검사)는 건드리지 않는다. (agent)
- **암호화.** `Noise_IK_25519_ChaChaPoly_SHA256`, prologue `lophn-remote/1`. core의 key 쌍은 `<data root>/remote/host-key.json`(0600)에 한 번 만들어 둔다. handshake가 끝나기 전에는 어떤 app frame도 받지 않는다. 구현은 Node 전용 API를 쓰지 않는다(뒤에 폰의 JavaScript engine에서 같은 코드가 돈다). 의존성은 판을 정확히 고정한다. (agent: 폰은 QR로 core의 key를 알고 core는 handshake에서 폰의 key를 받는 IK가 pairing과 다시 붙기 둘 다에 맞는다)
- **기기 신원은 공개 key다.** bearer token을 두지 않는다. handshake에서 받은 key가 등록된 기기면 그 기기로 붙고, 아니면 `pair` frame만 받는다. (agent)
- **pairing.** route `pairing/start`(actor user)가 1회용 code(128-bit, 300초, 메모리에만, 새 code가 옛 code를 무효로 한다)와 QR에 실을 것(주소 후보, port, core 공개 key, code)을 돌려준다. 폰은 `pair {code, name, os, width, height, dpr}`를 보낸다. 틀린 code는 연결마다 5번까지다. 맞으면 code를 쓰고 기기를 등록한다. (agent, omp와 Orca의 꼴)
- **기기 표.** ledger 표 `devices`(`dev_…`, 이름, os, 화면 크기, dpr, 공개 key, 만든 때, 마지막 연결, 기준 여부). route는 `devices/list`, `devices/rename`, `devices/revoke`, `devices/set_primary`다. 새로 pairing한 폰이 기준이 된다. 끊으면 그 기기의 연결을 바로 닫는다. 기기의 화면 정보는 설정 `shell.devices`에 같은 이름으로 넣어 지금 쓰는 곳(preview 기기 고르기, `--device`)이 그대로 본다. (agent)
- **frame.** handshake 뒤 JSON frame이다: `hello`(protocol 판, capability), `pair`, `call {id, resource, method, body}`와 `result {id, …}`, Gateway의 `watch`·`ready`·`event`·`closed` 그대로. `call`은 지금 route dispatch를 그대로 탄다. (agent)
- **자격.** 기기 연결은 actor user, principal `device:<id>`다. 부를 수 있는 route는 `packages/protocol/remote/allowlist.ts`의 목록뿐이고 밖의 것은 `forbidden`이다. 목록은 대화와 Inbox가 쓰는 route에서 시작한다(session 목록과 snapshot, `acp/*`, `turn_requests/decide`, `ask/*`, notice, activation 동의, job hold, 공유 요청). secret, provider, 설정 쓰기, 기기와 pairing, 앱 지우기, `host/*`는 넣지 않는다. (agent, 사람이 추천을 받음 2026-11-14)
- **core 깨어 있기.** `remote.enabled`가 켜져 있으면 idle-exit로 끝나지 않는다. `Stop lophn`은 그대로 끈다. (agent, 아르곤의 검토)
- **test는 server를 띄우지 않는다.** 전송을 인자로 받아 메모리 안에서 양쪽을 잇는다. (AGENTS.md "속도")

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `remote-channel` | 없음 | Noise handshake와 frame의 계약과 양쪽 구현(전송은 인자) |
| 1 | `phone-runtime-spike` | 없음 | 폰에서 앱 backend와 SQLite changeset을 돌릴 수 있는지 조사하고 판정 |
| 2 | `remote-devices` | `remote-channel` | listener, 기기 표와 route, pairing, 자격과 route 목록, idle-exit, Node client |
| 3 | `remote-settings` | `remote-devices` | Settings의 Remote 화면: 켜기, QR, 기기 목록 |

## 위험 test (task brief에 있다)

- 등록되지 않은 key의 연결은 `pair` 말고 아무 frame도 통하지 않는다.
- 쓴 code와 300초 지난 code는 다시 통하지 않는다.
- 목록 밖 route는 `forbidden`이다.
- 끊은 기기는 연결이 닫히고 다시 붙지 못한다.

## lead가 할 일

- merge마다 `npm run check`. flows(route, 설정)는 각 task가 고친다.
- `screen-sync`가 먼저 land하면 새 command route에 `changes`가 필수다. `remote-devices`가 그때 맞춘다.
- 끝나면: `PRODUCT.md` 5절("여러 사람용 서비스는 하지 않는다. 한 사람이 자기 폰에서 자기 컴퓨터에 붙는 것은 한다"), `architecture/platform.md`(비목표 "원격 머신…", listener, idle-exit), `event.md`(Gateway가 받는 principal), `approval.md`(기기 자격), `boundary-catalog.yaml`과 `module-catalog.yaml`(remote 연결, 기기), change-log. roadmap `mobile.md`의 단계 1을 끝남으로 적고 spike의 판정을 "폰에서 혼자 도는 앱"에 옮긴다.
- 사람에게: spike가 폰 개발 도구(Android SDK, emulator) 설치를 필요로 하면 설치 전에 묻는다. 끝난 뒤 다른 기기에서 Node client로 pairing해 보는 확인을 부탁한다.
