# carry-paths

- 목표: 한쪽만 켜져 있어도 늦게라도 닿는다. 앱 data와 앱이 낸 event와 기기 명단이, 살아 있는 연결이 있으면 그 길로, 없으면 맡겨 두는 곳(폰, 늘 켜 둔 기계, 폴더)으로 간다. 어느 길로 갈지는 lophn이 고르고, 들어온 변경은 그 기계의 앱에 알린다.
- 재료: `project-docs/products/roadmap/multi-device.md`("길", "원칙"), `project-docs/architecture/app-sync.md`, `folder-sync.md`, `event.md`, `attention.md`, `machine.md`, `remote.md`, 조사 `reports/multi-device/survey-n2-carry-paths.md`(지금 code, file 묶음 A~H, 병렬 위험), review `reports/multi-device/review-device-roster.md`("Facts the next plans build on")
- 기대는 것: `multi-device-fixes`의 `fix-roster`(폴더와 폰이 명단 항목을 나르므로 명단 규칙이 먼저 닫혀야 한다)
- 범위 밖: remote를 맡겨 두기(꺼진 기계의 것은 지금 쓸 수 없다), session의 기록을 맞추기, lophn의 relay나 서버가 data를 맡아 두기, 폰 앱이 뒤에서 도는 OS background 작업, Tailscale이나 폴더 도구를 lophn 안에 넣기, agent와 앱이 다른 기계의 event를 살아 있는 연결로 구독하기(`remote-use`)

## 정한 것

- **될 수 있는 것이 먼저다.** 늦어도 된다. 빠르기는 환경이 좋을수록 얻는다. (사람: "애초에 될 수 있다가 중요한 거 아니야?")
- **앱은 "내 컴퓨터들"에 맞춘다고만 말한다.** 지금 앱은 사람이 이름 붙인 폴더를 고른다(`sync_to`). 거기에 미리 있는 갈 곳 하나를 더한다: 내 명단의 컴퓨터들. 그 갈 곳으로 가는 길(연결, 폰, 폴더)은 lophn이 고른다. 사람이 이름 붙인 폴더는 지금처럼 남는다. (사람: "길은 lophn이 고른다")
- **변경 묶음의 이름은 길과 상관없이 하나다.** 지금은 폰 길과 폴더 길이 묶음을 다르게 부른다. 난 곳(기계나 기기)과 그곳의 순번으로 하나로 맞춰, 같은 묶음이 여러 길로 와도 한 번만 적용하고 한 번만 센다. 그래서 길을 동시에 여럿 써도 된다. (agent)
- **컴퓨터끼리 연결로 맞춘다.** 명단의 컴퓨터끼리 붙어 있으면 그 연결로 앱의 변경을 주고받는다. 받은 변경은 다른 컴퓨터에도 내준다(난 곳이 어디든). 그래서 늘 켜 둔 기계가 있으면 그 기계가 저절로 가운데가 된다. 그 역할을 따로 정하지 않는다. (사람: "중심 기계를 둔다/아니다와 간단한 문제가 아니라니까")
- **폰이 나른다.** 폰은 "내 컴퓨터들"에 맞추는 앱의 묶음을 한 컴퓨터에서 받아 두었다가 다른 컴퓨터에 붙었을 때 넘긴다. 폰에 화면이 없는 앱의 묶음도 내용을 모르고 나른다. 명단의 모든 컴퓨터에 전했거나 상한(크기, 날수)을 넘으면 지운다. 폰은 기준이 아니다: 합치는 것은 받는 컴퓨터가 한다. 폰 앱을 열어 둔 동안만 움직인다. (사람: "폰을 hub로 쓸 수도 있게")
- **큰 묶음은 Wi-Fi에서만 나른다.** 기준 크기는 폰의 설정이다. 폰 앱이 지금 network 종류를 모르므로 아는 길을 더한다. (사람)
- **폴더는 맡겨 두는 곳 하나다.** 사람이 "내 컴퓨터들이 같이 보는 폴더"를 하나 정하면(dual boot의 공유 디스크, Google Drive나 Syncthing이 옮기는 폴더) lophn이 그 갈 곳의 묶음과 명단 항목을 거기에도 둔다. 명단 항목은 서명되어 있어 폴더를 믿지 않아도 된다. (사람: "vm 없으면 file에다 google drive 붙여서")
- **들어온 변경은 그 기계의 앱에 알린다.** 폰이나 다른 기계에서 온 변경을 적용하면 앱 process와 앱 화면이 "data가 바뀌었다"를 받는다(지금은 받지 않는다). SDK에 받는 자리를 더한다. (사람: "data sync 하라는 건 event 안 내는거야?")
- **앱이 낸 event는 data처럼 간다.** 앱이 다른 기계에도 알리겠다고 낸 event는 그 앱의 변경과 같은 길로 가고, 도착한 기계의 core가 그 기계에서 한 번 낸다(난 기계를 싣고). 오래된 것(기준 날수)은 내지 않는다. event를 나르는 길을 따로 만들지 않는다. (사람의 roadmap: "data가 가는 길이 곧 그 event가 가는 길")
- **설정 화면.** Settings에 폴더(이름 붙인 폴더들, "내 컴퓨터들이 같이 보는 폴더")와 지금 길을 보이는 자리를 둔다: 컴퓨터마다 연결이 있는지, 앱마다 마지막으로 맞춘 때. 길을 고르는 설정은 두지 않는다. (agent)
- **바깥 도구는 lophn agent가 돕는다.** Google Drive, Syncthing, Tailscale의 설치와 설정을 lophn agent가 지침대로 돕는다. lophn 안에 넣지 않는다. (사람, 2026-11-17)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `carry-contract` | 없음 | 묶음의 이름 하나, "내 컴퓨터들" 갈 곳, 컴퓨터와 나르는 폰이 부르는 `app_sync`의 모양, data처럼 가는 event의 모양, 폴더의 명단 file, protocol 판과 ledger step. `architecture/app-sync.md` 초안 |
| 2 | `carry-links` | `carry-contract` | 컴퓨터끼리 연결로 앱의 변경을 주고받기, 받은 변경을 다른 컴퓨터에도 내주기 |
| 2 | `carry-phone` | `carry-contract` | 폰이 묶음을 받아 두었다 넘기기(화면 없는 앱 포함), 지우는 규칙, network 종류와 Wi-Fi 설정 |
| 2 | `carry-folder` | `carry-contract` | "내 컴퓨터들이 같이 보는 폴더"로 묶음과 명단 항목을 내고 읽기 |
| 2 | `carry-notify` | `carry-contract` | 들어온 변경을 앱 process와 화면에 알리기, data처럼 가는 event, SDK와 지침 |
| 3 | `carry-settings` | `carry-links`, `carry-folder` | Settings의 폴더 화면과 지금 길 보이기, lophn agent가 바깥 도구를 돕는 지침 |
| 4 | `carry-cleanup` | `carry-phone`, `carry-notify`, `carry-settings` | 길마다 따로이던 옛 이름과 검사, flows·catalog, 문서 |

ledger step과 `schema-steps.lock.json`의 줄은 `carry-contract`가 한 번에 정하고 lead가 합친다. `packages/core/apps/calls/service.ts`는 `carry-notify`가 갖고 `carry-links`는 고칠 줄을 보고에 적는다(brief가 file 단위로 정한다).

## 위험 test (brief에 있다)

- 같은 묶음이 연결, 폰, 폴더로 다 와도 한 번만 적용된다.
- 옛 꼴의 `app_sync_log`와 폴더 기록을 옮긴 뒤 이미 맞춘 묶음을 다시 적용하지 않고 잃지도 않는다.
- 폰이 나르는 묶음을 고치거나 다른 앱의 것으로 바꿔 넘기면 받는 컴퓨터가 버린다.
- 폴더의 명단 file에 믿는 서명이 없는 항목이 있어도 들이지 않는다.
- private인 workspace의 앱이 낸 event는 다른 기계에서 나지 않는다.
- 다른 기계에서 온 event가 그 기계에서 한 번만 난다.

## lead가 할 일

- `multi-device-fixes`가 main에 올라간 뒤에 시작한다.
- 사람의 data를 옮기는 step이 있다(`app_sync_log`의 묶음 이름). `carry-contract`를 merge하기 전에 그 step을 다른 worker에게 review시킨다.
- `one-screen`이 같은 `packages/core/remote/links.ts`와 `allowlist.ts`를 고친다. `status.py ready`가 거르는 대로 따르고 나중에 올리는 쪽이 충돌을 푼다.
- SDK와 앱 지침을 바꾸는 task(`carry-notify`)는 `sdk-note` skill을 따른다. `packages/mobile`을 고친 task는 그 폴더의 typecheck와 test도 통과해야 한다. 새 dependency(network 종류)는 판을 정확히 고정한다.
- 실제 폴더 도구(Google Drive, Syncthing)와 dual boot로 돌려 보는 확인은 사람에게 부탁한다. subprocess를 띄우는 test와 E2E는 새로 만들기 전에 사람에게 묻는다.
- 끝나면: `architecture/app-sync.md`, `folder-sync.md`, `event.md`, `machine.md`, `remote.md`, PRODUCT.md의 "앱 data가 어디로 가는지" 줄, 이슈 `phone-write-events-not-delivered`, flows, change-log, roadmap `multi-device.md`.
