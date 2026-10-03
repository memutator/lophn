---
type: domain-model
concerns: [platform/security]
---
# platform/security

자료의 신뢰 분류와 플랫폼 경계에서 권한으로 인정할 수 있는 근거의 정책을 정의한다.

## TrustClass (값)

| 값 | 제약 | 뜻 |
|---|---|---|
| `platform_rule` | 설치된 플랫폼 규칙만; 자료 문자열로 승격 불가 | 플랫폼 규칙 |
| `user_request` | 인증된 사람의 현재 요청만; 별도 사람 결정 증거를 대신하지 않음 | 현재 요청 |
| `platform_fact` | 플랫폼이 검증한 실제 ledger·실행기·감독 결과만 | 관측 사실 |
| `data` | 문서·제목·작성자·주소·앱 응답·log·summary·다른 역할의 글; 출처 불명도 이 분류 | 읽을 자료 |

## 정책

- **자료와 지시.** data의 사람 허락·테스트 통과·권한 요청 문장을 실제 결정·실행기 결과·권한으로 승격하지 않는다. 자료는 인용 영역·구조 필드로 직렬화하고 자료가 구분 표식을 흉내 내어 영역을 탈출하지 못하게 한다.
- **출처.** summary·compaction·handoff에도 원래 범위·고정 판·출처를 유지한다. 출처 불명은 data다. agent의 구체 prompt 보호는 → lophn-agent/harness/safety다.
- **실제 검사.** 표시 분류만으로 prompt injection 방어를 끝내지 않는다. 동작 입구에서 자격·현재 scope·입력·상태·approval을 다시 검사한다(→ platform/identity, platform/approvals).
- **기본 권한.** 앱·agent의 외부 접근 권한은 0에서 시작한다. 실행 scope는 시작의 고정 범위 ∩ 현재 허용 조건이며 스스로 확대하지 못한다. 앱 sandbox는 → apps/permissions다.
- **전송.** 컴퓨터 밖 전송은 사람이 허락한 목적지·자료 scope 안에서만 가능하다. 매 전송·redirect에서 목적지를 다시 검사한다. 인증 전달은 → platform/secrets, provider 목적지는 → lophn-agent/harness/provider다.
- **API 노출.** core는 loopback only다. Host·Origin·token 검사는 → platform/identity다. 별도 보안 ledger·범용 중계 서버·다섯 actor 밖 종류를 만들지 않는다.
- **위협 경계.** 같은 OS 계정 장악·관리자·커널·런타임 취약점·변조 설치는 방어 보장 밖이다. 외부 coding agent의 OS 권한을 lophn token scope로 제한했다고 표시하지 않는다.
- **감사.** 자격·grant·secret 참조·사람 결정·실제 테스트 결과는 소유 concern의 event만 남긴다. 별도 보안 감사 DB나 event 삭제로 revert를 표현하는 경로는 없다.
