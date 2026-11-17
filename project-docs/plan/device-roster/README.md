# device-roster

- 목표: 한 사람의 기기들이 "내 기기 명단" 하나를 같이 든다. 새 기기는 이미 든 컴퓨터 아무거나 하나의 초대로 들어오고, 명단이 나머지에 퍼져 모든 기계와 이어진다. 컴퓨터끼리는 core가 서로 붙어 있다.
- 재료: `project-docs/products/roadmap/multi-device.md`("어떻게 한 묶음이 되나", "길"), `project-docs/architecture/remote.md`, `machine.md`, `approval.md`, 조사 `reports/multi-device/survey-s2-roster.md`(지금 code, file 묶음 G1~G12, 이어 쓸 자리)와 `device-enrollment-survey.md`(다른 제품. 서명한 명단을 쓰는 제품은 없다)
- 범위 밖: 한 화면에 여러 기계의 것을 섞어 보이기(`one-screen`), agent와 앱이 다른 기계를 부르기(`remote-use`), 명단을 폴더로 나르기와 컴퓨터끼리 앱 data 맞추기(`carry-paths`), 설정과 secret을 기기에서 넣기(`core-setup`), relay 서버 고치기

## 정한 것

본보기가 없다. 그래서 계약 task가 끝나면 구현을 띄우기 전에 다른 worker에게 설계 review를 맡긴다("lead가 할 일").

정체:
- **컴퓨터의 정체는 core의 것 하나다.** 지금의 host key(`remote/host-key.json`)를 받는 쪽과 붙는 쪽 둘 다에 쓰고, 명단 항목에 서명할 서명 key 하나를 더한다. shell main이 따로 들던 붙는 쪽 key와 목록(`shell/viewer/key.json`, `machines.json`)은 없앤다. (agent: 화면 없는 기계도 같은 정체를 가져야 한다)
- **폰의 정체는 지금의 device key다.** 폰은 서명 key가 없고 누구도 들이지 못한다. (사람: "이미 든 컴퓨터 하나가 승인")
- **기기 id는 명단 전체에서 하나다.** 지금 컴퓨터마다 따로 만든 `dev_`는 migration에서 그대로 명단의 id가 된다. `app_sync_log.device`, `shell.devices[].device`, principal `device:<id>`는 같은 값을 쓴다. (agent)

명단:
- **명단은 서명한 항목의 모음이다.** 항목은 기기 하나(id, 종류 computer|phone, key, 컴퓨터면 서명 key와 `mch_`, 이름, os, 터미널 입력 허락, 들인 쪽, 서명)이고, 빼기도 서명한 항목이다. 폴더나 폰처럼 믿지 않는 곳을 거쳐도 서명으로 가린다. (agent: 한쪽만 켜진 기계에도 퍼져야 한다)
- **믿음은 나에서 시작해 서명을 따라간다.** 컴퓨터는 자기를 믿고, 믿는 컴퓨터가 서명한 항목을 믿는다. 컴퓨터 둘이 이어질 때 서로의 항목에 서명하므로 두 명단이 합쳐진다. (agent)
- **빼기가 이긴다.** 뺀 key는 다시 들이지 못한다(새 key로 다시 들어온다). 뺀 컴퓨터가 서명한 항목은 빼기를 알기 전에 받은 것만 남긴다. (agent)
- **허락은 항목에 있다.** 터미널 입력 허락은 기기마다 하나이고 모든 기계에 같다. 어느 컴퓨터에서나 바꾼다(서명한 새 판). 부를 수 있는 route 목록은 지금 그대로 하나다. (agent: 사람 "기존의 approval이랑 크게 다를 게 없다")

들이기:
- **pairing code는 초대장이다.** 든 컴퓨터가 한 번 쓸 서명 key를 만들어 서명하고 QR과 글로 보인다. 새 기기는 그 key로 자기 항목에 서명해 스스로 들어온다. 초대한 컴퓨터가 꺼져 있어도 되고(dual boot), 새 기기는 아직 소식을 못 들은 다른 컴퓨터에 붙을 때 자기 항목과 초대장을 내민다. 초대장에는 수명이 있고, 초대한 컴퓨터는 한 번 쓰인 것을 다시 받지 않는다. (agent: 살아 있는 연결이 있어야만 들일 수 있으면 dual boot의 두 OS는 영영 못 잇는다)
- **화면 없는 기계는 CLI로 한다.** `lophn remote on | invite | join <초대장> | devices | remove <기기>`. 사람의 터미널에서만 된다(agent의 shell은 지금처럼 거절). (agent)

연결:
- **컴퓨터끼리의 연결은 core가 든다.** remote가 켜진 컴퓨터의 core는 명단의 다른 컴퓨터마다 연결 하나를 유지한다(직접 주소와 relay를 같이 걸어 먼저 닿는 쪽. 지금 engine `packages/remote-client` 그대로). 이 연결로 명단을 주고받는다. (agent)
- **다른 기계를 부르는 길은 core의 route 하나다.** 이 기계의 화면이 `machines/call`·`machines/watch`로 "어느 기계의 어느 route"를 부르면 core가 그 연결로 넘긴다. 받는 기계는 지금처럼 `device:<부른 컴퓨터의 id>`인 사람으로 본다. desktop의 다른 기계 창은 이 길로 바꾸고 shell main의 연결 code는 지운다. 이 계획에서 넘기는 것은 사람의 화면이 부른 것뿐이다(agent와 앱은 `remote-use`). (agent)
- **폰은 명단으로 컴퓨터 목록을 채운다.** 한 컴퓨터와 pairing하면 나머지 컴퓨터가 목록에 뜬다. (agent)

옮기기:
- **폰은 다시 pairing하지 않는다.** 지금 `devices` 줄은 이 컴퓨터가 서명한 명단 항목이 된다(id, key, 허락 그대로). host key는 바꾸지 않는다.
- **컴퓨터끼리는 한 번 다시 잇는다.** 지금 desktop이 다른 desktop에 붙던 key는 shell의 것이라 없어진다. 그 `devices` 줄(종류 desktop)과 `shell/viewer/machines.json`은 data step이 지우고, 사람이 컴퓨터 둘을 초대로 한 번 잇는다(change-log의 `해야:`). 창 자리(`viewer/windows.json`)는 둔다. (agent: 옛 key를 읽어 주는 호환 장치를 만들지 않는다)
- protocol 판을 올린다. core, shell, 폰 앱을 같은 변경에서 고친다(`v2` 길을 만들지 않는다).

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `roster-contract` | 없음 | protocol: 항목·빼기·초대장의 schema와 검증(순수 함수와 위험 test), frame(hello, 들어오기, 명단 주고받기), route 모양(`roster/*`, `machines/call`·`machines/watch`), protocol 판. `architecture/remote.md`의 명단 절 초안 |
| 2 | `roster-core` | `roster-contract` | core: 서명 key, ledger의 명단과 `devices`에서 옮기는 step, 명단과 내민 항목으로 받아들이기, 초대장 내기, 빼기가 연결·자격·push에 퍼지기, `roster/*` route |
| 2 | `roster-client` | `roster-contract` | `packages/remote-client`와 폰 앱: 초대장으로 들어오기, 항목 내밀기, 명단으로 컴퓨터 목록 채우기, 폰의 pairing·컴퓨터 화면과 저장 |
| 3 | `roster-links` | `roster-core` | core가 다른 컴퓨터에 붙는다: 연결 유지, 명단 주고받기, 이 컴퓨터가 초대장으로 들어가기(`roster/join`), `machines/call`·`machines/watch` 넘기기 |
| 3 | `roster-cli` | `roster-core` | CLI `lophn remote on\|invite\|join\|devices\|remove` |
| 4 | `roster-desktop` | `roster-links` | desktop: 다른 기계 창을 core의 길로 바꾸고 shell main의 연결·key·목록을 지운다(data step). Settings › Remote를 "내 기기" 목록 하나(초대, 들어가기, 빼기, 기기마다 터미널 입력)로 바꾼다 |
| 5 | `roster-cleanup` | `roster-client`, `roster-cli`, `roster-desktop` | 옛 `pair` frame과 host마다 따로이던 길 지우기, flows·catalog, 남은 옛 이름 |

`roster-cli`의 `join`은 `roster-links`의 route를 부른다. route 모양은 계약 task가 고정하므로 같이 돈다.

## 위험 test (brief에 있다)

- 믿는 컴퓨터의 서명이 없는 항목, 수명이 지난 초대장, 한 번 쓰인 초대장으로는 들어오지 못한다.
- 뺀 기기는 어느 컴퓨터에도 붙지 못하고, 빼기보다 늦게 도착한 그 기기의 항목이 빼기를 되돌리지 못한다.
- 뺀 컴퓨터가 빼기 뒤에 서명한 항목은 받아들이지 않는다.
- `devices`에서 옮긴 뒤 이미 pairing한 폰이 다시 pairing하지 않고 붙는다.
- 다른 기계로 넘긴 call이 그 기계에서 기기의 범위를 넘지 못한다(받는 쪽이 지금의 목록으로 거른다).
- agent 자격은 `roster/*`와 `machines/call`을 부르지 못한다.

## lead가 할 일

- `roster-contract`가 끝나면 merge하기 전에 다른 worker(opus) 하나에게 설계 review를 맡긴다. 볼 것: 명단을 합칠 때 순서가 달라도 같은 결과인가, 초대장이 새거나 다시 쓰일 때 얼마나 뚫리나, 빼기와 들이기가 엇갈릴 때, 복사한 data root(`machine.md`의 표지)와 만날 때. 고칠 것은 같은 계약 worker에게 보낸다.
- 실제 relay에 붙지 않는다. 개발 root에서 `remote.enabled`를 켜기 전에 `remote.relay`를 비운다.
- `packages/protocol/remote/allowlist.ts`, `packages/core/main/daemon/wiring/`의 등록 줄, `schema-steps.lock.json`은 lead가 합친다. `core-setup`과 `core-terminals`도 같은 file을 고치니 `status.py ready`가 거르는 대로 따른다.
- `packages/mobile`을 고친 task는 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과해야 한다.
- subprocess나 서버를 띄우는 test와 E2E는 새로 만들기 전에 사람에게 묻는다.
- 끝나면: `architecture/remote.md`(명단, 들이기, 컴퓨터끼리의 연결), `machine.md`, `approval.md`, boundary·module catalog, flows, change-log(`해야:` 컴퓨터끼리 한 번 다시 잇기, 폰 앱 update), roadmap `multi-device.md`의 순서 표.
- 사람에게: 끝난 뒤 실제 기기로 확인을 부탁한다(폰 하나와 컴퓨터 둘: 폰을 한 컴퓨터와 pairing하면 다른 컴퓨터가 목록에 뜨는지, 한쪽에서 폰을 빼면 다른 쪽도 끊는지).
