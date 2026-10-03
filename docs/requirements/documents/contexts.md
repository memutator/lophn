---
type: requirements
concerns: [documents/contexts]
---
# documents/contexts

context의 목적·자료·선택 이유와 기준/참고/watch 관점, 문서·section·앱 읽기 명령 항목과 확인된 문서 watch 변화 기록을 맡는다; 용어는 documents/terms, 목차는 documents/outline-and-search를 따른다.

## 요구

### 목적과 항목

**[R1]** context는 제목·목적과 자료별 기준·참고·watch 관점 및 그 자료를 고른 이유를 함께 보여 주고 각 관점 목록은 비어 있어도 같은 순서로 구별한다.
- 이유: 목록만으로 자료가 판단에서 맡는 역할을 알 수 없다.
- 확인: context를 읽어 각 항목이 기준인지 배경인지 변화 확인 대상인지와 선택 이유를 확인한다; 화면 배치는 shell/design-system을 따른다.

**[R2]** context 항목은 저장 version이 있는 문서 전체·그 section·앱의 읽기 명령만 대상으로 하며 프로젝트 폴더·미추적 파일·쓰기나 바깥 효과 명령은 허용하지 않는다.
- 이유: 자료 선택이 원본 접근이나 업무 변경 허락이 되어서는 안 된다.
- 확인: 각 허용 대상을 추가하고 미추적 파일·앱 쓰기 명령 추가가 거절되는지 확인하며 명령 효과는 apps/blueprint를 따른다.

**[R3]** 같은 문서는 여러 context에 다른 관점으로 들어갈 수 있고 한 context에서 문서 전체와 section은 별개 대상으로 다룬다.
- 이유: 자료 하나가 목적마다 다른 역할을 가질 수 있다.
- 확인: 같은 문서를 두 context의 기준과 참고로 넣고 한 context에는 전체와 section을 각각 다른 관점으로 넣어 읽는다.

**[R4]** context 항목은 최신 문서 판을 따라 읽되 실제 읽기 결과와 전달 근거는 그때 선택한 고정 판으로 남기며 항목별 옛 판 고정 옵션은 제공하지 않는다.
- 이유: 현재 자료 선택과 이미 판단한 근거를 구분한다.
- 확인: 새 문서 판 후 항목은 최신을 가리키지만 이전 읽기 근거는 당시 고정 판이며 부분 읽기는 documents/outline-and-search를 따른다.

### 편집과 조회

**[R5]** 사람과 허용된 Context Engineer는 context 생성·제목과 목적 변경·항목 추가·관점과 이유 변경·항목 제거·보관과 해제를 개별 동작으로 할 수 있다.
- 이유: 되돌릴 수 있는 context 편집마다 별도 제안을 강제할 필요는 없다.
- 확인: 각 변경이 적용되고 동시 편집 충돌은 기존 변경을 덮지 않으며 agent 편집 범위·revert는 lophn-agent/roles/context-engineer와 lophn-agent/revert를 따른다.

**[R6]** coding agent의 context 구성 변경은 제안으로만 남기고 사람이 적용하며 이 권한을 Context Engineer의 직접 편집 권한과 혼동하지 않는다.
- 이유: 외부 구현 agent가 사람의 읽기 관점을 바꾸는 통로가 아니어야 한다.
- 확인: coding agent의 직접 항목 변경은 거절되고 제안만으로 구성은 바뀌지 않는다.

**[R7]** context 항목 제거나 context 보관은 대상 문서·앱·용어 정의를 변경하지 않으며 보관 동안 문서 watch 검사는 멈춘다.
- 이유: 관점 정리를 자료 삭제나 앱 변경으로 취급하지 않는다.
- 확인: 항목을 빼고 context를 보관해도 문서 판과 앱 동작이 그대로이고 보관 중 watch 변화는 기록하지 않는다.

**[R8]** 문서가 직접 항목으로 들어간 context와 프로젝트 문서가 직접 항목으로 들어간 context를 역조회할 수 있으며 별도의 프로젝트-context 연결을 만들지 않는다.
- 이유: 이미 있는 항목과 따로 관리하는 연결이 서로 어긋나지 않게 한다.
- 확인: 프로젝트 문서를 context에 넣고 빼면 관련 목록이 그 항목에서 계산되며 같은 context의 다른 문서도 platform/identity 범위 밖이면 본문을 읽지 못한다.

### watch

**[R9]** 최신 판에서 항목 section key가 사라지면 항목은 그대로 소실로 표시하고 비슷한 제목·본문의 section으로 몰래 바꾸지 않는다.
- 이유: 판단 근거의 대상을 유사도로 바꿔치기하면 안 된다.
- 확인: section 이름을 바꾼 뒤 옛 항목은 소실이며 사람이나 Context Engineer가 새 대상을 명시해야 바뀐다; key 규칙은 documents/addressing을 따른다.

**[R10]** 문서 전체 watch는 내용 변화, section watch는 같은 key 본문 변화·section 추가·소실을 전후 고정 판과 대상 부분의 근거로 확인한다.
- 이유: notification에서 실제 무엇이 바뀌었는지 다시 읽어야 한다.
- 확인: 전후 본문 hash 차이나 성공 추출의 소실을 확인하면 비교 판이 남고 제목만 바뀌어 본문이 같으면 내용 변화로 꾸미지 않는다.

**[R11]** 추출 미완료·실패·비교 의미를 알 수 없는 format module 변경은 watch 미확인으로 표시하고 확인된 변화로 기록하지 않는다.
- 이유: 구조를 모르는데 section이 없어졌다고 말해서는 안 된다.
- 확인: extractor를 실패시키거나 비교 규칙을 바꾸면 미확인 이유가 보이고 나중에 재추출해 확인한다.

**[R12]** 같은 context 항목과 같은 새 판의 watch 변화는 한 번만 기록하고 구성 변경·보관 후에는 예전 계산을 적용하지 않는다.
- 이유: 늦은 비교나 중복 재전달로 오래된 notification을 만들지 않는다.
- 확인: 비교 중 항목 관점·대상을 바꾸거나 보관하면 낡은 결과가 거절되고 같은 결과 재전달은 한 기록이다; notification은 platform/notifications를 따른다.

**[R13]** 앱 읽기 명령 항목의 watch 관점은 자동 호출이나 문서 watch 변화 기록을 만들지 않는다.
- 이유: 앱 read를 실행할 허락과 반복 판단의 계기는 별도이다.
- 확인: 앱 항목을 watch로 넣어도 자동 invocation이 생기지 않고 Operator 호출 범위는 lophn-agent/roles/operator를 따른다.

### 내보내기

**[R14]** 사람은 context의 목적·관점별 항목·선택 이유·읽은 고정 판 참조와 용어를 export할 수 있다.
- 이유: 책임 범위와 쓰는 말을 다른 도구나 사람에게 전해야 한다.
- 확인: export에서 현재 항목과 고정 참조를 확인하고 glossary는 documents/terms를 따르며 없는 하위 context·관계 지도나 권한 밖 본문을 포함하지 않는다.

## 열린 질문

- documents/contexts#Q1 context 분할·병합을 실제 동작으로 추가할까.
- documents/contexts#Q2 context export의 파일 형식과 고정 판 참조 포함 범위를 어떻게 정할까.
- documents/contexts#Q3 상위 context·용어 상속·최대 3단 구조를 추가할까.
- documents/contexts#Q4 문서 사이 영향·근거 간선을 기록하는 contract를 추가할까.
- documents/contexts#Q5 context 목차에 문서·context 관계 간선과 related context를 넣을까.
- documents/contexts#Q6 확정한 관계로 관련 context를 탐색하게 할까.
- documents/contexts#Q7 watch section rename 자동 추적과 이력의 같은 대응 계산을 유지할까.
- documents/contexts#Q8 context 항목의 기준/참고/watch를 깊이 설정과 묶을까.
- documents/contexts#Q9 새 saved view·series 채택이 context의 View·Series 항목 금지를 바꿀까.

## 버린 것

- section 의미 대응 제안·확정·유사도 queue·watch rename 자동 추적은 버렸다; 같은 key의 변화와 소실만 확인한다.
- 상위 context·3단 hierarchy·용어 상속·항목별 깊이는 버렸다; context는 평면이며 읽기량은 요청에서 고른다.
- 영속 Section·Annotation·section term 연결과 관계 지도를 context 상태로 두던 체계는 버렸다; 문서·context 관계는 열린 질문으로만 둔다.
- index 문서를 context 항목에서 제외하는 규칙은 버렸다; index 자체가 문서가 아니다.
