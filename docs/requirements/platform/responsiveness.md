---
type: requirements
concerns: [platform/responsiveness]
---
# platform/responsiveness

무관한 작업이 서로의 끝을 기다리지 않게 하는 처리 경계·유한 입장·공정성과 밖에서 재는 응답 시간 목표를 맡는다; 확인이 필요한 앱 command의 선행 접수 예외는 apps/invocations, 화면 모양은 shell이 맡는다.

## 요구

### 처리 경계

**[R1]** file scan·hash·blob 설치·format 추출·index·SDK 복사·release 준비·model 호출·앱 실행·테스트·압축은 core의 command 흐름 밖에서 준비·수행하고 결정적 처리는 일반 코드로 하며 model 호출은 lophn agent 프로세스에서만 수행한다.
- 이유: 느린 일을 유일한 writer와 Electron main에 섞었던 이전 병목을 반복하지 않는다.
- 확인: 각 작업을 30초 이상 멈춘 동안 무관한 command·read·UI가 응답하고 core transaction이나 main IPC가 그 완료를 기다리지 않는지 확인한다.
- 의도: platform#I3

**[R2]** 일반 앱 화면·read·command 호출은 앱으로 직접 가고 core·invocation 기록·capture·problem 갱신을 기다리지 않으며 apps/invocations의 확인 필요 command 선행 접수만 예외로 둔다.
- 이유: 사용자가 앱을 쓰는 응답과 플랫폼 기록 확정은 다른 완료다.
- 확인: core와 기록·capture를 30초 멈추고 이미 유효한 자격을 가진 앱의 일반 호출이 먼저 반환되는지 확인하되 예외 command는 apps/invocations의 접수 테스트로 확인한다.
- 의도: platform#I3

### 유한 입장과 공정성

**[R3]** 관리 요청의 크기·대기 개수·주체별 점유·대기 기한은 유한하게 제한하고 초과는 명시적으로 거절하며 권한 회수·정지 제어 요청의 입장 여유를 예약한다.
- 이유: 메타데이터만 있어도 무제한 backlog는 전체 관리 기능을 막는다.
- 확인: 한 주체가 상한까지 제출해도 다른 주체와 회수·정지 요청이 접수되고 초과 요청이 끝없이 메모리에 쌓이지 않는지 확인한다.
- 의도: platform#I3

**[R4]** 여러 file root의 scan과 검색·진단 작업은 bounded worker를 공정하게 공유하고 큰 root 하나나 사건마다 생성한 상시 service가 다른 root·작업을 굶기지 못한다.
- 이유: 작은 작업이 큰 폴더나 보고 폭주 뒤에 무기한 밀리지 않아야 한다.
- 확인: 큰 root를 계속 scan하며 작은 root의 변경을 반복 제출해 진행이 이어지고 사건을 대량 보고해도 worker 수가 유한한지 확인한다.
- 의도: platform#I3

**[R5]** Electron main의 IPC·capture·protocol 처리에는 크기 비례 작업과 무제한 대기를 넣지 않고 한 앱의 무한 loop·응답 없음·crash나 파일·검색·진단 중단이 다른 앱·shell의 상호작용을 멈추게 하지 않는다.
- 이유: 프로세스를 나눴다는 사실만으로 자원 격리가 완료되지는 않는다.
- 확인: 한 앱 UI를 무한 loop·crash시키고 작업 worker를 정지한 뒤 다른 앱·shell의 아래 응답 목표를 측정한다.
- 의도: platform#I3

### 응답 목표

**[R6]** 기준 장치에서 무관한 부하가 있을 때 작은 로컬 read와 앱 read command는 p95 200ms·p99 500ms 이하이며 shell 조작의 첫 시각 반응은 p95 100ms·p99 250ms 이하를 목표로 한다.
- 이유: 기다리지 않는다는 약속을 사람이 느끼는 지연과 숫자로 검증해야 한다.
- 확인: localhost client의 전송 직전부터 완전 응답까지와 클릭부터 화면 변화까지 monotonic 시간으로 재고 아래 측정 조건에서 목표와 비교한다.
- 의도: platform#I3

**[R7]** 기준 장치에서 64KiB 이하 사람 문서 저장과 작은 ledger command는 부하 중 p95 500ms·p99 1,000ms 이하에 응답하고 queue 대기를 포함한 권한 회수·정지 요청 접수는 p95 200ms·p99 500ms 이하를 목표로 한다.
- 이유: 자료를 쓰고 폭주를 멈추는 제어 경로가 무거운 작업 뒤에 무기한 밀리면 안 된다.
- 확인: 저장 요청부터 파일 저장 응답 또는 command commit 응답까지 재되 version·index 후속 완료를 따로 기록하고 회수 요청부터 durable 접수까지 대기를 포함해 측정한다.
- 의도: platform#I3

### 측정 방법

**[R8]** 응답 목표는 4 logical CPU·RAM 16GiB·로컬 SSD 기준 장치에서 warm-up 30초 뒤 5분 동안 각 대상별 최소 1,000개 요청을 측정하고 성공·오류·timeout을 모두 보고하여 오류를 빠른 성공으로 계산하지 않는다.
- 이유: 평균만 보거나 실패를 빼면 최악 지연과 실사용 장애가 숨는다.
- 확인: 장치·OS·데이터 규모·concurrency·p50·p95·p99·최대·오류 수를 함께 남기고 모든 요청에 종료 상태가 있어 측정 누락이 없는지 확인한다.
- 의도: platform#I3

**[R9]** 부하 측정은 100,000개 파일·총 10GiB root의 scan·hash·index, 1GiB 묶음 복사·hash·압축, 60초 이상 지연 model 호출, 60초 이상 테스트, 한 앱 정체와 10개 동시 관리 요청을 각각 및 함께 진행하며 같은 자료의 무부하 측정도 수행한다.
- 이유: scan 하나만 끄는 우회로 전체 병목을 숨겨서는 안 된다.
- 확인: 각 부하와 복합 부하가 끝나기 전에 앱·문서 저장·shell 응답이 반복 완료되는지 확인하고 무부하·부하 분포와 queue 대기·처리 시간을 별도로 비교한다.
- 의도: platform#I3

**[R10]** 느린 같은 대상의 동작·실제 디스크 저장·승인 선행 접수·부족한 시스템 자원은 무관한 대기와 구별해 기록하고 응답 목표를 달성하지 못했을 때 작업 완료까지 기다렸다는 결과를 성공으로 처리하지 않는다.
- 이유: 의도된 선행 조건을 없애거나 실패를 속여 수치를 맞추면 안 된다.
- 확인: 각 예외를 따로 재현해 무엇을 기다렸는지와 실패 이유를 보고하고 일반 앱 호출에서 core·후행 기록 대기가 없는지 확인한다.
- 의도: platform#I3

## 열린 질문

- platform/responsiveness#Q1 응답 목표와 기준 장치·복합 부하 수치를 제품 acceptance 기준으로 채택할까?
- platform/responsiveness#Q2 queue 크기·주체별 점유·reserved 제어 여유·worker 수의 기본값을 얼마로 둘까?

## 버린 것

- format 선택·blob 읽기·정규화·section 추출·hash를 저장 transaction 안에서 완료하는 요구는 무거운 준비를 core 밖에서 하는 원칙에 반한다.
- 앱 응답 독립성의 중복 요구는 이 concern의 처리 경계와 측정 가능한 응답 목표로 합쳤다.
