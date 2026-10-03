---
type: domain-model
concerns: [platform/backup-and-migration]
---
# platform/backup-and-migration

ledger schema 적용 이력, 검증된 backup manifest와 복구 결과의 모양을 정의한다.

## SchemaMigration (값)

설치된 migration 목록과 ledger 적용 이력이다. 독립 entity·ID는 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `version` | integer | 아니오 | 1 이상; 설치된 순서대로 적용; 재사용 금지 | schema 판 |
| `content_hash` | sha256 | 아니오 | 설치된 migration 내용과 같음; 적용 뒤 변경 불가 | 코드 내용 지문 |
| `applied_at` | 시각 | 아니오 | → platform/ledger | 적용 완료 시각 |

현재 schema는 적용된 마지막 version이다. 설치된 지원 판보다 높거나 적용된 migration hash가 달라지면 정상 서비스를 시작하지 않는다.

## BackupManifest (값)

backup 폴더의 manifest이며 ledger에 별도 Backup entity를 만들지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `schema_version` | integer | 아니오 | snapshot의 schema 판 | 복원 호환 기준 |
| `through_seq` | seq | 아니오 | snapshot의 마지막 커밋 seq; S 뒤 자료 포함 주장 불가 | 고정 ledger 위치 |
| `created_at` | 시각 | 아니오 | UTC 밀리초 | 생성 시각 |
| `ledger_hash` | sha256 | 아니오 | 완성된 SQLite snapshot 바이트의 hash | ledger 검사 |
| `blobs` | BackupBlob 목록 | 아니오 | snapshot의 모든 영구 참조 hash 포함; 중복 hash 없음 | 내용 목록 |
| `settings` | literal `ledger` | 아니오 | 명시 사용자 선택은 ledger snapshot에 포함 | 설정 원본 |
| `integrity` | `passed` / `failed` | 아니오 | 실제 SQLite·blob 검사의 결과 | 검증 결과 |
| `complete` | boolean | 아니오 | integrity=passed이고 모든 파일 완료일 때만 true | 복원 가능한 묶음 |

## BackupBlob (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `hash` | sha256 | 아니오 | → platform/blob-store; 파일 존재·실제 hash 검사 | 내용 |
| `size_bytes` | integer | 아니오 | 0 이상; 실제 복사한 크기 | 크기 |

## RecoveryObservation (값)

영역별 복구 command에 제출하는 작은 관측값이다. 각 대상의 상태·event는 해당 concern이 소유한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `target` | ID 또는 자연키 | 아니오 | 복구 점검 대상의 실제 record | 대상 |
| `base_seq` | seq | 아니오 | 점검 시작에 읽은 관련 변경 위치 | 비교 기준 |
| `outcome` | `confirmed` / `not_started` / `unknown` | 아니오 | 실제 관측만; 응답 부재로 not_started 추정 불가 | 결과 확인 |
| `evidence` | 안전한 참조 목록 | 아니오 | 준비·감사·프로세스 종료 등의 실제 근거; 없으면 빈 목록 | 확인 근거 |
| `reason` | string | 예 | unknown이면 원문 없는 이유 필수 | 확인 불가 이유 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `schema_migrations` | SchemaMigration 적용 이력 | `version` | PK | 없음 | 설치된 목록의 version·hash 검증; UPDATE·DELETE 금지 |

migration은 정상 domain command가 아니라 정지 유지보수다. event·ID·actor·payload를 다시 쓰지 않는다. backup manifest와 복구 관측은 별도 ledger 표가 아니다.

## 정책

- **migration writer.** 새 준비·command 접수를 막고 기존 짧은 쓰기를 끝낸 뒤 worker를 정지한다. 정상 writer와 migration writer는 동시에 열지 않는다. migration도 core ledger 실행기만 쓴다.
- **migration 보호.** 일관된 SQLite backup을 만들고 무결성 통과 뒤 변환한다. 단계별 변환과 그 version 이력은 같은 `BEGIN IMMEDIATE` transaction이다. 실패 단계는 전체 롤백하며 이전 완료 판을 유지한다.
- **불변 보존.** entity ID·원문·고정 판·actor·관계를 유지한다. event seq 재발급·payload 수정·blob 교체는 불가다. 성공 뒤 FK·unique·불변 trigger를 검사한다.
- **미지원·손상.** 새 schema·손상 원본은 보존하고 정상 서비스는 열지 않는다. 자동 초기화·다운그레이드·backup 덮어복원은 없다.
- **backup snapshot.** SQLite online backup 또는 일관된 snapshot 기능을 쓴다. 열린 `lophn.db` 파일 하나만 복사하지 않는다. 복사·hash·압축·검사는 worker가 하며 원본 ledger를 쓰지 않는다.
- **backup 참조.** GC·내용 삭제를 막고 고정 snapshot S의 모든 blob 참조를 복사한다. SQLite 무결성·blob 존재·hash를 검증한 manifest만 complete다. 일부 묶음은 복원 가능으로 표시하지 않는다.
- **자동 backup.** 매일 1회 검증된 플랫폼 묶음을 만들고 최근 완료 묶음 7개를 보존한다. 새 실패·미완성 묶음 때문에 마지막 복원 가능 묶음을 삭제하지 않는다. → platform/backup-and-migration#R12
- **migration 복구본.** 변환 전 schema 순번·생성 시각을 이름에 포함하며 성공 직후 자동 삭제하지 않는다. 사람이 필요 범위와 복원 가능 묶음을 확인한 명시 삭제만 허용한다. SQLite page·WAL·OS backup의 물리 흔적 제거는 보장하지 않는다. → platform/backup-and-migration#R3, platform/backup-and-migration#R18
- **포함 범위.** ledger·참조 blob·ledger의 사용자 설정이 기본 묶음이다. 앱 업무 DB(→ apps/data), 원본 파일, OS keychain과 token 원문(→ platform/secrets, platform/identity)은 자동 포함되지 않는다. derived store는 복원 뒤 재생성한다.
- **restore.** 모든 writer·worker 정지와 현재 자료의 별도 보존 뒤 검증 묶음으로 교체한다. 복원 시 잃을 최신 기록 범위를 확인한다. 실행 credential 재검증·재발급과 derived cursor 초기화가 필요하다. 다른 ledger의 같은 숫자 seq를 이어 쓰지 않는다.
- **재시작.** SQLite 복구·schema 확인 뒤 정상 읽기를 연다. 전체 file scan·index·큰 hash를 기다리지 않는다. 미완료 작업은 해당 소유 concern이 관측 뒤 command로 처리한다. unknown을 성공·미실행으로 채우지 않는다.
- **효과.** 프로세스 재기동은 작업 재실행과 다르다. 외부 접수 뒤 결과 미확인은 자동 반복하지 않는다. 같은 idempotency key로 확정 결과를 확인한다(→ platform/ledger).

## 정할 것

- backup manifest 교환 구조·상대 경로의 구현 contract는 → platform architecture와 맞춘다. 정기 backup은 매일 1회·최근 완료 7개다.
- migration 전 backup의 명시 삭제 UI·안전한 삭제 관측 방법. 명시 삭제까지 보존하며 물리 흔적 제거는 보장하지 않는다.
- 전체 컴퓨터 이전에 앱 DB·원본·keychain을 묶는 범위와 쓰기 정지 조건. 여러 컴퓨터 동기화는 첫 판에 없다(→ platform/backup-and-migration#R19).
