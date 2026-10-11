---
type: domain-model
concerns: [shell/desktop]
---
# shell/desktop

창 하나의 renderer 메모리에만 있는 Agent 화면의 보기 값을 정의하며 entity·ledger 표·command·event를 만들지 않는다. session·메시지·질문·승인·model 선택·즐겨찾기의 정본은 각 concern이 가지고(→ lophn-agent/conversation, lophn-agent/questions, platform/approvals, lophn-agent/harness/model), 탭 배치 파일에는 session 참조만 저장한다(→ shell/workspace).

## AgentViewState (값)

Agent 화면 하나(탭 하나 또는 앱 공간의 agent 칸 하나)의 보기 값이다. 창을 닫으면 사라지고 ledger·`shell/layout.json`에 쓰지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `agent` | assignment ID | 아니오 | → lophn-agent/assignments; 화면이 열려 있는 동안 바뀌지 않음 | 이 화면의 agent |
| `place` | `prj` ID 또는 `app` ID | 아니오 | agent가 속한 자리 | 프로젝트 또는 앱 |
| `session` | `ses` ID | 예 | 그 agent·자리의 session만; 비면 새 session을 아직 만들지 않은 상태 | 보고 있는 session |
| `detail` | `messages \| compact \| everything` | 아니오 | 기본 `compact` | 보기 상세 |
| `draft` | Draft | 아니오 | session마다 하나; 아래 | 쓰던 말 |
| `context_chips` | ContextChip[] | 아니오 | 새 session의 첫 말을 보내기 전에만 값이 있음 | composer 위에 붙은 context |
| `switcher_query` | string | 아니오 | 비어 있을 수 있음; 제목에만 맞춤 | session popover의 검색어 |

## Draft (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `text` | string | 아니오 | 접수 한도는 lophn-agent/conversation | 입력칸 글 |
| `cursor` | integer | 아니오 | 0 이상 | 커서 |
| `answers` | object | 아니오 | 질문 묶음의 고른 답과 Other 글 | 아직 보내지 않은 답 |
| `delivery` | `idle \| sending \| accepted \| failed \| unconfirmed` | 아니오 | 불명확하면 `unconfirmed`; 재전송보다 접수 조회가 먼저 | 전달 표시 |

## ContextChip (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `target` | 참조 | 아니오 | notification의 사건 대상 참조(→ platform/notifications) | 사건이 가리키는 것 |
| `label` | string | 아니오 | 사람이 읽는 한 줄; 본문·credential을 넣지 않음 | chip 글자 |

## 정책

- **보존.** `draft`는 session 전환·탭 전환·confirmation window·전송 실패·단절을 지나도 남는다(→ R8). 다른 session의 draft와 섞이지 않는다.
- **chip과 session.** chip은 사람이 첫 말을 보내기 전에 ✕로 뗄 수 있다. 글이 비어 있어도 chip이 하나 이상 있으면 보낼 수 있다(notification의 [Ask]로 연 session). 보낼 때 남은 chip이 그 session의 `opening_context`가 된다(→ lophn-agent/conversation). 보내기 전에는 session도 만들지 않는다.
- **agent 고정.** 한 화면은 한 agent만 보인다. 다른 agent는 다른 화면(탭 또는 칸)이며 `agent`를 바꾸는 command는 없다.
- **보기 상세.** `detail`은 tool 줄의 표시만 바꾸고 메시지·카드·질문·승인을 숨기지 않는다.
