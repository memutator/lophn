---
type: requirements
concerns: [platform/ledger]
---
# platform/ledger

문서·앱·결정·agent의 플랫폼 사실을 단일 로컬 ledger와 유일한 writer로 확정하고, 짧은 command, 변경 event, 충돌·중복 방지, 독립된 read path와 ledger 밖 derived data의 공통 약속을 맡는다; blob은 platform/blob-store, 자격은 platform/identity, backup과 migration은 platform/backup-and-migration을 따른다.

## 요구

### 원본과 writer

**[R1]** 플랫폼의 현재 상태·결정·세션·assignment·run·호출 기록은 로컬 SQLite ledger 하나에 두고 core의 command 처리 하나만 이를 변경한다.
- 이유: 영역마다 별도 원본과 writer를 만들면 변경과 근거가 서로 다른 시점에 확정된다.
- 확인: 문서·앱·agent의 관계를 저장한 뒤 재시작해 같은 ledger에서 읽고, 다른 프로세스의 직접 쓰기는 허용되지 않으며 인터넷을 끊어도 로컬 기록이 남는지 확인한다.
- 의도: platform#I1, platform#I6

**[R2]** SQLite는 WAL·FULL 동기화·외래 키 검사를 사용하고 잠금 대기는 최대 5,000ms이며 WAL을 사용할 수 없으면 쓰기 시작 전에 기동을 거절한다.
- 이유: 완료 응답의 내구성을 저장 위치에 따라 조용히 약화하지 않는다.
- 확인: 네 설정을 실제 연결에서 확인하고 저장 직후 강제 종료·전원 손실 테스트를 하며 WAL 불가 위치에서는 다른 journal로 전환하지 않는지 확인한다.
- 의도: platform#I1

### 짧은 command와 확정

**[R3]** 도메인 command 하나는 즉시 쓰기 transaction 하나에서 종류·안정된 대상 식별·인증된 주체·연결된 run·시각·원인·변경 내용을 되짚을 event를 먼저 기록하고 상태와 확정 결과를 함께 commit하며 중첩 transaction이나 내부 commit을 허용하지 않는다.
- 이유: 변경만 있거나 감사 기록만 있는 반쪽 성공을 만들지 않는다.
- 확인: event 기록·상태 갱신·결과 기록·commit 직전에 각각 실패를 넣어 전부 또는 아무것도 확정되는지 확인하고 모든 actor의 변경에서 종류·주체·원인·run 출처와 이름 변경 뒤에도 같은 대상을 조회하며 대상 생략은 플랫폼 전체 단일 공통 설정에만 허용되는지 확인한다.
- 의도: platform#I1

**[R4]** command의 transaction은 파일 읽기·쓰기·hash·blob 설치·검색 추출·압축·model 호출·앱·테스트·외부 RPC·callback·구독자 응답을 기다리지 않고 작은 검증된 준비 결과만 확정한다.
- 이유: 유일한 writer의 짧은 점유가 무관한 변경을 막지 않아야 한다.
- 확인: 각 준비 작업과 구독자를 30초 멈추고 무관한 command를 확정하며 transaction 안에 그 대기가 없는지 확인한다.
- 의도: platform#I3

**[R5]** 성공·영구 접수·결정 확정 응답과 event 통지는 commit 뒤에만 내보내며 메모리 queue 입장이나 외부 작업 접수만으로 실행·외부 효과 성공을 표시하지 않는다.
- 이유: 접수와 실제 결과는 다르고 응답 유실도 미실행의 증거가 아니다.
- 확인: commit 실패에는 성공이나 접수를 응답하지 않고 성공 응답 직후 재시작해 확정 결과가 남는지 확인하며, 외부 준비·결과를 늦추면 아직 끝나지 않은 단계가 구별되는지 확인한다.
- 의도: platform#I1, platform#I5

**[R6]** 디스크 부족·입출력 오류·5,000ms 잠금 대기 초과로 commit할 수 없으면 실패를 반환하고 입력을 소비하거나 메모리·JSONL 원본으로 대체하지 않는다.
- 이유: 저장이 실패해도 마지막 확정 상태와 재전달할 입력을 보존한다.
- 확인: 각 실패를 주입해 마지막 commit 상태가 유지되고 동일 입력으로 재시도할 수 있으며 성공 응답이 없는지 확인한다.
- 의도: platform#I1

### 관계와 불변 기록

**[R7]** 소속 관계와 소속 안 유일성은 각각 외래 키와 유일성 제약으로 강제하며 바뀌는 blueprint와 작은 payload는 JSON으로 보관하되 그 안의 관계도 소유 concern의 검증을 통과해야 한다.
- 이유: JSON이나 영역별 기록이 깨진 참조·중복을 허용하는 우회로가 되어서는 안 된다.
- 확인: 없는 부모·다른 소속·중복 관계·잘못된 JSON 참조를 제출해 transaction 전체가 거절되는지 확인하며 문서 판의 번호는 documents/versions, 확정 결정은 platform/approvals와 lophn-agent/questions의 소유 계약으로 확인한다.
- 의도: platform#I1

**[R8]** 대상의 ID는 이름·slug·위치와 독립된 불변 ULID 식별을 사용하고 기록 시각은 UTC ISO 8601 밀리초로 통일하며 변경 순서는 ID나 시각이 아닌 전역 event 순번으로 판단한다.
- 이유: 이름 정리와 시계 후퇴가 이력·변경 순서를 바꾸면 안 된다.
- 확인: 같은 밀리초의 여러 변경과 시계 후퇴를 재현한 뒤 순번으로 순서가 유지되고 rename 뒤에도 같은 ID의 이력이 이어지며 기존 문서·고정 판의 안정 ID 보존은 documents/versions와 platform/backup-and-migration의 이관 계약으로 확인한다.
- 의도: platform#I1

**[R9]** event 순번은 transaction에서 전역 단조 증가하게 발급하고 재시작·삭제 뒤에도 재사용하지 않으며 연속성을 가정하지 않고 API에서는 정밀도 손실 없는 십진 문자열로 전달한다.
- 이유: JavaScript 숫자 정밀도나 롤백의 빈 순번 때문에 변경을 누락하면 안 된다.
- 확인: JavaScript 안전 정수보다 큰 순번과 간격·재시작 사례에서도 정확한 순서와 중복 제거를 확인한다.
- 의도: platform#I1

**[R10]** 확정 기록과 감사 event는 덮어쓰지 않고 정정·보완·revert를 원래 기록에 연결된 새 기록으로 남기며 감사 event와 확정 command 결과는 기간 경과로 삭제하지 않는다.
- 이유: 과거 판단과 재시도 결과가 사라지면 중복 변경이나 잘못된 설명을 막을 수 없다.
- 확인: 정정·revert·180일 경과를 재현해 원래 event와 결과가 그대로 남고 이후 기록만 추가되는지 확인한다.
- 의도: platform#I1

**[R11]** lophn agent의 변경은 인증된 assignment와 run 출처로 이어지고 끝난 run의 늦은 제출은 감사 보완만 허용하며 새 대상 변경은 거절한다.
- 이유: 현재 작업을 끝난 판단이 뒤늦게 바꾸지 않아야 한다.
- 확인: 서로 다른 assignment의 run을 조회해 변경이 섞이지 않는지 확인하고 끝난 run의 변경과 감사 보완을 각각 제출한다.
- 의도: platform#I1, platform#I2

### 충돌과 중복 방지

**[R12]** 변경은 대상의 판·hash·관련 변경 순번과 판단에 사용한 고정 판을 모두 CAS로 비교하여 하나라도 다르면 전체를 충돌로 거절하고 자동 병합·덮어쓰기를 하지 않는다.
- 이유: 늦은 준비 결과나 오래된 판단이 사람의 새 내용을 지우지 않아야 한다.
- 확인: 대상 또는 판단 근거 중 하나만 바꾼 뒤 제출해 아무 변경도 적용되지 않는지 확인한다.
- 의도: platform#I1

**[R13]** 같은 안정된 주체와 idempotency key의 같은 command는 재전달·재시작·token 회전 뒤에도 한 번만 확정하고 현재 자격 확인 뒤 원래 결과를 반환하며 같은 key의 다른 입력은 충돌로 거절한다.
- 이유: 응답 유실의 재시도가 판과 사람 결정을 다시 만들지 않게 한다.
- 확인: commit 직후 응답을 버린 뒤 재전달·재시작·token 회전해 변경이 하나뿐인지 확인하고 입력만 바꾸면 충돌하는지 확인한다.
- 의도: platform#I1, platform#I7

### read path와 event 전달

**[R14]** 저장된 자료와 허용된 agent 읽기는 writer queue와 후행 조회 기록을 기다리지 않는 읽기 전용 SQLite snapshot에서 수행하고 응답 내용과 읽은 변경 기준을 같은 snapshot에서 얻는다.
- 이유: 저장이 밀려도 상황을 확인할 수 있어야 한다.
- 확인: writer와 조회 기록을 30초 지연시켜도 읽기가 먼저 응답하고 동시에 변경하는 관계가 응답 안에서 서로 다른 시점으로 섞이지 않는지 확인한다.
- 의도: platform#I3

**[R15]** event는 순번 오름차순으로 적어도 한 번 전달하며 소비자는 순번으로 중복을 제거하고 실제 반응 처리와 처리 위치를 함께 확정한 뒤 재연결에서 그 위치 이후를 읽는다.
- 이유: 전달 자체는 처리 완료가 아니며 장애 후 중복과 누락을 모두 다뤄야 한다.
- 확인: 처리 전·후에 연결을 끊어 재수신해 반응이 중복되지 않는지 확인하고 필터로 숨긴 event까지 읽어 지난 위치와 실제 처리 위치가 구별되는지 확인하며 shell 재연결·renderer 전달은 shell/desktop을 따른다.
- 의도: platform#I1

**[R16]** 느린 구독자는 유한 buffer를 넘으면 안전하게 연결을 끊고 마지막 처리 위치에서 재연결하게 하며 통지 실패로 확정된 command를 다시 실행하거나 오래된 event를 조용히 건너뛰지 않는다.
- 이유: 구독자의 정체가 writer와 다른 구독자를 붙잡아서는 안 된다.
- 확인: 한 구독자의 읽기를 멈춰 연결이 끊겨도 command와 다른 구독은 계속되며 재연결 뒤 빠진 범위를 받는지 확인한다.
- 의도: platform#I3, platform#I1

### ledger 밖 derived data

**[R17]** 현재 관계형 상태와 감사 event를 원본으로 삼고 목차·검색·집계·화면용 복사본은 ledger 밖 derived store에 두어 수정·삭제·재생성으로 원본·고정 판·ID·사람 주석·확정 합의를 바꾸지 못한다.
- 이유: 빠르게 읽는 복사본이 사람 자료의 주인이 되지 않아야 한다.
- 확인: derived store를 지우고 재구축해 원본·고정 판·ID·참조·사람 결정이 유지되고 derived 쓰기를 원본 수정으로 사용할 수 없는지 확인한다.
- 의도: platform#I1

**[R18]** derived 결과에는 실제 읽은 고정 판 또는 기록 구간과 생성 규칙의 판·반영 위치를 남기고 결과와 위치를 함께 확정하며 완성본으로 교체하기 전에는 일부 성공을 전체 최신으로 표시하지 않는다.
- 이유: 최신 이름만 남기면 어떤 자료로 계산했는지 되짚을 수 없다.
- 확인: 생성 중 장애와 원본 변경을 넣어 이전 완성본 또는 명시된 부분 결과만 조회되고 실제 근거와 반영 지연을 확인할 수 있는지 확인한다.
- 의도: platform#I1, platform#I5

**[R19]** 결정적 목차·검색·집계는 원본으로 재구축할 수 있지만 model 요약과 관계 판단은 같은 출력으로 재생성할 수 있다고 보장하거나 원문·사람 합의로 대체하지 않는다.
- 이유: model 판단과 deterministic 파생 결과의 복구 보장은 다르다.
- 확인: model 요약을 지워 다시 만들더라도 원문을 잃지 않고 두 요약을 동일 근거의 별도 생성 결과로 구별하는지 확인한다.
- 의도: platform#I1

### 공통 경계

**[R20]** 전송 adapter는 domain의 schema와 불변식을 다시 구현하지 않고 같은 command 검증을 사용하며 등록된 동작 밖의 SQL·함수·파일 경로를 요청으로 받지 않는다.
- 이유: MCP·CLI·HTTP에서 같은 입력의 허용 여부가 달라지면 경계가 우회된다.
- 확인: 동일한 유효·무효 입력을 각 adapter로 보내 같은 domain 결과가 나오는지 확인한다.
- 의도: platform#I2, platform#I1

**[R21]** 정상 종료는 새 command 입장을 닫고 이미 입장한 짧은 command를 확정 또는 실패로 마친 뒤 프로세스 종료를 요청하며 SQLite commit과 transaction 밖 파일·외부 효과를 하나의 원자 작업이라고 표시하지 않는다.
- 이유: 확정 전후를 구별해야 끊긴 작업의 실제 상태를 복구할 수 있다.
- 확인: queue에 command가 있을 때 종료해 각 결과가 확정 또는 실패로 남고, 파일 설치 직후 commit 전 종료는 별도 복구 대상임을 확인한다.
- 의도: platform#I1

**[R22]** 도메인 변화에는 event를 남기고 event 없는 기반 쓰기는 확정 결과·구독 처리 위치·동일 transaction의 blob 참조 등록·migration 유지보수 기록으로만 한정한다.
- 이유: 관측이라는 이름으로 도메인 변경의 감사 경로를 우회하지 않는다.
- 확인: 보고·설정·상태 변경의 event 누락을 거절하고 기반 예외만 허용되는지 확인한다.
- 의도: platform#I1

### 저장 기술

**[R23]** ledger는 Deno 내장 SQLite 3.53과 포함된 FTS5를 사용하고 별도 외부 SQLite 의존성을 요구하지 않는다.
- 이유: 같은 설치의 SQLite 기능과 내구성 설정을 재현하고 기존 기술 선택의 구체 약속을 보존한다.
- 확인: 설치된 SQLite의 판과 FTS5 사용 가능 여부를 검사하고 별도 SQLite 패키지 없이 ledger 생성·read·command가 작동하는지 확인하며 검색의 의미와 derived 저장은 documents/outline-and-search를 따른다.
- 의도: platform#I1

## 열린 질문

- platform/ledger#Q1 H6의 SQLite·Deno 기술 선택을 유지할까?
- platform/ledger#Q2 core 영역의 반응을 모두 event로만 연결할까?
- platform/ledger#Q3 SQLite NORMAL과 FULL 동기화 가운데 어느 것을 적용할까?
- platform/ledger#Q4 event 온라인 보관 180일과 영구 append-only가 충돌한다.
- platform/ledger#Q5 command·read·queue·구독·변경 행 수의 유한 한도를 얼마로 둘까?
- platform/ledger#Q6 확정 command 결과를 공간 때문에 정리할 수 있을까?
- platform/ledger#Q7 변화가 어디로 번졌는지 되짚는 영향 관계를 어떤 기록과 소유 concern으로 나타낼까?

## 버린 것

- run 전체를 잠그는 대상별 배타 잠금, 300초 lease와 60초 갱신은 짧은 command CAS와 lophn-agent/harness/run-loop의 겹침 규칙으로 대체한다.
- Home·View·RelationEdge·Proposal·독립 입력 queue 등 옛 원본 목록은 새 소유 concern의 entity와 Message·Assignment 관계로 대체한다.
- 앱 host journal·outbox·파일 작업 DB별 writer와 전역 순서 없는 producer 세대는 단일 ledger·writer·전역 event 순번에 맞지 않아 쓰지 않는다.
- 모든 외부 효과를 범용 outbox에 넣어 자동 지수 재시도하는 요구는 처리 주체 없는 queue와 불명확 효과의 중복을 만들므로 적용하지 않는다.
- Home·Annotation·파생 index·section event와 별도 보강 task queue는 제거한 entity·ledger 밖 derived data에 관한 옛 장치다.
