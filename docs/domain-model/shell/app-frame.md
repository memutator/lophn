---
type: domain-model
concerns: [shell/app-frame]
---
# shell/app-frame

앱 공간 창이 agent select와 앱 화면 옆 Agent 칸에 대해 실행 동안 들고 있는 값을 정의하며 entity·ledger 표·command·event를 만들지 않는다. 세션·메시지·assignment는 lophn-agent/conversation·lophn-agent/assignments가 정본이고 여기서는 가리키기만 한다.

## AppAgentChoice (값)

agent select가 펼친 목록의 한 줄이다. 목록은 앱 공간이 보이는 앱을 기준으로 열 때마다 새로 만든다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `lophn \| app_engineer \| operator \| manage` | 아니오 | `context_engineer`는 없다(context는 project에 속한다) | 줄의 종류 |
| `assignment` | `asg` ID | 조건부 | → lophn-agent/assignments; lophn은 전역 lophn assignment, app_engineer·operator는 scope가 이 앱인 활성 assignment; manage만 null | 상대 agent |
| `label` | string | 아니오 | avatar와 함께 보이는 이름; Operator는 그 Operator의 이름 | 줄 이름 |

목록 순서는 lophn · App Engineer · Operator들 · 구분선 · Manage이다. Operator가 없으면 Operator 묶음이 비고 나머지 줄은 그대로다.

## AppAgentPane (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | `app` ID | 아니오 | 이 앱 공간이 보이는 앱 | 칸의 자리 |
| `content` | `agent \| manage` | 아니오 | agent는 Agent component의 대화, manage는 앱 자리의 agent 관리 | 칸에 열린 것 |
| `session` | `ses` ID | 예 | agent만; 그 session의 `work_place`는 kind app·id가 이 `app`; 비면 새 session | 열린 대화 |
| `choice` | AppAgentChoice | 아니오 | kind가 `manage`이면 `content`도 `manage` | 고른 줄 |

앱 공간 창마다 칸은 최대 하나이고, 칸이 없으면 앱 view가 본문 전체를 쓴다.

## 정책

- **저장.** 이 값들은 창의 메모리에만 있고 `shell/layout.json`이나 ledger에 저장하지 않는다. 앱 공간을 닫으면 칸도 닫히고, 대화는 session으로 lophn-agent/conversation에 남아 다시 열 수 있다.
- **자리.** 칸에서 시작한 session의 자리는 이 앱이다(App Engineer·앱 Operator는 assignment 범위가 정하고, 전역 lophn은 session을 열 때 work_place로 이 앱을 쓴다). 앱 공간의 칸은 project 자리 session을 열지 않는다.
- **Manage.** 같은 칸에서 project Agents 탭과 같은 component를 앱 자리로 연다. 보이는 대상은 App Engineer · 앱 Operator · 앱 LOPHN.md · skill · MCP · model이다.
- **toast.** 앱 문제 toast의 [Ask App Engineer]는 `kind=app_engineer`인 칸을 열고 그 사건을 session의 첫 context로 붙인다.
- **크롬.** 칸의 열림·닫힘은 앱 view의 bounds만 바꾼다. 앱·release·mode 신원과 격리는 바꾸지 않는다(→ shell/app-frame#R33).
