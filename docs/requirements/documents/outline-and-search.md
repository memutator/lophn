---
type: requirements
concerns: [documents/outline-and-search]
---
# documents/outline-and-search

project 폴더 안 문서의 outline(제목 tree)과 부분 읽기, keyword search를 맡는다. 둘 다 저장하거나 색인하지 않고 요청이 올 때 지금 파일을 읽어 결정적으로 계산한다. 범위 검사는 platform/identity, 출력 redaction은 platform/redaction을 따르고, context의 `outline` kind가 이 outline을 쓰는 방식은 documents/contexts가 맡는다.

## 요구

### 목차와 부분 읽기

**[R1]** 문서의 outline은 그 파일을 읽을 때마다 제목 tree로 계산하며 저장·색인·cache하지 않는다.
- 이유: 파일이 바뀌었는지 따라가는 색인(재파생 queue, 지연 표시)이 가져오는 어긋남과 무게를 없앤다. 목차는 파일 하나를 한 번 훑으면 나온다.
- 확인: outline을 요청하기 직전에 파일을 고치면 고친 내용이 바로 보이고, lophn 저장소에 outline을 담은 표·파일이 없다.
- 의도: documents#I3

**[R2]** outline은 같은 파일 내용이면 언제 누가 몇 번을 요청해도 같은 결과를 낸다.
- 이유: 편집기의 Outline 목록과 agent가 읽은 목차가 어긋나면 서로의 근거가 되지 못한다.
- 확인: 같은 파일을 두 번 요청한 결과가 같고, 시각·난수·요청자에 따라 달라지지 않는다.
- 의도: documents#I3

**[R3]** 처음에는 Markdown(`.md`)만 outline을 만들고, 형식마다 parser를 붙이는 자리를 열어 둔다.
- 이유: 쓰는 문서가 거의 md이고, PDF 목차·page 같은 다른 형식은 필요해질 때 형식 하나씩 더한다.
- 확인: `.md` 파일의 outline이 나오고, 지원하지 않는 형식의 파일은 빈 목차가 아니라 형식 미지원으로 답한다; heading 추출 규칙은 documents/formats를 따른다.
- 의도: documents#I3

**[R4]** 문서 탭의 Outline 목록과 context의 `outline` kind는 같은 parser를 쓴다.
- 이유: parser가 둘이면 같은 파일이 화면마다 다른 목차를 내서 context의 근거를 편집기에서 확인할 수 없다.
- 확인: 같은 파일에서 두 곳의 목차가 section마다 같고, parser를 부르는 코드가 하나다; context의 kind는 documents/contexts, 목록의 모양은 shell/editor를 따른다.
- 의도: documents#I3

**[R5]** outline은 section마다 제목·깊이·부모·시작과 끝 줄·문자 수·estimated token·본문 hash·직접 자식 수를 준다.
- 이유: 읽을 부분의 크기와 바뀐 부분을 본문 전체 없이 고를 수 있어야 한다.
- 확인: section의 줄 범위로 읽은 본문 길이와 목차의 수치가 같고, 본문 hash는 그 section 본문이 같으면 같다.
- 의도: documents#I3

**[R6]** estimated token은 Unicode codepoint 수를 3으로 나눈 올림값이며 실제 model token 수라고 하지 않는다.
- 이유: 통로와 model에 독립적인 대략의 읽기 크기가 필요하다.
- 확인: 같은 한글 본문의 추정값이 model을 바꿔도 같고 실제 token 측정과 구별된다.
- 의도: documents#I3

**[R7]** outline 응답의 기본 예산은 2,000 estimated token에 깊이 2이며, 넘으면 이어 볼 위치를 주고 숨긴 자식 수를 보인다.
- 이유: 긴 문서도 목차만으로 다음 읽을 곳을 판단할 만큼만 돌려준다.
- 확인: 제목이 수백 개인 문서를 조회해 예산 안에서 끊기고, 이어 보면 빠짐·겹침 없이 전체 tree에 닿는다; 실제 model 입력 한도는 lophn-agent/harness/prompt-assemble을 따른다.
- 의도: documents#I3

**[R8]** 본문 읽기는 section 하나(자식 포함 여부 선택)나 1부터 시작하는 줄 범위를 고를 수 있고, 한 번에 최대 12,000 Unicode codepoint를 주며 돌려준 범위와 이어 읽을 위치를 함께 준다.
- 이유: 길거나 한 줄뿐인 문서도 필요한 만큼만 안전하게 읽어야 한다.
- 확인: 12,000자를 넘는 section과 한 줄짜리 긴 본문을 이어 읽어 빠짐·겹침 없이 끝까지 닿으며, 다른 section의 본문은 받지 않는다; 공통 tool 출력 상한은 lophn-agent/harness/tools를 따른다.
- 의도: documents#I3

**[R9]** 찾는 section이 지금 파일에 없으면 찾을 수 없음, 파일을 읽지 못하면 읽을 수 없음, 지원하지 않는 형식이면 형식 미지원으로 서로 다르게 답하고 비슷한 section으로 바꿔 답하지 않는다.
- 이유: 호출자가 잘못 부른 주소와 아직 알 수 없는 구조를 같은 빈 결과로 만들면 안 된다.
- 확인: 이름을 바꾼 section, 지운 파일, PDF 파일을 각각 조회해 세 가지 다른 이유를 받는다; section key 규칙은 documents/addressing을 따른다.
- 의도: documents#I3

**[R10]** 이어 읽기와 이어 보기의 위치(cursor)는 요청한 파일·대상·읽을 범위와 그 시점의 파일 내용에 묶고, 파일 내용이 그 사이 바뀌었거나 조건이 다르면 거절하고 다시 읽기를 요구한다.
- 이유: 바뀐 파일의 앞부분과 뒷부분을 한 근거로 섞으면 안 된다.
- 확인: 읽는 중에 파일을 고치면 이어 읽기가 거절되고 처음부터 다시 읽으면 고친 내용이 나오며, 다른 section이나 다른 파일에 쓴 cursor도 거절된다.
- 의도: documents#I3

**[R11]** outline과 부분 읽기는 project 폴더 안의 파일만 대상으로 하고, 폴더 밖을 가리키는 경로나 symlink는 거절한다.
- 이유: 문서를 읽는 길이 project 밖 파일을 읽는 길이 되면 안 된다.
- 확인: `../` 경로와 project 밖을 가리키는 symlink가 거절되고, 범위 검사는 platform/identity를 따른다.
- 의도: documents#I3

### 검색

**[R12]** keyword search는 색인 없이, 검색할 때 project의 md 파일을 훑어 찾는다.
- 이유: 색인(FTS5, trigram)은 파일 변경을 따라가는 일을 낳는다. 문서가 몇백 개 수준인 local project에서는 그때 훑는 것으로 충분하다.
- 확인: 검색 직전에 만든 파일의 단어가 바로 찾아지고, 파일을 지우면 바로 결과에서 사라지며, lophn 저장소에 검색용 표·파일이 없다.
- 의도: documents#I3

**[R13]** 훑을 때 `.gitignore`가 제외한 경로와 숨은 폴더(이름이 `.`로 시작하는 폴더)는 건너뛴다.
- 이유: 의존성 폴더, build 결과, `.git` 안의 파일이 결과를 덮으면 안 된다.
- 확인: `.gitignore`에 적은 폴더와 `.hidden/` 안의 md 파일에만 있는 단어는 찾아지지 않는다.
- 의도: documents#I3

**[R14]** 일치는 검색어 문자열이 본문이나 제목에 그대로 들어 있는지 보는 부분 문자열 일치이고, 대소문자를 구분하지 않으며 Unicode NFC로 맞춘 뒤 비교한다.
- 이유: 한국어는 어절 중간과 두 글자 단어도 찾아야 하는데, 가장 단순한 규칙이 색인 없이도 그것을 지킨다.
- 확인: 긴 한국어 단어의 가운데 두 글자와 세 글자, 영어 단어의 대문자 변형, 자모가 분리된 입력으로 찾은 같은 단어가 모두 일치한다.
- 의도: documents#I3

**[R15]** 검색 결과는 파일 경로·section(없으면 줄 위치)·제목·일치한 부분이 든 snippet을 주며, 경로 순서 다음 줄 순서로 정렬한다.
- 이유: 결과의 말을 실제 원문에서 바로 확인하고 열 수 있어야 한다.
- 확인: 결과 하나의 경로와 줄로 파일을 열면 snippet의 일치 부분이 거기 있다; 점수·순위는 두지 않는다.
- 의도: documents#I3

**[R16]** 검색은 한 project를 대상으로 하고 폴더 하나로 좁힐 수 있으며, 한 번에 최대 50개를 주고 이어 볼 위치를 준다.
- 이유: command palette에서 쓰는 검색이라 빨리 보이는 처음 몇 개가 중요하고, project 밖 문서는 접근 범위가 다르다.
- 확인: 일치가 50개를 넘는 검색어로 이어 보기를 해 빠짐·겹침 없이 끝까지 닿고, 조건이 다른 이어 보기 위치는 거절된다.
- 의도: documents#I3

**[R17]** 검색은 다른 일과 화면을 막지 않고, 검색어가 바뀌거나 닫히면 하던 훑기를 멈춘다.
- 이유: 입력할 때마다 도는 검색이 이전 검색을 끝까지 기다리게 하면 palette가 굳는다.
- 확인: 큰 project에서 검색어를 연달아 바꿔도 화면이 응답하고 마지막 검색어의 결과만 남으며 platform/responsiveness를 따른다.
- 의도: documents#I3

**[R18]** 읽을 수 없거나 형식이 맞지 않아 건너뛴 파일이 있으면 결과와 함께 그 수와 이유를 알리고, 빈 결과를 "문서에 없다"로 판정하지 않는다.
- 이유: 못 읽은 파일 때문에 못 찾은 것과 정말 없는 것을 구별해야 한다.
- 확인: 읽기 권한을 막은 파일에만 있는 단어를 찾으면 결과는 비지만 건너뛴 파일이 알려진다.
- 의도: documents#I3

**[R19]** 검색과 outline 결과의 제목·snippet·본문은 출력 전에 redaction을 거친다.
- 이유: 문서에 우연히 든 secret이 결과 목록을 통해 새면 안 된다.
- 확인: secret으로 등록한 값이 든 줄을 검색하면 snippet에서 가려지고, 규칙은 platform/redaction을 따른다.
- 의도: documents#I3

## 열린 질문

## 버린 것

- 파생 outline·section store와 재파생 queue, 500ms 합치기, 처리 지연·재생성 중 표시는 버렸다; 목차는 저장하지 않고 쓸 때 파싱한다.
- 고정 판의 outline, 판에 묶는 cursor, 판 선택은 버렸다; 문서 판이 없다. cursor는 파일 내용에 묶는다.
- section 이력과 두 판의 diff는 버렸다; 판이 없고 사람이 고친 이력은 git이 맡는다.
- 요약 cache와 서문 발췌, 낡은 요약 표시는 버렸다; 판에 묶인 요약을 만들 자리가 없다.
- saved view 저장·수정·삭제는 documents/contexts로 옮겼다; saved view는 context가 선언한 검색의 저장된 호출이다.
- context 목차 조회와 context 조건 검색은 버렸다; context 읽기는 documents/contexts가 맡는다.
- 자리 없는 문서 묶음과 자리별 문서 목록, 전체 목차의 context 수·활동·앱 수 통계는 버렸다; 문서는 project 폴더의 파일뿐이고 project 밖 전체 개요를 두지 않는다.
- 보관 문서·보관 자리 제외와 해제 뒤 재반영은 버렸다; 문서 보관이 없고 검색은 `.gitignore`와 숨은 폴더만 거른다.
- SQLite FTS5, trigram, 3글자 미만 LIKE 분기, 순위 점수, 요약·주제 텍스트 검색은 버렸다; 검색은 훑으며 하는 부분 문자열 일치다.
- 전체 목록·자리 목록·context 목록의 예산(1,500·3,000)과 정렬 cursor는 버렸다; 그 목록들이 없다.
