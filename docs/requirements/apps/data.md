---
type: requirements
concerns: [apps/data]
---
# apps/data

앱마다 따로 쓰는 SQLite 업무 DB와 그 DB의 유일한 쓰기 주체, activation 때의 migration과 변경 전 backup, 새 업무를 받기 전 실패 복원을 맡는다. 플랫폼 데이터 backup은 platform/backup-and-migration을 따른다.

## 요구

### 앱 데이터 소유

**[R1]** 업무 DB는 앱마다 SQLite 파일 하나로 분리하고 운영 앱 또는 단독 앱 전용 migration·backup·restore 프로세스만 직접 연다.
- 이유: 데이터 격리와 복구 단위를 명확히 하고 core·supervisor·agent가 앱 DB를 해석하거나 바꾸지 않게 한다.
- 확인: 운영 앱이 사용하는 DB가 앱마다 다르며 core·supervisor·agent는 직접 열지 않고 종료 확인 뒤 단독 데이터 작업 프로세스만 연다.
- 의도: apps#I6

**[R2]** 앱 DB의 업무 transaction은 앱이 소유하며 ledger 기록과 원자적으로 함께 끝난다는 보장이나 특정 ORM·분산 transaction 사용을 강제하지 않는다.
- 이유: 앱 데이터 저장과 플랫폼 관측의 서로 다른 경계를 정직하게 드러낸다.
- 확인: 업무 저장과 ledger 전달 사이 실패를 만들어도 함께 rollback됐다고 표시하지 않고 ORM을 쓰지 않은 앱도 같은 데이터 규칙을 통과한다.
- 의도: apps#I6

**[R3]** 앱 DB는 실제 현재 schema 번호와 마지막 migration의 결과를 보관하고 schema 번호는 0부터 허용하며 DB를 사용하지 않는 앱에는 초기 migration을 요구하지 않는다.
- 이유: 데이터가 없는 앱에 의미 없는 schema 1과 migration을 만들지 않는다.
- 확인: DB 미사용 앱이 schema 0으로 시작할 수 있고 DB 사용 앱의 실제 schema와 마지막 변경 결과를 데이터 작업에서 확인한다.
- 의도: apps#I3

### migration과 backup

**[R4]** migration은 기존 운영 프로세스의 종료와 업무 쓰기 중지를 확인한 뒤 일관된 보호 backup을 확보하고 그 참조를 확정한 후에만 시작한다.
- 이유: 변경 중 새 업무가 섞이거나 backup 없는 변경을 시작하지 않게 한다.
- 확인: 종료 확인과 backup 확정을 각각 지연시키면 migration도 새 업무 쓰기도 시작되지 않는다.
- 의도: apps#I3

**[R5]** migration 전 backup은 SQLite backup API로 WAL까지 포함한 일관된 DB 내용을 만들고 실제 schema와 무결성을 확인한다.
- 이유: DB 본체만 복사하면 아직 WAL에 있는 데이터를 잃을 수 있다.
- 확인: WAL에 새 항목이 있는 DB를 backup하고 복구해도 항목이 남으며 DB 본체만 복사한 파일은 유효한 전체 DB backup으로 받아들이지 않는다.
- 의도: apps#I3

**[R6]** migration은 앱 DB 쓰기만 허용된 격리 프로세스에서 각 단계의 데이터 변경과 schema 번호 갱신을 하나의 transaction으로 확정한다.
- 이유: 반만 바뀐 데이터와 새 schema 번호가 엇갈리지 않게 한다.
- 확인: 단계 중간 실패에서 변경과 schema 번호가 함께 rollback되고 데이터 작업의 외부 접근 제한은 apps/permissions를 따른다.
- 의도: apps#I3, apps#I6

**[R7]** 여러 schema 단계를 건너뛰는 migration은 현재 schema부터 목표까지 연속 경로를 순서대로 적용하고 중간 실패하면 첫 변경 전 backup으로 복원한다.
- 이유: 일부 단계만 적용한 DB를 이전 release에 돌려주지 않는다.
- 확인: 0에서 3으로 가는 변경의 두 번째 단계를 실패시키면 0의 데이터와 schema로 복원된다.
- 의도: apps#I3

**[R8]** migration은 새 파일로만 추가하며 공개한 migration 내용은 고치지 않는다.
- 이유: 같은 release가 서로 다른 데이터 변경을 수행하지 않게 한다.
- 확인: 공개한 변경 내용을 바꾸려 하면 거절되고 새로운 변경은 새 migration과 release에 포함된다.
- 의도: apps#I3

**[R9]** migration 이력에서는 출발·도착 schema와 변경 설명·손실 가능성·backup·실제 적용 결과와 시각을 찾을 수 있으며 호출 기록은 apps/invocations를 따른다.
- 이유: 성공 주장만으로 변경과 복구 가능성을 추측하지 않게 한다.
- 확인: 성공·실패한 변경을 각각 수행한 뒤 어떤 데이터를 바꾸었고 어떤 backup으로 보호했는지 당시 사실을 찾는다.
- 의도: apps#I3

**[R10]** 앱 migration backup은 최근 5개를 기본 보존하되 진행 중 복원에 필요한 backup을 보존 한도 때문에 없애지 않는다.
- 이유: 일상 복구 자료를 유한하게 유지하면서 지금 진행 중인 복구 근거는 보호한다.
- 확인: migration 6회 뒤 최근 5개를 사용할 수 있고 진행 중 시도가 참조하는 backup은 완료 전 삭제되지 않는다.
- 의도: apps#I3

### 실패 복원과 내보내기

**[R11]** 새 업무 통로를 열기 전 activation이 실패하면 변경 전 backup으로 복원하고 실제 무결성과 schema 확인을 마친 뒤에만 이전 release를 다시 시작한다.
- 이유: 복원이 안 됐는데 이전 코드만 띄워 정상이라고 보이지 않는다.
- 확인: migration과 새 시작 준비를 각각 실패시키면 이전 데이터 복원 후 이전 release를 쓰며 복원 실패나 결과 미확인은 사용 불가로 보이고 problems/reporting을 따른다.
- 의도: apps#I3, apps#I6

**[R12]** 새 release가 업무를 받은 뒤에는 이전 backup으로 자동 덮어쓰지 않고 옛 코드 선택만으로 DB나 외부 효과가 복원됐다고 표시하지 않는다.
- 이유: 새로 쌓인 업무 데이터와 이미 발생한 외부 효과를 몰래 지우거나 취소했다고 하지 않는다.
- 확인: activation 뒤 새 항목을 추가하고 옛 release를 선택해도 항목을 자동 삭제하지 않으며 코드 호환 검사는 apps/releases를 따른다.
- 의도: apps#I6

**[R13]** 앱 export는 고정 blueprint·release 이력·불변 실행 bundle과 정확한 SDK 의존 byte 및 앱 DB의 일관된 복사본을 포함하되 secret 원값·credential은 포함하지 않는다.
- 이유: 다른 머신으로 옮길 때 코드 설명과 데이터 출처를 함께 가져간다.
- 확인: export를 열면 blueprint·release 이력·각 고정 bundle과 SDK byte 및 WAL의 확정 내용을 포함해 확인된 DB 복사본을 찾을 수 있고 secret 원값·credential이 없으며 앱 외부 자료의 포함 여부는 명시된다.
- 의도: apps#I3

**[R14]** schema 검사를 통과한 데이터는 업무 규칙까지 정확하다는 증명으로 표시하지 않는다.
- 이유: 데이터 형태와 실제 업무 정합성은 다른 조건이다.
- 확인: 형태는 맞지만 합계가 잘못된 데이터가 schema 통과만으로 업무 정확성 확인을 얻지 않는다.
- 의도: apps#I3

## 열린 질문

## 버린 것

- blueprint의 table·writes 선언 밖 쓰기를 SQLite authorizer나 SDK로 막는 별도 장치: 현재 blueprint는 앱 내부 table과 쓰기 목록을 선언하지 않는다.
- 모든 앱의 schema를 1 이상으로 시작시키는 의무: schema 0과 DB 미사용 앱을 허용하는 R3으로 대체한다.
