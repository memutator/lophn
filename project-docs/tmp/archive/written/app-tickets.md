# 쓴 것: app-tickets

## core-app-tickets.yaml (subject app-tickets)

core-apps.yaml에서 옮김(ID 그대로, subject만 apps에서 app-tickets로).

### 그대로 옮긴 것 (21개)

req-0728, 0729, 0730, 0731, 0734, 0735, 0736, 0737, 0739, 0740, 0741, 0742, 0744, 0745, 0746, 0747, 0748, 0749, 0750, 0752, 0754
(0754와 0753의 `# 정할 것: 화면 쪽 규칙이라 subject를 shell로 옮길지.` 주석은 그대로 따라감)

### 고친 것 (App Engineer가 맡기는 모양)

| ID | 고친 것 |
|---|---|
| req-0732 | 주체를 App Engineer로. 사람의 직접 요청 문장을 "App Engineer가 사람의 요청이나 앱의 문제로 만드는 ticket"으로. ticket을 만드는 것만으로 claim이 생기지 않는다로 좁힘. |
| req-0733 | 새 ticket은 App Engineer가 만든다(취소는 그대로). |
| req-0738 | "사람이 터미널에서 지시/첫 prompt가 가리킨 ticket"을 "App Engineer가 맡긴 ticket"으로. claim 규칙은 그대로. |
| req-0743 | "사람의 직접 요청이 MCP claim으로"를 "사람이 App Engineer에게 한 요청은 ticket이 되어 coding agent가 claim, 작업, 보고". 근거가 모자라면 needs_confirmation ticket. |
| req-0751 | "사람이 ticket을 지정해 터미널에서 지시/첫 prompt로 전할 때만 claim"을 "App Engineer가 수리 ticket을 준비하고 coding agent에게 맡긴다"로. `# 정할 것` 단 요구. |
| req-0753 | "사람 화면에서 ... 만들면"을 행위자 없는 "열린 문제 하나로 수리 ticket을 만들면"으로. |

(0728~0731, 0734~0737, 0739~0742, 0744~0750, 0752, 0754는 ticket 구조·claim 규칙이라 본문을 고치지 않음. 파일 안 차례만 주제별로 묶음.)

### 지운 것

없음.

### 새 ID

| ID | 내용 | 출처(flow 1장) |
|---|---|---|
| req-1400 | claim 시작 event | 5 |
| req-1401 | claim 갱신 event | 5 |
| req-1402 | claim 반납 event | 5 |
| req-1403 | claim 만료 event | 5 |
| req-1404 | 완료 보고 event | 5 |

## core-lophn-agent.yaml (subject agent-roles)

새 ID만 더함. 기존 요구와 accepted 요구(req-0098, req-0099)는 안 고침.

| ID | 내용 | 출처(flow 1장) | 정할 것 |
|---|---|---|---|
| req-1450 | 앱 만들고 고치는 일의 창구는 App Engineer | 1 | |
| req-1451 | 사람의 요청으로 ticket을 만든다 | 2 | |
| req-1452 | 앱의 문제로 ticket을 만든다 | 2 | |
| req-1453 | ticket을 coding agent에게 맡긴다 | 3 | 맡기기 전에 묻는가 / 어느 coding agent를 누가 고르는가 |
| req-1454 | claim event로 진행을 안다 | 5 | |
| req-1455 | 완료 보고를 끝 조건으로 검증해 사람에게 올린다 | 6 | 검증 실패 시 다시 맡기는가 / 사람에게 올리는가 |

## core-apps.yaml에서 지운 요구 (옮김)

req-0728 ~ req-0754 (27개). 남은 apps 요구는 req-0716~0727.
