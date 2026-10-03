---
type: requirements
concerns: [platform/backup-and-migration]
---
# platform/backup-and-migration

lophn의 ledger·참조 blob·설정 backup과 restore, ledger schema migration, 비정상 종료 뒤 재시작 점검을 맡는다; 앱의 업무 DB migration과 backup은 apps/data, 개별 작업의 복구 결정은 그 작업을 소유한 concern이 맡는다.

## 요구

### schema migration

**[R1]** ledger schema migration은 설치된 lophn에 포함하고 기동 때 미적용 변경을 정수 순번대로 적용하며 적용한 순번·내용 hash·완료 시각을 불변 이력으로 남긴다.
- 이유: 같은 schema 이름의 다른 변환을 몰래 적용하지 못하게 한다.
- 확인: 미적용 단계가 순서대로 적용되고 이미 적용한 변환의 내용 hash가 달라지면 정상 서비스를 시작하지 않는지 본다.

**[R2]** migration 전에는 새 command 접수와 준비를 막고 기존 짧은 쓰기를 끝낸 뒤 worker를 정지하여 정상 writer와 migration writer가 동시에 열리지 않게 한다.
- 이유: 변환 중의 다른 쓰기가 복구본과 원본을 어긋나게 해서는 안 된다.
- 확인: 변환 중 새 요청과 worker 쓰기가 시작되지 않고 이미 접수한 짧은 쓰기만 먼저 끝나는지 본다.

**[R3]** migration은 SQLite backup API로 일관된 복구본을 만들고 무결성 검사를 통과한 뒤에만 시작하며 복구본 이름에 변환 전 schema 순번과 생성 시각을 포함한다.
- 이유: 실패하면 변환 전 자료를 정확히 찾아 복원할 수 있어야 한다.
- 확인: backup 생성이나 무결성 검사를 실패시키면 원본이 변환되지 않고 정상 복구본의 이름에서 이전 순번과 시각을 알 수 있는지 본다.

**[R4]** migration의 각 단계는 해당 단계의 변환과 완료 이력을 하나의 즉시 쓰기 transaction으로 확정하고 실패·중단한 단계는 전부 rollback하여 직전 완료 schema를 유지한다.
- 이유: 완료 기록만 남거나 변환만 남는 상태를 막는다.
- 확인: 여러 단계 중 중간을 실패시켜 이전 완료 단계는 유지되고 실패 단계의 자료와 이력은 남지 않으며 다음 기동에서 그 단계부터 재시도하는지 본다.

**[R5]** migration은 기존 entity의 식별·원문·고정 판·actor·관계와 event 순서·내용 및 참조 blob을 보존하고 완료 뒤 foreign key·유일성·불변 보호를 검사한다.
- 이유: 새 schema가 과거 사실의 의미를 바꾸어서는 안 된다.
- 확인: 변환 전후 자료와 참조를 대조하여 바뀌지 않고 필요한 보호를 migration 밖에서 해제할 수 없는지 본다.

**[R6]** 지원보다 높은 schema·내용 hash가 다른 적용 이력·손상 원본을 만나면 정상 읽기와 쓰기를 시작하지 않고 원본을 보존하며 lophn update 또는 검증 backup restore를 안내한다.
- 이유: 알 수 없는 자료를 자동 초기화나 downgrade로 잃지 않게 한다.
- 확인: 각 원본을 열었을 때 서비스가 사용 불가로 표시되고 자동 초기화·다운그레이드·backup 덮어복원이 없으며 schema 판을 점검할 수 있는지 본다.

**[R7]** ledger schema는 앞으로만 migration하며 이전 lophn으로 돌아가야 할 때는 호환되는 검증 backup을 사람이 명시적으로 restore한다.
- 이유: 역변환이 원문이나 관계를 손실시키는 것을 자동으로 시도하지 않는다.
- 확인: 이전 lophn이 높은 schema를 거절하고 복원 전에 잃을 최신 기록 범위가 보이는지 본다.

### backup과 restore

**[R8]** 기본 플랫폼 backup은 ledger의 일관된 snapshot·그 snapshot이 영구 참조하는 모든 blob·ledger에 저장된 사람의 설정 선택을 함께 포함한다.
- 이유: DB만 있어도 본문과 설정을 되살릴 수 없으면 복원 가능한 backup이 아니다.
- 확인: backup 중 새 변경이 있어도 지정한 snapshot 시점의 blob과 설정을 모두 읽을 수 있는지 본다.

**[R9]** backup은 SQLite의 일관된 snapshot 기능을 쓰고 복사·hash·압축·검사를 worker에서 하며 열린 ledger 파일 하나의 단순 복사를 완전한 backup으로 취급하지 않는다.
- 이유: 응답을 막지 않으면서 SQLite의 일관성을 보장한다.
- 확인: 운영 중 backup을 만들고 무관한 읽기와 앱 응답이 유지되며 복원한 ledger가 무결성 검사를 통과하는지 본다.

**[R10]** backup 동안 필요한 blob의 GC와 삭제를 막고 SQLite 무결성·blob 존재·실제 SHA-256 hash를 모두 검사한 묶음만 복원 가능으로 표시한다.
- 이유: 참조가 남아 있어도 실제 내용이 빠지거나 손상될 수 있다.
- 확인: blob 하나를 누락하거나 바이트를 바꾸면 미완성으로 표시되고 restore가 거절되는지 본다.

**[R11]** 플랫폼 backup에는 앱 업무 DB·외부 project와 앱 source 원본·OS keychain·credential 원문을 자동 포함하지 않으며 빠지는 자료와 다시 준비할 항목을 명시한다.
- 이유: data 폴더 복사를 컴퓨터 전체의 완전한 이전으로 오해하지 않게 한다.
- 확인: 묶음에서 제외 자료가 보이고 secret·token 원문이 없으며 앱 DB와 원본은 apps/data와 documents/projects의 별도 절차로 안내되는지 본다.

**[R12]** 기본 자동 backup은 매일 1회 검증된 플랫폼 묶음을 만들고 최근 완료 묶음 7개를 보존하며 실패하거나 미완성인 새 묶음 때문에 마지막 복원 가능 묶음을 지우지 않는다.
- 이유: 이전 수치 약속을 유지하되 ledger만 남긴 불완전한 자동 backup을 고친다.
- 확인: 8회 성공하면 최근 7개가 남고 그 뒤 실패해도 이전 완료 7개가 남는지 본다.

**[R13]** 전체 data 폴더의 물리 복사와 restore는 모든 writer와 worker를 정지한 뒤 수행하며 restore 전에는 현재 자료를 별도로 보존하고 잃을 최신 기록 범위를 사람에게 확인받는다.
- 이유: 복원 자체가 남아 있는 유효 자료를 덮어 잃게 해서는 안 된다.
- 확인: 작업 중 정지 조건을 확인하고 이전 현재 자료와 새 복원본이 각각 남으며 사람이 범위를 확인하기 전에는 교체하지 않는지 본다.

**[R14]** restore 뒤 실행 credential을 재검증하거나 재발급하고 derived store와 처리 위치를 복원 ledger 기준으로 재생성하며 다른 ledger의 같은 순번을 이어 처리하지 않는다.
- 이유: 예전 자격과 처리 위치가 새 원본을 건너뛰거나 권한을 잘못 남길 수 있다.
- 확인: 다른 backup으로 restore한 뒤 기존 credential과 derived 상태가 재점검되고 새 원본의 자료가 다시 조회되는지 본다; 자격은 platform/identity, derived 규칙은 platform/ledger를 따른다.

### 재시작 점검

**[R15]** 재시작은 SQLite 복구와 schema 점검 뒤 정상 읽기를 열고 전체 file scan·index·큰 hash가 끝날 때까지 기다리지 않는다.
- 이유: 큰 자료의 복구 준비가 무관한 앱과 문서 사용을 막지 않아야 한다.
- 확인: 큰 project와 index 재생성을 둔 상태에서 정상 읽기가 먼저 열리는지 보고 지연된 파생 상태는 해당 concern에서 확인할 수 있는지 본다.

**[R16]** 재시작 뒤 미완료 앱 invocation·release activation·agent run·approval 대기는 실제 관측으로 소유 concern에서 점검하며 결과를 확인할 수 없으면 확인 불가와 근거를 남기고 성공이나 미실행으로 채우지 않는다.
- 이유: 응답을 못 받았다는 사실만으로 바깥 효과가 없었다고 추정할 수 없다.
- 확인: 접수 뒤 결과 기록 전에 중단하여 apps/invocations·apps/releases·lophn-agent/harness/waiting-and-recovery·platform/approvals의 복구 결과가 관측과 일치하고 확인 불가가 보이는지 본다.

**[R17]** 프로세스를 재기동했다는 이유만으로 미확인 외부 작업을 자동 반복하지 않으며 같은 요청의 확정 결과를 먼저 확인한다.
- 이유: 재시작 복구가 중복 외부 효과를 만들어서는 안 된다.
- 확인: 외부 접수 직후 프로세스를 중단해 재시작하여 자동 재전송이 없고 원래 접수 결과를 확인하는지 본다; 중복 처리는 platform/ledger를 따른다.

**[R18]** migration 전 복구본은 변환 성공만으로 자동 삭제하지 않고 사람이 필요 범위와 복원 가능 묶음을 확인한 뒤 명시적으로 삭제하며 삭제가 SQLite page·WAL·OS backup의 물리 흔적 제거를 보장한다고 표시하지 않는다.
- 이유: 성공 직후 발견되는 결함의 복구 경로를 남기고 논리 삭제와 물리 삭제를 혼동하지 않는다.
- 확인: 변환 성공 뒤 복구본이 남고 명시 삭제에는 보존 종료 범위와 물리 삭제의 한계가 보이는지 본다.

## 열린 질문

- platform/backup-and-migration#Q1 migration 전 backup을 언제 삭제하고 어떤 삭제 보장을 할까.
- platform/backup-and-migration#Q2 여러 컴퓨터 동기화를 첫 판에 넣을까.
- platform/backup-and-migration#Q3 event를 180일 뒤 압축 archive로 옮길까, 원본 ledger에서 계속 조회할까.
- platform/backup-and-migration#Q4 여러 미적용 migration을 전체 하나로 확정할까, 단계마다 확정할까.
- platform/backup-and-migration#Q5 자동 backup을 ledger만 만들까, 참조 blob까지 포함한 묶음으로 만들까.

## 버린 것

- 과거 앱 ID 폴더에서 slug 폴더로 이동하고 옛 저장 폴더·release 경로·외부 source 경로를 호환하던 절차는 버린다: 처음부터 만드는 제품의 migration 계약이 아니다.
- 옛 schema 1~12와 특정 문제 상태를 이관하던 절차는 버린다: 옛 구현 이력은 새 schema 요구가 아니다.
- 기존 사건 ID와 capture·legacy 결론·adapter를 이관하던 약속은 버린다: 과거 자료 이전은 이번 첫 판 범위가 아니다.
- data 폴더를 복사하면 모든 자료가 완전하게 이전된다는 표현은 버린다: keychain·원본·앱 DB 포함 여부를 구별한다.
- 원본 ledger의 event를 180일 뒤 제거하는 해석은 채택하지 않는다: 감사 원본의 보존과 접근은 platform/ledger를 따른다.
