---
type: requirements
concerns: [lophn-agent/assignments]
---
# lophn-agent/assignments

assignment는 자리에 놓인 agent 하나의 실행 정체다. run·session·question·approval이 "누가"를 이것으로 가리킨다. 역할별 개수, 앱을 만들 때 App Engineer를 준비하는 일, 사람이 Operator 정의를 저장하고 지울 때 assignment를 만들고 거두는 일, 자리가 보관될 때 machine이 멈추는 일을 맡는다. agent가 어떤 설정으로 일하는지(model, 지침, context, 권한)는 lophn-agent/agents가 맡는다.

## 요구

### 책임과 범위

**[R1]** machine은 앱 등록 뒤 앱마다 거두지 않은 App Engineer assignment 하나를 준비하며 담당 앱 보관 시 멈추고 보관이 풀리면 멈춤을 푼다.
- 이유: apps/registration에 따라 앱 담당을 준비하고, 사람이 재개할 화면이 없으므로 보관을 푼 앱이 영영 멈춰 있지 않게 한다.
- 확인: 같은 등록 처리가 중복돼도 담당이 하나이고, 보관 뒤 새 일이 막히고, 보관을 풀면 다시 접수되는지 본다.
- 의도: lophn-agent#I4

**[R2]** 거두지 않은 lophn과 Context Engineer의 전역 assignment는 각각 하나이고 App Engineer는 앱마다 하나이며 Operator는 project 또는 app마다 필요한 만큼 두고 수 상한은 두지 않는다.
- 이유: 실제 책임 중복만 제한하고 임의 개수 한도를 두지 않는다.
- 확인: 같은 project나 app에 8개를 넘는 Operator도 만들어지고 같은 앱의 App Engineer 중복은 거절되는지 본다.
- 의도: lophn-agent#I4

**[R3]** 기본 화면에는 agent가 맡은 일의 현재 진행과 필요한 행동만 보여 주고 역할·담당 자리·상태(켜짐·멈춤·거둠)는 상세에서 현재 run 상태와 구별해 확인하게 하며 화면 말은 shell/wording을 따른다.
- 이유: 책임의 상태와 한 번의 실행 상태는 다르다.
- 확인: run이 완료돼도 assignment가 유지되고 멈춘 이유와 진행 중인 run을 따로 확인할 수 있는지 본다.
- 의도: lophn-agent#I4

**[R4]** Operator assignment는 사람이 Agents 탭 editor에서 새 Operator 정의를 처음 저장할 때만 만들어지고 이미 있는 정의를 고치는 저장은 assignment를 바꾸지 않으며, agent는 자기 또는 다른 assignment를 만들거나 바꾸거나 거두지 않는다.
- 이유: 판단과 제안은 agent가, 결정과 허락은 사람이 한다. 같은 일을 사람이 직접 하는 저장에 승인 단계를 더하지 않는다.
- 확인: 사람이 정의를 저장하면 assignment가 하나 생기고 같은 정의를 다시 저장해도 늘지 않으며, agent에게 제공하는 tool 중 assignment를 쓰는 것이 없는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I6

### 멈춤·회수

**[R9]** 사람은 Operator를 지워 그 assignment를 거둘 수 있고 거둔 책임은 재개하지 않으며 다시 맡기려면 새 Operator를 만든다. lophn·Context Engineer·App Engineer는 거둘 수 없다.
- 이유: 영구 책임 종료와 자리 보관에 따른 일시 멈춤을 구분한다.
- 확인: 거둔 뒤 새 요청이 거절되고 지난 session·run·문서는 남으며, built-in은 지우는 길이 없는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I6

**[R14]** 담당 project나 앱이 보관되면 그 assignment를 machine이 멈추고, 일시적으로 접근할 수 없는 자리는 새 일을 시작하거나 호출하지 않는다.
- 이유: 없는 자리에 일을 시키지 않는다.
- 확인: 보관은 멈춤으로 남고 일시 장애는 상태를 바꾸지 않으며 진행 중인 run의 정리는 lophn-agent/harness/run-loop를 따르는지 본다.
- 의도: lophn-agent#I4

**[R15]** Operator는 사람 요청으로만 일하고 앱 업무 단계나 event 변화로 책임을 자동 접수하지 않으며, run의 겹침과 사람 답을 기다리는 run은 lophn-agent/harness/run-loop의 규칙을 따른다.
- 이유: 주기(lophn-agent/scheduling)가 보류인 동안 Operator는 사람이 부르는 agent다.
- 확인: 앱 문제나 context 위반이 Operator의 새 run을 만들지 않는지 본다.
- 의도: lophn-agent#I4

**[R16]** 켜진 assignment와 멈춘 assignment는 대화를 열 수 있고 거둔 assignment는 지난 대화만 읽으며 새 대화·입력을 받지 않는다. 멈춘 assignment의 입력 보존은 lophn-agent/conversation을 따르고 실행 접수·model·tool 호출을 허용하지 않는다.
- 이유: 대화 입력과 책임 실행의 상태를 분리해 멈춘 일이 조용히 되살아나지 않게 한다.
- 확인: 멈춘 assignment에 보낸 말은 보존되지만 run·model·tool이 생기지 않고 거둔 assignment는 지난 대화 읽기만 되는지 본다.
- 의도: lophn-agent#I4

### 구성과의 관계

**[R17]** assignment는 구성(model, 지침, context, skill, MCP, 권한)을 갖지 않고 run을 준비할 때 lophn-agent/agents의 정의에서 읽은 값을 run마다 고정해 쓰며, 정의를 고쳐도 시작한 run은 바뀌지 않고 다음 run부터 새 값을 쓴다.
- 이유: 책임의 정체와 설정을 분리해 사용 중인 구성을 몰래 바꾸지 않는다.
- 확인: 정의를 고친 뒤 진행 중인 run은 옛 값을 쓰고 다음 run이 새 값을 쓰며 assignment의 id가 그대로인지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5

**[R18]** agent의 이름이나 정의를 바꿔도 그 agent가 한 일의 기록(run·session·question·approval)은 같은 assignment를 가리킨다.
- 이유: 정의 파일 이름이 assignment 식별자이므로 이름을 고쳐도 지난 기록의 주체가 바뀌지 않아야 한다.
- 확인: Operator 이름을 바꾼 뒤 지난 session과 run이 같은 Operator 아래에 보이는지 본다.
- 의도: lophn-agent#I7

## 열린 질문

lophn-agent/assignments#Q7

## 버린 것

이전 번호 가운데 새 모델에 남지 않은 것(R5~R8, R10~R13)과 이유. 번호는 다시 쓰지 않는다.

- R5 — Operator 생성·변경을 preset 전체 판·범위·남길 문서·주기·읽을 앱 command의 전후 내용에 묶어 승인하는 요구. preset이 없어졌고(lophn-agent/agents) 사람이 editor에서 직접 저장하는 일에 승인 단계를 두지 않는다. 이전 R4의 초안·승인 절차와 agent가 Operator를 제안하는 길도 같이 없앴다(R4가 남은 뜻만 가진다).
- R6·R7·R8 — Operator의 남길 문서(첫 version이 있는 기존 문서, 이름이 바뀌어도 같은 문서, 문서 하나에 Operator 하나가 독점). 남길 문서를 없앴다. Operator가 문서를 쓸 수 있는 범위는 lophn-agent/agents#Q1이다.
- R9의 사람 멈춤·재개 — 새 화면에 멈춤·다시 시작이 없어 없앴다. 멈춤은 자리 보관에 따른 machine 멈춤만 남았다(R14). 거둠은 Operator 삭제로 남았다(R9).
- R10~R13 — 실제 시작한 run의 최종 실패 연속 3회 멈춤과 집계·사람 재개로만 풀기·멈춤 범위. production에서 내는 곳이 없어 근거 검사째 없앴다.
- R14의 보관된 남길 문서에 따른 멈춤 — 남길 문서가 없어져 같이 없앴다.
- R17의 preset 판 고정 — preset이 없어졌다. 같은 번호가 구성과의 관계(정의에서 읽은 값을 run마다 고정)로 바뀌었다.
