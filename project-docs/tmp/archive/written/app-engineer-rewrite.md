# App Engineer rewrite: coding-agent, problems, app-releases

기준: `../app-engineer-flow.md`. 모두 status proposed로 둔다.

## 고친 것

### coding-agent.yaml

| ID | 고친 것 |
|---|---|
| req-1050 | "사람의 터미널에서 연 session"에서 사람의 터미널을 뺐다. |
| req-1051 | 외부 coding agent process는 사람의 시작 요청 대신 App Engineer가 ticket을 맡길 때만 열린다. (정할 것 2) |
| req-1060 | 본문은 그대로. session이 사람에게 보이는지 정할 것 주석만 달았다. |
| req-1091 | 사람이 터미널 탭에서 열기와 자기 터미널의 session을, App Engineer가 맡기면 터미널 탭에서 열리고 연결의 MCP로 이어진다로 바꿨다. (정할 것 1) |
| req-1092 | 시작과 두 방식을, App Engineer가 ticket과 harness를 고르는 맡기기 하나와 맡은 ticket의 claim, 작업, 보고로 바꿨다. (정할 것 2) |
| req-1093 | 사람이 누른 시작이 허락이라는 말을 빼고, 맡기기가 자격 발급·범위 확대·activation·harness trust를 대신하지 않는다로 바꿨다. (정할 것 1) |
| req-1094 | 사람이 고른 폴더를 맡길 때 고른 폴더로 바꿨다. |
| req-1096 | 사람의 선택을 따른다는 말을 빼고 기본 harness 규칙을 따른다로 했다. (정할 것 1) |
| req-1100 | 자기 터미널에서 시작한 session을 lophn이 맡기지 않은 외부 session으로 바꿨다. |
| req-1101 | "시작 접수"를 "맡김 접수"로 바꿨다. |
| req-1102 | 새 TUI는 사람이 다시 고를 때만이 아니라 App Engineer가 다시 맡길 때만 연다. |
| req-1110 | 탐색만 요청받으면 착수하지 않는다는 말과 그 acceptance를 뺐다. 지정한 일을 맡은 일로 바꿨다. |
| req-1111 | 사람이 지정한 ticket을 맡은 ticket으로 바꿨다. |
| req-1112 | 사람이 직접 요청해도 ticket으로 정리한다는 모양을, 맡은 ticket을 claim한 뒤에만 code 작업을 하고 맡은 ticket이 없으면 시작하지 않는 안내로 바꿨다. ticket 생성 acceptance는 뺐다. |
| req-1123 | 사람이 자기 터미널에서 지시한 ticket을 맡긴 동작의 첫 prompt가 가리킨 ticket으로 바꿨다. |
| req-1125 | 사람의 수리 지시 전에는 착수하지 말라는 안내를, 첫 prompt가 가리킨 ticket만 claim하라는 안내로 바꿨다. |
| req-1355 | "사람 지시에 따른 claim"을 "맡은 항목의 claim"으로 바꿨다. |
| req-1358 | 작업 항목의 시작은 사람의 시작 선택이라는 말을, 맡기는 일은 App Engineer가 하고 coding 자격은 claim, 작업, 보고만 한다로 바꿨다. |
| req-1360 | 담당 agent의 ticket 준비를 App Engineer의 ticket 준비로 바꿨다. |
| req-1371 | 같은 바꿈. |

related에 app-tickets를 더한 것: req-1092, req-1355, req-1358.

### coding-agent-cli.yaml

| ID | 고친 것 |
|---|---|
| req-1217 | acceptance의 "사람이 만든 항목"을 "App Engineer가 만든 항목"으로 바꿨다. |

### core-app-releases.yaml

| ID | 고친 것 |
|---|---|
| req-0824 | "사람이 자기 터미널에서 맡긴 코드 수리"를 "App Engineer가 맡긴 코드 수리"로 바꿨다. related에 app-tickets를 더했다. |
| req-0823 | 본문은 그대로. related에 app-tickets를 더했다. |

### core-problems.yaml, coding-agent-mcp.yaml

고친 것 없음.

## 지운 것

| ID | 이유 |
|---|---|
| req-1214 (coding-agent-cli) | 수리 요청이 담당 agent의 작업 항목 준비 화면 링크를 돌려주는 CLI 명령은 사람이 coding agent 쪽에서 수리를 움직이는 길이다. 문제의 수리 요청은 App Engineer가 ticket으로 이어 맡기는 일(req-0751)이 맡는다. |

## 새로 쓴 것

없음. flow 1장의 claim event와 ticket 생성은 core-app-tickets가 이미 맡는다.

## 정할 것 주석

| ID | 2장 질문 |
|---|---|
| req-1051 | 맡기기 전에 사람에게 묻는가 / 어느 coding agent에게 맡길지 누가 고르는가 |
| req-1060 | session이 사람에게 보이는가 |
| req-1091 | session이 사람에게 보이는가 |
| req-1092 | 맡기기 전에 사람에게 묻는가 / 어느 coding agent에게 맡길지 누가 고르는가 |
| req-1093 | 맡기기 전에 사람에게 묻는가 |
| req-1096 | 어느 coding agent에게 맡길지 누가 고르는가 |
