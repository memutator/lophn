---
type: domain-model
concerns: [documents/outline-and-search]
---
# documents/outline-and-search

고정 판의 outline·section·본문·검색 결과와 재생성 가능한 derived store 구조를 정의한다.

## DerivedVersion (값)

ledger entity가 아니다. → documents/versions의 불변 판과 → documents/formats의 정확한 module로 다시 만든다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `version` | `ver` ID | 아니오 | 선택한 고정 판 | |
| `document` | `doc` ID | 아니오 | version의 Document | |
| `content_hash` | sha256 | 아니오 | 해당 판의 content_hash | |
| `module_hash` | sha256 | 아니오 | 해당 판의 정확한 FormatRef | |
| `extraction_status` | `ready \| unsupported \| unverified \| failed` | 아니오 | 빈 ready sections와 unsupported를 구분 | |
| `text_hash` | sha256 | 예 | 추출한 대표 텍스트 UTF-8 바이트 hash; 바이트는 derived_texts에 저장 | |
| `line_count` | integer | 예 | ready면 `>= 0` | |
| `section_count` | integer | 아니오 | `>= 0`; 실제 section 행 수 | |
| `failure_reason` | string | 조건부 | failed면 필수 | |

## Section (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `version` | `ver` ID | 아니오 | DerivedVersion | |
| `key` | string | 아니오 | `(version, key)` 유일; → documents/formats | |
| `title` | string | 아니오 | 추출 원문 제목 | |
| `parent` | string | 예 | 같은 version의 key; 비순환 | |
| `position` | integer | 아니오 | `>= 0`; 원문 순서 | |
| `level` | integer | 아니오 | 0..6 | |
| `anchor` | string | 예 | 명시 anchor | |
| `own_ranges` | LineRange[] | 아니오 | 대표 텍스트 안 순서대로 비중첩 | 자체 본문 |
| `subtree_range` | LineRange | 아니오 | 자체·하위 범위 포함 | |
| `characters` | integer | 아니오 | Unicode codepoint 수 `>= 0` | |
| `estimated_tokens` | integer | 아니오 | 기본 `ceil(characters / 3)`; 실제 model token 수가 아님 | |
| `body_hash` | sha256 | 아니오 | 모듈의 heading 제외 본문 hash 규약 | |
| `children_count` | integer | 아니오 | 직접 자식 수 `>= 0` | |

독립 ID·Version·section 의미 대응 행은 없다.

## LineRange (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `start_line` | integer | 아니오 | 1-based, `>= 1` | |
| `end_line` | integer | 아니오 | inclusive, start_line 이상, 해당 text line_count 이하 | |

빈 본문은 빈 범위 목록으로 표현하며 `1..0` 같은 거짓 범위를 만들지 않는다.

## ReadResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | `doc` ID | 아니오 | → documents/versions | |
| `version` | `ver` ID | 아니오 | 실제 선택한 고정 판 | |
| `latest_version` | `ver` ID | 아니오 | 응답 기준 현재 최신 판 | 검색·읽기 판과 차이 |
| `module_hash` | sha256 | 아니오 | 선택 판의 module | |
| `section` | string | 예 | 선택한 key | |
| `section_status` | `whole \| found \| missing \| unverified \| unsupported` | 아니오 | 추출 부재와 미확인 구분 | |
| `include_children` | boolean | 아니오 | 요청에서 명시 | |
| `ranges` | LineRange[] | 아니오 | 실제 반환한 대표 텍스트 줄 | |
| `text` | string | 예 | 텍스트 반환 때만; 출력 redaction → platform/redaction | |
| `file` | ContentFile 참조 | 예 | 미지원 추출이면 허용된 원문 읽기 참조 → documents/versions | |
| `complete` | boolean | 아니오 | 요청 대상 전체가 반환됐는지 | |
| `next_cursor` | string | 예 | complete면 null; 미완료면 이어 읽기 방법 | |
| `redacted` | boolean | 아니오 | 출력 redaction 여부 | 원문 hash·범위는 유지 |

## OutlinePage (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `root \| place \| context \| document \| series \| view` | 아니오 | enum | |
| `basis_seq` | event seq | 아니오 | 목록 선택의 ledger 기준 | |
| `entries` | object[] | 아니오 | 아래 kind별 작은 행; 본문 제외 | |
| `complete` | boolean | 아니오 | 잘린 목록은 false | |
| `next_cursor` | string | 예 | 기준·정렬·scope·선택 판에 결합; complete면 null | |

| kind | entries의 필수 내용 |
|---|---|
| root | 허용된 Project·App·Context ID, title, purpose, 자리별 문서 수와 자리 없는 문서 묶음의 건수; Context의 기준 항목 수·참조 앱 수·활동 |
| place | Document ID, name, title, 선택 version, FormatRef, saved_by, saved_at, 발췌 또는 SummaryCache, section 수 |
| context | Context 목적, target·perspective·reason, 정의 Term와 별도 후보 목록, target의 선택 판·읽기 가능 여부 |
| document | 고정 version과 latest_version, FormatRef, key·title·parent·position·own_ranges·subtree_range·body_hash·characters·estimated_tokens·children_count·section_status |
| series | → documents/series의 같은 기준·정렬에 따른 key·Document title·고정 최신 ver·보관 상태; 멤버 본문은 제외 |
| view | 현재 조건에 맞는 place와 같은 작은 문서 행; glossary 없음 |

root는 활동 순, place·context는 갱신 순으로 시작하고 seq·ID로 동점을 결정한다. context는 basis·reference·watch 순서와 빈 관점을 구별한다. API의 필수 내용 전체가 기본 화면의 노출 목록은 아니며 기본/상세 분리는 requirements와 shell/wording의 en message key 규칙을 따른다. 폴더 실제 경로·현재 디스크 상태는 agent outline에 포함하지 않는다. scope는 각 페이지 다시 검사한다. 안정된 기준을 유지할 수 없으면 `conflict`로 재조회한다.

## SearchResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | `doc` ID | 아니오 | 현재 읽기 권한 확인한 후보 | |
| `version` | `ver` ID | 아니오 | index가 실제 반영한 고정 판 | |
| `latest_version` | `ver` ID | 아니오 | 응답 기준 최신 판 | |
| `section` | string | 예 | 일치한 판의 key | |
| `ranges` | LineRange[] | 아니오 | 해당 판의 일치 위치 | |
| `reference` | DocumentRef 또는 고정 Address | 아니오 | → documents/addressing; version 필수 | |
| `title` | string | 아니오 | 현재 허용된 제목; 출력 redaction 적용 | |
| `snippet` | string | 아니오 | 짧은 일치 부분; derived 일치는 match_source로 구별; 출력 redaction 적용 | |
| `score` | number | 아니오 | 유한한 keyword 순위 값 | |
| `match_source` | `original \| summary \| topic` | 아니오 | 원문과 derived 일치 구별 | |
| `cache_basis` | `{version: ver ID, section: string?, input_hash: sha256, stale: boolean}` | 조건부 | summary/topic이면 필수; 실제 입력 판과 범위; 원문 일치면 null | |

원문 일치는 해당 판의 ranges를 반환한다. summary/topic 일치는 원문 줄에 가짜 일치를 만들지 않고 ranges=[]와 cache_basis를 반환하며 reference는 실제 입력 고정 판을 가리킨다. cache가 최신 판보다 낡았으면 stale를 감추지 않는다.

## IndexCoverage (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `processed_seq` | event seq | 아니오 | derived consumer가 적용한 seq | |
| `ledger_basis_seq` | event seq | 아니오 | 응답에서 읽은 ledger seq | |
| `lagging` | boolean | 아니오 | processed_seq < ledger_basis_seq 또는 선택 판 미반영 | |
| `rebuilding` | boolean | 아니오 | 재생성 중 여부 | |
| `omissions` | `{document: doc ID, version: ver ID, reason: string}[]` | 아니오 | 현재 scope 안의 실패·미지원 누락만 | |

cursor 최신은 모든 본문 검색 가능의 증명이 아니다. 결과 없음은 ledger 문서 부재의 증명이 아니다.

## SummaryCache (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `version` | `ver` ID | 아니오 | 요약 입력 판 | |
| `section` | string | 예 | null이면 문서 전체 | |
| `text` | string | 아니오 | 요약 표시를 붙여 반환 | |
| `input_hash` | sha256 | 아니오 | 실제 입력의 hash | |
| `stale` | boolean | 아니오 | 응답의 선택 판과 입력 판이 다르면 true | |

요약이 없으면 null과 원문 발췌(기본 최대 200 codepoint)를 반환한다. 이 cache 생성을 위해 agent run을 자동 시작하지 않는다.

## SavedView (`viw`)

사람이 조건을 이름 붙여 저장한 문서 목록. 목록 자체는 저장하지 않고 열 때마다 계산한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `viw` ID | 아니오 | PK | |
| `name` | string | 아니오 | 공백만 있는 문자열 금지; 현재 view 사이에서 unique | 화면 이름 |
| `place` | place 참조 | 예 | → documents/addressing | 범위. 없으면 모든 자리 |
| `filter` | ViewFilter | 아니오 | 아래 값 | 조건 |
| `sort` | `updated_desc` / `updated_asc` / `title_asc` / `address_asc` | 아니오 | 기본 `updated_desc` | 정렬 |
| `revision` | event seq | 아니오 | 마지막 생성·조건·이름·정렬 변경 event seq | CAS 기준 |

### ViewFilter (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `title_contains` | string | 예 | 비어 있지 않은 문자열 | 제목에 들어간 말 |
| `text` | string | 예 | 비어 있지 않은 문자열 | full-text search 질의 |
| `formats` | format 이름 목록 | 예 | → documents/formats | |
| `changed_within_ms` | 정수 | 예 | 1 이상 | 최근 이 기간 안에 새 version이 생긴 문서 |
| `context` | `ctx` ID | 예 | → documents/contexts | 이 context의 item인 문서만 |
| `document_status` | `active` / `archived` / `all` | 아니오 | 기본 `active` | 문서의 보관 상태 |

### 불변 조건

- 조건은 documents/outline-and-search#R23의 문서 조건만 허용한다. 기본 document_status=active만 있는 전체 문서 view도 유효하다. page 크기는 OutlinePage의 읽기 예산으로 고르고 view의 고정 제한을 따로 저장하지 않는다.
- 생성·조건 변경·삭제는 user만 한다. 삭제는 조건만 제거하며 Document·Version·Context를 바꾸지 않는다. 삭제된 view의 기존 cursor는 conflict로 재조회를 요구한다.
- 열 때의 결과는 derived다. 결과 목록, 개수, 순서를 ledger에 쓰지 않는다. 같은 조건·정렬·현재 scope와 같은 대상 version 목록일 때만 cache를 쓴다.
- 저장·변경에는 revision CAS와 같은 transaction의 event가 있다. 삭제 event의 before 값은 기록에 남기되 삭제된 view를 목록·open 결과로 반환하지 않는다.

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `saved_views` | SavedView; `filter`는 JSON | PK `id` | `name` | `(name)` | `place` → documents/addressing; revision → platform/ledger |

이 표 말고는 없다. outline·section·FTS·summary·처리 cursor·추출 실패·재생성 상태는 ledger 밖이다. index 완료 event나 Document 상태 열을 추가하지 않는다.

### derived store 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `derived_versions` | DerivedVersion | PK `version` | 없음 | `(document)` | ledger의 ver·doc는 논리 참조; 물리 FK 없음 |
| `derived_sections` | Section; 범위는 JSON | PK `(version, key)` | `(version, position)` | `(version, parent, position)` | version → derived_versions; parent → 같은 version의 section |
| `derived_texts` | `version, text_hash, text, line_offsets` | PK `version` | 없음 | 없음 | derived_versions; line_offsets는 대표 텍스트의 byte offset 목록 |
| `search_documents` | `document, indexed_version, title, name, place_kind, place_id, status, saved_seq` | PK `document` | 없음 | `(status, place_kind, place_id)` | indexed_version → derived_versions; 문서별 마지막 반영 판 하나 |
| `search_rows` | `rowid, document, version, section_key, ranges, title, body` | PK integer `rowid` | `(document, section_key)` null-safe | `(version)` | document → search_documents; section 선택 시 derived_sections |
| `search_fts` | FTS5의 `title, body` | rowid = search_rows.rowid | rowid | FTS5 내장 keyword index | external content `search_rows`; 현재 반영 판만 |
| `summary_cache` | SummaryCache; `section_key` null은 문서 전체 | PK `(version, section_key)` null-safe | 없음 | 없음 | derived_versions |
| `derived_cursors` | `consumer, processed_seq, rebuilding, rebuild_basis_seq` | PK `consumer` | 없음 | 없음 | consumer는 `search` 또는 `watch`; seq → platform/ledger 논리 참조 |
| `watch_unverified` | `context, target_key, source_seq, context_revision, before_version, after_version, reason` | PK `(context, target_key, after_version)` | 없음 | `(source_seq)` | → documents/contexts; 미확인 계산만 |

consumer의 한 event 적용 결과·FTS 교체·cursor 갱신은 한 derived transaction이다. 재생성은 ledger 기준 seq S의 일관된 snapshot에서 시작해 S 뒤 event를 적용한다. snapshot 만료면 새 기준으로 재시작한다. 옛 판 outline은 요청 때 만들 수 있으며 search_rows는 Document별 마지막 반영 판만 유지한다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `view.save` | `user` | `id, name, place?, filter, sort?`, idempotency key | ID·같은 이름의 view 미존재 | `SavedViewCreated` | `invalid_input`, `conflict`, `forbidden` |
| `view.update` | `user` | `view`, 바꿀 필드 | base_revision; 현재 이름 유일 | `SavedViewUpdated` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `view.delete` | `user` | `view` | base_revision; 현재 view 존재 | `SavedViewDeleted` | `not_found`, `conflict`, `forbidden` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `SavedViewCreated` | `viw` | `name, place, filter, sort` | shell의 view 목록 |
| `SavedViewUpdated` | `viw` | 바뀐 필드의 before·after, before_revision | shell의 view 목록 |
| `SavedViewDeleted` | `viw` | `before_view, before_revision` | shell의 view 목록 |

## 정책

- **읽기 입력.** ID 또는 Address, 선택 ver, section·줄 범위, include_children, 크기 한도·cursor를 받는다. 최신 outline은 ledger 읽기로 판을 선택하고 부분 읽기는 그 ver를 유지한다. 다른 판의 범위·cursor는 `invalid_input`이다.
- **권한·redaction.** 후보 ID를 현재 scope로 확인하고 제목·snippet·본문을 내보낸다(→ platform/identity, platform/redaction). 건수·순위·pagination에서도 권한 밖 존재를 새지 않는다. derived cache의 옛 권한은 승인 근거가 아니다.
- **기본 읽기 예산.** root 1,500 estimated token, place·context 3,000, document outline 2,000·depth 2, 본문 12,000 codepoint를 초기 기본 한도로 제안한다. 초과 목록·본문은 complete=false와 cursor다. actual model token 한도는 → lophn-agent/harness/prompt-assemble이다.
- **기준 유지.** 목록 cursor는 기준 seq·정렬·scope·선택 판에 묶는다. 순서는 saved_at이 아닌 관련 event seq와 ID tie-breaker로 결정한다. 커서가 더는 안정된 기준을 유지하지 못하면 conflict다.
- **추출 없음.** ready 빈 sections, unsupported, unverified, failed를 구별한다. 성공 추출의 key 부재는 missing이다. 실패·module 누락에 section을 추측하지 않는다. blob 누락은 unavailable이며 추출 실패가 원문 읽기를 막지 않는다.
- **비동기 반영.** DocumentSaved와 문서·place·Context·Term 구성 event를 seq로 소비한다. move는 출발·도착 목록을 함께 갱신한다. 보관 문서·보관 자리는 기본 목록과 검색에서 제외하고 해제 후 비동기로 반영한다. 검색 행이 낡아도 현재 ledger의 문서·자리 보관 상태를 읽어 기본 후보에서 제거하며 고정 판 읽기는 유지한다.
- **재생성.** derived store를 지워도 ledger·원문 Version은 변하지 않는다. 원문과 정확한 module로 재생성하며 ledger 쓰기·전체 scan·전체 index를 기다리지 않고 선택 판을 직접 추출한다. 실패 기록 뒤 cursor가 진행돼도 omissions를 표시한다.
- **검색.** 첫 판은 SQLite FTS5 trigram keyword 검색이며 3 codepoint 미만은 escaped SQL LIKE 부분 일치로 처리한다. 최신 반영 판의 section 제목·본문과 가용 요약·주제 텍스트를 검색하고 cache 입력 판과 stale를 유지한다. embedding·model 검색·앱 DB 복사는 없다. 검색 판과 최신 판이 다르면 함께 표시하고 결과의 고정 판을 읽는다.
- **이력·diff.** 두 고정 판의 같은 key와 줄 범위를 비교한다. key 추가·소실·본문 변경·변경 없음만 계산하며 의미 rename은 추정하지 않는다. 잘린 이력 첫 판도 직전 판을 비교한다. 복원 불가 범위는 누락 표시다.
- **읽기 오류.** 잘못된 범위·cursor는 invalid_input, 허용 대상 부재는 not_found, 안정 기준 만료는 conflict, blob·module 접근 실패는 unavailable이다. auth 오류는 → platform/identity이다.

## 정할 것

- 한국어 검색은 requirements의 FTS5 trigram·3 codepoint 미만 LIKE를 따른다. 두 글자 검색과 큰 본문 성능은 실측한다.
- 초기 예산·codepoint/3 근사치를 유지할지 model별 보정을 추가할지. cursor encoding은 offset만이 아닌 기준·scope 결합이 필요하다.
- summary cache 생성 contract·크기 상한·입력 provenance. 현재 원문 발췌가 기본이다.
- 일관된 재생성 snapshot과 watch의 source_seq 구성 조회 contract를 → platform/ledger와 맞춘다.
