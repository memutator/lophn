---
type: domain-model
concerns: [lophn-agent/handoff]
---
# lophn-agent/handoff

handoff의 내용 blob과 허용 방향·근거·요청 계보·거절 억제 정책을 정의한다.

## HandoffContent (값)

받는 Run.source의 handoff 가지가 참조하는 UTF-8 JSON blob이다. 가지의 필드·채택 질문 참조·중복 방지 키·Run entity·ledger 표·command·event는 → lophn-agent/harness/run-loop에서 정의한다. 별도 handoff entity·ID·상태·대기열은 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `what` | string | 아니오 | 공백뿐인 문자열 금지 | 대상 앱·범위와 맡긴 내용 |
| `why` | string | 아니오 | 공백뿐인 문자열 금지 | 맡긴 내용의 근거 |
| `excludes` | string[] | 아니오 | 빈 목록 허용; 항목은 공백 금지 | 제외 범위 |
| `expected_outputs` | string[] | 아니오 | 1개 이상; 항목은 공백 금지 | 기대 결과의 설명; 다른 concern의 산출물 entity를 새로 정의하지 않음 |

이 값에는 대화 전체·보낸 역할의 tool 기록·세션 summary·token·secret·approval를 복사하지 않는다. 근거 고정 판·채택 질문은 blob의 설명 문자열이 아니라 Run.source의 구조화 참조로 보존한다(→ documents/versions, lophn-agent/questions).

## 정책

### 허용 방향

역할 ID와 허용 방향 선언의 정본은 → lophn-agent/role-definition이다. 접수 시 실제 양쪽 assignment의 역할과 그 선언을 검사하며 현재 허용 집합은 다음과 같다.

| 보낸 역할 | 받는 역할 |
|---|---|
| lophn | App Engineer, Context Engineer |
| App Engineer | lophn, Context Engineer |
| Context Engineer | lophn |
| Operator | 없음; 수신도 금지 |

- **사람 요청 계보.** source가 원래 사람 요청에서 이어진 Run만 발신할 수 있다. 주기·ticket·problem event에서 handoff Run을 자동 접수하지 않는다. 원래 사람 요청 Message 참조는 받는 source에도 보존한다(→ lophn-agent/conversation, lophn-agent/harness/run-loop).
- **내용 완전성.** HandoffContent의 필수값과 근거 고정 판이 없으면 `invalid_input`이다. 기획·설계 판에는 채택한 Question ID가 필요하며 답의 대상 판과 일치해야 한다. 최신 주소·다른 판의 채택 답은 거절한다(→ documents/addressing, lophn-agent/questions).
- **접수 유일성.** 보낸 Run의 동일 handoff 요청은 중복 방지 키에 대해 받는 Run 하나만 만든다. 보낸 기록과 받는 Run 접수는 같은 command transaction으로 연결한다(→ lophn-agent/harness/run-loop, platform/ledger).
- **대상 assignment.** 실제 받는 assignment가 없거나 paused이면 `unavailable`이다. 주체 없는 handoff 대기열을 만들지 않는다(→ lophn-agent/assignments).
- **독립 Run.** 받는 Run은 자기 역할·assignment의 독립 Run이다. 보낸 Run은 handoff 사실을 남기고 종료하며 자식 Run을 붙들어 기다리거나 대화 제어권을 이전하지 않는다. 종료 event로 발신 역할을 자동 재접수하지 않는다(→ lophn-agent/harness/run-loop).
- **scope 재검사.** 수신 역할은 자기 assignment scope와 tool judgment를 다시 적용한다. App Engineer는 통상 범위에 이번 source의 고정 판만 해당 Run 동안 추가한다. 최신 판·연결 문서·보낸 쪽의 쓰기 권한·approval로 확대하지 않는다(→ lophn-agent/role-definition, lophn-agent/roles/app-engineer, lophn-agent/harness/tool-judgment).
- **거절 억제.** 같은 Run과 같은 원래 사람 요청에서 handoff로 이어진 Run 전부에서 사람이 거절한 동일 동작·대상·정확한 입력을 다시 묻지 않는다. 새 사람 요청은 억제하지 않는다. 거절 기록·비교 키·판정의 정본은 → lophn-agent/harness/tool-judgment이며 handoff는 원래 요청 참조를 잃거나 교체해 우회할 수 없다.
- **결과 참조.** 결과는 문서 고정 version 주소 또는 산출물이 없는 이유로 받는 Run 결과에 남긴다. 후속 version으로 원래 결과를 바꾸지 않는다(→ documents/versions, lophn-agent/harness/run-loop).

## 정할 것

- HandoffContent 각 문자열·목록의 크기 상한. 현재 필수 구조만 정하며 transport·prompt 상한은 → lophn-agent/harness/tools, lophn-agent/harness/prompt-assemble을 따른다.
