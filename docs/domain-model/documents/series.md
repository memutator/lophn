---
type: domain-model
concerns: [documents/series]
---
# documents/series

Series의 가족 규칙·draft·멤버 key·정렬과 다음 이름 계산을 정의한다.

## Series (`ser`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `ser` ID | 아니오 | PK, 불변 | |
| `place` | PlaceRef | 아니오 | project 또는 app → documents/addressing | 가족의 자리 |
| `name` | Slug | 아니오 | `(place, name)` 유일; 생성 뒤 불변 | 문서 이름 공간과 별개인 가족 이름 |
| `title` | string | 아니오 | 공백만 있는 문자열 금지 | |
| `format` | string | 아니오 | 사용 가능한 format 이름 → documents/formats | 모든 멤버의 format 이름 |
| `order` | SeriesOrder | 아니오 | 유효한 값 | |
| `next_rule` | string | 아니오 | 아래 NextRule 문법; 등록 때 검사 | |
| `draft` | SeriesDraft | 예 | 확정 멤버와 별개; 가족당 최대 하나 | |
| `revision` | event seq | 아니오 | 마지막 구성·draft·멤버·보관 변경 seq | CAS 기준 |
| `status` | `active \| archived` | 아니오 | 생성은 active | |

### 상태

| 상태 | 뜻 |
|---|---|
| `active` | 새 멤버·draft 구성 대상 |
| `archived` | 기본 목록 제외; 새 멤버·draft 변경 금지; 기존 구성 읽기 가능 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `active` | `user` | 자리·format·규칙 유효 | `SeriesCreated` |
| `active` | `archived` | `user` | base_revision 일치 | `SeriesArchived` |
| `archived` | `active` | `user` | base_revision 일치 | `SeriesUnarchived` |

### 불변 조건

- 가족에는 자리 없는 상태가 없다. 자리 보관은 가족·멤버 삭제가 아니다. 자리 없는 문서를 넣으려면 → documents/addressing에서 먼저 자리를 정한다.
- `(place, name)` 예약은 보관 후에도 남는다. 가족에는 Document address·Version·context target가 없다. ID 또는 자리와 가족 이름으로 읽는다.
- 멤버는 같은 place와 format 이름의 확정 Document다. format module의 정확한 고정 계약은 각 Version에 남는다(→ documents/versions, documents/formats).
- 멤버가 있는 가족의 format 변경은 모든 멤버 최신 판의 format 이름과 같을 때만 허용한다. 멤버 Document의 이동·format 변경은 가족 불변 조건도 검사하고 불일치면 거절한다.
- 가족 보관·draft 제거·멤버 제거는 Document·Version의 상태나 내용을 바꾸지 않는다. 가족·멤버 key의 영구 삭제 command는 없다.
- 부모 가족·가족 간 관계·문서 의미 관계 간선은 없다.

## SeriesInstance (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `series` | `ser` ID | 아니오 | Series 참조 | |
| `document` | `doc` ID | 아니오 | 전역 유일; 첫 Version 존재 → documents/versions | 한 Document는 최대 한 가족의 멤버 |
| `key` | string | 아니오 | 공백만 있는 문자열·제어 문자 금지; 가족 안 exact unique | 점 허용; Document name과 독립 |
| `order_value` | string 또는 유한 number | 조건부 | order.kind가 format_field면 필수; 선언한 필드의 타입과 일치 | 저장된 정렬 값 |
| `order_version` | `ver` ID | 조건부 | format_field면 필수; 같은 Document의 Version | 정렬 값의 고정 판 근거 |
| `revision` | event seq | 아니오 | 마지막 가입·key·정렬 값 변경 seq | |

### 불변 조건

- 가족과 key를 함께 지정한다. family만 또는 key만 있는 멤버는 없다. `0.3` key와 `0-3` Document name은 다른 값이다.
- 멤버의 key와 저장한 정렬 값은 ledger의 구성이다. search·outline store를 삭제해도 멤버·순서는 사라지지 않는다.
- 기존 Document의 새 Version은 새 멤버가 아니다. format_field 정렬 값을 바꾸려면 새 고정 Version의 검사 결과와 기존 멤버 revision을 함께 제출한다.
- 제거는 가입 관계만 제거한다. 제거된 key 예약은 남고 다른 Document에 재사용하지 않는다. 같은 Document의 재가입만 허용한다.
- Document 보관 후에도 멤버가 남으며 목록에는 보관 상태를 표시한다. 다음 계산의 마지막 멤버 선택에는 보관 멤버도 포함한다.

## SeriesOrder (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `key \| format_field` | 아니오 | tagged union | |
| `field` | string | 조건부 | format_field 가지 필수; format이 선언한 정렬 가능 metadata 필드 | |
| `type` | `string \| number` | 조건부 | format_field 가지 필수; 선언된 필드 타입 | |
| `direction` | `ascending \| descending` | 아니오 | 표시 순서 | |

key 가지에는 field·type이 없다. order 변경은 기존 멤버 모두의 필요한 정렬 값과 근거 판을 준비하고 가족 revision·각 멤버의 최신 판을 한 transaction에서 검사한다. 필요한 값이 없으면 변경을 거절하며 임의 기본값을 채우지 않는다.

## SeriesDraft (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | 예정 `doc` ID | 아니오 | 아직 ledger Document가 아니거나 같은 가족의 미가입 활성 Document | 확정 시 사용할 대상 |
| `key` | string | 아니오 | SeriesInstance key 규칙; 현재 예약 충돌 없음 | 예정 key |
| `base_version` | `ver` ID | 조건부 | 기존 Document이면 현재 최신 판; 신규 예정 ID이면 null | |
| `format` | FormatRef | 아니오 | 가족 format 이름과 일치 → documents/formats | template·검사 계약 |
| `content` | blob 참조 | 예 | 내구 설치된 작성 입력 → platform/blob-store | template에서 시작한 작성 값 |

draft는 가족 안의 준비 값이며 Document나 Version entity가 아니다. draft만으로 원문 읽기·검색·context 항목을 만들지 않는다. format template 참조만 저장해 아직 content가 없을 수 있다. 첫 Version 확정과 멤버 추가를 적용할 때 같은 예정 ID·key·draft 기준을 검사하고 draft를 함께 비운다. draft 저장은 format 검사 통과 또는 Version 저장 성공을 뜻하지 않는다.

## NextRule (값)

| 항목 | 타입·제약 |
|---|---|
| 문법 | 바깥 공백 제거 뒤 `^[^{}]*\{(n\|major\|minor\|patch)(?:([+-])(\d+))?(?::(\d+))?\}$` |
| placeholder | 맨 끝에 정확히 하나; `n`, `major`, `minor`, `patch` |
| step | 생략은 `+1`; 명시한 부호와 정수는 안전한 정수 범위; 0 허용 |
| width | 생략은 채움 없음; 지정하면 1~4; `:03`은 width 3 |
| 입력 key | 숫자가 없는 접두사 + 점으로 나눈 10진 정수들 + 숫자가 없는 접미사 |

- `n`은 마지막 숫자, `major`는 첫 숫자, `minor`는 두 번째 또는 없으면 첫 숫자, `patch`는 세 번째 또는 없으면 마지막 숫자를 바꾼다. major·minor 변경은 뒤 숫자를 0으로 초기화한다.
- 감소 결과는 0 미만으로 내려가지 않는다. width는 바꾸는 숫자의 최소 표시 너비이며 더 큰 값은 자르지 않는다. 기존 key의 접두사·접미사는 유지하고 rule의 문자 접두사를 다시 덧붙이지 않는다.
- `P{n+1:03}`: `P001`→`P002`; `{minor}`: `0.2`→`0.3`; `{major}`: `0.2`→`1.0`; `{patch}`: `0.2.1`→`0.2.2`; `v{n+1}`: `v1`→`v2`.
- 멤버가 없거나 key를 해석할 수 없거나 계산이 안전한 정수 범위를 벗어나면 빈 제안을 반환한다. 날짜 `2026-09-28`은 숫자 가족 key로 해석하지 않는다.

## NextSuggestion (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `series_revision` | event seq | 아니오 | 읽은 구성 기준 | |
| `key` | string | 아니오 | 계산 불가면 빈 문자열 | |
| `title` | string | 아니오 | 기본 제안은 key와 같음; 사람이 변경 가능 | |
| `from` | string | 예 | key 자연 순의 마지막 확정 멤버 key; 멤버 없으면 null | |
| `taken` | boolean | 아니오 | 같은 가족의 현재·예약 key 또는 draft와 충돌 | |
| `document_name` | Slug | 예 | → documents/addressing의 이름 제안; 만들 수 없으면 null | 원본 파일 경로가 아님 |

계산과 읽기는 ID·key·파일을 예약하거나 저장하지 않는다. 실제 저장·가입 시 현재 revision·이름·key를 다시 검사한다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Series | 소속 자리 | Project → documents/projects 또는 App → apps/registration | N:1 | 보관 상태 표시; 가족 자동 삭제 없음 |
| Series | 멤버 | Document → documents/versions | 1:N; Document당 최대 하나 | 보관 멤버 유지; 영구 삭제 없음 |
| SeriesInstance | 정렬 값 근거 | Version → documents/versions | N:0..1 | 고정 판 유지 |
| SeriesDraft | 검사·template 계약 | FormatRef → documents/formats | N:1 | 정확한 module 참조 보존 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `series` | `id, place_kind, place_id, name, title, format, order, next_rule, draft, revision, status` | PK `id` | `(place_kind, place_id, name)` | `(place_kind, place_id, status)` | place → documents/addressing; revision → platform/ledger; draft blob → platform/blob-store |
| `series_instances` | `series, document, key, order_value, order_version, revision` | PK `(series, document)` | `document`, `(series, key)` | `(series, revision)` | series → `series.id`; document·order_version → documents/versions |
| `series_keys` | `series, key, document, first_seq` | PK `(series, key)` | 없음 | `(document)` | series → `series.id`; document → documents/versions; first_seq → platform/ledger |

`series_keys`는 제거 후에도 남는 key 예약이다. draft의 신규 예정 Document ID에는 Document FK를 걸지 않는다. 확정된 가입 관계만 Document·Version FK를 가진다. 큰 draft·일괄 정렬 값·이전 값은 blob 참조로 둔다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `series.create` | `user` | `id, place, name, title, format, order, next_rule`, idempotency key | ID·이름 미존재; 활성 place; format·order·rule 유효 | `SeriesCreated` | `invalid_input`, `conflict`, `forbidden` |
| `series.update` | `user` | `series, title?, format?, order?, next_rule?`, 준비된 정렬 값 | base_revision; active; 현재 멤버 형식·근거 판 일치 | `SeriesUpdated` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `series.set_draft` | `user` | `series, draft` | base_revision; active; key·예정 ID·base_version·FormatRef 유효 | `SeriesDraftSet` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `series.clear_draft` | `user` | `series` | base_revision; active; draft 존재 | `SeriesDraftCleared` | `not_found`, `conflict`, `forbidden` |
| `series.add_instance` | `user`, 허용된 `coding_agent`, `app` | `series, document, key, order_value?, order_version?` | base_revision; 활성 가족·문서·place; Document revision·latest_version; 같은 자리·format; key·멤버 유일 | `SeriesInstanceAdded`; 일치 draft는 `SeriesDraftCleared` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `series.update_instance` | `user`, 허용된 `coding_agent`, `app` | `series, document, key?, order_value?, order_version?` | base_revision; member revision; latest_version; 유효한 고정 검사 결과·key 예약 | `SeriesInstanceUpdated` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `series.remove_instance` | `user` | `series, document` | base_revision; member revision; active; 가입 존재 | `SeriesInstanceRemoved` | `not_found`, `conflict`, `forbidden` |
| `series.archive` | `user` | `series` | base_revision, active | `SeriesArchived` | `not_found`, `conflict`, `forbidden` |
| `series.unarchive` | `user` | `series` | base_revision, archived | `SeriesUnarchived` | `not_found`, `conflict`, `forbidden` |

Document 최초 저장과 첫 가입을 묶는 요청은 → documents/versions의 저장 검사와 이 concern의 가입 검사를 같은 ledger transaction에서 적용한다. 준비·format 실행·blob 설치는 command 밖에서 끝낸다. coding_agent·app의 멤버 저장 scope와 인증 actor는 → platform/identity다. lophn agent에는 가족 mutation tool을 제공하지 않는다.

`series.list`, `series.get`, `series.next`와 가족 목차는 read이며 변경 event가 없다. 같은 기준의 가족 상세와 목차는 같은 멤버 목록이다. `series.delete`는 없다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `SeriesCreated` | `ser` | `place, name, title, format, order, next_rule` | documents/outline-and-search |
| `SeriesUpdated` | `ser` | 변경 필드의 before·after, before_revision; 정렬 근거 blob 참조 | documents/outline-and-search |
| `SeriesDraftSet` | `ser` | `before_draft, draft, before_revision` 또는 blob 참조 | documents/series |
| `SeriesDraftCleared` | `ser` | `before_draft, before_revision` 또는 blob 참조 | documents/series |
| `SeriesInstanceAdded` | `ser` | `document, key, order_value, order_version, before_revision` | documents/outline-and-search |
| `SeriesInstanceUpdated` | `ser` | `document, before_instance, instance, before_revision` | documents/outline-and-search |
| `SeriesInstanceRemoved` | `ser` | `before_instance, before_revision` | documents/outline-and-search |
| `SeriesArchived` | `ser` | `before_revision` | documents/outline-and-search |
| `SeriesUnarchived` | `ser` | `before_revision` | documents/outline-and-search |

actor·run·시각과 event seq는 → platform/ledger envelope를 따른다. 읽기·목록 재구성 event와 agent run을 깨우는 구독은 없다.

## 정책

- **기본 정렬.** key ascending이다. key는 먼저 숫자형·비숫자형으로 나눈다. 숫자형은 접두사 문자열·숫자 성분 배열(없는 성분은 0)·접미사 문자열·exact key 순, 비숫자형은 exact key 순으로 비교한다. 혼합 key는 숫자형 그룹 먼저다. 문자열은 locale 독립 Unicode codepoint 순이다.
- **format 정렬.** 선언한 같은 타입의 order_value를 비교한다. number는 수로, string은 codepoint로 비교한다. 동점은 기본 key 정렬과 Document ID로 결정한다. descending은 최종 순서를 뒤집는다. 추출 실패 시 마지막 확정 order_value·order_version을 유지하고 미확인을 표시한다.
- **다음 제안.** 표시 정렬의 내림차순 여부와 무관하게 기본 key 자연 순의 마지막 확정 멤버를 입력으로 사용한다. draft는 멤버 수·마지막 key에 포함하지 않는다. 사람이 제안 title을 바꿔도 next_rule은 변하지 않는다.
- **한 draft.** 가족당 최대 하나이며 같은 가족 revision으로 교체·비우기를 검사한다. draft는 현재 key 충돌을 확인하지만 다음 계산 결과를 영구 예약하지 않는다. 가입 시 재검사한다.
- **보관.** 가족 보관이 멤버 보관·파일 삭제·원본 연결 변경이 아니다. 가족 구성은 보관 후에도 남는다.
- **정본과 derived.** 가족 구성·key·정렬 근거·draft는 ledger 데이터다. 가족 목록은 이를 조회하며 원본 Document를 재생성하거나 목록용 Version을 저장하지 않는다. 검색용 복사본은 → documents/outline-and-search다.
- **Operator 범위.** 가족 지원은 → lophn-agent/roles/operator의 기존 assignment 출력 Document에 새 Version을 쓰는 범위를 넓히지 않는다.
