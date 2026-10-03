---
type: requirements
concerns: [lophn-agent/presets]
---
# lophn-agent/presets

역할 종류·이름·prompt·capability·context·MCP·skill·provider·model·붙일 지침을 재사용하는 preset과 제품 기본 preset을 맡는다. 실제 담당 범위·주기·남길 문서는 lophn-agent/assignments다.

## 요구

### 책임과 범위

**[R1]** preset은 역할 종류·이름·prompt·capability(tool 묶음)·context(읽을 자료)·MCP·skill·provider와 model·붙일 지침·판을 가진 재사용 구성으로 두고 실제 담당 대상·주기·남길 문서·세션·run 상태는 넣지 않는다.
- 이유: 역할과 실제 assignment 및 harness 상태를 중복 정의하지 않는다.
- 확인: 구성을 복사해도 담당 대상·진행 일·이력이 복사되지 않고 assignment가 별도 범위를 요구하는지 본다.
- 의도: lophn-agent#I5

**[R2]** preset 이름과 prompt는 앞뒤 공백을 제외하고 각각 1자 이상이어야 하며 비면 저장을 거절한다.
- 이유: 사람이 고를 책임을 빈 이름이나 설명으로 만들지 않는다.
- 확인: 공백뿐인 이름·prompt를 거절하고 역할 종류와 나머지 구성 항목을 함께 검사하는지 본다.
- 의도: lophn-agent#I5

**[R3]** preset 이름은 앞뒤 공백과 영문 대소문자를 무시해 사람이 만든 preset 사이에서 중복을 거절하고 제품 기본 preset과 같은 표시 이름을 쓰려면 별도 이름을 받는다.
- 이유: 이름만으로 기존 구성을 덮어쓰지 않는다.
- 확인: 같은 이름의 복사·등록이 기존 preset을 수정하지 않고 거절되는지 본다.
- 의도: lophn-agent#I5

**[R4]** preset prompt는 맡는 일·맡지 않는 일·관점·기대 결과를 Markdown 글로 쓰며 Operator는 반복할 판단·필요 근거·비교 기준·갱신 조건도 설명한다.
- 이유: 관점과 기대 결과는 domain model 필드가 아니라 사람이 읽고 고치는 prompt다.
- 확인: 저장한 prompt 원문을 읽어 책임을 확인하고 관점·기대 결과를 별도 기계 값으로 복제하지 않는지 본다.
- 의도: lophn-agent#I5

**[R5]** preset의 context는 읽을 자료 선택이며 assignment의 담당 범위와 구별하고 실제 읽기는 선택한 자료·현재 접근 허락·제품이 고정한 역할별 읽기 상한의 교집합만 허용한다.
- 이유: Operator를 문서 context에 붙이는 구조와 자료 읽기 선택을 분리한다.
- 확인: project에 붙은 Operator 둘이 다른 context 자료를 선택하고 범위 밖 자료·주소 따라 읽기는 거절되는지 본다.
- 의도: lophn-agent#I5

**[R6]** provider 계정과 model은 preset마다 선택하고 credential 값·서버 인증·가격표는 넣지 않으며 공통 judgment·organizing 기본값은 새 preset 구성 때 복사할 후보로만 쓴다.
- 이유: 고른 계정·model을 공통 설정 변경으로 몰래 바꾸지 않는다.
- 확인: 다른 계정·model의 preset 둘이 각 선택으로 돌고 기본값 변경이 기존 preset이나 run을 바꾸지 않는지 본다.
- 의도: lophn-agent#I5, lophn-agent/harness#I1

### tool과 정의 판

**[R7]** capability는 선택한 tool 묶음을 저장 시점의 개별 동작으로 펼쳐 판에 고정하고 빈 선택은 0개이며 묶음에 새 동작이 생겨도 기존 선택이 자동으로 늘지 않는다.
- 이유: 묶음 확장을 권한 확장으로 만들지 않는다.
- 확인: 묶음·제품 기본 preset을 갱신해도 고정 판의 제공 목록은 같고 새 판의 명시 적용 및 Operator의 새 승인 뒤에만 바뀌는지 본다.
- 의도: lophn-agent#I5

**[R8]** preset prompt·skill·붙인 지침은 권한·approval·제품 금지·읽기와 결과 상한을 넓히지 못하며 실제 호출은 현재 lophn-agent/harness/tool-judgment 검사를 따른다.
- 이유: 글로 쓴 책임을 권한으로 취급하지 않는다.
- 확인: 범위 밖 tool 요청은 프롬프트에 허용 문구가 있어도 거절되는지 본다.
- 의도: lophn-agent#I5, lophn-agent#I6

**[R9]** 네 역할마다 제품 기본 preset 하나를 제공하고 사람은 기본 preset에서 자기 변경 판을 만들거나 복사·새 preset 생성으로 구성하며 제품이 고정한 역할 종류의 금지와 상한은 수정하지 못한다.
- 이유: 구성 재사용과 역할의 제품 경계를 분리한다.
- 확인: lophn·App Engineer·Context Engineer·Operator의 prompt·model·context·MCP·skill은 바뀌고 코드·권한 우회·결과 상한 확대는 거절되는지 본다.
- 의도: lophn-agent#I5

**[R10]** preset 복사는 구성만 복사하며 다른 assignment의 실제 범위·세션·이력·approval request·부여 권한·인증 값을 복사하지 않는다.
- 이유: 재사용한 정의에 이전 사용자의 권한이 따라오지 않는다.
- 확인: 새 assignment가 별도 대상과 승인을 요구하고 과거 세션을 상속하지 않는지 본다.
- 의도: lophn-agent#I5

**[R11]** preset 저장·적용 전에 역할 종류·필수 값·이름 중복·자료와 지침 참조·tool·확장·provider 계정과 model·제품 상한을 전체 검사하고 하나라도 잘못되면 항목별 설명과 함께 전체 적용을 거절한다.
- 이유: 부분적으로 유효한 역할이 남지 않게 한다.
- 확인: 유효한 프롬프트와 잘못된 tool을 함께 제출할 때 어느 일부도 바뀌지 않는지 본다.
- 의도: lophn-agent#I5, lophn-agent#I6

**[R12]** preset 변경·기본값 개인화·과거 내용 복원은 전체 새 판으로 저장하고 실패하면 이전 판 전체를 유지하며 과거 판은 덮어쓰지 않는다.
- 이유: 시작한 run의 책임 근거를 안정적으로 유지한다.
- 확인: 변경 실패 뒤 이전 정의가 그대로이고 과거 판 적용 뒤 새 판이 남는지 본다.
- 의도: lophn-agent#I5, lophn-agent#I7

**[R13]** preset의 생성·변경·사용 중단 근거는 결정한 사람·제안 주체·시각·이유·전후 전체 내용과 함께 보존해 각 run이 사용한 판을 확인하게 한다.
- 이유: 나중에 어떤 책임으로 일했는지 되짚을 수 있어야 한다.
- 확인: 실제 기록 보존과 조회는 platform/ledger와 lophn-agent/observability에 따라 과거 run에서 근거 판으로 이어지는지 본다.
- 의도: lophn-agent#I5, lophn-agent#I7

**[R14]** preset 새 판은 사용 중 assignment를 자동으로 옮기지 않고 사람이 명시적으로 붙인 판을 다음 run부터 사용하되 현재 범위 회수·assignment 멈춤은 옛 판을 이유로 미루지 않는다.
- 이유: assignment가 preset 하나의 판을 고정하고 승인한 반복 책임을 자동 변경하지 않는다.
- 확인: 공유 preset 변경 후 기존 assignment 판은 같고 명시 적용한 assignment의 다음 run만 새 판을 쓰며 현재 회수는 즉시 막히는지 본다.
- 의도: lophn-agent#I5, lophn-agent#I7

**[R15]** Operator preset과 project 또는 app 범위·남길 문서·주기를 결합한 초안은 반복할 판단·근거·비교 기준·갱신 조건·책임 밖과 구성 전체를 사람이 검토할 수 있게 한다.
- 이유: Operator 이름만으로 반복 책임을 승인하지 않는다.
- 확인: 초안의 책임을 읽고 무엇을 판단하고 언제 결과를 바꿀지 알 수 있으며 실제 결합은 lophn-agent/assignments를 따르는지 본다.
- 의도: lophn-agent#I5, lophn-agent#I6

## 버린 것
- 내장 세 역할 편집·복사 금지는 I5의 재사용 구성과 맞지 않아 네 역할의 preset 편집·복사로 바꿨다.
- Preset의 목적·상황·관점·기대 결과·OperatorJudgment 기계 값은 prompt 글로 옮겼다.
- 역할별 model 금지와 별도 확장 선택 map은 preset의 provider·model·MCP·skill 선택으로 바꿨다.
