# 분류: documents/projects, formats, outline-and-search (2026-10-12)

lead가 직접 분류했다(worker 없음). 기준은 `../removed.md`, `../terms.md`, `../../docs-review.md` 10장의 오늘 결정이다.

- section은 context 계약으로만 다룬다.
- md 목차는 program이 그때그때 파싱하고 agent에게 주지 않는다.
- pdf·docs 목차는 agent가 만든다.
- 검색어 검색은 index 없이 한다.

새 ID는 req-1470부터 쓴다.

## projects

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| projects R1 | candidate | projects | project의 이름, 목적, 폴더, 폴더 설명을 등록하거나 바꾸는 일은 사람만 한다 | agent와 앱의 같은 요청은 거절된다 | "OS 폴더 선택기"는 화면 세부라 뺐다 |
| projects R2a | candidate | projects | project에는 폴더를 여러 개 연결할 수 있다 | 두 폴더를 연결한 project의 파일이 모두 그 project의 문서로 보인다 | |
| projects R2b | ask | projects | 폴더 없는 project를 둘지 | | 옛 이유("문서의 자리와 폴더 연결은 같지 않다")는 lophn 안에 문서를 저장하던 모델의 것이다 |
| projects R3 | drop-removed | | | | tracking(removed.md 1) |
| projects R4 | drop-removed | | | | tracking |
| projects R5 | drop-removed | | | | tracking. `.git`과 폴더 밖 symlink는 outline-and-search R11, R13 후보가 맡는다 |
| projects R6 | drop-removed | | | | tracking 미리보기 |
| projects R7 | drop-removed | | | | 겹친 폴더를 막은 이유가 tracking 경쟁이었다 |
| projects R8 | defer-other | shell | 사람이 project의 이름, 목적, 폴더를 본다 | | 화면 몫. 문서 수·tracking 패턴은 지운 것 |
| projects R9 | drop-conflict | | | | "저장 문서로 이동"하는 모델이 없다. agent의 파일 접근은 agent-tools 몫 |
| projects R10a | drop-detail | | | | 가장 깊은 등록 폴더 고르기는 겹친 폴더(지운 것)에 기댄다 |
| projects R10b | candidate | projects | 등록한 폴더를 디스크에서 찾을 수 없으면 사람이 다시 고를 때까지 다른 폴더로 짐작해 잇지 않는다 | 폴더를 옮기면 그 폴더는 찾을 수 없음으로 보이고, 사람이 새 자리를 고른 뒤에야 다시 이어진다 | |
| projects R11 | candidate | projects | 사람은 project의 이름과 목적을 바꾸고, project를 보관하거나 다시 꺼낼 수 있다. 보관해도 project 폴더의 파일은 그대로다 | 보관 뒤 폴더의 파일이 그대로 있다; 보관한 project를 다시 꺼내면 전과 같이 쓰인다 | 판 보존 부분은 지운 것 |
| projects R12 | drop-removed | | | | 자리 없는 문서 |

## formats

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| formats R1~R3 | ask | projects | lophn이 문서로 다루는 파일 형식 | | 옛 요구는 document(Markdown, HTML, XHTML, plain text), pdf, image, data였다. 오늘 결정에 "md, docs, pdf"가 나왔다 |
| formats R4~R8 | drop-removed | | | | 저장 검사가 판(version) 확정에 묶여 있다 |
| formats R9 | drop-detail | | | | 파싱 전 정규화 세부 |
| formats R10 | candidate | contexts | Markdown 목차는 ATX와 setext 제목만 제목으로 보고, YAML front matter와 fenced code 안의 제목 모양은 제목으로 보지 않는다 | 두 형태의 제목과, front matter·code block 안의 `#` 줄을 함께 둔 파일의 목차에 실제 제목만 나온다 | md 목차 parser의 보장 |
| formats R11 | candidate | contexts | 제목 tree는 level을 따르고, level을 건너뛰면 가장 가까운 위 level 아래에 둔다. 한 section은 자기 제목부터 같거나 높은 level의 다음 제목 직전까지다 | 1단 뒤 3단, 그 뒤 2단 제목을 둔 파일의 목차 부모와 section 본문이 이 규칙대로다 | 목차와 section kind가 같이 쓴다 |
| formats R12 | drop-detail | | | | h1 제목·서문 section 세부 |
| formats R13, R14 | drop-conflict | | | | program이 만드는 목차는 md뿐이다 |
| formats R15, R16 | drop-removed | | | | section을 이름으로 부르기(removed.md 1 addressing) |
| formats R17 | drop-removed | | | | agent에게 주는 md 목차(removed.md 1) |
| formats R18~R20 | drop-removed | | | | format module 장치와 옛 판의 module 보존 |

## outline-and-search

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| outline R1, R2 | drop-dup | | | | req-0002 |
| outline R3 | drop-dup | | | | req-0012 |
| outline R4 | drop-dup | | | | req-0003 |
| outline R5~R10 | drop-removed | | | | agent에게 주는 md 목차와 부분 읽기 |
| outline R11 | candidate | projects | project 파일을 읽는 기능은 project 폴더 밖을 가리키는 경로와 폴더 밖으로 나가는 symlink를 거절한다 | `../` 경로와 폴더 밖을 가리키는 symlink로 읽거나 찾으면 거절된다 | |
| search R12 | candidate | projects | 검색어 검색은 index 없이, 검색할 때 project의 Markdown 파일을 훑어 찾는다 | 검색 직전에 만든 파일의 단어가 바로 찾아진다; 파일을 지우면 바로 결과에서 사라진다 | "검색용 표가 없다"는 없는 것을 찾게 하는 확인이라 뺐다 |
| search R13 | candidate | projects | 훑을 때 `.gitignore`가 뺀 경로와 숨은 폴더는 건너뛴다 | `.gitignore`에 적은 폴더와 `.hidden/` 안의 파일에만 있는 단어는 찾아지지 않는다 | |
| search R14 | candidate | projects | 일치는 대소문자를 가리지 않는 부분 문자열 일치이고, Unicode NFC로 맞춘 뒤 비교한다 | 한국어 단어 가운데 두 글자, 영어 대문자 변형, 자모가 나뉜 입력이 같은 단어에 일치한다 | |
| search R15 | candidate | projects | 결과는 파일 경로, 줄 위치, 일치한 부분이 든 snippet을 주고, 경로 순서 다음 줄 순서로 늘어놓는다 | 결과의 경로와 줄로 파일을 열면 snippet의 일치 부분이 거기 있다 | section은 줄 위치로 바꿨다(section 부르기를 지움) |
| search R16 | candidate | projects | 검색은 한 project를 대상으로 하고 폴더 하나로 좁힐 수 있으며, 한 번에 최대 50개를 주고 이어 볼 위치를 준다 | 일치가 50개를 넘으면 이어 보기로 빠짐·겹침 없이 끝까지 닿는다; 조건이 다른 이어 볼 위치는 거절된다 | |
| search R17 | candidate | projects | 검색은 다른 일과 화면을 막지 않고, 검색어가 바뀌거나 검색을 닫으면 하던 훑기를 멈춘다 | 큰 project에서 검색어를 연달아 바꿔도 화면이 응답하고 마지막 검색어의 결과만 남는다 | |
| search R18 | candidate | projects | 읽지 못해 건너뛴 파일이 있으면 결과와 함께 그 수와 이유를 알린다 | 읽기 권한을 막은 파일에만 있는 단어를 찾으면 결과는 비고 건너뛴 파일이 알려진다 | |
| search R19 | ask | projects | 검색 snippet을 redaction할지 | | 사람이 자기 파일을 찾는 palette 검색이고 문서 탭은 원문을 그대로 보인다 |

## 개수

- candidate 14 (projects 12, contexts 2)
- ask 3
- drop-removed 11줄, drop-dup 3, drop-conflict 2, drop-detail 3, defer-other 1

※ 줄 수는 묶은 줄(R4~R8 같은)을 한 줄로 셌다.
