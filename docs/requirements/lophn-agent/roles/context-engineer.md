---
type: requirements
concerns: [lophn-agent/roles/context-engineer]
---
# lophn-agent/roles/context-engineer

컨텍스트의 목적·범위·관점과 용어 후보를 짜고 다듬으며 반복 판단이 필요할 때 Operator 정의와 assignment 초안을 제안하는 Context Engineer를 맡는다.

## 요구

### 책임과 범위

**[R1]** Context Engineer는 사람 요청 또는 허용 handoff에서 컨텍스트의 목적·문서 묶음·관점·용어 후보를 정리하고 선택 이유가 있는 설계 보고와 Operator 초안을 남긴다.
- 이유: 사람이 모든 문서 범위를 직접 관리하지 않아도 목적에 맞는 구성이 남아야 한다.
- 확인: 컨텍스트 설계 요청에서 이유·고정 근거·책임 경계가 있는 구성을 남기는지 본다.
- 의도: lophn-agent#I1

**[R2]** Context Engineer는 모델 입력 조립·cache·대화 압축, 앱 기획·설계·코드·수리·티켓, 앱 명령 실행, Operator 업무 대행과 원본 문서의 이동·이름 변경·삭제를 하지 않는다.
- 이유: 문서 읽는 관점의 정리를 구현이나 원본 변경과 구분한다.
- 확인: 책임 밖 요청은 해당 concern으로 안내하고 해당 변경 tool이 제공되지 않는지 확인한다.
- 의도: lophn-agent#I1

**[R3]** 읽기는 전체 컨텍스트의 목적·항목·용어와 목차에서 시작해 이번 판단에 필요한 문서의 절·본문 범위만 펼쳐 읽는다.
- 이유: 전체 범위를 안다고 모든 본문을 먼저 읽을 필요는 없다.
- 확인: 여러 문서 요청에서 목차·검색 뒤 필요한 부분만 읽고 실제 근거 판이 남는지 본다.
- 의도: lophn-agent#I1

**[R4]** 읽기 tool은 문서 목차·검색·고정 version·절·범위·목록·이력·차이, 컨텍스트·프로젝트·형식·역할·assignment 조회와 검사, 앱 blueprint의 명령 이름·설명·입력·효과 조회만 선택한다.
- 이유: apps/blueprint에 따라 앱 읽기 항목을 고르되 명령 실행 권한은 받지 않는다.
- 확인: 앱 명령 metadata는 읽히지만 호출과 시리즈 조회는 제공 목록에 없는지 확인한다.
- 의도: lophn-agent#I1

**[R5]** 쓰기 tool은 되돌릴 수 있는 컨텍스트 생성·이름·목적·보관·항목 변경, 용어 후보 관리·사람 정의 답 전달, 요청 범위 보고 저장, Operator 승인 초안 제출, 질문과 허용 handoff만 제공한다.
- 이유: 정리 쓰기는 허용하되 실제 assignment 적용과 권한 예외는 두지 않는다.
- 확인: 컨텍스트·보고 쓰기는 매번 묻지 않고 정의 답 적용은 documents/terms, assignment 적용은 lophn-agent/assignments를 따르는지 본다.
- 의도: lophn-agent#I1

### 컨텍스트와 용어

**[R6]** 자료가 컨텍스트 목적에 대한 책임 근거이면 기준, 배경 지식이면 참고, 변화만 따라갈 자료이면 watch로 선택하며 같은 문서도 컨텍스트마다 다르게 판단한다.
- 이유: 관점은 문서 자체의 속성이 아닌 목적에 따른 해석이다.
- 확인: 같은 문서를 두 컨텍스트에 다르게 연결할 때 이유가 설명되고 적용 계약은 documents/contexts를 따르는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R7]** 컨텍스트 설계 보고는 요청 범위 문서에 컨텍스트별 목적·범위·용어·경계를 담고 범위에는 항목 주소·관점·이유 한 줄, 용어에는 사람이 받아들인 최대 30개와 별도 미정 후보, 경계에는 맡지 않는 일을 적는다.
- 이유: 고정 보고 자리 없이 판단의 전체 결과를 읽을 수 있어야 한다.
- 확인: 보고의 네 부분과 30개 제한을 확인하고 미정 용어가 확정 용어에 섞이지 않는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I7

**[R8]** 용어 후보는 같은 컨텍스트의 서로 다른 문서 3개 이상 본문에 그대로 나타나는 미등록 말로 한정하고 후보마다 최대 5개 출현 주소를 남기며 정의는 사람의 답 참조만 전달한다.
- 이유: agent가 관측한 말과 사람이 정한 뜻을 구분한다.
- 확인: 2개 문서만에 나온 말은 후보로 확정하지 않고 실제 정의 적용은 documents/terms에서 machine이 처리하는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R9]** 컨텍스트 간 같은 뜻의 다른 말은 대응 후보로, 같은 말의 다른 뜻은 결정이 필요한 충돌로 구분해 보고하고 후자의 기획 판단은 lophn에 맡긴다.
- 이유: 용어 충돌을 자동 합쳐 의미를 바꾸지 않는다.
- 확인: 두 종류가 보고에 분리되고 handoff는 lophn-agent/handoff의 고정 근거를 사용하는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R10]** 목적·용어 정의·충돌 해석에 사람의 결정이 필요하면 미정 선택과 근거를 질문하며 답이 없으면 관련 변경을 보류하고 보고에 남긴다.
- 이유: 사람 뜻의 부재를 추천 수락으로 간주하지 않는다.
- 확인: 미답 내용을 정의로 적용하지 않고 질문 종료의 run 처리는 lophn-agent/harness/waiting-and-recovery를 따르는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

### Operator 제안과 model 선택

**[R11]** Operator 후보 검토는 최근 30일 watch 변화 4회 이상·기준 자료 뒤처짐 14일 이상·최근 30일 같은 수동 업무 4회 이상 중 하나의 근거가 있을 때 시작하되 단순 합계나 자료 수집만 있는 일은 제안하지 않는다.
- 이유: 반복 모델 판단과 machine 계산을 분리한다.
- 확인: 근거 횟수·기간과 판단 필요성을 설명하고 변화·일일 용어 탐색 자체로 새 Context Engineer run을 만들지 않는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5, lophn-agent#I6

**[R12]** Operator 초안은 prompt의 판단·제외·필요 근거·비교 기준·갱신 조건, project 또는 app 범위, preset 전체 구성과 읽을 자료, 기존 남길 문서 최소 1개·주기·승인 앱 read·전후 판과 이유를 담는다.
- 이유: 실제 쓰기 대상과 책임을 승인 전 확인하게 한다.
- 확인: 필요하면 최초 양식을 실제 문서 version으로 남기되 주기 결과로 표시하지 않고 적용은 lophn-agent/assignments로만 진행되는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5, lophn-agent#I6

**[R13]** 같은 project 또는 app에 책임이 겹치는 Operator가 있으면 새 assignment를 늘리기보다 기존 preset 판·남길 문서 변경을 제안하고 겹침 근거를 붙인다.
- 이유: 중복 판단과 결과 문서 경쟁을 줄인다.
- 확인: 겹친 후보에서 기존 assignment 변경 초안이 나오며 승인 없이 자동 변경되지 않는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5, lophn-agent#I6

**[R14]** 목적·경계·관점·term 해석·Operator 설계는 judgment 용도, 이미 정한 보고 제목·요약은 organizing 용도로 분리하고 실제 model·계정은 preset 선택을 쓴다.
- 이유: 용어 정의나 책임 선택을 단순 정리 호출로 만들지 않는다.
- 확인: 본문과 정리의 용도가 기록되고 실제 호출이 해당 preset의 provider·model·계정으로 가는지 본다.
- 의도: lophn-agent#I5, lophn-agent/harness#I1

### prompt의 관점·기대 결과

context 목적·경계와 기준·참고·watch를 구분하고 사람이 정한 뜻과 후보를 섞지 않는다. 목적에 맞는 context 구성·관점별 선택 근거·term 후보·고정 근거가 있는 설계 보고와 Operator 초안을 기대한다.

| 결과 종류 | 필수 내용 | 제약 |
|---|---|---|
| context 설계 보고 | context별 목적·범위·term·경계 | 범위는 item 주소·관점·한 줄 근거; term은 사람 채택한 것 최대 30개와 미정 후보 별도; 경계는 책임 밖 |
| 관점 선택 | 목적에 대한 책임 근거 `기준`, 배경 지식 `참고`, 변화 추적 `watch` | 같은 문서도 context마다 다른 관점 허용; 값 정의는 → documents/contexts |
| term 후보 | 아직 등록되지 않은 말·출현 주소·사람에게 물을 정의 | 같은 context의 서로 다른 문서 3개 이상 본문에 그대로 출현; 후보당 근거 주소 최대 5개 |
| term 대응·충돌 | 같은 뜻의 다른 말은 대응 후보, 같은 말의 다른 뜻은 미정 충돌 | 사람 답 없으면 정의 확정 불가; → documents/terms |
| Operator 초안 | 이름·목적·상황·prompt의 책임·제외·관점·기대 결과·반복 질문·근거·비교 기준·갱신 조건·책임 밖·project 또는 app 하나·읽을 앱/명령·실제 남길 문서·주기·tool 선택·전후 판·변경 설명 | 적용 내용은 OperatorApprovalBundle → lophn-agent/assignments; preset의 provider·model·skill·MCP·context·지침 연결; 제품 run 한도·권한 예외는 없음 |


## 버린 것
- 시스템 자리의 단일 보고 선언·시리즈 조회와 자동 일일 용어 탐색·변화 event run은 lophn-agent/roles/operator 및 사람 요청만 받는 결정으로 제거했다.
- model·skill·MCP·context 선택은 preset으로 모았다. run 한도·권한 예외는 사람이 고칠 preset 필드가 아니다.
