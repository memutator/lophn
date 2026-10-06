---
type: domain-model
concerns: [apps/data]
---
# apps/data

앱 DB schema, migration과 보호 backup의 값을 정의한다.

독립 entity·migration ID·backup ID는 없다. release의 고정 선언과 Activation의 복구 참조를 쓴다(→ apps/releases).

## DataChange (값)

Release.data_changes 안의 불변 값이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `from` | 0 이상 정수 | 아니오 | schema 출발점 | 이전 schema |
| `to` | 0 이상 정수 | 아니오 | to > from; 동일 release에서 경로 중복/분기 금지 | 도착 schema |
| `script_hash` | sha256 | 아니오 | bundle 안 고정 script; → platform/blob-store | migration 코드 |
| `description` | 문자열 | 아니오 | 빈 문자열 금지; 손실 가능한 데이터 명시 | 변경·손실 설명 |

migration은 새 파일로 추가한다. 공개한 기존 script와 release의 DataChange를 고치지 않는다. 현재 schema에서 release.data_schema까지 연속 경로가 있어야 하며 뒤로 가는 script는 없다.

## DataBackup (값)

보호 blob의 내용/metadata이며 Activation.backup_hash가 가리킨다. 일반 문서 blob 읽기 경로로 내보내지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | `app` ID | 아니오 | → apps/registration | 데이터 소유 앱 |
| `activation_seq` | 양의 정수 | 아니오 | → apps/releases의 진행 Activation.started_seq | 복구 시도 |
| `data_schema` | 0 이상 정수 | 아니오 | 실제 backup의 schema | 복원 기준 |
| `database_hash` | sha256 | 아니오 | 일관된 SQLite backup byte | DB snapshot |
| `created_at` | UTC 시각 | 아니오 | → platform/ledger | backup 시각 |

첫 판의 backup 단위는 SQLite DB이며 SQLite backup API로 WAL을 포함한 일관된 내용을 만든다. DB 본체만 파일 복사한 것은 유효 backup이 아니다.

## DataResult (값)

앱 전용 프로세스의 결과다. core가 앱의 임의 성공 주장 대신 시도·실제 schema·무결성을 검증한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `release` | `rel` ID | 아니오 | → apps/releases | activation 대상 |
| `activation_seq` | 양의 정수 | 아니오 | 현재 진행 시도와 일치 | 결과 CAS |
| `invocation` | `inv` ID | 예 | → apps/invocations; migration 결과에는 필수; restore에는 원래 migration ID를 알면 참조 | 원래 migration 관측 |
| `data_schema` | 0 이상 정수 | 아니오 | 실제 확인값 | 결과 schema |
| `integrity_ok` | boolean | 아니오 | 성공 제출은 true | 실제 SQLite 무결성 |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `release.record_backup` | machine | release,activation_seq,보호 backup hash,실제 schema | 같은 진행 시도; 기존 프로세스 종료; expected_schema 일치 | `ReleaseBackupRecorded` | `conflict`, `invalid_input`, `unavailable` |
| `release.record_data_change` | machine | DataResult | 같은 시도·backup 확보; 실제 목표 schema·무결성 | `ReleaseDataChanged` | `conflict`, `invalid_input`, `unavailable` |
| `release.record_data_restore` | machine | DataResult,backup_hash | 같은 시도·새 업무 미개방; backup schema·무결성 | `ReleaseDataRestored` | `conflict`, `invalid_input`, `unavailable` |

이 command는 짧은 참조/결과 저장만 한다. DB open·backup·script run·restore는 transaction 밖 앱 전용 프로세스에서 한다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ReleaseBackupRecorded` | → apps/releases | activation_seq,backup_hash,data_schema | apps/releases, apps/runtime |
| `ReleaseDataChanged` | → apps/releases | activation_seq,invocation,data_schema,integrity_ok | apps/releases, apps/runtime |
| `ReleaseDataRestored` | → apps/releases | activation_seq,invocation,backup_hash,data_schema,integrity_ok | apps/releases, apps/runtime |

## 정책

- **writer.** 운영 프로세스 또는 단독 앱 전용 migration/backup/restore 프로세스만 앱 DB를 직접 연다. core·supervisor·agent는 앱 DB를 열지 않는다. 기본 위치는 apps/<app ID>/data/app.sqlite다.
- **배타.** 기존 프로세스 종료 확인 후 데이터 작업을 시작한다. schema 번호와 migration 내용을 같은 앱 DB transaction으로 확정한다. migration 동안 network·secret·외부 파일·하위 프로세스 권한은 없다(→ apps/permissions).
- **backup 관문.** migration 전 보호 backup 참조를 먼저 ledger에 확정한다. 그 전 새 업무 쓰기는 없다. agent·앱 credential에 운영 backup 읽기 scope를 주지 않는다.
- **실패 복원.** 새 업무 통로를 열기 전의 activation 실패만 backup으로 복원할 수 있다. 무결성·schema 실제 확인 뒤 이전 release를 준비한다. 불확실/복원 실패는 unavailable이며 → problems/reporting.
- **운영 후.** activation commit 뒤 새 업무가 있었을 가능성을 배제할 수 없으면 옛 backup으로 자동 덮어쓰지 않는다. 단절 상태의 모르는 migration을 성공으로 채우거나 무조건 replay하지 않는다.
- **보존.** migration backup은 기본 최근 5개를 유지하되 진행 중 복원이 참조하는 backup은 완료 전 삭제하지 않는다.
- **export.** 고정 blueprint·release 이력·불변 실행 bundle과 정확한 SDK 의존 byte·일관된 SQLite DB 사본을 함께 내보낸다. DB byte 준비는 command 밖 data worker가 수행하고 WAL의 확정 내용을 포함해 무결성을 확인한다. OS keychain의 secret 원값·credential은 포함하지 않고 앱 외부 자료·첨부 파일의 포함 여부를 명시한다. export가 운영 DB 복원이나 외부 효과 취소를 뜻하지 않는다.

## 정할 것

- 업무 첨부 파일을 지원하면 DataBackup의 단위를 DB+첨부로 넓히고 원자성 규칙을 정한다. DB만 복원하고 전체 앱 데이터 복원이라고 하지 않는다.
- 운영 후 사람이 데이터 손실을 확인한 별도 restore를 지원할지 정한다. 현재는 activation 전 실패 복원만 정의한다.
