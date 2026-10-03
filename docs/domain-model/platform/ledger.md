---
type: domain-model
concerns: [platform/ledger]
---
# platform/ledger

ledger의 공통 envelope, 식별·시각·오류 값, 확정 command 결과와 subscriber 처리 위치를 정의한다.

## ID (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `prefix` | string | 아니오 | 소문자 ASCII 3자; 아래 목록만 허용 | entity 종류 |
| `ulid` | string | 아니오 | 소문자 Crockford base32 26자; 첫 글자 `0`~`7` | ULID |

직렬화는 `<prefix>_<ulid>`다. ID는 발급 후 바뀌지 않으며 이름·slug·위치와 독립이다. ULID로 변경 순서를 판단하지 않는다.

| 접두사 | entity | 정의 |
|---|---|---|
| `prj` | Project | → documents/projects |
| `doc` | Document | → documents/versions |
| `ver` | Version | → documents/versions |
| `ctx` | Context | → documents/contexts |
| `trm` | Term | → documents/terms |
| `ser` | Series | → documents/series |
| `viw` | SavedView | → documents/outline-and-search |
| `app` | App | → apps/registration |
| `rel` | Release | → apps/releases |
| `grt` | Grant | → apps/permissions |
| `inv` | Invocation | → apps/invocations |
| `pkg` | Package | → apps/sdk |
| `rpt` | Report | → problems/reporting |
| `prb` | Problem | → problems/grouping |
| `snp` | Snapshot | → problems/snapshots |
| `vrf` | Verification | → problems/tests |
| `apr` | ApprovalRequest | → platform/approvals |
| `qst` | Question | → lophn-agent/questions |
| `ntf` | Notification | → platform/notifications |
| `rvt` | Revert | → lophn-agent/revert |
| `pst` | Preset | → lophn-agent/presets |
| `asg` | Assignment | → lophn-agent/assignments |
| `ses` | Session | → lophn-agent/conversation |
| `msg` | Message | → lophn-agent/conversation |
| `run` | Run | → lophn-agent/harness/run-loop |
| `mcl` | ModelCall | → lophn-agent/harness/usage |
| `tcl` | ToolCall | → lophn-agent/harness/tools |
| `pvd` | Provider | → lophn-agent/harness/provider |
| `tkt` | Ticket | → coding-agent/tickets |
| `cac` | CodingAgentConnection | → coding-agent/connection |

## 시각·기간·seq (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `at` | string | 아니오 | UTC ISO 8601 밀리초; `YYYY-MM-DDTHH:mm:ss.sssZ` | 시각 |
| `duration_ms` | integer | 아니오 | 0 이상; 밀리초 | 기간 |
| `seq` | integer | 아니오 | SQLite signed 64-bit 범위; event는 1 이상, 처리 시작 위치는 0 허용 | ledger 순번 |

API의 seq는 정밀도 손실 없는 십진 문자열이다. seq는 단조 증가하고 재사용하지 않는다. 커밋된 seq가 연속이라고 가정하지 않는다. 순서는 seq로만 판정한다.

## ArchiveState (값)

| 값 | 제약 | 뜻 |
|---|---|---|
| `active` | 보관을 지원하는 entity에만 적용 | 보관되지 않음 |
| `archived` | 삭제가 아님; 고정 판과 blob 참조 유지 | 보관됨 |

`active → archived`와 `archived → active`의 actor·조건은 entity 소유 concern이 정한다. 보관 해제 event는 `…Unarchived`, 이전 내용의 새 판 복원은 `…Restored`다.

## EventEnvelope (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `seq` | seq | 아니오 | PK; transaction 안에서 배정 | 전체 변경 순번 |
| `type` | string | 아니오 | 소유 concern의 등록된 `<Entity><과거형 동사>` 이름 | event 종류 |
| `subject` | ID 또는 자연키 string | 예 | entity는 ID; ID 없이 이름으로 구별하는 record는 `<종류>:<키>`(예: `secret:<name>`); null은 lophn 전체 단일 공통 설정만 | 변경 대상 |
| `actor` | Actor | 아니오 | → platform/identity; 인증된 값만 | 변경 주체 |
| `run` | `run` ID | 예 | → lophn-agent/harness/run-loop; 서버가 자격과 연결 확인 | 변경을 만든 run |
| `payload` | JSON object | 아니오 | 등록된 event schema; 작은 메타데이터와 blob 참조만 | 변경 내용 |
| `at` | 시각 | 아니오 | 커밋 시각 | 기록 시각 |

### 불변 조건

- event는 UPDATE·DELETE하지 않는다. 정정과 revert는 새 event다.
- 도메인 변경, event, command 결과는 같은 transaction에 확정된다.
- 끝난 run의 새로운 대상 변경은 거절한다. 늦은 감사 기록 보완만 허용한다.
- event와 subject·payload 참조도 읽는 자격의 범위를 적용한다.

## CommandEnvelope (값)

전송 credential은 → platform/identity, 사람 결정 증거는 → shell/confirmation-window다. 요청 본문의 `actor`는 허용하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `command` | string | 아니오 | 등록된 command 이름; 임의 SQL·함수·경로 불가 | 동작 |
| `input` | JSON object | 아니오 | command 소유 schema; 큰 내용은 → platform/blob-store | 정확한 입력 |
| `idempotency_key` | string | 아니오 | 비어 있지 않음; 최초 시도 전에 고정; 재전달 때 동일 | 요청 식별 |
| `compare` | JSON object | 아니오 | 소유 command가 정한 판·hash·관련 seq; 비교 대상이 없는 생성만 빈 객체 | CAS 기준 |
| `run` | `run` ID | 예 | 자격에 묶인 run만 | 변경 출처 |
| `prepared` | 준비 참조 목록 | 아니오 | 빈 목록 허용; 신뢰 worker가 확인한 불변 참조만 | 외부 준비 결과 |
| `confirmation` | 일회 확인 handle | 예 | 대상·입력·결정·기한·비공개 채널에 묶임; 원문 저장 금지 | 사람 결정 증거 |

### 불변 조건

- 같은 안정된 주체와 key의 같은 요청은 한 번만 확정한다. 같은 key의 다른 입력은 `conflict`다.
- 입력 지문은 command, 정규화 input, compare, run, prepared의 불변 참조와 사람 결정의 대상·내용을 포함한다. 토큰·전송 시도 ID·일회 handle 원문은 제외한다.
- 이미 확정된 요청은 현재 자격을 검사한 뒤 원래 결과를 반환한다. 현재 CAS나 이미 소비한 handle 때문에 새 변경으로 재실행하지 않는다.
- 대상과 판단 근거의 CAS 중 하나라도 다르면 전체 거절한다. 자동 병합·덮어쓰기하지 않는다.

## CommandResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `principal` | string | 아니오 | 서버가 만든 안정된 주체 식별; connection·assignment·app ID 또는 플랫폼 주체 식별; 토큰 원문 불가 | key의 범위 |
| `idempotency_key` | string | 아니오 | CommandEnvelope와 같음 | 요청 key |
| `fingerprint` | sha256 | 아니오 | 작은 정규화 요청 메타데이터의 지문 | 동일 요청 비교 |
| `result` | JSON object | 아니오 | 확정 결과·대상·판·접수 참조 또는 `unchanged`; secret 제외 | 원래 결과 |
| `first_seq` | seq | 예 | `last_seq`와 함께 null 또는 함께 값; event가 없으면 null | 첫 event |
| `last_seq` | seq | 예 | `last_seq >= first_seq` | 마지막 event |
| `at` | 시각 | 아니오 | 확정 시각 | 보존 기준 |

반환의 `replayed: boolean`은 원래 결과의 재전달 여부이며 저장 결과를 바꾸지 않는다. 외부 작업 접수 결과는 외부 효과 성공을 뜻하지 않는다.

## SubscriberCursor (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `subscriber` | string | 아니오 | 등록된 ledger 반응 처리기 이름; 자기 자격에 묶임 | 처리기 |
| `processed_through_seq` | seq | 아니오 | 0 이상; 감소 금지; 읽어 지나간 커밋 위치 이하 | 확정 처리 위치 |

구독 출력의 `scanned_through_seq`는 필터·범위로 생략한 event까지 읽어 지나간 위치다. `head_seq`는 해당 읽기 snapshot의 끝이다. event 전달만으로 cursor를 올리지 않는다. 반응 command의 idempotency 기준은 `(subscriber, cause_seq, reaction)`이다.

## DerivedProvenance (값)

ledger 밖 derived store에만 둔다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `source_versions` | ID 목록 | 아니오 | 읽은 고정 판; 빈 목록은 seq 구간 근거가 있을 때만 | 판 근거 |
| `source_seq_from` | seq | 예 | `source_seq_through`와 함께 사용 | 기록 구간 시작 |
| `source_seq_through` | seq | 예 | 시작 이상 | 기록 구간 끝 |
| `method` | string | 아니오 | 생성 방식의 판 또는 불변 hash | 생성 규칙 |
| `indexed_through_seq` | seq | 아니오 | 해당 derived store의 로컬 확정 위치 | 반영 위치 |

## Error (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `code` | error code | 아니오 | 아래 공통 코드 또는 소유 concern의 등록 코드 | 실패 종류 |
| `message` | string | 아니오 | 안전한 설명; 원문 입력·stack·token·secret·범위 밖 존재 제외 | 설명 |
| `details` | JSON object | 예 | schema가 정한 안전한 필드만 | 고칠 항목·기준 |

| code | 조건 |
|---|---|
| `invalid_input` | schema·값·한도 위반 |
| `unauthorized` | 자격 없음·위조·만료·회수·종료 |
| `forbidden` | 유효 자격의 종류·범위·현재 조건 밖 |
| `not_found` | 허용 범위의 대상 없음 |
| `conflict` | CAS 불일치·이미 처리된 조건·같은 key의 다른 요청 |
| `unavailable` | 적체·유지보수·저장 공간·안전한 경계 불가 |
| `internal` | 플랫폼 내부 실패 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `events` | EventEnvelope | `seq INTEGER PRIMARY KEY AUTOINCREMENT` | `seq` | `(subject, seq)`, `(run, seq)`, `(type, seq)` | `run → runs.id`; subject·actor는 다형 참조이므로 소유 모듈 검증; UPDATE·DELETE 금지 |
| `command_results` | CommandResult | `(principal, idempotency_key)` | PK | `(at)` | `first_seq`, `last_seq → events.seq`; result 참조는 소유 모듈 검증; UPDATE·DELETE 금지 |
| `subscriber_cursors` | SubscriberCursor | `subscriber` | PK | 없음 | `processed_through_seq`는 전역 watermark; 0·seq 간격 허용으로 FK 없음 |

공통 기반만 이 표를 쓴다. `blob_refs`는 → platform/blob-store, `schema_migrations`는 → platform/backup-and-migration이다. 도메인 event 없는 기반 변경의 예외는 `command_results`, `subscriber_cursors`, `blob_refs`의 같은 도메인 transaction 등록, `schema_migrations`의 유지보수 기록으로 한정한다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `AdvanceSubscriberCursor` | machine | subscriber, scanned-through seq | 자기 cursor의 이전 seq; 감소 불가 | 없음(기반 메타데이터) | `unauthorized`, `forbidden`, `invalid_input`, `conflict`, `unavailable` |

도메인 반응은 해당 concern command와 cursor 갱신을 한 transaction에서 확정한다. 이 concern은 도메인 event를 추가 정의하지 않는다.

## 정책

- **저장.** → platform/install-and-update가 시작 전에 고정한 data root `H`의 `H/lophn.db` 하나가 ledger이며 writer는 core command 처리 하나다. SQLite는 WAL, `synchronous=FULL`, `foreign_keys=ON`, 잠금 대기 최대 5,000ms다. WAL 불가이면 기동을 거절한다.
- **transaction.** command 하나는 `BEGIN IMMEDIATE` transaction 하나다. 외부 호출·파일 작업·hash·압축·model·앱·테스트를 기다리지 않는다. 중첩 transaction과 내부 commit은 금지한다.
- **확정.** 성공 응답과 통지는 commit 뒤에만 나온다. 입장 queue는 메모리이며 queue 입장은 접수 확정이 아니다. 응답 유실은 미실행 증거가 아니다.
- **읽기.** writer queue를 거치지 않고 읽기 전용 snapshot에서 자격과 결과를 확인한다. 한 응답의 자료와 `as_of_seq`는 같은 snapshot에서 얻는다.
- **event 전달.** seq 오름차순, 적어도 한 번 전달이다. 느린 구독자는 끊고 마지막 처리 위치에서 재연결한다. 오래된 event를 조용히 건너뛰지 않는다.
- **derived store.** 같은 data root의 `H/derived/`에 결과와 처리 위치를 같은 로컬 transaction으로 둔다. 고정 판·생성 방식이 key이며 재생성은 완성본 교체다. 삭제해도 원본·고정 판·ID·사람의 주석·확정 결정은 바뀌지 않는다.
- **derived 최신성.** source 판과 반영 위치를 반환한다. 일부 생성 성공을 전체 최신으로 표시하지 않는다. model 요약은 원문 대체가 아니며 동일 출력으로 재생성 가능하다고 가정하지 않는다.
- **보존.** event와 확정 command 결과는 임의 삭제하지 않는다. 큰 본문 삭제는 → platform/blob-store와 해당 내용 소유 concern의 정책이 확정된 뒤에만 한다.

## 정할 것

- command JSON 크기·깊이·항목 수, 영향 행 수, 읽기·queue·구독 한도와 기한.
- 정규화 요청 지문의 직렬화 방식과 idempotency key의 길이 한도.
- 확정 command 결과는 → platform/ledger#R10에 따라 기간으로 삭제하지 않는다. 향후 공간 정책이 필요해도 옛 key를 새로운 효과로 받아들이는 정리는 불가하다.
