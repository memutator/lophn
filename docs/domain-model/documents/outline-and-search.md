---
type: domain-model
concerns: [documents/outline-and-search]
---
# documents/outline-and-search

project 폴더 파일의 outline·부분 읽기·keyword search 결과의 값을 정의한다. 모두 요청 때 지금 파일에서 계산하는 값이고 ledger entity도 저장 표도 없다. 이 concern이 정의하는 ID entity는 없다.

## 입력 파일 (값)

계산은 project의 파일 하나를 읽은 바이트에서 시작한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `project` | `prj` ID | 아니오 | → documents/projects | |
| `path` | string | 아니오 | project 폴더 기준 상대 경로, `/` 구분, `..` 금지, 폴더 밖을 가리키는 symlink 금지 | |
| `content_hash` | sha256 | 아니오 | 읽은 바이트의 hash | cursor가 묶는 근거 |
| `format` | `markdown \| unsupported` | 아니오 | 확장자로 고른다: `.md` → markdown | 형식 지원은 아래 OutlineParser |

추출용 텍스트는 UTF-8로 읽고 BOM을 떼고 줄바꿈을 LF로, 문자를 Unicode NFC로 맞춘 것이다. 줄 번호와 codepoint 수는 이 텍스트 기준이다. 원본 바이트는 바꾸지 않는다.

## OutlineParser (계약)

형식마다 하나. 코드의 한 곳에 두고 문서 탭의 Outline 목록, context의 `outline` kind, 부분 읽기, 검색의 section 판정이 모두 이것을 부른다.

| 항목 | 규칙 |
|---|---|
| 입력 | 추출용 텍스트 |
| 출력 | `DocumentOutline`; 구조 error가 있어도 읽을 수 있는 만큼의 outline |
| 성질 | 결정적이다: 같은 텍스트면 같은 출력. 파일·network·시계·난수·ledger를 읽지 않는다. 저장하지 않는다 |
| 등록 | format 하나에 parser 하나. 없는 format은 `unsupported` |
| markdown | heading 추출, tree 규칙, section key는 → documents/formats |

## DocumentOutline (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `title` | string | 예 | 문서 제목(markdown은 유일한 h1) | |
| `line_count` | integer | 아니오 | `>= 0` | |
| `characters` | integer | 아니오 | Unicode codepoint 수 `>= 0` | |
| `sections` | Section[] | 아니오 | 원문 순서 | 빈 목록은 제목이 없는 문서 |

## Section (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | string | 아니오 | 한 outline 안에서 유일; → documents/formats | |
| `title` | string | 아니오 | heading의 표시 제목 | |
| `parent` | string | 예 | 같은 outline의 key; 비순환 | |
| `position` | integer | 아니오 | `>= 0`; 원문 순서 | |
| `level` | integer | 아니오 | 0..6; 0은 첫 heading 앞 본문 | |
| `own_range` | LineRange | 예 | 자체 본문; 자체 본문이 없으면 null | |
| `subtree_range` | LineRange | 아니오 | heading 줄부터 하위 section 끝까지 | |
| `characters` | integer | 아니오 | 자체 본문의 codepoint 수 `>= 0` | |
| `estimated_tokens` | integer | 아니오 | `ceil(characters / 3)`; 실제 model token 수가 아님 | |
| `body_hash` | sha256 | 아니오 | 정규화한 자체 본문(heading 제외)의 hash | |
| `children_count` | integer | 아니오 | 직접 자식 수 `>= 0` | |

section에는 독립 ID가 없다. `(project, path, key)`가 주소이고, 이름을 바꾸면 옛 key는 사라진 것이다.

## LineRange (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `start_line` | integer | 아니오 | 1-based, `>= 1` | |
| `end_line` | integer | 아니오 | inclusive, `start_line` 이상, `line_count` 이하 | |

빈 본문은 null로 표현하며 `1..0` 같은 거짓 범위를 만들지 않는다.

## OutlinePage (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `status` | `ready \| unsupported \| unreadable` | 아니오 | enum | 지원하지 않는 형식과 읽지 못한 파일을 빈 `ready`와 구별 |
| `content_hash` | sha256 | 조건부 | `ready`면 필수 | 이 응답이 읽은 파일 |
| `entries` | Section[] | 아니오 | depth와 예산 안의 section; 본문 제외 | `ready`가 아니면 빈 목록 |
| `hidden_children` | `{key: string, count: integer}[]` | 아니오 | depth나 예산에 가려진 자식 수 | |
| `complete` | boolean | 아니오 | 잘렸으면 false | |
| `next_cursor` | string | 예 | complete면 null | |

## ReadResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `project`, `path` | | 아니오 | 입력 파일 | |
| `content_hash` | sha256 | 아니오 | 읽은 파일 | |
| `section` | string | 예 | 요청한 key; 줄 범위 요청이면 null | |
| `status` | `whole \| found \| missing \| unsupported \| unreadable` | 아니오 | `whole`은 section도 범위도 지정하지 않은 전체 | `missing`은 읽은 파일에 key가 없음 |
| `include_children` | boolean | 아니오 | 요청에서 명시 | |
| `range` | LineRange | 예 | 실제 돌려준 줄; 한 줄이 12,000을 넘어 쪼개면 줄 안 위치도 `next_cursor`가 가진다 | |
| `text` | string | 예 | `found`·`whole`일 때; 출력 redaction 적용 | |
| `complete` | boolean | 아니오 | 요청 대상 전체가 반환됐는지 | |
| `next_cursor` | string | 예 | complete면 null | |
| `redacted` | boolean | 아니오 | 출력 redaction 여부 | |

## Cursor (값)

호출자에게는 불투명한 문자열이다. 안에는 아래가 든다.

| 종류 | 담는 것 |
|---|---|
| outline | `project, path, content_hash, depth, 예산, 다음 section position` |
| read | `project, path, content_hash, section 또는 줄 범위, include_children, 다음 codepoint 위치` |
| search | `project, 폴더 조건, 검색어, 마지막으로 돌려준 (path, line)` |

outline·read cursor를 풀었을 때 지금 파일의 `content_hash`가 다르거나 요청 조건이 다르면 `conflict`다. search cursor는 조건이 다르면 `invalid_input`이다.

## SearchQuery (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `project` | `prj` ID | 아니오 | 한 project | |
| `text` | string | 아니오 | 공백만 있는 문자열 금지, 줄바꿈 금지 | 검색어 |
| `folder` | string | 예 | project 안 상대 폴더 | 이 폴더 아래만 |
| `limit` | integer | 아니오 | 1..50, 기본 50 | |
| `cursor` | string | 예 | search cursor | |

## SearchHit (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `path` | string | 아니오 | project 기준 상대 경로 | |
| `section` | string | 예 | 일치한 줄을 가진 section의 key; section을 못 만든 파일이면 null | |
| `line` | integer | 아니오 | 일치한 줄(1-based); 한 줄의 여러 일치는 하나로 | |
| `title` | string | 아니오 | section 제목; 없으면 문서 제목, 그것도 없으면 파일 이름; 출력 redaction 적용 | |
| `snippet` | string | 아니오 | 일치한 부분을 포함한 한 줄 중 최대 200 codepoint; 출력 redaction 적용 | |
| `match_in` | `title \| body` | 아니오 | heading 줄이면 `title` | |

## SearchPage (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `hits` | SearchHit[] | 아니오 | 경로 순, 같은 경로는 줄 순 | 점수 없음 |
| `complete` | boolean | 아니오 | 훑기를 끝까지 했고 더 없을 때 true | |
| `next_cursor` | string | 예 | complete면 null | |
| `skipped` | `{path: string, reason: string}[]` | 아니오 | 읽지 못해 건너뛴 파일; 최대 20개와 `skipped_count` | |
| `skipped_count` | integer | 아니오 | 건너뛴 전체 수 | |

`hits`가 비었다고 해서 문서에 없다는 증명이 아니다. `skipped_count`가 0일 때만 훑은 범위 안에서 없다고 말한다.

## ledger 표

없다. 이 concern은 command·event·ledger 표·derived store를 만들지 않는다. outline·section·검색 색인·요약·처리 cursor는 어디에도 저장하지 않는다.

## 정책

- **읽기 입력.** project, 상대 경로, section key 또는 줄 범위, include_children, 크기 한도, cursor를 받는다. 매 호출이 파일을 새로 읽는다. 호출 사이에 파일 내용을 기억하는 cache를 두지 않는다.
- **결정성.** 같은 추출용 텍스트는 같은 DocumentOutline을 낸다. 모든 정렬은 원문 순서나 경로 순서로 정해지고 시각·무작위·동점 처리에 기대지 않는다.
- **기본 읽기 예산.** outline은 2,000 estimated token에 depth 2, 본문은 한 번에 12,000 codepoint다. 초과 목록·본문은 `complete=false`와 cursor다. 한 줄이 12,000을 넘으면 codepoint 위치로 쪼갠다. 실제 model token 한도는 → lophn-agent/harness/prompt-assemble이다.
- **훑을 파일.** project 폴더 아래에서 확장자가 지원 format인 파일(지금은 `.md`)이다. `.gitignore` 규칙(project 폴더와 하위 폴더의 `.gitignore`, git이 없는 폴더에서도 같은 규칙)이 제외한 경로와 이름이 `.`로 시작하는 폴더 아래는 건너뛴다. 심볼릭 링크는 따라가지 않는다.
- **일치.** 검색어와 줄을 같은 NFC로 맞추고 Unicode case fold로 비교해 검색어가 줄 안에 연속으로 들어 있으면 일치다. 형태소 분석·어간·초성 검색·단어 경계는 없다. 줄 하나에서 일치가 여러 번이어도 hit은 하나이고 snippet은 첫 일치를 가운데에 둔다.
- **훑는 순서.** 경로 순으로 파일을 읽어 먼저 텍스트에서 일치를 찾고, 일치한 파일만 outline을 만들어 줄이 속한 section을 정한다. `limit`개를 채우면 거기서 멈추고 cursor를 준다. 검색어가 바뀌거나 요청이 취소되면 훑기를 멈춘다.
- **건너뛴 파일.** 읽기 실패, UTF-8로 읽을 수 없는 파일, 접근 불가는 `skipped`에 이유와 함께 넣는다. 검색은 이 때문에 실패하지 않는다.
- **권한·redaction.** 대상 project와 경로를 현재 scope로 확인하고 제목·snippet·본문을 내보낸다(→ platform/identity, platform/redaction). `skipped`와 건수로 scope 밖 파일의 존재를 새지 않는다.
- **읽기 오류.** 잘못된 범위·cursor·검색어는 `invalid_input`, project나 파일 없음은 `not_found`, 바뀐 파일에 묶인 cursor는 `conflict`, 읽기 실패는 `unavailable`이다. auth 오류는 → platform/identity이다. 지원하지 않는 형식은 오류가 아니라 `status=unsupported`다.

## 정할 것

- token 추정은 codepoint 수를 3으로 나눈 올림이며 model별 보정은 두지 않는다.
- 훑기의 한도(큰 project에서 걸리는 시간, 파일 하나의 최대 크기)는 실측 뒤 정한다.
- `body_hash`는 context의 section 변화 확인이 쓸지 documents/contexts가 정할 때까지 outline이 계산해 두는 값이다.
