---
type: domain-model
concerns: [documents/contexts]
---
# documents/contexts

Context의 목적·항목·관점과 문서 watch의 확인된 변화 기록을 정의한다.

## Context (`ctx`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `ctx` ID | 아니오 | PK, 불변 | |
| `title` | string | 아니오 | 빈 문자열 금지 | |
| `purpose` | string | 아니오 | 공백만 있는 문자열 금지 | |
| `items` | ContextItem[] | 아니오 | 같은 target 중복 금지; 빈 목록 허용 | |
| `revision` | event seq | 아니오 | 마지막 제목·목적·항목·보관 변경 seq | CAS 기준 |
| `status` | `active \| archived` | 아니오 | 생성은 active | |

### 상태

| 상태 | 뜻 |
|---|---|
| `active` | 문서 watch 검사의 구성 대상 |
| `archived` | 문서 watch 검사 중단; 대상 Document·App은 바뀌지 않음 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `active` | `user`, 허용된 Context Engineer의 `agent` | 목적·항목 유효 | `ContextCreated` |
| `active` | `archived` | `user`, 허용된 Context Engineer의 `agent` | base_revision 일치 | `ContextArchived` |
| `archived` | `active` | `user`, 허용된 Context Engineer의 `agent` | base_revision 일치 | `ContextUnarchived` |

### 불변 조건

- Context는 Document·App을 소유하지 않는다. 항목 제거·보관이 target을 변경하지 않는다.
- 같은 Document는 Context마다 다른 관점이 가능하다. Context 안에서는 target당 하나의 항목만 있다. 문서 전체와 section 하나는 다른 target이다.
- 문서 항목은 최신 Version을 따른다. item별 고정 version 옵션은 없다. 실제 읽기·근거 전달은 응답의 고정 ver를 사용한다.
- 상위 Context·용어 상속·Context 간 관계·depth·View는 없다. 읽기량은 → documents/outline-and-search의 요청 값이다.
- item 추가가 읽기 권한을 주지 않는다(→ platform/identity). App Engineer가 관련 Context 목적·용어·항목을 읽더라도 다른 place 문서 본문 권한은 생기지 않는다(→ lophn-agent/roles/app-engineer).
- 구성 변경 event는 이전 값을 작은 payload 또는 blob 참조로 남긴다. run revert는 이후 revision이 그대로일 때만 보상한다(→ lophn-agent/revert).

## ContextItem (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `target` | ContextTarget | 아니오 | canonical target가 항목 키; 별도 ID 없음 | |
| `perspective` | `basis \| reference \| watch` | 아니오 | 아래 관점 표 | |
| `reason` | string | 아니오 | 공백만 있는 문자열 금지 | 목적에 대한 선택 이유 |

| perspective | 표시 | 의미 제약 |
|---|---|---|
| `basis` | 기준 | 해당 판단이 따르는 자료 |
| `reference` | 참고 | 기준을 대체하지 않는 배경 |
| `watch` | watch | 변화 확인 자료; notification 상태가 아님 |

## ContextTarget (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `document \| app_command` | 아니오 | tagged union | |
| `document` | `doc` ID | 조건부 | document 가지에 필수 → documents/versions | |
| `section` | string | 예 | document 가지에서만 허용; null이면 전체; Format key → documents/formats | |
| `app` | `app` ID | 조건부 | app_command 가지에 필수 → apps/registration | |
| `command` | string | 조건부 | app_command 가지에 필수; 실제 blueprint command effect가 read → apps/blueprint | |

다른 가지의 필드는 금지한다. 공개 입력 `{document, section?}` 또는 `{app, command}`는 이 tagged union으로 정규화한다. 앱 입력·응답 데이터를 Context item에 저장하지 않는다. Query entity는 없다. App item의 watch는 자동 호출·자동 변화 event를 만들지 않는다.

## WatchedItemComparison (값)

ledger 밖 계산 결과의 제출 값이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `context` | `ctx` ID | 아니오 | 활성 Context | |
| `context_revision` | event seq | 아니오 | 비교 구성 기준 | |
| `target` | ContextTarget | 아니오 | document 가지의 현재 watch item | |
| `source_seq` | event seq | 아니오 | 원래 DocumentSaved seq → documents/versions | |
| `before_version` | `ver` ID | 예 | 첫 판이면 null; 해당 Document 판 | |
| `after_version` | `ver` ID | 아니오 | 해당 source_seq가 확정한 Document 판 | |
| `result` | `content_changed \| section_added \| section_missing \| unchanged \| unverified` | 아니오 | 아래 판정 정책 | |
| `before_hash` | sha256 | 예 | 전후 전체 content_hash 또는 같은 key body_hash | |
| `after_hash` | sha256 | 예 | section_missing이면 null | |
| `module_hashes` | `{before: sha256?, after: sha256}` | 아니오 | 비교 규약 확인의 근거 | |
| `unverified_reason` | string | 조건부 | unverified면 필수 | |

### 불변 조건

- source_seq 당시의 항목 구성 근거와 현재의 같은 target·perspective·Context revision을 함께 검사한다. 현재 추가된 item을 과거부터 있던 item으로 취급하지 않는다.
- 최신 판이 더 생겨도 제출한 before→after의 고정 판 변화만 기록한다.
- `content_changed`, `section_added`, `section_missing`만 확인된 변화 event가 된다. unchanged·unverified는 event가 아니다.
- `(context, canonical target, after_version)`은 중복키다. 동일 재전달에는 event 하나만 있다.
- 변화 event는 구성 변경이 아니며 Context revision을 바꾸지 않는다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Context | 항목 참조 | Document → documents/versions 또는 App → apps/registration | N:N | 자동 item 제거 없음; 읽기 실패 표시 |
| Context | 용어 범위 | Term → documents/terms | 1:N | Context 보관은 Term 정의 변경 없음 |
| ContextItem | section 선택 | section → documents/outline-and-search | N:0..1 | missing 표시; 자동 대응 없음 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `contexts` | `id, title, purpose, revision, status` | PK `id` | 없음 | `(status, id)` | revision → platform/ledger |
| `context_items` | `context, target_key, position, target_kind, document, section, app, command, perspective, reason` | PK `(context, target_key)` | `(context, position)` | `(document, perspective)`, `(app, command)`, `(context, perspective)` | context → `contexts.id`; document → documents/versions; app·command → apps/registration, apps/blueprint |
| `context_watch_changes` | `context, target_key, after_version, source_seq, before_version, event_seq, comparison` | PK `(context, target_key, after_version)` | `event_seq` | `(source_seq)`, `(context, event_seq)` | context → `contexts.id`; before·after → documents/versions; source_seq·event_seq → platform/ledger |

`position`은 0부터 연속인 정수다. `target_key`는 tagged target의 canonical encoding이며 전체 문서 null section과 app 가지를 구분한다. nullable 가지는 ContextTarget 조건을 지킨다. watch_changes는 확인된 변화의 중복 방지 근거이며 현재 context_items에 FK를 걸어 제거 때 이력을 잃지 않는다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `context.create` | `user`, 허용된 CE `agent` | `id, title, purpose, items`, idempotency key | ID 미존재; target 유효; app command effect read | `ContextCreated` | `invalid_input`, `conflict`, `forbidden` |
| `context.update` | `user`, 허용된 CE `agent` | `context, title?, purpose?` | base_revision; 종료 run 금지 | `ContextUpdated` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `context.set_item` | `user`, 허용된 CE `agent` | `context, item, position?` | base_revision; target·read command 유효 | `ContextItemSet` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `context.remove_item` | `user`, 허용된 CE `agent` | `context, target` | base_revision; item 존재 | `ContextItemRemoved` | `not_found`, `conflict`, `forbidden` |
| `context.archive` | `user`, 허용된 CE `agent` | `context` | base_revision, active | `ContextArchived` | `not_found`, `conflict`, `forbidden` |
| `context.unarchive` | `user`, 허용된 CE `agent` | `context` | base_revision, archived | `ContextUnarchived` | `not_found`, `conflict`, `forbidden` |
| `context.record_watch_change` | 좁은 범위 `machine` | WatchedItemComparison | source_seq 구성 근거·현재 revision·active·동일 watch target; 중복키 | `ContextWatchedItemChanged` | `invalid_input`, `not_found`, `conflict`, `forbidden` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ContextCreated` | `ctx` | `title, purpose, items` 또는 blob 참조 | documents/outline-and-search, lophn-agent/harness/prompt-assemble |
| `ContextUpdated` | `ctx` | 변경 필드의 before·after, before_revision | documents/outline-and-search, lophn-agent/revert |
| `ContextItemSet` | `ctx` | `target, before_item, item, before_position, position, before_revision` | documents/outline-and-search, documents/contexts, lophn-agent/revert |
| `ContextItemRemoved` | `ctx` | `target, before_item, before_position, before_revision` | documents/outline-and-search, documents/contexts, lophn-agent/revert |
| `ContextArchived` | `ctx` | `before_revision` | documents/contexts, documents/outline-and-search |
| `ContextUnarchived` | `ctx` | `before_revision` | documents/contexts, documents/outline-and-search |
| `ContextWatchedItemChanged` | `ctx` | `target, before_version, after_version, source_seq, change_kind` | platform/notifications |

## 정책

- **문서 전체 watch.** 전후 content_hash가 다르면 content_changed다. format만 바뀐 저장을 내용 변화로 알리지 않는다.
- **section watch.** 같은 key의 body_hash를 비교한다. 성공 추출 뒤 전에는 있고 새 판에는 없으면 section_missing, 전에는 없고 새 판에 있으면 section_added다. 추출 미완료·실패·비교 의미를 확인할 수 없는 module 변경은 unverified다.
- **key 소실.** item은 그대로 두고 missing 또는 unverified를 구분한다. 마지막 key 존재 판을 제시할 수 있으나 최신 section으로 꾸미지 않는다. 비슷한 제목·본문으로 item을 변경하지 않는다.
- **계산 보관.** 미확인 비교·별도 watch event cursor는 ledger 밖 derived store에 보관하고 같은 worker가 재추출 후 재확인한다. item 변경·보관 뒤에는 과거 계산을 적용하지 않는다.
- **notification.** 이 concern은 notification을 직접 생성하지 않는다. platform/notifications가 ContextWatchedItemChanged seq로 생성하며 이 event·notification은 agent run 계기가 아니다.

## 정할 것

- source_seq 시점 구성 근거의 조회와 현재 CAS를 → platform/ledger와 맞춘다. 작은 이전 값 event 또는 일관된 snapshot 읽기가 필요하다.
- 현재 평면 Context 편집 외 분할·병합을 추가할지. 상위 Context·용어 상속은 현재 없다.
- target_key canonical encoding을 다른 읽기·watch 중복 처리와 동일하게 고정한다.

## agent 구성과의 경계

Context는 읽을 자료의 묶음이며 Operator의 담당 대상이나 assignment scope가 아니다. Operator는 → lophn-agent/assignments의 Project 또는 App에 붙고 → lophn-agent/presets의 고정 판에서 Context를 0개 이상 선택한다. 같은 Project/App의 여러 Operator가 다른 Context를 읽을 수 있다. Context 보관·항목 제거가 assignment scope를 자동 변경하거나 새 run을 시작하지 않는다.
