---
type: domain-model
concerns: [coding-agent/repair-context]
---
# coding-agent/repair-context

요청 때 조립하는 수리 묶음의 구성, 대표 근거 선택과 크기 상한을 정의한다.

## RepairContext (값)

현재 허용된 정본을 읽어 조립하는 derived 응답이다. 별도 entity·ID·blob 정본·ledger 표·상태·event는 없다. Ticket 없는 직접 수리도 같은 구성으로 problem 하나를 읽을 수 있다. 전송 framing은 → coding-agent/mcp-server, coding-agent/cli이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | 앱 ID | 아니오 | → apps/registration | 대상 앱 하나 |
| `ticket` | `tkt` ID | 예 | 같은 앱의 repair ticket; → coding-agent/tickets | 직접 수리면 null |
| `problems` | 문제 ID[] | 아니오 | 중복 금지; ticket이면 Ticket.problems와 같음; 직접 수리면 요청 problem 하나; → problems/grouping | |
| `observed_at` | UTC 시각 | 아니오 | 공통 시각 형식 | |
| `basis` | `{concern, id, revision}[]` | 아니오 | 조립 때 읽은 대상의 변경 seq; 불변 대상은 생성 seq | 현재 조회 근거; 당시 snapshot과 구별 |
| `sections` | RepairContextSection[] | 아니오 | 아래 순서 보존; 여러 문제의 내용은 problem별로 구분 | |
| `truncated` | boolean | 아니오 | 생략이 하나라도 있으면 true | |
| `bytes` | integer | 아니오 | 최종 UTF-8 텍스트 0~24,576 bytes | |
| `lines` | integer | 아니오 | 최종 텍스트 0~300줄 | |

## RepairContextSection (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | 아래 절 kind | 아니오 | 정한 절 순서 | |
| `problem` | 문제 ID | 예 | 문제별 절이면 필수; 공통 ticket·반환 안내는 null 가능 | |
| `content` | UTF-8 text | 아니오 | 내용은 참조·요약·excerpt이며 정본 복제 저장 없음 | |
| `sources` | `{concern, id?, event_seq?, version?, hash?}[]` | 아니오 | 각 내용의 실제 읽기 근거; blob hash는 단독 접근 권한 아님 | |
| `availability` | `available \| missing \| redacted \| forbidden \| truncated` | 아니오 | 실제 수집·접근 상태 | |
| `reason` | string | 예 | available 외에는 필수 | 없는 기록·가림·접근 불가·잘림의 구별 |
| `more` | RepairEvidenceRead[] | 아니오 | 잘림이면 실제 추가 읽기 하나 이상; 빈 목록 허용 | |

### 절 순서와 내용

내용도 누락 사실도 없는 빈 절만 뺀다. mandatory 근거를 축약하더라도 실제 정본으로 이어 읽을 수 있어야 한다. 요약은 acceptance check의 전체 조건을 대체하지 않는다. 별도 머리 정보는 앱·문제·상태·현재 claim 연결·횟수·처음/마지막 시각·발생 release를 6줄 이하로 낸다. 문제 summary는 문제당 2줄·전체 10줄·1,200자 이하다. 아래의 줄·문자·개수 상한과 전체 상한을 모두 적용한다.

| 순서 | kind | 담는 것·정본 참조 | 기본 묶음의 절 상한 |
|---|---|---|---|
| 1 | `target_symptom` | 앱·ticket 제목, 문제 증상·발생 시각 → apps/registration, coding-agent/tickets, problems/grouping | 문제당 1줄·전체 2줄 |
| 2 | `human_text` | 사람 feedback·보고 원문 excerpt → problems/feedback, problems/reporting | 전체 5줄·문제당 300자 |
| 3 | `inspect` | 고정 근거 주소·볼 위치 → coding-agent/tickets, documents/addressing | 10줄·5개; 본문 대신 주소 |
| 4 | `acceptance_checks` | ticket acceptance check 참조·요약 → coding-agent/tickets; 직접 수리는 기존 확인 기준이 있을 때만 | 8줄·200자 요약 + 전체 조건 읽기 |
| 5 | `preserve` | ticket의 유지 제약 → coding-agent/tickets | 8줄·200자 요약 + 전체 제약 읽기 |
| 6 | `failure_basis` | 보고·snapshot의 당시 시각·release·실패 invocation·고정 source 근거 → problems/reporting, problems/snapshots, apps/releases | 실패 invocation 15줄 이하 |
| 7 | `representative_occurrences` | 아래 선정한 실제 Report 참조·snapshot excerpt → problems/reporting, problems/snapshots | 최대 3개·전체 30줄·각각 400자 |
| 8 | `preceding_changes` | 첫 발생 부근 release·문서 등의 실제 변경 참조 | 최대 12개·14줄·각각 100자 |
| 9 | `logs` | snapshot이 가리키는 안전한 log excerpt → problems/snapshots | 기본 묶음 전체 45줄; 추가 페이지는 200줄 |
| 10 | `past_repairs` | 최신 고친 기록·실제 Verification 참조 → problems/repairs, problems/tests | 최신 5개·10줄 + 더 읽기 |
| 11 | `related_problems` | 같은 앱의 관련 문제 참조 → problems/grouping | 관계 묶음마다 5줄·전체 10개 + 더 읽기; 재귀 묶음 없음 |
| 12 | `attachments` | snapshot 첨부 참조·종류·크기 → problems/snapshots | 40줄·이미지 metadata 최대 20개; command 결과 각각 3행; binary는 기본 텍스트에 넣지 않음 |
| 13 | `reproduction` | 원래 증상 재현 절차·고정 테스트 기준 → problems/tests, coding-agent/tickets | 6줄·500자 + 전체 근거 읽기 |
| 14 | `more` | 종류별 추가 근거 읽기 | 5줄 + cursor; 근거 목록은 추가 페이지로 이어 읽음 |
| 15 | `return_method` | ticket 완료 보고 또는 직접 고친 기록·test 요청의 참조; 실제 command 표현은 → coding-agent/mcp-server, coding-agent/cli | 4줄 |

## RepairEvidenceRead (값)

추가 근거 요청·이어 읽기 참조다. cursor 형식과 text·JSON·이미지 framing은 transport spec이 정한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `problem` | 문제 ID | 아니오 | 현재 connection scope 안; → problems/grouping | |
| `kind` | `log \| occurrences \| source_diff \| screen \| image \| fix_records \| verifications \| reference` | 아니오 | enum | |
| `source` | 정본 참조 | 아니오 | Report·Snapshot·Release·Version·event seq 등; 각 대상 concern이 정의 | 임의 파일 경로 입력 없음 |
| `cursor` | opaque string | 예 | 첫 페이지는 null; 고정 대상·범위·다음 위치를 유지 | |

| 추가 근거 kind | 응답 한 페이지 상한 | 제약 |
|---|---|---|
| `log` | 200줄 | 실제 저장 근거만 읽으며 cursor 제공 |
| `occurrences` | 20개 | report 목록·고정 evidence 참조; 넘침 cursor |
| `source_diff` | 300줄 | 고정 release source끼리 비교; 현재 변화와 당시 사실 구별 |
| `screen` | UTF-8 24,576 bytes | 안전한 화면 상태 텍스트; 넘침 cursor |
| `image` | 이미지 하나 2,097,152 bytes | redaction 뒤 제공; 미지원 통로에는 허용된 로컬 첨부 열기 참조·종류·크기 제공; 큰 이미지 부분 읽기 가능 여부는 정할 것 |
| 나머지 | 텍스트 응답 최대 UTF-8 24,576 bytes·300줄 | 정본 참조로 이어 읽기; 구조·Unicode를 깨뜨리지 않음 |

모든 추가 텍스트 페이지에도 UTF-8 24,576 bytes·300줄의 전체 상한을 함께 적용한다. 이미지 binary는 별도 상한이며 base64를 기본 묶음에 넣어 텍스트 상한을 우회하지 않는다.

## 정책

- **정본 범위.** problem·Report·Snapshot·Ticket·Release·Invocation·고친 기록·Verification·해석 고정 판은 각 concern 정본을 참조한다. 현재 조립 결과를 과거 snapshot의 사실로 바꾸지 않는다. 내부 agent의 prompt나 자체 repair attempt entity를 만들지 않는다.
- **대표 발생.** 첫 발생·마지막 발생·근거가 가장 다른 발생을 중복 없이 최대 3개 고른다. 발생 순서는 원래 Report 접수 event seq다. 동일 후보면 낮은 Report seq를 우선한다. 근거 차이의 비교 방식은 정할 것에 둔다.
- **직전 변화.** 첫 발생 시각 7일(`604,800,000ms`) 전부터 조회 현재 시각까지의 변경 중 첫 발생에 가까운 시각 순으로 최대 12개를 고른다. 같은 거리면 낮은 event seq를 우선하며 결과 순서와 ID는 결정적으로 유지한다. 인과관계라는 판정은 하지 않는다.
- **전체 상한.** ticket 하나에 연결된 모든 문제의 절을 합쳐 UTF-8 24 KiB(`24,576 bytes`)와 300줄을 모두 지킨다. 직접 수리의 problem 묶음도 같다. 누락·가림·잘림 표시·이어 읽기 안내도 상한에 포함한다.
- **축소 순서.** 초과면 log → 대표 발생 excerpt → 첨부 metadata 순서로 줄인다. 각 생략 지점에 잘림·원래 범위와 실제 추가 읽기를 남긴다. 그래도 초과면 필수 참조·상태는 유지하고 나머지 내용을 이어 읽기 참조로 바꾸며 조용히 빼지 않는다.
- **접근 검사.** 조립·추가 페이지·첨부 각각에 요청 connection scope를 적용한다(→ coding-agent/connection, platform/identity). ticket reference로 범위 밖 정보를 복사하거나 blob hash를 접근 권한으로 쓰지 않는다.
- **redaction·데이터.** text·JSON·이미지·추가 근거를 반환 전에 → platform/redaction을 적용한다. 사람 말·앱 문자열·log는 명시 data fence 안에 두고 agent 해석과 구별하며 지시·approval 근거가 아니다(→ platform/security). 부분 수집·미검증 등의 한계도 reason과 content에 남겨 summary에서 숨기지 않는다.
- **읽기 무변경.** 묶음·추가 근거 읽기는 claim 생성·갱신·반납이나 problem·ticket 상태를 바꾸지 않는다.

## 정할 것

- `근거가 가장 다른 발생`의 비교 키·가중치. 최소한 고정 Report·Snapshot 근거만 사용하고 결정적 tie-break를 유지한다.
- 첫 발생 부근 변경의 대상 종류와 보존된 source diff가 없을 때의 응답. 없는 diff를 임의 현재 파일 순회로 보충하지 않는다.
- 2 MiB를 넘는 이미지의 안전한 파생 축소·부분 읽기 방식. 제공할 수 없으면 크기와 미제공 이유를 표시한다.
- 실제 cursor·문자 수·줄 수 계산과 이미지 미지원 CLI fallback은 → coding-agent/mcp-server, coding-agent/cli의 spec에서 확정한다.
