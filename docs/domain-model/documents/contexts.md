---
type: domain-model
concerns: [documents/contexts]
---
# documents/contexts

Context, 계약·검색 묶음의 판(ContextBundle)과 격리 검사(ContextCheck), SavedView, 그리고 계약에서 계산하는 Entity·Violation(derived)을 정의한다.

## Context (`ctx`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `ctx` ID | 아니오 | PK, 불변 | |
| `project` | `prj` ID | 아니오 | → documents/projects; 생성 뒤 불변 | 소속. Workspace에는 context가 없다 |
| `title` | string | 아니오 | 공백만 있는 문자열 금지; `(project, title)` 유일 | |
| `purpose` | string | 아니오 | 공백만 있는 문자열 금지 | 한 줄 목적 |
| `status` | `drafting \| active \| archived` | 아니오 | 생성은 drafting | |
| `applied_bundle` | `cbn` ID | 예 | 같은 Context의 applied 상태 ContextBundle; drafting이면 null | 지금 쓰는 판 |
| `violation_mark` | 0 이상 정수 | 아니오 | 마지막으로 기록한 위반 수; 생성은 0 | 위반 수가 늘었는지 비교하는 기준 |
| `revision` | event seq | 아니오 | 마지막 제목·목적·상태·적용 판·violation_mark 변경 seq | CAS 기준 |

### 상태

| 상태 | 뜻 |
|---|---|
| `drafting` | 적용된 판이 아직 없다; 검색·위반 감지·preset 선택 대상이 아님 |
| `active` | 적용된 판이 있다; 검색·위반 감지·preset 선택 대상 |
| `archived` | 검색·위반 감지·알림·preset 선택 후보에서 빠짐; 계약·판·saved view는 남음 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `drafting` | `user`, Context Engineer의 `agent` | 목적·제목 유효 | `ContextCreated` |
| `drafting` | `active` | `machine` | 첫 ContextBundle이 검사를 통과해 적용됨(같은 transaction) | `ContextBundleApplied` |
| `drafting` / `active` | `archived` | `user` | base_revision 일치 | `ContextArchived` |
| `archived` | 보관 직전 상태(applied_bundle이 있으면 `active`, 없으면 `drafting`) | `user` | base_revision 일치 | `ContextUnarchived` |

### 불변 조건

- Context는 Document·App을 소유하지 않는다. 보관·판 되돌리기는 project 파일을 바꾸지 않는다(→ documents/projects).
- Context는 자기 Project의 파일과 App의 read 명령만 읽는다. 다른 Project의 경로는 어디에도 쓸 수 없다.
- 계약과 판은 ledger(와 blob)에 둔다. project 폴더에 쓰지 않는다.
- 한 Context에 draft 판은 최대 하나, checking 판은 최대 하나이고, applied 판은 `applied_bundle`이 가리키는 하나다.
- 근거는 파일 경로와 section으로만 가리킨다. 문서 판(version)·`doc@ver` 주소는 쓰지 않는다.

## ContextBundle (`cbn`)

계약, 선언된 검색, saved view 정의, 예(examples)를 한 번에 묶은 판이다. 문서의 판이 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `cbn` ID | 아니오 | PK, 불변 | |
| `context` | `ctx` ID | 아니오 | → Context; 불변 | |
| `number` | 양의 정수 | 예 | 검사에 낼 때 부여; `(context, number)` 유일; Context 안에서 증가; draft면 null | 판 번호(화면에는 r1, r2 …) |
| `parent` | `cbn` ID | 예 | 같은 Context의 판; 처음이면 null | 이 초안을 시작한 판 |
| `content` | blob 참조 | 아니오 | → platform/blob-store; BundleContent JSON; submit 뒤 불변 | 묶음 내용 |
| `bundle_hash` | sha256 | 예 | submit 때 정규 JSON으로 계산; draft면 null | 검사·적용한 정확한 byte |
| `status` | `draft \| checking \| failed \| applied \| superseded \| discarded` | 아니오 | 아래 전이만 | |
| `check` | `chk` ID | 예 | checking 이후 필수 | 이 판의 검사 |
| `created_by` | actor | 아니오 | → platform/identity | 초안을 연 주체 |
| `revision` | event seq | 아니오 | 마지막 draft 저장·상태 변경 seq | CAS 기준 |

### 상태

| 상태 | 뜻 |
|---|---|
| `draft` | Context Engineer가 쓰는 초안; 번호 없음; 적용된 판에 영향 없음 |
| `checking` | 번호를 받고 격리 검사 중; 내용 불변 |
| `failed` | 검사가 실패함; 적용되지 않음; 내용 보존 |
| `applied` | 지금 Context가 쓰는 판 |
| `superseded` | 다른 판이 적용되어 물러남; 되돌릴 수 있음 |
| `discarded` | 쓰지 않고 버린 draft |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `draft` | Context Engineer의 `agent` | Context가 archived가 아님; 기존 draft 없음 | `ContextBundleDraftSaved` |
| `draft` | `draft` | Context Engineer의 `agent` | base_revision 일치; content 유효한 JSON | `ContextBundleDraftSaved` |
| `draft` | `discarded` | Context Engineer의 `agent`, `user` | base_revision 일치 | `ContextBundleDraftDiscarded` |
| `draft` | `checking` | Context Engineer의 `agent` | checking 판 없음; content가 BundleContent 스키마를 만족; 번호·hash 부여 | `ContextBundleSubmitted` |
| `checking` | `failed` | `machine` | ContextCheck가 failed | `ContextBundleCheckFailed` |
| `checking` | `applied` | `machine` | ContextCheck가 passed; 같은 transaction에서 Context.applied_bundle 변경, 이전 applied는 superseded, saved view 반영 | `ContextBundleApplied` |
| `superseded` | `applied` | `user` | base_revision 일치; 지금 applied 판은 superseded로 | `ContextBundleRolledBack` |

### 불변 조건

- submit 뒤 content·hash·번호는 바뀌지 않는다. 고치려면 새 draft를 연다(parent = 이 판).
- 같은 Context 안에서 applied는 많아야 하나이며 적용과 물러남은 한 transaction이다.
- 되돌리기는 이전 판을 다시 검사하지 않는다. 판 번호를 새로 만들지 않고 그 판이 다시 applied가 된다. 되돌린 판의 saved view 정의를 반영한다.
- 적용된 판은 직접 고칠 수 없다. 계약 변경은 draft → checking → applied 경로로만 들어온다.
- Context.status가 archived이면 draft·submit·되돌리기가 거절된다.

## BundleContent (값)

판의 content blob의 JSON이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `schema` | 양의 정수 | 아니오 | 알려진 값 | BundleContent 스키마 번호 |
| `contract` | Contract | 아니오 | | 개체의 계약 |
| `searches` | DeclaredSearch[] | 아니오 | 이름 유일; 빈 목록 허용 | 선언된 검색 |
| `saved_views` | SavedViewDef[] | 아니오 | 이름 유일; 빈 목록 허용 | 이 판이 두는 saved view |
| `examples` | Example[] | 아니오 | 빈 목록 허용 | 검사가 맞춰 볼 예 |

## Contract (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `types` | Type[] | 아니오 | 1개 이상; `name` 유일 | 도메인 개체의 type |

### 불변 조건

- 계약은 정적 데이터다. 시간·난수·model 호출·외부 입출력을 쓰는 항목이 없다. 같은 파일 상태에서 개체·field·관계·위반이 같다.
- 관계의 `to`와 참조 type은 같은 Contract 안에 있거나 다른 Context의 public type이어야 한다(Type.visibility 참조).
- 다른 Project의 경로는 어떤 필드에도 쓸 수 없다.

## Type (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | 대문자로 시작하는 식별자(Experiment, Finding); Contract 안 유일 | |
| `summary` | string | 아니오 | 공백만 있는 문자열 금지 | 사람이 읽는 한 줄 뜻 |
| `visibility` | `public \| private` | 아니오 | 기본 private | 다른 context가 가리킬 수 있는지 |
| `source` | Source | 아니오 | kind 일곱 가지 중 하나 | 개체가 있는 자료 |
| `key` | string | 아니오 | `fields`의 이름; 값은 type 안 유일 | 개체를 구별하는 field |
| `fields` | Field[] | 아니오 | 이름 유일; `key` field 포함 | |
| `relations` | Relation[] | 아니오 | 이름 유일; 빈 목록 허용 | 다른 type과의 관계 |
| `rules` | CheckRule[] | 아니오 | id 유일; 빈 목록 허용 | 이 type의 검사 규칙 |

## Source (값)

`kind`로 구별하는 tagged union이다. 다른 가지의 필드는 금지한다. 경로는 모두 Project 폴더 기준 상대 경로이며 Project 밖을 가리킬 수 없다.

| kind | 필드 | 제약 | 개체 |
|---|---|---|---|
| `folder` | `root` path, `child_pattern` glob(기본 `*`), `depth` 1 | 폴더 이름이 pattern에 맞는 것 | 하위 폴더 하나가 개체 하나(폴더 이름이 path capture 값) |
| `docs` | `paths` PathPattern[] | 1개 이상; 경로 또는 glob | 맞는 문서 하나가 개체 하나 |
| `series` | `pattern` string, `order` `natural` | `{n}` 같은 이름 있는 capture 하나 이상과 `*` 허용; 같은 pattern이 두 type에 겹치지 않음 | 맞는 문서 하나가 개체 하나; 번호 capture를 수로 비교한 자연 순서 |
| `index` | `document` path, `within` heading? | Markdown 문서; `within`이 있으면 그 section 안 링크만 | 문서가 링크한 같은 Project 문서 하나가 개체 하나(링크 순서) |
| `section` | `documents` PathPattern[] 또는 `from_type` Type 이름, `level` 1~6, `title_pattern` glob? | | 맞는 heading의 section 하나가 개체 하나 |
| `outline` | `documents` PathPattern[] 또는 `from_type` Type 이름, `format` `markdown`, `min_level`, `max_level` | format은 지금 `markdown`뿐; 확장은 parser 등록으로 | 제목 tree의 heading 노드 하나가 개체 하나(부모·level를 field로) |
| `app-data` | `app` slug, `command` string, `result_path` string[](빈 배열이면 결과 자체가 배열) | command의 효과가 read → apps/blueprint; 호출 입력은 고정 값만 | command 결과 배열의 항목 하나가 개체 하나 |

- `docs`·`series`·`section`·`outline`의 Markdown 해석은 documents/formats의 section 추출 규칙을 쓴다.
- `index`는 링크 대상이 Project 밖이거나 없는 문서이면 그 개체를 만들지 않고 위반으로 센다.
- `series`의 다음 이름 계산은 → documents/series가 정의한다. 이 파일은 pattern과 순서만 쓴다.
- `outline`은 저장하거나 index에 넣지 않는다. 쓸 때마다 문서 editor와 같은 parser(→ documents/formats, documents/outline-and-search)로 읽는다.
- `app-data`의 입력·결과는 계약과 index에 저장하지 않는다. 검색할 때 명령을 불러 얻는다.

## Field (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | 소문자 식별자; Type 안 유일 | |
| `from` | FieldFrom | 아니오 | tagged union | 값을 꺼낼 곳 |
| `value_type` | `string \| number \| boolean \| date \| enum \| list` | 아니오 | enum이면 `values`, list면 `item_type` 필수 | |
| `values` | string[] | 조건부 | enum에서 필수 | 허용 값 |
| `item_type` | 위 타입 중 list 제외 | 조건부 | list에서 필수 | |
| `required` | boolean | 아니오 | 기본 false | 규칙 `required_field`의 지름길 |
| `visibility` | `public \| private` | 아니오 | Type이 private이면 private | 다른 context가 가리킬 수 있는지 |

### FieldFrom

| kind | 필드 | 뜻 |
|---|---|---|
| `frontmatter` | `key` | 개체 문서의 frontmatter 키 |
| `yaml` | `file`, `key_path` | YAML 문서의 키 경로(`@std/yaml`로 읽음) |
| `section` | `heading`, `include_children` | 개체 문서의 section 본문 |
| `path` | `capture` | Source pattern에서 잡은 값(번호, 폴더 이름) |
| `title` | | 문서의 첫 제목 또는 section heading |
| `links` | `within` heading?, `to_type` Type 이름? | 문서 안 링크의 목록 |
| `outline` | `max_level` | 문서의 제목 tree 목록 |
| `item` | `key_path` | app-data 개체(결과 배열의 항목)의 key 경로 |

`file`은 `folder` Source의 개체에서 어느 파일을 읽을지 정한다. folder에서는 필수이고 다른 Source에서는 쓰지 않는다(개체의 문서 자체를 읽는다).

Source kind마다 쓸 수 있는 FieldFrom:

| Source kind | FieldFrom |
|---|---|
| `folder` | `path`, `yaml`(`file` 필수) |
| `docs`, `series`, `index` | `frontmatter`, `yaml`(`file` 없음), `section`, `path`, `title`, `links`, `outline` |
| `section` | `path`, `title`, `section`, `links`, `outline` |
| `outline` | `path`, `title` |
| `app-data` | `item` |

`path`의 capture 이름: series는 pattern의 번호 자리 이름(`n`, `major`, `minor`, `patch`), folder는 `folder`, 문서가 있는 개체는 `file`(확장자 뺀 파일 이름)과 `path`(Project 기준 경로). key field는 list가 아니다.

## Relation (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | Type 안 유일 | 관계 이름(about, scenarios) |
| `label` | string | 아니오 | 공백만 있는 문자열 금지 | 사람이 읽는 말("runs on") |
| `to` | string | 아니오 | Type 이름 또는 `context/type` 외부 참조(public만) | 대상 type |
| `via` | string | 아니오 | 이 Type의 field 이름; 그 field의 값(`list`면 항목들)이 대상의 key | 연결 field |
| `cardinality` | `one \| optional \| many` | 아니오 | | 다중도 |
| `visibility` | `public \| private` | 아니오 | | 다른 context가 따라갈 수 있는지 |

## CheckRule (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | string | 아니오 | Type 안 유일 | 위반이 가리키는 규칙 |
| `kind` | `required_field \| unique_key \| relation_target_exists \| enum_value \| pattern \| count_range` | 아니오 | | 규칙 종류 |
| `params` | object | 아니오 | kind별: `required_field`·`enum_value` `{field}`, `unique_key` `{fields?}`, `relation_target_exists` `{relation}`, `pattern` `{field, regex}`(ECMAScript, u flag), `count_range` `{field?, min?, max?}`(field가 있으면 그 list 길이, 없으면 type의 개체 수) | |
| `message` | string | 아니오 | 공백만 있는 문자열 금지 | 사람이 읽는 말 |

## DeclaredSearch (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | 소문자 식별자; Contract 안 유일 | |
| `title` | string | 아니오 | 공백만 있는 문자열 금지 | 사람이 읽는 이름 |
| `inputs` | SearchInput[] | 아니오 | 이름 유일; 빈 목록 허용 | |
| `query` | Query | 아니오 | Contract의 type·field·relation만 참조 | |
| `result` | ResultView | 아니오 | | |

### SearchInput

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | 검색 안 유일 | |
| `label` | string | 아니오 | | 화면 이름 |
| `type` | `entity \| value \| range \| text` | 아니오 | | 다른 개체 고르기 / 값 고르기 / 범위 / 자유 입력 |
| `of` | string | 조건부 | entity면 Type 이름, value면 `Type.field`, range면 number·date field | 후보의 출처 |
| `many` | boolean | 아니오 | 기본 false | 여럿 고르기 |
| `required` | boolean | 아니오 | 기본 false | |

### Query

선언형이다. 실행기는 순수 함수이고 같은 파일 상태와 입력이면 같은 결과를 낸다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `from` | string | 아니오 | Type 이름 | 시작 type |
| `where` | Condition | 예 | | 조건 |
| `follow` | Follow[] | 아니오 | 빈 목록 허용 | 관계 따라가기 |
| `sort` | `{path, dir}`[] | 아니오 | 빈 목록이면 Type의 자연 순서(series면 번호 순, 아니면 key 순) | 정렬 |
| `group` | `{by path}` | 예 | | 묶기 |

- Condition은 `all`·`any`·`not` 조합과 비교 `{path, op, value}`다. op은 `eq, ne, in, lt, lte, gt, gte, contains, exists`이고 value는 literal 또는 입력 참조 `{input}`이다.
- Follow는 `{relation, as, from?, direction, where?}`다. `from`은 출발 별칭이고 없으면 시작 type이다. direction은 `forward`(이 type의 relation을 따라감) 또는 `reverse`(이 type을 가리키는 쪽을 찾음)이고 `as`는 이후 path의 별칭이다.
- path는 시작 type의 `field` 또는 `별칭.field` 모양이며 따라간 관계의 field까지만 갈 수 있다. `key`와 `path`는 모든 개체가 가진 field다. 다른 context의 type은 public field만 읽는다.
- 동점은 key와 경로 순으로 결정한다. locale에 의존하지 않는다.

### 실행 규칙

선언 검색 실행기는 순수 함수다. 입력은 계약, 검색 이름, 입력 값, 개체 집합(추출 결과), cursor이고 같은 입력이면 같은 결과다. 정답 test는 `packages/documents/contexts/search/`가 eval-project fixture로 둔다.

- **입력.** 입력 값은 이름 → 값이다. `entity`는 개체 key 문자열, `value`는 값, `range`는 `{from?, to?}`, `text`는 문자열이고 `many`면 배열이다. 선언에 없는 이름이나 모양이 틀린 값은 `input_invalid`, required가 빠지면 `input_required`다. 주지 않은 선택 입력을 가리키는 조건은 참으로 본다.
- **follow.** 관계 간선(`links`)으로 별칭에 개체를 붙인다. forward는 출발 개체의 그 관계 간선이 가리키는 key의 개체, reverse는 그 관계 간선으로 출발 개체 key를 가리키는 개체다. 붙는 개체가 여럿이면 행이 그만큼 늘고(조합마다 한 행), 하나도 없거나 follow.where를 지나는 것이 없으면 그 행을 뺀다(inner join).
- **조건.** path 값이 list면 항목 중 하나라도 맞으면 참이다. 비교 값이 배열(입력 `many` 포함)이면 `eq`는 `in`처럼 동작한다. `eq`·`ne`은 같은 값, `in`은 배열에 든 값, `lt`·`lte`·`gt`·`gte`는 number끼리는 수, 문자열(날짜는 ISO 문자열)끼리는 code unit 순으로 비교하고 `null`이면 거짓이다. `contains`는 문자열이면 부분 문자열(대소문자 구분), list면 항목이다. `exists`는 `null`도 `[]`도 아닐 때 참이다. `ne`는 `eq`의 부정이다. `range` 입력은 `{from, to}` 양 끝을 포함하는 `gte`·`lte`다.
- **순서.** `sort`가 없으면 시작 type이 series면 추출 순서(번호 순), 아니면 key의 code unit 순이다. `sort`는 앞에서부터 비교하고 `null`은 방향과 상관없이 마지막이다. 다 같으면 시작 개체 key, 경로, 그 다음 별칭 개체의 추출 순서다. `group`이 있으면 group 값으로 먼저 묶는다(같은 규칙으로 비교).
- **결과 행.** 행은 시작 개체의 `{type, key, path, section}`와 column마다 `{path, value, ref}`다. column path의 field가 `key`이면 `ref`가 그 개체(`{type, key, path, section}`)이고 아니면 `null`이다. 결과의 개체는 이 ref로 그 파일(+ section)을 연다.
- **page.** table은 `page_size`씩 끊고 다음 page cursor와 전체 행 수를 준다. cursor는 다음 시작 위치와 (검색 이름, 입력)의 지문을 담는다. 다른 검색이나 입력의 cursor는 `cursor_mismatch`다.
- **board.** `board_by` 값마다 lane 하나다. enum field면 선언한 값 순서(행이 없어도 lane을 둔다), 다음 선언 밖 값의 code unit 순, 마지막에 `null` lane(행이 있을 때만)이다. enum이 아니면 값의 code unit 순 다음 `null`이다. lane마다 `page_size`개까지 싣고 남은 수를 준다.

### ResultView

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `table \| board` | 아니오 | | |
| `columns` | `{label, path}`[] | 아니오 | table이면 1개 이상 | 보여 줄 값 |
| `board_by` | path | 조건부 | board에서 필수 | 열을 나누는 값 |
| `page_size` | 양의 정수 | 아니오 | 기본 30, 최대 100 | cursor로 이어 봄 |

결과의 개체는 그 개체의 파일 경로(+ section)를 연다. 결과 행에 개체 key와 경로를 항상 담는다.

## Example (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `search \| entity` | 아니오 | tagged union | |
| `search` | string | 조건부 | search 가지에서 필수; BundleContent.searches의 이름 | 부를 검색 |
| `inputs` | JSON | 조건부 | search 가지; 검색 입력과 맞음 | |
| `expect_keys` | string[] | 조건부 | search 가지; 결과의 key를 순서대로 | 맞아야 하는 결과 |
| `path` | string | 조건부 | entity 가지에서 필수 | 개체로 읽혀야 할 파일 |
| `section` | string | 예 | entity 가지 | |
| `expect` | `{type, key, fields?}` | 조건부 | entity 가지; fields는 일부만 | 읽힌 개체 |

## SavedViewDef (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | 공백만 있는 문자열 금지; 판 안 유일 | |
| `search` | string | 아니오 | BundleContent.searches의 이름 | |
| `inputs` | JSON | 아니오 | 검색의 입력과 맞음; 고정 값 | 고정 입력 |

## SavedView (`viw`)

선언된 검색의 호출을 고정 입력으로 저장해 이름 붙인 것이다. 열 때마다 검색을 다시 계산한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `viw` ID | 아니오 | PK, 불변 | |
| `context` | `ctx` ID | 아니오 | → Context | |
| `name` | string | 아니오 | 공백만 있는 문자열 금지; `(context, name)` 유일 | |
| `search` | string | 아니오 | 적용된 판의 검색 이름 | |
| `inputs` | JSON | 아니오 | 검색 입력과 맞음 | 고정 입력 |
| `origin` | `user \| engineer` | 아니오 | user는 사람이 검색 결과에서 저장; engineer는 판 적용에서 반영 | |
| `revision` | event seq | 아니오 | 마지막 변경 seq | CAS 기준 |

### 불변 조건

- 일반 조건(제목에 든 말·본문 검색어·형식·바뀐 기간·보관 상태)으로 만든 saved view는 없다. `search`는 BundleContent에 선언된 검색이어야 한다.
- 새 판의 격리 검사는 지금 모든 SavedView와 판의 `saved_views` 정의를 함께 호출해 본다. 호출이 깨지면 그 판은 failed다.
- 판이 적용되면 `saved_views` 정의를 이름 기준으로 반영한다(같은 이름은 갱신, 없는 이름은 `engineer` origin으로 생성). 정의에 없는 기존 SavedView는 지우지 않는다.
- 열린 saved view는 적용된 판으로 계산한다. 적용된 판에서 호출이 깨진 SavedView는 깨졌다고 표시하고 지우지 않는다.

## ContextCheck (`chk`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `chk` ID | 아니오 | PK, 불변 | |
| `context` | `ctx` ID | 아니오 | → Context | |
| `bundle` | `cbn` ID | 아니오 | `bundle` 유일 | 검사한 판 |
| `status` | `running \| passed \| failed` | 아니오 | 아래 전이만 | |
| `snapshot_hash` | sha256 | 아니오 | 임시 snapshot의 (경로, 내용 hash) 목록의 hash | 검사한 파일 상태 |
| `findings` | CheckFinding[] | 아니오 | failed면 1개 이상 | 실패 이유 |
| `violation_count` | 0 이상 정수 | 조건부 | passed·failed에서 필수 | snapshot에서 센 위반 수 |
| `started_at` | UTC 시각 | 아니오 | | |
| `finished_at` | UTC 시각 | 예 | running이면 null | |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `running` | `machine` | Bundle이 checking | `ContextBundleSubmitted` |
| `running` | `passed` | `machine` | 아래 정책의 모든 단계 통과 | `ContextBundleApplied` |
| `running` | `failed` | `machine` | 어느 단계라도 실패 또는 검사 프로세스 중단 | `ContextBundleCheckFailed` |

### CheckFinding (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `contract_invalid \| cross_project_path \| private_reference \| example_mismatch \| saved_view_broken \| aborted` | 아니오 | | 실패 종류 |
| `target` | string | 예 | 판 안 위치(type, 검색, 예, saved view 이름) | |
| `detail` | string | 아니오 | redaction 대상; 큰 내용은 blob 참조 | 사람이 읽는 이유 |

임시 snapshot은 검사 동안만 쓰는 읽기 전용 파일 사본이다. 검사가 끝나면 지운다. 문서의 판이 아니다.

## Entity (derived)

적용된 판이 index에서 계산해 두는 개체이다. ledger에 두지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `context` | `ctx` ID | 아니오 | | |
| `bundle_hash` | sha256 | 아니오 | 계산한 판 | 판이 바뀌면 다시 계산 |
| `type` | string | 아니오 | Contract의 Type 이름 | |
| `key` | string | 아니오 | `(context, type, key)` 유일 | |
| `path` | string | 아니오 | Project 기준 상대 경로 | 개체의 파일 |
| `section` | string | 예 | section·outline 개체에서 heading | |
| `fields` | JSON | 아니오 | Field 이름 → 값 | |
| `links` | `{relation, target_key}`[] | 아니오 | 관계 간선 | |

`outline` source의 개체와 outline field는 저장하지 않는다. `app-data` 개체도 저장하지 않는다.

### 추출 규칙

같은 파일 상태와 같은 계약이면 같은 개체·순서·값이 나온다. fixture와 정답은 `packages/documents/contexts/testdata/`(eval-project)에 있다.

- **순서.** 계약의 type 순서대로, type 안에서는 series는 번호 capture의 수 순(같으면 경로 순), docs·folder는 경로의 code unit 순, index는 링크 순, section은 문서 경로 순 다음 문서 안 순서, outline은 `from_type` 개체 순 다음 문서 안 순서, app-data는 결과 순서다.
- **key.** key field의 값을 문자열로 쓴다(`exp-001-plan.md`의 `{n:03}` capture는 `"001"`).
- **field 값.** 선언한 field는 모두 싣고 값이 없으면 `null`이다. list는 없으면 `null`, 빈 목록이면 `[]`이다. frontmatter·YAML 값은 `@std/yaml`로 읽고 string field의 scalar는 문자열로 바꾼다. enum은 허용 값 밖이어도 그대로 싣는다(검사가 위반으로 센다).
- **title.** 문서 개체는 첫 H1 글, section·outline 개체는 그 heading 글이다.
- **section field.** 개체의 범위(문서 개체는 문서 전체, section 개체는 그 section) 안에서 이름이 같은 첫 heading의 본문이다. heading 줄은 빼고 앞뒤 빈 줄을 자른다. `include_children`이 false면 다음 heading 앞까지다.
- **path capture.** series 번호 자리 이름, folder의 `folder`, 문서가 있는 개체의 `file`(확장자 뺀 파일 이름)과 `path`.
- **links field.** 문서 안 링크를 그 문서 폴더 기준으로 푼 Project 경로의 목록이다(존재는 보지 않는다, `https:`·`mailto:`·`#`만 있는 링크는 뺀다). `to_type`이 있으면 그 type 개체의 경로에 맞는 링크만 남기고 값은 그 개체의 key로 바꾼다(모든 개체를 계산한 뒤). 그래서 관계의 via가 될 수 있다.
- **outline field.** `max_level`까지의 heading을 문서 순서대로 `{level, title}` 목록으로 둔다.
- **links(관계 간선).** 관계 선언 순서대로, via 값(list면 항목 순서)마다 `{relation, target_key}` 하나. via가 `null`이면 간선이 없다. 대상이 있는지는 보지 않는다(검사 `relation_target_exists`가 본다).
- **index.** 문서의 Markdown 링크 `[글](경로)`를 그 문서 폴더 기준으로 풀어 순서대로 개체로 삼는다. 대상 문서가 없거나 Project 밖이면 개체를 만들지 않고 `broken_link` 위반(근거 path는 index 문서, `target`은 푼 경로)이다.
- **series.** pattern에 맞는 파일이 개체다. pattern의 폴더에서 같은 확장자인데 pattern에 맞지 않는 파일은 `path_mismatch` 위반이다.
- **읽기 실패.** frontmatter YAML을 읽지 못하는 등 개체로 읽을 수 없는 파일은 개체를 만들지 않고 `unreadable` 위반이다.
- **app-data.** port가 돌려준 결과에서 `result_path`를 따라간 배열의 항목 하나가 개체 하나다. path는 `app:<app>/<command>`, section은 `null`이다.

순수 함수가 내는 위반은 `{kind, rule, type, path, section, target}`이다. 문구(message)는 읽기 쪽이 붙인다(rule이면 CheckRule.message, 나머지는 wording). 추출이 `unreadable`·`path_mismatch`·`broken_link`를, 검사(checks)가 `rule`을 낸다. 위반 순서는 path, kind, rule, section의 code unit 순이다.

## Violation (derived)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `context` | `ctx` ID | 아니오 | | |
| `bundle_hash` | sha256 | 아니오 | 감지한 판 | |
| `kind` | `rule \| unreadable \| path_mismatch \| broken_link` | 아니오 | | 위반 종류 |
| `rule` | string | 조건부 | `rule`이면 `Type.rule id` | 어긴 규칙 |
| `type` | string | 예 | | 관련 type |
| `path` | string | 아니오 | | 근거 파일 |
| `section` | string | 예 | | 근거 section |
| `target` | string | 예 | | `relation_target_exists`의 없는 대상 key, `broken_link`의 푼 경로 |
| `message` | string | 아니오 | | 사람이 읽는 말 |

`(context, kind, rule, path, section, target)`이 키다(같은 개체가 없는 대상 둘을 가리키면 위반 둘이다). 같은 파일 상태에서는 같은 위반 집합이 나온다. 위반은 ledger 밖 상태다. 위반 수만 `Context.violation_mark`로 ledger에 남는다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Context | 소속 | Project → documents/projects | N:1 | Project 보관은 Context를 같이 보관하지 않지만 검색은 읽기 실패로 표시 |
| Context | 판 | ContextBundle | 1:N | 판은 지우지 않는다 |
| ContextBundle | 검사 | ContextCheck | 1:0..1 | |
| Context | saved view | SavedView | 1:N | |
| Context | 용어집 | Term → documents/terms | 1:N | Context 보관은 Term을 바꾸지 않음 |
| Context | 쓰는 preset | Preset → lophn-agent/presets | N:N | 보관은 preset 후보에서만 뺌 |
| Type | 개체 위치 | project 파일 · App read 명령 → apps/blueprint | N:N | 파일이 없으면 개체가 없다; 규칙이 요구하면 위반 |
| Type | 참조 | 다른 Context의 public Type | N:N | 참조 대상이 private으로 바뀌면 다음 검사에서 실패 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `contexts` | `id, project, title, purpose, status, applied_bundle, violation_mark, revision` | PK `id` | `(project, title)` | `(project, status)` | project → documents/projects; applied_bundle → `context_bundles.id`; revision → platform/ledger |
| `context_bundles` | `id, context, number, parent, content, bundle_hash, status, check, created_by, revision` | PK `id` | `(context, number)` | `(context, status)` | context → `contexts.id`; content → platform/blob-store; check → `context_checks.id` |
| `context_checks` | `id, context, bundle, status, snapshot_hash, findings, violation_count, started_at, finished_at` | PK `id` | `bundle` | `(context, status)` | bundle → `context_bundles.id`; findings의 큰 내용 → platform/blob-store |
| `saved_views` | `id, context, name, search, inputs, origin, revision` | PK `id` | `(context, name)` | `(context)` | context → `contexts.id` |
| `context_app_data` | `context, app` | PK `(context, app)` | | | context → `contexts.id`; app → 적용된 판의 계약이 `app-data` Source로 읽는 앱 slug(apps/registration) |

`context_app_data`는 판을 적용할 때(`bundle.finish_check`의 적용, `bundle.rollback`) 같은 transaction에서 그 판의 계약으로 다시 채운다. 판 content(blob)를 열지 않고 "이 context가 어느 앱의 data를 읽는가"를 알려는 읽기 권한이 쓴다. 판이 적용되지 않은 context는 행이 없다.

### derived store 표

지우고 다시 만들 수 있다. 계약이 가리키는 경로의 크기·수정 시각으로만 최신을 판단한다.

| 표 | 담는 것 | 키 |
|---|---|---|
| `context_scan_stats` | `context, path, size, mtime, bundle_hash, scanned_at` | `(context, path)` |
| `context_entities` | Entity | `(context, type, key)` |
| `context_entity_links` | `context, type, key, relation, target_key` | `(context, type, key, relation, target_key)` |
| `context_violations` | Violation | `(context, kind, rule, path, section)` |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `context.create` | `user`, Context Engineer의 `agent` | `id, project, title, purpose`, idempotency key | project 존재·활성; ID 미존재 | `ContextCreated` | `invalid_input`, `conflict`, `forbidden` |
| `context.archive` | `user` | `context` | base_revision; drafting·active | `ContextArchived` | `not_found`, `conflict`, `forbidden` |
| `context.unarchive` | `user` | `context` | base_revision; archived | `ContextUnarchived` | `not_found`, `conflict`, `forbidden` |
| `bundle.save_draft` | Context Engineer의 `agent` | `context, bundle?, content` | draft 없거나 base_revision; Context archived 아님 | `ContextBundleDraftSaved` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `bundle.discard_draft` | Context Engineer의 `agent`, `user` | `bundle` | base_revision; draft | `ContextBundleDraftDiscarded` | `not_found`, `conflict`, `forbidden` |
| `bundle.submit` | Context Engineer의 `agent` | `bundle` | draft; 다른 checking 없음; 스키마 유효 | `ContextBundleSubmitted` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `bundle.finish_check` | 좁은 범위 `machine` | `check, result, findings, violation_count` | checking 판; running 검사; 결과 중복 없음 | `ContextBundleApplied` 또는 `ContextBundleCheckFailed` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `bundle.rollback` | `user` | `context, bundle` | base_revision; 대상이 superseded | `ContextBundleRolledBack` | `not_found`, `conflict`, `forbidden` |
| `view.save` | `user` | `context, name, search, inputs` | 이름 유일; 검색 존재; 입력 유효 | `SavedViewCreated` | `invalid_input`, `conflict`, `forbidden` |
| `view.update` | `user` | `view`, 바꿀 필드 | base_revision | `SavedViewUpdated` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `view.delete` | `user` | `view` | base_revision | `SavedViewDeleted` | `not_found`, `conflict`, `forbidden` |
| `context.record_violations` | 좁은 범위 `machine` | `context, count, bundle_hash` | active; count가 violation_mark와 다름 | `ContextViolationsRecorded` | `not_found`, `conflict`, `forbidden` |
| `context.hand_off_violations` | `user` | `context, violations?`(없으면 전부), idempotency key | active; 위반 존재; 근거는 서버가 붙임 | `ContextViolationsHandedOff` | `invalid_input`, `not_found`, `forbidden` |

`context.create`는 사람이 [New context]에서 Context Engineer와 대화한 뒤 Context Engineer가 부르는 것이 기본 경로다.

## 읽기

읽기는 `user`와 lophn `agent`(역할 무관)만 한다. coding agent와 `machine`에게는 통로가 없다. 결과는 모두 `as_of_seq`를 가진다.

| 읽기 | 입력 | 결과 | 비고 |
|---|---|---|---|
| `context.list` | `project, status?, cursor?, limit?` | Context 줄(적용 판 번호, 진행 중인 판) | 보관 안 된 것 먼저, 제목 순 |
| `context.get` | `context` | Context, 적용된 판 요약 | |
| `context.overview` | `context` | 판 hash, type별 개체 수(계약의 type 순서), 위반 수 | |
| `context.contract` | `context` | 적용된 판의 id·hash·content(계약, 검색, saved view 정의, 예) | 적용된 판이 없으면 셋 다 null. 보관된 context도 읽는다 |
| `context.draft` | `context` | 만드는 중인 판의 진행 `{step, bundle, content, check}` | drafting이 아니면 null |
| `context.search` | `context, search, inputs, cursor?, page_size?` | 행 page, 조건에 맞는 전체 행 수 `total` | 활성이고 판이 적용된 context만 |
| `context.input_options` | `context, search, input, prefix?, limit?` | 후보 `{value, label}`[], `complete` | 같은 조건. entity·value 입력만 |
| `context.entity` | `context, type, key` | 개체 하나 `{ref, fields, relations}`; relation마다 `{name, label, targets}` | 활성이고 판이 적용된 context만. 적용된 판의 index에서 읽는다 |
| `context.series_next` | `context, type` | series pattern과 다음 이름 `next {key, path, from, complete, taken}` | series kind type만. 활성이고 판이 적용된 context만 |
| `context.preview` | `context, bundle, cursor?` | type별 개체 수(계약의 type 순서), 위반 수와 위반 page, 판 단계 finding | 만드는 중인 `draft` 판만. 지금 project 파일로 추출해 보기만 한다 |
| `context.violations` | `context, cursor?, limit?` | 위반 page. 줄마다 `handed_off` | |
| `context.bundles` | `context, cursor?, limit?` | 판 이력과 검사 보고 | 번호 내림차순, draft가 맨 앞 |
| `context.saved_views` | `context` | saved view와 `broken` | 이름 순 |
| `context.containing` | `project, path` | 이 경로를 Source로 덮는 활성 context | 제목 순 |
| `glossary.list` | `context` | 용어 항목 전부 | |

- **검색 행.** `context.search`의 행은 실행 규칙의 결과 행과 같은 모양이다. 시작 개체의 `ref {type, key, path, section}`와 열마다 `cells {path, value, ref}`다. `key` 열은 `ref`로 그 개체(별칭 개체 포함)를 연다. board 결과도 같은 행이고 board_by 값을 가리키는 cell을 싣는다(board_by가 열이 아니면 열 뒤에 덧붙인다). `total`은 page와 상관없이 조건에 맞는 전체 행 수다.
- **draft.** 만드는 중인 context의 `step`은 판의 상태로 정한다. 판이 없으면 1(읽기), draft 또는 검사에 떨어진 판이 있으면 2(초안), 검사 중인 판이 있으면 3(검사)이다. 지금 판은 draft, 없으면 검사 중인 판, 없으면 번호가 가장 큰 failed 판이다. 적용되면 context가 active가 되어 `draft`가 null이다. `content`는 submit 전에는 검사되지 않은 JSON 객체다.
- **후보.** entity 입력은 그 type의 개체 key와 title(field `title`이 있으면 그 글, 아니면 key)을 key의 code unit 순으로 낸다. value 입력은 field의 서로 다른 값(list는 항목마다)이다. enum이면 선언한 값 순서가 앞이고(행이 없는 값도 둔다) 그다음 나머지 값을 수는 크기 순, 글은 code unit 순으로 낸다. `prefix`는 값의 글이나 label이 그것으로 시작하는 후보만 남긴다(ASCII 대소문자 무시). `limit`(기본 50, 최대 200)로 자르고 잘렸으면 `complete`가 false다.
- **handed_off.** 위반의 키 `(kind, rule, path, section)`가 이 context의 `ContextViolationsHandedOff` event에 든 적이 있으면 true다. 위반이 해소된 뒤 같은 키로 다시 생겨도 true로 남는다.
- **entity.** `context.entity`는 적용된 판의 index에서 `(type, key)` 개체를 읽는다. `ref`와 선언한 field 전부(`fields`, 값이 없으면 `null`)를 싣고, `relations`는 type이 선언한 관계 전부를 선언 순서로 싣는다. 관계마다 `targets`는 개체의 관계 간선 순서(via 값의 순서)로 같은 context의 대상 type 개체 ref를 낸다. 대상이 index에 없으면 그 간선은 건너뛰고 간선이 없으면 `[]`다. 다른 context 대상(`context/type`)은 싣지 않는다(`[]`). 검색 행의 `key` 열과 별칭 개체가 가리키는 개체도 이 읽기로 읽는다. 개체가 없으면 `not_found`, type이 계약에 없으면 `invalid_input`, app-data kind type은 index에 개체가 없으므로 `not_found`다. 같은 `(type, key)` 개체가 둘이면(unique 규칙 위반) 추출 순서의 첫 개체다.
- **series_next.** `context.series_next`는 series kind type의 `source.pattern`과 index에 있는 그 type 개체의 `path`들로 다음 이름을 계산한다(계산 규칙·빈 제안·`*`·`taken`은 → documents/series). 파일 목록을 따로 읽지 않으므로 index를 갱신한 뒤 읽으며, 읽기는 파일·ledger·index를 바꾸지 않는다. series kind가 아닌 type이나 계약에 없는 type은 `invalid_input`이다.
- **preview.** `context.preview`는 Context Engineer가 draft를 submit하기 전에 지금 project 파일에서 무엇이 나올지 본다. `bundle`은 그 context의 `draft` 상태 판이어야 한다(없는 판이나 다른 context의 판은 `not_found`, draft가 아닌 판은 `conflict`). draft content를 격리 검사와 같은 추출·위반 감지로 지금 파일에 돌린다. 판·파일·ledger·index·violation_mark를 바꾸지 않고 event도 없다. `types`는 계약의 type 순서로 지금 파일에서 뽑은 개체 수다(app-data kind는 앱 read 명령을 부르지 않으므로 0). `findings`는 격리 검사의 (1)(2)(3)(4)(5)단계 결과이고(사람이 저장한 saved view는 부르지 않는다), (1)(2)(3)에서 멈추면 `types`는 비고 `violation_count`는 0이다. 위반은 path, kind, rule, section의 code unit 순이고 한 page는 30개며 `cursor`는 그 판(`bundle`)에 묶인다(다른 판의 cursor는 `invalid_input`). 호출마다 새로 추출하므로 page 사이에 파일이 바뀌면 보이는 위반이 달라질 수 있다. 결과를 온전히 만들지 못하면 부분 결과로 꾸미지 않고 `unavailable`이다(파일 수·바이트·시간 예산 초과, 파일을 읽을 수 없음, worker 중단).
- **앱 하나에 묶인 agent.** App Engineer의 credential은 담당 앱 하나에 묶인다(→ lophn-agent/roles/app-engineer). 이 agent는 담당 앱을 `app-data` Source로 읽는 context(`context_app_data`의 slug가 담당 앱을 가리키는 context)의 `context.get`·`context.overview`·`context.contract`·`glossary.list`만 읽는다. `context.contract`는 overview 자료의 type 뜻·관계를 그리는 데 쓴다. `context.list`는 그 context의 줄만 남긴다. 그 밖의 읽기와 모든 command, 그 앱을 읽지 않는 context, 없는 context는 모두 같은 `not_found`다.
- Operator 수는 이 읽기들에 없다(→ lophn-agent/presets).

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ContextCreated` | `ctx` | `project, title, purpose` | shell |
| `ContextArchived` | `ctx` | `before_revision` | lophn-agent/presets, shell |
| `ContextUnarchived` | `ctx` | `before_revision` | lophn-agent/presets, shell |
| `ContextBundleDraftSaved` | `cbn` | `context, parent, content` blob 참조 | shell |
| `ContextBundleDraftDiscarded` | `cbn` | `context` | shell |
| `ContextBundleSubmitted` | `cbn` | `context, number, bundle_hash, check` | documents 검사 worker |
| `ContextBundleCheckFailed` | `cbn` | `context, number, check, findings` | shell |
| `ContextBundleApplied` | `cbn` | `context, number, previous_applied, check, violation_count` | documents index, lophn-agent/harness/prompt-assemble, shell |
| `ContextBundleRolledBack` | `cbn` | `context, number, previous_applied, before_revision` | documents index, lophn-agent/harness/prompt-assemble, shell |
| `SavedViewCreated` | `viw` | `context, name, search, inputs, origin` | shell |
| `SavedViewUpdated` | `viw` | 바뀐 필드의 before·after, before_revision | shell |
| `SavedViewDeleted` | `viw` | `before_view, before_revision` | shell |
| `ContextViolationsRecorded` | `ctx` | `before, after, bundle_hash` | platform/notifications |
| `ContextViolationsHandedOff` | `ctx` | `violations`(Violation 키 목록), `evidence` blob 참조, 만든 Run | lophn-agent/harness/run-loop |

## 정책

- **index 갱신.** 검색을 하거나 context를 열기 전에 계약이 가리키는 경로만 `stat`(크기·수정 시각)으로 훑는다. 이전 `context_scan_stats`와 같으면 건너뛰고 다르면 그 파일만 다시 읽어 Entity를 갱신한다. 그 밖에 활성 context의 계약 경로 파일이 바뀐 것을 감지하면 같은 갱신을 그 context에 예약한다. 변화 자체는 기록·event가 없다. 판이 바뀌면(bundle_hash 다름) 전부 다시 계산한다. 이 표를 지워도 같은 결과로 다시 만든다.
- **outline·app-data.** outline은 저장하거나 index에 넣지 않고 쓸 때 파싱한다. app-data는 검색할 때 명령을 부르고 결과를 저장하지 않는다. 첫 구현은 명령 호출 port와 fake까지이며 실제 앱 read 명령 연결은 마지막에 한다.
- **추출.** frontmatter와 YAML은 `@std/yaml`로, Markdown section·제목·링크는 documents/formats의 추출을 쓴다. 읽을 수 없는 파일은 개체를 만들지 않고 `unreadable` 위반이다. 개체가 읽혔지만 규칙을 어기면 개체는 index에 두고 `rule` 위반을 남긴다.
- **위반 감지.** index를 갱신한 뒤 규칙과 pattern을 판정한다. `path_mismatch`는 계약 pattern에서 벗어난 이름·자리, `broken_link`는 index의 링크 대상이 없을 때다. 위반은 근거 파일·section·규칙을 모두 담는다. 위반이 있어도 나머지 개체의 검색은 막지 않는다.
- **위반 수 기록.** 위반 수가 `Context.violation_mark`와 다르면 `context.record_violations`로 기록한다. 늘었을 때(after > before)만 platform/notifications가 notification을 만든다. 줄거나 같으면 notification이 없다. 보관된 Context의 위반은 기록하지 않는다.
- **위반 넘기기.** `context.hand_off_violations`는 사람의 요청에서 이어진 Context Engineer의 Run 하나를 만든다. 근거(파일 경로·section·규칙·현재 규칙 정의)는 서버가 붙이고 사람이 설명을 쓰지 않는다. 같은 위반 집합의 중복 요청은 idempotency key로 하나다(→ lophn-agent/harness/run-loop, lophn-agent/handoff).
- **격리 검사.** submit한 판의 내용을 쓰기 불가 프로세스에서 임시 snapshot에 대해 실행한다. 순서는 (1) 스키마·계약 유효성(type·관계·field·규칙 참조, 다른 Project 경로 거절), (2) 다른 context 참조가 public인 것만인지, (3) 모든 개체 계산과 위반 수 집계, (4) 예(examples)가 모두 맞는지, (5) 모든 SavedView와 판의 saved view 정의가 호출되는지다. (1)(2)(4)(5) 중 하나라도 실패하면 failed다. (3)의 위반 수는 실패 사유가 아니라 기록이다. 검사 프로세스가 중단되면 `aborted` finding으로 failed다. 시간 예산은 spec에서 정한다.
- **자동 적용.** 통과하면 사람 승인 없이 같은 transaction에서 applied가 된다. 이전 applied는 superseded가 된다. 앱 release의 approval·activation 경로를 쓰지 않는다. 읽기만 하며 바깥 효과가 없기 때문이다.
- **되돌리기.** 사람이 superseded 판을 고르면 그 판을 다시 applied로 한다. 다시 검사하지 않으며 현재 파일과 어긋나는 위반은 다음 갱신에서 센다.
- **public/private 검사.** 다른 Context의 `context/type`을 가리킬 때 그 type·field·relation이 지금 applied 판에서 public이어야 한다. 검사 시점의 applied 판으로 확인한다. 참조된 context의 판이 바뀌어 참조가 깨지면 그 context의 다음 검사에서 실패로 알리고 자동으로 고치지 않는다.
- **권한.** Context Engineer의 `agent`는 draft를 쓰고 submit만 한다. 적용된 판을 직접 고치거나 되돌리지 못한다. 되돌리기·보관은 `user`만 한다. coding agent에게는 context command·읽기 통로가 없다.
- **저장.** 계약 내용은 content blob에, 참조·상태는 ledger 표에 둔다. project 폴더에는 아무것도 쓰지 않는다.
- **근거.** 위반·검색 결과·용어집 근거는 Project 기준 상대 경로와 section(heading)만 담는다. 문서 판이나 `doc@ver` 주소를 담지 않는다.

## 정할 것

- 검사 시간 예산과 검사 한 번의 최대 파일 수·개체 수는 spec에서 정한다.
- 문서 Info의 Contexts 목록은 문서 경로가 어느 Type의 Source에 맞는지를 index에서 계산한다.
- 선언형 query로 표현이 안 되는 검색이 실제로 나오면 QuickJS script를 더한다(→ open-issues documents/contexts#Q10).
