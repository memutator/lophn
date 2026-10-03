---
type: requirements
concerns: [apps/releases]
---
# apps/releases

고정 git commit에서 불변 실행 bundle을 준비하고 같은 hash의 app test와 ticket claim 출처를 확인한 뒤 사람 approval로 activation하거나 이전 release를 다시 선택한다; 테스트 실행은 problems/tests, 앱 DB 변경과 backup은 apps/data가 맡는다.

## 요구

### 불변 bundle과 준비

**[R1]** release는 고정 git commit의 코드·화면·blueprint·정확한 SDK·permission 요청·데이터 변경 계약을 불변 bundle로 고정하고 실제 test result의 참조·준비 주체와 시각은 release의 불변 근거로 연결하며 테스트 뒤 bundle byte를 바꾸지 않는다.
- 이유: 운영 내용을 개발 변경과 분리하고 출처를 되짚는다.
- 확인: source와 SDK 최신판을 고친 뒤에도 기존 bundle hash와 선언이 그대로다.
- 의도: apps#I2

**[R2]** release 준비는 연결된 실제 source 경계에서 정확한 commit의 파일만 읽고 symlink 자체·uncommitted 변경·git 관리 정보·개발 credential·agent 도구·임시 설정을 bundle에 넣지 않는다.
- 이유: 개발 환경과 운영 코드의 경계를 지킨다.
- 확인: source 밖 경로와 commit에 없는 변경을 제출하면 거절하고 개발 credential과 symlink 자체가 bundle에 없다.
- 의도: apps#I2, apps#I4

**[R3]** release 준비는 core 밖에서 copy·hash·blueprint 검증·화면 build를 마치며 준비 도중 원본 변경을 감지하고 취소와 바이트·파일 수·시간 상한을 적용한다.
- 이유: 무거운 준비가 lophn 응답을 막거나 서로 다른 source 판을 섞지 않는다.
- 확인: 준비 중 source를 바꾸면 확정되지 않고 취소 또는 상한 초과 때 작업이 끝난다.
- 의도: platform#I3, apps#I3

**[R4]** 화면 build와 external source map은 준비한 bundle에 포함하고 운영 프로세스는 build나 의존 다운로드 없이 그 결과만 사용한다.
- 이유: 동일 release의 화면과 오류 위치를 재현한다.
- 확인: 설치 뒤 네트워크 없이 화면이 열리고 bundle 위치를 당시 앱 source 위치로 연결하며 SDK frame은 패키지와 version으로 구별한다.
- 의도: apps#I2, platform#I6

### test와 출처

**[R5]** release를 준비하려면 problems/tests의 test runner가 동일 bundle hash를 실제로 실행해 통과한 app test result가 있어야 한다.
- 이유: problems/tests에 따라 다른 코드의 성공이나 coding agent의 주장을 재사용하지 않는다.
- 확인: release 없이 bundle을 테스트한 뒤 같은 hash만 준비되고 한 byte를 바꾸거나 결과를 자가 제출하면 거절된다.
- 의도: apps#I3

**[R6]** ticket 근거 release 준비는 coding-agent/tickets의 현재 connection·claim seq·기한을 요청 때와 긴 준비의 확정 때 다시 확인하고 ticket과 당시 claim을 출처로 보존한다.
- 이유: apps/releases에 따라 낡은 claim으로 release를 내지 않는다.
- 확인: 준비 중 claim이 만료되거나 담당자가 바뀌면 거절되고 claim 해제·ticket 취소·후속 release 뒤에도 과거 출처가 남는다.
- 의도: coding-agent#I4

**[R7]** 직접 수리의 release에는 필수 ticket이나 claim을 만들지 않으며 문제·수리 근거의 유효성은 problems/repairs와 problems/tests를 따른다.
- 이유: problems/repairs의 ticket 없는 수리를 허용하면서 근거가 다른 앱에 묶이지 않게 한다.
- 확인: ticket 없이 동일 bundle의 app test로 준비할 수 있고 수리 근거가 다른 앱이면 거절된다.
- 의도: apps#I3

### activation 결정

**[R8]** 모든 release activation은 정확한 대상 release에 대한 사람 approval을 요구하고 ticket 완료나 기획·설계 채택을 그 결정 대신 쓰지 않는다.
- 이유: H2의 현재 추천과 유지 결정 3에 따라 운영 변경은 별도 동의다.
- 확인: coding agent가 준비한 release도 approval 없이는 활성화되지 않고 재시도에는 새 결정을 받는다.
- 의도: apps#I3

**[R9]** activation 전에 이전 release와 비교한 화면·command의 입력·효과·확인 여부·automation·추가와 축소 permission·데이터 변경·손실 가능성을 사람이 확인할 수 있다.
- 이유: 바뀔 동작과 잃을 데이터를 확인한 뒤 결정한다.
- 확인: 새 필수 입력·external 효과·permission 추가·파괴 migration이 각각 비교 내용에 보인다; 데이터 설명은 apps/data, 화면은 shell/confirmation-window를 따른다.
- 의도: apps#I3

**[R10]** 단순 관계 구조나 같은 입력 schema만으로 호환·동작 동일성을 주장하지 않고 오류·효과·재시도·업무 의미 변화는 검토 필요로 구별한다.
- 이유: 정적 비교가 증명하지 못한 의미를 자동 통과시키지 않는다.
- 확인: schema는 같고 효과만 바꾼 release를 호환이라고 자동 표시하지 않으며 설명만 바뀐 경우를 동작 변경과 구별한다.
- 의도: apps#I3

**[R11]** 데이터 키·제약 변경과 permission·개인정보·approval 정책 변경은 각각 apps/data와 apps/permissions의 검증 및 재동의로 판단한다.
- 이유: 서로 다른 안전 조건을 schema 비교 하나로 덮지 않는다.
- 확인: 데이터 계약 변경과 새 접근 요청의 근거를 각각 조회한다.
- 의도: apps#I3, apps#I4

### activation 경계

**[R12]** activation 시작과 확정 때 현재 release·bundle·grant·사람 결정·실제 데이터 schema의 비교 기준이 그대로인지 다시 확인한다.
- 이유: 검토 뒤 대상이나 권한이 달라진 결정을 적용하지 않는다.
- 확인: approval 뒤 grant나 채택 release를 바꾸면 낡은 activation이 거절된다.
- 의도: apps#I3

**[R13]** 앱 하나에는 activation을 하나만 진행하고 그동안 grant 변경과 다른 activation을 거절하며 구·신 프로세스가 같은 업무 DB를 동시에 쓰지 못하게 한다.
- 이유: 운영 데이터의 단일 소유권을 지킨다.
- 확인: activation 두 개와 권한 변경을 동시에 요청해 하나만 진행되고 apps/runtime의 이전 프로세스 종료 뒤 새 프로세스를 시작한다.
- 의도: apps#I3

**[R14]** 필요한 apps/data 변경과 apps/runtime의 실제 시작 준비 확인을 마친 뒤에만 새 release를 채택하고 이전 release 대체·앱 이름과 설명 변경을 함께 확정한다.
- 이유: 시작 준비 실패한 판이 현재 판이 되지 않게 한다.
- 확인: handler·hash·schema·직접 연결이 일치하지 않으면 현재 release가 바뀌지 않고 성공 확정 뒤에만 업무 호출이 열린다.
- 의도: apps#I3

### 실패와 이전 release

**[R15]** activation 실패는 실패 근거와 이전 활성 참조를 남기고 새 업무 쓰기 전의 복구만 apps/data를 통해 수행한다.
- 이유: 실패 복구가 새 데이터를 지우는 rollback이 되어서는 안 된다.
- 확인: migration 또는 준비 실패 뒤 이전 참조가 유지되고 activation 뒤 만든 업무 데이터는 옛 backup으로 자동 덮이지 않는다.
- 의도: apps#I3, apps#I6

**[R16]** 사람이 이전 release를 선택해도 새 activation으로 처리하며 현재 데이터 schema와 같은 release만 바로 허용한다.
- 이유: 코드 rollback과 데이터 restore를 구별한다.
- 확인: 다른 schema의 옛 release는 바로 활성화되지 않고 별도 restore는 apps/data를 따른다.
- 의도: apps#I6

**[R17]** 과거 invocation과 test result는 현재 blueprint로 덮어 읽지 않고 당시 불변 release로 해석한다.
- 이유: 과거 실행의 계약이 현재 설명으로 바뀌지 않는다.
- 확인: command를 삭제한 새 release 뒤에도 이전 invocation의 당시 command 설명을 읽는다.
- 의도: apps#I5

**[R18]** 열린 problem의 code 삭제나 선언 완화는 경고로 남기되 삭제 자체를 고쳤다는 근거나 problem 닫힘으로 처리하지 않는다.
- 이유: 검사 제거로 문제를 없앴다고 주장하지 않는다.
- 확인: 선언이 삭제된 release를 준비해 경고를 읽고 닫힘 여부는 problems/closing에서 별도로 확인한다.
- 의도: problems#I5

**[R19]** release 준비의 기본 상한은 입력 source 64MiB·완성 bundle 256MiB·파일 10000개·전체 300000ms이며 상한 초과나 취소·worker 종료 때 부분 bundle을 release로 확정하지 않는다.
- 이유: R3의 유한 준비 계약을 검사 가능한 기본값으로 만들고 core 응답을 보호한다.
- 확인: 각 상한을 따로 넘기는 입력과 준비 중 취소·worker 종료에서 release가 생성되지 않고 실패 이유가 남는다.
- 의도: apps#I3, platform#I3

## 열린 질문

- apps/releases#Q1 machine 생성물 변경 거절과 설계 변경 경고를 어디서 어떤 대상으로 검사할까?
- apps/releases#Q2 H2: coding agent의 모든 activation도 매번 사람이 승인할까?
- apps/releases#Q3 현재 데이터와 다른 schema의 이전 release를 어디까지 허용할까?
- apps/releases#Q4 앱 health의 정상 신호·주기 metric·비교 조건과 상태 점검 선언을 지원할까?
- apps/releases#Q5 R19의 유한 준비 기본값을 설치·OS별 테스트 뒤 조정할 필요가 있을까?

## 버린 것

- breaking provider activation의 consumer 동시 갱신·consumer generation·구 release 호환 서버는 그대로 되살리지 않는다. 앱 사이 command 연결은 apps/connections를 따르며 target 교체 뒤 옛 연결은 다시 준비한다.
