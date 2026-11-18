# carry-paths

- 목표: 한쪽만 켜져 있어도 늦게라도 닿는다. 앱 data와 앱이 낸 event와 기기 명단이, 살아 있는 연결이 있으면 그 길로, 없으면 맡겨 두는 곳(폰, 늘 켜 둔 기계, 폴더)으로 간다. 어느 길로 갈지는 lophn이 고르고, 들어온 변경은 그 기계의 앱에 알린다.
- 재료: `project-docs/products/roadmap/multi-device.md`("길", "원칙"), `project-docs/architecture/folder-sync.md`, `app-sync.md`, `event.md`, `attention.md`, `machine.md`, `remote.md`, 조사 `reports/multi-device/survey-n2-carry-paths.md`(지금 code, file 묶음 A~H, 병렬 위험), review `reports/multi-device/review-device-roster.md`("Facts the next plans build on")
- 기대는 것: `multi-device-fixes`의 `fix-roster`(폴더와 폰이 명단 항목을 나르므로 명단 규칙이 먼저 닫혀야 한다)
- 범위 밖: remote를 맡겨 두기(꺼진 기계의 것은 지금 쓸 수 없다), session의 기록을 맞추기, lophn의 relay나 서버가 data를 맡아 두기, 폰 앱이 뒤에서 도는 OS background 작업, Tailscale이나 폴더 도구를 lophn 안에 넣기, agent와 앱이 다른 기계의 event를 살아 있는 연결로 구독하기(`remote-use`)

## 정한 것

바닥의 생각 하나: **폴더로 주고받는 꼴이 곧 기계 사이의 꼴이다.** 지금 컴퓨터끼리는 같이 보는 폴더에 file을 내고 읽어 앱(들이기, release, source)과 data를 맞춘다. 그 꼴을 그대로 두고, 그 file을 옮기는 길을 셋으로 늘린다: 컴퓨터 사이 연결, 폰, 사람의 폴더. 폰과 컴퓨터가 화면 있는 앱을 맞추는 지금 길(`app_sync`)은 건드리지 않는다. (agent: 폴더 길은 앱을 들이는 것부터 tombstone 정리까지 이미 다 한다. 길마다 꼴을 따로 만들면 연결과 폰으로는 앱을 들일 수도 release를 따라갈 수도 없다)

- **될 수 있는 것이 먼저다.** 늦어도 된다. 빠르기는 환경이 좋을수록 얻는다. (사람: "애초에 될 수 있다가 중요한 거 아니야?")
- **앱은 "내 컴퓨터들"에 맞춘다고만 말한다.** 지금 앱은 사람이 이름 붙인 폴더를 고른다(`sync_to`). 거기에 미리 있는 갈 곳 하나를 더한다: 내 명단의 컴퓨터들. 그 갈 곳의 file은 data root 안에 lophn이 두는 폴더에 쌓이고, 그 file을 다른 컴퓨터로 옮기는 길은 lophn이 고른다. 사람이 이름 붙인 폴더는 지금처럼 남는다. (사람: "길은 lophn이 고른다")
- **file의 이름이 곧 묶음의 이름이다.** 낸 기계와 그 기계의 순번이다(지금 폴더 길의 이름). 같은 file이 여러 길로 와도 한 번만 받는다. 그래서 길을 동시에 여럿 써도 된다. ledger의 sync 기록은 옮기지 않는다. (agent)
- **낸 기계가 서명한다.** 컴퓨터는 자기가 낸 file의 목록에 명단의 서명 key로 서명한다. 받는 컴퓨터는 명단의 컴퓨터가 서명한 목록에 있는 file만 받는다. 그래서 file이 폰이나 다른 컴퓨터나 cloud 폴더를 거쳐도 고치거나 바꿔치지 못한다. (agent)
- **컴퓨터끼리 연결로 옮긴다.** 명단의 컴퓨터끼리 붙어 있으면 서로 없는 file을 주고받는다. 다른 컴퓨터가 낸 file도 가지고 있으면 내준다. 그래서 늘 켜 둔 기계가 있으면 그 기계가 저절로 가운데가 된다. 그 역할을 따로 정하지 않는다. (사람: "중심 기계를 둔다/아니다와 간단한 문제가 아니라니까")
- **폰이 나른다.** 폰은 한 컴퓨터에서 받은 file을 들고 있다가 다른 컴퓨터에 붙었을 때 넘긴다. 폰에 화면이 없는 앱의 것도 내용을 모르고 나른다. 명단의 모든 컴퓨터가 가졌거나 상한(크기, 날수)을 넘으면 지운다. 폰은 기준이 아니다. 폰 앱을 열어 둔 동안만 움직인다. (사람: "폰을 hub로 쓸 수도 있게")
- **큰 file은 Wi-Fi에서만 나른다.** 기준 크기는 폰의 설정이다. 폰 앱이 지금 network 종류를 모르므로 아는 길을 더한다. (사람)
- **사람의 폴더는 맡겨 두는 곳 하나다.** 사람이 "내 컴퓨터들이 같이 보는 폴더"를 하나 정하면(dual boot의 공유 디스크, Google Drive나 Syncthing이 옮기는 폴더) 컴퓨터마다 자기가 낸 file과 명단 항목을 거기에도 두고, 다른 컴퓨터가 둔 것을 거기서 읽는다. 서명을 보므로 폴더를 믿지 않아도 된다. 그 폴더에는 컴퓨터마다 자기 것만 쓴다(남의 file을 대신 써 주면 그 기계의 정리와 부딪힌다). (사람: "vm 없으면 file에다 google drive 붙여서")
- **들어온 변경은 그 기계의 앱에 알린다.** 폰이나 다른 기계에서 온 변경을 적용하면 앱 process와 앱 화면이 "data가 바뀌었다"를 받는다(지금은 받지 않는다). SDK에 받는 자리를 더한다. (사람: "data sync 하라는 건 event 안 내는거야?")
- **앱이 낸 event는 data처럼 간다.** 앱이 다른 기계에도 알리겠다고 낸 event는 그 앱의 file로 같은 길을 가고, 도착한 기계의 core가 그 기계에서 한 번 낸다(난 기계를 싣고). 오래된 것(기준 날수)은 내지 않는다. event를 나르는 길을 따로 만들지 않는다. (사람의 roadmap: "data가 가는 길이 곧 그 event가 가는 길")
- **설정 화면.** Settings에 폴더(이름 붙인 폴더들, "내 컴퓨터들이 같이 보는 폴더")와 지금 길을 보이는 자리를 둔다: 컴퓨터마다 연결이 있는지, 앱마다 마지막으로 맞춘 때. 길을 고르는 설정은 두지 않는다. (agent)
- **바깥 도구는 lophn agent가 돕는다.** Google Drive, Syncthing, Tailscale의 설치와 설정을 lophn agent가 지침대로 돕는다. lophn 안에 넣지 않는다. (사람, 2026-11-17)
- 남는 한계(끝날 때 이슈로 올린다):
  - 폰 화면이 있는 앱은 폰이 컴퓨터마다 사본을 따로 든다(지금 그대로). 폰에서 한 변경은 그 컴퓨터에 들어간 뒤 컴퓨터들 사이로 퍼진다.
  - 앱 하나는 갈 곳 하나만 고른다("내 컴퓨터들"이거나 이름 붙인 폴더 하나).
  - 사람의 폴더만 보는 컴퓨터는, 그 폴더에 직접 쓰지 않는 컴퓨터의 file을 연결이나 폰이 닿을 때까지 받지 못한다.
  - 폰은 상한(256 MiB)보다 큰 file을 나르지 못한다. 큰 snapshot과 release는 연결과 폴더로 간다.
  - "내 컴퓨터들"에 맞추는 앱은 data root 안에 release와 data의 사본을 하나 더 둔다.

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `carry-contract` | 없음 | "내 컴퓨터들" 갈 곳과 그 폴더의 자리, 낸 기계가 서명하는 file 목록과 검증, file을 주고받는 route(목록, 조각으로 받기), 폴더의 명단 file, 기계를 건너는 event file, "data가 바뀌었다"의 모양, protocol 판. `architecture/folder-sync.md` 초안 |
| 2 | `carry-folder` | `carry-contract` | 미리 있는 갈 곳을 폴더 길에 붙이기: file 목록에 서명하고 받을 때 검증하기, 사람의 폴더에 같이 두고 읽기, 명단 file |
| 2 | `carry-links` | `carry-contract` | 컴퓨터끼리 연결로 없는 file을 주고받기(다른 컴퓨터가 낸 것도) |
| 2 | `carry-phone` | `carry-contract` | 폰이 file을 받아 두었다 넘기기, 지우는 규칙, network 종류와 Wi-Fi 설정 |
| 2 | `carry-notify` | `carry-contract` | 들어온 변경을 앱 process와 화면에 알리기, 기계를 건너는 event, SDK와 지침 |
| 3 | `carry-settings` | `carry-links`, `carry-folder` | Settings의 폴더 화면과 지금 길 보이기, lophn agent가 바깥 도구를 돕는 지침 |
| 4 | `carry-cleanup` | `carry-phone`, `carry-notify`, `carry-settings` | 남은 옛 이름과 검사, flows·catalog, 문서 |

받은 file을 폴더 길의 읽기(들이기, release, data 적용)에 넘기는 자리는 `carry-folder`가 갖는다. `carry-links`와 `carry-phone`은 file을 가져다 놓기만 한다. `packages/core/apps/calls/service.ts`는 `carry-notify`가 갖는다(brief가 file 단위로 정한다).

## 위험 test (brief에 있다)

- 같은 file이 연결, 폰, 폴더로 다 와도 한 번만 적용된다.
- 서명한 목록에 없는 file, 내용이 목록과 다른 file, 명단에 없는 기계가 서명한 목록은 받지 않는다(폰이 넘긴 것, 다른 컴퓨터가 넘긴 것, 사람의 폴더에 있는 것 모두).
- 사람이 이름 붙인 폴더로 맞추던 앱은 그대로 맞는다(갈 곳을 더해도 지금 폴더 길이 바뀌지 않는다).
- 폴더의 명단 file에 믿는 서명이 없는 항목이 있어도 들이지 않는다.
- private인 workspace의 앱이 낸 event는 다른 기계에서 나지 않는다.
- 다른 기계에서 온 event가 그 기계에서 한 번만 난다.

## lead가 할 일

- `multi-device-fixes`가 main에 올라간 뒤에 시작한다.
- 믿지 않는 곳을 거친 file을 받는 계획이다. `carry-contract`를 merge하기 전에 서명과 검증의 규칙을 다른 worker(opus)에게 review시킨다. 볼 것: 받는 쪽이 무엇을 믿는가, 옛 목록으로 되돌리기, 다른 앱이나 다른 기계의 file로 바꿔치기, 명단에서 빠진 컴퓨터가 낸 file.
- `one-screen`이 같은 `packages/core/remote/links.ts`와 `allowlist.ts`를 고친다. `status.py ready`가 거르는 대로 따르고 나중에 올리는 쪽이 충돌을 푼다.
- SDK와 앱 지침을 바꾸는 task(`carry-notify`)는 `sdk-note` skill을 따른다. `packages/mobile`을 고친 task는 그 폴더의 typecheck와 test도 통과해야 한다. 새 dependency(network 종류)는 판을 정확히 고정한다.
- 실제 폴더 도구(Google Drive, Syncthing)와 dual boot로 돌려 보는 확인은 사람에게 부탁한다. subprocess를 띄우는 test와 E2E는 새로 만들기 전에 사람에게 묻는다.
- 끝나면: `architecture/app-sync.md`, `folder-sync.md`, `event.md`, `machine.md`, `remote.md`, PRODUCT.md의 "앱 data가 어디로 가는지" 줄, 이슈 `phone-write-events-not-delivered`, flows, change-log, roadmap `multi-device.md`.
