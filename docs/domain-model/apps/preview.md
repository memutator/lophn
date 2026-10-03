---
type: domain-model
concerns: [apps/preview]
---
# apps/preview

activation 없는 preview의 데이터 구분과 허용 범위를 정의한다.

preview는 별도 entity·ID·운영 상태·ledger 표가 아니다. 같은 고정 bundle을 별도 프로세스로 열며 통로 값은 → apps/runtime, 기록은 → apps/invocations의 mode=preview다.

## PreviewInput (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | `app` ID | 아니오 | → apps/registration; connection scope | 대상 앱 |
| `bundle_hash` | sha256 | 아니오 | 실제 완성된 고정 bundle; → apps/releases | 확인 내용 |
| `release` | `rel` ID | 예 | 있으면 같은 app·bundle; 준비 전 bundle이면 없음 | 준비된 release 참조 |
| `fixture_hash` | sha256 | 예 | 테스트 데이터; 운영 DB/backup 자동 복사 금지 | preview 입력 DB |

## PreviewEnvironment (값)

프로세스 메모리와 disposable 파일에만 존재한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `process_nonce` | 무작위 문자열 | 아니오 | 시작마다 새 값 → apps/runtime | 프로세스 구분 |
| `data_path` | 절대 경로 | 아니오 | apps/<app ID>/preview/<process_nonce>/data.db; 운영 data와 분리 | 테스트 DB |
| `mode` | `preview` | 아니오 | 고정 | 통로·보고·결과 구분 |
| `secret_adapter` | `test_double` | 아니오 | 실제 keychain/secret 사용 금지 | secret 대역 |
| `external_adapter` | `test_double` | 아니오 | 외부 쓰기 금지 | 외부 효과 대역 |
| `document_adapter` | `test_double` | 아니오 | 실제 document version 생성 금지 | 문서 저장 대역 |

## 정책

- **분리.** 운영 socket·DB·backup·실제 secret credential은 preview에 없다. 외부 쓰기·실제 문서 저장·다른 앱 실제 조회·loopback listen은 허용하지 않고 대역으로만 확인한다. 내부 테스트 데이터 변경은 가능하다. 선언·입력·scope 검사는 운영과 같은 형태로 하며 필요한 권한 효과는 대역이다. 살아 있는 preview가 없으면 unavailable이며 운영 앱으로 대신 호출하지 않는다.
- **결과.** 응답·invocation·report·test 근거에 preview를 붙인다. preview 보고로 운영 Problem을 open/reopen/close하지 않는다(→ problems/reporting, problems/closing).
- **기록.** release에 고정되기 전 preview는 inv의 release를 꾸며 만들지 않는다. bundle hash 대상의 → problems/tests Verification과 개발 진단으로 남긴다. release가 있으면 그 release의 preview Invocation을 쓴다.
- **automation.** preview의 clock은 꺼진다. 수동 확인은 같은 command handler를 호출하며 운영 automation 회차를 만들지 않는다.
- **결정.** confirm command의 실제 handler는 실행하지 않고 approval도 소비하지 않는다. 확인 동작은 대역으로만 보이며 대역 성공을 실제 실행 성공으로 표시하지 않는다. preview 성공은 Grant·activation approval·운영 정상의 근거가 아니다. 활성 참조·run_enabled·운영 데이터를 바꾸지 않는다.
- **수명.** 별도 view session을 사용한다(→ shell/app-frame). 종료 뒤 disposable DB·연결은 폐기할 수 있으며 고정 bundle/test 근거는 각 concern의 보존 규칙을 따른다.
