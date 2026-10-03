---
type: requirements
concerns: [platform/diagnostics]
---
# platform/diagnostics

lophn 자체의 운영 log·crash 기록·상태 점검을 제공하여 사람이 플랫폼이 왜 멈췄는지 찾게 하는 일을 맡는다; agent run trace는 lophn-agent/observability, 앱의 문제와 증거는 problems/reporting과 problems/snapshots가 맡는다.

## 요구

### 실패 구분과 안전한 기록

**[R1]** lophn 내부·SDK·desktop 오류는 앱을 사용하던 중 발생했어도 앱 문제로 돌리지 않고 플랫폼 진단으로 기록한다.
- 이유: 앱 coding agent가 플랫폼 버그를 앱 코드로 고치려 하지 않게 한다.
- 확인: 앱 코드 frame이 없는 내부 exception과 SDK 내부 오류를 일으켜 앱 problem은 생기지 않고 플랫폼 오류 종류와 안전한 위치가 진단에 남는지 본다; 앱 process crash·timeout 귀속은 apps/runtime과 problems/reporting을 따른다.
- 의도: platform#I5

**[R2]** 운영 log와 crash 기록에는 구성 요소·관측 시각·오류 종류·안전한 위치·redaction한 설명을 남기되 원시 crash 메모리·stdout·stderr·HTTP dump를 자동 보관하지 않는다.
- 이유: 진단에 필요한 실패 경계는 남기면서 secret과 원문 입력의 유출을 막는다.
- 확인: token·인증 header·secret·비공개 경로를 포함한 오류를 만들고 안전한 분류만 남으며 redaction 실패 때 원문을 빼고 이유가 기록되는지 본다; 가공은 platform/redaction을 따른다.
- 의도: platform#I4, platform#I5

**[R3]** 운영 log는 비동기와 크기 제한으로 쓰며 log 출력이 막혀도 API·command·무관한 앱 응답을 기다리게 하지 않는다.
- 이유: 진단 기능의 실패가 플랫폼 기능의 실패로 번지지 않아야 한다.
- 확인: log 쓰기를 지연시키거나 실패시켜 무관한 응답이 계속되고 진단 자료는 설정한 한도를 넘지 않는지 본다.
- 의도: platform#I5

**[R4]** 디스크 부족·ledger 손상은 플랫폼 실패로 표시하며 저장 성공이나 확정 command 결과를 log·메모리·별도 텍스트 기록으로 대신하지 않는다.
- 이유: 진단 log는 업무 사실의 원본이 아니다.
- 확인: 저장 실패에서 성공 응답이나 앱 problem으로 바뀌지 않고 플랫폼 실패와 확인 가능한 이유가 남는지 본다.
- 의도: platform#I5

**[R5]** 플랫폼 진단과 log 화면의 오류 상세는 platform/redaction을 통과한 내용만 제공하고 가공할 수 없는 원문·stack은 제공하지 않는다.
- 이유: 개발자용 화면이라고 secret 노출을 허용하지 않는다.
- 확인: 접힌 상세에서도 안전 처리되지 않은 원문이 없고 제외 이유가 보이는지 본다; 화면 배치는 shell/desktop을 따른다.
- 의도: platform#I4

### 보안과 상태 점검

**[R6]** 권한 부여·회수·secret 사용·인증 실패·Origin 거부·권한 밖 접근은 보안 진단으로 구별하되 감사 원본과 현재 상태는 platform/ledger·platform/identity·apps/permissions·platform/secrets의 사실을 참조한다.
- 이유: 보안 문제를 찾을 수 있게 하면서 같은 사실의 두 원본을 만들지 않는다.
- 확인: 각 상황을 일으켜 보안 진단으로 찾을 수 있고 범위 밖 대상과 secret 원문이 노출되지 않는지 본다.
- 의도: platform#I4

**[R7]** 무인증 요청의 인증 실패와 거부는 제한된 안전 운영 log에 남기고 대량 요청마다 ledger event를 만들지 않는다.
- 이유: 공격성 요청이 원본 ledger와 저장 공간을 소모하지 않게 한다.
- 확인: 많은 무인증 요청을 보내 ledger 사실은 늘지 않고 제한된 진단만 남는지 본다.
- 의도: platform#I5

**[R8]** 상태 점검은 구성 요소별 현재 사용 가능 여부·안전한 불가 이유·실제 관측 시각을 보여 주며 platform/identity의 인증과 scope를 요구한다.
- 이유: 상태 확인 경로도 비공개 자료와 자격 경계를 지켜야 한다.
- 확인: 인증 없이는 안전한 일반 오류만 받고 인증 뒤에는 실제 점검한 현재 상태와 시각을 받는지 본다.
- 의도: platform#I4

**[R9]** 설치 상태 점검은 bundle에 포함된 SDK와 설치된 같은 version SDK의 내용 hash 불일치를 사람이 찾을 수 있게 한다.
- 이유: 같은 version이 다른 바이트를 뜻하면 앱의 실패 원인을 추적할 수 없다.
- 확인: 설치 SDK 바이트를 바꾸어 상태 점검에서 package 이름·version과 불일치를 확인하는지 본다; version 규칙은 apps/sdk를 따른다.
- 의도: platform#I7

**[R10]** 보안 상태 점검은 실행 자격 보관의 권한·너무 넓은 grant·file과 network를 함께 허용한 앱·오래 쓰지 않은 grant·log에 남은 미가공 key 패턴을 검사해 안전한 결과로 제시한다.
- 이유: 설정과 자료에 남은 위험을 한 점검 경로에서 찾게 한다.
- 확인: 각 위험을 가진 자료를 준비하여 실제 근거와 관측 시각이 보이고 의심 값 원문은 반환되지 않는지 본다; 검사 대상의 허용 정책은 platform/identity와 apps/permissions를 따른다.
- 의도: platform#I4

**[R11]** 운영 log의 기본 level은 info로 둔다.
- 이유: 평상시 진단은 남기되 상세 입력과 과도한 출력이 기본으로 쌓이지 않게 한다.
- 확인: 첫 설치의 적용 level이 info이고 변경 선택은 platform/settings를 통해 조회되는지 본다.
- 의도: platform#I5

**[R12]** 운영 log와 crash 기록은 용량 상한을 넘으면 오래된 것부터 정리하며 감사 event·확정 command 결과·결정 같은 영구 보존 기록을 log로 대신하거나 log 정리로 지우지 않는다.
- 이유: 운영 log는 큰 자료라 유한한 디스크에 맞춰 정리하되 무엇이 왜 바뀌었는지는 남긴다.
- 확인: 상한을 넘겨 가장 오래된 log만 정리되고 ledger의 event·확정 결과·결정은 그대로이며 정리 뒤에도 최근 진단은 조회되는지 본다.
- 의도: platform#I2, platform#I5

## 열린 질문

없음.

## 버린 것

- host 개발자 진단 화면에서 미가공 원문 오류를 보여 주던 허용은 버린다: 새 domain model의 안전한 내용만 제공하는 경계를 따른다.
- 앱 operation log 200줄·최근 500 operation·Linux VmRSS 60초 측정은 이 concern의 자체 log 한도로 옮기지 않는다: apps/runtime과 problems/snapshots의 앱 감독 자료다.
