---
type: requirements
concerns: [documents/formats]
---
# documents/formats

지원 format과 저장 검사·결정적인 section 추출·격리 module 실행을 맡으며 기존 문서의 저장 계약은 최신 version의 정확한 format 계약을 따른다.

## 요구

### 지원 형식

**[R1]** 기본 색인 format은 document이고 내장 format은 document·pdf·image·data를 제공한다.
- 이유: 이전 lophn의 document@1 계약을 이어 가면서 비텍스트 원문도 보존한다.
- 확인: format 목록에서 네 이름과 작성 안내를 읽고 Markdown·HTML은 기본 document로 선택된다.
- 의도: documents#I3, documents#I2

**[R2]** document는 Markdown의 text/markdown·text/x-markdown, HTML의 text/html, XHTML의 application/xhtml+xml, plain text의 text/plain을 읽기·검색 대상으로 지원한다.
- 이유: 실제로 지원했던 MIME 유형을 두 개로 축소하지 않는다.
- 확인: 각 MIME 유형을 저장하고 정규화한 본문을 읽고 검색하며 plain text에는 없는 heading을 만들지 않는다.
- 의도: documents#I3

**[R3]** pdf는 application/pdf, image는 이미지 MIME 유형, data는 그 밖의 MIME 유형의 원문 저장·version·읽기를 지원하되 첫 판에서 기본 section 추출은 하지 않는다.
- 이유: section이 없는 형식과 index 실패를 구별한다.
- 확인: PDF·이미지·알 수 없는 data를 저장해 원문은 읽고 section 추출 미지원 표시를 확인한다.
- 의도: documents#I2

### 검사와 저장 계약

**[R4]** format을 명시한 저장은 같은 format의 저장 전 검사에서 error가 있으면 새 version을 거절하고 warning만 있으면 저장 결과에 경고를 남긴다.
- 이유: 정해진 형식이라는 주장을 검사하지 않고 저장해서는 안 된다.
- 확인: 같은 입력의 사전 검사와 저장 검사가 같은 오류를 반환하며 오류 위치·설명을 읽고 version이 늘지 않는지 확인한다.
- 의도: documents#I7

**[R5]** format을 지정하지 않은 새 문서는 MIME 유형에 맞는 기본 format으로 원문을 보존하고 구조 검사 실패는 경고로 돌려주며 section 추출 가능 여부를 별도로 표시한다.
- 이유: 불완전한 구조를 원문 유실의 이유로 쓰지 않는다.
- 확인: 구조가 잘못된 미지정 내용을 저장하면 원문 판을 읽고 경고를 받으며 위험 경로나 접근 권한 실패를 경고로 낮추지 않는다.
- 의도: documents#I2, documents#I7

**[R6]** 지정 format 검사 실패는 이미 성공한 디스크 저장을 취소하거나 이전 파일 내용으로 바꾸지 않는다.
- 이유: 파일 저장과 version 확정이 별개의 완료이기 때문이다.
- 확인: 원본을 형식에 안 맞게 고쳐 저장하면 디스크 내용은 남고 version 실패만 표시된다; 파일 결과는 documents/file-tracking을 따른다.
- 의도: documents#I7, documents#I1

**[R7]** 기존 문서의 저장은 허용된 사람의 명시 format 변경이 없으면 최신 판의 정확한 format 계약을 따르고 변경한 규칙은 새 판에만 적용한다.
- 이유: lophn-agent/roles/operator의 저장 계약과 고정 근거의 읽기 구조를 지킨다.
- 확인: format을 생략한 후속 저장은 같은 검사를 받고 옛 판은 새 규칙이 아니라 당시 정확한 module로 다시 읽는다.
- 의도: documents#I7, documents#I2

**[R8]** 지원 format마다 MIME 유형·구조·metadata 요구·template·guide·예시·vocabulary와 사전 검사 결과를 제공하며 검사만으로 version을 만들지 않는다.
- 이유: 사람과 agent가 실패한 저장을 반복하기 전에 틀을 배울 수 있어야 한다.
- 확인: format을 고르고 안내·예시를 읽어 검사한 뒤 오류의 파일·줄·열 위치를 확인해도 문서 판 수는 그대로다.
- 의도: documents#I7

### 추출 규칙

**[R9]** document의 추출용 텍스트는 UTF-8 decoding·BOM 제거·LF 줄바꿈·Unicode NFC 정규화를 순서대로 적용하되 저장 원문 바이트는 바꾸지 않는다.
- 이유: 같은 원문은 같은 구조로 읽히고 원문 보존은 정규화와 분리되어야 한다.
- 확인: BOM·CRLF·분해형 한글 입력의 추출 결과를 대조하고 원문 다운로드는 원래 바이트인지 확인한다.
- 의도: documents#I3, documents#I2

**[R10]** Markdown의 ATX 1~6단과 setext heading을 section으로 추출하되 YAML front matter·fenced code·HTML pre 안의 heading 모양은 제외한다.
- 이유: 문서 구조와 코드·metadata를 혼동하지 않는다.
- 확인: 각 heading 형태와 제외 구역을 함께 넣어 실제 heading만 목차에 생기는지 확인한다.
- 의도: documents#I3

**[R11]** section 중첩은 heading level을 따르고 level을 건너뛰면 가장 가까운 낮은 level 아래에 두며 section 범위는 자기 heading부터 같거나 높은 level의 다음 heading 직전까지다.
- 이유: 누락된 level을 가짜 section으로 만들지 않는다.
- 확인: 1단 뒤 3단 heading과 그 뒤 2단 heading으로 목차 부모·본문 범위를 확인한다.
- 의도: documents#I3

**[R12]** 문서에 h1이 정확히 하나면 문서 제목으로 쓰고 section에서 빼며 첫 heading 앞 본문은 서문 section으로 제공한다.
- 이유: 문서 제목을 목차 항목으로 중복하지 않으면서 서문도 부분 읽기할 수 있어야 한다.
- 확인: 단일 h1·여러 h1·서문이 있는 문서를 각각 추출해 제목과 section 구성을 확인한다.
- 의도: documents#I3

**[R13]** HTML·XHTML은 원본 h1~h6을 추출하고 script·style·template·nav·textarea·head·title·pre·hidden·aria-hidden=true 내부는 section 본문에서 제외하며 스크립트나 동적 DOM을 실행하지 않는다.
- 이유: 구조 추출의 결정성과 격리를 지키고 숨긴 UI를 자료 본문으로 오인하지 않는다.
- 확인: 스크립트가 추가할 heading과 숨긴 heading은 목차에 없고 같은 원본에서 항상 같은 결과가 나온다.
- 의도: documents#I3

**[R14]** HTML은 heading의 id를 우선 anchor로 쓰고 감싸는 section의 id는 그 안 첫 heading에만 쓰며 유일한 h1이 없으면 HTML title을 문서 제목으로 쓴다.
- 이유: 하나의 명시 anchor를 여러 section에 복제하지 않는다.
- 확인: 감싸는 section 안에 두 heading을 넣어 첫 heading에만 anchor가 적용되고 title의 제목 fallback을 확인한다.
- 의도: documents#I3, documents#I7

**[R15]** section 이름은 Markdown heading 끝의 {#custom-id} 명시 anchor 표기와 HTML id를 우선하고 없으면 소문자 제목에서 문자·숫자·공백·하이픈만 남겨 공백을 하이픈으로 바꾼다.
- 이유: 한글을 보존하며 읽을 수 있는 section 주소를 결정적으로 만든다.
- 확인: 명시 anchor와 한글 제목이 유지되고 A & B는 a--b가 된다; 주소 해석은 documents/addressing을 따른다.
- 의도: documents#I3, documents#I7

**[R16]** 자동 section 이름이 비면 section으로 쓰고 같은 부모에서 겹치면 문서 순서대로 -2·-3을 붙이며 명시 anchor의 중복은 구조 오류로 처리한다.
- 이유: 목차의 부분 참조가 하나의 대상을 가리켜야 한다.
- 확인: 기호만 있는 제목·같은 제목·중복 명시 anchor로 각각 fallback·suffix·오류를 확인한다.
- 의도: documents#I3, documents#I7

**[R17]** 추출 결과는 제목·section 경로·heading level·anchor·계층·본문 범위·문자 수와 heading을 뺀 본문 hash를 제공한다.
- 이유: 작은 부분 읽기와 내용 변화 비교를 같은 결정적 구조로 해야 한다.
- 확인: 제목만 바꾸면 본문 hash는 같고 본문을 바꾸면 달라지며 목차 통계·읽기 범위는 documents/outline-and-search로 확인한다.
- 의도: documents#I3, documents#I6

### 격리와 보존

**[R18]** format 검사·추출 module은 같은 입력과 정확한 module 묶음에서 같은 출력을 내고 파일·network·시간·난수·secret·환경 변수·subprocess 접근 없이 core 밖 격리 환경에서 실행하며 한도를 넘는 실행만 종료한다.
- 이유: format 코드가 플랫폼 권한을 얻거나 무관한 요청을 멈추지 않게 한다.
- 확인: 각 금지 접근 module이 실패하며 같은 입력 반복 결과가 같고 core가 임의 module을 직접 import하지 않는다.
- 의도: documents#I7

**[R19]** format module을 사용 가능하게 하기 전에 입력·기대 출력 fixture 전부를 통과시키고 추출 결과의 크기·유일 이름·범위·부모 존재·비순환을 검사한다.
- 이유: module의 주장만으로 잘못된 목차를 받아서는 안 된다.
- 확인: fixture 하나 실패나 순환 부모·잘못된 범위 출력 module은 사용되지 않는다.
- 의도: documents#I7, documents#I3

**[R20]** 옛 version이 참조한 정확한 module을 보존하고 module 누락·실행 실패·미지원 추출을 구별하여 원문 읽기와 실패 이유를 제공하되 새 module로 몰래 대체하거나 section을 추측하지 않는다.
- 이유: 같은 고정 근거가 나중에 다른 구조를 뜻하면 안 된다.
- 확인: module을 누락시키거나 extractor를 실패시키면 옛 판의 원문은 읽고 section 오류가 드러나며 대체 추출은 하지 않는다.
- 의도: documents#I2, documents#I3

## 열린 질문

## 버린 것

- 독립 format 규칙 번호·형식 준수 관계 간선과 옛 index를 정본으로 계속 보존하는 체계는 버렸다; 정확한 module은 version에 보존하고 목차는 derived로 재생성한다.
- 묵시 format 검사 실패에 경고만 내고 원문 version을 만들지 않던 규칙은 버렸다; 구조를 읽지 못해도 원문을 남긴다.
- 설계 문서 전용 format, 문서 실행 capability, slide·data report 추출, 사람이 추가하는 format module은 첫 판에서 뺐다; 일반 Markdown과 내장 module의 정적·격리 view만 둔다.
- 동적 DOM 추출은 뺐다; 원본 HTML만 추출한다.
