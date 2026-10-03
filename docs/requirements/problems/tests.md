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
- 의도: problems#I3

**[R2]** 결과에는 실제 테스트한 고정 묶음과 테스트·입력·기대·runner·환경·시작·끝·종료 이유·출력과 제외 범위를 확인할 수 있어야 한다.
- 이유: fixture 파일 존재나 문자열 pass만으로 확인됐다고 할 수 없다.
- 확인: release 준비 전에도 고정 묶음 결과를 읽고 파일만 있거나 실제 시작·종료·업무 관측이 없는 결과는 통과 근거로 채택되지 않는다.
- 의도: problems#I3

**[R3]** 같은 주체의 같은 요청과 내용은 같은 테스트 접수·결과로 이어지고 내용을 바꾸거나 다시 돌리려면 새 요청으로 남긴다.
- 이유: 응답 유실이 무단 재실행이나 과거 결과 덮어쓰기를 만들지 않는다.
- 확인: 같은 요청을 retry해도 자식이 추가 시작하지 않고 입력 변경은 충돌하며 재실행은 새 불변 결과로 보인다.
- 의도: problems#I3

**[R4]** 테스트는 통과·실패·판정 불가를 구별하며 timeout·중단·runner 상실·근거 부족과 준비 실패·미실행을 통과로 기록하지 않는다.
- 이유: 없는 검증을 성공으로 채우지 않는다.
- 확인: 실제 시작 뒤 timeout과 중단은 판정 불가로 남고 시작 전 거절에는 test result가 없으며 실패한 기대는 실패로 보인다.
- 의도: problems#I3

**[R5]** agent의 완료 보고와 테스트 대기·검사 진행·실제 통과·실패·미확인을 같은 결과 옆에서 구별하고 실제 결과의 종료 시각과 근거를 열 수 있게 한다.
- 이유: agent가 끝났다는 말이 정상 확인 배지를 뜻해서는 안 된다.
- 확인: 완료 보고 뒤 테스트 미실행이나 실패 상태에는 정상 확인 표시가 없고 실제 result가 있을 때 그 시각과 실행 증거를 연다.
- 의도: problems#I3

### app test 검사

**[R6]** app test는 고정 blueprint를 검증하고 플랫폼 소유 필수 검사를 생성한 뒤 최소 권한 Deno 테스트를 실제로 실행하며 coding agent가 필수 검사 자체를 바꾸지 못하게 한다.
- 이유: 생성 검사를 고치거나 검사를 건너뛰어 통과한 release를 만들지 않는다.
- 확인: blueprint/handler 불일치와 필수 검사 삭제·수정을 넣으면 실패하고 앱 내용·화면·의존·테스트 변경은 새 묶음 테스트를 요구한다.
- 의도: problems#I1, apps#I3

**[R7]** app test는 선언한 problem code별 실제 실패 경로 최소 1개와 SDK 보고·process 예외·view 예외·feedback·redaction·permission 거절·고정 SDK를 검사한다.
- 이유: 안내만으로 제작자의 보고 기능 누락을 막을 수 없다.
- 확인: 각 경로를 하나씩 뺀 fixture는 통과하지 않고 화면 없는 앱의 화면 검사만 이유 있는 적용 대상 아님으로 보인다.
- 의도: problems#I1

**[R8]** 앱 DB migration은 빈 테스트 DB에 전체 적용한 경우와 이전 release schema에서 새 schema로 적용한 경우를 모두 검사한다.
- 이유: 새 설치만 성공하고 기존 개인 데이터에서 깨지는 변경을 놓치지 않는다.
- 확인: 두 fixture를 각각 돌린 app test에서 apps/data의 migration 계약을 검사하고 한쪽 실패면 통과하지 않는다.
- 의도: apps#I3

**[R9]** read command의 apps/blueprint 입력 계약·업무 데이터와 외부 상태를 바꾸지 않는 효과 및 automation의 apps/automations·apps/permissions 실행 가능 범위를 fixture에서 검사한다.
- 이유: 단순 handler 종료로 계약과 격리를 확인했다고 하면 안 되며 아직 선언하지 않는 출력 schema를 새 필수 조건으로 만들지 않는다.
- 확인: 잘못된 입력·read의 업무 쓰기·grant 없는 접근·confirm automation을 넣으면 실패하고 grant된 secret 대역을 쓰는 read·write 가져오기·동기화와 사람이 automation을 켤 때 command·입력·주기를 한 번 승인한 external은 허용된다.
- 의도: apps#I3, apps#I6

### reproduction 판정

**[R10]** reproduction test는 보고된 원래 증상을 이전 release에서 재현한 뒤 고친 release에서 같은 고정 테스트·입력·업무 기대를 확인한다.
- 이유: 처음부터 통과하거나 다른 실패를 일으키는 테스트는 수리 증거가 아니다.
- 확인: 이전 release에서 원래 증상이 확인되고 고친 release에서 기대가 충족될 때만 통과하며 같은 오류 이름만 발생하거나 이전도 통과하면 판정 불가다.
- 의도: problems#I3

**[R11]** 원래 problem code·보고 경로 삭제와 기대 약화 여부를 test runner가 고정된 이전·이후 근거로 검사하며 약화가 있으면 reproduction 통과로 인정하지 않는다.
- 이유: 실패를 숨기는 변경이 verified 닫힘으로 이어지지 않아야 한다.
- 확인: 보고만 제거하거나 기대를 낮춘 변경은 판정 불가와 약화 이유를 남기고 problems/closing에서 확인됨으로 채택되지 않는다.
- 의도: problems#I3

**[R12]** 통과한 test result는 실제로 검사한 고정 기준과 입력의 범위만 증명하며 인접 기능·데이터 불변식은 별도 관측으로 구별한다.
- 이유: 한 테스트나 외부 효과 확인을 모든 환경의 완전한 수리로 확장하지 않는다.
- 확인: 결과에서 원래 증상·변경 후 기대·인접 불변식 확인을 각각 읽고 외부 효과 사실은 apps/invocations로 구별한다.
- 의도: problems#I3

### 격리와 재현

**[R13]** test runner는 운영 DB·backup·keychain·사람 파일·일반 홈·실제 외부 서비스에 접근하지 못하고 고정 source는 읽기만 하며 쓰기는 테스트 폴더·테스트 DB로 제한한다.
- 이유: 테스트가 실제 앱 데이터 writer와 권한을 침범하면 안 된다.
- 확인: 운영 DB와 keychain·홈 접근은 실패하고 fixture DB만 바뀌며 실제 데이터 확인은 별도 승인된 apps/data 절차의 안전한 읽기 자료로 분리된다.
- 의도: problems#I3, platform#I4

**[R14]** Deno test는 권한 prompt와 전체 권한을 금지하고 읽기·쓰기·환경·network 권한을 테스트 폴더와 고정 대역 범위로만 제한한다.
- 이유: 옛 broad allow flags를 운영 자원 접근 허용으로 되살리지 않는다.
- 확인: 대화형 permission prompt 없이 테스트가 끝나고 전체 권한 및 무제한 읽기·쓰기·환경·network를 요청한 실행은 거절된다.
- 의도: problems#I3, platform#I4

**[R15]** 외부 효과의 reproduction은 replay·stub·sandbox를 사용하고 실계정에 원래 요청을 재전송하지 않는다.
- 이유: 확인을 위해 송금·메시지 전송 등 효과를 중복시키지 않는다.
- 확인: 외부 효과 fixture에서 실제 서비스 접속이 없고 고정 대역 입력·출력으로 재현을 확인한다.
- 의도: problems#I3, platform#I4

**[R16]** 테스트 실행 방법은 실행 파일과 인자를 분리하고 유한 timeout을 필수로 정하며 임의 shell 문자열 해석과 작업 폴더 밖 접근을 허용하지 않는다.
- 이유: acceptance check가 무제한 shell과 사용자 파일 권한을 얻지 않게 한다.
- 확인: shell 문법·상위 경로·폴더 밖 symlink를 넣으면 거절되고 timeout 생략 요청도 거절된다.
- 의도: problems#I3, platform#I4

### 복구와 개발 검증

**[R17]** 시작한 테스트가 끊겨도 실제 실행 근거와 판정 불가를 보존하고 복구를 이유로 몰래 재실행하거나 낡은 문제·ticket 결과를 버리지 않는다.
- 이유: 중단이나 늦은 결과도 실제 사실이며 현재 판정은 별도로 해야 한다.
- 확인: runner를 중단하면 결과가 남고 같은 요청이 다시 시작되지 않으며 문제 변경 뒤 끝난 결과는 보존되지만 현재 확인 채택은 각 concern에서 재검사한다.
- 의도: problems#I3

**[R18]** 개발 fixture는 수집·집계의 기간·시간대·coverage, 파일 편집·변환의 blob·충돌, 외부 연동의 효과 불확실성을 각각 검증한다.
- 이유: 단순 앱 계약이 세 가지 사용 형태에서 중요한 사실을 잃지 않는지 확인한다.
- 확인: 3종 fixture를 테스트하지만 이를 새 제품 앱 등록 약속으로 취급하지 않는다.
- 의도: problems#I3

### 첫 지원 범위와 실행 한도

**[R19]** 첫 판은 고정 Deno test 진입점과 플랫폼 harness를 통한 앱 command·화면 fixture만 실행하며 임의 native 실행 파일은 받지 않고 관측은 stdout의 통과 문구와 분리한 private IPC의 JSON으로 side·고정 테스트·검사 항목을 검증하며 frame당 65,536 bytes 및 side당 총 1,048,576 bytes를 넘기거나 관측이 잘못되거나 빠지면 판정 불가로 남긴다.
- 이유: 실행할 수 없는 임의 command와 위조된 결과 형식을 지원한다고 주장하지 않는다.
- 확인: native 실행 파일과 shell 문자열은 시작 전 거절되고 잘못된·누락된·초과한 관측은 pass가 되지 않으며 runner가 실제 lifecycle과 기대 약화 여부를 함께 판정한다.
- 의도: problems#I3

**[R20]** 첫 판의 테스트는 전체 실제 실행 동시 2개·준비 대기 16개·필수 요청 timeout 최대 300,000ms(제안 60,000ms)·side별 안전 출력 1,048,576 bytes·process별 전체 메모리 536,870,912 bytes 및 Deno heap 268,435,456 bytes로 제한하고 전체 process 메모리 경계를 강제할 수 없으면 시작 전 접수를 거절한다.
- 이유: 긴 테스트가 다른 작업을 막거나 heap 한도만으로 운영 자원 격리가 충분하다고 주장하지 않는다.
- 확인: 상한 초과 요청과 안전한 메모리 경계가 없는 환경은 미실행이고 시작 뒤 timeout·메모리 종료는 판정 불가이며 출력 초과는 계속 drain하되 잘림을 남긴다.
- 의도: problems#I3, platform#I4

**[R21]** 확정된 테스트 작업 폴더는 즉시 정리하고 미확정 결과의 redaction 완료 spool은 확정 여부를 확인할 때까지 최대 24시간 유지한 뒤 판정 불가 복구를 확정하고 정리하되 실제 시작 여부를 모르면 test result를 꾸미지 않고 요청 조회에 확인 불가를 남긴다.
- 이유: 복구용 임시 자료가 결과 정본이나 무기한 보관본이 되지 않게 한다.
- 확인: 응답 유실 뒤 같은 결과를 복구해도 재실행이 없고 spool 손실·기한 초과에는 실제 시작한 실행만 판정 불가로 남으며 기존 불변 결과 blob은 작업 폴더 정리와 무관하게 유지된다.
- 의도: problems#I3

## 열린 질문

## 버린 것

- 모든 앱 60초 health probe·최근20개 신호·연속 실패와 여러 건강 상태는 실제 실행 test result가 아닌 별도 health 모델이라 버린다.
- read model source 및 automation relation의 포괄 강제 검사는 관계 중심 blueprint를 없앴으므로 버린다.
- agent 주장만으로 확인하지 않기와 준비 전 고정 묶음 테스트의 중복 요구는 이 문서의 실제 실행 증거와 apps/releases 계약으로 통합해 별도 요구로 두지 않는다.
