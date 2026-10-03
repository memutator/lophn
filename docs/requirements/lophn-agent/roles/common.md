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
- 의도: lophn-agent/roles#I6

**[R2]** 네 역할 모두 subagent를 생성하거나 coding agent 프로세스를 띄우지 않는다.
- 이유: 사람이 연 coding agent와 역할의 독립 run을 유지한다.
- 확인: 제공 tool에 subagent 생성·coding agent 시작 동작이 0개이고 다른 역할 요청이 lophn-agent/handoff만 따르는지 본다.
- 의도: lophn-agent/roles#I1

**[R3]** 네 역할 모두 웹 검색·웹 읽기·임의 URL 열기·브라우저 조작을 하지 않는다.
- 이유: 로컬 문서와 앱 계약을 판단의 경계로 삼는다.
- 확인: 웹 검색과 URL 읽기 요청에 제공 가능한 tool이 없는지 확인한다.
- 의도: lophn-agent/roles#I6

**[R4]** 네 역할의 공통 tool은 자기 범위의 문서 목록·목차·검색·고정 version·절·범위·이력·차이 읽기, 컨텍스트·용어 읽기, 형식 규칙·예시·검사, 질문·결정 조회 중 역할에 필요한 동작만 선택한다.
- 이유: tool 묶음 전체가 불필요한 권한을 주지 않게 한다.
- 확인: 각 역할의 선택 목록과 실제 제공 동작을 대조하고 범위 밖 주소로 읽기 범위가 늘지 않는지 확인한다.
- 의도: lophn-agent/roles#I1

**[R5]** 네 역할의 기본 외부 MCP tool과 skill 선택은 각각 0개이며 소스·앱 업무 DB·secret 값 직접 읽기, activation·secret 값 직접 접근, 앱 command 계약 밖 운영·외부 전송, 자기 역할·assignment 적용과 사람 대신 결정하는 tool도 주지 않는다.
- 이유: 확장 지원과 내장 역할의 기본 능력을 혼동하지 않는다.
- 확인: lophn-agent/extensions의 연결이 있어도 역할의 기본 제공 목록이 늘지 않고 금지 동작이 없는지 확인한다.
- 의도: lophn-agent/roles#I1

### 저장과 model slot

**[R6]** lophn·App Engineer·Context Engineer는 해당 run 요청 범위에서 문서를 저장하고 Operator만 lophn-agent/assignments에서 승인한 남길 문서에 새 version을 저장한다.
- 이유: lophn-agent/roles/operator에 따라 요청별 산출물과 반복 책임의 고정 쓰기 대상을 구분한다.
- 확인: 같은 요청에서 일반 역할은 필요한 문서를 남기고 Operator의 다른 문서 생성 요청은 거절되는지 본다.
- 의도: lophn-agent/roles#I1, lophn-agent/roles#I5

**[R7]** 문서의 새 version은 실제로 읽은 기준 version을 사용하며 형식과 저장 검사는 documents/versions와 documents/formats의 현재 계약을 따른다.
- 이유: 역할에 형식·시리즈·예약 자리를 복사해 두면 문서 정본과 어긋난다.
- 확인: 읽은 뒤 사람이 고친 문서의 저장이 충돌하고 역할 정의에 별도 저장 형식 사본이 없는지 본다.
- 의도: documents#I1, documents#I9

**[R8]** 새 선택·해석·요구·가설·acceptance check와 결과 본문 작성에는 judgment slot을 쓰고 이미 정한 내용의 제목·요약에는 organizing slot을 쓴다.
- 이유: lophn-agent/harness/model에 따라 내용 판단과 표현 정리를 분리한다.
- 확인: 가설 생성과 그 제목 정리의 사용 slot을 비교하고 organizing 결과가 새 요구를 추가하지 않는지 본다.

**[R9]** 단순 합계·다음 예정 시각 계산·형식 검사는 모델 호출 없이 처리하며 대화 압축과 실제 model 설정은 lophn-agent/harness/prompt-assemble과 lophn-agent/harness/model을 따른다.
- 이유: 결정적 계산에 새로운 해석이나 역할별 model 설정을 끼우지 않는다.
- 확인: 예정 시각과 합계를 계산할 때 모델 호출이 없고 역할별 model 덮어쓰기가 0개인지 본다.

**[R10]** 역할이 보고한 결과는 실제 읽은 고정 근거와 부족한 자료를 구분하고 문서 저장의 접수·version 확정·파일 반영을 서로 다른 사실로 설명한다.
- 이유: 계획과 확인되지 않은 수치를 완료 사실로 표시하지 않는다.
- 확인: 근거가 없거나 파일 반영이 실패한 사례를 넣고 확인됨이라는 설명을 만들지 않는지 본다.
- 의도: lophn-agent/roles#I1

### 새 기능

**[R11]** 앱 command 노출은 lophn은 사람이 agent 사용을 허락한 앱의 command, App Engineer는 담당 앱의 read와 되돌리기를 지원하는 write, Operator는 assignment에 승인된 read만, Context Engineer는 실행 없이 목록·설명 조회로 한정한다.
- 이유: 자동 tool 생성과 각 역할의 실제 책임을 분리한다.
- 확인: 같은 blueprint를 네 역할에서 열어 역할별 교집합만 호출되고 external은 lophn에서만 approval 대상으로 보이는지 본다.
- 의도: lophn-agent/roles#I1, lophn-agent/harness#I9

**[R12]** 네 역할은 자기 세션에서 읽은 근거를 시각 블록으로 보여 줄 수 있으나 앱 카드·시각 블록·현재 탭을 통해 문서 쓰기 대상이나 앱 command 범위를 확대하지 않는다.
- 이유: 그림은 기존 책임 안의 답 표현이다.
- 확인: Operator의 다른 문서 저장과 CE의 카드 command 실행이 막히고 일반 표·차트는 표시되는지 본다.
- 의도: lophn-agent/roles#I1, lophn-agent#I9

## 열린 질문

## 버린 것
