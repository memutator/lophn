---
type: requirements
concerns: [documents/outline-and-search]
---
# documents/outline-and-search

프로젝트·앱·context·문서의 outline과 full-text search, 고정 판의 단계적 부분 읽기·이력·diff, index 지연 표시와 문서 조건을 저장하는 saved view를 맡는다; 범위 검사는 platform/identity, 출력 redaction은 platform/redaction을 따른다.

## 요구

### 목차와 부분 읽기

**[R1]** 전체 목차에서 프로젝트·앱·자리 없는 문서·context를 고르고 문서 outline과 필요한 section·본문 범위로 단계적으로 펼칠 수 있으며 목록에 본문을 함께 싣지 않는다.
- 이유: 필요한 자료에 적은 token으로 닿는 것이 제품 가치다.
- 확인: 전체 목차부터 section 하나까지 내려가도 다른 section의 본문을 받지 않고 제목·짧은 설명·읽을 참조만으로 다음 대상을 고른다.
- 의도: documents#I4

**[R2]** 전체 목차 조회는 context의 목적·기준 항목 수·참조 앱 수·활동과 자리별 문서 수·자리 없는 문서 수를 제공하되 사람 화면은 지금 필요한 자료와 행동만 기본으로 보여 주고 통계와 활동은 펼쳐 보며 문제·질문·approval request의 대기 상황은 소유 concern의 읽기를 가리킨다.
- 이유: 탐색 진입점에서 자료 규모와 할 일을 구별한다.
- 확인: 자료 수와 context 구성이 목록에 반영되고 대기 사항은 problems/grouping·lophn-agent/questions·platform/approvals의 상태와 대조한다.
- 의도: documents#I4

**[R3]** 자리 목록은 문서 이름·제목·format·선택한 최신 판·갱신 시각·요약이나 발췌·section 수를 제공하되 사람 화면은 제목·지금 필요한 상태만 기본으로 보여 주고 나머지는 펼쳐 보며 폴더 행에서 파일 트리를 열고 agent 목록에는 실제 경로·디스크 상태를 넣지 않는다.
- 이유: 소속 목록과 현재 파일 관측을 섞지 않는다.
- 확인: 사람 목록의 폴더 아래 파일은 중복 나열되지 않고 agent 응답에 절대 경로가 없으며 앱 자리에서는 apps/blueprint의 읽을 구조를 가리킨다.
- 의도: documents#I4, documents#I3

**[R4]** context 목차 조회는 목적과 기준·참고·watch 순서의 항목·선택 이유·선택 판·읽기 가능 여부와 빈 관점을 구별하여 제공하되 사람 화면은 목적·지금 필요한 항목과 읽기 가능 여부만 기본으로 보여 주고 나머지는 펼쳐 본다.
- 이유: 같은 자료를 왜 읽는지와 지금 읽을 수 있는지 알아야 한다.
- 확인: 세 관점 중 빈 관점이 있는 context를 조회해 순서와 항목 판을 확인하고 용어는 documents/terms를 따른다.
- 의도: documents#I5, documents#I4

**[R5]** 목록의 초기 기본 예산은 전체 1,500 estimated token, 자리·context 각각 3,000, 문서 outline 2,000과 depth 2이며 전체 목록은 활동 순, 자리·context는 갱신 순으로 시작하고 초과하면 cursor와 미완료 표시로 나눈다.
- 이유: 전체 본문 대신 다음 읽기를 판단할 만큼만 돌려준다.
- 확인: 큰 목록과 깊은 목차를 조회해 예산 초과 목록은 이어 볼 수 있고 숨긴 자식 수가 보이며 실제 model 입력 한도는 lophn-agent/harness/prompt-assemble을 따른다.
- 의도: documents#I4

**[R6]** estimated token은 Unicode codepoint 수를 3으로 나눈 올림값으로 표시하고 실제 model token 수라고 하지 않는다.
- 이유: 통로와 model에 독립적인 대략의 읽기 크기가 필요하다.
- 확인: 같은 한글 본문의 추정값이 model을 바꿔도 같고 실제 token 측정과 구별된다.
- 의도: documents#I4

**[R7]** 본문 읽기는 section과 자식 포함 여부·1부터 시작하는 줄 범위를 선택할 수 있고 기본 조각은 최대 12,000 Unicode codepoint와 반환 범위·이어 읽기 위치를 준다.
- 이유: 길거나 한 줄뿐인 문서도 안전하게 조금씩 읽어야 한다.
- 확인: 12,000자를 넘는 본문과 한 줄짜리 긴 본문을 이어 읽어 빠짐·겹침 없이 전체에 닿으며 공통 tool 출력 상한은 lophn-agent/harness/tools를 따른다.
- 의도: documents#I4

**[R8]** outline에서 선택한 판과 그 판의 section·범위·cursor는 이어 읽는 동안 유지하고 최신 판은 별도로 함께 표시한다.
- 이유: 새 판과 옛 판의 내용을 한 근거로 섞으면 안 된다.
- 확인: outline 조회 뒤 새 판을 저장해도 기존 cursor는 처음 판을 읽고 다른 판 cursor나 범위 재사용은 거절된다.
- 의도: documents#I4, documents#I2

**[R9]** 목록 cursor는 기준·정렬·검색 조건·읽기 범위와 결합하여 같은 기준으로 이어 보되 더는 안정된 기준을 유지할 수 없으면 충돌을 반환한다.
- 이유: 단순 offset은 중간 변경과 권한 변화에서 누락·중복을 만든다.
- 확인: 목록 중간에 항목을 추가·제거한 뒤 이어 보기를 해 기준을 지키거나 명시적으로 재조회를 요구하며 조건이 다른 cursor는 거절한다.
- 의도: documents#I4

### 검색

**[R10]** 첫 판의 전문 검색은 SQLite FTS5 keyword 검색으로 최신 반영 판의 section 제목·본문과 사용 가능한 요약·주제 텍스트를 검색하며 embedding 검색은 제공하지 않는다.
- 이유: 키워드 검색은 다시 만들 수 있고 의미 보강이 없어도 사용할 수 있다.
- 확인: 제목·본문·가용 요약으로 찾고 옛 판 본문만의 단어는 기본 검색 결과에 없으며 원문 보존은 documents/versions를 따른다.
- 의도: documents#I4

**[R11]** 한국어 부분 일치는 FTS5 trigram으로 검색하고 3글자 미만 검색어는 SQL LIKE 부분 일치 비교로 처리한다.
- 이유: 한국어 어절의 중간과 두 글자 단어도 찾을 수 있어야 한다.
- 확인: 긴 한국어 단어의 중간 3글자와 2글자 단어를 검색해 저장 본문의 일치 부분을 찾는다.
- 의도: documents#I4

**[R12]** 검색은 문자열과 자리·context·문서 형식 조건을 받으며 결과에 고정 판의 참조·section이나 본문 위치·제목·일치 snippet·순위 점수를 준다.
- 이유: 결과의 말을 실제 원문에서 확인할 수 있어야 한다.
- 확인: 조건에 맞는 결과의 일치 부분을 고정 판으로 열고 새 version 후에도 처음 결과의 근거를 읽는다; 범위와 redaction은 platform/identity·platform/redaction을 따른다.
- 의도: documents#I4, documents#I2

### derived와 지연

**[R13]** outline·section·검색·요약은 지우고 다시 만들 수 있는 ledger 밖 derived data이며 재생성·동일 cache 재파생은 문서 version이나 정본 변경 기록을 만들지 않는다.
- 이유: 찾기 자료를 원문이나 합의로 둔갑시키지 않는다.
- 확인: derived store를 삭제·재생성한 뒤 원문·version 수·문서 참조가 그대로이고 새 index 문서가 생기지 않는다.
- 의도: documents#I4, documents#I2

**[R14]** 검색·목록 응답은 반영한 판과 최신 판·처리 지연·재생성 중 여부·현재 범위의 실패나 미지원 누락을 제공하되 사람 화면은 결과 판단에 필요한 지연·누락만 기본으로 보여 주고 비교 판과 처리 상세는 펼쳐 보며 빈 검색을 원본 부재로 판정하지 않는다.
- 이유: 지연과 실제 불일치를 구분해야 한다.
- 확인: index 갱신을 실패시키면 빈 결과에도 뒤처짐과 누락 이유를 받고 최신 index의 실제 빈 결과와 구별된다.
- 의도: documents#I4

**[R15]** 선택한 고정 판의 outline·본문 읽기는 무관한 ledger 쓰기·전체 파일 scan·전체 index 반영을 기다리지 않고 필요하면 그 판을 직접 추출한다.
- 이유: 자료 확인이 전체 갱신의 완료 뒤로 밀리지 않게 한다.
- 확인: scan·index 큐를 지연시켜도 선택 판의 읽기가 먼저 응답하고 준비된 version만 읽는다; platform/responsiveness를 따른다.
- 의도: documents#I4, platform#I3

**[R16]** 같은 대상의 비동기 목차 재파생은 기본 500ms 동안 합치고 문서 이동은 출발·도착 목록과 관련 context를 모두 갱신한다.
- 이유: 빈번한 변경을 중복 처리하지 않으면서 소속 목록이 어긋나지 않게 한다.
- 확인: 500ms 안의 여러 변화는 합쳐 처리하고 이동·context 항목 제거 후 양쪽 자리 목록이 갱신되며 대상 불명 변화는 전체 목록을 무효화한다.
- 의도: documents#I4, documents#I3

**[R17]** 보관 문서·보관 자리는 기본 목록과 검색에서 제외하고 보관 해제 뒤 비동기로 다시 반영하되 고정 판 읽기는 유지한다.
- 이유: 자료를 숨기는 일과 근거를 잃는 일이 달라야 한다.
- 확인: 보관·해제와 반영 지연을 구별하고 보관 중 고정 판은 읽으며 documents/versions의 상태와 대조한다.
- 의도: documents#I4, documents#I2

**[R18]** 요약이 없으면 원문 서문 최대 200 Unicode codepoint 발췌를 요약과 구분하여 주고 낡은 요약에는 입력 판과 뒤처짐을 표시한다.
- 이유: 발췌나 옛 요약을 최신 합의로 오해하면 안 된다.
- 확인: 요약 없는 문서에는 발췌만, 새 판의 옛 요약에는 당시 판과 뒤처짐이 표시되며 이를 만들려고 agent run을 자동 시작하지 않는다.
- 의도: documents#I4

### section 이력과 diff

**[R19]** section 이력은 문서의 고정 판 사이 같은 section 이름으로 변경 없음·본문 수정·추가·소실을 계산하고 제목·hash·유사도로 의미상의 이름 변경을 추측하지 않는다.
- 이유: 새 domain model의 명시적 section key 원칙을 지킨다.
- 확인: section 이름 변경은 옛 key 소실과 새 key 추가로 나오고 유사 본문이 자동 대응되지 않으며 documents/addressing을 따른다.
- 의도: documents#I2, documents#I4

**[R20]** 이력을 중간 판부터 잘라도 첫 비교에는 직전 판을 함께 쓰고 소실된 section은 살아 있는 section 뒤에 표시한다.
- 이유: 잘린 첫 판의 모든 section을 새로 추가됐다고 오판하지 않는다.
- 확인: 3번 판부터 조회해 2번과의 변경을 얻고 소실 행은 살아 있는 항목 사이에 끼지 않는다.
- 의도: documents#I2, documents#I4

**[R21]** 두 고정 판의 전체 또는 선택 section을 줄 단위 diff로 비교하며 원문 복원이 안 되는 구간은 누락으로 표시하고 계산은 core 밖에서 한다.
- 이유: 본문 비교를 화면에서 재구현하거나 없는 내용을 채우지 않는다.
- 확인: 선택 판의 추가·삭제 줄을 확인하고 blob 접근 실패 구간은 누락이며 무거운 비교 중 UI가 응답한다.
- 의도: documents#I2, documents#I4

**[R22]** 성공적으로 section을 추출한 판에 요청 key가 없으면 찾을 수 없음, PDF·image·data처럼 section을 지원하지 않는 판은 형식 미지원, 추출 미완료·실패는 미확인으로 구별한다.
- 이유: 호출자의 잘못된 주소와 아직 모르는 구조를 같은 빈 결과로 만들지 않는다.
- 확인: 빈 추출·미지원·실패한 추출 각각에서 서로 다른 이유를 읽고 추정 section을 반환하지 않는다; 형식은 documents/formats를 따른다.
- 의도: documents#I4

### saved view

**[R23]** 사람은 문서 대상의 검색 문자열·프로젝트나 앱 자리·context 포함 여부·format·보관 여부·갱신 시점 조건과 정렬을 이름 붙여 saved view로 저장하고 수정·삭제·목록 조회할 수 있다.
- 이유: 반복해서 쓰는 선택 조건을 다시 입력하지 않게 한다.
- 확인: 문서 조건과 정렬을 저장해 다시 열고 같은 조건을 읽으며 tag·앱 DB·문서 관계처럼 정의하지 않은 조건은 받지 않는다.
- 의도: documents#I4

**[R24]** saved view를 열 때마다 저장한 조건으로 현재 허용된 문서 목록을 다시 만들고 고정 문서 사본이나 context 소유 관계를 만들지 않는다.
- 이유: view는 자료의 현재 선택이지 새로운 정본이다.
- 확인: 맞는 문서를 추가·보관한 뒤 view를 열면 목록이 바뀌지만 version·context 항목은 늘지 않고 권한 밖 문서는 나타나지 않는다.
- 의도: documents#I4

**[R25]** saved view 목록은 context 목차와 같은 작은 문서 목록과 pagination을 제공하되 glossary는 포함하지 않고 cache는 조건과 대상 고정 판 목록이 같을 때만 재사용한다.
- 이유: 저장 조건을 사람 정의나 낡은 목록으로 오해하지 않게 한다.
- 확인: 같은 조건을 열어 고정 판 참조로 읽고 새 판이나 조건 변경 뒤 낡은 cache가 재사용되지 않으며 glossary가 붙지 않는다.
- 의도: documents#I4

### 목차와 부분 읽기

**[R26]** 문서 outline은 section별 시작·끝 위치·본문 hash·문자 수·estimated token·부모와 자식 수를 제공한다.
- 이유: 읽을 부분의 크기와 비교 근거를 본문 전체 없이 고를 수 있어야 한다.
- 확인: section 범위로 읽은 본문 길이와 목차 통계를 대조하고 hash는 해당 고정 판의 본문에 대응하며 추출은 documents/formats를 따른다.
- 의도: documents#I4

## 열린 질문

- documents/outline-and-search#Q1 문서 제목 30자·요약 200자·최상위 section 설명 80자를 organizing model로 보강하는 별도 요청 contract를 둘까.
- documents/outline-and-search#Q2 embedding 검색을 추가할까.
- documents/outline-and-search#Q3 한국어 검색에 기존 trigram을 유지할까 다른 tokenizer로 바꿀까.
- documents/outline-and-search#Q4 token 추정치를 model별로 보정할까.
- documents/outline-and-search#Q5 기존 section rename 이력과 대응 chain을 새 key 원칙에 맞춰 어떻게 처리할까.
- documents/outline-and-search#Q6 saved view 없음이라는 기존 outline domain model을 이번 채택에 맞춰 확장해야 한다.
- documents/outline-and-search#Q7 단순 offset cursor와 갱신 시각 정렬을 새 기준 고정 규칙에 그대로 쓸까.
- documents/outline-and-search#Q8 saved view의 처음 지원 조건·정렬 범위를 이대로 둘까.

## 버린 것

- Home·플랫폼 전용 자리·기본 수신 자리의 index 문서와 이관 복구는 버렸다; 각 자리의 목록은 derived cache다.
- index를 Markdown·JSON 문서의 version으로 저장하고 재파생 완료를 ledger event로 남기던 규칙은 버렸다; derived 재생성은 정본 변경이 아니다.
- Annotation entity·상태·section 의미 보강 칸·event 기반 agent 작업 큐는 버렸다; 가용 요약은 입력 판을 가진 derived cache로만 읽는다.
- 의미상 section rename 추정·사람 대응표·대응 chain은 버렸다; 같은 key 비교와 소실 표시만 한다.
- 목록에서 단순 offset만으로 cursor를 만들고 index 대기 전체를 먼저 완료하던 규칙은 버렸다; 기준을 고정한 이어 보기와 선택 판 직접 추출을 쓴다.
