---
type: domain-model
concerns: [documents/formats]
---
# documents/formats

format module의 선언, 고정 참조, 검사·추출 결과와 저장 계약을 정의한다.

## FormatDeclaration (값)

ledger entity가 아닌 고정 코드 묶음의 선언이다. 별도 ID·상태·event는 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | 빈 문자열 금지 | 선택 이름 |
| `module_hash` | sha256 | 아니오 | 코드·의존·추출 규칙·실행 규약 전체의 소문자 64 hex 해시 | 정확한 묶음 |
| `media_types` | string[] | 아니오 | MIME media type, 중복 금지 | 받는 유형 |
| `guide` | `{text: string, examples: string[]}` | 아니오 | 작성 지침·예시 | |
| `validate` | function | 아니오 | 같은 입력에서 같은 정규화 FormatValidationResult | |
| `extract` | function | 예 | 없으면 `unsupported`; 있으면 결정적인 SectionExtractionResult | |

| 내장 이름 | media type | section 추출 |
|---|---|---|
| `document` | `text/markdown`, `text/html` | Markdown·원본 HTML 구조 |
| `pdf` | `application/pdf` | 없음; 원문 파일 |
| `image` | `image/*` | 없음; 원문 파일 |
| `data` | 그 밖의 media type | 없음; 원문 파일 |

`document`의 첫 묶음을 `document@1`이라고 배포할 수 있으나 독립 format version 번호는 ledger에 만들지 않는다. Version에는 항상 정확한 module_hash를 남긴다(→ documents/versions). 이름만으로 옛 판의 모듈을 선택하지 않는다.

## FormatRef (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | 선언 이름과 동일 | |
| `module_hash` | sha256 | 아니오 | 정확한 선언·묶음 해시 | |
| `explicit` | boolean | 아니오 | 지정 저장이면 true | 구조 오류가 저장을 막는지 |

## FormatDiagnostic (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `severity` | `error \| warning` | 아니오 | enum | |
| `code` | string | 아니오 | 모듈이 정의한 비어 있지 않은 code | |
| `message` | string | 아니오 | 비어 있지 않은 설명 | |
| `file` | string | 예 | ContentFile 상대 경로 → documents/versions | |
| `start_line` | integer | 예 | `>= 1`; file이 있을 때만 | |
| `end_line` | integer | 예 | start_line 이상; start_line과 함께 존재 | |
| `column` | integer | 예 | `>= 1`; start_line이 있을 때만 | |

## FormatValidationResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `input_hash` | sha256 | 아니오 | 실제 검사한 정규화 파일 목록 해시 | |
| `module_hash` | sha256 | 아니오 | 실제 실행한 module | |
| `status` | `passed \| failed` | 아니오 | error 없으면 passed | |
| `diagnostics` | FormatDiagnostic[] 또는 blob 참조 | 아니오 | 결과 전체; 큰 목록은 blob | |
| `error_count` | integer | 아니오 | `>= 0`; diagnostics와 일치 | |
| `warning_count` | integer | 아니오 | `>= 0`; diagnostics와 일치 | |

미지정 format의 구조 error는 저장 경고로 반환하되 실제 검사 결과는 failed로 남길 수 있다. 위험 경로·읽기 권한·입력 한도 검사를 구조 경고로 낮추지 않는다.

## SectionExtractionResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `input_hash` | sha256 | 아니오 | 추출한 실제 content_hash | |
| `module_hash` | sha256 | 아니오 | 정확한 실행 묶음 | |
| `status` | `ready \| unsupported \| unverified \| failed` | 아니오 | ready의 빈 sections와 unsupported를 구분 | |
| `title` | string | 예 | 원문에서 뽑은 제목 | |
| `text_hash` | sha256 | 조건부 | ready면 필수; 대표 텍스트 blob | |
| `sections` | ExtractedSection[] | 아니오 | ready에서만 결과; key 전역 유일 | |
| `failure_reason` | string | 조건부 | failed면 필수 | |

## ExtractedSection (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | string | 아니오 | 같은 추출 결과에서 유일; 조상 slug의 `/` 경로 | section key |
| `title` | string | 아니오 | heading의 표시 제목 | |
| `parent` | string | 예 | 같은 결과의 key; 순환 금지 | |
| `position` | integer | 아니오 | `>= 0`; 원문 heading 순서 | |
| `level` | integer | 아니오 | 1..6; `_preamble`은 0 | |
| `anchor` | string | 예 | 명시 anchor를 사용한 경우 | |
| `own_ranges` | `{start_line: integer, end_line: integer}[]` | 아니오 | 1-based inclusive; 대표 텍스트 안; 순서대로 비중첩; 자식 본문 제외 | |
| `subtree_range` | `{start_line: integer, end_line: integer}` | 아니오 | 모든 own_ranges 포함; 하위 section 포함 | |
| `characters` | integer | 아니오 | Unicode codepoint 수, `>= 0` | 읽기 길이 |
| `body_hash` | sha256 | 아니오 | 모듈 규약으로 정규화한 heading 제외 본문 | watch 비교 |

자식 뒤에 자체 본문이 있으면 own_ranges의 별도 범위로 표현한다. 자체 본문이 없으면 빈 목록을 허용한다.

## 정책

- **저장 계약.** 새 Document는 지정 format 또는 media type에 맞는 미지정 기본 format으로 시작한다. 기존 Document는 최신 Version의 FormatRef를 따른다. 허용된 사람의 명시 변경은 새 Version에만 남긴다. Operator는 format을 선언·덮어쓰지 않는다(→ documents/versions).
- **지정 검사.** explicit이면 구조 error가 `invalid_input`으로 저장을 막는다. warning은 통과하고 응답에 남긴다. module 누락·실행 중단은 `unavailable`이다. 이미 성공한 디스크 쓰기는 취소하지 않는다(→ documents/file-tracking).
- **미지정 검사.** 구조 error는 warning으로 원문 저장을 허용한다. 미지원 media type은 data로 원문을 남기고 section을 만들지 않는다. 필수 준비 실행 자체의 실패는 성공으로 꾸미지 않는다.
- **정규화.** document 추출용 텍스트만 UTF-8 decoding, BOM 제거, LF 줄바꿈, Unicode NFC를 적용한다. 원문 blob 바이트는 바꾸지 않는다.
- **Markdown heading.** ATX 1..6와 setext heading을 추출한다. YAML front matter·fenced code 안 heading 모양은 제외한다. 유일한 h1은 문서 제목으로 사용하고 section 트리에서 뺀다. heading 이전 본문은 `_preamble`이다.
- **HTML heading.** 원본의 h1..h6만 읽는다. script·style·template·nav·aria-hidden=true·textarea·head·title·pre·hidden 내부를 section 본문에서 제외한다. 유일한 h1이 없으면 HTML title을 문서 제목으로 사용한다. heading id 우선, 감싸는 section id는 그 안 첫 heading에만 적용한다. 동적 DOM·스크립트 실행 결과는 추출하지 않는다.
- **트리·범위.** level을 건너뛰면 가장 가까운 낮은 level의 heading이 parent다. subtree는 해당 heading부터 같거나 높은 level의 다음 heading 직전까지다. heading은 body_hash에서 제외한다. text 줄·hash 범위 규약은 module 묶음 안에 고정한다.
- **key.** Markdown의 heading 끝 `{#custom-id}`와 HTML의 명시 id를 우선한다. 자동 slug는 제목을 소문자로 바꾸고 문자·숫자·공백·하이픈만 남긴 뒤 공백을 하이픈으로 바꾼다. 비면 `section`, 같은 부모에서 중복이면 원문 순서대로 `-2`, `-3`을 붙인다. `A & B`는 `a--b`다. 조상 slug를 `/`로 잇는다. 중복 명시 key는 구조 error다.
- **결정성·격리.** 외부 import 없는 고정 묶음만 받는다. 파일·network·환경 변수·ledger·token·secret·subprocess·FFI·시간·난수·동적 코드 실행 접근을 금지하고 매 호출 새 환경을 쓴다. 같은 바이트와 module_hash가 다른 정규화 결과를 내면 설치하지 않는다. 한도 초과는 해당 실행만 종료한다(→ platform/security).
- **보존.** Version 참조가 남는 동안 정확한 module 묶음을 보존한다(→ platform/blob-store). 누락·추출 실패면 원문 읽기와 실패 표시를 제공하며 새 module로 대체하지 않는다.
- **출력 검사.** 플랫폼은 결과 크기, key 유일성, 범위 유효성, parent 존재·비순환을 검사한다. 검사만으로 Document·Version·ledger event를 만들지 않는다.

## 정할 것

- 내장 module만 시작할지 Package → apps/sdk로 추가 설치를 허용할지.
- 격리 실행 환경과 시간·메모리·입출력 한도. H6의 Deno 유지 결정과 → platform/security를 맞춘다.
- 자체 본문과 하위 section 포함 본문 중 watch body_hash의 범위를 format별로 확정하고 module 묶음에 기록한다.
- slide·data report의 초기 추출 지원과 구조화 설계 format 검사 범위. 현재 내장 목록 밖은 원문만 읽는다.
