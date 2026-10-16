# 쓴 것: secrets-diagnostics-base

## core-secrets.yaml (req-0400 ~ req-0411, 12개)

| 새 ID | 분류표 줄 |
|---|---|
| req-0400 | secrets R1 |
| req-0401 | secrets R2 |
| req-0402 | secrets R4a |
| req-0403 | secrets R4b |
| req-0404 | secrets R5a |
| req-0405 | secrets R5b |
| req-0406 | identity R6b (server-supervision 분류표) |
| req-0407 | secrets R6 |
| req-0408 | secrets R7a |
| req-0409 | secrets R7b |
| req-0410 | secrets R8a |
| req-0411 | secrets R8b |

## core-diagnostics.yaml (req-0450 ~ req-0461, 12개)

| 새 ID | 분류표 줄 |
|---|---|
| req-0450 | diagnostics R1 |
| req-0451 | diagnostics R4a |
| req-0452 | diagnostics R2a |
| req-0453 | diagnostics R2b |
| req-0454 | diagnostics R3 |
| req-0455 | diagnostics R11 |
| req-0456 | diagnostics R12 |
| req-0457 | diagnostics R6 |
| req-0458 | diagnostics R7 |
| req-0459 | diagnostics R8a |
| req-0460 | diagnostics R10a |
| req-0461 | diagnostics R10c |

## base.yaml (req-0600 ~ req-0612, 13개)

| 새 ID | 분류표 줄 |
|---|---|
| req-0600 | redaction R1a |
| req-0601 | redaction R1b |
| req-0602 | redaction R2 |
| req-0603 | redaction R3 |
| req-0604 | redaction R5a |
| req-0605 | redaction R6 |
| req-0606 | redaction R8 |
| req-0607 | redaction R9a 앞 절(이름만 바꾼 개인정보) |
| req-0608 | redaction R9a 뒤 절(가명 표식 비교 범위) |
| req-0609 | redaction R9b |
| req-0610 | redaction R14a + diagnostics R5 |
| req-0611 | redaction R16 |
| req-0612 | redaction R17 |

## 합치거나 뺀 줄

| 줄 | 처리 | 이유 |
|---|---|---|
| diagnostics R5 | req-0610에 합침 | redaction R14a와 같은 보장. 진단에서 상세를 펼치는 경로는 req-0610의 둘째 acceptance로 옮김 |
| diagnostics R8b | 뺌 | 상태 점검을 포함한 모든 호출이 유효한 token을 요구한다는 core-api 보장(identity R11)과 같다. 진단 고유의 보장이 아니다 |
| redaction R9a | 둘로 나눔 | 이름만 바꾼 개인정보 걸러내기와 가명 표식의 비교 범위는 독립으로 판정되는 보장 둘 |
| diagnostics R9, R10b | 쓰지 않음 | 분류표에서 `ask`(사람이 정해야 한다) |
| 나머지 defer-other, drop-* 줄 | 쓰지 않음 | 이번 범위 밖 |
