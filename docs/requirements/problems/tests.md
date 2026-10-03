---
type: requirements
concerns: [problems/tests]
---
# problems/tests

app test·reproduction test·test command를 test runner가 격리해서 실제로 돌리고, 고정된 앱 내용·테스트·입력·환경·종료 근거에 묶인 하나의 불변 test result로 남기는 약속을 맡는다.

## 요구

### 하나의 실제 test result

**[R1]** 실제로 시작한 app test·reproduction test·test command 1회마다 test runner만 하나의 불변 test result를 기록하고 release 준비·ticket 확인·문제 닫힘은 같은 결과를 참조한다.
- 이유: agent의 통과 주장과 여러 결과 정본을 만들지 않는다.
- 확인: 문제 없는 app test와 ticket의 test command도 읽히며 agent·앱·테스트 자식이 직접 결과를 등록하면 거절된다.

**[R2]** 결과에는 실제 테스트한 고정 묶음과 테스트·입력·기대·runner·환경·시작·끝·종료 이유·출력과 제외 범위를 확인할 수 있어야 한다.
- 이유: fixture 파일 존재나 문자열 pass만으로 확인됐다고 할 수 없다.
- 확인: release 준비 전에도 고정 묶음 결과를 읽고 파일만 있거나 실제 시작·종료·업무 관측이 없는 결과는 통과 근거로 채택되지 않는다.

**[R3]** 같은 주체의 같은 요청과 내용은 같은 테스트 접수·결과로 이어지고 내용을 바꾸거나 다시 돌리려면 새 요청으로 남긴다.
- 이유: 응답 유실이 무단 재실행이나 과거 결과 덮어쓰기를 만들지 않는다.
- 확인: 같은 요청을 retry해도 자식이 추가 시작하지 않고 입력 변경은 충돌하며 재실행은 새 불변 결과로 보인다.

**[R4]** 테스트는 통과·실패·판정 불가를 구별하며 timeout·중단·runner 상실·근거 부족과 준비 실패·미실행을 통과로 기록하지 않는다.
- 이유: 없는 검증을 성공으로 채우지 않는다.
- 확인: 실제 시작 뒤 timeout과 중단은 판정 불가로 남고 시작 전 거절에는 test result가 없으며 실패한 기대는 실패로 보인다.

**[R5]** agent의 완료 보고와 테스트 대기·검사 진행·실제 통과·실패·미확인을 같은 결과 옆에서 구별하고 실제 결과의 종료 시각과 근거를 열 수 있게 한다.
- 이유: agent가 끝났다는 말이 정상 확인 배지를 뜻해서는 안 된다.
- 확인: 완료 보고 뒤 테스트 미실행이나 실패 상태에는 정상 확인 표시가 없고 실제 result가 있을 때 그 시각과 실행 증거를 연다.

### app test 검사

**[R6]** app test는 고정 blueprint를 검증하고 플랫폼 소유 필수 검사를 생성한 뒤 최소 권한 Deno 테스트를 실제로 실행하며 coding agent가 필수 검사 자체를 바꾸지 못하게 한다.
- 이유: 생성 검사를 고치거나 검사를 건너뛰어 통과한 release를 만들지 않는다.
- 확인: blueprint/handler 불일치와 필수 검사 삭제·수정을 넣으면 실패하고 앱 내용·화면·의존·테스트 변경은 새 묶음 테스트를 요구한다.

**[R7]** app test는 선언한 problem code별 실제 실패 경로 최소 1개와 SDK 보고·process 예외·view 예외·feedback·redaction·permission 거절·고정 SDK를 검사한다.
- 이유: 안내만으로 제작자의 보고 기능 누락을 막을 수 없다.
- 확인: 각 경로를 하나씩 뺀 fixture는 통과하지 않고 화면 없는 앱의 화면 검사만 이유 있는 적용 대상 아님으로 보인다.

**[R8]** 앱 DB migration은 빈 테스트 DB에 전체 적용한 경우와 이전 release schema에서 새 schema로 적용한 경우를 모두 검사한다.
- 이유: 새 설치만 성공하고 기존 개인 데이터에서 깨지는 변경을 놓치지 않는다.
- 확인: 두 fixture를 각각 돌린 app test에서 apps/data의 migration 계약을 검사하고 한쪽 실패면 통과하지 않는다.

**[R9]** read command의 선언된 입력·출력 계약과 automation의 허용된 데이터 접근은 fixture에서 검사하고 선언하지 않은 접근은 실패해야 한다.
- 이유: 단순 handler 종료로 계약과 격리를 확인했다고 하면 안 된다.
- 확인: 선언 출력 누락과 허용 밖 테스트 DB 쓰기를 넣으면 검사가 실패하며 계약 내용은 apps/blueprint·apps/automations·apps/permissions를 따른다.

### reproduction 판정

**[R10]** reproduction test는 보고된 원래 증상을 이전 release에서 재현한 뒤 고친 release에서 같은 고정 테스트·입력·업무 기대를 확인한다.
- 이유: 처음부터 통과하거나 다른 실패를 일으키는 테스트는 수리 증거가 아니다.
- 확인: 이전 release에서 원래 증상이 확인되고 고친 release에서 기대가 충족될 때만 통과하며 같은 오류 이름만 발생하거나 이전도 통과하면 판정 불가다.

**[R11]** 원래 problem code·보고 경로 삭제와 기대 약화 여부를 test runner가 고정된 이전·이후 근거로 검사하며 약화가 있으면 reproduction 통과로 인정하지 않는다.
- 이유: 실패를 숨기는 변경이 verified 닫힘으로 이어지지 않아야 한다.
- 확인: 보고만 제거하거나 기대를 낮춘 변경은 판정 불가와 약화 이유를 남기고 problems/closing에서 확인됨으로 채택되지 않는다.

**[R12]** 통과한 test result는 실제로 검사한 고정 기준과 입력의 범위만 증명하며 인접 기능·데이터 불변식은 별도 관측으로 구별한다.
- 이유: 한 테스트나 외부 효과 확인을 모든 환경의 완전한 수리로 확장하지 않는다.
- 확인: 결과에서 원래 증상·변경 후 기대·인접 불변식 확인을 각각 읽고 외부 효과 사실은 apps/invocations로 구별한다.

### 격리와 재현

**[R13]** test runner는 운영 DB·backup·keychain·사람 파일·일반 홈·실제 외부 서비스에 접근하지 못하고 고정 source는 읽기만 하며 쓰기는 테스트 폴더·테스트 DB로 제한한다.
- 이유: 테스트가 실제 앱 데이터 writer와 권한을 침범하면 안 된다.
- 확인: 운영 DB와 keychain·홈 접근은 실패하고 fixture DB만 바뀌며 실제 데이터 확인은 별도 승인된 apps/data 절차의 안전한 읽기 자료로 분리된다.

**[R14]** Deno test는 권한 prompt와 전체 권한을 금지하고 읽기·쓰기·환경·network 권한을 테스트 폴더와 고정 대역 범위로만 제한한다.
- 이유: 옛 broad allow flags를 운영 자원 접근 허용으로 되살리지 않는다.
- 확인: 대화형 permission prompt 없이 테스트가 끝나고 전체 권한 및 무제한 읽기·쓰기·환경·network를 요청한 실행은 거절된다.

**[R15]** 외부 효과의 reproduction은 replay·stub·sandbox를 사용하고 실계정에 원래 요청을 재전송하지 않는다.
- 이유: 확인을 위해 송금·메시지 전송 등 효과를 중복시키지 않는다.
- 확인: 외부 효과 fixture에서 실제 서비스 접속이 없고 고정 대역 입력·출력으로 재현을 확인한다.

**[R16]** 테스트 실행 방법은 실행 파일과 인자를 분리하고 유한 timeout을 필수로 정하며 임의 shell 문자열 해석과 작업 폴더 밖 접근을 허용하지 않는다.
- 이유: acceptance check가 무제한 shell과 사용자 파일 권한을 얻지 않게 한다.
- 확인: shell 문법·상위 경로·폴더 밖 symlink를 넣으면 거절되고 timeout 생략 요청도 거절된다.

### 복구와 개발 검증

**[R17]** 시작한 테스트가 끊겨도 실제 실행 근거와 판정 불가를 보존하고 복구를 이유로 몰래 재실행하거나 낡은 문제·ticket 결과를 버리지 않는다.
- 이유: 중단이나 늦은 결과도 실제 사실이며 현재 판정은 별도로 해야 한다.
- 확인: runner를 중단하면 결과가 남고 같은 요청이 다시 시작되지 않으며 문제 변경 뒤 끝난 결과는 보존되지만 현재 확인 채택은 각 concern에서 재검사한다.

**[R18]** 개발 fixture는 수집·집계의 기간·시간대·coverage, 파일 편집·변환의 blob·충돌, 외부 연동의 효과 불확실성을 각각 검증한다.
- 이유: 단순 앱 계약이 세 가지 사용 형태에서 중요한 사실을 잃지 않는지 확인한다.
- 확인: 3종 fixture를 테스트하지만 이를 새 제품 앱 등록 약속으로 취급하지 않는다.

## 열린 질문

- problems/tests#Q1 앱 runtime별 테스트 진입점과 판정 protocol·format을 무엇으로 지원할까.
- problems/tests#Q2 health check fixture 통과를 별도 필수 검사로 유지할까.
- problems/tests#Q3 테스트 timeout 기본·상한과 출력·메모리 한도·작업 폴더 보관 기간을 얼마로 둘까.
- problems/tests#Q4 옛 Deno test의 무제한 allow-read·allow-write·allow-env·allow-net을 유지할까.

## 버린 것

- 모든 앱 60초 health probe·최근20개 신호·연속 실패와 여러 건강 상태는 실제 실행 test result가 아닌 별도 health 모델이라 버린다.
- read model source 및 automation relation의 포괄 강제 검사는 관계 중심 blueprint를 없앴으므로 버린다.
- agent 주장만으로 확인하지 않기와 준비 전 고정 묶음 테스트의 중복 요구는 이 문서의 실제 실행 증거와 apps/releases 계약으로 통합해 별도 요구로 두지 않는다.
