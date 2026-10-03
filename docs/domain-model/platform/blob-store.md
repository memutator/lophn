---
type: domain-model
concerns: [platform/blob-store]
---
# platform/blob-store

불변 blob의 content address, 준비 참조와 영구 참조 목록을 정의한다.

## BlobRef (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `hash` | string | 아니오 | 소문자 16진 64자; 저장된 정확한 바이트의 sha256 | content address |
| `size_bytes` | integer | 아니오 | 0 이상; 저장된 바이트 수와 같음 | 크기 |

같은 hash의 내용은 하나이며 변경·덮어쓰기하지 않는다. hash는 읽기 권한이 아니다. 내용의 종류·format·redaction 상태는 내용 소유 concern이 정한다.

## PreparedBlob (값)

ledger command에 제출하는 신뢰 worker의 준비 결과다. 독립 entity가 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `preparation` | string | 아니오 | 신뢰 worker가 발급한 불투명 식별; 임의 hash 주장으로 대체 불가 | 준비 식별 |
| `principal` | string | 아니오 | → platform/identity; 준비 요청 주체와 같음 | 준비 소유자 |
| `purpose` | string | 아니오 | 등록된 저장 목적; 다른 목적의 요청에서 임의 사용 불가 | 사용 목적 |
| `hash` | sha256 | 아니오 | BlobRef와 같음; 완성된 내용만 | 준비된 내용 |
| `size_bytes` | integer | 아니오 | 0 이상; worker가 실제 관측 | 실제 크기 |

준비 성공은 도메인 판·근거의 확정이 아니다. 영구 참조 등록 전에 죽으면 고아 blob이 남을 수 있다.

## PermanentBlobReference (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `owner_kind` | string | 아니오 | 등록된 소유 record 종류; entity·event·공통 설정의 종류 | 참조 소유 종류 |
| `owner_key` | string | 아니오 | entity ID, event seq 십진 문자열 또는 해당 공통 값의 고정 key | 소유 record |
| `field` | string | 아니오 | 등록된 blob 필드 경로; 목록은 원소 위치까지 구별 | 소유 record 안 위치 |
| `hash` | sha256 | 아니오 | 확인된 PreparedBlob 또는 기존 허용 참조 | 참조 대상 |
| `registered_seq` | seq | 아니오 | → platform/ledger; 도메인 확정 event seq | 등록 시점 |

### 불변 조건

- 모든 영구 참조는 도메인 변경과 같은 ledger transaction에서 등록한다. 고정 판, event payload, message, model input·output, 테스트 근거를 빠뜨리지 않는다.
- 보관된 entity, 옛 판과 감사 근거의 참조도 살아 있는 참조다.
- 같은 내용을 공유해도 scope·audience가 합쳐지지 않는다. 각 소유 record의 읽기 권한을 검사한다.
- 커밋된 참조의 blob이 없거나 hash가 다르면 `unavailable`이다. 빈 내용·성공으로 채우지 않는다.

## BlobReadResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `hash` | sha256 | 아니오 | 허용된 소유 대상·고정 판에서 얻은 참조 | 내용 |
| `size_bytes` | integer | 아니오 | 전체 내용 크기 | 전체 크기 |
| `offset_bytes` | integer | 아니오 | 0 이상, 전체 크기 이하 | 실제 시작 |
| `length_bytes` | integer | 아니오 | 0 이상; offset + length ≤ size | 실제 반환 길이 |
| `truncated` | boolean | 아니오 | 요청 구간을 모두 주지 못했으면 true | 잘림 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `blob_refs` | PermanentBlobReference | `(owner_kind, owner_key, field, hash)` | PK | `(hash)`, `(owner_kind, owner_key)`, `(registered_seq)` | `registered_seq → events.seq`; 다형 owner는 소유 모듈 검증; hash 대상은 파일이므로 FK 없음 |

blob 자체와 준비 파일은 ledger 표가 아니다. 참조 목록은 공통 기반이 도메인 command 안에서만 쓴다. blob prepare·read·GC는 파일 작업 계약이며 ledger command나 domain event를 별도로 만들지 않는다.

## 정책

- **경로.** 완성 blob은 `~/.lophn/blobs/sha256/<hash 앞 2자>/<나머지 62자>`, 임시는 `~/.lophn/blobs/tmp/`다. API는 내부 파일 경로를 받지 않는다.
- **설치.** 같은 파일 시스템의 임시 파일에 스트리밍 저장하며 그 바이트로 sha256를 계산한다. 파일 sync 뒤 원자적 설치하고 지원 OS에서는 디렉터리도 sync한다. 기존 같은 hash는 재사용하며 덮어쓰지 않는다.
- **준비 검사.** 예상 hash 불일치·크기 한도 초과는 `invalid_input`, 디스크 부족·손상은 `unavailable`이다. core는 작은 신뢰 준비 메타데이터만 검사하고 다시 파일을 읽거나 hash하지 않는다.
- **redaction.** 외부 출력·보고용 복사본은 → platform/redaction을 마친 뒤 저장한다. 사람 원본 문서의 보존은 → documents/versions이며 출력용 redaction과 섞지 않는다.
- **GC.** 첫 구현은 정지 유지보수만 허용한다. 새 준비·command를 막고 진행 준비를 끝내거나 중단한 뒤 writer를 닫는다. 고정 ledger의 모든 `blob_refs`와 비교해 미참조 blob·임시 파일만 유예 뒤 삭제한다. 정상 동작 중 나이만 보고 삭제하지 않는다.
- **복구.** blob 설치와 SQLite commit은 공동 원자 작업이 아니다. 미참조 준비는 고아로 남을 수 있으나 참조된 내용의 부재는 저장소 손상이다.
- **삭제.** 큰 근거의 기간별 삭제는 내용 소유 concern의 정책과 공통 참조 흔적 정책이 정해진 뒤에만 허용한다. event는 수정·삭제하지 않는다(→ platform/ledger).

## 정할 것

- blob 크기·스트림·읽기 구간 한도, 준비 식별 수명, 정지 GC의 유예 기간.
- 상세 근거 삭제 후 참조 유지와 `content unavailable` 표현. 현재는 참조된 blob을 기간만으로 삭제하지 않는다.
- 지원 OS의 원자 설치·sync 보장과 검증 범위.
