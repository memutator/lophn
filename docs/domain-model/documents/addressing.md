---
type: domain-model
concerns: [documents/addressing]
---
# documents/addressing

place·문서·section·version 참조 문법과 이름의 영구 예약, rename·move의 옛 address 안내를 정의한다.

## Slug (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `value` | string | 아니오 | 제안 문법 `[a-z][a-z0-9]*(?:-[a-z0-9]+)*`; `_` 시작·`/`·`#`·`@`·공백·제어 문자 금지 | 영문 address 이름 |

제목과 독립이며 Project → documents/projects, App → apps/registration, Document → documents/versions의 name에 사용한다. 예약한 이름은 보관 뒤에도 다른 대상에 재사용하지 않는다.

## PlaceRef (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `project \| app` | 아니오 | enum | |
| `id` | `prj` ID 또는 `app` ID | 아니오 | kind에 맞는 ID; → documents/projects 또는 apps/registration | |

별도 place entity는 없다. place null인 문서는 ID로만 부른다. `_inbox`, `_system`, 기본 notes place를 만들지 않는다.

## Address (값)

```text
address = place_slug "/" document_slug ["#" section_key] ["@" version_number]
version_number = 양의 십진 정수 (1부터, leading zero 없음)
```

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `place` | Slug | 아니오 | 현재 또는 과거 예약 이름 | |
| `document` | Slug | 아니오 | 현재 또는 과거 해당 place의 이름 | |
| `section` | string | 예 | Format이 만든 key → documents/formats; `/` 포함 가능 | 없으면 전체 문서 |
| `version` | integer | 예 | `>= 1`; 해석된 Document의 number | 없으면 최신 판 |

예: `mahas/weekly-report#summary@3`. `#`는 `@` 앞에만 오며 중복 구분자는 `invalid_input`이다. section key 안의 `#`, `@`, `%` 등 구분자는 UTF-8 percent encoding으로 구분하고 정확히 한 번 decode한다. 문서 이름과 place 이름을 path처럼 상대 이동으로 해석하지 않는다.

## DocumentRef (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | `doc` ID | 아니오 | → documents/versions | |
| `version` | `ver` ID | 예 | 같은 Document의 Version; null이면 최신 | |
| `section` | string | 예 | 선택한 판에서 exact key | |

place 없는 문서도 이 참조를 사용한다. 고정 근거는 반드시 version을 포함한다. 다른 entity도 자기 ID로 부를 수 있지만 이 구조는 문서 읽기 참조다.

## ResolvedAddress (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | `doc` ID | 아니오 | 최종 같은 Document | |
| `version` | `ver` ID | 아니오 | 요청 number 또는 해석 시점 최신 판 | |
| `section` | string | 예 | 선택 판에서 확인한 key | |
| `redirected` | boolean | 아니오 | 과거 place·문서 예약으로 해석했으면 true | |
| `current_reference` | Address 또는 DocumentRef | 아니오 | 현재 place 없으면 ID 참조; 요청 고정 판 보존 | |
| `section_status` | `whole \| found \| missing \| unverified \| unsupported` | 아니오 | 추출 결과 → documents/outline-and-search와 일치 | |

최신 판의 key가 사라지면 `missing`이다. 추출 실패·미완료는 `unverified`이며 비슷한 제목으로 key를 바꾸지 않는다. `@number`를 붙인 옛 section은 그 판에서 읽는다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| PlaceName | 이름 예약 | Project → documents/projects 또는 App → apps/registration | N:1 | 보관 뒤에도 같은 ID 유지 |
| DocumentName | place 안 이름 예약 | Document → documents/versions | N:1 | 보관·place 해제 뒤에도 ID 안내 유지 |
| DocumentRef | 고정 판 | Version → documents/versions | N:0..1 | 고정 판 삭제 없음 |

## ledger 표

값의 영구 예약 표이며 독립 entity ID를 발급하지 않는다.

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `place_names` | `slug, kind, target, reserved_seq` | PK `slug` | slug는 project·app 전체 공유 | `(kind, target)` | target → documents/projects 또는 apps/registration; reserved_seq → platform/ledger |
| `document_names` | `place_kind, place_id, name, document, reserved_seq` | PK `(place_kind, place_id, name)` | 같은 키를 다른 doc에 재사용 금지 | `(document)`, `(place_kind, place_id, document)` | place → documents/projects 또는 apps/registration; document → documents/versions; reserved_seq → platform/ledger |

현재 이름 여부는 소유 entity의 현재 name·place와 대조한다. reservation의 target은 바꾸거나 행을 삭제하지 않는다. Project·App rename은 과거 slug도 같은 place ID로 해석하므로 그 place의 모든 문서 옛 address를 유지한다. Document move·rename은 이전 예약을 남기고 새 예약을 같은 transaction에서 추가한다. 연속 redirect 문자열을 저장하지 않고 불변 target ID로 직접 해석한다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `document.move` | `user`; 검증된 option action을 적용하는 machine의 `user` actor | `document, place` 또는 null, `name` | Document base_revision; 목적지 이름 예약이 없거나 같은 doc; 현재 scope | `DocumentMoved` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `document.rename` | `user`; 검증된 option action을 적용하는 machine의 `user` actor | `document, name` | Document base_revision; 새 이름 예약이 없거나 같은 doc | `DocumentRenamed` | `invalid_input`, `not_found`, `conflict`, `forbidden` |

Project·App name 변경 command는 → documents/projects, apps/registration이 소유하며 이 파일의 예약 규칙을 같은 transaction에서 적용한다. address 해석은 읽기이며 ledger command·event가 아니다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `DocumentMoved` | `doc` | `before_place, before_name, place, name, before_revision` | documents/outline-and-search, lophn-agent/revert |
| `DocumentRenamed` | `doc` | `place, before_name, name, before_revision` | documents/outline-and-search, lophn-agent/revert |

## 정책

- **해석 순서.** place 예약에서 ID를 얻고 `(place ID, document name)` 예약으로 doc을 찾는다. version number가 있으면 해당 판, 없으면 최신 판을 선택한다. section은 그 판의 exact key를 우선하며 유일한 마지막 slug도 허용한다. 마지막 slug가 둘 이상이면 `invalid_input`이다.
- **section key.** 같은 key만 같은 참조다. 제목·hash·유사도에 의한 의미 대응, section redirect chain, 대응 확인 command·표·판단 큐는 없다. key가 없는 최신 판에 옛 key를 새 key로 바꾸지 않는다.
- **place 없음.** title·doc ID로 목록·검색에 포함하며 ID 읽기를 제공한다. 과거 address로도 같은 doc의 현재 ID 읽기를 안내한다.
- **결정 전달.** 이동 option action은 대상·정확한 place·name·base_revision에 묶인다(→ lophn-agent/questions). 자유 답을 이동 허락으로 해석하지 않는다. agent에게 이동 도구를 주지 않는다.
- **파일.** Document place 변경은 FileSource·디스크 파일·tracking 규칙을 변경하지 않는다(→ documents/versions, documents/file-tracking).
- **권한.** 옛 address도 현재 target에 대한 범위를 검사한다(→ platform/identity). 안내로 권한을 넓히지 않는다.

## 정할 것

- Slug 최대 길이는 spec에서 정한다. 문법은 제안이며 제목을 강제 음역하지 않고 자동 제안 뒤 사람이 고친다.
- section percent encoding과 유일 마지막 slug는 외부 CLI·MCP에서도 이 문법과 같게 쓴다.
- section보다 작은 code block·table 주소는 두지 않는다. section과 대표 텍스트 줄 범위만 제공한다.
