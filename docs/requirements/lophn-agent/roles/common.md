---
type: requirements
concerns: [lophn-agent/roles/common]
---
# lophn-agent/roles/common

lophn, App Engineer, Context Engineer, Operator에 공통인 금지, 문서 저장과 tool 선택의 경계를 맡는다; 역할별 책임과 실제 동작은 각 역할 concern이, tool 계약과 판정은 lophn-agent/harness/tools와 lophn-agent/harness/tool-judgment가 맡는다.

## 요구

### 책임과 범위

**[R1]** lophn agent는 lophn, App Engineer, Context Engineer, Operator의 네 역할로 일하며 어느 역할에도 코드 작성·수정·실행, 임의 shell, 임의 파일 접근 tool을 주지 않는다.
- 이유: 판단과 구현을 분리하고 개인 컴퓨터의 임의 실행 통로를 만들지 않는다.
- 확인: 네 역할의 제공 tool을 확인하고 코드 수정·shell 요청이 coding-agent 책임으로 안내되는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R2]** 네 역할 모두 subagent를 만들거나 coding agent 시작을 직접 실행하지 않으며 사람의 ticket [Start]는 coding-agent/sessions가 처리한다.
- 이유: 사람이 연 coding agent와 역할의 독립 run을 유지한다.
- 확인: agent에게 coding agent 시작 tool이 없고 사람의 [Start] 뒤 터미널 탭의 TUI 시작은 coding-agent/sessions로 이어지는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R3]** 네 역할 모두 웹 검색·웹 읽기·임의 URL 열기·브라우저 조작을 하지 않는다.
- 이유: 로컬 문서와 앱 계약을 판단의 경계로 삼는다.
- 확인: 웹 검색과 URL 읽기 요청에 제공 가능한 tool이 없는지 확인한다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R4]** 네 역할의 공통 tool은 자기 범위의 문서 목록·목차·검색·고정 version·절·범위·이력·차이 읽기, context의 선언 검색·개체 읽기와 series의 다음 이름 읽기, 형식 규칙·예시·검사, 질문·결정 조회 중 역할에 필요한 동작만 선택한다.
- 이유: tool 묶음 전체가 불필요한 권한을 주지 않게 한다.
- 확인: 각 역할의 선택 목록과 실제 제공 동작을 대조하고 범위 밖 주소로 읽기 범위가 늘지 않는지 확인한다.
- 의도: lophn-agent#I1

**[R5]** 네 역할은 agent 정의(lophn-agent/agents)로 외부 MCP tool과 skill을 선택할 수 있고 앱의 external command는 lophn-agent/harness/tool-judgment의 효과 판정으로 쓴다. 소스·앱 업무 DB·secret 직접 읽기, 앱 command 계약 밖 운영, 자기 또는 다른 agent의 정의 저장·assignment 변경과 사람 대신 결정하는 tool은 제공하지 않는다.
- 이유: 확장 선택은 재사용 구성이지 제품 금지 해제나 사람 허락이 아니고, 앱이 선언한 외부 전송만 효과 판정을 거친다.
- 확인: MCP·skill을 끈 정의는 켠 것의 허용 tool만 제공하고, 앱 external command는 효과 판정을 받으며 계약 밖 운영과 secret 직접 읽기는 없는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

### 저장과 model 선택

**[R6]** 네 역할은 해당 run 요청 범위에서 문서를 저장하며 Operator는 담당 자리의 문서에만 저장하고, 어느 역할이든 저장마다 lophn-agent/harness/tool-judgment 판정을 거친다.
- 이유: 요청별 산출물을 남기되 쓸 수 있는 자리는 역할 책임과 담당 자리가 정한다(lophn-agent/roles/operator).
- 확인: 같은 요청에서 일반 역할은 필요한 문서를 남기고 Operator의 담당 자리 밖 문서 저장 요청은 거절되는지 본다.
- 의도: lophn-agent#I1

**[R7]** 문서의 새 version은 실제로 읽은 기준 version을 사용하며 형식과 저장 검사는 documents/versions와 documents/formats의 현재 계약을 따른다.
- 이유: 역할에 형식·시리즈·예약 자리를 복사해 두면 문서 정본과 어긋난다.
- 확인: 읽은 뒤 사람이 고친 문서의 저장이 충돌하고 역할 정의에 별도 저장 형식 사본이 없는지 본다.
- 의도: lophn-agent#I1

**[R8]** 새 선택·해석·요구·가설·acceptance check와 본문 작성은 judgment 용도, 이미 정한 내용의 제목·요약은 organizing 용도로 분리하고 judgment는 resolved agent의 model·계정, organizing은 Workspace의 Model for summaries(비면 agent model)를 쓴다.
- 이유: lophn-agent/harness/model에 따라 내용 판단과 표현 정리를 분리한다.
- 확인: 판단과 정리가 다른 용도 기록을 가지며 Model for summaries가 비어 있으면 같은 agent model을 쓰되 새 판단을 만들지 않는지 본다.
- 의도: lophn-agent#I5

**[R9]** 단순 합계·format 검사는 model 호출 없이 처리하며 session 요약(Compact)은 lophn-agent/harness/prompt-assemble, 실제 선택은 agent 정의와 Workspace 기본값, catalog·한계는 lophn-agent/harness/model을 따른다.
- 이유: 결정적 계산에 새로운 model 판단을 끼우지 않는다.
- 확인: 합계·format 검사에 호출이 없고 제목·요약은 Model for summaries 또는 비었을 때 같은 agent model을 쓰는지 본다.
- 의도: lophn-agent#I5

**[R10]** 역할이 보고한 결과는 실제 읽은 고정 근거와 부족한 자료를 구분하고 문서 저장의 접수·version 확정·파일 반영을 서로 다른 사실로 설명한다.
- 이유: 계획과 확인되지 않은 수치를 완료 사실로 표시하지 않는다.
- 확인: 근거가 없거나 파일 반영이 실패한 사례를 넣고 확인됨이라는 설명을 만들지 않는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I7

### 새 기능

**[R11]** 앱 command 노출은 lophn은 사람이 agent 사용을 허락한 앱의 command, App Engineer는 담당 앱의 read와 되돌리기를 지원하는 write, Operator는 정의의 `app_reads`에 고른 read만, Context Engineer는 실행 없이 목록·설명 조회로 한정한다. 노출된 command 중 되돌릴 수 없거나 심각한 효과만 묻고 나머지는 묻지 않는다.
- 이유: 자동 tool 생성과 각 역할의 실제 책임을 분리하고, 역할 안 가역 동작은 결재하지 않는다.
- 확인: 같은 blueprint를 네 역할에서 열어 역할별 교집합만 호출되고, 되돌릴 수 있는 write는 묻지 않으며 external·confirm만 묻는지 본다.
- 의도: lophn-agent#I1

**[R12]** 네 역할은 자기 세션에서 읽은 근거를 시각 블록으로 보여 줄 수 있으나 앱 카드·시각 블록·현재 탭을 통해 문서 쓰기 대상이나 앱 command 범위를 확대하지 않는다.
- 이유: 그림은 기존 책임 안의 답 표현이다.
- 확인: Operator의 다른 문서 저장과 CE의 카드 command 실행이 막히고 일반 표·차트는 표시되는지 본다.
- 의도: lophn-agent#I9

**[R13]** 네 역할은 사람이 쓰는 LOPHN.md와 agent instructions를 직접 고치지 않고 lophn-agent/instructions의 question 제안과 사람 편집 경로만 쓴다.
- 이유: 사람의 지속 지시를 agent가 자기 판단으로 덮어쓰지 않는다.
- 확인: document.save_version이나 외부 MCP로 지침을 고치는 요청이 막히고 사람이 editor에서 저장한 뒤에만 지침이 바뀌는지 본다.
- 의도: lophn-agent#I8, lophn-agent#I6

## 버린 것
