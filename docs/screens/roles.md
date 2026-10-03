---
type: screen
concerns: [lophn-agent/role-definition, lophn-agent/assignments, lophn-agent/roles]
---
# roles

사람이 맡겨 놓은 일마다 하는 일과 만든 것을 보고, 필요하면 대화를 연다.

이 화면은 역할의 재사용 가능한 틀(책임 정의)이 아니라 실제로 일하는 담당(assignment)을 보여 준다. 틀과 실제 일은 다른 것이고, 틀은 화면에 나오지 않는다(lophn-agent/role-definition#R1).

## 보이는 것

1. **목록.** 지금 거두지 않은 담당마다 한 행: 이름(예: "lophn", "App Engineer — Grocery", "Context Engineer", 사람이 지은 반복 확인 이름), 지금 상태, 다음에 필요한 행동 한 줄. 역할·실제 범위·반복 확인의 쓸 문서·주기·켜짐/멈춤/회수는 목록에 안 보이고 상세에서만 본다(lophn-agent/assignments#R3).
2. **상세는 세 탭을 모든 담당이 같은 자리에 공유한다**(shell/desktop#R4):
   - **What it does**: 맡은 목적 한 줄. 반복 확인이면 보는 대상(Focus 이름)과 마지막으로 확인한 결과(바뀜 있음/없음)까지.
   - **What it made**: 만든 문서 링크. 4개가 넘으면 처음 3개와 "나머지 N개 보기"(shell/desktop#R3).
   - **Conversation**: 그 담당과 나눈 대화와, 대화할 수 있는 담당이면 입력창.

## 숨긴 것

- 역할의 prompt, 고른 tool, 읽기 범위 종류 같은 정의 내용은 화면 어디에도 없다. lophn·App Engineer·Context Engineer는 사람도 agent도 고치거나 복사할 수 없기 때문이다(lophn-agent/role-definition#R9).
- 멈춘 이유의 실패 종류·횟수·마지막 이유·이미 끝낸 일은 "Needs attention"을 펼쳐야 보인다(lophn-agent/assignments#R10).
- 반복 확인의 실제 보는 범위·쓸 문서·주기 값은 상세의 "Details"에 둔다(lophn-agent/assignments#R3).
- 담당이 쓴 model(For decisions/For summaries)·tool 호출 기록·비용은 이 화면에 없다(lophn-agent/observability, lophn-agent/harness/usage가 맡는다. — 다른 화면에서 펼쳐 본다).
- 범위·문서·주기를 바꾸는 승인 전 비교(현재 값과 바뀔 값)는 그 확인창에서만 보이고 이 화면에는 바뀐 뒤 결과만 남는다(lophn-agent/assignments#R5).

## 행동

**주 행동**: 담당을 선택해 **Conversation 열기**.

**보조**: **Pause**(되돌릴 수 있음, 바로 적용), **Resume**, **Edit**(반복 확인의 범위·쓸 문서·주기를 바꾸는 confirmation window를 연다, lophn-agent/assignments#R5), **Withdraw**(되돌릴 수 없음 — confirmation window, lophn-agent/assignments#R9).

lophn·Context Engineer처럼 전체 범위를 보는 담당 하나뿐인 역할은 **Withdraw를 제공하지 않고 Pause/Resume만** 제공한다. 회수한 뒤 다시 만드는 경로가 없어 agent 전체가 조용히 비게 될 수 있기 때문이며, 이 결정은 열린 질문으로 남긴다(screen/roles#Q1).

## 상태

- **비었음**: 반복 확인이 하나도 없으면 목록에서 그 묶음이 빠지고, Context Engineer와의 대화로 시작하는 법만 한 줄 안내한다. 이 안내는 contexts 화면으로 가는 길을 가리키며, 다른 화면 문구와 같이 en으로 쓴다(screens/README#3).
- **Waiting for you**: 사람의 답이나 승인을 기다리는 담당.
- **In progress**: 지금 일하는 중.
- **Needs attention**: 연속 3회 실패로 멈춤(lophn-agent/assignments#R10, R11). 사람이 재개하지 않으면 다시 시작되지 않는다(lophn-agent/assignments#R12).
- **Paused**: 사람이 멈춤. Resume으로만 다시 켠다.
- **Withdrawn**: 다시 켤 수 없고 **대화 입력이 닫힌다**(지난 대화는 읽을 수 있다). 이 담당에 맡겼던 일을 다시 하려면 새로 만들어야 한다(lophn-agent/assignments#R9). 대화 가능/불가의 기준은 shell/desktop#R4가 전제하지만 이 concern 어디에도 정의가 없어 화면에서 Withdrawn 상태로 정했고, 열린 질문으로 남긴다(screen/roles#Q2).
- **대상 보관됨**: 담당이 보던 앱·Focus·문서가 보관되어 멈췄으면 "보던 대상이 보관되었다"와 함께 그 대상으로 이동하는 길만 보인다(lophn-agent/assignments#R14).

## 문구

| key | en |
|---|---|
| roles.list.title | Roles |
| roles.list.empty.operators | No repeating checks yet |
| roles.detail.tab.what | What it does |
| roles.detail.tab.made | What it made |
| roles.detail.tab.conversation | Conversation |
| roles.status.waiting | Waiting for you |
| roles.status.in_progress | In progress |
| roles.status.needs_attention | Needs attention |
| roles.status.paused | Paused |
| roles.status.withdrawn | Withdrawn |
| roles.action.pause | Pause |
| roles.action.resume | Resume |
| roles.action.edit | Edit |
| roles.action.withdraw | Withdraw |
| roles.made.more | Show {count} more |
| roles.needs_attention.body | Stopped after {count} failed attempts. Last reason: {reason} |
| roles.withdraw.confirm_title | Withdraw {name}? |
| roles.withdraw.confirm_body | {name} will stop working. You'll need to set it up again to use it. |
| roles.withdrawn.conversation_closed | This role was withdrawn. You can read past conversation but can't send new messages. |
| roles.target_archived | The {target} this role was watching is archived. |

## 크기와 접근성

목록·상세는 shell/design-system#R21의 목록360px+상세를 쓰고, 목록 행은 shell/design-system#R31 수치를 따른다. 세 탭은 tablist 의미와 화살표+Enter 조작을 제공한다(shell/design-system#R2). 상태 표식은 아이콘+라벨로 색 없이 구별한다(shell/design-system#R10). 좁은 창에서는 목록과 상세를 한 화면씩 보인다(shell/design-system#R24).
