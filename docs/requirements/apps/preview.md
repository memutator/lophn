---
type: requirements
concerns: [apps/preview]
---
# apps/preview

activation 없이 고정 실행 묶음의 화면과 동작을 확인하는 preview와 테스트 데이터의 운영 데이터 분리를 맡는다. 프로세스 통로는 apps/runtime, view session은 shell/app-frame을 따른다.

## 요구

### 실행과 데이터 분리

**[R1]** 사람과 coding agent는 activation 없이 완성된 고정 실행 묶음을 별도 preview 프로세스로 열어 화면과 명령을 확인할 수 있다.
- 이유: 운영 판을 바꾸기 전에 실제 묶음의 동작을 본다.
- 확인: 아직 준비된 release가 없는 묶음도 preview로 열리며 현재 활성 release와 운영 호출 통로는 바뀌지 않는다.
- 의도: apps#I3

**[R2]** preview는 읽기 전용 실행 묶음과 fixture를 읽고 별도 disposable SQLite DB·파일 영역에만 쓰며 운영 DB나 backup을 자동 복사하지 않는다.
- 이유: 개발 중 확인이 실제 업무 데이터를 읽거나 덮어쓰지 않게 한다.
- 확인: preview에서 테스트 항목과 파일을 바꿔도 운영 데이터는 그대로이고 preview 종료 뒤 임시 데이터는 폐기할 수 있다.
- 의도: apps#I3

**[R3]** preview 명령은 현재 살아 있는 fixture 프로세스만 호출하고 없으면 사용 불가를 반환하며 운영 앱으로 대신 호출하지 않는다.
- 이유: 확인 대상이 없다는 이유로 실제 데이터를 바꾸지 않는다.
- 확인: preview를 종료하고 명령을 부르면 실패하며 운영 앱의 같은 명령은 호출되지 않는다.
- 의도: apps#I3

**[R4]** preview에는 실제 secret·외부 쓰기·실제 문서 저장·다른 앱 조회·실제 loopback 듣기 권한을 주지 않고 필요한 효과는 테스트 대역으로만 확인한다.
- 이유: 테스트용 데이터 확인이 실제 계정·문서·외부 서비스에 영향을 주지 않는다.
- 확인: secret 사용·전송·문서 저장을 시도하면 대역만 동작하고 실제 secret과 운영 문서 및 바깥 대상은 바뀌지 않으며 격리 강제는 apps/permissions를 따른다.
- 의도: apps#I3

**[R5]** preview에서는 사람 확인이 필요한 실제 명령을 실행하거나 approval을 소비하지 않는다.
- 이유: 운영의 사람 결정을 테스트 동작에 재사용하지 않는다.
- 확인: confirm 명령을 요청해도 실제 handler와 approval 사용이 진행되지 않으며 대역 확인의 성공을 실제 실행 성공으로 표시하지 않는다.
- 의도: apps#I3

### automation과 근거

**[R6]** preview의 automation 시계는 꺼 두고 같은 명령 handler의 수동 호출로만 반복 동작을 확인한다.
- 이유: 화면을 확인하는 동안 자동 회차가 데이터를 바꾸거나 운영 회차로 오인되지 않는다.
- 확인: interval과 시작 계기가 있는 묶음을 preview로 열어도 스스로 돌지 않고 수동 호출에서만 handler가 실행된다.
- 의도: apps#I3

**[R7]** preview 화면은 운영과 분리한 view session을 사용하고 응답·invocation·report·test 근거에서 preview임을 구별할 수 있다.
- 이유: 테스트용 성공을 운영 성공으로 읽지 않게 한다.
- 확인: 운영과 preview를 함께 열어도 session이 섞이지 않고 각 결과에서 mode를 구별하며 기록 방식은 apps/invocations와 problems/tests를 따른다.
- 의도: apps#I3

**[R8]** preview 오류와 보고는 개발 진단으로 보존할 수 있지만 운영 problem을 열거나 다시 열거나 닫는 근거로 쓰지 않는다.
- 이유: 개발 중 실패와 운영 문제가 서로의 상태를 바꾸지 않게 한다.
- 확인: preview에서 운영과 같은 code를 보고하거나 성공해도 운영 문제 상태는 바뀌지 않고 문제 상태 규칙은 problems/reporting 및 problems/closing을 따른다.
- 의도: apps#I3

**[R9]** release가 아직 없는 preview의 근거는 묶음 대상 test result와 개발 진단으로 남기며 존재하지 않는 release나 invocation을 꾸며 만들지 않는다.
- 이유: 고정 release 없이 확인한 사실의 출처를 정직하게 남긴다.
- 확인: 준비 전 preview에서 오류가 나면 묶음 대상 근거는 남지만 가짜 release를 가리키는 invocation은 없다.
- 의도: apps#I3

**[R10]** preview 성공은 운영 grant·activation approval·운영 정상의 증명이 아니며 앱 실행 허용과 운영 데이터를 바꾸지 않는다.
- 이유: 확인용 환경을 실제 사용 허락과 혼동하지 않는다.
- 확인: preview만 통과한 앱은 실제 grant나 activation을 얻지 않고 현재 운영 상태도 유지된다.
- 의도: apps#I3

## 열린 질문

- apps/preview#Q1 이전의 개발 source 직접 실행과 현재의 고정 묶음 실행 중 어느 것을 preview 대상으로 유지할까?

## 버린 것

- preview의 개발 source를 직접 실행하는 방식: 확인한 코드와 test 근거가 같은 고정 묶음을 가리키도록 R1·R2로 바꾼다.
- preview report를 아예 보존하지 않는 규칙: 개발 진단은 허용하되 운영 problem 상태를 바꾸지 않는 R8로 대체한다.
