# written: server-supervision

분류표: `triage/server-supervision.md`. candidate 23줄을 23개 요구로 옮겼다. 합친 줄은 없고, 뺀 candidate 줄도 없다.

## core-server.yaml

| 새 ID | 분류표 줄 |
|---|---|
| req-0200 | api R1a |
| req-0201 | api R2a |
| req-0202 | api R3a |
| req-0203 | api R4 |
| req-0204 | api R6b |
| req-0205 | identity R1 |
| req-0206 | identity R3a |
| req-0207 | identity R6a |
| req-0208 | identity R7a |
| req-0209 | identity R9a |
| req-0210 | identity R10a |
| req-0211 | identity R11 |
| req-0212 | identity R2 |
| req-0213 | identity R12 |
| req-0214 | identity R13a |
| req-0215 | identity R13b |
| req-0216 | responsiveness R1a |
| req-0217 | responsiveness R3a |
| req-0218 | responsiveness R3b |
| req-0219 | security R6 |
| req-0220 | security R8a |

## core-supervision.yaml

| 새 ID | 분류표 줄 |
|---|---|
| req-0250 | identity R4b |
| req-0251 | responsiveness R5b |

## 메모

- 합친 줄: 없음. 줄마다 보장이 달라 1:1로 옮겼다(identity R3a와 R9a는 둘 다 범위 판정이지만 하나는 범위 밖 요청의 거절, 하나는 주소·hash를 안다고 권한이 생기지 않음이라 따로 뒀다).
- identity R1: 분류표 이유 칸의 "호출자 종류 목록이 새 모델과 같은지 확인되지 않음"에 따라 종류 목록은 쓰지 않았다(req-0205).
- identity R4b: 자격을 쥔 쪽이 supervision인지 app-runtime인지 확인되지 않았다. 분류표대로 supervision을 subject로 뒀다(req-0250).
- 분류표에서 api R3a의 HTTP 상태 숫자 대응은 이미 뺀 상태라 쓰지 않았다.
