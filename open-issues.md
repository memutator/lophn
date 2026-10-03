# 열린 질문과 충돌

requirements와 domain model을 concern별로 다시 쓰면서 모은 것이다. 쓰는 동안에는 멈추지 않고 추천안을 적용했다. 여기서 한꺼번에 정하면 해당 concern 문서를 고친다.

- 모두 299건: 질문 204, 충돌 95 (그중 이미 해결 3건)
- 질문: 사람이 정할 것. 충돌: 이전 문서와 지금 모델, 또는 concern 사이가 어긋난 곳.
- "적용"은 지금 문서에 들어가 있는 쪽이다.

## 먼저 정할 큰 것

| 번호 | 질문 |
|---|---|
| H1 | automation이 메일 보내기·결제처럼 바깥 상태를 바꾸는 command(external)를 실행하게 할까. 지금 모델은 금지. 정한 것: secret 사용은 앱에 준 grant가 허락이고, 가져오기·동기화는 external이 아니라 automation으로 돈다. |
| H2 | coding agent의 release activation도 매번 사람 승인할까(추천: 예). |
| H3 | App Engineer의 주기 검토를 둘까(지금: 없음, 사람 요청으로만). |
| H4 | reproduction test를 만들 수 없는 repair ticket을 사람의 확인을 acceptance check로 삼아 허용할까(지금: 불가, ticket 없이 직접 수리). |
| H5 | 터미널 대화형 확인을 승인으로 인정할까(추천: 아니오). |
| H6 | 기술 선택(Electron, Deno, SQLite) 유지(추천: 유지). |
| H7 | App Engineer의 ticket 생성을 매번 묻지 않기로 한 결정(lophn-agent/harness/tool-judgment)을 받아들일까. |
| H8 | Operator가 question에 답을 못 받으면 그 사이 주기를 계속 건너뛴다. 이대로 둘까. |
| G1 | 이 폴더를 git 저장소로 시작할까(change log와 concern별 변경 보기에 필요) |
| G2 | 설계·구현 중 발견한 문제를 `type: problem` 문서로 따로 남길까, 문서 안 열린 질문으로 충분할까 |
| G3 | `docs/flows/jobs.md`(일 목록)를 requirements에 녹이고 지울까, use case 목록으로 남길까 |

## platform (48)

### platform/api

- **platform/api#Q1** [질문] API major 지원 기간과 호환 변경 규칙을 어떻게 고정할까?
  - 선택지: 현재 major만 지원 | 현재와 직전 major 90일 지원 | 사용자 지정 지원 기간
  - 추천: 첫 판은 major 1만 지원하고 같은 major의 선택 필드 추가만 허용하며 upgrade 때 미지원 클라이언트를 명시적으로 거절
  - 적용: R6; 90일 병행 지원은 적용하지 않음
- **platform/api#Q2** [충돌] RPC와 오류 응답의 정확한 wire 식별자를 requirements에 적을까?
  - 선택지: 경로·JSON 필드 그대로 기록 | 동작 규칙은 requirements, 정확한 식별자는 spec
  - 추천: README의 코드 식별자 금지에 따라 의미·구간·HTTP 상태만 요구에 적고 정확한 wire는 platform/api spec에서 고정
  - 적용: R2·R3 의미와 모양 적용

### platform/approvals

- **platform/approvals#Q1** [질문] H5: CLI TTY 확인을 사람의 승인으로 인정할까.
  - 선택지: TTY yes 및 추가 grant 입력 인정 / confirmation window만 인정
  - 추천: confirmation window만 인정; CLI는 화면 열기만
  - 적용: confirmation window만 인정

### platform/backup-and-migration

- **platform/backup-and-migration#Q1** [질문] migration 전 backup의 보존 종료와 삭제 보장은 무엇일까.
  - 선택지: 성공 즉시 삭제 / 명시 삭제까지 보존; 논리 삭제 / 물리 흔적 제거
  - 추천: 명시 삭제까지 보존; 물리 흔적 제거 보장 안 함
  - 적용: R18: 명시 삭제까지 보존
- **platform/backup-and-migration#Q2** [질문] 여러 컴퓨터 동기화를 첫 판에 지원할까.
  - 선택지: 단일 컴퓨터 / 여러 컴퓨터 sync
  - 추천: 단일 컴퓨터; sync는 이후 별도 설계
- **platform/backup-and-migration#Q3** [충돌] event를 180일 뒤 압축 archive로 옮길까.
  - 선택지: 원본 ledger 영구 조회 / online 180일 후 archive
  - 추천: 새 단일 ledger 원본의 영구 조회; 180일 삭제나 이동 없음
  - 적용: platform/ledger 참조; 180일 이동은 미적용
- **platform/backup-and-migration#Q4** [충돌] 미적용 migration 전체를 하나로 확정할까, 단계별로 확정할까.
  - 선택지: ST-17의 전체 단일 transaction / 새 model의 단계별 transaction
  - 추천: 새 domain model의 단계별 원자성
  - 적용: R4: 실패 단계 rollback 및 직전 완료 판 유지
- **platform/backup-and-migration#Q5** [충돌] 매일 자동 backup은 ledger만일까, blob까지 포함한 플랫폼 묶음일까.
  - 선택지: 옛 자동 ledger 복사 / 새 model의 snapshot 참조 blob 포함
  - 추천: 복원 가능한 참조 blob 포함 묶음, 매일 1회 최근 7개
  - 적용: R8·R12: 플랫폼 묶음

### platform/blob-store

- **platform/blob-store#Q1** [질문] 큰 원문·수리 근거·model 호출 본문의 보존 기간과 삭제 뒤 참조 흔적을 어떻게 정할까?
  - 선택지: 참조된 본문 영구 보존 | 종류별 기간 뒤 본문 삭제·부재 흔적 유지
  - 추천: 정책 확정 전에는 참조 blob을 기간만으로 삭제하지 않고 신규 접수를 용량으로 제한
  - 적용: R8·R12
- **platform/blob-store#Q2** [질문] 보안상 전면 삭제를 공유 참조·derived 사본·backup까지 어디까지 보장할까?
  - 선택지: 현재 자료만 차단 | 모든 알려진 참조·derived 사본 철회 | backup 포함 완전 삭제
  - 추천: 첫 판은 자동 전면 삭제를 약속하지 않고 반환 차단과 실제 적용 범위를 명시하며 backup 범위는 platform/backup-and-migration과 합의
  - 적용: R11; 전면 삭제 기능은 없음
- **platform/blob-store#Q3** [충돌] 기동·매일 GC와 현재 모델의 정지 유지보수 GC를 어떻게 함께 지킬까?
  - 선택지: 온라인 삭제 | 주기 점검 후 정지 유지보수 삭제
  - 추천: 주기 점검과 정지 유지보수 삭제 분리
  - 적용: R8·R10
- **platform/blob-store#Q4** [질문] blob 크기·stream·구간 한도와 준비 결과 수명을 얼마로 둘까?
  - 선택지: 단일 유한 기본값 | 내용 종류별 유한 한도
  - 추천: 내용 종류별 유한 한도를 측정해 고정하고 초과 시 명시적 거절·부분 반환
  - 적용: R2·R7; 수치는 미확정

### platform/diagnostics

- **platform/diagnostics#Q1** [질문] security audit을 별도로 제공할까, doctor에 합칠까.
  - 선택지: 별도 security audit / doctor 통합
  - 추천: doctor 상태 점검에 통합
  - 적용: R10: 통합 상태 점검
- **platform/diagnostics#Q2** [충돌] 개발자 진단 화면에 원문 오류를 제공할까.
  - 선택지: 옛 design 원문 상세 / 새 model의 안전 내용만
  - 추천: 새 model에 따라 redaction 안전 내용만
  - 적용: R5: 안전 내용만
- **platform/diagnostics#Q3** [질문] 운영 log 회전 크기·총 보존 한도·crash 기록 기간은 얼마일까.
  - 선택지: 정해진 byte·기간 한도 / 사용자 선택 한도
  - 추천: 플랫폼 실제 크기를 측정한 뒤 byte·기간을 확정; 앱 200줄·500 operation 한도와 섞지 않음
  - 적용: R3: 비동기·크기 제한만, 수치는 없음

### platform/identity

- **platform/identity#Q1** [충돌] 현재 identity의 범위 밖 forbidden과 옛 앱 범위 조회의 not_found 가운데 무엇을 적용할까?
  - 선택지: 모든 범위 밖 403 | 대상 조회는 부재와 동일, 금지 동작은403
  - 추천: 존재 보호를 위해 대상 조회만 안전한 부재 응답을 적용
  - 적용: R10
- **platform/identity#Q2** [충돌] IPv4만인 옛 Host 목록과 현재 IPv4·IPv6 loopback을 어떻게 맞출까?
  - 선택지: 127.0.0.1·localhost만 | 실제 bind의 IPv4·IPv6·localhost 정확 allowlist
  - 추천: 현재 두 loopback 가족을 지원하고 실제 port를 포함한 정확한 목록만 사용
  - 적용: R12
- **platform/identity#Q3** [질문] token 무작위 byte 수·hash 방식·OS별 안전 전달을 무엇으로 정할까?
  - 선택지: OS CSPRNG 32byte·SHA-256 | 다른 검토된 충분한 엔트로피·hash
  - 추천: OS CSPRNG 32byte와 검증된 hash·constant-time 비교 권고; OS 전달은 architecture에서 고정
  - 적용: R5·R6·R13; 엔트로피 수치는 미확정
- **platform/identity#Q4** [충돌] WebSocket token을 subprotocol에 넣는 옛 방식과 token 전송 최소화를 어떻게 맞출까?
  - 선택지: 옛 subprotocol 허용 | 비브라우저 Authorization header만
  - 추천: 정상 클라이언트는 브라우저 밖이므로 HTTP upgrade의 Authorization header만 사용
  - 적용: R6·R11; subprotocol token은 적용하지 않음

### platform/install-and-update

- **platform/install-and-update#Q1** [질문] Electron 없는 headless 서버 지원을 첫 판에 제공할까.
  - 선택지: desktop 전용 / 별도 daemon 설치
  - 추천: desktop 설치만 지원; 창 닫아도 플랫폼 유지
  - 적용: R12: desktop 설치만 지원
- **platform/install-and-update#Q2** [질문] Linux·macOS·Windows별 최소 OS version·CPU·설치 형식·데이터 폴더를 무엇으로 정할까.
  - 선택지: Linux x64 Ubuntu 24.04 이상·.deb·~/.lophn 유지 및 macOS·Windows 값을 별도 확정 / OS별 native 경로·패키지로 통일
  - 추천: 세 OS 지원 약속 유지; Linux 기존 값 유지, macOS·Windows 최소 version·CPU·패키지·기본 폴더는 OS별 실제 검증 때 확정
  - 적용: R1: Linux·macOS·Windows 지원; Linux 값만 확정, macOS·Windows 상세값 없음
- **platform/install-and-update#Q3** [질문] H6 기술 stack Electron·Deno/TypeScript·SQLite를 유지할까.
  - 선택지: 유지 / 대체 stack
  - 추천: 유지
  - 적용: R15: 유지
- **platform/install-and-update#Q4** [질문] lophn 자체 update는 어떻게 제공할까.
  - 선택지: 수동 .deb 재설치 / 자동 update
  - 추천: 첫 판 수동 OS별 설치 패키지 교체; Linux .deb 재설치; 무단 download·install·restart 없음
  - 적용: R13·R14: 수동 패키지 교체

### platform/ledger

- **platform/ledger#Q1** [질문] H6의 SQLite·Deno 기술 선택을 유지할까?
  - 선택지: SQLite·Deno 유지 | 다른 embedded 저장소·runtime
  - 추천: SQLite·Deno 유지; Deno 내장 SQLite 3.53·FTS5와 외부 SQLite 의존성 없음 적용
  - 적용: R1·R2·R23 SQLite·Deno 내장 SQLite 3.53·FTS5
- **platform/ledger#Q2** [질문] core 영역의 반응을 모두 event로만 연결할까?
  - 선택지: 모든 연결 event | 같은 transaction의 불변식·조회 직접 호출과 durable 반응 분리
  - 추천: 불변식 검사는 직접 하고 비동기 반응만 event·처리 위치로 연결하며 불필요한 내부 queue는 추가하지 않음
  - 적용: R3·R15; 일률적인 직접 호출 금지는 적용하지 않음
- **platform/ledger#Q3** [충돌] SQLite NORMAL과 FULL 동기화 가운데 어느 것을 적용할까?
  - 선택지: legacy storage의 NORMAL | agent storage와 현재 domain model의 FULL
  - 추천: 현재 모델의 FULL
  - 적용: R2 FULL
- **platform/ledger#Q4** [충돌] event 온라인 보관 180일과 영구 append-only가 충돌한다.
  - 선택지: 180일 뒤 이동·삭제 | 영구 ledger 기록
  - 추천: 현재 모델의 event와 확정 결과 영구 보존; 용량 부족은 신규 변경 제한
  - 적용: R10 영구 보존
- **platform/ledger#Q5** [질문] command·read·queue·구독·변경 행 수의 유한 한도를 얼마로 둘까?
  - 선택지: 고정 기본값 | 장치별 조정 가능한 유한 기본값
  - 추천: 무제한 금지와 제어 요청 여유를 먼저 적용하고 responsiveness의 검증 부하로 기본값을 결정
  - 적용: R16; 한도 수치는 미확정
- **platform/ledger#Q6** [질문] 확정 command 결과를 공간 때문에 정리할 수 있을까?
  - 선택지: 영구 보존 | 원래 key를 새 효과로 받지 않는 별도 영구 흔적
  - 추천: 첫 판은 영구 보존하고 저장 부족 때 신규 변경을 제한
  - 적용: R10
- **platform/ledger#Q7** [질문] 변화가 어디로 번졌는지 되짚는 영향 관계를 어떤 기록과 소유 concern으로 나타낼까?
  - 선택지: 명시적 원인·대상·run으로 실제 후속 변경 추적 | 별도 공통 영향 관계 모델
  - 추천: R3의 원인·대상·run으로 실제 확정 변경을 추적하고 예상 영향은 실제 전파와 구별; 별도 관계가 필요하면 소유 concern부터 확정
  - 적용: R3·R11 확정된 변경의 근거 연결; 공통 영향 관계 모델은 미확정

### platform/notifications

- **platform/notifications#Q1** [질문] 닫힌 세션 뒤 관련 notification을 어떻게 골라 묶어 보여 줄까.
  - 선택지: 발생 순서대로 모두 이어 읽기 / 관련성 기준 묶음
  - 추천: 개별 근거를 유지하고 발생 순서대로 모두 이어 읽기
  - 적용: R11: 모두 이어 읽기; 임의 고정 개수 없음
- **platform/notifications#Q2** [질문] OS 전달 retry 간격과 실패 표시 시점을 어떻게 정할까.
  - 선택지: 고정 간격 / backoff / 다음 화면 조회
  - 추천: 자동 retry 없이 다음 화면 조회에서 즉시 안전한 실패 이유 표시
  - 적용: R10: 다음 화면 조회; 배달 상태 ledger 없음
- **platform/notifications#Q3** [질문] OS notification 기본 제공을 어떻게 정할까.
  - 선택지: 기본 켬 / opt-in / 창 안만
  - 추천: opt-in; 최소 제목과 대상 열기만
  - 적용: R9: opt-in

### platform/redaction

- **platform/redaction#Q1** [질문] 첫 gitleaks commit과 credential prefix 목록을 무엇으로 고정할까?
  - 선택지: 구현 시점의 한 commit | 검토한 별도 규칙 묶음
  - 추천: 구현 시점에 한 commit과 OpenAI·Anthropic·GitHub·AWS·Slack·JWT·PEM 공통 표본을 고정하고 인증 형태 추가는 같은 정본에 반영
  - 적용: R2; 정확한 commit은 미확정
- **platform/redaction#Q2** [질문] 알려진 secret의 URL encoding·Base64도 자동 검출할까?
  - 선택지: exact value와 고정 패턴만 | 확인된 encoding 추가
  - 추천: 첫 판은 exact value·패턴·명시 비공개 제외를 적용하고 encoding 지원은 누출·오탐 테스트 뒤 추가하며 완전 탐지는 약속하지 않음
  - 적용: R1·R2·R8·R14
- **platform/redaction#Q3** [질문] 수집한 비밀을 패턴 redaction만으로 충분히 막을 수 있을까?
  - 선택지: 패턴만 | 알려진 값·공개 allowlist·미지 값 제외 병행
  - 추천: 패턴만을 안전 근거로 삼지 않고 수집 최소화·알려진 값·명시 정책을 함께 적용
  - 적용: R1·R2·R8
- **platform/redaction#Q4** [충돌] secret 대체 표시는 옛 별표 셋·redacted 표식과 현재 모델의 별표 하나 중 무엇인가?
  - 선택지: 별표 셋 또는 redacted | 별표 하나
  - 추천: 현재 모델의 별표 하나; 화면의 시각 표시는 shell/wording
  - 적용: R6
- **platform/redaction#Q5** [질문] 텍스트·JSON·이미지 크기와 redaction 처리 기한을 얼마로 둘까?
  - 선택지: 매체별 유한 한도 | 동일 유한 한도
  - 추천: 매체별 측정 한도를 정하고 초과·불확실은 원문 제외
  - 적용: R14; 표본·화면 문자열 외 수치는 미확정

### platform/responsiveness

- **platform/responsiveness#Q1** [질문] 응답 목표와 기준 장치·복합 부하 수치를 제품 acceptance 기준으로 채택할까?
  - 선택지: 제안한 p95·p99 채택 | 실제 장치 측정 뒤 조정
  - 추천: 먼저 제안 수치로 구현·측정하고 사용자의 실제 장치 결과로 조정하되 목표와 측정 방법은 제거하지 않음
  - 적용: R6~R10 추천 수치
- **platform/responsiveness#Q2** [질문] queue 크기·주체별 점유·reserved 제어 여유·worker 수의 기본값을 얼마로 둘까?
  - 선택지: 고정 유한값 | 장치별 유한값
  - 추천: 기준 부하에서 R6·R7을 달성하는 유한값을 측정해 고정하며 예약 제어 여유는 반드시 둠
  - 적용: R3·R4; 정확한 개수는 미확정

### platform/secrets

- **platform/secrets#Q1** [질문] Linux Secret Service 없는 desktop·headless에서 어떤 대체 보호 저장소를 지원할까?
  - 선택지: fail closed | 별도 OS 보호 adapter | 파일 볼트 재도입
  - 추천: 현재 모델대로 fail closed; OS adapter는 지원 OS가 확정될 때 정하고 파일 볼트는 재도입하지 않음
  - 적용: R8
- **platform/secrets#Q2** [질문] 암호 보호 secret export의 형식·암호 파생 강도·지원 OS 사이 호환을 어떻게 고정할까?
  - 선택지: 검증된 인증 암호화 export 형식과 지원 OS 공통 import | OS별 보호 export 형식
  - 추천: 검증된 인증 암호화·강한 password 파생을 사용하는 전용 이전 형식; 사람의 명시적 선택과 OS keychain 전용 import로 제한하고 평문 중간 파일 금지
  - 적용: R9 암호 보호 별도 export·import 제공; 형식·파생 수치·OS 호환표 미확정
- **platform/secrets#Q3** [충돌] agent에 secret의 수정·마지막 사용 시각도 내보낼까?
  - 선택지: 옛 메타데이터 네 항목 | 현재 모델의 이름·설정 여부
  - 추천: 현재 모델의 최소 조회를 적용하고 사용 이력은 원값 없이 별도 정책을 정함
  - 적용: R4 이름·설정 여부만

### platform/security

- **platform/security#Q1** [충돌] 배포용 Ubuntu sandbox를 끈 테스트를 성공으로 인정할까?
  - 선택지: 개발 no-sandbox 테스트 인정 | 실제 OS sandbox 테스트 필수
  - 추천: 현재 안전 원칙에 따라 배포에서는 실제 sandbox를 검사하고 개발 우회는 제한만 기록
  - 적용: R4

### platform/settings

- **platform/settings#Q1** [질문] 설정 교환 format version과 옛 항목 migration을 첫 판부터 제공할까.
  - 선택지: version 1 왕복부터 / 모든 옛 항목 migration
  - 추천: version 1 왕복; 실제 항목 변경 update에 명시 변환
  - 적용: R26: version 1 왕복과 명시 변환
- **platform/settings#Q2** [질문] assignment별 지속 설정 override가 필요할까.
  - 선택지: 세 층 유지 / assignment 층 추가
  - 추천: 실제 서로 다른 수요가 생기기 전에는 세 층만 유지
  - 적용: R5: 세 층만; assignment override 거절
- **platform/settings#Q3** [질문] 일반 설정을 자동 reload할까.
  - 선택지: 명시 apply/reload / 자동 reload
  - 추천: 명시 apply/reload만; 외부 파일 감시 없음
  - 적용: R17·R21: 명시 apply/reload
- **platform/settings#Q4** [충돌] 모르는 항목을 경고하고 무시할까, 오류로 거절할까.
  - 선택지: 옛 storage의 경고 후 무시 / CF-13·새 model의 엄격 거절
  - 추천: 엄격 거절
  - 적용: R12: 전체 적용 거절

## documents (52)

### documents/addressing

- **documents/addressing#Q1** [충돌] hash 동일·5글자 shingle Jaccard 0.8 이상·0.5~0.8 대응과 사람 확정을 유지할까.
  - 선택지: 기존 대응·redirect chain / 같은 key만
  - 추천: 같은 key만
  - 적용: R5: 추측 매핑·확정 표·queue 없음
- **documents/addressing#Q2** [질문] section보다 작은 code block·table 주소를 추가할까.
  - 선택지: section·줄 범위만 / block·table 주소
  - 추천: 첫 판 section·줄 범위만
  - 적용: section과 documents/outline-and-search 줄 범위
- **documents/addressing#Q3** [질문] 문서 영문 address 이름을 어떻게 고르고 최대 길이는 얼마로 할까.
  - 선택지: 사람 직접 입력 / 첫 파일에서 자동 제안 후 수정
  - 추천: 자동 제안 후 사람 수정; 최대 길이는 spec에서 결정
  - 적용: R10: 제안 후 수정
- **documents/addressing#Q4** [충돌] 현재 이름 우선·문자열 redirect chain을 유지할까 영구 ID 예약으로 직접 해석할까.
  - 선택지: 현재 이름 뒤 redirect chain / 영구 예약 ID 직접 해석
  - 추천: 영구 ID 예약
  - 적용: R2·R6: 이름 재사용 금지·같은 ID 안내
- **documents/addressing#Q5** [충돌] 저장 위치를 MCP 원본 경로로 자동 결정할까.
  - 선택지: 원본 경로 자동 자리 / 실제 연결·명시 자리·자리 없음
  - 추천: 실제 연결 또는 명시 자리; 없으면 자리 없음
  - 적용: R3: 기본 자리 생성 없음

### documents/contexts

- **documents/contexts#Q1** [질문] context 분할·병합을 실제 동작으로 추가할까.
  - 선택지: 목적·항목 편집만 / 분할·병합 contract
  - 추천: 첫 판 평면 편집만
  - 적용: R5: 현재 개별 편집
- **documents/contexts#Q2** [충돌] context export의 파일 형식과 고정 판 참조 포함 범위를 어떻게 정할까.
  - 선택지: 별도 Markdown·JSON export / platform backup만
  - 추천: context 항목·용어 export; 하위 context 없음
  - 적용: R14: export 제공
- **documents/contexts#Q3** [질문] 상위 context·용어 상속·최대 3단 구조를 추가할까.
  - 선택지: 평면 / 부모·상속·3단
  - 추천: 평면 유지
  - 적용: 부모·상속 없음
- **documents/contexts#Q4** [질문] 문서 사이 영향·근거 간선을 기록하는 contract를 추가할까.
  - 선택지: 직접 항목만 / 별도 documents 관계 concern
  - 추천: 이번은 직접 항목만; 관계는 후속
- **documents/contexts#Q5** [질문] context 목차에 문서·context 관계 간선과 related context를 넣을까.
  - 선택지: 직접 항목만 / 관계 지도
  - 추천: 이번은 관계 지도 없음
- **documents/contexts#Q6** [질문] 확정한 관계로 관련 context를 탐색하게 할까.
  - 선택지: 직접 항목 역조회 / 관계 기반 탐색
  - 추천: 직접 항목 역조회만
  - 적용: R8: 직접 항목 역조회만
- **documents/contexts#Q7** [충돌] watch section rename 자동 추적과 이력의 같은 대응 계산을 유지할까.
  - 선택지: rename 매핑 / 같은 key 비교·소실
  - 추천: 같은 key 비교·소실
  - 적용: R9·R10: 자동 매핑 없음
- **documents/contexts#Q8** [충돌] context 항목의 기준/참고/watch를 깊이 설정과 묶을까.
  - 선택지: 항목별 depth / 읽기 요청의 범위·깊이만
  - 추천: 요청별 읽기 깊이
  - 적용: R1·R4: item 깊이 없음
- **documents/contexts#Q9** [충돌] 새 saved view·series 채택이 context의 View·Series 항목 금지를 바꿀까.
  - 선택지: context target 확대 / 문서·section·앱 read만
  - 추천: context target 유지
  - 적용: R2: view·series 대상 없음

### documents/file-tracking

- **documents/file-tracking#Q1** [질문] agent가 원본 연결 문서를 고치는 통로를 추가할까.
  - 선택지: 별도 제안 문서 / 사람 허락 뒤 원본 반영
  - 추천: 별도 제안 문서와 사람 편집 유지
  - 적용: 원본 직접 저장 금지; 별도 문서 저장은 documents/versions
- **documents/file-tracking#Q2** [충돌] 초기 worker 2개를 요구로 유지할까 구현 조절값으로만 둘까.
  - 선택지: 초기 2개로 시작 후 측정 조정 / 숫자 미지정
  - 추천: 초기 2개 후 측정 조정
  - 적용: R5: 초기 2개
- **documents/file-tracking#Q3** [질문] 안정 읽기 재시도·파일 수·바이트·시간 한도의 초기 값을 무엇으로 할까.
  - 선택지: 실측 설정값 / 고정 제품 상한
  - 추천: 실측으로 정하고 한도 초과는 미확인
- **documents/file-tracking#Q4** [충돌] 편집 세션당 감사 기록 한 번 규칙을 유지할까.
  - 선택지: 세션당 한 번 / 실제 파일 작업별 결과
  - 추천: 작업별 결과
  - 적용: R17: 세션당 한 번 제한 없음
- **documents/file-tracking#Q5** [충돌] 앱의 허용된 파일 I/O도 사람 전용 원본 파일 API로 우회할까.
  - 선택지: 모든 I/O 우회 / 앱 permission에 따른 직접 I/O 별도
  - 추천: 앱 I/O는 apps/permissions 소유
  - 적용: R2는 플랫폼 사람 파일 통로만 제한

### documents/formats

- **documents/formats#Q1** [질문] 설계 문서의 domain story·요구·불변식·테스트·blueprint 연결을 전용 format으로 결정적으로 검사할까.
  - 선택지: 일반 Markdown+eval / 구조화 format validator
  - 추천: 첫 판 일반 Markdown, 판단 품질은 lophn-agent/evaluation
- **documents/formats#Q2** [질문] 문서에 실행 capability를 허용할까.
  - 선택지: 정적·격리 view만 / 실행 capability 문서
  - 추천: 첫 판 정적·격리 view
  - 적용: 실행 capability 없음
- **documents/formats#Q3** [질문] slide·data report의 초기 section 추출을 추가할까.
  - 선택지: 초기 추가 / 후속 format 확장
  - 추천: 후속 확장
  - 적용: R3: 기본 section 추출 없음
- **documents/formats#Q4** [질문] 사람이 추가 format module을 설치할 수 있게 할까.
  - 선택지: 내장만 / fixture·격리 검사 뒤 추가 설치
  - 추천: 첫 판 내장만
  - 적용: 내장 format 요구만 작성
- **documents/formats#Q5** [충돌] 묵시 format 검사 실패에도 원문 version을 남길까.
  - 선택지: 경고만 내고 version 미생성 / 경고와 원문 version 보존
  - 추천: 새 모델의 원문 보존
  - 적용: R5: 원문 version 보존
- **documents/formats#Q6** [충돌] 새 모델의 지원 MIME 목록을 기존 plain text·XHTML·별도 Markdown MIME까지 넓힐까.
  - 선택지: Markdown·HTML만 / 기존 5개 MIME 유지
  - 추천: 기존 5개 MIME 유지
  - 적용: R2: 5개 MIME; domain model 미수정
- **documents/formats#Q7** [질문] 격리 format 실행의 시간·메모리·입출력 상한을 무엇으로 할까.
  - 선택지: 실측 상한 / 고정 보수적 상한
  - 추천: H6 환경 선택 뒤 실측하고 초과 실행만 종료
- **documents/formats#Q8** [질문] 동적 HTML은 원본 HTML과 렌더링 DOM 중 무엇을 추출할까.
  - 선택지: 원본 HTML / 렌더링 DOM
  - 추천: 결정적 원본 HTML
  - 적용: R13: 원본 HTML만
- **documents/formats#Q9** [충돌] 독립 format 규칙 번호와 기존 index 자동 재작성 금지를 유지할까.
  - 선택지: 규칙 번호·index 보존 / 정확한 module 보존·derived 재생성
  - 추천: 정확한 module 보존
  - 적용: R7·R20: 정확한 module; derived는 재생성

### documents/outline-and-search

- **documents/outline-and-search#Q1** [질문] 문서 제목 30자·요약 200자·최상위 section 설명 80자를 organizing model로 보강하는 별도 요청 contract를 둘까.
  - 선택지: 원문 발췌만 / 사람·CE 요청 기반 derived 요약
  - 추천: 먼저 원문 발췌, 후속 요청 기반 cache
  - 적용: R18: 원문 발췌 기본
- **documents/outline-and-search#Q2** [질문] embedding 검색을 추가할까.
  - 선택지: keyword만 / 후속 embedding
  - 추천: 첫 판 keyword만
  - 적용: R10: keyword만
- **documents/outline-and-search#Q3** [질문] 한국어 검색에 기존 trigram을 유지할까 다른 tokenizer로 바꿀까.
  - 선택지: FTS5 기본 / trigram+n<3 부분 일치
  - 추천: 기존 trigram 유지 후 실측
  - 적용: R11: trigram
- **documents/outline-and-search#Q4** [질문] token 추정치를 model별로 보정할까.
  - 선택지: codepoint/3 / model별
  - 추천: 첫 판 codepoint/3
  - 적용: R6: 공통 근사
- **documents/outline-and-search#Q5** [충돌] 기존 section rename 이력과 대응 chain을 새 key 원칙에 맞춰 어떻게 처리할까.
  - 선택지: 유사도·사람 대응 / 같은 key 비교만
  - 추천: 같은 key 비교만
  - 적용: R19: rename 추정 없음
- **documents/outline-and-search#Q6** [충돌] saved view 없음이라는 기존 outline domain model을 이번 채택에 맞춰 확장해야 한다.
  - 선택지: 없음 / 저장 조건·요청 시 목록
  - 추천: saved view 저장 조건
  - 적용: R23~R25 적용; 기존 model 미수정
- **documents/outline-and-search#Q7** [충돌] 단순 offset cursor와 갱신 시각 정렬을 새 기준 고정 규칙에 그대로 쓸까.
  - 선택지: offset만 / 기준·scope·조건 결합 cursor와 event 순서
  - 추천: 기준 결합 cursor
  - 적용: R9: 기준 결합; 시간은 표시만
- **documents/outline-and-search#Q8** [질문] saved view의 처음 지원 조건·정렬 범위를 이대로 둘까.
  - 선택지: 문서 문자열·자리·context·format·보관·시점 / tag·관계·앱 데이터도 추가
  - 추천: 현재 정의된 문서 조건만
  - 적용: R23: 문서 조건; 갱신 순·제목 순 선택

### documents/projects

- **documents/projects#Q1** [질문] 여러 프로젝트의 추적 폴더 겹침 금지를 유지할까.
  - 선택지: 겹침 금지 / 파일별 추적 소유 프로젝트 선택
  - 추천: 겹침 금지
  - 적용: R7: 겹침 금지
- **documents/projects#Q2** [충돌] 폴더의 label·기본 여부와 기본 추적 행의 존재 의미를 새 모델에도 유지할까.
  - 선택지: 기존 필드·행 의미 유지 / 폴더 설명·명시적 추적 스위치
  - 추천: 폴더 설명과 명시적 스위치
  - 적용: R2·R3·R8: label·기본 여부 없음
- **documents/projects#Q3** [질문] 프로젝트의 폴더·원본 경로 정보를 별도 export로 제공할까.
  - 선택지: Markdown·JSON export / platform backup만
  - 추천: 별도 export는 후속으로 두고 지금 backup만
- **documents/projects#Q4** [충돌] 미리보기와 적용 후 파일 목록의 일치를 고정 디스크 snapshot으로 보장할까.
  - 선택지: 목록 고정 / 같은 규칙·구성 기준을 적용하고 새 파일은 재판정
  - 추천: 같은 규칙·구성 기준
  - 적용: R6: 규칙은 동일하되 목록은 디스크 snapshot 아님

### documents/series

- **documents/series#Q1** [충돌] 기존 domain model의 Series 없음 정책을 이번 채택에 맞춰 어떻게 갱신할까.
  - 선택지: 한 문서 판만 / 독립 가족도 허용
  - 추천: 독립 가족 허용
  - 적용: 새 documents/series 모델 작성; 기존 versions 모델 미수정
- **documents/series#Q2** [충돌] 정렬 기준을 format metadata 필드로 둘까 key의 결정적 정렬로 둘까.
  - 선택지: 선언된 format 정렬 값 / key 정렬만
  - 추천: 선언된 format 값과 key fallback
  - 적용: R5: 선언된 정렬 값·결정적 key fallback
- **documents/series#Q3** [질문] 주간 보고용 날짜·주차 다음 이름 규칙을 추가할까.
  - 선택지: 숫자·version 규칙만 / 날짜·ISO week 규칙
  - 추천: 우선 기존 숫자 규칙, 날짜는 수동 key
  - 적용: R7·R8: 날짜 자동 계산 없음
- **documents/series#Q4** [충돌] draft 값을 첫 version 없는 Document로 저장하던 구조를 유지할까.
  - 선택지: 첫 version 없는 Document / 가족 내 작성 준비 값
  - 추천: 가족 내 작성 준비 값
  - 적용: R11: draft 보존; 확정 전 Document 없음
- **documents/series#Q5** [충돌] Operator가 series의 다음 독립 문서를 만들 수 있게 assignment를 넓힐까.
  - 선택지: 기존 문서 새 판만 / 가족 다음 문서 생성
  - 추천: 이번은 기존 문서 새 판만 유지하고 가족은 사람·허용 앱·coding agent가 생성
  - 적용: series 추가가 Operator 권한을 넓히지 않음

### documents/terms

- **documents/terms#Q1** [질문] context 사이 같은 뜻의 다른 용어를 실제 대응으로 연결할까.
  - 선택지: 충돌 보고·질문만 / Term 대응 관계
  - 추천: 현재는 보고·질문만
  - 적용: R3: 대응 없음
- **documents/terms#Q2** [충돌] 기존 alias·translation을 새 Term에 유지할까.
  - 선택지: 별칭·번역 / 정확한 이름과 사람 정의
  - 추천: 정확한 이름과 사람 정의
  - 적용: R3: 별칭·번역 기능 없음

### documents/versions

- **documents/versions#Q1** [충돌] 자리 문서·version export의 선택 판·첨부 포함 범위를 어떻게 확정할까.
  - 선택지: 원문·version export / platform backup만
  - 추천: 원문·고정 판만 export하고 derived는 재생성
  - 적용: R16: 자리 export 제공
- **documents/versions#Q2** [질문] 대용량 HTML·data의 파일 수·바이트·준비 시간 상한을 무엇으로 할까.
  - 선택지: 실측 상한 / 무제한 streaming
  - 추천: 실측 상한과 명시적 실패
- **documents/versions#Q3** [질문] 문서 영구 삭제를 추가할까.
  - 선택지: 보관만 / 고정 근거·옛 address 흔적을 보존하는 삭제
  - 추천: 첫 판 보관만
  - 적용: R12: 영구 삭제 없음
- **documents/versions#Q4** [충돌] series 없음이라는 기존 domain model 정책을 이번 series 채택에 맞춰 어떻게 바꿀까.
  - 선택지: 한 문서 판만 / 독립 가족도 허용
  - 추천: 독립 가족은 documents/series
  - 적용: R15: 가족 허용; 기존 versions 모델은 미수정
- **documents/versions#Q5** [충돌] MCP 작업 디렉터리를 저장 원본으로 기록할까.
  - 선택지: 작업 디렉터리 자동 원본 / 실제 관측 또는 명시 연결만
  - 추천: 실제 관측 또는 명시 연결
  - 적용: R7: 작업 디렉터리만으로 원본 생성 안 함

## apps (46)

### apps/automations

- **apps/automations#Q1** [질문] H1: automation의 외부 효과를 정확한 release·명령·입력·범위의 반복 사전 허락으로 지원할까?
  - 선택지: 현재 금지 / 매번 확인 / 반복 범위 사전 허락
  - 추천: 현재 금지 유지
  - 적용: R13: 현재 금지
- **apps/automations#Q2** [질문] 달력 시각·파일 변경·event와 누락 회차 정책을 첫 판에 추가할까?
  - 선택지: 시작·간격만 / 5필드 cron·IANA timezone·Vixie OR 추가 / 파일·event 추가; skip / coalesce / catch-up
  - 추천: 시작·간격만, 놓친 회차 skip
  - 적용: R2·R7: 시작·간격만, catch-up 없음
- **apps/automations#Q3** [충돌] 이전 옮김 재료의 최대 retry 10회와 현재 자동 retry 0회 중 어느 쪽을 유지할까?
  - 선택지: 최대 10회 / 0회
  - 추천: 현재 모델의 0회
  - 적용: R8: 0회, 최소 간격 60000ms 유지

### apps/blueprint

- **apps/blueprint#Q1** [충돌] 출력·오류 schema와 opaque JSON 계약을 이번 작은 command 모델에도 추가할까?
  - 선택지: 입력만 지원; 출력·오류 schema와 opaque 추가
  - 추천: 현재 domain model의 입력 계약만 사용하고 추가는 별도 결정한다.
  - 적용: 입력만 지원
- **apps/blueprint#Q2** [충돌] tagged union·nullable 조합과 입력 줄임 문법을 어디까지 지원할까?
  - 선택지: 현재 한 타입 schema; union·nullable 조합 확장; TypeScript 줄임 문법 확정
  - 추천: 현재 한 타입 schema를 요구로 사용하며 줄임 문법은 spec에서 정한다.
  - 적용: 현재 한 타입 schema
- **apps/blueprint#Q3** [질문] blueprint 작성형은 TypeScript만 받을까 선언형 YAML도 받을까?
  - 선택지: 권한 없는 TypeScript; 선언형 YAML; 둘 다
  - 추천: TypeScript의 권한 없는 10초 추출을 유지한다.
  - 적용: TypeScript 추출 지원

### apps/data

- **apps/data#Q1** [질문] 업무 첨부 파일을 지원하면 backup을 DB와 첨부까지 넓힐까?
  - 선택지: 첫 판 SQLite만 / DB+첨부 원자 복구
  - 추천: 첫 판 SQLite만
  - 적용: R5: SQLite DB 전체만 보장
- **apps/data#Q2** [질문] 운영 후 사람이 손실을 확인하는 별도 restore를 제공할까?
  - 선택지: activation 전 실패 복원만 / 명시적 손실 확인 restore
  - 추천: activation 전 실패 복원만
  - 적용: R11·R12: 운영 후 자동 덮어쓰기 없음

### apps/invocations

- **apps/invocations#Q1** [질문] 일반 invocation 후행 기록에 durable 전달 보관이 필요한가?
  - 선택지: 제한된 메모리 재전송 / durable 전달 보관
  - 추천: 제한된 메모리 재전송으로 시작하고 손실 진단
  - 적용: R5·R10: 메모리 재전송 및 부재 표시, confirm 선행 접수 유지
- **apps/invocations#Q2** [질문] 전체 운영 통계에 호출·실행 기회·실패 분모·계측 공백의 bounded rollup을 제공할까?
  - 선택지: 진단 표본만 / derived 전체 집계
  - 추천: 첫 판은 실제 보존된 관측만, 전체 실패율 주장 없음
- **apps/invocations#Q3** [질문] confirm 증명 기한·접수 marker 용량·summary byte·기록 메시지 용량·backoff 값을 얼마로 정할까?
  - 선택지: 실측한 유한값 / 고정 초기값 후 측정
  - 추천: platform/identity와 실측 후 유한값 확정
  - 적용: R5·R8: 제한 및 중복 방지는 적용, 숫자 미정

### apps/permissions

- **apps/permissions#Q1** [질문] 앱이 선언한 channel로 직접 notification을 보내는 permission을 첫 판에 넣을까?
  - 선택지: 없음; 별도 notification permission
  - 추천: platform/notifications의 platform/notifications 계기만 쓰고 앱 notification permission은 넣지 않는다.
  - 적용: 첫 판 제외
- **apps/permissions#Q2** [충돌] network wildcard와 port 0 및 host만의 grant를 유지할까 좁은 domain model을 따를까?
  - 선택지: 이전 wildcard·동적 port; 정확한 host와 1~65535 port
  - 추천: 현재 domain model의 wildcard·port 0 금지를 적용한다.
  - 적용: wildcard와 port 0 금지
- **apps/permissions#Q3** [충돌] loopback 주소 정규화에서 중복을 제거할까 중복 선언을 거절할까?
  - 선택지: 이전 중복 제거; 현재 중복 거절
  - 추천: 현재 정규 범위의 중복 거절
  - 적용: 중복 거절
- **apps/permissions#Q4** [충돌] 앱 소유 secret의 무승인 생성·조회·변경·삭제 통로를 유지할까?
  - 선택지: 옛 앱 소유 secret; 사람 관리와 호출별 확인만
  - 추천: 현재 사람 관리·이름 grant·호출별 확인을 적용한다.
  - 적용: 앱 소유 무승인 secret 제외
- **apps/permissions#Q5** [질문] symlink 교체 공격 저항과 OS별 추가 보안 경계를 어느 수준까지 제공할까?
  - 선택지: Deno 한계 공개; 실제 OS별 추가 격리
  - 추천: 현재 한계를 명시하고 OS별 실제 테스트 결과로 추가 경계를 정한다.
  - 적용: 한계 공개와 실제 경로 검사
- **apps/permissions#Q6** [충돌] 기존 external command의 일괄 확인 문구를 effect와 독립인 confirm 계약으로 바꿀까?
  - 선택지: external은 항상 확인; confirm만 확인
  - 추천: apps/invocations과 추가 지시의 confirm 독립 계약을 적용한다.
  - 적용: external만으로 approval 요구하지 않음
- **apps/permissions#Q7** [질문] network 방향 정책을 OS 제한과 플랫폼 전송부에 어떻게 나눌까?
  - 선택지: OS별 방향 제한; 플랫폼 전송부; 표현 불가 요청 거절
  - 추천: 넓은 Deno flag로 우회하지 않고 표현 불가 요청은 거절한다.
  - 적용: 표현 불가 요청 거절
- **apps/permissions#Q8** [질문] secret 원값을 앱에 줄까 플랫폼 전송부가 인증만 대신할까?
  - 선택지: 확인된 문맥에 원값 전달; 플랫폼 인증 전달
  - 추천: 앱 코드에 원값을 주지 않는 플랫폼 인증 전달
  - 적용: 안전한 플랫폼 경계 요구, 전달 방식 미정

### apps/preview

- **apps/preview#Q1** [충돌] 이전 source 직접 실행과 현재 완성된 고정 bundle 실행 중 무엇을 preview 대상으로 할까?
  - 선택지: source readonly 직접 실행 / 고정 bundle 별도 실행
  - 추천: 현재 고정 bundle
  - 적용: R1·R2: 고정 bundle

### apps/registration

- **apps/registration#Q1** [질문] 앱 slug 변경 때 관리 폴더와 외부 source를 어디까지 이동할까?
  - 선택지: 주소만 변경; 관리 폴더만 이동; 외부 source도 이동
  - 추천: 외부 source는 이동하지 않고 주소 변경은 documents/addressing을 따른다.
  - 적용: source 연결 변경이 운영 내용을 바꾸지 않음

### apps/releases

- **apps/releases#Q1** [질문] machine 생성물 변경 거절과 설계 변경 경고를 어디서 어떤 대상으로 검사할까?
  - 선택지: release 준비; app test runner; 안내만
  - 추천: 실제 변경 거절은 app test와 release 준비 경계에서 하고 지침은 coding-agent/guides에 둔다.
- **apps/releases#Q2** [질문] H2: coding agent의 모든 activation도 매번 사람이 승인할까?
  - 선택지: 모든 activation 승인; 새 permission·migration 등 특정 변화만 승인
  - 추천: 모든 activation에 승인 요구
  - 적용: 모든 activation 승인
- **apps/releases#Q3** [질문] 현재 데이터와 다른 schema의 이전 release를 어디까지 허용할까?
  - 선택지: 같은 schema만; 실제 테스트한 호환 범위; 별도 데이터 restore
  - 추천: 같은 schema만 바로 허용하고 restore는 apps/data로 구별한다.
  - 적용: 같은 schema만 바로 허용
- **apps/releases#Q4** [질문] 앱 health의 정상 신호·주기 metric·비교 조건과 상태 점검 선언을 지원할까?
  - 선택지: 문제 보고만; 별도 정상 신호와 점검 선언
  - 추천: 이번에 정하지 않고 시작 준비 확인과 업무 정상을 구별한다.
- **apps/releases#Q5** [질문] release 준비의 바이트·파일 수·시간 상한을 얼마로 정할까?
  - 선택지: 고정 값; 앱별 설정; 실제 bundle 측정 뒤 결정
  - 추천: 실제 앱 bundle을 측정해 상한을 정하며 무제한 준비는 허용하지 않는다.
  - 적용: 상한과 취소 적용, 숫자는 미정

### apps/runtime

- **apps/runtime#Q1** [질문] H6: 앱 runtime의 Deno 기술 선택을 유지할까?
  - 선택지: Deno 유지; 다른 runtime
  - 추천: Deno 유지를 적용하고 배포 포함은 platform/install-and-update, TypeScript 공통 SDK·템플릿 계약은 apps/sdk를 따른다.
  - 적용: Deno 실행 요구 유지
- **apps/runtime#Q2** [질문] 지원 OS별 CPU·RSS·disk 한도와 추가 격리 수준을 어떻게 정할까?
  - 선택지: Deno 한계 공개와 실측; cgroup·ulimit 등 실제 OS 제한; 필요한 앱만 추가 격리
  - 추천: 실제 앱 수별 RSS/PSS·CPU·기동 시간을 먼저 측정하고 검증된 OS 제한만 지원한다.
  - 적용: 실제 측정과 한계 공개
- **apps/runtime#Q3** [질문] 앱 GUI는 앱 프로세스가 serve할까 플랫폼이 정적 bundle을 serve할까?
  - 선택지: 앱 프로세스 local HTTP; 플랫폼 정적 serving
  - 추천: 앱 프로세스의 local HTTP 유지
  - 적용: 앱 프로세스 local HTTP
- **apps/runtime#Q4** [질문] subprocess가 반드시 필요한 사용자 앱을 이번 범위에서 지원할까?
  - 선택지: 현재 금지; 실제 필요 앱에만 별도 격리 구현
  - 추천: 현재 금지하고 미래 container 교체 자리만 미리 만들지 않는다.
  - 적용: subprocess 금지
- **apps/runtime#Q5** [충돌] 시작 timeout·종료 유예·재시작 값은 이전 숫자를 유지할까 OS별 실측 뒤 확정할까?
  - 선택지: 30초·10초·1초부터 최대 5분과 10분 안 5회 초과 유지; OS별 측정 뒤 변경
  - 추천: 이전 숫자를 요구로 유지하고 OS 테스트로 조정한다.
  - 적용: 이전 숫자 유지
- **apps/runtime#Q6** [질문] 한 앱이 다른 앱 command를 부르는 앱 사이 연결을 지원할까?
  - 선택지: 지원하지 않음; read command부터; write와 external까지
  - 추천: 이번에는 지원과 권한·위임 계약을 확정하지 않는다.
- **apps/runtime#Q7** [질문] Windows에서도 두 로컬 통로를 Unix socket으로 제공할까 OS별 transport를 둘까?
  - 선택지: Unix socket 지원 검증; OS별 local IPC
  - 추천: 같은 direct call·사용자 전용 계약을 지키는 OS별 실측으로 결정한다.
  - 적용: Linux local socket 계약

### apps/sdk

- **apps/sdk#Q1** [질문] 개인 Package 등록·승격·2개 사용처·도메인 이름·입출력·추출 뒤 정상 확인과 patch/minor 묶음·major 앱별 전파 계약을 도입할까?
  - 선택지: 설치 제공 Package만 / 개인 등록과 검사 / 승격·전파 workflow
  - 추천: 설치 제공만, 실제 2개 앱 재사용 뒤 별도 결정
  - 적용: R6·R13·R36: 설치 제공만
- **apps/sdk#Q2** [질문] 앱 UI SDK를 React로 고정할까 Web Components로 만들까?
  - 선택지: React / Web Components
  - 추천: 기존 React 유지
  - 적용: R1·R17·R33: React
- **apps/sdk#Q3** [질문] SDK registry 전체 git 관리를 제공할까 플랫폼 export로 backup과 이전을 보장할까?
  - 선택지: git registry / blob+ledger export
  - 추천: platform/backup-and-migration의 export로 통합
- **apps/sdk#Q4** [질문] SDK 공개 type와 입력·출력 호환 비교를 개발 검사에 둘까 제품 등록에도 둘까?
  - 선택지: 설치 SDK 개발 테스트 / 제품 공개 검사
  - 추천: 개발 테스트에서 type와 입력·출력·unknown-field policy를 검사
  - 적용: R12: SemVer 의미만 적용, 검사 제품화 없음
- **apps/sdk#Q5** [질문] 공개 slot 교체와 props/major 불일치시 해당 slot fallback을 첫 판에 제공할까?
  - 선택지: 첫 판 없음 / 명시 공개 slot만
  - 추천: 첫 판 없음, shell/design-system과 실제 사례 뒤 결정
- **apps/sdk#Q6** [질문] platform/notifications 표 밖 앱 notification을 위한 @lophn/cap-notify를 제공할까?
  - 선택지: platform/notifications 표만 / 앱 notification도 추가
  - 추천: platform/notifications 표만
  - 적용: R4: cap-notify 제공 제외
- **apps/sdk#Q7** [질문] 2 major 뒤처짐 주간 보고와 이름·prop 유사 component 경고를 제공할까?
  - 선택지: 첫 판 없음 / Operator 요청 보고 / 자동 경고
  - 추천: 첫 판 자동 경고 없음, 요청된 Operator 보고로 사례 확인
- **apps/sdk#Q8** [질문] Deno의 lophn-sdk 해석은 파일 경로 치환과 로컬 registry server 중 무엇을 쓸까?
  - 선택지: import map 파일 경로 치환 / 로컬 registry server
  - 추천: 개발 때 로컬 파일 경로 치환, 운영은 고정 bundle
  - 적용: R7·R10: 정확한 version 및 운영 bundle
- **apps/sdk#Q9** [질문] 약 1.9MB font를 release마다 포함할까 desktop 공유를 쓸까?
  - 선택지: release 독립 font / desktop 공유
  - 추천: release 독립 font로 재현성 우선
- **apps/sdk#Q10** [질문] 새 보고 모델에서 표본 evidence hook을 첫 판에 제공할까?
  - 선택지: report만 / 제한된 표본 hook
  - 추천: problems/snapshots와 크기·권한 계약 후 제한된 hook
  - 적용: R26·R27: report·문맥·예외 수집만, 표본 없음
- **apps/sdk#Q11** [충돌] 이전 설치 SDK directory 직접 읽기와 현재 운영 bundle에 포함한 고정 byte 중 어느 것을 유지할까?
  - 선택지: registry 해당 version directory만 읽기 / release 고정 bundle
  - 추천: 현재 domain-model의 bundle
  - 적용: R10: 고정 bundle
- **apps/sdk#Q12** [질문] 초기 SDK 공개 version은 새 1.0.0으로 시작하고 과거 공개 version을 재사용하지 않을까?
  - 선택지: 과거 version byte 그대로 보존 / 새 1.0.0 / 새로운 별도 이름
  - 추천: 이전 이름 유지, 새 API는 1.0.0, 과거 byte로 가장하지 않음
  - 적용: R4: 해당 제공 이름의 1.0.0; format 목록은 documents/formats
- **apps/sdk#Q13** [충돌] 모든 앱 템플릿의 초기 migration 의무와 DB 미사용 앱의 schema 0 허용을 어떻게 맞출까?
  - 선택지: 항상 migration / DB 사용 템플릿만 migration
  - 추천: DB 사용 시만 migration
  - 적용: R33: DB 사용 시 migration

## problems (27)

### problems/closing

- **problems/closing#Q1** [질문] 부분 완화와 잔여 문제를 별도 닫힘 사유로 추가할까.
  - 선택지: 4종 유지 / 완화 종료 추가
  - 추천: 문제는 열린 채 잔여 범위·후속 ticket을 설명
  - 적용: 4종 유지; 완화만으로 수리 성공 닫힘 없음
- **problems/closing#Q2** [질문] 조용한 문제를 실행 기회·무보고 기간으로 자동 닫을까.
  - 선택지: 자동 닫힘 없음 / 기회·기간 뒤 recovered
  - 추천: 현 domain model의 자동 닫힘 없음
  - 적용: recovered도 보호된 사람 확인 필수

### problems/feedback

- **problems/feedback#Q1** [질문] 자동 준비한 screenshot과 화면 상태의 기본 포함 범위를 유지할까.
  - 선택지: 모두 자동 저장 / 안전한 상태 기본 선택과 screenshot 미리보기 확인 뒤 선택
  - 추천: 현재 모델의 후자
  - 적용: 안전한 상태만 기본 선택; screenshot은 확인 뒤 선택
- **problems/feedback#Q2** [질문] feedback 원문·metadata·미완료 수 quota를 얼마로 제한할까.
  - 선택지: 앱당·전체 유한 quota / 보고율과 디스크 여유만 제한
  - 추천: 별도 quota가 정해지기 전 보고율 및 자료 한도 적용
  - 적용: 초안은 메모리; 실패 이유와 글 복사 제공
- **problems/feedback#Q3** [충돌] 최근 read command 8개·각 20행/16KiB 및 invocation 10개·오류 20개를 화면 상태에 자동 붙일까.
  - 선택지: 옛 결과 자동 첨부 / 안전한 위치·입력 형태만
  - 추천: 업무 원값 자동 수집을 금지한 현재 모델
  - 적용: 전체 read 결과 자동 복사 없음; 실제 연결을 아는 대상만 표시
- **problems/feedback#Q4** [충돌] 자동 캡처한 screenshot을 사람 선택 없이 첨부하던 규칙을 유지할까.
  - 선택지: 자동 첨부 / redaction 미리보기 확인 후 사람 선택
  - 추천: 현재 problems/feedback 모델의 사람 선택
  - 적용: 버튼 시점 안전 캡처는 유지하되 screenshot은 미리보기 확인 후 선택한 자료만 저장

### problems/grouping

- **problems/grouping#Q1** [질문] 사람의 문제 병합·분리 기능을 추가할까.
  - 선택지: 고정 grouping만 / 근거와 원래 보고 연결을 유지하는 사람 병합·분리
  - 추천: 첫 판은 고정 grouping만
  - 적용: 별도 병합·분리 없음
- **problems/grouping#Q2** [질문] 앱 사이 공통 원인 관계를 사람에게 연결하게 할까.
  - 선택지: 앱별 문제만 / scope를 합치지 않는 참고 연결
  - 추천: 첫 판은 앱별 문제만
  - 적용: 각 앱 보고와 읽기 scope 유지
- **problems/grouping#Q3** [질문] feedback을 기존 문제로 묶는 방식은 사람의 명시적 선택으로 유지할까.
  - 선택지: 매번 새 문제 / 화면·글 자동 묶기 / 사람 선택
  - 추천: 사람 선택
  - 적용: 선택 없으면 새 문제; 선택하면 기존 문제

### problems/problem-codes

- **problems/problem-codes#Q1** [질문] 사람이 조정할 문제에 별도 앱 command·화면 조치 링크를 제공할까.
  - 선택지: 고정 문구만 / 별도 검증된 조치 링크
  - 추천: 첫 판은 고정 문구만
  - 적용: 고정 문구와 고칠 쪽만 제공
- **problems/problem-codes#Q2** [질문] health check와 사용자 label·문제 연결 검사를 별도 기능으로 유지할까.
  - 선택지: 지원 안 함 / 별도 concern으로 health check 지원
  - 추천: 첫 판은 지원하지 않고 선언 보고를 사용
  - 적용: health check 연결과 40자 label 검사 없음
- **problems/problem-codes#Q3** [충돌] 옛 runtime 예약 code 전체와 별도 오탐 code를 필수로 유지할까.
  - 선택지: 옛 예약 code 전체 / 예외·feedback·잘못된 보고 필수 3종
  - 추천: 현재 problems/problem-codes 모델의 필수 3종
  - 적용: 필수 3종만 유지; 별도 오탐 문제 없이 problems/closing의 사람 결정; code 없는 옛 check 호환 경로 버림

### problems/repairs

- **problems/repairs#Q1** [충돌] 앱이 남기던 변경 메모를 코드 수리 기록으로 계속 받을까.
  - 선택지: 앱 변경 메모 수용 / 인증된 coding agent 수리 기록만
  - 추천: 현재 problems/repairs 모델의 coding agent 전용
  - 적용: 앱의 수리 기록 대신 제출 거절; 이전·고친 release와 인증된 작성자·실제 test result 및 요청 출처 보존

### problems/reporting

- **problems/reporting#Q1** [충돌] view의 같은 지문 60초 1회 제한을 서로 다른 발생에도 적용할까.
  - 선택지: 지문별 버림 / 발생 재전송만 중복 제거
  - 추천: 현재 보고 모델의 발생 보존 규칙
  - 적용: 앱당 20개/60,000ms ingress 제한과 동일 발생 재전송만 중복 제거
- **problems/reporting#Q2** [충돌] crash·메모리·command 실패·permission 거절·view load 실패를 별도 예약 problem code로 즉시 추가할까.
  - 선택지: 옛 runtime 예약 분류 모두 / 필수 3종만 유지하고 관측 소유 concern에서 기록
  - 추천: 첫 판은 필수 3종만 유지
  - 적용: 예외는 자동 보고하며 다른 관측은 apps/runtime·apps/invocations·apps/permissions로 참조
- **problems/reporting#Q3** [질문] health check·health 탭과 진단 전용 신호를 유지할까.
  - 선택지: 지원 안 함 / 별도 health concern 지원
  - 추천: 첫 판은 지원하지 않음
  - 적용: 선언 보고와 실제 테스트만 사용
- **problems/reporting#Q4** [질문] 보고 메모리 대기 크기·총 bytes·재전송 횟수·간격을 얼마로 둘까.
  - 선택지: 정해진 유한 상한 / 디스크 대기 추가
  - 추천: 운영 command 재실행 없이 유한 메모리 대기
  - 적용: 수치 미정; 영구 접수와 대기는 구별

### problems/snapshots

- **problems/snapshots#Q1** [질문] snapshot 자료의 사람 전용 명시 삭제와 재전송·재연결 복원 방지를 첫 판에 추가할까.
  - 선택지: 불변 참조 유지 / 별도 삭제와 감사 근거·모든 참조 범위 처리
  - 추천: 첫 판은 자동·명시 삭제 없이 보존; 보안 삭제 예외는 별도 결정
  - 적용: 삭제 기능 없음
- **problems/snapshots#Q2** [질문] 요청할 때만 앱에서 안전한 추가 표본을 받는 기능을 지원할까.
  - 선택지: 현재 snapshot만 / 요청형 안전 표본
  - 추천: 첫 판은 현재 snapshot만
  - 적용: 표본 hook 없음; 후보값은 기본3개·최대5개·문자열64자·표본2KiB·수집10초
- **problems/snapshots#Q3** [질문] 큰 관측 자료의 보존 기간과 앱별·전체 bytes 한도를 어떻게 정할까.
  - 선택지: 영구 보존 / 닫힘 뒤 기간 제한 / 사람 명시 삭제
  - 추천: 현재 모델의 자동 삭제 없는 참조 유지
  - 적용: 첫 판 자동 삭제 없음; 옛 닫힘 후90일·전체256MiB는 검토 후보
- **problems/snapshots#Q4** [질문] 로그 총 bytes·오류 frame 수·전체 수집 timeout·동시 수의 기본값을 얼마로 둘까.
  - 선택지: 실측 후 유한 상한 / 옛 한도 재사용
  - 추천: 실측 후 결정하고 최근30줄만 확정
  - 적용: 기본 로그30줄·stack16KiB; 나머지 수치 미정
- **problems/snapshots#Q5** [충돌] 옛 첨부 90일 자동 삭제를 불변 snapshot 참조 유지보다 우선할까.
  - 선택지: 90일 삭제 / 현재 모델의 자동 삭제 없음
  - 추천: 현재 domain model 우선
  - 적용: 자동 삭제 기간 없음
- **problems/snapshots#Q6** [충돌] 첫3개·최근50개 발생 보존 및 error300자·frame10개·로그 첫10+최근30·줄300자 기본값을 그대로 가져올까.
  - 선택지: 옛 보존·한도표 / 보고 전부 보존과 최근30줄
  - 추천: 현재 model의 보고 불변성과 로그30줄 우선
  - 적용: 발생 삭제 없음; stack16KiB·로그30줄만 확정

### problems/tests

- **problems/tests#Q1** [질문] 앱 runtime별 테스트 진입점과 판정 protocol·format을 무엇으로 지원할까.
  - 선택지: Deno 우선과 구조화 업무 관측 / 다른 runner adapter 추가
  - 추천: Deno 우선; 종료값만으로 reproduction 판정하지 않음
  - 적용: 하나의 test result와 고정 업무 관측 유지; 세부 format 미정
- **problems/tests#Q2** [질문] health check fixture 통과를 별도 필수 검사로 유지할까.
  - 선택지: 지원 안 함 / health concern 결정 뒤 추가
  - 추천: 첫 판은 별도 health check 없음
  - 적용: 선언·예외·feedback 및 실제 테스트만 검사
- **problems/tests#Q3** [질문] 테스트 timeout 기본·상한과 출력·메모리 한도·작업 폴더 보관 기간을 얼마로 둘까.
  - 선택지: 실측 후 유한 기본값 / runtime별 기본값
  - 추천: 실측 후 runtime별 유한 한도
  - 적용: timeout 필수; 정확한 상한과 보관 기간 미정
- **problems/tests#Q4** [충돌] 옛 Deno test의 무제한 allow-read·allow-write·allow-env·allow-net을 유지할까.
  - 선택지: 옛 flags 그대로 / 테스트 범위만 제한
  - 추천: 운영 자원 접근 금지 우선
  - 적용: prompt·전체 권한 금지; 모든 allow 범위 제한

## lophn-agent (69)

### lophn-agent/assignments

- **lophn-agent/assignments#Q1** [질문] 반복 실패의 공통 연속 3회를 역할·실패 종류별 기준으로 바꿀까.
  - 선택지: 공통 3회 / 역할별 / 실패 종류별
  - 추천: 실제 기록이 쌓일 때까지 공통 3회 유지
  - 적용: 공통 연속 3회
- **lophn-agent/assignments#Q2** [질문] 보관이 아닌 영구 접근 회수·삭제·일시 unavailable에서 자동 pause와 재개 조건을 어떻게 구분할까.
  - 선택지: 모두 pause / 보관만 pause·나머지 호출 차단 / 영구 회수도 pause
  - 추천: 현재 보관만 pause하고 나머지는 호출 차단, 대상 concern과 분류를 맞춘다
  - 적용: 보관 자동 pause·일시 unavailable 호출 차단

### lophn-agent/conversation

- **lophn-agent/conversation#Q1** [질문] 반복 실패로 멈춘 assignment에서 진단 전용 제한 모델 세션을 예외로 허용할까.
  - 선택지: 현재 비모델 원인·재개 안내만 / 진단 전용 제한 모델 예외
  - 추천: 모델 호출 차단 유지, 비모델 기록으로 안내
  - 적용: paused assignment 모델 우회 없음

### lophn-agent/evaluation

- **lophn-agent/evaluation#Q1** [질문] eval 제한 시간을 실제 model 600초·모델 없는 테스트 120초로 시작할까?
  - 선택지: 초기 600/120초;측정 뒤 설정
  - 추천: 실제 model 600초로 시작하며 모델 없는 120초는 각 concern의 테스트가 정한다.
  - 적용: R24의 600초
- **lophn-agent/evaluation#Q2** [질문] 내용 판정의 24/30 보정 기준을 장기 유지할까?
  - 선택지: 24/30 유지;축별 오판 비용으로 조정
  - 추천: 초기는 24/30을 유지하고 사람 표본의 충족·불충족·근거 부족을 균형 있게 구성한다.
  - 적용: R16의 24/30
- **lophn-agent/evaluation#Q3** [질문] 다섯 제품 신호를 eval에 어디까지 포함할까?
  - 선택지: 역할 판단만;비교 가능한 업무별 다섯 신호
  - 추천: 앱 제작 비용·문제 탐지 지연·수리 중 사람 개입·정보 접근 token·검증된 재료 재사용을 각각 비교하고 종합 점수는 만들지 않는다.
  - 적용: 추가 제품 점수 없음

### lophn-agent/extensions

- **lophn-agent/extensions#Q1** [질문] 외부 MCP 자원을 서버 연결 외에 안정된 자원 식별로 구별할까?
  - 선택지: 서버만;서버와 안정된 자원
  - 추천: 서버와 도구는 필수이고 자원 식별은 제공될 때 근거로만 쓴다.
  - 적용: 새 lease·자원 잠금은 없음
- **lophn-agent/extensions#Q2** [질문] 이어 읽기가 없는 MCP의 큰 결과를 보관한 원문에서 다시 읽게 할까?
  - 선택지: 생략 표시만;보호된 원문 주소 읽기
  - 추천: lophn-agent/harness/tools의 생략·출처 표시를 유지하고 보호된 원문 재읽기는 실제 사례로 결정한다.
  - 적용: 추가 재읽기 기능 없음
- **lophn-agent/extensions#Q3** [질문] MCP OAuth에 device code를 추가할까?
  - 선택지: Authorization Code·PKCE·loopback;device code도
  - 추천: 초기에는 브라우저와 loopback만 지원한다.
  - 적용: R16의 브라우저·loopback
- **lophn-agent/extensions#Q4** [질문] 설명·입력·MCP 힌트가 그대로인 서버의 숨은 행동 변경을 어떻게 다룰까?
  - 선택지: 사람 검토와 한계 고지;별도 검증
  - 추천: 사람의 분류 검토를 요구하고 자동 탐지를 약속하지 않는다.
  - 적용: R27~R28의 사람 분류
- **lophn-agent/extensions#Q5** [질문] skill 본문과 MCP 도구 목록의 전체 크기 상한을 얼마로 둘까?
  - 선택지: 고정 숫자;모델별 수용 예산
  - 추천: lophn-agent/harness/prompt-assemble의 수용 예산으로 전체 성공 여부를 판정하고 조용한 부분 성공은 금지한다.
  - 적용: R6·R22의 전체 성공 계약
- **lophn-agent/extensions#Q6** [질문] 역할별 기본 skill 및 Operator의 외부 MCP·skill 선택을 언제 늘릴까?
  - 선택지: 선택 없음;실제 사례별 명시 선택
  - 추천: 역할 concern에서 실제 이름·scope·eval 근거를 정할 때만 늘린다.
  - 적용: lophn-agent/roles/app-engineer·lophn-agent/roles/operator에 위임

### lophn-agent/handoff

- **lophn-agent/handoff#Q1** [질문] 같은 원래 사람 요청의 handoff 순환·총 사슬 길이를 어떻게 제한할까.
  - 선택지: assignment 재방문 금지 / 별도 길이 상한 / 각 run 한도만
  - 추천: 첫 판은 각 run 한도만 적용하고 실제 순환 기록이 생기면 재방문 금지 검토
  - 적용: 별도 handoff 상한 없음, harness/run-loop 한도 적용

### lophn-agent/harness/model

- **lophn-agent/harness/model#Q1** [질문] 공개 가격 외 계약 가격을 사람이 별도 출처로 보완할 것인가?
  - 선택지: 공개 가격만 / 계약 가격 보완
  - 추천: 첫 판 공개 가격만
  - 적용: 공개 가격만
- **lophn-agent/harness/model#Q2** [질문] catalog 밖 model의 128,000·8,192 token·tool 지원 가정을 허용할 것인가?
  - 선택지: 임시 가정 / 확인 정보·사람 보완 필수
  - 추천: 확인 정보 또는 사람 명시 정보만
  - 적용: 확인 정보·사람 보완 필수
- **lophn-agent/harness/model#Q3** [질문] 첫 설치의 두 model slot을 어떤 목록·순서로 추천할 것인가?
  - 선택지: 추천 없음 / 실제 품질·지연 eval 기반 추천
  - 추천: 자동 배정 없이 eval 기반 추천
  - 적용: 자동 배정 없음, 추천 순서는 미정
- **lophn-agent/harness/model#Q4** [질문] 2,048·8,192·16,384·32,768 추론 예산이 품질 차이를 만드는가?
  - 선택지: 초기 값 유지 / fixture 비교 뒤 보정
  - 추천: 초기 값 유지 후 lophn-agent/evaluation으로 비교
  - 적용: 초기 값 유지
- **lophn-agent/harness/model#Q5** [질문] 강도·예산·토글을 함께 선언한 model의 추론 선택 우선순위는 무엇인가?
  - 선택지: 강도 우선 / provider별 확인 조합
  - 추천: provider별 확인된 방식 하나만 제공
  - 적용: 확인된 방식 하나만 제공
- **lophn-agent/harness/model#Q6** [질문] 첫 판 model input에 이미지를 포함할 것인가?
  - 선택지: 텍스트만 / 이미지 전처리·크기 계약 완성 뒤 포함
  - 추천: 첫 판 텍스트만
  - 적용: 텍스트만
- **lophn-agent/harness/model#Q7** [질문] 정확한 token 계산을 local tokenizer·provider count API 중 무엇으로 제공할 것인가?
  - 선택지: 검증된 local tokenizer / provider count API / UTF-8 상한
  - 추천: 확인 가능한 계산 우선, 없으면 UTF-8 상한
  - 적용: 정확 계산 또는 UTF-8 상한
- **lophn-agent/harness/model#Q8** [질문] Claude 계열을 기본 추천으로 유지할 것인가?
  - 선택지: Claude 추천 / 실제 품질·지연 eval 기반 추천
  - 추천: provider에 독립적인 eval 기반 추천, 자동 배정 없음
  - 적용: 자동 배정 없음
- **lophn-agent/harness/model#Q9** [질문] 한계를 모르는 model을 사용할 조건은 무엇인가?
  - 선택지: 보수 기본값 / 확인 정보·사람 입력 한계
  - 추천: 확인 정보·사람 입력 한계 필수
  - 적용: 확인 정보·사람 입력 한계 필수

### lophn-agent/harness/prompt-assemble

- **lophn-agent/harness/prompt-assemble#Q1** [질문] lophn 시작 자료에 전체 outline 1,500·context와 place 3,000·문서 outline 2,000 token 별도 상한과 run 끝까지 index 고정을 둘 것인가?
  - 선택지: model 총 예산만 / 세 시작 상한·index 고정
  - 추천: 공통 model 총 예산만, 자료 version은 읽은 근거로 고정
  - 적용: 별도 역할 시작 상한 없음
- **lophn-agent/harness/prompt-assemble#Q2** [질문] App Engineer의 별도 시작 token 예산을 둘 것인가?
  - 선택지: 공통 model 총 예산 / 별도 AE 상한
  - 추천: 공통 model 총 예산
  - 적용: 별도 역할 시작 상한 없음
- **lophn-agent/harness/prompt-assemble#Q3** [질문] 같은 구간의 새 압축은 어떤 명시 변경 뒤 허용할 것인가?
  - 선택지: 사람 요청만 / 다음 run의 변경된 입력·model에서도
  - 추천: 같은 구간 자동 반복 금지, 사람 요청·새 run의 실질 변경에서만 새 시도
  - 적용: 같은 구간 자동 반복 금지
- **lophn-agent/harness/prompt-assemble#Q4** [질문] 70%·50%·25%·2,000~15,000 token 초기 압축값을 유지할 것인가?
  - 선택지: 초기값 유지 / 한글·큰 MCP·작은 창 fixture 뒤 조정
  - 추천: 초기값 유지 후 lophn-agent/evaluation으로 검증
  - 적용: 초기값 유지
- **lophn-agent/harness/prompt-assemble#Q5** [충돌] 옛 작업 층 순서와 새 domain model의 다섯 층 순서가 일치하지 않는다.
  - 선택지: 옛 공통·역할·작업 구조 / 새 지시·tools·자료·이력·현재 입력 구조
  - 추천: 논리적 공통·역할·작업 구분은 유지하고 새 구조에서 현재 입력 전문을 보호
  - 적용: 공통·역할·작업 구분과 고정 prefix, 현재 입력 보호

### lophn-agent/harness/provider

- **lophn-agent/harness/provider#Q1** [질문] Claude OAuth가 lophn 식별과 프로필·추론 권한으로 실제 tool call을 받는가?
  - 선택지: 검증 뒤 활성화 / 미허용 경로 제외
  - 추천: 검증 전 비활성, 미허용이면 API key 안내
  - 적용: 검증 뒤 활성화
- **lophn-agent/harness/provider#Q2** [질문] ChatGPT·xAI 제3자 OAuth client 발급과 공식 허용 범위는 무엇인가?
  - 선택지: lophn 전용 발급 / 공개 CLI client 허용 범위 확인
  - 추천: 전용 발급 우선, 허용 범위 확인 전 비활성
  - 적용: 허용 확인 뒤 활성화
- **lophn-agent/harness/provider#Q3** [질문] SuperGrok 표준·Heavy 중 어느 요금제가 OAuth 추론을 받는가?
  - 선택지: 요금제별 검증 / 미검증 비활성
  - 추천: 표준·Heavy 각각 검증하고 X Premium+와 구별
  - 적용: 미검증 비활성
- **lophn-agent/harness/provider#Q4** [질문] Claude·ChatGPT 사용량 조회가 lophn 식별로 허용되며 5시간·7일 창과 정확한 리셋을 주는가?
  - 선택지: 응답 header 우선과 설정 열 때 추가 조회 / 추가 조회 제외
  - 추천: header 우선, 허용된 경우만 설정 열 때 조회, 주기 계정 폴링 없음
  - 적용: header 우선, 미확인 추가 조회 없음
- **lophn-agent/harness/provider#Q5** [질문] 온보딩 건너뛰기와 인증 전 slot 진행 금지를 어떻게 함께 지키는가?
  - 선택지: 준비 화면만 건너뛰고 agent 비활성 / 모든 단계 강제
  - 추천: 무인증 loopback도 준비로 인정하고 건너뛰면 agent 비활성
  - 적용: 화면 건너뛰기·agent 비활성
- **lophn-agent/harness/provider#Q6** [질문] 첫 provider 인증 범위와 안전한 secret 보관 불가 환경은 어떻게 처리하는가?
  - 선택지: 명시 지원 목록 / API key·로컬만; 보관 불가는 platform/secrets 정책
  - 추천: 지원 목록 유지, 보관 불가 처리는 platform/secrets 참조
  - 적용: 지원 목록 유지·platform/secrets 참조
- **lophn-agent/harness/provider#Q7** [충돌] PV-16·PV-18의 버림 판정과 credential 하나 제한이 이번 추가 지시·현재 domain model의 여러 credential 요구와 충돌한다.
  - 선택지: credential 하나 / 여러 credential 순서 선택·같은 provider 안 이동
  - 추천: 이번 추가 지시대로 여러 credential 유지
  - 적용: 여러 credential 유지
- **lophn-agent/harness/provider#Q8** [충돌] PV-25와 초안 domain model의 추론 서명 전면 제외가 충돌했고 현재 provider domain model은 필수 opaque 상태의 비영속 재사용으로 수정되었다.
  - 선택지: 전면 제외 / 본문 제외·필수 opaque 상태만 메모리
  - 추천: 본문 제외·opaque 상태만 비영속 재사용
  - 적용: 현재 provider domain model과 일치: 같은 run·provider·model 메모리만
- **lophn-agent/harness/provider#Q9** [질문] 연결 테스트의 대기 상한과 사용량 기록 용도가 아직 정해지지 않았다.
  - 선택지: 공통 model 시간 한도 / 독립 30초 상한; usage 별도 용도 / provider 결과만
  - 추천: 단발 테스트 30초 상한과 실제 유료 시도 usage 기록
  - 적용: 단발 테스트 30초 상한·실제 호출 usage 기록

### lophn-agent/harness/run-loop

- **lophn-agent/harness/run-loop#Q1** [질문] provider 끄기·MCP 연결 제거 때 이미 전송한 요청은 어떻게 처리하는가?
  - 선택지: 새 진입만 금지 / 가능한 진행 요청도 취소
  - 추천: 새 진입 금지·가능하면 취소, 이미 시작한 효과는 불명확 또는 결과 보완
  - 적용: 새 진입 금지·가능하면 취소
- **lophn-agent/harness/run-loop#Q2** [질문] 공통 30회·5분·사람 기다림 제외 30분이 실제 일에 충분한가?
  - 선택지: 초기 공통값 유지 / eval 근거로 조정
  - 추천: 현재 공통값 유지 후 lophn-agent/evaluation으로 검증
  - 적용: 공통 30회·5분·30분
- **lophn-agent/harness/run-loop#Q3** [질문] 세션 입력 수·전체 접수 run 수에 어떤 유한 상한을 둘 것인가?
  - 선택지: 고정 상한 없음 / burst·저장 비용 측정 기반 상한
  - 추천: 측정 후 유한 상한, 초과는 저장 전 명시 거절
  - 적용: 구체 숫자 미정, 받은 입력은 보존
- **lophn-agent/harness/run-loop#Q4** [질문] agent 프로세스를 상시 대기시키거나 요청 때 띄울 것인가?
  - 선택지: 상시 대기 / 요청 시 시작
  - 추천: 동작 계약을 유지하는 요청 시 시작
  - 적용: 미정
- **lophn-agent/harness/run-loop#Q5** [질문] run 시간 한도에 사람 답 기다림을 포함할 것인가?
  - 선택지: 포함 / 제외
  - 추천: 진행 없는 시간·전체 시간 모두 제외
  - 적용: 둘 다 제외
- **lophn-agent/harness/run-loop#Q6** [질문] run 한도·반복 tool 실패 기준을 공통값 또는 역할별로 둘 것인가?
  - 선택지: 공통 수치 / 역할별 수치
  - 추천: 공통 수치
  - 적용: 공통 수치

### lophn-agent/harness/safety

- **lophn-agent/harness/safety#Q1** [질문] 두 요청을 번갈아 성공시키는 무진행 반복도 감지할 것인가?
  - 선택지: 같은 요청 실패만 / 교대 반복·같은 결과 감지
  - 추천: 첫 판 동일 요청 최종 실패만, eval 후 결정적 감지 검토
  - 적용: 동일 요청 실패만
- **lophn-agent/harness/safety#Q2** [질문] model API로 나가는 문서·앱 자료 범위를 사람이 어떻게 통제하는가?
  - 선택지: 현재 assignment scope·최소 자료 / provider별 추가 정책 / 별도 scope 동의
  - 추천: 현재 scope와 최소 자료를 지키고 provider별 추가 통제는 별도 결정
  - 적용: 현재 assignment scope·최소 자료

### lophn-agent/harness/tools

- **lophn-agent/harness/tools#Q1** [질문] 이미지·PDF·표의 원본과 부분 preview를 어떤 크기로 반환할 것인가?
  - 선택지: 추출 텍스트·주소만 / 크기 상한 있는 부분 preview
  - 추천: 첫 판 원본 binary 제외, 추출 텍스트·주소·format·outline만
  - 적용: 원본 binary 제외·범위 확인된 텍스트만

### lophn-agent/harness/usage

- **lophn-agent/harness/usage#Q1** [질문] 비용 표시에 선택 환산을 제공할 것인가?
  - 선택지: 원래 통화만 / 환율 출처·시각을 붙인 선택 환산
  - 추천: 첫 판 원래 통화만
  - 적용: 원래 통화만
- **lophn-agent/harness/usage#Q2** [충돌] credential 이동 요구를 되살림에 따라 사용량 재료의 이동 기록 삭제와 충돌한다.
  - 선택지: 이동 기록 삭제 / 같은 provider 안 이동 기록 유지
  - 추천: 실제 선택 credential·이동 관계·과금 경로 기록
  - 적용: 같은 provider 안 이동 기록 유지
- **lophn-agent/harness/usage#Q3** [충돌] 연결 test 실제 시도는 현 domain model의 세 용도 밖이지만 실제 사용량을 빠짐없이 기록해야 한다.
  - 선택지: provider 결과만 / 연결 test 용도 추가
  - 추천: 실제 시도는 연결 test 용도로 기록
  - 적용: 연결 test 용도 포함

### lophn-agent/harness/waiting-and-recovery

- **lophn-agent/harness/waiting-and-recovery#Q1** [질문] 재시작 후 대기 approval을 같은 요청으로 이을 것인가?
  - 선택지: 미시작 증거가 있으면 같은 요청 / 항상 새 요청
  - 추천: 현재 요청·미시작 증거를 조회해 유효한 같은 요청 유지
  - 적용: 미시작 증거 있는 같은 요청만 유지
- **lophn-agent/harness/waiting-and-recovery#Q2** [질문] 조회 수단 없는 MCP external 효과의 충돌 보류는 언제 풀 것인가?
  - 선택지: 실제 증거 / 사람의 명시 위험 인수
  - 추천: 실제 효과 증거 전 자동 해제 금지, 별도 장기 lock 없음
  - 적용: 실제 증거 전 충돌 후속 call 금지
- **lophn-agent/harness/waiting-and-recovery#Q3** [질문] 완성 압축 summary와 보호 원문 범위를 복구할 근거는 무엇인가?
  - 선택지: 완성 호출 blob 재사용 / 파생 cache만 사용
  - 추천: 완성 호출 출력과 원문 구간으로 재조립
  - 적용: 완성 호출·원문 구간 재조립
- **lophn-agent/harness/waiting-and-recovery#Q4** [질문] H8 Operator가 질문을 기다리는 동안 주기를 계속 건너뛰는 정책을 유지할 것인가?
  - 선택지: 계속 건너뛰기 / 별도 새 회차 허용
  - 추천: lophn-agent/harness/run-loop과 lophn-agent/scheduling대로 계속 건너뛰기
  - 적용: 계속 건너뛰기

### lophn-agent/observability

- **lophn-agent/observability#Q1** [충돌] 보존 기본을 자동 삭제 없음으로 둘까, 상세 180일·export 내용 14일·세션 종료 후 90일·UTC 일별 비용 365일로 둘까?
  - 선택지: 자동 삭제 없음;종류별 유한 기간
  - 추천: 별도 사람 합의 전 자동 삭제 없음 유지
  - 적용: R23
- **lophn-agent/observability#Q2** [질문] 유한 기간 합의 뒤 단축 소급·삭제 비복구·정리 주기를 어떻게 적용할까?
  - 선택지: 소급 없음;소급 적용·기동 및 1시간마다 최대 500개
  - 추천: 소급 적용·늘려도 삭제 비복구를 안내하되 정리 주기와 묶음은 platform/ledger·platform/blob-store와 정한다.
  - 적용: 현재 자동 삭제 없음
- **lophn-agent/observability#Q3** [질문] 첫 OTLP GenAI Semantic Conventions version을 무엇으로 고정할까?
  - 선택지: 수집기 검증한 한 version;다중 version
  - 추천: 구현 때 수집기로 검증한 한 version을 고정하고 export에 명시한다.
  - 적용: R15의 version 명시

### lophn-agent/questions

- **lophn-agent/questions#Q1** [충돌] 선택지 개수의 이전 2~6개 제한을 유지할까, 현재 상한 없음으로 갈까.
  - 선택지: 이전: 2~6개·1개/7개/기타/설명 없음 거절 / 현재: 고정 개수 상한 없음
  - 추천: 지금은 현재 모델을 적용하고 사용 사례로 상한 재검토
  - 적용: 현재 모델
- **lophn-agent/questions#Q2** [충돌] 답 기다림 질문의 이전 고정 900초 기한과 현재 기본 무기한 중 무엇을 쓸까.
  - 선택지: 이전: blocking 접수 후 900초·nonblocking 무기한, 899초 수락/900초 종료 / 현재: 기본 기한 없음·명시 기한만 경계 종료
  - 추천: 지금은 현재 모델을 적용
  - 적용: 현재 모델
- **lophn-agent/questions#Q3** [질문] 답 없는 질문에 기본 유한 기한을 도입할까.
  - 선택지: 기본 무기한 / 일정 시간 뒤 답 없음으로 stopped
  - 추천: 현재 기본 무기한 유지, 명시 기한 허용
  - 적용: 기본 기한 없음

### lophn-agent/revert

- **lophn-agent/revert#Q1** [질문] 복원 불가 변경이 섞인 run에 사람이 남는 영향 확인 후 부분 revert를 제공할까.
  - 선택지: 항상 전체 차단 / 명시 확인 뒤 복원 가능 변경 전체 적용
  - 추천: 현재 부분 revert 유지
  - 적용: 기본 차단·사람 명시 확인 뒤 안전한 부분 revert

### lophn-agent/role-definition

- **lophn-agent/role-definition#Q1** [질문] 내장 세 역할을 사람이 편집하거나 복사할 수 있게 할까.
  - 선택지: 현행 제품 정의 유지·Operator만 정의 / 다른 역할 복사본 편집 허용
  - 추천: 현행 유지
  - 적용: 내장 세 역할 편집·복사 금지

### lophn-agent/roles/app-engineer

- **lophn-agent/roles/app-engineer#Q1** [질문] H3: App Engineer 주기 검토를 추가할까.
  - 선택지: lophn-agent/roles/app-engineer의 사람 요청만 유지 / 주기 검토 추가
  - 추천: lophn-agent/roles/app-engineer 유지
  - 적용: 사람 요청과 handoff만
- **lophn-agent/roles/app-engineer#Q2** [질문] H7: App Engineer 티켓 생성에 매번 승인을 묻지 않는 lophn-agent/harness/tool-judgment를 유지할까.
  - 선택지: 되돌릴 수 있는 생성 허용 / 매번 approval request
  - 추천: lophn-agent/harness/tool-judgment 유지
  - 적용: 생성·읽기만 허용, 생성은 묻지 않음
- **lophn-agent/roles/app-engineer#Q3** [충돌] 이전 AE-17의 티켓 생성 ask와 lophn-agent/harness/tool-judgment의 매번 묻지 않는 생성을 어떻게 맞출까.
  - 선택지: 이전 티켓 생성마다 approval request / lophn-agent/harness/tool-judgment의 되돌릴 수 있는 생성 허용
  - 추천: lophn-agent/harness/tool-judgment 유지
  - 적용: 현재 모델

### lophn-agent/roles/lophn

- **lophn-agent/roles/lophn#Q1** [질문] 문서 추천의 30일·4회·2개 중 두 조건을 계속 추천 근거로 쓸까.
  - 선택지: 현행 보조 지표 유지 / 실제 사용 뒤 다른 지표로 교체
  - 추천: 사람 요청에서 설명 가능한 보조 근거로 유지
  - 적용: 보조 지표 유지
- **lophn-agent/roles/lophn#Q2** [충돌] 이전 LA-20의 문서 쓰기 허용 본문과 매번 확인이라는 확인 문장 중 무엇을 적용할까.
  - 선택지: 본문의 되돌릴 수 있는 문서 쓰기 허용 / 확인 문장의 매번 approval request
  - 추천: lophn-agent/roles/operator과 현재 역할 정책에 맞춰 요청 범위 문서 저장 허용
  - 적용: 현재 모델

### lophn-agent/roles/operator

- **lophn-agent/roles/operator#Q1** [질문] 구체적 Operator에 외부 MCP tool 선택을 허용할까.
  - 선택지: 현재 0개 유지 / 사람이 서버와 개별 tool을 승인해 선택
  - 추천: 첫 판은 0개 유지, 실제 사례가 생기면 extensions 계약과 함께 검토
  - 적용: 외부 MCP tool 0개
- **lophn-agent/roles/operator#Q2** [질문] 구체적 Operator에 등록한 반복 절차 skill 선택을 허용할까.
  - 선택지: 현재 0개 유지 / 등록 절차의 정확한 이름 선택
  - 추천: 첫 판은 0개 유지
  - 적용: skill 0개

### lophn-agent/scheduling

- **lophn-agent/scheduling#Q1** [질문] Operator에 cron 5칸·IANA 시간대의 현지 달력 주기를 추가할까.
  - 선택지: 현재 고정 간격만 / cron 5칸+IANA 시간대 / 둘 모두; 이전 예: 0 9 * * * + Asia/Seoul은 한국시간 매일 오전 9시
  - 추천: 첫 판은 현재 고정 간격 유지, 생활 시간 사례가 필요하면 현지 달력 추가
  - 적용: UTC 첫 시점·양수 밀리초 간격만
- **lophn-agent/scheduling#Q2** [질문] H8: Operator가 질문 답을 기다리는 동안 모든 회차를 건너뛰는 정책을 유지할까.
  - 선택지: 현재 skip / 질문 기한·대기 정책 변경
  - 추천: lophn-agent/harness/run-loop의 skip 유지
  - 적용: 사람 기다림을 포함한 미종료 run이면 skip

## coding-agent (30)

### coding-agent/cli

- **coding-agent/cli#Q1** [질문] H5 TTY 사람 확인을 보호 결정으로 계속 인정할까.
  - 선택지: confirmation window만; TTY와 보호 화면 모두
  - 추천: confirmation window만
  - 적용: TTY yes·script 승인 없음
- **coding-agent/cli#Q2** [질문] H2 coding agent가 준비한 모든 release activation에 사람 승인을 유지할까.
  - 선택지: 항상 사람 승인; 일부 자동 activation
  - 추천: 항상 사람 승인
  - 적용: 준비와 activation 분리·사람 승인
- **coding-agent/cli#Q3** [질문] 옛 앱 간 연결의 목록·생성·비활성화·계약 검사·activation을 첫 판에 포함하고 누가 소유할까.
  - 선택지: 첫 판 보류; 별도 앱 간 연결 concern 신설
  - 추천: 첫 판 보류하고 coding-agent connection으로 오인하지 않음
  - 적용: 앱 간 연결 관리 command 없음
- **coding-agent/cli#Q4** [질문] 효과 불명 invocation의 외부 효과 confirmed·none·사람 증거 기록을 어떤 계약으로 제공할까.
  - 선택지: 현재 invocation 조회만; 고정 invocation·판 근거와 보호 화면 결정 추가
  - 추천: 현재 apps/invocations 조회만 제공하고 사람 효과 판정은 소유 계약 확정 뒤 추가
  - 적용: 기존 효과 확정 command 미제공·효과 불명 유지
- **coding-agent/cli#Q5** [질문] 저장된 검색 관점 전용 CLI를 첫 판에 포함할까.
  - 선택지: keyword 검색·context로 대체; 저장 검색 관점 추가
  - 추천: coding-agent/mcp-server#Q3와 함께 첫 판 보류
  - 적용: keyword 검색·context 제공, 별도 저장 query 모델 없음
- **coding-agent/cli#Q6** [질문] live sample 조회를 CLI 추가 근거에 포함할까.
  - 선택지: 보존 snapshot만; 시간당 10회 제한 sample hook
  - 추천: coding-agent/repair-context#Q1과 함께 첫 판 보존 snapshot만
  - 적용: sample 실행과 별칭 없음

### coding-agent/connection

- **coding-agent/connection#Q1** [질문] 외부 세션에 claim 상실을 비강제 notification으로도 전달할까.
  - 선택지: 현재 claim 재조회만; 지원 확인된 제품에 notification 추가
  - 추천: 첫 판은 현재 claim 재조회만
  - 적용: 재조회만
- **coding-agent/connection#Q2** [질문] Claude Code의 지원·검증 최소 버전을 고정할까.
  - 선택지: 설치 버전별 capability 검사; 명시 최소 버전 목록
  - 추천: 설치 버전별 실제 skill 발견과 공통 안내 loading 검사
  - 적용: 설치 버전별 검사; 확인 못함을 성공으로 표시하지 않음
- **coding-agent/connection#Q3** [질문] 앱 범위 연결에서 프로젝트 근거를 어떻게 읽을까.
  - 선택지: 전체 연결; 앱에 고정 근거 저장; 별도 제한 읽기 허용 목록
  - 추천: 앞의 두 가지로 해결하고 첫 판에 별도 문서 권한을 추가하지 않음
  - 적용: 범위 밖 근거 내용 미제공

### coding-agent/guides

- **coding-agent/guides#Q1** [질문] OpenClaw 별도 workspace에서 앱 공통 안내를 어떤 방식으로 읽게 할까.
  - 선택지: 누락 경고와 명시 읽기; 지원 확인된 import 연동
  - 추천: 누락을 표시하고 앱 정본 명시 읽기를 안내
  - 적용: workspace 변경·지시 복제 없음
- **coding-agent/guides#Q2** [질문] skill 설치는 제품별 발견 위치 adapter를 기본으로 제공할까.
  - 선택지: 일곱 제품 adapter; 임의 디렉터리만
  - 추천: 일곱 제품 adapter와 사람이 고른 디렉터리 지원
  - 적용: 제품별 실제 발견·trust 안내
- **coding-agent/guides#Q3** [질문] 관리 경계가 없는 기존 안내에 최초 설치 때 구간을 추가할까.
  - 선택지: 무변경; 사람 동의 뒤 구간 추가
  - 추천: 일반 갱신은 무변경, 최초 추가는 사람 선택 뒤에만
  - 적용: 자동 추가 없음
- **coding-agent/guides#Q4** [충돌] 옛 SDK 우선순위와 중첩 skill metadata 예시를 첫 판에서도 유지할까.
  - 선택지: 개인 SDK 우선·중첩 metadata; 설치 SDK 우선·문자열 map
  - 추천: 첫 판에는 개인 SDK 없이 설치 SDK 우선, 문자열 map
  - 적용: 설치 SDK 탐색과 문자열 map

### coding-agent/mcp-server

- **coding-agent/mcp-server#Q1** [충돌] 옛 app test 기본 300초와 아직 미확정인 test runner timeout 정책을 어떻게 맞출까.
  - 선택지: adapter 기본 300초 유지; runner 공통 기본 확정 뒤 변경
  - 추천: 당장은 adapter가 300초를 명시하고 공통 상한·기본은 problems/tests#Q3에서 확정
  - 적용: adapter 기본 300초·runner의 유한 timeout 필수
- **coding-agent/mcp-server#Q2** [질문] 첫 판에 stdio 외 loopback HTTP MCP transport도 제공할까.
  - 선택지: stdio만; 인증된 loopback HTTP 추가
  - 추천: 첫 판 stdio만
  - 적용: stdio만
- **coding-agent/mcp-server#Q3** [질문] 저장된 검색 관점 읽기를 첫 판에 포함하고 어느 concern이 소유할까.
  - 선택지: keyword 검색과 context로 대체; 저장 검색 관점 추가
  - 추천: 첫 판은 documents/outline-and-search와 documents/contexts로 제공하고 별도 저장 query 모델은 보류
  - 적용: 저장 검색 관점 전용 tool 없음
- **coding-agent/mcp-server#Q4** [충돌] coding agent context 변경안이 고정 action 질문을 직접 생성할 수 있을까.
  - 선택지: coding agent 직접 생성 허용; 변경안 문서로 담당 lophn agent에 전달
  - 추천: 현재 질문 생성 권한을 유지하고 고정 변경안 문서 접수 후 담당 agent가 질문 생성
  - 적용: 제안 접수는 제공, coding agent 직접 질문 생성·적용 없음
- **coding-agent/mcp-server#Q5** [충돌] SDK 추가는 고정 import 안내만 반환할까 source import map도 바꿀까.
  - 선택지: 안내만; 명시 source 반영 선택
  - 추천: 안내를 기본으로 하고 명시 허용 source 반영도 제공
  - 적용: 기본 안내·명시 선택 반영·충돌 보존
- **coding-agent/mcp-server#Q6** [충돌] 옛 v2 수리 상세 16 KiB·capture 64 KiB·50개 목록 상한을 새 묶음에도 적용할까.
  - 선택지: 옛 별도 API 유지; 새 수리 자료 계약으로 통합
  - 추천: coding-agent/repair-context의 24 KiB·300줄과 근거별 페이지로 통합
  - 적용: 별도 v2 수리 단계·크기 체계 없음
- **coding-agent/mcp-server#Q7** [질문] runtime의 앱 간 연결 목록 읽기를 첫 판 MCP에 포함할까.
  - 선택지: 첫 판 보류; 별도 앱 간 연결 소유 계약 후 읽기 추가
  - 추천: coding-agent/cli#Q3와 함께 첫 판 보류
  - 적용: coding-agent connection과 다른 앱 간 연결 목록 tool 없음

### coding-agent/repair-context

- **coding-agent/repair-context#Q1** [질문] 현재 앱 sample hook을 추가 근거로 채택할까.
  - 선택지: immutable snapshot만; sample hook을 문제당 1시간 최대 10번
  - 추천: 첫 판은 보존된 immutable snapshot만
  - 적용: sample 실행 기능 없음
- **coding-agent/repair-context#Q2** [충돌] 옛 화면 64 KiB 상한과 새 24 KiB 상한 중 무엇을 적용할까.
  - 선택지: 화면 64 KiB; 모든 추가 텍스트 24 KiB
  - 추천: 24 KiB 페이지와 cursor
  - 적용: 24 KiB
- **coding-agent/repair-context#Q3** [충돌] 절별 줄 상한과 새 domain model의 자수·개수 상한을 어떻게 합칠까.
  - 선택지: 옛 줄 상한만; 새 자수·개수만; 두 상한 중 작은 것
  - 추천: 기본 묶음에 두 상한을 함께 적용하고 추가 읽기는 별도 페이지 상한
  - 적용: 기본 log 45줄·더 읽기 5줄·반환 4줄 등 더 작은 상한
- **coding-agent/repair-context#Q4** [질문] 근거가 가장 다른 발생의 비교 기준을 무엇으로 정할까.
  - 선택지: 고정 근거 값의 차이; release·오류·invocation 차이 가중
  - 추천: 고정 Report·snapshot의 오류·release·근거 차이를 비교하고 접수 순서로 동률 처리
  - 적용: 고정 근거만 사용·결정적 동률 처리
- **coding-agent/repair-context#Q5** [질문] 2 MiB를 넘는 이미지에 파생 축소나 부분 읽기를 제공할까.
  - 선택지: 크기와 미제공 이유만; 안전한 파생 축소; 부분 읽기
  - 추천: 첫 판은 미제공 이유와 크기를 표시
  - 적용: 상한 초과 이미지 미제공

### coding-agent/tickets

- **coding-agent/tickets#Q1** [질문] 긴 구현 세션에 기본 60분 claim을 유지할까.
  - 선택지: 60분 명시 갱신; 사람이 고른 더 긴 기간
  - 추천: 기본 60분 명시 갱신을 먼저 사용하고 실제 긴 구현 사례로 조정
  - 적용: 60분·명시 갱신만
- **coding-agent/tickets#Q2** [질문] H4 reproduction test 없는 수리 ticket도 사람 acceptance check로 허용할까.
  - 선택지: 현행 ticket 없는 직접 수리; 사람 확인만 조건으로 허용
  - 추천: 현행 직접 수리
  - 적용: reproduction test 없는 수리 ticket 생성 거절
- **coding-agent/tickets#Q3** [질문] 구현 ticket 완료 끝점을 공통 기본값으로 정할까.
  - 선택지: ticket별 test·preview 또는 activation 명시; 공통 기본 끝점
  - 추천: ticket별 명시
  - 적용: activation은 명시 조건일 때만
- **coding-agent/tickets#Q4** [질문] H7 담당 App Engineer의 승인 없는 즉시 ticket 생성을 유지할까.
  - 선택지: lophn-agent/harness/tool-judgment 유지; 생성마다 질문
  - 추천: lophn-agent/harness/tool-judgment 유지
  - 적용: 별도 승인·공개 단계 없이 즉시 열림
- **coding-agent/tickets#Q5** [충돌] 옛 24시간 문제 claim과 읽기 자동 갱신을 유지할까.
  - 선택지: 문제 claim 24시간·읽기 갱신; ticket claim 60분·명시 갱신
  - 추천: problems/repairs과 apps/releases 및 새 ticket 정책
  - 적용: ticket에만 60분 claim·명시 갱신

## shell (12)

### shell/app-frame

- **shell/app-frame#Q1** [질문] 문서 session을 고정 판마다 나눌까, 문서 단위로 공유할까?
  - 선택지: 고정 판별;문서별
  - 추천: 고정 판별 메모리 session을 유지한다.
  - 적용: R1·R8·R10

### shell/confirmation-window

- **shell/confirmation-window#Q1** [질문] TTY의 직접 확인도 사람 승인으로 인정할까(H5)?
  - 선택지: confirmation window만;TTY 증거 추가
  - 추천: confirmation window만 유지하고 CLI는 보호 화면을 여는 안내만 제공한다.
  - 적용: R1
- **shell/confirmation-window#Q2** [질문] MCP sampling·elicitation을 승인 흐름에 쓸까?
  - 선택지: 사용하지 않음;보호 화면 열기 안내만
  - 추천: MCP는 승인할 수 없고 필요하면 confirmation window를 여는 안내만 한다.
  - 적용: R1
- **shell/confirmation-window#Q3** [질문] 앱 동작 전후를 설명·안전 preview 중 무엇으로 보여 줄까?
  - 선택지: 설명;격리 preview;둘 다
  - 추천: 설명을 기본으로 하고 안전 preview가 제공되는 경우에만 추가한다.
  - 적용: R10

### shell/design-system

- **shell/design-system#Q1** [질문] UI customization을 token override만 둘까, slot·fork까지 제공할까?
  - 선택지: token만;slot·fork도
  - 추천: 초기 token override만 제공하고 실제 두 번째 소비자와 앱 SDK 사례 뒤 slot·fork 계약을 정한다.
  - 적용: R3·R4의 token override
- **shell/design-system#Q2** [질문] 앱별 theme 예외와 오래된 SDK의 시각 drift를 어디까지 허용할까?
  - 선택지: 전역 일치 강제;앱 고정 version 유지
  - 추천: apps/sdk의 version 고정을 존중하고 전역 override는 공통으로 존재하는 token에만 적용한다.
  - 적용: 앱별 강제 SDK 변경 없음
- **shell/design-system#Q3** [충돌] 1280px 분할의 읽기 폭은 원문 표 456px인가, 여백 규칙대로 488px인가?
  - 선택지: 456px;488px
  - 추천: 칸 폭 기준16px 여백으로 488px를 사용한다.
  - 적용: R42
- **shell/design-system#Q4** [질문] UI 구현 재료를 CSS Modules·Radix Primitives·Lucide로 유지할까?
  - 선택지: 기존 재료;동등 primitive
  - 추천: 기존 재료로 시작하고 동등 접근성 근거가 있을 때만 교체한다.
  - 적용: R44
- **shell/design-system#Q5** [질문] 입력 경계 대비 1.8:1을 3:1로 강화할까?
  - 선택지: 색 강화;라벨·배경으로 보완
  - 추천: 기존 색표는 유지하되 입력 식별이 필요한 경계·focus의3:1을 검사하고 부족한 경우 보완 또는 강화한다.
  - 적용: R43
- **shell/design-system#Q6** [질문] system font 기본 선택·global compact·사용자 accent 변경을 허용할까?
  - 선택지: 기본 그대로;각각 선택 지원
  - 추천: Pretendard 기본·표만 compact·검증된 전역 accent override로 시작한다.
  - 적용: R45

### shell/desktop

- **shell/desktop#Q1** [질문] Electron·Deno·SQLite 기술 선택을 유지할까(H6)?
  - 선택지: 유지;대체
  - 추천: 기존 기술 선택 유지
  - 적용: R11·R17
- **shell/desktop#Q2** [충돌] 전역 팔레트와 런처 복귀 shortcut의 범위·기능을 구별할까?
  - 선택지: 서로 구별;하나로 통합
  - 추천: 전역 팔레트 Shift+K와 창 안 런처 Shift+L을 구별한다.
  - 적용: R18

## domain model 사이 (14)

### domain model 사이

- **dm#C1** [충돌] RunSource.assignment_revision이 seq인데 Assignment.revision은 1부터 늘어나는 정수
  - 선택지: run-loop를 정수로 / assignments를 seq로
  - 추천: run-loop를 정수로
  - 적용: 해결: run·context basis를 정수 revision으로 맞춤
- **dm#C2** [충돌] tool 이름 표기(역할 파일은 document.save_version 같은 점 표기 제안)와 harness/tools 목록의 이름 규칙
  - 선택지: 점 표기로 통일 / tools.md 규칙으로
  - 추천: tools.md가 정한 규칙으로 역할 파일을 맞춤
  - 적용: 해결: 내장 tool 이름 점 표기로 통일
- **dm#C3** [충돌] approval 한 번 사용(approval_uses)을 apps/invocations·permissions·releases·lophn-agent/assignments가 같은 공통 함수로 써야 함
  - 선택지: 각 파일에 명시 / ledger 공통 command로
  - 추천: platform/approvals의 공통 규칙을 각 파일이 가리키게
- **dm#C4** [충돌] notification 조건 근거(운영 보고인지, machine pause인지, watch 확정)를 각 event payload가 실어야 함
  - 선택지: 각 event payload에 필드 추가
  - 추천: 각 소유 파일에 필드 추가
- **dm#C5** [충돌] revert의 영역별 이전 값·현재 CAS·복원 뒤 의존 검사, 원본 연결 문서의 파일 반영 계약
  - 선택지: 각 영역이 revert 가능 표시와 보정 방법 제공
  - 추천: 각 영역 파일에 revert 정책 절
- **dm#C6** [충돌] (app, document declaration key) 대응과 place 교차 unique의 정본이 apps와 documents 사이에서 미정
  - 선택지: documents/addressing 정본 / apps/registration 정본
  - 추천: documents/addressing 정본
- **dm#C7** [충돌] place_names 예약·rename transaction을 projects와 apps/registration이 공유
  - 선택지: 공통 표 하나 / 각자
  - 추천: documents/addressing의 공통 표 하나
- **dm#C8** [충돌] ledger 공통 command 기록의 compare/prepared 필드와 각 파일 command 입력 이름이 다름
  - 선택지: ledger 이름으로 통일
  - 추천: ledger 이름으로 통일
- **dm#C9** [충돌] provider·model 설정 원본과 일반 settings의 중복 저장
  - 선택지: provider·model은 자기 표 / settings 표
  - 추천: provider·model은 자기 표, settings는 참조만
- **dm#C10** [충돌] repair-context의 대표 발생·추가 근거 상한이 snapshots와 겹칠 수 있음
  - 선택지: repair-context 정본
  - 추천: repair-context 정본, snapshots는 고정 증거만
- **dm#C11** [충돌] Role.ToolSelection은 command 이름만, 승인된 (app, command) 쌍은 Assignment에 고정 — 승인·tools·blueprint가 같은 쌍 검사를 공유해야 함
  - 선택지: 공통 검사 규칙 하나
  - 추천: lophn-agent/assignments 정본
- **dm#C12** [충돌] extensions(skill, 외부 MCP)가 architecture/agent-runtime.md에는 없다고 적혀 있음
  - 선택지: architecture를 고침
  - 추천: architecture 재작성 때 반영
- **dm#C13** [충돌] 한눈에 보기 예시의 "정해진 기간 재발이 없으면 닫힘"이 problems/closing 규칙(조용히 닫힘 없음)과 다름
  - 선택지: 예시 고침
  - 추천: domain-model/README의 entity 지도 쓸 때 고침
  - 적용: flows/app-broken.md에서 고침
- **dm#C14** [충돌] harness/waiting-and-recovery의 run_wait_resolutions(결정 seq, 요청 key 중복 반영)를 platform/approvals·lophn-agent/questions의 결정 전달과 맞춰야 함
  - 선택지: 한쪽을 정본으로
  - 추천: approvals·questions가 결정을 내고 run_wait_resolutions가 seq로 한 번만 반영
  - 적용: 해결: 대기 decision_seq를 Question·ApprovalRequest의 closed_seq와 맞춤

## product (1)

### product

- **product#Q1** [질문] 기술 선택: SDK·앱·core·MCP server를 TypeScript 하나로 통일하고 Electron·Deno·SQLite를 이어 쓸까(H6)
  - 선택지: 유지 / 바꿈
  - 추천: 유지
  - 적용: 없음(architecture에서 정함)

