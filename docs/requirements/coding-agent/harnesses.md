---
type: requirements
concerns: [coding-agent/harnesses]
---
# coding-agent/harnesses

제품이 배포하는 harness catalog, 이 컴퓨터의 감지·설치·loading 관측, lophn이 쓴 resource의 receipt와 안전한 갱신·제거, 기본 harness 선택을 맡는다. credential은 coding-agent/connection, session 시작·관측은 coding-agent/sessions, 배포 안내의 내용은 coding-agent/guides를 따른다.

## 요구

**[R1]** Claude Code, Codex, OpenCode, Gemini CLI, Hermes, pi, OpenClaw의 감지·버전·인증 확인·MCP·skill·지침·hook 설치와 TUI 실행 계약을 검증한 version별 제품 catalog로 배포한다.
- 이유: 제품 이름 목록만으로 다른 설정·실행 계약을 구현할 수 없다.
- 확인: 일곱 제품 각각의 지원·미지원·미검증 capability와 검증 version을 읽고 미확인 기능이 지원 성공으로 나오지 않는다.
- 의도: coding-agent#I1, coding-agent#I6

**[R2]** 최초 감지는 PATH와 제품 catalog에 정한 유한한 fallback 위치만 읽고 재감지는 사람이 요청할 때만 수행한다.
- 이유: 감지 때문에 디스크 전체를 순회하거나 coding session을 열면 안 된다.
- 확인: PATH 밖 정한 fallback은 발견하고 다른 위치는 순회하지 않으며 화면 재진입·빈 결과·timeout으로 재감지나 설치가 자동 실행되지 않는다.
- 의도: coding-agent#I1, coding-agent#I6

**[R3]** 실행 파일 발견·버전 확인·인증 확인·설치 파일 상태·실제 loading·session 상태는 별도 관측으로 표시하고 관측 실패·timeout·미지원 검사는 부재나 성공으로 바꾸지 않는다.
- 이유: 파일 발견이나 인증 파일 존재가 실제 사용 가능함을 증명하지 않는다.
- 확인: 실행 파일 발견 뒤 버전 timeout, 인증 미확인, loading 실패를 각각 구별하고 session evidence가 없으면 coding-agent/sessions의 unknown이 유지된다.
- 의도: coding-agent#I1, coding-agent#I6

**[R4]** 지금은 이 컴퓨터의 native 환경만 감지·설치·시작하며 관측과 receipt는 처음부터 실행 환경과 profile별로 나눈다.
- 이유: host 결과를 WSL·원격이나 다른 설정 home의 결과로 오인하지 않아야 한다.
- 확인: WSL·원격 요청은 미지원 안내로 끝나고 다른 profile의 실행 파일·설치 결과가 재사용되지 않는다.
- 의도: coding-agent#I1, coding-agent#I6

**[R5]** 기본 harness는 사람이 고르는 nullable 값으로 유지하고 비었을 때 연결 설치가 확인된 실행 가능 후보가 하나면 그 후보를 제안하고 여러 개면 사람이 고르게 한다.
- 이유: 익숙한 도구 선택을 감지가 덮거나 이름 순서로 몰래 착수하지 않게 한다.
- 확인: 저장한 선택이 사라지거나 실행 불가가 되어도 다른 제품으로 자동 교체하지 않고 다시 고르는 행동을 안내하며 후보 없음에서는 연결 안내만 보인다.
- 의도: coding-agent#I1, coding-agent#I6

**[R6]** 설치·갱신·제거는 사람이 고른 harness·native 환경·profile·사용자 또는 앱 범위의 정확한 대상에만 적용한다.
- 이유: 감지된 모든 제품에 도구를 배포하는 것은 사람 선택을 넘는다.
- 확인: 제품 둘이 감지되어도 선택한 하나만 바뀌고 coding credential은 임의 경로 설치와 다른 profile 설정 읽기·쓰기를 요청할 수 없다.
- 의도: coding-agent#I1, coding-agent#I2, coding-agent#I6

**[R7]** 갱신·제거는 receipt의 소유 resource와 마지막으로 쓴 hash가 현재 값과 일치할 때만 수행하고 사람 수정·동명 비관리 resource·외부 symlink·깨진 설정은 보존하며 충돌을 반환한다.
- 이유: 연결 설치가 사람이 쓰던 도구와 지침을 파괴하면 안 된다.
- 확인: receipt가 있어도 사람 수정은 덮거나 지우지 않고 읽기 뒤 동시 변경도 무변경·충돌이며 정상 관리 resource만 갱신·제거된다.
- 의도: coding-agent#I1, coding-agent#I6

**[R8]** 설정 merge는 lophn 소유 항목만 바꾸고 기존 server·환경·permission·trust·hook·지침을 보존하며 Codex의 설정 조각 출력과 앱별 TOML 자동 생성 금지를 유지한다.
- 이유: 제품별 설치 계약과 사람 권한을 설치 편의로 우회하지 않는다.
- 확인: 일곱 adapter의 기존 설정 보존을 검사하고 Codex는 안내와 조각만 반환하며 신뢰 확대·동명 key 교체가 없다.
- 의도: coding-agent#I2, coding-agent#I6

**[R9]** 설치 결과는 resource별 변경·무변경·건너뜀·충돌·실패와 receipt 보관 결과를 반환하며 일부 실패를 전체 성공이나 multi-file 원자적 성공으로 표시하지 않는다.
- 이유: 다음 갱신·제거에 필요한 ownership 증거를 잃은 설치는 정상 설치와 다르다.
- 확인: 둘째 파일 쓰기나 receipt 저장 실패에서도 이미 쓴 파일과 보존한 파일이 구별되고 recovery가 hash를 다시 확인하며 무조건 재설치하지 않는다.
- 의도: coding-agent#I1, coding-agent#I6

**[R10]** 설치 검사는 MCP 초기화·tool 발견·skill 이름과 설명 발견·앱 안내 loading을 각각 성공·실패·확인 못함으로 표시한다.
- 이유: 설치 bytes와 실제 session loading은 다른 사실이다.
- 확인: trust 거절·override·동명 skill·별도 workspace가 각 stage의 안전한 이유로 남고 CLI fallback 성공으로 MCP loading 성공을 만들지 않는다.
- 의도: coding-agent#I1, coding-agent#I6

**[R11]** 시작 summary 전달 hook과 session 상태 수집 hook은 목적·설치·관측을 분리하고 검증되지 않은 version-sensitive event는 자동 설치하지 않는다.
- 이유: 요약 조회가 작업 상태 증거나 permission 허락으로 바뀌어서는 안 된다.
- 확인: Claude Code 시작 summary의 기존 예산은 유지되고 다른 제품의 상태 수집은 catalog에 검증한 capability만 쓰며 미확인 version은 검증한 보수적 subset이나 조각 안내로 끝난다.
- 의도: coding-agent#I1, coding-agent#I6

**[R12]** 감지·관측·receipt·실행 계획에는 token·인증 원문·사용자 설정 원문·전체 transcript를 보관하거나 반환하지 않는다.
- 이유: 설치와 진단은 credential 공개 통로가 아니다.
- 확인: 인증 probe와 설치 실패 진단에도 안전한 상태·참조만 있고 credential 원문은 coding-agent/connection의 keychain 경계에 남는다.
- 의도: coding-agent#I2

## 열린 질문

- redesign/coding-agent#Q1
- redesign/coding-agent#Q2
- redesign/coding-agent#Q3
- redesign/coding-agent#Q4
- redesign/coding-agent#Q5
- redesign/coding-agent#Q6
- redesign/coding-agent#Q7
- redesign/coding-agent#Q8
- redesign/coding-agent#Q16
- redesign/coding-agent#Q17
- redesign/coding-agent#Q19

## 버린 것

- 감지된 모든 harness 설치, bundle 우선 덮어쓰기, 이름만 보고 recursive 제거는 사람 선택과 receipt/hash 계약에 맞지 않아 제공하지 않는다.
