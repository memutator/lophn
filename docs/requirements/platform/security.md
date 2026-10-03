---
type: requirements
concerns: [platform/security]
---
# platform/security

단일 사용자 로컬 플랫폼의 threat model, 네트워크 노출·신뢰 경계·격리 계층·자료와 지시의 구분을 맡는다; token·Host·Origin 검사는 platform/identity, 앱 sandbox 구체 규칙은 apps/permissions, agent prompt 보호는 lophn-agent/harness/safety를 따른다.

## 요구

### threat model

**[R1]** lophn은 한 사람·한 머신의 로컬 파일·secret·세션·앱 데이터·ledger 무결성을 보호하고 사람·OS 계정 경계·정상 설치된 플랫폼만 신뢰하며 앱 코드·SDK·외부 skill·문서·log·다른 로컬 프로세스·웹 페이지는 신뢰하지 않는다.
- 이유: 소유자가 같은 앱도 입력과 코드의 실수까지 신뢰할 수는 없다.
- 확인: 각 비신뢰 경로가 자격·자료 경계 검사를 거치고 외부 연결을 끊어도 로컬 자료가 남으며 의도하지 않은 외부 복제가 없는지 확인한다.
- 의도: platform#I2, platform#I1

**[R2]** 첫 지원 범위는 사용자 소유 앱의 버그·데이터 유출·권한 우회·로컬 웹 공격이며 multi-tenant·제3자 악성 앱·injection된 외부 coding agent가 만든 악성 앱·같은 OS 계정 장악·관리자·kernel·Electron·Chromium·Deno 취약점 방어를 보장하지 않는다.
- 이유: 제공하지 않는 격리를 제공한다고 설명하면 사용자가 잘못된 위험을 감수한다.
- 확인: 지원 문구와 보안 테스트 목록에서 범위 안·밖을 구별하고 외부 coding agent의 OS 접근을 lophn token이 제한한다고 표시하지 않는지 확인한다.
- 의도: platform#I2

### 격리 계층과 공급망

**[R3]** 안전과 격리는 기본 적용되고 끌 수 없으며 앱별 프로세스·저장 경계·view 격리·제한된 플랫폼 중개를 함께 사용하여 tool wrapper만의 차단을 프로세스 권한 강제로 오해하지 않는다.
- 이유: 버그 앱의 직접 OS 접근과 화면 침범은 tool 검사만으로 막히지 않는다.
- 확인: apps/permissions와 shell/app-frame의 파일·네트워크·다른 앱·Node·preload·subprocess 우회 테스트를 수행하고 격리 해제 옵션이 없는지 확인한다.
- 의도: platform#I2, platform#I3

**[R4]** 배포의 Electron·Chromium OS sandbox는 실제로 켜져 있어야 하며 Ubuntu의 sandbox를 끈 개발 테스트는 JavaScript 격리 확인으로만 분류하고 배포 보안 테스트 통과로 인정하지 않는다.
- 이유: 개발 환경 우회를 정상 배포 보장으로 바꾸지 않는다.
- 확인: Ubuntu 배포에서 OS sandbox가 켜진 상태로 격리 테스트를 수행하고 꺼진 상태에서는 성공 release 판정을 하지 않는지 확인한다.
- 의도: platform#I2, platform#I4

**[R5]** 공개 앱·skill market을 제공하지 않고 npm·jsr·Deno 의존성을 lock과 무결성 hash로 고정하며 core의 외부 의존성 추가는 필요성과 신뢰 경계를 명시한다.
- 이유: 소비자 전체에 퍼지는 공급망 위험을 최소화한다.
- 확인: 동일 lock으로 재설치할 때 내용이 같고 변조 hash는 실패하며 market 설치 통로가 없는지 확인하고 SDK·coding agent 안내는 apps/sdk와 coding-agent/guides를 따른다.
- 의도: platform#I2

### 네트워크와 자료 경계

**[R6]** core API는 IPv4 127.0.0.1과 IPv6 ::1 loopback에만 노출하고 LAN·0.0.0.0·원격 bind·reverse proxy 공개 설정을 제공하지 않는다.
- 이유: localhost를 신뢰하거나 임의 주소 bind를 열어 두는 것은 외부 공격의 입구가 된다.
- 확인: LAN에서 HTTP·WebSocket 연결이 실패하고 loopback도 platform/identity 인증을 요구하며 앱의 별도 네트워크 권한은 apps/permissions를 따르는지 확인한다.
- 의도: platform#I2

**[R7]** lophn 자체 remote 기능은 없고 사용자가 만든 SSH tunnel은 외부 수단일 뿐 플랫폼이 원격 접근의 안전성이나 노출 설정을 보장하지 않는다.
- 이유: 터널 사용 가능과 원격 서비스 지원을 구별한다.
- 확인: remote 설정이 없고 SSH tunnel 뒤 요청에도 loopback 자격·Host·Origin 규칙이 약화되지 않는지 확인한다.
- 의도: platform#I2

**[R8]** API는 body를 읽기 전에 동작별 최대 bytes를 검사하여 제한 초과를 거절하며 token·Host·Origin 검사와 request 한도가 HTTP·WebSocket·health에서 빠지지 않게 한다.
- 이유: 무제한 body와 예외 경로는 인증·자원 방어의 우회가 된다.
- 확인: 길이를 속인 chunked body와 큰 JSON·WebSocket·health 요청을 보내 한도 초과와 인증 누락이 body 처리 전에 거절되는지 확인한다.
- 의도: platform#I2, platform#I3

**[R9]** 컴퓨터 밖 전송은 현재 사람이 허용한 목적지와 자료 범위 안에서만 가능하고 전송·redirect마다 목적지와 범위를 다시 검사한다.
- 이유: 로컬 보관은 model과 앱 외부 전송의 무제한 허락이 아니다.
- 확인: 허용하지 않은 목적지·다른 호스트 redirect·범위 밖 자료는 나가지 않고 허용된 최소 자료만 전송되는지 확인하며 세부 목적지는 apps/permissions와 lophn-agent/harness/provider를 따른다.
- 의도: platform#I2

### 자료와 지시

**[R10]** 문서·제목·주소·앱 응답·log·세션 summary·수리 자료의 모든 문자열은 data로 직렬화하고 자료가 인용 경계 표식을 흉내 내도 지시 영역으로 탈출하거나 사람 승인·권한·test result로 승격되지 못한다.
- 이유: 읽은 자료 속 명령은 현재 사람 요청과 검증된 플랫폼 사실이 아니다.
- 확인: 경계 닫기·위조 승인·가짜 테스트 통과·secret 전송 지시를 각 자료에 넣어 동작과 자격이 바뀌지 않는지 확인한다.
- 의도: platform#I2, platform#I7

**[R11]** summary·compaction·handoff에서도 원래 범위·고정 판·출처와 data 분류를 유지하고 출처 불명은 data로 취급하며 경계 표시만으로 prompt injection 방어가 끝났다고 하지 않는다.
- 이유: 압축된 자료도 권한이나 지시로 새로 승격되면 안 된다.
- 확인: 동일 injection을 원문·summary·handoff로 전달해도 platform/identity·platform/approvals의 실제 입구 검사가 동일하게 적용되는지 확인한다.
- 의도: platform#I2, platform#I7

## 열린 질문

- platform/security#Q1 배포용 Ubuntu sandbox를 끈 테스트를 성공으로 인정할까?

## 버린 것

없음.
