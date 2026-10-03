# 열린 질문과 충돌

requirements·domain model·architecture·flow·이전 screen과 intent 연결·일관성 검사에서 모은 것이다. 쓰는 동안에는 멈추지 않고 추천안을 적용했다. 여기서 한꺼번에 정하면 해당 concern 문서를 고친다.

- 모두 755건: 질문 406, 충돌 298, 빠짐 26, 범위 25 (정함 또는 기존 해결 75건 포함)
- 질문: 사람이 정할 것. 충돌: 문서·모델·concern 사이가 어긋난 곳. 빠짐: 필요한 contract·flow가 없는 곳. 범위: intent와 요구의 연결 또는 제품 범위가 불분명한 곳.
- "적용"은 작성 당시 문서에 들어가 있던 쪽의 기록이다. 뒤의 "결정"·"후속 기록"이 옛 추천과 다르면 새 기록을 따른다. 적용함·고침은 기록으로 남기며, 추천 적용을 사람의 결정으로 보지 않는다. "정함"은 아래 사람 결정으로 분명히 풀린 항목이다. 같은 id는 하나로 합치고 서로 다른 내용·kind는 합친 기록에 남긴다.

- 수집 제외: redesign/lophn-agent#Q42는 질문 원문이 "없음."인 placeholder여서 건수에 넣지 않았다.

## 먼저 정할 큰 것

| 번호 | 질문 |
|---|---|
| H1 | automation이 메일 보내기·결제처럼 바깥 상태를 바꾸는 command(external)를 실행하게 할까. 지금 모델은 금지. 정한 것: secret 사용은 앱에 준 grant가 허락이고, 가져오기·동기화는 external이 아니라 automation으로 돈다. |
| H2 | coding agent의 release activation도 매번 사람 승인할까(추천: 예). |
| H3 | App Engineer의 주기 검토를 둘까(지금: 없음, 사람 요청으로만). |
| H4 | reproduction test를 만들 수 없는 repair ticket을 사람의 확인을 acceptance check로 삼아 허용할까. 결정 16으로 ticket 없는 직접 수리는 폐기했다. ticket 접수와 실행 준비 분리·reproduction 없는 조건 허용은 아직 미정이다. |
| H5 | 터미널 대화형 확인을 승인으로 인정할까(추천: 아니오). |
| H6 | 기술 선택(Electron, Deno, SQLite) 유지(추천: 유지). |
| H7 | App Engineer의 ticket 생성을 매번 묻지 않기로 한 결정(lophn-agent/harness/tool-judgment)을 받아들일까. |
| H8 | Operator가 question에 답을 못 받으면 그 사이 주기를 계속 건너뛴다. 이대로 둘까. |
| G1 | 정함: 이 폴더를 git 저장소로 시작한다(change log와 concern별 변경 보기에 필요). |
| G2 | 설계·구현 중 발견한 문제를 `type: problem` 문서로 따로 남길까, 문서 안 열린 질문으로 충분할까 |
| G3 | `docs/flows/jobs.md`(일 목록)를 requirements에 녹이고 지울까, use case 목록으로 남길까 |

## 2026-10-03 정한 것

1. confirmation window는 요청한 창 위의 child modal BrowserWindow다. 앱 view는 숨기지 않고 입력만 막는다.
2. menu·popover·palette·dialog·tooltip과 경계 drag는 앱 view 위의 shell overlay view에 그린다. 앱 view를 숨기지 않는다.
3. 터미널 제어 contract도 없고 "agent는 터미널을 쓰지 못한다"는 단정도 없다. 나중에 Orca식 coordinator 여지를 남긴다.
4. secret은 사람이 그 앱에 준 grant가 허락이다. 호출마다 approval을 받지 않고 caller 종류로 막지 않으며, 값은 앱 코드와 agent에 주지 않고 보낼 때 lophn이 붙인다(apps I7).
5. command effect의 external은 앱 밖 상태 변경이다. 가져오기만 하면 read, 가져와 저장하면 write이고, 바깥 요청은 network grant의 host로만 간다.
6. automation은 external·confirm command를 아직 못 돌린다(H1 남은 부분). 가져오기·동기화는 돌린다.
7. 화면에는 지금 필요한 것만 보이고 복잡한 내용·과정은 숨긴다(P17, shell I8,I9). 화면 말은 영어(i18n, 처음엔 en만)이며 ledger·invocation·assignment 같은 안쪽 개념은 내보내지 않는다. docs/README.md의 말 표는 문서·코드의 말이다.

## 2026-10-04 정한 것

8. harness intent는 I1~I3 세 줄만 남았다(고른 model과 계정, 잃거나 두 번 하지 않음, 비용). prompt injection·secret 약속은 없앴다. secret은 platform I8이 맡는다.
9. lophn agent는 lophn, 앱, agent 관리와 사용의 복잡도를 추상화한다(docs/intent/lophn-agent.md I1~I8). roles intent 노드는 없앴다.
10. preset: agent 구성 하나(역할 종류, prompt, capability, context, MCP, skill, provider·model, 지침). 역할마다 제품 기본 preset이 있고 사람이 고치거나 새로 만든다. 제품이 고정한 금지·상한은 preset으로 못 바꾼다. concern은 lophn-agent/presets(Role entity 대신 Preset). lophn-agent/role-definition은 presets로 옮겼다(moved_to).
11. 역할별 개수: lophn 전역 하나, App Engineer 앱마다 하나, Context Engineer 전역 하나, Operator는 project나 app마다 원하는 만큼. Operator는 문서 context가 아니라 project나 app에 붙고, 읽을 자료(context)는 preset 항목이다.
12. 사용자 지침: coding agent용 AGENTS.md와 다른 lophn 전용 Markdown 파일(LOPHN.md). 전역 ~/.lophn/LOPHN.md, project 폴더의 LOPHN.md, 앱 자리의 LOPHN.md. textarea가 아니라 파일이고 문서 version으로 이력을 얻는다. 화면에서는 [Instructions]로 lophn 편집기에서 연다. 지침으로 권한·approval·제품 안전 규칙을 넓히지 못한다. 사람만 고치고 agent는 question으로 제안한다. concern은 lophn-agent/instructions.
13. 작업 자리(파일 cwd 대신): App Engineer는 맡은 앱, Operator는 붙은 project/app. lophn과 Context Engineer는 세션을 연 곳을 세션의 작업 자리로 잡고 사람이 명시적으로 바꿀 때만 바뀐다. 읽을 지침 층은 작업 자리로 정한다.
14. prompt 층 순서: 1 제품 공통 지시+tool 정의 → 2 역할 지시+preset prompt → 3 사람 지침(전역 → project → app) → [cache 경계] → 4 세션 이력·자료·run 사실 → 5 이번 turn 동적 context(시각, 지금 보는 탭·앱 화면)는 맨 뒤 최신 메시지에 붙인다.
15. 역할의 RoleValues(관점, 기대 결과, 상황 같은 글)는 domain model 값이 아니라 prompt 글이다. 기계가 쓰는 값(tool, 읽기 범위, model)만 preset에 둔다.
16. 모든 coding 일은 ticket이 된다. 사람의 직접 요청이나 피드백도 lophn·App Engineer가 ticket으로 만든다. coding agent의 흐름은 하나다: MCP로 ticket claim → 일 → 보고.
17. coding agent 시작은 "시작(ticket, harness, 방식)" 동작 하나다. 지금 지원: (a) 사람이 자기 터미널에서 직접 시작(지금처럼), (b) ticket의 [Start]를 사람이 누르면 lophn이 그 project의 터미널 탭에서 harness를 TUI로 첫 prompt와 함께 연다. 누르는 것이 사람의 허락이다. 나중: headless와 자동 시작(preset에 미리 준 허락이 있을 때), coordinator. "lophn은 외부 프로세스를 시작하지 않는다" 같은 규칙은 (b)를 허용하도록 고친다.
18. harness 연동: 제품이 배포하는 harness catalog(감지, 버전·인증 확인, MCP·skill·지침·hook 자리와 형식, 실행 계약) + 이 컴퓨터의 감지·관측(실행 파일, 버전, 인증, 설치 파일, 로딩, session을 따로, 모르면 모름) + lophn이 쓴 것의 설치 기록(receipt, hash가 맞을 때만 갱신·제거, 사람이 고친 파일은 덮어쓰지 않고 충돌로). 감지는 PATH와 정해진 fallback만 읽고, 다시 감지는 사람이 누를 때. 설치는 사람이 고른 harness에만. 기본 harness는 사람이 고르는 값(비면 정한 규칙). 처음엔 이 컴퓨터만, WSL·원격 관측 기록은 처음부터 나눠 둔다. session 관측은 derived이고 ledger 표를 새로 두지 않는다. 근거: scratchpad/research/harness-catalog.md.
19. credential: 사람이 harness 연결을 고르면 lophn이 connection을 만들고 MCP·skill을 설치한다. token은 설정 파일에 쓰지 않고 lophn MCP server가 시작할 때 OS keychain에서 꺼낸다. lophn이 터미널 탭에서 시작한 session에는 시작할 때 붙인다. 권한 경계(scope, 회수 즉시 거절, 승인·권한·secret·문제 닫기 불가)는 그대로다. concern: coding-agent/connection(권한), coding-agent/harnesses(catalog·감지·설치 기록), coding-agent/sessions(시작·관측).

## platform (85)

### platform/api

- **platform/api#Q1** [질문] API major 지원 기간과 호환 변경 규칙을 어떻게 고정할까?
  - 선택지: 현재 major만 지원 | 현재와 직전 major 90일 지원 | 사용자 지정 지원 기간
  - 추천: 첫 판은 major 1만 지원하고 같은 major의 선택 필드 추가만 허용하며 upgrade 때 미지원 클라이언트를 명시적으로 거절
  - 적용: R6; 90일 병행 지원은 적용하지 않음
- **platform/api#Q2** [충돌] RPC와 오류 응답의 정확한 wire 식별자를 requirements에 적을까?
  - 선택지: 경로·JSON 필드 그대로 기록 | 동작 규칙은 requirements, 정확한 식별자는 spec
  - 추천: README의 코드 식별자 금지에 따라 의미·구간·HTTP 상태만 요구에 적고 정확한 wire는 platform/api spec에서 고정
  - 적용: R2·R3 의미와 모양 적용

### platform/approvals

- **platform/approvals#Q1** [질문] H5: CLI TTY 확인을 사람의 승인으로 인정할까.
  - 선택지: TTY yes 및 추가 grant 입력 인정 / confirmation window만 인정
  - 추천: confirmation window만 인정; CLI는 화면 열기만
  - 적용: confirmation window만 인정

### platform/backup-and-migration

- **platform/backup-and-migration#Q1** [질문] migration 전 backup의 보존 종료와 삭제 보장은 무엇일까.
  - 선택지: 성공 즉시 삭제 / 명시 삭제까지 보존; 논리 삭제 / 물리 흔적 제거
  - 추천: 명시 삭제까지 보존; 물리 흔적 제거 보장 안 함
  - 적용: R18: 명시 삭제까지 보존
- **platform/backup-and-migration#Q2** [질문] 여러 컴퓨터 동기화를 첫 판에 지원할까.
  - 선택지: 단일 컴퓨터 / 여러 컴퓨터 sync
  - 추천: 단일 컴퓨터; sync는 이후 별도 설계
- **platform/backup-and-migration#Q3** [충돌] event를 180일 뒤 압축 archive로 옮길까.
  - 선택지: 원본 ledger 영구 조회 / online 180일 후 archive
  - 추천: 새 단일 ledger 원본의 영구 조회; 180일 삭제나 이동 없음
  - 적용: platform/ledger 참조; 180일 이동은 미적용
- **platform/backup-and-migration#Q4** [충돌] 미적용 migration 전체를 하나로 확정할까, 단계별로 확정할까.
  - 선택지: ST-17의 전체 단일 transaction / 새 model의 단계별 transaction
  - 추천: 새 domain model의 단계별 원자성
  - 적용: R4: 실패 단계 rollback 및 직전 완료 판 유지
- **platform/backup-and-migration#Q5** [충돌] 매일 자동 backup은 ledger만일까, blob까지 포함한 플랫폼 묶음일까.
  - 선택지: 옛 자동 ledger 복사 / 새 model의 snapshot 참조 blob 포함
  - 추천: 복원 가능한 참조 blob 포함 묶음, 매일 1회 최근 7개
  - 적용: R8·R12: 플랫폼 묶음

### platform/blob-store

- **platform/blob-store#Q1** [질문] 큰 원문·수리 근거·model 호출 본문의 보존 기간과 삭제 뒤 참조 흔적을 어떻게 정할까?
  - 선택지: 참조된 본문 영구 보존 | 종류별 기간 뒤 본문 삭제·부재 흔적 유지
  - 추천: 정책 확정 전에는 참조 blob을 기간만으로 삭제하지 않고 신규 접수를 용량으로 제한
  - 적용: R8·R12
- **platform/blob-store#Q2** [질문] 보안상 전면 삭제를 공유 참조·derived 사본·backup까지 어디까지 보장할까?
  - 선택지: 현재 자료만 차단 | 모든 알려진 참조·derived 사본 철회 | backup 포함 완전 삭제
  - 추천: 첫 판은 자동 전면 삭제를 약속하지 않고 반환 차단과 실제 적용 범위를 명시하며 backup 범위는 platform/backup-and-migration과 합의
  - 적용: R11; 전면 삭제 기능은 없음
- **platform/blob-store#Q3** [충돌] 기동·매일 GC와 현재 모델의 정지 유지보수 GC를 어떻게 함께 지킬까?
  - 선택지: 온라인 삭제 | 주기 점검 후 정지 유지보수 삭제
  - 추천: 주기 점검과 정지 유지보수 삭제 분리
  - 적용: R8·R10
- **platform/blob-store#Q4** [질문] blob 크기·stream·구간 한도와 준비 결과 수명을 얼마로 둘까?
  - 선택지: 단일 유한 기본값 | 내용 종류별 유한 한도
  - 추천: 내용 종류별 유한 한도를 측정해 고정하고 초과 시 명시적 거절·부분 반환
  - 적용: R2·R7; 수치는 미확정

### platform/diagnostics

- **platform/diagnostics#Q1** [질문] security audit을 별도로 제공할까, doctor에 합칠까.
  - 선택지: 별도 security audit / doctor 통합
  - 추천: doctor 상태 점검에 통합
  - 적용: R10: 통합 상태 점검
- **platform/diagnostics#Q2** [충돌] 개발자 진단 화면에 원문 오류를 제공할까.
  - 선택지: 옛 design 원문 상세 / 새 model의 안전 내용만
  - 추천: 새 model에 따라 redaction 안전 내용만
  - 적용: R5: 안전 내용만
- **platform/diagnostics#Q3** [질문] 운영 log 회전 크기·총 보존 한도·crash 기록 기간은 얼마일까.
  - 선택지: 정해진 byte·기간 한도 / 사용자 선택 한도
  - 추천: 플랫폼 실제 크기를 측정한 뒤 byte·기간을 확정; 앱 200줄·500 operation 한도와 섞지 않음
  - 적용: R3: 비동기·크기 제한만, 수치는 없음

### platform/identity

- **platform/identity#Q1** [충돌] 현재 identity의 범위 밖 forbidden과 옛 앱 범위 조회의 not_found 가운데 무엇을 적용할까?
  - 선택지: 모든 범위 밖 403 | 대상 조회는 부재와 동일, 금지 동작은403
  - 추천: 존재 보호를 위해 대상 조회만 안전한 부재 응답을 적용
  - 적용: R10
- **platform/identity#Q2** [충돌] IPv4만인 옛 Host 목록과 현재 IPv4·IPv6 loopback을 어떻게 맞출까?
  - 선택지: 127.0.0.1·localhost만 | 실제 bind의 IPv4·IPv6·localhost 정확 allowlist
  - 추천: 현재 두 loopback 가족을 지원하고 실제 port를 포함한 정확한 목록만 사용
  - 적용: R12
- **platform/identity#Q3** [질문] token 무작위 byte 수·hash 방식·OS별 안전 전달을 무엇으로 정할까?
  - 선택지: OS CSPRNG 32byte·SHA-256 | 다른 검토된 충분한 엔트로피·hash
  - 추천: OS CSPRNG 32byte와 검증된 hash·constant-time 비교 권고; OS 전달은 architecture에서 고정
  - 적용: R5·R6·R13; 엔트로피 수치는 미확정
- **platform/identity#Q4** [충돌] WebSocket token을 subprotocol에 넣는 옛 방식과 token 전송 최소화를 어떻게 맞출까?
  - 선택지: 옛 subprotocol 허용 | 비브라우저 Authorization header만
  - 추천: 정상 클라이언트는 브라우저 밖이므로 HTTP upgrade의 Authorization header만 사용
  - 적용: R6·R11; subprotocol token은 적용하지 않음
- **redesign/propagate#Q2** [질문] OS별 coding credential 보호 process-local 전달은 무엇으로 구현할까?
  - 선택지: 상속 제한 pipe/handle / 신뢰 loader direct keychain
  - 추천: 실제 loader·child generation·connection 결합을 검증; argv·일반 env·PTY 금지
  - 적용: 경계 반영; OS 구현은 미정
  - 근거: platform/identity#R15; coding-agent/sessions#R5; platform/secrets#R12

### platform/install-and-update

- **platform/install-and-update#Q1** [질문] Electron 없는 headless 서버 지원을 첫 판에 제공할까.
  - 선택지: desktop 전용 / 별도 daemon 설치
  - 추천: desktop 설치만 지원; 창 닫아도 플랫폼 유지
  - 적용: R12: desktop 설치만 지원
- **platform/install-and-update#Q2** [질문] Linux·macOS·Windows별 최소 OS version·CPU·설치 형식·데이터 폴더를 무엇으로 정할까.
  - 선택지: Linux x64 Ubuntu 24.04 이상·.deb·~/.lophn 유지 및 macOS·Windows 값을 별도 확정 / OS별 native 경로·패키지로 통일
  - 추천: 세 OS 지원 약속 유지; Linux 기존 값 유지, macOS·Windows 최소 version·CPU·패키지·기본 폴더는 OS별 실제 검증 때 확정
  - 적용: R1: Linux·macOS·Windows 지원; Linux 값만 확정, macOS·Windows 상세값 없음
- **platform/install-and-update#Q3** [질문] H6 기술 stack Electron·Deno/TypeScript·SQLite를 유지할까.
  - 선택지: 유지 / 대체 stack
  - 추천: 유지
  - 적용: R15: 유지
- **platform/install-and-update#Q4** [질문] lophn 자체 update는 어떻게 제공할까.
  - 선택지: 수동 .deb 재설치 / 자동 update
  - 추천: 첫 판 수동 OS별 설치 패키지 교체; Linux .deb 재설치; 무단 download·install·restart 없음
  - 적용: R13·R14: 수동 패키지 교체

### platform/ledger

- **platform/ledger#Q1** [질문] H6의 SQLite·Deno 기술 선택을 유지할까?
  - 선택지: SQLite·Deno 유지 | 다른 embedded 저장소·runtime
  - 추천: SQLite·Deno 유지; Deno 내장 SQLite 3.53·FTS5와 외부 SQLite 의존성 없음 적용
  - 적용: R1·R2·R23 SQLite·Deno 내장 SQLite 3.53·FTS5
- **platform/ledger#Q2** [질문] core 영역의 반응을 모두 event로만 연결할까?
  - 선택지: 모든 연결 event | 같은 transaction의 불변식·조회 직접 호출과 durable 반응 분리
  - 추천: 불변식 검사는 직접 하고 비동기 반응만 event·처리 위치로 연결하며 불필요한 내부 queue는 추가하지 않음
  - 적용: R3·R15; 일률적인 직접 호출 금지는 적용하지 않음
- **platform/ledger#Q3** [충돌] SQLite NORMAL과 FULL 동기화 가운데 어느 것을 적용할까?
  - 선택지: legacy storage의 NORMAL | agent storage와 현재 domain model의 FULL
  - 추천: 현재 모델의 FULL
  - 적용: R2 FULL
- **platform/ledger#Q4** [충돌] event 온라인 보관 180일과 영구 append-only가 충돌한다.
  - 선택지: 180일 뒤 이동·삭제 | 영구 ledger 기록
  - 추천: 현재 모델의 event와 확정 결과 영구 보존; 용량 부족은 신규 변경 제한
  - 적용: R10 영구 보존
- **platform/ledger#Q5** [질문] command·read·queue·구독·변경 행 수의 유한 한도를 얼마로 둘까?
  - 선택지: 고정 기본값 | 장치별 조정 가능한 유한 기본값
  - 추천: 무제한 금지와 제어 요청 여유를 먼저 적용하고 responsiveness의 검증 부하로 기본값을 결정
  - 적용: R16; 한도 수치는 미확정
- **platform/ledger#Q6** [질문] 확정 command 결과를 공간 때문에 정리할 수 있을까?
  - 선택지: 영구 보존 | 원래 key를 새 효과로 받지 않는 별도 영구 흔적
  - 추천: 첫 판은 영구 보존하고 저장 부족 때 신규 변경을 제한
  - 적용: R10
- **platform/ledger#Q7** [질문] 변화가 어디로 번졌는지 되짚는 영향 관계를 어떤 기록과 소유 concern으로 나타낼까?
  - 선택지: 명시적 원인·대상·run으로 실제 후속 변경 추적 | 별도 공통 영향 관계 모델
  - 추천: R3의 원인·대상·run으로 실제 확정 변경을 추적하고 예상 영향은 실제 전파와 구별; 별도 관계가 필요하면 소유 concern부터 확정
  - 적용: R3·R11 확정된 변경의 근거 연결; 공통 영향 관계 모델은 미확정

### platform/notifications

- **platform/notifications#Q1** [질문] 닫힌 세션 뒤 관련 notification을 어떻게 골라 묶어 보여 줄까.
  - 선택지: 발생 순서대로 모두 이어 읽기 / 관련성 기준 묶음
  - 추천: 개별 근거를 유지하고 발생 순서대로 모두 이어 읽기
  - 적용: R11: 모두 이어 읽기; 임의 고정 개수 없음
- **platform/notifications#Q2** [질문] OS 전달 retry 간격과 실패 표시 시점을 어떻게 정할까.
  - 선택지: 고정 간격 / backoff / 다음 화면 조회
  - 추천: 자동 retry 없이 다음 화면 조회에서 즉시 안전한 실패 이유 표시
  - 적용: R10: 다음 화면 조회; 배달 상태 ledger 없음
- **platform/notifications#Q3** [질문] OS notification 기본 제공을 어떻게 정할까.
  - 선택지: 기본 켬 / opt-in / 창 안만
  - 추천: opt-in; 최소 제목과 대상 열기만
  - 적용: R9: opt-in

### platform/redaction

- **platform/redaction#Q1** [질문] 첫 gitleaks commit과 credential prefix 목록을 무엇으로 고정할까?
  - 선택지: 구현 시점의 한 commit | 검토한 별도 규칙 묶음
  - 추천: 구현 시점에 한 commit과 OpenAI·Anthropic·GitHub·AWS·Slack·JWT·PEM 공통 표본을 고정하고 인증 형태 추가는 같은 정본에 반영
  - 적용: R2; 정확한 commit은 미확정
- **platform/redaction#Q2** [질문] 알려진 secret의 URL encoding·Base64도 자동 검출할까?
  - 선택지: exact value와 고정 패턴만 | 확인된 encoding 추가
  - 추천: 첫 판은 exact value·패턴·명시 비공개 제외를 적용하고 encoding 지원은 누출·오탐 테스트 뒤 추가하며 완전 탐지는 약속하지 않음
  - 적용: R1·R2·R8·R14
- **platform/redaction#Q3** [질문] 수집한 비밀을 패턴 redaction만으로 충분히 막을 수 있을까?
  - 선택지: 패턴만 | 알려진 값·공개 allowlist·미지 값 제외 병행
  - 추천: 패턴만을 안전 근거로 삼지 않고 수집 최소화·알려진 값·명시 정책을 함께 적용
  - 적용: R1·R2·R8
- **platform/redaction#Q4** [충돌] secret 대체 표시는 옛 별표 셋·redacted 표식과 현재 모델의 별표 하나 중 무엇인가?
  - 선택지: 별표 셋 또는 redacted | 별표 하나
  - 추천: 현재 모델의 별표 하나; 화면의 시각 표시는 shell/wording
  - 적용: R6
- **platform/redaction#Q5** [질문] 텍스트·JSON·이미지 크기와 redaction 처리 기한을 얼마로 둘까?
  - 선택지: 매체별 유한 한도 | 동일 유한 한도
  - 추천: 매체별 측정 한도를 정하고 초과·불확실은 원문 제외
  - 적용: R14; 표본·화면 문자열 외 수치는 미확정

### platform/responsiveness

- **platform/responsiveness#Q1** [질문] 응답 목표와 기준 장치·복합 부하 수치를 제품 acceptance 기준으로 채택할까?
  - 선택지: 제안한 p95·p99 채택 | 실제 장치 측정 뒤 조정
  - 추천: 먼저 제안 수치로 구현·측정하고 사용자의 실제 장치 결과로 조정하되 목표와 측정 방법은 제거하지 않음
  - 적용: R6~R10 추천 수치
- **platform/responsiveness#Q2** [질문] queue 크기·주체별 점유·reserved 제어 여유·worker 수의 기본값을 얼마로 둘까?
  - 선택지: 고정 유한값 | 장치별 유한값
  - 추천: 기준 부하에서 R6·R7을 달성하는 유한값을 측정해 고정하며 예약 제어 여유는 반드시 둠
  - 적용: R3·R4; 정확한 개수는 미확정

### platform/secrets

- **platform/secrets#Q1** [질문] Linux Secret Service 없는 desktop·headless에서 어떤 대체 보호 저장소를 지원할까?
  - 선택지: fail closed | 별도 OS 보호 adapter | 파일 볼트 재도입
  - 추천: 현재 모델대로 fail closed; OS adapter는 지원 OS가 확정될 때 정하고 파일 볼트는 재도입하지 않음
  - 적용: R8
- **platform/secrets#Q2** [질문] 암호 보호 secret export의 형식·암호 파생 강도·지원 OS 사이 호환을 어떻게 고정할까?
  - 선택지: 검증된 인증 암호화 export 형식과 지원 OS 공통 import | OS별 보호 export 형식
  - 추천: 검증된 인증 암호화·강한 password 파생을 사용하는 전용 이전 형식; 사람의 명시적 선택과 OS keychain 전용 import로 제한하고 평문 중간 파일 금지
  - 적용: R9 암호 보호 별도 export·import 제공; 형식·파생 수치·OS 호환표 미확정
- **platform/secrets#Q3** [충돌] agent에 secret의 수정·마지막 사용 시각도 내보낼까?
  - 선택지: 옛 메타데이터 네 항목 | 현재 모델의 이름·설정 여부
  - 추천: 현재 모델의 최소 조회를 적용하고 사용 이력은 원값 없이 별도 정책을 정함
  - 적용: R4 이름·설정 여부만

### platform/security

- **platform/security#Q1** [충돌] 배포용 Ubuntu sandbox를 끈 테스트를 성공으로 인정할까?
  - 선택지: 개발 no-sandbox 테스트 인정 | 실제 OS sandbox 테스트 필수
  - 추천: 현재 안전 원칙에 따라 배포에서는 실제 sandbox를 검사하고 개발 우회는 제한만 기록
  - 적용: R4

### platform/settings

- **platform/settings#Q1** [질문] 설정 교환 format version과 옛 항목 migration을 첫 판부터 제공할까.
  - 선택지: version 1 왕복부터 / 모든 옛 항목 migration
  - 추천: version 1 왕복; 실제 항목 변경 update에 명시 변환
  - 적용: R26: version 1 왕복과 명시 변환
- **platform/settings#Q2** [질문] assignment별 지속 설정 override가 필요할까.
  - 선택지: 세 층 유지 / assignment 층 추가
  - 추천: 실제 서로 다른 수요가 생기기 전에는 세 층만 유지
  - 적용: R5: 세 층만; assignment override 거절
- **platform/settings#Q3** [질문] 일반 설정을 자동 reload할까.
  - 선택지: 명시 apply/reload / 자동 reload
  - 추천: 명시 apply/reload만; 외부 파일 감시 없음
  - 적용: R17·R21: 명시 apply/reload
- **platform/settings#Q4** [충돌] 모르는 항목을 경고하고 무시할까, 오류로 거절할까.
  - 선택지: 옛 storage의 경고 후 무시 / CF-13·새 model의 엄격 거절
  - 추천: 엄격 거절
  - 적용: R12: 전체 적용 거절
- **platform/settings#Q5** [질문] lophn 역할의 설정 설명과 변경 근거를 어디서 읽을까
  - 선택지: 별도 agent 설명 / 공개 설정 registry
  - 추천: 사람 이름·설명·영향·되돌림·적용 시점을 같은 registry로 읽고 question option action 적용
  - 적용: 예; requirements R27~R29·architecture 한 줄 적용
  - 근거: platform#I10; lophn-agent/roles#I7
- **redesign/propagate#Q1** [범위] 공개 설정 key와 machine-local profile 선택의 정확한 저장 schema를 어디서 확정할까?
  - 선택지: 일반 설정 등록 선택만 / path까지 설정 복제
  - 추천: 공통 registry는 enabled·nullable 기본/profile 선택만; local path·관측은 harness owner
  - 적용: 선택/관측 경계 반영; 정확한 key는 미정
  - 근거: platform/settings#R31; coding-agent/harnesses#R4,R5
- **redesign/propagate#Q8** [범위] 옛 일반 설정의 role 층과 Role ID를 새 Preset 구성으로 언제 migrate할까?
  - 선택지: 일반 설정 role 원본 유지 / Preset 판으로 explicit migration
  - 추천: 두 원본 금지; source 기록을 보존한 명시 migration을 실제 구현 schema 변경에서 설계
  - 적용: 문서의 common/Preset 경계와 pst registry 적용; 실행 migration은 아직 없음
  - 근거: platform/settings#R5,R7; domain-model/platform/settings; domain-model/platform/ledger

### platform

- **architecture/platform#Q1** [질문] command·read·구독·worker의 첫 유한 한도를 얼마로 둘까
  - 선택지: 기존 큐 256/64/16 유지하고 read·WS·I/O 추가 제한 | 장치별 자동 조정
  - 추천: 고정 안전 기본값부터 복합 부하 테스트로 검증
  - 적용: 256KiB JSON·깊이16·4096항목·queue256/64/16·read2·WS1MiB buffer·I/O2와 대기 기한을 본문에 적용
  - 근거: platform/ledger#R4,R14,R16; platform/responsiveness#R3,R4,R6~R10; legacy packages/daemon/queue.ts
- **architecture/platform#Q2** [질문] idempotency와 approval binding의 입력 정규화를 무엇으로 고정할까
  - 선택지: RFC8785 canonical JSON | 자체 키 정렬 직렬화
  - 추천: RFC8785·seq 십진 문자열·sha256를 공통 사용
  - 적용: command fingerprint·approval input/binding hash에 적용; key 1~128bytes
  - 근거: platform/ledger CommandEnvelope; platform/approvals ApprovalAction
- **architecture/platform#Q3** [질문] token·WS 인증·OS 시작 전달의 구체 값은 무엇인가
  - 선택지: 32byte base64url·SHA256·상속 pipe·WS Bearer | 기존 user 파일·WS subprotocol
  - 추천: 32byte 불투명 token·constant-time digest 비교·상속 pipe; WS header만
  - 적용: 본문 인증/감독/WS에 적용; 다섯 actor 외 token 종류 없음
  - 근거: platform/identity#R4~R7,R11~R13; domain-model/platform/identity.md
- **architecture/platform#Q4** [질문] macOS·Windows 데이터 위치와 최소 OS/CPU·패키지 검증 matrix를 어떻게 고정할까
  - 선택지: OS별 native data 위치 | 공통 사용자 home .lophn; 최소 OS/CPU 별도 검증
  - 추천: 공통 home .lophn와 OS별 cache 위치; 배포 검증 전 완료 표시 금지
  - 적용: 데이터/cache 경로만 적용; 최소 OS/CPU·서명/공증 matrix는 미확정이며 본문에 임의 수치 없음
  - 근거: platform/install-and-update#R1,R7,R8,Q2
- **architecture/platform#Q5** [질문] 첫 redaction 규칙의 실제 gitleaks commit·credential prefix 목록을 무엇으로 pin할까
  - 선택지: 검증한 upstream commit | 별도 내장 규칙 목록
  - 추천: 입출력 동일 content-hash 규칙 bundle과 공통 key/PEM fixture
  - 적용: bundle 교체·양쪽 동일 판·fixture를 적용; 실제 upstream commit/hash는 구현 시 pin해야 하며 본문에 추정 hash 없음
  - 근거: platform/redaction#R2; domain-model/platform/redaction.md 정할 것
- **architecture/platform#Q6** [질문] secret 이전 보호 export format·KDF·AEAD를 어떻게 고정할까
  - 선택지: Argon2id+AES256GCM | scrypt+AES256GCM
  - 추천: format1·Argon2id 64MiB/3회/p1·salt16B·AES256GCM nonce12B native 보호 adapter
  - 적용: 추천 수치 적용; OS adapter 상호 호환·변조/암호/메모리 경계 테스트 필요
  - 근거: platform/secrets#R9,Q2
- **architecture/platform#Q7** [질문] 내부 secret 전송 부착에서 값을 반환하는 주체·core 실행 경계를 어떻게 지킬까
  - 선택지: core에서 keychain 직접 조회 | core 검증 후 보호 I/O adapter와 전송 callback
  - 추천: core는 scope/목적지/용도만 조정하고 값은 신뢰 adapter callback 메모리에만 전달
  - 적용: provider·외부 MCP·앱 전송부의 process-scoped machine private 연결과 갱신 결과 저장에 적용; agent loop·tool·앱 사용자 코드는 값 없음
  - 근거: platform/secrets#R4~R6; platform/responsiveness#R1; coordinator 내부 contract 지시
- **architecture/platform#Q8** [질문] secret OS 삭제·사용 프로세스 종료 미완료 관측을 재시작 뒤 어디에 보존할까
  - 선택지: keychain opaque 항목 대조+안전 worker 관리 상태 | 새 ledger entity/status 축
  - 추천: 새 entity 없이 keychain 항목과 현재 ledger 참조·감독 실제 종료를 대조
  - 적용: 세 완료 boolean 분리·고아 정리 적용; 재시작 후 확인 못한 완료는 true로 채우지 않음
  - 근거: platform/secrets#R7; domain-model/platform/secrets.md SecretCleanupResult
- **architecture/platform#Q9** [질문] backup manifest 교환 format과 상대 경로를 어떻게 고정할까
  - 선택지: JSON format1 ledger.db·blobs/sha256 tree | 압축 단일 파일
  - 추천: 먼저 검사 가능한 directory bundle와 JSON format1
  - 적용: 본문 흐름에 적용; 매일1회·완료7개는 현재 requirements 우선
  - 근거: platform/backup-and-migration#R8~R14; BackupManifest
- **architecture/platform#Q10** [질문] Deno 내장 SQLite의 native query 중단·Worker 죽음 복구가 지원 OS에서 어떻게 동작하는가
  - 선택지: 등록 indexed query와 유한 행·unhealthy reader | native interrupt 확인 후 활용
  - 추천: JS timeout을 native 중단으로 주장하지 않고 실행기 격리와 bounded query를 검증
  - 적용: reader2·2초 unhealthy·writer 실패 시 새 입장 차단/core 복구를 적용; driver 강제 interrupt 보장 없음
  - 근거: platform/ledger#R14,R23; old-docs/architecture/core.md 2.1
- **architecture/platform#Q11** [질문] 플랫폼 RPC 목록과 다른 최상위의 실제 경로 목록을 누가 정의하는가
  - 선택지: platform이 모든 이름 재정의 | 소유 파일 목록을 공통 registry에 등록
  - 추천: platform 공통 transport·platform 경로만 정의하고 다른 소유 contract를 등록
  - 적용: 본문 5.1에 platform 실제 목록·비공개 작업 호출 구분 적용; 다른 최상위 경로 중복 정의 없음
  - 근거: architecture/README.md 4; platform/api#R1~R3; A9
- **architecture/platform#Q12** [질문] 부모 사망·single instance·blob directory sync를 OS별로 어떤 수준까지 검증할까
  - 선택지: PID 파일 | 실제 OS lock·child handle/group·Windows Job Object
  - 추천: 실제 lock/감독 pipe와 OS child 종료 테스트; 안전 불가 환경 실행 거절
  - 적용: 감독/기동/불변 blob 문단에 적용; PID만으로 다른 process 종료 금지
  - 근거: platform/install-and-update#R9,R10; platform/identity#R7; platform/blob-store#R2,R3
- **check/platform#Q1** [충돌] confirm의 requester·caller를 앱 화면 user로 고정한 model이 실제 agent·앱 caller를 보존하는 R8과 충돌한다.
  - 선택지: 실제 caller 보존 | 모두 user
  - 추천: 결정 user와 실제 요청자를 구별하고 ask·confirm이 겹치면 approval 한 번만 사용
  - 적용: 고침: approvals model의 caller 결속과 architecture 흐름을 실제 요청자 기준으로 맞춤
  - 근거: platform/approvals#R8; apps/invocations#R17; apps/invocations#R18; domain-model/platform/approvals
- **check/platform#Q2** [충돌] 정함: secret 사용 흐름의 앱 approval/접수 검사가 최신 grant 기반 사용 결정과 다르다.
  - 선택지: grant 검사 | 호출마다 secret approval
  - 추천: secret 사용은 현재 grant만 검사하고 command confirm은 apps/invocations가 맡음
  - 적용: 고침: architecture 7.4의 앱 grant 검사와 secrets R10·model 정책을 일치시킴
  - 근거: platform/secrets#R5; apps#I7; apps/permissions; architecture/platform#7.4
  - 결정: 최근 결정 4: secret 사용은 앱 grant가 허락이고 호출마다 approval을 요구하지 않음
- **check/platform#Q3** [충돌] machine provider·외부 MCP 인증 갱신 contract에 대응하는 requirements와 model 용도·소유 경계가 빠졌다.
  - 선택지: 소유 credential 갱신 경계 명시 | agent에 값 반환
  - 추천: 신뢰 adapter 보호 준비·소유 CAS·안전 참조 확정만 허용
  - 적용: 고침: secrets R11 추가; model external_mcp_credential 용도·소유 경계·갱신 정책; architecture 참조 소유권 정리
  - 근거: platform/secrets#R6; platform#I8; lophn-agent/harness/provider; lophn-agent/extensions; architecture/platform#5.7
- **check/platform#Q4** [충돌] settings R27·R28의 사람이 읽는 설명·위험·되돌림·영향 registry가 model에 description만으로 남아 있다.
  - 선택지: 등록 설명 fields 보강 | 화면별 설명
  - 추천: 같은 registry의 message key·영향·적용 시점으로 화면과 역할이 설명
  - 적용: 고침: SettingDefinition 필수 설명 fields와 architecture 사람 경계 registry를 보강
  - 근거: platform/settings#R27; platform/settings#R28; domain-model/platform/settings
- **check/platform#Q5** [충돌] settings R29의 고정 option action 적용이 model에서 machine 적용 경로 없이 사람 apply만으로 남아 있다.
  - 선택지: QuestionActionEvidence 검증 | 자유 답 해석
  - 추천: 실제 선택의 정확한 action을 검증해 기존 ApplySettings 한 번 적용
  - 적용: 고침: settings model command·architecture에서 QuestionActionEvidence 적용을 연결
  - 근거: platform/settings#R29; platform/identity#R14; lophn-agent/questions
- **check/platform#Q6** [충돌] 정함: settings와 approvals의 기본 노출이 최소화 원칙을 구체적으로 받치지 않는다.
  - 선택지: 의미·영향 기본과 안전 상세 분리 | 기술 전체 기본 노출
  - 추천: 필수 위험은 기본에 남기고 기술 key·층·판·CAS는 펼침
  - 적용: 고침: settings R30·approvals R17 추가와 두 model·architecture 사람 경계 반영
  - 근거: platform#I5; platform#I10; shell#I8; shell#I9; platform/approvals#R1; platform/settings#R10
  - 결정: 최근 결정 7: settings·approvals는 필요한 정보와 결정만 기본 노출
- **check/platform#Q7** [충돌] platform I9의 focus 유지가 platform 요구와 model에서 shell 화면 규칙에만 의존한다.
  - 선택지: 자동 표시 focus 유지 | 자동 대상 전환
  - 추천: 명시 Open만 이동; 자동 표시는 현재 작업 유지
  - 적용: 고침: notifications R12 추가와 model·architecture 표시 정책 반영
  - 근거: platform#I9; shell/desktop#R10; platform/notifications
- **check/platform#Q8** [충돌] notifications model의 정할 것에 OS opt-in·실패 표시가 미정으로 남지만 R9·R10은 정했다.
  - 선택지: 현재 requirements 적용 | 다시 미정화
  - 추천: opt-in 최소 정보·다음 조회 안전 실패 이유·retry 업무 상태 없음
  - 적용: 고침: notifications model의 정책·정할 것을 R9·R10·R11에 맞춤
  - 근거: platform/notifications#R9; platform/notifications#R10; platform/notifications#R11
- **check/platform#Q9** [충돌] identity model의 모든 범위 밖 forbidden 정책이 앱 범위 대상의 not_found 요구와 충돌한다.
  - 선택지: 대상 부재 동일 응답 | 모두 forbidden
  - 추천: 앱 범위 밖 대상 조회만 not_found; 일반 금지 동작 forbidden
  - 적용: 고침: identity model 오류 정책을 R10·architecture와 일치시킴
  - 근거: platform/identity#R10; domain-model/platform/identity; architecture/platform#5.6
- **check/platform#Q10** [충돌] blob model이 권한 0400·7일 유예·기동/매일 점검·저장 공간 보호를 구체적으로 반영하지 않는다.
  - 선택지: 요구 수치·정책 적용 | 미정 유지
  - 추천: 참조 blob 보호·정지 GC·설치 권한·실제 공간 제한을 model에 반영
  - 적용: 고침: blob-store model 설치·GC·공간 정책과 정할 것 보강
  - 근거: platform/blob-store#R3; platform/blob-store#R9; platform/blob-store#R10; platform/blob-store#R12
- **check/platform#Q11** [충돌] backup model이 매일 1회·완료 7개와 migration 복구본 명시 삭제를 정할 것으로 남긴다.
  - 선택지: 요구 적용 | 미정 유지
  - 추천: 정해진 주기·개수·보존을 policy에 고정
  - 적용: 고침: backup-and-migration model 자동 backup·migration 복구본 정책과 정할 것 정리
  - 근거: platform/backup-and-migration#R3; platform/backup-and-migration#R12; platform/backup-and-migration#R18
- **check/platform#Q12** [충돌] secrets model에 R9의 보호 export/import 동작·실패 계약이 없다.
  - 선택지: 보호 adapter와 CAS 적용 | 일반 backup
  - 추천: 암호 보호 별도 이전·평문 중간 파일 없음·실패 시 기존 참조 유지
  - 적용: 고침: secrets model 이전 정책을 R9·architecture contract와 연결
  - 근거: platform/secrets#R9; domain-model/platform/secrets; architecture/platform#5.7
- **check/platform#Q13** [충돌] redaction model에 64자·2KiB 표본·wildcard 거절·80자 화면 문자열과 표시 type/길이 숨김이 없다.
  - 선택지: 요구 숫자 반영 | architecture에만 둠
  - 추천: R7·R9~R12를 model policy에 반영
  - 적용: 고침: redaction model 표본·화면 상태·표시 정책 보강
  - 근거: platform/redaction#R7; platform/redaction#R9; platform/redaction#R10; platform/redaction#R11; platform/redaction#R12
- **check/platform#Q14** [충돌] diagnostics model에 info 기본 level·보안 진단 종류·doctor 검사 항목이 빠졌다.
  - 선택지: 요구 반영 | architecture에만 둠
  - 추천: R6·R9·R10·R11을 실제 관측 정책으로 model에 연결
  - 적용: 고침: diagnostics model 보안 진단·doctor·기본 level 정책 추가
  - 근거: platform/diagnostics#R6; platform/diagnostics#R9; platform/diagnostics#R10; platform/diagnostics#R11
- **check/platform#Q15** [충돌] ledger·blob·diagnostics model이 ~/.lophn 경로를 고정하여 LOPHN_HOME root 선택과 충돌한다.
  - 선택지: 소유 concern이 정한 H 사용 | home 경로 고정
  - 추천: 모든 하위 저장 경로를 시작 때 고정한 data root 기준으로 표현
  - 적용: 고침: ledger·derived·blob·log 경로를 H 기준으로 맞춤
  - 근거: platform/install-and-update#R7; domain-model/platform/ledger; domain-model/platform/blob-store; domain-model/platform/diagnostics
- **check/platform#Q16** [충돌] ledger model에 확정 결과 보존이 미정으로 남지만 R10은 기간 삭제를 금지한다.
  - 선택지: 영구 보존 | 임의 정리
  - 추천: 현재 보존 정책 명시; 향후에도 옛 key 재효과 금지
  - 적용: 고침: ledger model 정할 것을 현재 영구 보존 기준으로 정리
  - 근거: platform/ledger#R10; domain-model/platform/ledger
- **check/platform#Q17** [충돌] 정함: platform architecture가 최신 child modal·앱 view 유지·overlay 경계를 명시적으로 연결하지 않는다.
  - 선택지: shell 소유 규칙 참조 | platform 독자 view 제어
  - 추천: shell의 child modal·입력 차단·overlay를 참조하고 platform 별도 UI contract 없음
  - 적용: 고침: architecture 4.1 사람이 보는 경계에 최신 결정과 en/message key·최소 정보·flow/screen 소유 구분 연결
  - 근거: shell/confirmation-window; shell/app-frame; shell/wording; shell#I8; shell#I9
  - 결정: 최근 결정 1·2·7: child modal·앱 view 유지·overlay·en/message key·정보 최소화
- **check/platform#Q18** [질문] 외부 MCP stdio 설정의 secret_ref 환경 값 선언과 platform의 환경 원값 금지·HTTP 전송 직전 부착만 허용 규칙을 어떻게 맞출까.
  - 선택지: stdio secret_ref 거절 | 별도 검토한 보호 transport
  - 추천: 현재 원값 금지를 유지하고 stdio secret_ref 설정은 안전한 사용 불가로 처리하는 요구를 lophn-agent/extensions 소유자가 확정
  - 적용: 미적용: 다른 최상위 소유 requirements/model/architecture와 함께 결정 필요; platform 원값 경계는 유지
  - 근거: platform/secrets#R1; platform/secrets#R5; lophn-agent/extensions#R12; domain-model/lophn-agent/extensions#StdioTransport; architecture/platform#5.7
- **check/platform#Q19** [질문] OS 표시 실패의 안전한 이유를 재시작 뒤 어떻게 다시 확인할까.
  - 선택지: shell derived 관측 유지 | 재시작 뒤 unknown
  - 추천: 별도 ledger 배달 상태 없이 shell의 안전 derived 관측·관측 시각을 쓰고 없으면 확인 불가
  - 적용: 미적용: shell/desktop의 표시 관측 저장 contract를 정해야 함; model은 확인 못한 성공을 채우지 않는다고 명시
  - 근거: platform/notifications#R10; shell/desktop; domain-model/platform/notifications
- **check/platform#Q20** [질문] architecture의 고정 queue·token·blob·redaction·진단·암호 parameter를 실제 OS에서 검증하고 어느 수치까지 acceptance 요구로 승격할까.
  - 선택지: 구현 기본값 검증 | 측정 뒤 변경
  - 추천: 현재 architecture 기본값과 기존 issue 추천안을 유지하고 OS 검증·부하·보호 export interoperability 테스트로 확정
  - 적용: 미적용: architecture 권고 수치는 유지; requirements에 없는 새 제품 약속으로 복제하지 않음
  - 근거: architecture/platform#2.3; architecture/platform#5.5; architecture/platform#5.6; architecture/platform#5.7; architecture/platform#5.8; architecture/platform#Q1; architecture/platform#Q6
- **check/platform#Q21** [질문] diagnostics R10의 오래 미사용 grant를 어떤 사용 관측과 기간으로 판정할까.
  - 선택지: 소유 grant 사용 관측·기간 확정 | 임의 진단 추정
  - 추천: apps/permissions의 실제 사용 근거와 기간 기준을 먼저 정하고 미관측을 미사용으로 단정하지 않음
  - 적용: 미적용: threshold와 소유 근거는 아직 정해지지 않아 requirements 수치 추가 안 함
  - 근거: platform/diagnostics#R10; apps/permissions; domain-model/platform/diagnostics

## documents (88)

### documents/addressing

- **documents/addressing#Q1** [충돌] hash 동일·5글자 shingle Jaccard 0.8 이상·0.5~0.8 대응과 사람 확정을 유지할까.
  - 선택지: 기존 대응·redirect chain / 같은 key만
  - 추천: 같은 key만
  - 적용: R5: 추측 매핑·확정 표·queue 없음
- **documents/addressing#Q2** [질문] section보다 작은 code block·table 주소를 추가할까.
  - 선택지: section·줄 범위만 / block·table 주소
  - 추천: 첫 판 section·줄 범위만
  - 적용: section과 documents/outline-and-search 줄 범위
- **documents/addressing#Q3** [질문] 문서 영문 address 이름을 어떻게 고르고 최대 길이는 얼마로 할까.
  - 선택지: 사람 직접 입력 / 첫 파일에서 자동 제안 후 수정
  - 추천: 자동 제안 후 사람 수정; 최대 길이는 spec에서 결정
  - 적용: R10: 제안 후 수정
- **documents/addressing#Q4** [충돌] 현재 이름 우선·문자열 redirect chain을 유지할까 영구 ID 예약으로 직접 해석할까.
  - 선택지: 현재 이름 뒤 redirect chain / 영구 예약 ID 직접 해석
  - 추천: 영구 ID 예약
  - 적용: R2·R6: 이름 재사용 금지·같은 ID 안내
- **documents/addressing#Q5** [충돌] 저장 위치를 MCP 원본 경로로 자동 결정할까.
  - 선택지: 원본 경로 자동 자리 / 실제 연결·명시 자리·자리 없음
  - 추천: 실제 연결 또는 명시 자리; 없으면 자리 없음
  - 적용: R3: 기본 자리 생성 없음

### documents/contexts

- **documents/contexts#Q1** [질문] context 분할·병합을 실제 동작으로 추가할까.
  - 선택지: 목적·항목 편집만 / 분할·병합 contract
  - 추천: 첫 판 평면 편집만
  - 적용: R5: 현재 개별 편집
- **documents/contexts#Q2** [충돌] context export의 파일 형식과 고정 판 참조 포함 범위를 어떻게 정할까.
  - 선택지: 별도 Markdown·JSON export / platform backup만
  - 추천: context 항목·용어 export; 하위 context 없음
  - 적용: R14: export 제공
- **documents/contexts#Q3** [질문] 상위 context·용어 상속·최대 3단 구조를 추가할까.
  - 선택지: 평면 / 부모·상속·3단
  - 추천: 평면 유지
  - 적용: 부모·상속 없음
- **documents/contexts#Q4** [질문] 문서 사이 영향·근거 간선을 기록하는 contract를 추가할까.
  - 선택지: 직접 항목만 / 별도 documents 관계 concern
  - 추천: 이번은 직접 항목만; 관계는 후속
- **documents/contexts#Q5** [질문] context 목차에 문서·context 관계 간선과 related context를 넣을까.
  - 선택지: 직접 항목만 / 관계 지도
  - 추천: 이번은 관계 지도 없음
- **documents/contexts#Q6** [질문] 확정한 관계로 관련 context를 탐색하게 할까.
  - 선택지: 직접 항목 역조회 / 관계 기반 탐색
  - 추천: 직접 항목 역조회만
  - 적용: R8: 직접 항목 역조회만
- **documents/contexts#Q7** [충돌] watch section rename 자동 추적과 이력의 같은 대응 계산을 유지할까.
  - 선택지: rename 매핑 / 같은 key 비교·소실
  - 추천: 같은 key 비교·소실
  - 적용: R9·R10: 자동 매핑 없음
- **documents/contexts#Q8** [충돌] context 항목의 기준/참고/watch를 깊이 설정과 묶을까.
  - 선택지: 항목별 depth / 읽기 요청의 범위·깊이만
  - 추천: 요청별 읽기 깊이
  - 적용: R1·R4: item 깊이 없음
- **documents/contexts#Q9** [충돌] 새 saved view·series 채택이 context의 View·Series 항목 금지를 바꿀까.
  - 선택지: context target 확대 / 문서·section·앱 read만
  - 추천: context target 유지
  - 적용: R2: view·series 대상 없음

### documents/file-tracking

- **documents/file-tracking#Q1** [질문] agent가 원본 연결 문서를 고치는 통로를 추가할까.
  - 선택지: 별도 제안 문서 / 사람 허락 뒤 원본 반영
  - 추천: 별도 제안 문서와 사람 편집 유지
  - 적용: 원본 직접 저장 금지; 별도 문서 저장은 documents/versions
- **documents/file-tracking#Q2** [충돌] 초기 worker 2개를 요구로 유지할까 구현 조절값으로만 둘까.
  - 선택지: 초기 2개로 시작 후 측정 조정 / 숫자 미지정
  - 추천: 초기 2개 후 측정 조정
  - 적용: R5: 초기 2개
- **documents/file-tracking#Q3** [질문] 안정 읽기 재시도·파일 수·바이트·시간 한도의 초기 값을 무엇으로 할까.
  - 선택지: 실측 설정값 / 고정 제품 상한
  - 추천: 실측으로 정하고 한도 초과는 미확인
- **documents/file-tracking#Q4** [충돌] 편집 세션당 감사 기록 한 번 규칙을 유지할까.
  - 선택지: 세션당 한 번 / 실제 파일 작업별 결과
  - 추천: 작업별 결과
  - 적용: R17: 세션당 한 번 제한 없음
- **documents/file-tracking#Q5** [충돌] 앱의 허용된 파일 I/O도 사람 전용 원본 파일 API로 우회할까.
  - 선택지: 모든 I/O 우회 / 앱 permission에 따른 직접 I/O 별도
  - 추천: 앱 I/O는 apps/permissions 소유
  - 적용: R2는 플랫폼 사람 파일 통로만 제한

### documents/formats

- **documents/formats#Q1** [질문] 설계 문서의 domain story·요구·불변식·테스트·blueprint 연결을 전용 format으로 결정적으로 검사할까.
  - 선택지: 일반 Markdown+eval / 구조화 format validator
  - 추천: 첫 판 일반 Markdown, 판단 품질은 lophn-agent/evaluation
- **documents/formats#Q2** [질문] 문서에 실행 capability를 허용할까.
  - 선택지: 정적·격리 view만 / 실행 capability 문서
  - 추천: 첫 판 정적·격리 view
  - 적용: 실행 capability 없음
- **documents/formats#Q3** [질문] slide·data report의 초기 section 추출을 추가할까.
  - 선택지: 초기 추가 / 후속 format 확장
  - 추천: 후속 확장
  - 적용: R3: 기본 section 추출 없음
- **documents/formats#Q4** [질문] 사람이 추가 format module을 설치할 수 있게 할까.
  - 선택지: 내장만 / fixture·격리 검사 뒤 추가 설치
  - 추천: 첫 판 내장만
  - 적용: 내장 format 요구만 작성
- **documents/formats#Q5** [충돌] 묵시 format 검사 실패에도 원문 version을 남길까.
  - 선택지: 경고만 내고 version 미생성 / 경고와 원문 version 보존
  - 추천: 새 모델의 원문 보존
  - 적용: R5: 원문 version 보존
- **documents/formats#Q6** [충돌] 새 모델의 지원 MIME 목록을 기존 plain text·XHTML·별도 Markdown MIME까지 넓힐까.
  - 선택지: Markdown·HTML만 / 기존 5개 MIME 유지
  - 추천: 기존 5개 MIME 유지
  - 적용: R2: 5개 MIME; domain model 미수정
- **documents/formats#Q7** [질문] 격리 format 실행의 시간·메모리·입출력 상한을 무엇으로 할까.
  - 선택지: 실측 상한 / 고정 보수적 상한
  - 추천: H6 환경 선택 뒤 실측하고 초과 실행만 종료
- **documents/formats#Q8** [질문] 동적 HTML은 원본 HTML과 렌더링 DOM 중 무엇을 추출할까.
  - 선택지: 원본 HTML / 렌더링 DOM
  - 추천: 결정적 원본 HTML
  - 적용: R13: 원본 HTML만
- **documents/formats#Q9** [충돌] 독립 format 규칙 번호와 기존 index 자동 재작성 금지를 유지할까.
  - 선택지: 규칙 번호·index 보존 / 정확한 module 보존·derived 재생성
  - 추천: 정확한 module 보존
  - 적용: R7·R20: 정확한 module; derived는 재생성

### documents/outline-and-search

- **documents/outline-and-search#Q1** [질문] 문서 제목 30자·요약 200자·최상위 section 설명 80자를 organizing model로 보강하는 별도 요청 contract를 둘까.
  - 선택지: 원문 발췌만 / 사람·CE 요청 기반 derived 요약
  - 추천: 먼저 원문 발췌, 후속 요청 기반 cache
  - 적용: R18: 원문 발췌 기본
- **documents/outline-and-search#Q2** [질문] embedding 검색을 추가할까.
  - 선택지: keyword만 / 후속 embedding
  - 추천: 첫 판 keyword만
  - 적용: R10: keyword만
- **documents/outline-and-search#Q3** [질문] 한국어 검색에 기존 trigram을 유지할까 다른 tokenizer로 바꿀까.
  - 선택지: FTS5 기본 / trigram+n<3 부분 일치
  - 추천: 기존 trigram 유지 후 실측
  - 적용: R11: trigram
- **documents/outline-and-search#Q4** [질문] token 추정치를 model별로 보정할까.
  - 선택지: codepoint/3 / model별
  - 추천: 첫 판 codepoint/3
  - 적용: R6: 공통 근사
- **documents/outline-and-search#Q5** [충돌] 기존 section rename 이력과 대응 chain을 새 key 원칙에 맞춰 어떻게 처리할까.
  - 선택지: 유사도·사람 대응 / 같은 key 비교만
  - 추천: 같은 key 비교만
  - 적용: R19: rename 추정 없음
- **documents/outline-and-search#Q6** [충돌] saved view 없음이라는 기존 outline domain model을 이번 채택에 맞춰 확장해야 한다.
  - 선택지: 없음 / 저장 조건·요청 시 목록
  - 추천: saved view 저장 조건
  - 적용: R23~R25 적용; 기존 model 미수정
- **documents/outline-and-search#Q7** [충돌] 단순 offset cursor와 갱신 시각 정렬을 새 기준 고정 규칙에 그대로 쓸까.
  - 선택지: offset만 / 기준·scope·조건 결합 cursor와 event 순서
  - 추천: 기준 결합 cursor
  - 적용: R9: 기준 결합; 시간은 표시만
- **documents/outline-and-search#Q8** [질문] saved view의 처음 지원 조건·정렬 범위를 이대로 둘까.
  - 선택지: 문서 문자열·자리·context·format·보관·시점 / tag·관계·앱 데이터도 추가
  - 추천: 현재 정의된 문서 조건만
  - 적용: R23: 문서 조건; 갱신 순·제목 순 선택

### documents/projects

- **documents/projects#Q1** [질문] 여러 프로젝트의 추적 폴더 겹침 금지를 유지할까.
  - 선택지: 겹침 금지 / 파일별 추적 소유 프로젝트 선택
  - 추천: 겹침 금지
  - 적용: R7: 겹침 금지
- **documents/projects#Q2** [충돌] 폴더의 label·기본 여부와 기본 추적 행의 존재 의미를 새 모델에도 유지할까.
  - 선택지: 기존 필드·행 의미 유지 / 폴더 설명·명시적 추적 스위치
  - 추천: 폴더 설명과 명시적 스위치
  - 적용: R2·R3·R8: label·기본 여부 없음
- **documents/projects#Q3** [질문] 프로젝트의 폴더·원본 경로 정보를 별도 export로 제공할까.
  - 선택지: Markdown·JSON export / platform backup만
  - 추천: 별도 export는 후속으로 두고 지금 backup만
- **documents/projects#Q4** [충돌] 미리보기와 적용 후 파일 목록의 일치를 고정 디스크 snapshot으로 보장할까.
  - 선택지: 목록 고정 / 같은 규칙·구성 기준을 적용하고 새 파일은 재판정
  - 추천: 같은 규칙·구성 기준
  - 적용: R6: 규칙은 동일하되 목록은 디스크 snapshot 아님

### documents/series

- **documents/series#Q1** [충돌] 기존 domain model의 Series 없음 정책을 이번 채택에 맞춰 어떻게 갱신할까.
  - 선택지: 한 문서 판만 / 독립 가족도 허용
  - 추천: 독립 가족 허용
  - 적용: 새 documents/series 모델 작성; 기존 versions 모델 미수정
- **documents/series#Q2** [충돌] 정렬 기준을 format metadata 필드로 둘까 key의 결정적 정렬로 둘까.
  - 선택지: 선언된 format 정렬 값 / key 정렬만
  - 추천: 선언된 format 값과 key fallback
  - 적용: R5: 선언된 정렬 값·결정적 key fallback
- **documents/series#Q3** [질문] 주간 보고용 날짜·주차 다음 이름 규칙을 추가할까.
  - 선택지: 숫자·version 규칙만 / 날짜·ISO week 규칙
  - 추천: 우선 기존 숫자 규칙, 날짜는 수동 key
  - 적용: R7·R8: 날짜 자동 계산 없음
- **documents/series#Q4** [충돌] draft 값을 첫 version 없는 Document로 저장하던 구조를 유지할까.
  - 선택지: 첫 version 없는 Document / 가족 내 작성 준비 값
  - 추천: 가족 내 작성 준비 값
  - 적용: R11: draft 보존; 확정 전 Document 없음
- **documents/series#Q5** [충돌] Operator가 series의 다음 독립 문서를 만들 수 있게 assignment를 넓힐까.
  - 선택지: 기존 문서 새 판만 / 가족 다음 문서 생성
  - 추천: 이번은 기존 문서 새 판만 유지하고 가족은 사람·허용 앱·coding agent가 생성
  - 적용: series 추가가 Operator 권한을 넓히지 않음

### documents/terms

- **documents/terms#Q1** [질문] context 사이 같은 뜻의 다른 용어를 실제 대응으로 연결할까.
  - 선택지: 충돌 보고·질문만 / Term 대응 관계
  - 추천: 현재는 보고·질문만
  - 적용: R3: 대응 없음
- **documents/terms#Q2** [충돌] 기존 alias·translation을 새 Term에 유지할까.
  - 선택지: 별칭·번역 / 정확한 이름과 사람 정의
  - 추천: 정확한 이름과 사람 정의
  - 적용: R3: 별칭·번역 기능 없음

### documents/versions

- **documents/versions#Q1** [충돌] 자리 문서·version export의 선택 판·첨부 포함 범위를 어떻게 확정할까.
  - 선택지: 원문·version export / platform backup만
  - 추천: 원문·고정 판만 export하고 derived는 재생성
  - 적용: R16: 자리 export 제공
- **documents/versions#Q2** [질문] 대용량 HTML·data의 파일 수·바이트·준비 시간 상한을 무엇으로 할까.
  - 선택지: 실측 상한 / 무제한 streaming
  - 추천: 실측 상한과 명시적 실패
- **documents/versions#Q3** [질문] 문서 영구 삭제를 추가할까.
  - 선택지: 보관만 / 고정 근거·옛 address 흔적을 보존하는 삭제
  - 추천: 첫 판 보관만
  - 적용: R12: 영구 삭제 없음
- **documents/versions#Q4** [충돌] series 없음이라는 기존 domain model 정책을 이번 series 채택에 맞춰 어떻게 바꿀까.
  - 선택지: 한 문서 판만 / 독립 가족도 허용
  - 추천: 독립 가족은 documents/series
  - 적용: R15: 가족 허용; 기존 versions 모델은 미수정
- **documents/versions#Q5** [충돌] MCP 작업 디렉터리를 저장 원본으로 기록할까.
  - 선택지: 작업 디렉터리 자동 원본 / 실제 관측 또는 명시 연결만
  - 추천: 실제 관측 또는 명시 연결
  - 적용: R7: 작업 디렉터리만으로 원본 생성 안 함
- **documents/versions#Q6** [질문] lophn과 함께 배포하는 사용 안내를 어디에 둘까
  - 선택지: 사용자 ledger Document / system place / 설치 묶음 읽기 전용 catalog
  - 추천: 설치 guides catalog의 version·title·content hash; 사용자 Document 자동 생성 없음
  - 적용: 예; requirements R17~R18·architecture 한 줄 적용
  - 근거: documents#I2; lophn-agent/roles#I7
- **redesign/propagate#Q5** [질문] 전역 LOPHN.md의 Project 없는 source를 어떻게 version에 연결할까?
  - 선택지: 가짜 system Project / exact instruction_file source
  - 추천: place=null exact global instruction source; data-root recursive tracking 금지
  - 적용: instruction_file tagged source/target와 신규 write guard 반영
  - 근거: lophn-agent/instructions#R1~R3; documents/file-tracking#R19; documents/versions#R19

### documents

- **architecture/documents#Q1** [충돌] saved view 요구에 맞는 ledger 표와 command가 초기 domain model에 없다
  - 선택지: 별도 JSON 파일 / ledger saved_views
  - 추천: 사람이 저장한 조건은 saved_views에 두고 목록만 derived로 계산
  - 적용: 해결: coordinator가 SavedView viw, saved_views, view.save/update/archive와 event를 domain model에 추가했고 architecture가 반영함
  - 근거: documents/outline-and-search#R23~R25; docs/domain-model/documents/outline-and-search.md
- **architecture/documents#Q2** [충돌] document MIME 목록이 requirements와 domain model의 내장 선언 표에서 다르다
  - 선택지: Markdown·HTML만 / 요구의 Markdown 두 MIME·HTML·XHTML·plain text
  - 추천: 요구의 넓은 MIME 목록을 내장 module에 적용하고 plain text는 heading 없이 추출
  - 적용: 예
  - 근거: documents/formats#R2; docs/domain-model/documents/formats.md 내장 이름 표
- **architecture/documents#Q3** [질문] format의 시간·난수·동적 코드 실행 금지를 Deno 권한만으로 강제할 수 없다
  - 선택지: Deno 전역 삭제 / 별도 QuickJS WASM guest
  - 추천: 내장 format부터 QuickJS WASM 새 context에서 실행하고 guest 전역·host binding을 차단한다
  - 적용: 예
  - 근거: documents/formats#R18~R20; docs/domain-model/documents/formats.md 정책; architecture#A2
- **architecture/documents#Q4** [질문] scan·안정 읽기·format 실행의 초기 자원 한도를 정해야 한다
  - 선택지: 무제한 / 구현 조절값에 bounded 기본값
  - 추천: 준비 worker 2, 60초 scan, 750ms 안정 대기, 안정 읽기 3회, format 5초·64MiB guest memory·16MiB 입력·8MiB 출력에서 시작한다
  - 적용: 예: 문서에 초기 구현값으로 기록하고 format 한도 초과를 unavailable로 표시
  - 근거: documents/file-tracking#R5; documents/formats#Q7; docs/domain-model/documents/file-tracking.md 정할 것
- **architecture/documents#Q5** [질문] 재생성 seq S snapshot과 source_seq 당시 context 구성 근거를 어떻게 얻나
  - 선택지: 현재 구성만 조회 / platform read snapshot 및 event before·after replay
  - 추천: platform read의 일관된 snapshot과 event 구독 계약을 사용하고 context 구성은 before·after event를 source_seq까지 재생하여 계산한다
  - 적용: 예: 상대 contract의 경로·내부 구현은 정의하지 않음
  - 근거: docs/domain-model/documents/contexts.md WatchedItemComparison; docs/domain-model/documents/outline-and-search.md derived store 정책
- **architecture/documents#Q6** [충돌] SavedView ViewFilter는 series를 허용하지만 requirements의 첫 조건 범위에는 없고 보관 여부 조건은 요구만 있다
  - 선택지: 요구만 / 변경된 domain model의 series와 요구의 보관 상태를 함께 지원
  - 추천: series 필터와 status active/archived/all 조건을 검증한 ViewFilter로 취급하고 보관은 영구 삭제가 아닌 view.archive로 처리
  - 적용: 해결: coordinator가 document_status active/archived/all(기본 active)을 domain model에 추가했고 architecture 반영
  - 근거: documents/outline-and-search#R23; docs/domain-model/documents/outline-and-search.md ViewFilter
- **architecture/documents#Q7** [충돌] SavedView 저장·변경 actor가 domain model에는 CE agent도 있으나 requirements는 사람의 동작만 적는다
  - 선택지: 사람만 / 허용된 CE도 직접 저장·변경
  - 추천: requirements대로 저장·변경·보관을 사람만 허용한다
  - 적용: 해결: coordinator가 view.save/update actor를 user만으로 고쳤고 architecture 반영
  - 근거: documents/outline-and-search#R23; docs/domain-model/documents/outline-and-search.md command
- **architecture/documents#Q8** [충돌] versions 정책에 Series·draft 없음이라는 이전 문장이 남아 있다
  - 선택지: versions의 없음 문장 / 별도 series concern의 현 모델
  - 추천: 가족·draft는 documents/series로 구현하고 Operator 기존 출력 Document 제한은 유지한다
  - 적용: 예
  - 근거: docs/domain-model/documents/versions.md 정책 독립 결과; documents/series#R11; docs/domain-model/documents/series.md
- **architecture/documents#Q9** [질문] ContentFile canonical JSON과 glob·gitignore 라이브러리를 고정해야 한다
  - 선택지: OS glob·임의 JSON / 고정 POSIX 경로 및 canonical encoder·picomatch·ignore
  - 추천: 경로 codepoint 순, 고정 필드 JSON, UTF-8 SHA-256을 사용하며 picomatch와 ignore를 정확한 dependency 묶음에 고정한다
  - 적용: 예
  - 근거: docs/domain-model/documents/versions.md 정할 것; docs/domain-model/documents/projects.md 정할 것
- **check/documents#Q1** [충돌] versions에 Series·다음 번호·draft 없음이라는 이전 정책이 남아 있다.
  - 선택지: 이전 정책 유지 / 별도 series 모델 참조
  - 추천: 채택한 series 요구를 따른다.
  - 적용: 고침: versions의 독립 결과 정책·정할 것을 documents/series 참조로 바꾸고 첫 Version 없는 Document는 만들지 않음을 유지했다.
  - 근거: documents#I6; documents/versions#R15; documents/series#R11; docs/domain-model/documents/versions.md
- **check/documents#Q2** [충돌] format domain model 내장 MIME 표가 Markdown·HTML만 허용하고 plain text·XHTML·별도 Markdown MIME 요구를 누락한다.
  - 선택지: 좁은 표 / 요구 전체
  - 추천: 요구 전체와 plain text의 heading 없음 규칙을 반영한다.
  - 적용: 고침: document 내장 MIME 표를 text/markdown,text/x-markdown,text/html,application/xhtml+xml,text/plain으로 맞췄다.
  - 근거: documents/formats#R2; docs/domain-model/documents/formats.md
- **check/documents#Q3** [충돌] Markdown 추출 정책에 HTML pre 안 heading 제외가 빠져 있다.
  - 선택지: 현 정책 / R10 전체
  - 추천: HTML pre 제외를 반영한다.
  - 적용: 고침: format Markdown heading 정책에 HTML pre를 추가했다.
  - 근거: documents/formats#R10; docs/domain-model/documents/formats.md
- **check/documents#Q4** [충돌] format 선언에 요구한 구조·metadata·template·vocabulary가 없고 Series 정렬·draft가 없는 필드를 참조한다.
  - 선택지: guide만 / 선언 필드 추가
  - 추천: format 안내·작성 시작값과 metadata 타입을 같은 고정 묶음에 둔다.
  - 적용: 고침: FormatDeclaration에 structure,metadata,template,vocabulary를 추가하고 architecture formats/get에 구조·metadata 요구를 반영했다.
  - 근거: documents/formats#R8; documents/series#R5,R11; docs/domain-model/documents/formats.md; docs/architecture/documents.md
- **check/documents#Q5** [충돌] Project 생성에 tracking=true 입력이 가능하고 update의 folders 변경이 미리보기 검사를 우회한다.
  - 선택지: 우회 허용 / 모든 경로에서 요구 검사
  - 추천: 생성은 tracking=false, 폴더·규칙 변경은 같은 미리보기 기준을 검사한다.
  - 적용: 고침: Project 불변 조건·create/update command·architecture mutation 설명에 검사 조건을 추가했다.
  - 근거: documents/projects#R3,R6; docs/domain-model/documents/projects.md; docs/architecture/documents.md
- **check/documents#Q6** [충돌] TrackingPreview의 상대 path만으로 여러 등록 루트에 있는 같은 이름 파일을 구별할 수 없다.
  - 선택지: path만 / 등록 루트와 상대 path
  - 추천: 각 entry를 등록 루트와 결합한다.
  - 적용: 고침: TrackingPreview.entries에 folder_path를 추가하여 folders의 루트와 상대 path를 함께 반환한다.
  - 근거: documents/projects#R2,R6; docs/domain-model/documents/projects.md
- **check/documents#Q7** [충돌] 가장 깊은 등록 폴더 해석 요구가 Project model·architecture read contract에 없다.
  - 선택지: 첫 일치 / 가장 깊은 루트
  - 추천: 꺼진 tracking의 중첩 루트도 가장 깊은 등록 루트로 해석한다.
  - 적용: 고침: Project 폴더 해석 정책과 projects/resolve contract에 반영했다.
  - 근거: documents/projects#R10; docs/domain-model/documents/projects.md; docs/architecture/documents.md
- **check/documents#Q8** [충돌] SavedView가 요구의 삭제 대신 archive만 제공하고 revision을 공통 event seq가 아닌 1씩 증가하는 정수로 정의한다.
  - 선택지: 하위 모델 유지 / requirements와 공통 revision 준수
  - 추천: view.delete·SavedViewDeleted와 event seq CAS를 쓰고 문서는 바꾸지 않는다.
  - 적용: 고침: SavedView status를 제거하고 delete command·event·before 기록·삭제된 cursor conflict·architecture 경로를 맞췄다.
  - 근거: documents/outline-and-search#R23; platform/ledger; docs/domain-model/documents/outline-and-search.md; docs/architecture/documents.md
- **check/documents#Q9** [충돌] SavedView가 요구에 없는 Series 멤버 조건·name/text/limit 상한·조건 없는 view 금지를 추가했다.
  - 선택지: 추가 규칙 유지 / 요구 범위만
  - 추천: 명시한 문서 조건과 공통 outline 예산만 지원한다.
  - 적용: 고침: Series filter·임의 길이/행수 상한·조건 없음 금지를 제거하고 조건·정렬·현재 scope·고정 판을 cache 기준으로 맞췄다.
  - 근거: documents/outline-and-search#R23,R25; docs/domain-model/documents/outline-and-search.md; docs/architecture/documents.md
- **check/documents#Q10** [충돌] OutlinePage가 section 범위·hash·estimated token과 root 통계·활동·목록 저장 주체 및 series/view 종류를 누락한다.
  - 선택지: 작은 기존 shape / 요구한 작은 metadata 전체
  - 추천: 본문 없이 필요한 metadata와 종류를 반환한다.
  - 적용: 고침: root/place/document entry와 series/view 종류를 보강하고 최신 판·관점 순서·기본 정렬을 반영했다.
  - 근거: documents/outline-and-search#R2,R4,R5,R8,R25,R26; documents/versions#R9; documents/series#R4; docs/domain-model/documents/outline-and-search.md; docs/architecture/documents.md
- **check/documents#Q11** [충돌] 검색 model은 tokenizer를 미정으로 두고 architecture는 가용 주제 텍스트 검색을 빠뜨린다.
  - 선택지: 기본 FTS / trigram·짧은 LIKE
  - 추천: R10,R11의 keyword 규약을 따른다.
  - 적용: 고침: model 검색 정책에 trigram·3 codepoint 미만 LIKE와 요약·주제 입력 판을 명시하고 architecture 검색 경로를 맞췄다.
  - 근거: documents/outline-and-search#R10,R11; docs/domain-model/documents/outline-and-search.md; docs/architecture/documents.md
- **check/documents#Q12** [충돌] 요약 일치를 원문 snippet/ranges로만 반환하면 model 요약의 말을 원문의 일치 근거처럼 꾸미게 된다.
  - 선택지: 원문 모양 반환 / derived 일치와 입력 판 분리
  - 추천: 원문·summary·topic 일치 출처와 cache 입력 판·stale를 분리한다.
  - 적용: 고침: SearchResult에 match_source/cache_basis를 추가하고 derived 일치는 빈 원문 ranges와 실제 입력 고정 판으로 반환하도록 model·architecture를 맞췄다.
  - 근거: documents/outline-and-search#R10,R12,R18; docs/domain-model/documents/outline-and-search.md; docs/architecture/documents.md
- **check/documents#Q13** [충돌] 추출 결과는 text_hash만 있으나 architecture는 대표 텍스트를 받으며 derived store와 blob의 위치도 다르게 적혀 있다.
  - 선택지: 추출 text 없음 / text와 UTF-8 hash
  - 추천: 정규화 text와 hash를 반환하고 바이트는 derived_texts에 둔다.
  - 적용: 고침: SectionExtractionResult.text·text_hash와 DerivedVersion.text_hash 설명을 architecture 저장 위치에 맞췄다.
  - 근거: documents/formats#R2,R9; documents/outline-and-search#R13; docs/domain-model/documents/formats.md; docs/domain-model/documents/outline-and-search.md; docs/architecture/documents.md
- **check/documents#Q14** [충돌] agent TermEvidence에 section·줄 범위를 전부 생략한 근거를 넣을 수 있다.
  - 선택지: 판만 / 실제 본문 위치
  - 추천: 고정 판의 section 또는 유효 줄 범위와 실제 출현을 검사한다.
  - 적용: 고침: TermEvidence 정책에 실제 본문 위치 필수·출현 검증·판만 있는 근거 거절을 추가했다.
  - 근거: documents/terms#R1; docs/domain-model/documents/terms.md
- **check/documents#Q15** [충돌] restore가 과거 format까지 복원한다는 요구와 base_version format으로만 준비한다는 저장 규칙이 맞지 않는다.
  - 선택지: 최신 format / 선택 과거 판의 정확한 format
  - 추천: 명시 restore를 허용된 format 선택으로 다루고 최신 판 CAS는 유지한다.
  - 적용: 고침: Version restore 불변 조건과 architecture 준비 contract에 선택 판 FormatRef·정확한 module·원본 파일 관측 경계를 명시했다.
  - 근거: documents/versions#R10,R13; documents/formats#R7; docs/domain-model/documents/versions.md; docs/architecture/documents.md
- **check/documents#Q16** [충돌] 보관 자리 제외 요구가 model·architecture에서 문서 보관 필터로만 구현되어 낡은 index가 보관 자리 자료를 반환할 수 있다.
  - 선택지: index 상태만 / 현재 ledger 보관 상태 검사
  - 추천: 기본 목록·검색의 현재 문서·자리 상태를 검사하고 고정 판 읽기는 유지한다.
  - 적용: 고침: model 비동기 반영 정책과 architecture 읽기 처리에 보관 자리 제외·해제 비동기 반영을 추가했다.
  - 근거: documents/outline-and-search#R17; docs/domain-model/documents/outline-and-search.md; docs/architecture/documents.md
- **check/documents#Q17** [충돌] 설치 안내 R17,R18을 받치는 고정 안내 값과 실제 read 경로가 없었다.
  - 선택지: 사용자 Document / 설치 안내 값·읽기 통로
  - 추천: BundledGuide는 설치 manifest 고정 참조이며 사용자 entity가 아니다.
  - 적용: 고침: versions에 BundledGuide 값과 offline·복사본 생애를 추가하고 architecture에 guides/list,get,outline,read 경로를 명시했다.
  - 근거: documents/versions#R17,R18; lophn-agent/roles#I7; docs/domain-model/documents/versions.md; docs/architecture/documents.md
- **check/documents#Q18** [충돌] 정함: 문서 목록 요구는 저장 주체·format 등의 전체 metadata를 기본 화면에 보여 주는 것으로 읽히며 최근 정보 최소화 결정과 충돌한다.
  - 선택지: 전체 기본 노출 / API 사실과 기본 UI 분리
  - 추천: 제목·현재 상태만 기본으로 보이고 저장 근거·format·처리 상세는 펼친다.
  - 적용: 고침: versions R9와 outline-and-search R3의 기본/상세 경계를 명시하고 architecture에 en message key·사용자 화면 내부 라벨 금지 규칙을 연결했다. 요구 번호·의도 줄 유지.
  - 근거: 최근 결정7; shell#I8,I9; docs/requirements/documents/versions.md#R9; docs/requirements/documents/outline-and-search.md#R3; docs/architecture/documents.md
  - 결정: 최근 결정 7: 전체 metadata 기본 노출 대신 필요한 정보·상세 분리
- **check/documents#Q19** [충돌] 문서 architecture의 잎과 model의 가림은 프로젝트 말 규칙을 위반한다.
  - 선택지: 번역어 / 기존 개발자 말
  - 추천: leaf·redaction을 쓴다.
  - 적용: 고침: architecture 잎을 leaf로, ReadResult 출력 가림 설명을 redaction으로 바꿨다.
  - 근거: AGENTS.md; docs/domain-model/documents/outline-and-search.md; docs/architecture/documents.md
- **check/documents#Q20** [충돌] file-tracking model의 동시 처리 한도 전부 구현값이라는 설명은 초기 worker 2개 요구를 흐린다.
  - 선택지: 전부 구현값 / worker 요구와 호출 예산 분리
  - 추천: 준비 worker 2개는 R5를 따르고 그 밖의 초기 자원값은 조절값이다.
  - 적용: 고침: file-tracking 정할 것에서 worker 수의 requirements 근거와 별도 구현 예산을 구별했다.
  - 근거: documents/file-tracking#R5; docs/domain-model/documents/file-tracking.md
- **check/documents#Q21** [질문] SeriesInstance는 문서당 가족 하나를 강제하고 Series.name 불변을 선언하지만 requirements에 다중 가족 금지·이름 변경 금지가 없다.
  - 선택지: 현 제약 요구 추가 / 제약 제거·다중 가족 지원
  - 추천: 가족의 현재 단순 모델을 유지할지 사람이 정한 뒤 requirements와 맞춘다.
  - 적용: 미적용: requirements 밖 구조 변경을 확정하지 않았다.
  - 근거: documents/series#R1,R2,R12; docs/domain-model/documents/series.md
- **check/documents#Q22** [질문] coding-agent architecture의 lophn_project는 등록 폴더·label·연결 context를 반환하고 CLI는 folder ID/default·직접 project-context link·Context parent를 받지만 documents는 agent 절대 경로 없음·Folder ID/default 없음·직접 연결과 parent 없음이다.
  - 선택지: 통로를 documents에 맞춤 / 새 소유 요구 추가
  - 추천: coding-agent의 외부 통로를 documents의 현재 요구·값으로 맞춘다.
  - 적용: 범위 밖: coding-agent 문서 미수정. parent/link/default와 파일 경로 반환을 담당 워커가 확인해야 한다.
  - 근거: documents/projects#R9; documents/contexts#R8; docs/domain-model/documents/projects.md; docs/domain-model/documents/contexts.md; docs/architecture/coding-agent.md#5.2,#5.4
- **check/documents#Q23** [질문] Context Engineer 후보는 다른 문서 3개 이상·근거 최대5개를 요구하지만 documents/terms model은 고정 임계값 없음으로 적는다.
  - 선택지: 도메인에 CE 임계값 중복 / 역할 정책과 도메인 최소 증거 분리
  - 추천: terms의 최소 본문 근거와 별도 역할의 후보 선정 정책을 구별하고 CE에 적용할 실제 값은 담당 concern에서 확인한다.
  - 적용: 미적용: 다른 최상위 요구의 임계값은 terms에 복제하지 않았다.
  - 근거: documents/terms#R1; docs/domain-model/documents/terms.md; lophn-agent/roles/context-engineer#R8
- **check/documents#Q24** [질문] Context export R14의 목적·관점·이유·고정 읽기 판·glossary는 정의됐지만 파일 형식과 한 export의 판 선택 기준은 아직 없다.
  - 선택지: Markdown·JSON과 export 시점 판 / 읽기 session 근거 판
  - 추천: 기존 documents/contexts#Q2에서 형식과 선택 판 기준을 함께 확정한다.
  - 적용: 미적용: 근거 없는 session 이력 표나 format을 추가하지 않았다.
  - 근거: documents/contexts#R14; docs/architecture/documents.md#5.5; documents/contexts#Q2
- **check/documents#Q25** [질문] 사용자 documents screen 기본 결과가 최신 저장 주체·시각을 항상 노출하며 format을 기본 filter로 두는 반면 최근 결정7과 보강한 R3,R9는 현재 필요한 제목·상태를 우선한다.
  - 선택지: 화면 현재 노출 / 저장 근거·format을 상세로 이동
  - 추천: documents screen에서 결과 판단에 불필요한 저장 근거·format을 상세/More filters로 접는다.
  - 적용: 범위 밖: screen 미수정.
  - 근거: 최근 결정7; docs/screens/documents.md; documents/versions#R9; documents/outline-and-search#R3

## apps (86)

### apps/automations

- **apps/automations#Q1** [질문] H1: automation의 외부 효과를 정확한 release·명령·입력·범위의 반복 사전 허락으로 지원할까?
  - 선택지: 현재 금지 / 매번 확인 / 반복 범위 사전 허락
  - 추천: 현재 금지 유지
  - 적용: R13: 현재 금지
- **apps/automations#Q2** [질문] 달력 시각·파일 변경·event와 누락 회차 정책을 첫 판에 추가할까?
  - 선택지: 시작·간격만 / 5필드 cron·IANA timezone·Vixie OR 추가 / 파일·event 추가; skip / coalesce / catch-up
  - 추천: 시작·간격만, 놓친 회차 skip
  - 적용: R2·R7: 시작·간격만, catch-up 없음
- **apps/automations#Q3** [충돌] 이전 옮김 재료의 최대 retry 10회와 현재 자동 retry 0회 중 어느 쪽을 유지할까?
  - 선택지: 최대 10회 / 0회
  - 추천: 현재 모델의 0회
  - 적용: R8: 0회, 최소 간격 60000ms 유지

### apps/blueprint

- **apps/blueprint#Q1** [충돌] 출력·오류 schema와 opaque JSON 계약을 이번 작은 command 모델에도 추가할까?
  - 선택지: 입력만 지원; 출력·오류 schema와 opaque 추가
  - 추천: 현재 domain model의 입력 계약만 사용하고 추가는 별도 결정한다.
  - 적용: 입력만 지원
- **apps/blueprint#Q2** [충돌] tagged union·nullable 조합과 입력 줄임 문법을 어디까지 지원할까?
  - 선택지: 현재 한 타입 schema; union·nullable 조합 확장; TypeScript 줄임 문법 확정
  - 추천: 현재 한 타입 schema를 요구로 사용하며 줄임 문법은 spec에서 정한다.
  - 적용: 현재 한 타입 schema
- **apps/blueprint#Q3** [질문] blueprint 작성형은 TypeScript만 받을까 선언형 YAML도 받을까?
  - 선택지: 권한 없는 TypeScript; 선언형 YAML; 둘 다
  - 추천: TypeScript의 권한 없는 10초 추출을 유지한다.
  - 적용: TypeScript 추출 지원
- **apps/blueprint#Q4** [질문] 전체·패널·카드 화면을 어떤 선언으로 구별할까?
  - 선택지: 한 화면의 지원 sizes; 크기마다 별도 screen; 전체 화면 강제 축소
  - 추천: 같은 반응형 screen에 full/panel/card 지원 목록을 두고 실제 지원 모드만 열기
  - 적용: ScreenDeclaration.sizes와 AppScreenRequest.size 적용
  - 근거: docs/intent/apps.md#I10; docs/requirements/apps/blueprint.md#R19
- **apps/blueprint#Q5** [질문] write의 되돌리기 지원을 어떤 실제 계약으로 검증할까?
  - 선택지: boolean만; 되돌림 command와 receipt 및 revision; 앱 DB 전체 snapshot
  - 추천: 되돌림 command와 invocation에 묶인 receipt·expected_revision을 선언하고 app test로 변경/복원/중복/충돌 확인
  - 적용: CommandRevertDeclaration과 성공 결과 revert receipt 적용
  - 근거: docs/intent/apps.md#I11; docs/domain-model/apps/blueprint.md
- **apps/blueprint#Q6** [충돌] 앱의 되돌림 지원과 기존 run revert의 앱 업무 DB는 범위 밖이라는 규칙을 어떻게 잇나?
  - 선택지: 지원 write도 irreversible; 앱 receipt로 revert command 호출; DB를 core가 직접 복원
  - 추천: 앱이 선언한 receipt·revision으로 앱 revert command를 호출하고 실제 성공/충돌을 별도 확인
  - 적용: lophn-agent/revert에서 고침
  - 근거: docs/domain-model/lophn-agent/revert.md#되돌림-표; docs/domain-model/apps/blueprint.md#CommandRevertDeclaration; docs/intent/apps.md#I11

### apps/data

- **apps/data#Q1** [질문] 업무 첨부 파일을 지원하면 backup을 DB와 첨부까지 넓힐까?
  - 선택지: 첫 판 SQLite만 / DB+첨부 원자 복구
  - 추천: 첫 판 SQLite만
  - 적용: R5: SQLite DB 전체만 보장
- **apps/data#Q2** [질문] 운영 후 사람이 손실을 확인하는 별도 restore를 제공할까?
  - 선택지: activation 전 실패 복원만 / 명시적 손실 확인 restore
  - 추천: activation 전 실패 복원만
  - 적용: R11·R12: 운영 후 자동 덮어쓰기 없음

### apps/invocations

- **apps/invocations#Q1** [질문] 일반 invocation 후행 기록에 durable 전달 보관이 필요한가?
  - 선택지: 제한된 메모리 재전송 / durable 전달 보관
  - 추천: 제한된 메모리 재전송으로 시작하고 손실 진단
  - 적용: R5·R10: 메모리 재전송 및 부재 표시, confirm 선행 접수 유지
- **apps/invocations#Q2** [질문] 전체 운영 통계에 호출·실행 기회·실패 분모·계측 공백의 bounded rollup을 제공할까?
  - 선택지: 진단 표본만 / derived 전체 집계
  - 추천: 첫 판은 실제 보존된 관측만, 전체 실패율 주장 없음
- **apps/invocations#Q3** [질문] confirm 증명 기한·접수 marker 용량·summary byte·기록 메시지 용량·backoff 값을 얼마로 정할까?
  - 선택지: 실측한 유한값 / 고정 초기값 후 측정
  - 추천: platform/identity와 실측 후 유한값 확정
  - 적용: R5·R8: 제한 및 중복 방지는 적용, 숫자 미정
- **apps/invocations#Q4** [충돌] 기존 confirm R7의 앱 화면 사람 요청 한정과 앱/agent API 호출을 어떻게 맞출까?
  - 선택지: 앱/agent confirm 거절; 인증된 caller와 사람 approval을 별도 기록
  - 추천: user/app/agent caller를 유지하고 정확한 사람 approval을 같은 accepted/proof로 한 번 사용
  - 적용: 기존 R7 보존; R17·R18 및 domain/architecture의 caller 결속 적용
  - 근거: docs/requirements/apps/invocations.md#R7; docs/intent/apps.md#I11

### apps/permissions

- **apps/permissions#Q1** [질문] 앱이 선언한 channel로 직접 notification을 보내는 permission을 첫 판에 넣을까?
  - 선택지: 없음; 별도 notification permission
  - 추천: platform/notifications의 platform/notifications 계기만 쓰고 앱 notification permission은 넣지 않는다.
  - 적용: 첫 판 제외
- **apps/permissions#Q2** [충돌] network wildcard와 port 0 및 host만의 grant를 유지할까 좁은 domain model을 따를까?
  - 선택지: 이전 wildcard·동적 port; 정확한 host와 1~65535 port
  - 추천: 현재 domain model의 wildcard·port 0 금지를 적용한다.
  - 적용: wildcard와 port 0 금지
- **apps/permissions#Q3** [충돌] loopback 주소 정규화에서 중복을 제거할까 중복 선언을 거절할까?
  - 선택지: 이전 중복 제거; 현재 중복 거절
  - 추천: 현재 정규 범위의 중복 거절
  - 적용: 중복 거절
- **apps/permissions#Q4** [충돌] 앱 소유 secret의 무승인 생성·조회·변경·삭제 통로를 유지할까?
  - 선택지: 옛 앱 소유 secret; 사람 관리와 호출별 확인만
  - 추천: 현재 사람 관리·이름 grant·호출별 확인을 적용한다.
  - 적용: 앱 소유 무승인 secret 제외
- **apps/permissions#Q5** [질문] symlink 교체 공격 저항과 OS별 추가 보안 경계를 어느 수준까지 제공할까?
  - 선택지: Deno 한계 공개; 실제 OS별 추가 격리
  - 추천: 현재 한계를 명시하고 OS별 실제 테스트 결과로 추가 경계를 정한다.
  - 적용: 한계 공개와 실제 경로 검사
- **apps/permissions#Q6** [충돌] 기존 external command의 일괄 확인 문구를 effect와 독립인 confirm 계약으로 바꿀까?
  - 선택지: external은 항상 확인; confirm만 확인
  - 추천: apps/invocations과 추가 지시의 confirm 독립 계약을 적용한다.
  - 적용: external만으로 approval 요구하지 않음
- **apps/permissions#Q7** [질문] network 방향 정책을 OS 제한과 플랫폼 전송부에 어떻게 나눌까?
  - 선택지: OS별 방향 제한; 플랫폼 전송부; 표현 불가 요청 거절
  - 추천: 넓은 Deno flag로 우회하지 않고 표현 불가 요청은 거절한다.
  - 적용: 표현 불가 요청 거절
- **apps/permissions#Q8** [질문] 정함: secret 원값을 앱에 줄까 플랫폼 전송부가 인증만 대신할까?
  - 선택지: 확인된 문맥에 원값 전달; 플랫폼 인증 전달
  - 추천: 앱 코드에 원값을 주지 않는 플랫폼 인증 전달
  - 적용: 정함: secret 값은 앱 코드와 agent에 주지 않고 lophn 전송부가 보낼 때 붙임; 인증 부착 방식·schema는 check/apps#Q2 및 apps/permissions 후속 질문으로 남김
  - 결정: 최근 결정 4: secret 값은 앱 코드와 agent에 주지 않고 전송 직전 lophn이 붙임; 인증 부착 방식·schema는 별도 후속 질문
- **apps/permissions#Q9** [질문] agent가 앱 command를 쓰게 여는 허락을 어디에 둘까?
  - 선택지: 앱 화면 열기와 동일; 기존 Grant의 agent.commands; 별도 AgentGrant entity
  - 추천: 앱별 정확한 command 목록을 기존 Grant로 열고 역할/assignment 범위와 교차하기
  - 적용: Grant kind=agent.commands 및 허락/회수 user·시각 적용
  - 근거: docs/intent/apps.md#I11; docs/intent/lophn-agent/harness.md#I9

### apps/preview

- **apps/preview#Q1** [충돌] 이전 source 직접 실행과 현재 완성된 고정 bundle 실행 중 무엇을 preview 대상으로 할까?
  - 선택지: source readonly 직접 실행 / 고정 bundle 별도 실행
  - 추천: 현재 고정 bundle
  - 적용: R1·R2: 고정 bundle

### apps/registration

- **apps/registration#Q1** [질문] 앱 slug 변경 때 관리 폴더와 외부 source를 어디까지 이동할까?
  - 선택지: 주소만 변경; 관리 폴더만 이동; 외부 source도 이동
  - 추천: 외부 source는 이동하지 않고 주소 변경은 documents/addressing을 따른다.
  - 적용: source 연결 변경이 운영 내용을 바꾸지 않음

### apps/releases

- **apps/releases#Q1** [질문] machine 생성물 변경 거절과 설계 변경 경고를 어디서 어떤 대상으로 검사할까?
  - 선택지: release 준비; app test runner; 안내만
  - 추천: 실제 변경 거절은 app test와 release 준비 경계에서 하고 지침은 coding-agent/guides에 둔다.
- **apps/releases#Q2** [질문] H2: coding agent의 모든 activation도 매번 사람이 승인할까?
  - 선택지: 모든 activation 승인; 새 permission·migration 등 특정 변화만 승인
  - 추천: 모든 activation에 승인 요구
  - 적용: 모든 activation 승인
- **apps/releases#Q3** [질문] 현재 데이터와 다른 schema의 이전 release를 어디까지 허용할까?
  - 선택지: 같은 schema만; 실제 테스트한 호환 범위; 별도 데이터 restore
  - 추천: 같은 schema만 바로 허용하고 restore는 apps/data로 구별한다.
  - 적용: 같은 schema만 바로 허용
- **apps/releases#Q4** [질문] 앱 health의 정상 신호·주기 metric·비교 조건과 상태 점검 선언을 지원할까?
  - 선택지: 문제 보고만; 별도 정상 신호와 점검 선언
  - 추천: 이번에 정하지 않고 시작 준비 확인과 업무 정상을 구별한다.
- **apps/releases#Q5** [질문] release 준비의 바이트·파일 수·시간 상한을 얼마로 정할까?
  - 선택지: 고정 값; 앱별 설정; 실제 bundle 측정 뒤 결정
  - 추천: 실제 앱 bundle을 측정해 상한을 정하며 무제한 준비는 허용하지 않는다.
  - 적용: 상한과 취소 적용, 숫자는 미정

### apps/runtime

- **apps/runtime#Q1** [질문] H6: 앱 runtime의 Deno 기술 선택을 유지할까?
  - 선택지: Deno 유지; 다른 runtime
  - 추천: Deno 유지를 적용하고 배포 포함은 platform/install-and-update, TypeScript 공통 SDK·템플릿 계약은 apps/sdk를 따른다.
  - 적용: Deno 실행 요구 유지
- **apps/runtime#Q2** [질문] 지원 OS별 CPU·RSS·disk 한도와 추가 격리 수준을 어떻게 정할까?
  - 선택지: Deno 한계 공개와 실측; cgroup·ulimit 등 실제 OS 제한; 필요한 앱만 추가 격리
  - 추천: 실제 앱 수별 RSS/PSS·CPU·기동 시간을 먼저 측정하고 검증된 OS 제한만 지원한다.
  - 적용: 실제 측정과 한계 공개
- **apps/runtime#Q3** [질문] 앱 GUI는 앱 프로세스가 serve할까 플랫폼이 정적 bundle을 serve할까?
  - 선택지: 앱 프로세스 local HTTP; 플랫폼 정적 serving
  - 추천: 앱 프로세스의 local HTTP 유지
  - 적용: 앱 프로세스 local HTTP
- **apps/runtime#Q4** [질문] subprocess가 반드시 필요한 사용자 앱을 이번 범위에서 지원할까?
  - 선택지: 현재 금지; 실제 필요 앱에만 별도 격리 구현
  - 추천: 현재 금지하고 미래 container 교체 자리만 미리 만들지 않는다.
  - 적용: subprocess 금지
- **apps/runtime#Q5** [충돌] 시작 timeout·종료 유예·재시작 값은 이전 숫자를 유지할까 OS별 실측 뒤 확정할까?
  - 선택지: 30초·10초·1초부터 최대 5분과 10분 안 5회 초과 유지; OS별 측정 뒤 변경
  - 추천: 이전 숫자를 요구로 유지하고 OS 테스트로 조정한다.
  - 적용: 이전 숫자 유지
- **apps/runtime#Q6** [질문] 한 앱이 다른 앱 command를 부르는 앱 사이 연결을 지원할까?
  - 선택지: 지원하지 않음; read command부터; write와 external까지
  - 추천: 이번에는 지원과 권한·위임 계약을 확정하지 않는다.
- **apps/runtime#Q7** [질문] Windows에서도 두 로컬 통로를 Unix socket으로 제공할까 OS별 transport를 둘까?
  - 선택지: Unix socket 지원 검증; OS별 local IPC
  - 추천: 같은 direct call·사용자 전용 계약을 지키는 OS별 실측으로 결정한다.
  - 적용: Linux local socket 계약
- **apps/runtime#Q8** [충돌] 기존 apps/runtime Q6의 앱 사이 연결 지원 여부와 확정 intent를 어떻게 맞출까?
  - 선택지: 미지원 유지; blueprint command 직접 호출 지원
  - 추천: 확정 intent에 따라 apps/connections로 지원하되 기존 질문 번호와 요구는 보존
  - 적용: R30과 앱 쌍 direct 연결 적용; 기존 Q6 보존
  - 근거: docs/requirements/apps/runtime.md#Q6; docs/intent/apps.md#I11

### apps/sdk

- **apps/sdk#Q1** [질문] 개인 Package 등록·승격·2개 사용처·도메인 이름·입출력·추출 뒤 정상 확인과 patch/minor 묶음·major 앱별 전파 계약을 도입할까?
  - 선택지: 설치 제공 Package만 / 개인 등록과 검사 / 승격·전파 workflow
  - 추천: 설치 제공만, 실제 2개 앱 재사용 뒤 별도 결정
  - 적용: R6·R13·R36: 설치 제공만
- **apps/sdk#Q2** [질문] 앱 UI SDK를 React로 고정할까 Web Components로 만들까?
  - 선택지: React / Web Components
  - 추천: 기존 React 유지
  - 적용: R1·R17·R33: React
- **apps/sdk#Q3** [질문] SDK registry 전체 git 관리를 제공할까 플랫폼 export로 backup과 이전을 보장할까?
  - 선택지: git registry / blob+ledger export
  - 추천: platform/backup-and-migration의 export로 통합
- **apps/sdk#Q4** [질문] SDK 공개 type와 입력·출력 호환 비교를 개발 검사에 둘까 제품 등록에도 둘까?
  - 선택지: 설치 SDK 개발 테스트 / 제품 공개 검사
  - 추천: 개발 테스트에서 type와 입력·출력·unknown-field policy를 검사
  - 적용: R12: SemVer 의미만 적용, 검사 제품화 없음
- **apps/sdk#Q5** [질문] 공개 slot 교체와 props/major 불일치시 해당 slot fallback을 첫 판에 제공할까?
  - 선택지: 첫 판 없음 / 명시 공개 slot만
  - 추천: 첫 판 없음, shell/design-system과 실제 사례 뒤 결정
- **apps/sdk#Q6** [질문] platform/notifications 표 밖 앱 notification을 위한 @lophn/cap-notify를 제공할까?
  - 선택지: platform/notifications 표만 / 앱 notification도 추가
  - 추천: platform/notifications 표만
  - 적용: R4: cap-notify 제공 제외
- **apps/sdk#Q7** [질문] 2 major 뒤처짐 주간 보고와 이름·prop 유사 component 경고를 제공할까?
  - 선택지: 첫 판 없음 / Operator 요청 보고 / 자동 경고
  - 추천: 첫 판 자동 경고 없음, 요청된 Operator 보고로 사례 확인
- **apps/sdk#Q8** [질문] Deno의 lophn-sdk 해석은 파일 경로 치환과 로컬 registry server 중 무엇을 쓸까?
  - 선택지: import map 파일 경로 치환 / 로컬 registry server
  - 추천: 개발 때 로컬 파일 경로 치환, 운영은 고정 bundle
  - 적용: R7·R10: 정확한 version 및 운영 bundle
- **apps/sdk#Q9** [질문] 약 1.9MB font를 release마다 포함할까 desktop 공유를 쓸까?
  - 선택지: release 독립 font / desktop 공유
  - 추천: release 독립 font로 재현성 우선
- **apps/sdk#Q10** [질문] 새 보고 모델에서 표본 evidence hook을 첫 판에 제공할까?
  - 선택지: report만 / 제한된 표본 hook
  - 추천: problems/snapshots와 크기·권한 계약 후 제한된 hook
  - 적용: R26·R27: report·문맥·예외 수집만, 표본 없음
- **apps/sdk#Q11** [충돌] 이전 설치 SDK directory 직접 읽기와 현재 운영 bundle에 포함한 고정 byte 중 어느 것을 유지할까?
  - 선택지: registry 해당 version directory만 읽기 / release 고정 bundle
  - 추천: 현재 domain-model의 bundle
  - 적용: R10: 고정 bundle
- **apps/sdk#Q12** [질문] 초기 SDK 공개 version은 새 1.0.0으로 시작하고 과거 공개 version을 재사용하지 않을까?
  - 선택지: 과거 version byte 그대로 보존 / 새 1.0.0 / 새로운 별도 이름
  - 추천: 이전 이름 유지, 새 API는 1.0.0, 과거 byte로 가장하지 않음
  - 적용: R4: 해당 제공 이름의 1.0.0; format 목록은 documents/formats
- **apps/sdk#Q13** [충돌] 모든 앱 템플릿의 초기 migration 의무와 DB 미사용 앱의 schema 0 허용을 어떻게 맞출까?
  - 선택지: 항상 migration / DB 사용 템플릿만 migration
  - 추천: DB 사용 시만 migration
  - 적용: R33: DB 사용 시 migration
- **apps/sdk#Q14** [질문] 패널·카드 반응형 기본 지원 폭은 얼마로 할까?
  - 선택지: 고정 전체 화면 축소; 패널 320px·카드 240px container; 앱마다 자유
  - 추천: container resize 기반으로 패널 320px·카드 240px부터 페이지 가로 scroll 없이 제공
  - 적용: ResponsiveScreenProps와 SDK R37 적용
  - 근거: docs/intent/apps.md#I10; docs/requirements/apps/sdk.md#R37
- **apps/sdk#Q15** [충돌] 기존 버린 것의 첫 판에는 앱 사이 호출이 없다는 문구와 새 앱 command API 약속을 어떻게 맞출까?
  - 선택지: 옛 no-call 유지; cap-read-model 복원; 같은 command client 추가
  - 추천: 옛 read-model Package는 복원하지 않고 cap-schedule에 direct command client를 추가
  - 적용: 기존 버린 것은 보존; R40와 connectAppCommands 및 architecture 현재 계약에 적용
  - 근거: docs/requirements/apps/sdk.md#버린-것; docs/intent/apps.md#I11

### apps

- **architecture/apps#Q1** [질문] Deno가 net.fetch와 net.listen 방향을 구별하지 못할 때 실제 강제를 어떻게 할까?
  - 선택지: 앱 host:port flag만 허용 | 플랫폼 fetch 전송부 + listen OS 제한
  - 추천: fetch는 supervisor 비동기 전송부에서 exact host·port를 검사하고 listen은 방향 강제 OS 어댑터 검증 전 거절
  - 적용: 예: 외부 net flag 없이 broker fetch, 검증되지 않은 listen은 거절
  - 근거: apps/permissions#R11; apps/permissions domain 정책 강제; legacy packages/runtime/flags.ts
- **architecture/apps#Q2** [질문] 정함: secret 원값을 앱에 전달할까 인증만 플랫폼이 대신할까?
  - 선택지: 원값 앱 전달 | 플랫폼 인증 전송
  - 추천: 플랫폼 인증 전송: exact confirm 문맥·목적지를 검사하고 원값은 앱 코드에 반환하지 않음
  - 적용: 예: broker secrets/use와 플랫폼 전송부; 원값 임의 계산은 미지원
  - 근거: apps/permissions#R14~R16; apps/permissions domain SecretUseContext·정할 것
  - 결정: 최근 결정 4: secret 원값 앱 전달 대신 플랫폼 인증 전송
- **architecture/apps#Q3** [질문] release 준비의 바이트·파일 수·시간 기본 상한은 얼마로 할까?
  - 선택지: 실측까지 미정 | 이전 64MiB 기반 유한 기본값
  - 추천: 입력 source 64MiB·완성 bundle 256MiB·10000파일·300000ms로 시작하고 설치 테스트로 확인
  - 적용: 예: 준비 취소와 상한 검사 설계
  - 근거: apps/releases#R3; apps/releases#Q5; legacy packages/runtime/release_prepare.ts MAX_CODE_BYTES
- **architecture/apps#Q4** [질문] confirm marker와 후행 invocation 전달 목록·summary·backoff 수치는 얼마로 할까?
  - 선택지: 미정 | 유한 메모리 기본값 | durable outbox
  - 추천: marker 프로세스당 4096개, 전달 4096 메시지 또는 8MiB·summary 16KiB·1s부터 30s backoff; durable outbox 없음
  - 적용: 예: invocation 전달에 기본값 적용
  - 근거: apps/invocations#R5; apps/invocations#Q3; apps/invocations domain 전달 정책
- **architecture/apps#Q5** [질문] 앱 안 automation clock을 유지하며 전체 동시 한도 4개를 어떻게 보장할까?
  - 선택지: 앱마다 4개 | supervisor 공유 실행 scheduler | supervisor 비대기 메모리 permit
  - 추천: clock과 handler는 앱 안, 전체 permit만 supervisor; 대기 없이 skip·실제 종료에 반환
  - 적용: 예: clock 구현과 broker try_acquire/release
  - 근거: apps/automations#R6; apps/automations domain AutomationClock·통로 정책
- **architecture/apps#Q6** [질문] 운영 화면은 앱 프로세스가 serve할까 별도 정적 플랫폼 server가 serve할까?
  - 선택지: 앱 socket serve | 플랫폼 정적 server
  - 추천: bundle의 완성 화면 byte를 앱 socket으로 serve하고 Electron main이 direct 조회
  - 적용: 예: screens 경로와 app 화면 서버
  - 근거: apps/runtime#R5·R10; apps/runtime#Q3; legacy docs/architecture/runtime.md 6.1
- **architecture/apps#Q7** [질문] lophn-sdk scheme을 운영에서 어떻게 해석할까?
  - 선택지: 로컬 registry server | bundle 내부 file import map
  - 추천: 준비 때 공개 hash 검사 후 bundle 내부 상대 file import map으로 치환
  - 적용: 예: SDK 정규 의존과 no-download 실행
  - 근거: apps/sdk#R7·R10; apps/sdk#Q8; apps/sdk domain runtime 고정
- **architecture/apps#Q8** [충돌] bundle에 실제 test result를 넣으면서 동일 bundle hash를 test한 결과를 요구하면 hash 순환이 생기는가?
  - 선택지: test 결과를 bundle byte에 넣기 | Release의 불변 test 참조로 고정
  - 추천: bundle byte 완성 후 test하고 실제 Verification은 Release.tests와 release_tests에 불변 참조; bundle byte는 test 뒤 변경하지 않음
  - 적용: 예: 현재 domain model의 Release.tests 적용
  - 근거: apps/releases#R1·R5; apps/releases domain BundleManifest·Release.tests
- **architecture/apps#Q9** [질문] Windows에서 고정 Deno의 Unix socket HTTP가 모든 지원 설치에서 가능한가?
  - 선택지: AF_UNIX 직접 지원 검증 | 사용자 ACL named pipe 어댑터 | loopback TCP + connection credential
  - 추천: AF_UNIX 우선 설치 테스트, 미지원 때 같은 HTTP 메시지와 credential 검증의 사용자 전용 ACL named pipe 어댑터; 검증 전 unavailable
  - 적용: 예: 프로세스 절에 지원 테스트와 named pipe 추천 기재; 구현 지원 여부는 아직 검증 안 함
  - 근거: platform/install-and-update#R1; apps/runtime#R5; apps/runtime#Q7; legacy packages/runtime/sockets.ts
- **check/apps#Q1** [충돌] 정함: SecretUseContext가 confirm=true와 필수 ledger invocation을 요구해 grant 기반 secret 사용 및 성공 일반 read 무기록 계약과 충돌한다.
  - 선택지: grant와 실제 command 검사 | confirm 전용 사용
  - 추천: secret 권한과 command confirm을 분리하고 알려진 invocation 참조는 선택 값으로 둔다.
  - 적용: 고침: permissions model의 command·input_hash·선택 invocation·실제 destination과 net.fetch host·port 검사를 정리함
  - 근거: apps#I7; apps/permissions#R14; apps/invocations#R2; domain-model/apps/permissions
  - 결정: 최근 결정 4: 앱 grant가 secret 허락이고 command confirm과 독립
- **check/apps#Q2** [충돌] 정함: permissions model의 시작 코드 secret 사용과 준비 모드 금지가 겹치고 원값 반환이 열린 선택으로 남았다.
  - 선택지: 준비 모드 금지와 플랫폼 전송 | 원값 반환
  - 추천: 준비 코드에는 live secret 문맥이 없고 운영 command에서 플랫폼이 전송 직전 붙인다.
  - 적용: 고침: 준비 모드 경계와 원값 반환 금지를 명시하고 인증 부착 schema만 후속 결정으로 남김
  - 근거: apps#I7; apps/permissions#R15; domain-model/apps/permissions
  - 결정: 최근 결정 4: 운영 command 전송 직전 부착·원값 미전달; 인증 부착 schema는 후속 질문으로 유지
- **check/apps#Q3** [충돌] 정함: architecture가 secret command의 automation 선언·실행을 금지한다.
  - 선택지: granted read/write 허용 | secret 일괄 금지
  - 추천: external·confirm만 금지하고 secret은 선언 이름∩grant·실제 network 범위를 검사한다.
  - 적용: 고침: architecture automation 정책의 secret 금지를 제거함
  - 근거: apps/automations#R13; apps#I7; architecture/apps#2.4
  - 결정: 최근 결정 4·6: secret 사용 자체로 automation을 막지 않고 external·confirm만 금지
- **check/apps#Q4** [충돌] releases R1이 test result를 이미 고정한 bundle 안에 넣어 R5의 같은 완성 bundle hash 테스트와 순환한다.
  - 선택지: 불변 Release 참조 | bundle에 결과 주입
  - 추천: test result는 release의 불변 참조이며 테스트 뒤 bundle byte를 바꾸지 않는다.
  - 적용: 고침: releases R1을 불변 test result 참조로 정리하고 releases model 준비 정책에도 연결함
  - 근거: apps/releases#R1; apps/releases#R5; domain-model/apps/releases; architecture/apps#3.2
- **check/apps#Q5** [충돌] invocations R14에 intent 연결이 없다.
  - 선택지: apps I5 연결 | 미연결
  - 추천: 읽기 결과의 관측 의미와 이어 읽기 정합성은 apps I5를 따른다.
  - 적용: 고침: invocations R14에 apps#I5 intent 줄 추가
  - 근거: apps/invocations#R14; apps#I5
- **check/apps#Q6** [충돌] automations model이 1초 검사·전체 동시 한도 4·10분 timeout·실행 시 external/confirm 금지를 충분히 받치지 않는다.
  - 선택지: 요구 기본값 명시 | 별도 model 값
  - 추천: 요구와 architecture의 단조 시계·비대기 permit·실제 종료 반환을 동일하게 연결한다.
  - 적용: 고침: automations model 계기·비중첩·실패·권한 정책 보강
  - 근거: apps/automations#R3; apps/automations#R6; apps/automations#R9; apps/automations#R13; architecture/apps#2.4
- **check/apps#Q7** [충돌] preview model에 실제 confirm handler·approval 소비와 다른 앱·loopback·문서 저장 금지가 빠졌다.
  - 선택지: 대역만 허용 | 운영 경로 재사용
  - 추천: preview는 실제 효과와 approval 소비를 하지 않고 없는 preview를 운영 앱으로 대체하지 않는다.
  - 적용: 고침: preview model의 분리·결정 정책을 requirements와 architecture에 맞춤
  - 근거: apps/preview; domain-model/apps/preview; architecture/apps#7.5
- **check/apps#Q8** [충돌] runtime model과 direct invoke 입력이 release 없는 preview에도 필수 rel ID를 요구한다.
  - 선택지: live 필수와 preview 선택 release | 가짜 release 생성
  - 추천: PreviewInput의 bundle_hash에 결속하고 live release만 필수로 한다.
  - 적용: 고침: RuntimeObservation·AppConnection·ReadyAttestation·직접 호출 입력의 release 선택성과 bundle/schema 결속을 정리함
  - 근거: apps/preview; domain-model/apps/preview; domain-model/apps/runtime; architecture/apps#5.1
- **check/apps#Q9** [충돌] runtime model의 정할 것과 Q5가 이미 R2·R15·R19로 정한 기본값을 전부 미정으로 되돌린다.
  - 선택지: 기본값 유지 후 OS 조정 | 미정
  - 추천: 시작 30초·종료 유예 10초·1/2/4초 최대 5분 backoff·10분 5회 초과 종료 정책을 명시한다.
  - 적용: 고침: runtime model 시작·멈춤·재시작·idle 정책과 후속 질문 범위를 맞춤
  - 근거: apps/runtime#R2; apps/runtime#R15; apps/runtime#R19; apps/runtime#R20; apps/runtime#Q5
- **check/apps#Q10** [충돌] 여러 apps requirements의 버린 것과 runtime Q6가 현재 지원하는 앱 사이 command 호출을 없거나 미정이라고 한다.
  - 선택지: 현재 connections 계약 | 과거 read model 복원
  - 추천: 앱 사이 command 호출 지원과 과거 read model·provider export 폐기를 구분한다.
  - 적용: 고침: automations·sdk·blueprint·permissions·releases의 버린 것과 runtime Q6를 apps/connections에 맞춤
  - 근거: apps#I11; apps/connections; apps/runtime#R30; apps/sdk#R40; apps/permissions#R26
- **check/apps#Q11** [충돌] permissions Q6·Q8이 최근 사람이 정한 독립 confirm과 원값 미전달을 다시 선택지로 내놓는다.
  - 선택지: 결정 유지와 인증 방식 질문 | 결정 재개방
  - 추천: effect·confirm 독립과 grant 기반 secret 사용은 유지하고 요청 schema만 후속 질문으로 둔다.
  - 적용: 고침: permissions Q6을 정리됨으로 표시하고 Q8을 인증 부착 방식·schema 질문으로 좁힘
  - 근거: apps#I7; apps/blueprint#R4; apps/blueprint#R6; apps/permissions#R14
- **check/apps#Q12** [충돌] SDK Package에 R2의 한 종류 필드가 없고 설치 권한·초기 version·SemVer·trace·조건부 migration이 하위 model에 빠졌다.
  - 선택지: model 필드·정책 보강 | 요구 축소
  - 추천: Package.kind와 command/event 계약을 연결하고 확정 요구를 model에 반영한다.
  - 적용: 고침: sdk model kind·등록 입력/event·0444/0555·1.0.0·SemVer·64자 trace·Deno 2.9 테스트·DB 사용 때만 migration을 명시함
  - 근거: apps/sdk#R2; apps/sdk#R4; apps/sdk#R9; apps/sdk#R12; apps/sdk#R28; apps/sdk#R33; domain-model/apps/sdk
- **check/apps#Q13** [충돌] data model이 기본 backup 보존 5개와 진행 복원 참조 보호를 명시하지 않는다.
  - 선택지: 요구 보존 정책 반영 | model 별도 값
  - 추천: 진행 복원에 필요한 backup은 최근 5개 기본 한도와 별개로 보호한다.
  - 적용: 고침: data model 보존 정책 추가
  - 근거: apps/data#R10; domain-model/apps/data; architecture/apps#3.2
- **check/apps#Q14** [충돌] apps I9의 앱과 데이터 export가 blueprint·이력·DB만 보장하여 실제 실행 bundle과 정확한 SDK byte 반출을 보장하지 않는다.
  - 선택지: 불변 bundle·SDK 포함 | 설명과 DB만 포함
  - 추천: 고정 실행 내용까지 export하고 secret·credential은 제외하며 외부 자료 포함 여부를 명시한다.
  - 적용: 고침: data R13·model export 정책·architecture export를 bundle·SDK byte까지 맞춤
  - 근거: apps#I9; apps/data#R13; domain-model/apps/data; architecture/apps#3.2
- **check/apps#Q15** [충돌] architecture의 release 준비 수치가 requirements에는 상한 미정으로 남아 있다.
  - 선택지: architecture 추천 기본값 요구 연결 | architecture 수치 제거
  - 추천: source 64MiB·bundle 256MiB·10000파일·300000ms 기본값을 요구로 연결하고 실측 조정만 열린 질문으로 둔다.
  - 적용: 고침: releases R19와 model 준비 상한을 추가하고 Q5를 기본값 조정 질문으로 좁힘
  - 근거: architecture/apps#Q3; apps/releases#R3; apps/releases#R19; apps/releases#Q5
- **check/apps#Q16** [충돌] architecture의 confirm marker·후행 전달·summary·backoff 수치가 requirements와 model에서는 전부 미정이다.
  - 선택지: 유한 기본값 요구 연결 | 수치 제거
  - 추천: 4096 marker·4096 메시지/8MiB·16KiB summary·1/2/4초 최대 30초 backoff를 일치시킨다.
  - 적용: 고침: invocations R19와 model 한도·재전송 정책을 연결하고 proof TTL은 platform/identity 후속 질문으로 유지함
  - 근거: architecture/apps#Q4; apps/invocations#R5; apps/invocations#R8; apps/invocations#R19; apps/invocations#Q3
- **check/apps#Q17** [충돌] 공용 UI SDK·앱 템플릿이 shell/wording의 i18n·en-only 계약을 build/test·고정 bundle에 연결하지 않는다.
  - 선택지: 공용 계약 참조 | 앱별 자체 문구 규칙
  - 추천: 전역 규칙은 shell/wording이 소유하고 SDK는 재사용·catalog 고정·검사 연결만 맡는다.
  - 적용: 고침: sdk R41·SharedLocalization 값과 architecture 템플릿에 message key·en catalog·ICU·Intl·placeholder 검사 연결을 추가함
  - 근거: apps#I2; shell#I8; shell#I9; shell/wording#R7; shell/wording#R14; apps/sdk#R41
- **check/apps#Q18** [질문] apps blueprint의 같은 선언 반복 저장에 필요한 (app,key)→Document 대응 정본이 documents/versions model과 architecture에 없다.
  - 선택지: documents의 안정 대응과 원자 저장 | apps 별도 정본
  - 추천: 첫 저장과 안정 대응을 documents/versions가 같은 transaction으로 소유하고 이름 변경·재전송에도 같은 Document를 찾게 한다.
  - 적용: 미적용: documents concern 범위 밖; documents worker 검토 필요
  - 근거: apps/blueprint#R13; domain-model/apps/blueprint#DocumentDeclaration; documents/versions; architecture/documents#5.1
- **check/apps#Q19** [질문] apps I9 export를 사람이 찾고 실행하는 flow가 현재 flow 목록에 없다.
  - 선택지: 독립 export-app flow | 기존 flow에 export 연결
  - 추천: export 대상·포함/제외·일관된 사본 준비·파일 저장·실패/취소를 다루는 flow를 연결하고 불필요한 내부 개념은 숨긴다.
  - 적용: 미적용: flow·screen은 맡은 범위 밖; flow worker 검토 필요
  - 근거: apps#I9; apps/data#R13; docs/flows; shell#I8; shell#I9

### apps/agent-context

- **apps/agent-context#Q1** [질문] context command 이름과 화면 주석 입력을 어떻게 정할까?
  - 선택지: 예약된 이름; 앱 command key를 선언에서 참조; 별도 DOM API
  - 추천: 예약 이름 없이 read_command와 target의 write_command를 참조하고 view_session·revision으로 현재 화면에 묶기
  - 적용: AgentContextDeclaration·AppScreenContext·AnnotationWriteInput 적용
  - 근거: docs/intent/apps.md#I12; docs/intent/lophn-agent.md#I11
- **apps/agent-context#Q2** [질문] turn에 넣는 앱 상태 요약의 상한은 얼마로 할까?
  - 선택지: 전체 화면 상태; UTF-8 2KiB 요약과 상세 tool; UTF-8 8KiB 요약
  - 추천: redaction 뒤 2048byte 이하 요약만 넣고 상세는 같은 read command로 조회
  - 적용: summary 최대 2048byte 적용
  - 근거: docs/intent/lophn-agent/harness.md#I10; docs/requirements/apps/agent-context.md#R3

### apps/connections

- **apps/connections#Q1** [질문] 앱 쌍 한 번 허락의 command 범위를 어떻게 보관할까?
  - 선택지: 모든 현재/미래 command; 정확한 command 목록; effect별 범위
  - 추천: 방향 있는 caller/target 앱 쌍의 정확한 command 목록을 기존 Grant에 두고 새 key는 새 허락
  - 적용: Grant app.call scope={app,commands} 적용
  - 근거: docs/intent/apps.md#I4; docs/intent/apps.md#I11; docs/domain-model/apps/permissions.md
- **apps/connections#Q2** [질문] 앱끼리 호출 경로의 순환과 깊이를 어떻게 제한할까?
  - 선택지: 제한 없음; 현재 path 중복 거절 및 최대 8개 앱; 최대 2개 앱
  - 추천: 서명된 현재 path의 중복을 거절하고 최대 8개 앱으로 제한
  - 적용: AppCallOrigin.path와 실행 전 검사 적용
  - 근거: docs/intent/apps.md#I8; docs/requirements/apps/connections.md#R7

## problems (51)

### problems/closing

- **problems/closing#Q1** [질문] 부분 완화와 잔여 문제를 별도 닫힘 사유로 추가할까.
  - 선택지: 4종 유지 / 완화 종료 추가
  - 추천: 문제는 열린 채 잔여 범위·후속 ticket을 설명
  - 적용: 4종 유지; 완화만으로 수리 성공 닫힘 없음
- **problems/closing#Q2** [질문] 조용한 문제를 실행 기회·무보고 기간으로 자동 닫을까.
  - 선택지: 자동 닫힘 없음 / 기회·기간 뒤 recovered
  - 추천: 현 domain model의 자동 닫힘 없음
  - 적용: recovered도 보호된 사람 확인 필수

### problems/feedback

- **problems/feedback#Q1** [질문] 자동 준비한 screenshot과 화면 상태의 기본 포함 범위를 유지할까.
  - 선택지: 모두 자동 저장 / 안전한 상태 기본 선택과 screenshot 미리보기 확인 뒤 선택
  - 추천: 현재 모델의 후자
  - 적용: 안전한 상태만 기본 선택; screenshot은 확인 뒤 선택
- **problems/feedback#Q2** [질문] feedback 원문·metadata·미완료 수 quota를 얼마로 제한할까.
  - 선택지: 앱당·전체 유한 quota / 보고율과 디스크 여유만 제한
  - 추천: 별도 quota가 정해지기 전 보고율 및 자료 한도 적용
  - 적용: 초안은 메모리; 실패 이유와 글 복사 제공
- **problems/feedback#Q3** [충돌] 최근 read command 8개·각 20행/16KiB 및 invocation 10개·오류 20개를 화면 상태에 자동 붙일까.
  - 선택지: 옛 결과 자동 첨부 / 안전한 위치·입력 형태만
  - 추천: 업무 원값 자동 수집을 금지한 현재 모델
  - 적용: 전체 read 결과 자동 복사 없음; 실제 연결을 아는 대상만 표시
- **problems/feedback#Q4** [충돌] 자동 캡처한 screenshot을 사람 선택 없이 첨부하던 규칙을 유지할까.
  - 선택지: 자동 첨부 / redaction 미리보기 확인 후 사람 선택
  - 추천: 현재 problems/feedback 모델의 사람 선택
  - 적용: 버튼 시점 안전 캡처는 유지하되 screenshot은 미리보기 확인 후 선택한 자료만 저장

### problems/grouping

- **problems/grouping#Q1** [질문] 사람의 문제 병합·분리 기능을 추가할까.
  - 선택지: 고정 grouping만 / 근거와 원래 보고 연결을 유지하는 사람 병합·분리
  - 추천: 첫 판은 고정 grouping만
  - 적용: 별도 병합·분리 없음
- **problems/grouping#Q2** [질문] 앱 사이 공통 원인 관계를 사람에게 연결하게 할까.
  - 선택지: 앱별 문제만 / scope를 합치지 않는 참고 연결
  - 추천: 첫 판은 앱별 문제만
  - 적용: 각 앱 보고와 읽기 scope 유지
- **problems/grouping#Q3** [질문] feedback을 기존 문제로 묶는 방식은 사람의 명시적 선택으로 유지할까.
  - 선택지: 매번 새 문제 / 화면·글 자동 묶기 / 사람 선택
  - 추천: 사람 선택
  - 적용: 선택 없으면 새 문제; 선택하면 기존 문제

### problems/problem-codes

- **problems/problem-codes#Q1** [질문] 사람이 조정할 문제에 별도 앱 command·화면 조치 링크를 제공할까.
  - 선택지: 고정 문구만 / 별도 검증된 조치 링크
  - 추천: 첫 판은 고정 문구만
  - 적용: 고정 문구와 고칠 쪽만 제공
- **problems/problem-codes#Q2** [질문] health check와 사용자 label·문제 연결 검사를 별도 기능으로 유지할까.
  - 선택지: 지원 안 함 / 별도 concern으로 health check 지원
  - 추천: 첫 판은 지원하지 않고 선언 보고를 사용
  - 적용: health check 연결과 40자 label 검사 없음
- **problems/problem-codes#Q3** [충돌] 옛 runtime 예약 code 전체와 별도 오탐 code를 필수로 유지할까.
  - 선택지: 옛 예약 code 전체 / 예외·feedback·잘못된 보고 필수 3종
  - 추천: 현재 problems/problem-codes 모델의 필수 3종
  - 적용: 필수 3종만 유지; 별도 오탐 문제 없이 problems/closing의 사람 결정; code 없는 옛 check 호환 경로 버림

### problems/repairs

- **problems/repairs#Q1** [충돌] 앱이 남기던 변경 메모를 코드 수리 기록으로 계속 받을까.
  - 선택지: 앱 변경 메모 수용 / 인증된 coding agent 수리 기록만
  - 추천: 현재 problems/repairs 모델의 coding agent 전용
  - 적용: 앱의 수리 기록 대신 제출 거절; 이전·고친 release와 인증된 작성자·실제 test result 및 요청 출처 보존

### problems/reporting

- **problems/reporting#Q1** [충돌] view의 같은 지문 60초 1회 제한을 서로 다른 발생에도 적용할까.
  - 선택지: 지문별 버림 / 발생 재전송만 중복 제거
  - 추천: 현재 보고 모델의 발생 보존 규칙
  - 적용: 앱당 20개/60,000ms ingress 제한과 동일 발생 재전송만 중복 제거
- **problems/reporting#Q2** [충돌] crash·메모리·command 실패·permission 거절·view load 실패를 별도 예약 problem code로 즉시 추가할까.
  - 선택지: 옛 runtime 예약 분류 모두 / 필수 3종만 유지하고 관측 소유 concern에서 기록
  - 추천: 첫 판은 필수 3종만 유지
  - 적용: 예외는 자동 보고하며 다른 관측은 apps/runtime·apps/invocations·apps/permissions로 참조
- **problems/reporting#Q3** [질문] health check·health 탭과 진단 전용 신호를 유지할까.
  - 선택지: 지원 안 함 / 별도 health concern 지원
  - 추천: 첫 판은 지원하지 않음
  - 적용: 선언 보고와 실제 테스트만 사용
- **problems/reporting#Q4** [질문] 보고 메모리 대기 크기·총 bytes·재전송 횟수·간격을 얼마로 둘까.
  - 선택지: 정해진 유한 상한 / 디스크 대기 추가
  - 추천: 운영 command 재실행 없이 유한 메모리 대기
  - 적용: 수치 미정; 영구 접수와 대기는 구별

### problems/snapshots

- **problems/snapshots#Q1** [질문] snapshot 자료의 사람 전용 명시 삭제와 재전송·재연결 복원 방지를 첫 판에 추가할까.
  - 선택지: 불변 참조 유지 / 별도 삭제와 감사 근거·모든 참조 범위 처리
  - 추천: 첫 판은 자동·명시 삭제 없이 보존; 보안 삭제 예외는 별도 결정
  - 적용: 삭제 기능 없음
- **problems/snapshots#Q2** [질문] 요청할 때만 앱에서 안전한 추가 표본을 받는 기능을 지원할까.
  - 선택지: 현재 snapshot만 / 요청형 안전 표본
  - 추천: 첫 판은 현재 snapshot만
  - 적용: 표본 hook 없음; 후보값은 기본3개·최대5개·문자열64자·표본2KiB·수집10초
- **problems/snapshots#Q3** [질문] 큰 관측 자료의 보존 기간과 앱별·전체 bytes 한도를 어떻게 정할까.
  - 선택지: 영구 보존 / 닫힘 뒤 기간 제한 / 사람 명시 삭제
  - 추천: 현재 모델의 자동 삭제 없는 참조 유지
  - 적용: 첫 판 자동 삭제 없음; 옛 닫힘 후90일·전체256MiB는 검토 후보
- **problems/snapshots#Q4** [질문] 로그 총 bytes·오류 frame 수·전체 수집 timeout·동시 수의 기본값을 얼마로 둘까.
  - 선택지: 실측 후 유한 상한 / 옛 한도 재사용
  - 추천: 실측 후 결정하고 최근30줄만 확정
  - 적용: 기본 로그30줄·stack16KiB; 나머지 수치 미정
- **problems/snapshots#Q5** [충돌] 옛 첨부 90일 자동 삭제를 불변 snapshot 참조 유지보다 우선할까.
  - 선택지: 90일 삭제 / 현재 모델의 자동 삭제 없음
  - 추천: 현재 domain model 우선
  - 적용: 자동 삭제 기간 없음
- **problems/snapshots#Q6** [충돌] 첫3개·최근50개 발생 보존 및 error300자·frame10개·로그 첫10+최근30·줄300자 기본값을 그대로 가져올까.
  - 선택지: 옛 보존·한도표 / 보고 전부 보존과 최근30줄
  - 추천: 현재 model의 보고 불변성과 로그30줄 우선
  - 적용: 발생 삭제 없음; stack16KiB·로그30줄만 확정

### problems/tests

- **problems/tests#Q1** [질문] 앱 runtime별 테스트 진입점과 판정 protocol·format을 무엇으로 지원할까.
  - 선택지: Deno 우선과 구조화 업무 관측 / 다른 runner adapter 추가
  - 추천: Deno 우선; 종료값만으로 reproduction 판정하지 않음
  - 적용: 하나의 test result와 고정 업무 관측 유지; 세부 format 미정
- **problems/tests#Q2** [질문] health check fixture 통과를 별도 필수 검사로 유지할까.
  - 선택지: 지원 안 함 / health concern 결정 뒤 추가
  - 추천: 첫 판은 별도 health check 없음
  - 적용: 선언·예외·feedback 및 실제 테스트만 검사
- **problems/tests#Q3** [질문] 테스트 timeout 기본·상한과 출력·메모리 한도·작업 폴더 보관 기간을 얼마로 둘까.
  - 선택지: 실측 후 유한 기본값 / runtime별 기본값
  - 추천: 실측 후 runtime별 유한 한도
  - 적용: timeout 필수; 정확한 상한과 보관 기간 미정
- **problems/tests#Q4** [충돌] 옛 Deno test의 무제한 allow-read·allow-write·allow-env·allow-net을 유지할까.
  - 선택지: 옛 flags 그대로 / 테스트 범위만 제한
  - 추천: 운영 자원 접근 금지 우선
  - 적용: prompt·전체 권한 금지; 모든 allow 범위 제한

### problems

- **architecture/problems#Q1** [질문] 보고 대기·retry·snapshot timeout의 첫 기본값은 무엇인가
  - 선택지: 무제한 또는 과거 한도표 전체 / 유한 메모리와 신규 기본값
  - 추천: SDK 32개/4MiB, collector 128개/16MiB·동시4, 조립2초, retry3회 250/1000/3000ms
  - 적용: 예
  - 근거: problems/reporting#Q4; problems/snapshots#Q4; domain-model/problems/reporting.md
- **architecture/problems#Q2** [질문] 로그 bytes·오류 frame·snapshot bytes의 첫 기본값은 무엇인가
  - 선택지: 기존 큰 한도표 / 최근30줄을 유지하고 최소 신규 한도
  - 추천: 로그64KiB·frame32·snapshot2359296bytes, 넘친 항목은 실제 이유와 제외
  - 적용: 예
  - 근거: problems/snapshots#R18; domain-model/problems/snapshots.md
- **architecture/problems#Q3** [질문] test runtime·관측 protocol·native test command의 첫 지원 범위는 무엇인가
  - 선택지: 임의 argv/native 지원 / Deno test 진입점과 요청별 harness만
  - 추천: Deno test만 지원하고 app command·화면 fixture를 harness에서 호출; 관측은 kind별 JSON, runner가 실제 lifecycle·약화 검사로 판정
  - 적용: 예
  - 근거: problems/tests#Q1; problems/tests#R14-R16; domain-model/problems/tests.md
- **architecture/problems#Q4** [질문] test 한도와 작업 폴더 보관 기본값은 무엇인가
  - 선택지: 무제한 / 명시된 유한 cap
  - 추천: 동시2·대기16, timeout 필수 최대300초/제안60초, 출력1MiB/side·메모리512MiB/process, 확정 뒤 즉시 정리·미확정 안전 spool 최대24시간 뒤 판정불가 복구
  - 적용: 예
  - 근거: problems/tests#Q3; domain-model/problems/tests.md
- **architecture/problems#Q5** [질문] RequestTest 공통 command 기록에서 접수·시작시도·실제 시작·runner 상실을 어떻게 복구 가능한가
  - 선택지: 별도 test queue entity / platform 공통 command 기록과 감독 lifecycle
  - 추천: 고정 요청·시작시도·runner 식별을 공통 기록, 실제 시작 관측과 감독 lifecycle로 구별; 미확인 시작을 Verification으로 꾸미지 않음
  - 적용: 예
  - 근거: platform/ledger; problems/tests#R1-R4,R17; domain-model/problems/tests.md#정할 것
- **architecture/problems#Q6** [질문] feedback 캡처·비공개 영역·추가 redaction·최종 hash binding을 어떻게 통일하는가
  - 선택지: 페이지 주장 신뢰 / shell main의 동일 캡처 binding을 최종 hash까지 검증
  - 추천: shell 앱 화면 틀의 동일 캡처 binding·관측 시점·선택·최종 안전 이미지 hash를 collector가 검증; 변화·불명은 이미지 제외
  - 적용: 예
  - 근거: problems/feedback#R5-R6; domain-model/problems/feedback.md#정할 것
- **architecture/problems#Q7** [질문] Deno heap 제한이 전체 메모리 제한을 보장하지 않을 때 테스트를 실행할 수 있는가
  - 선택지: heap cap만으로 전체 메모리 한도 주장 / platform process memory 경계 필요
  - 추천: V8 heap256MiB 외 전체 process512MiB는 platform/security 경계로 강제 가능한 환경만 접수; 불가 환경 unavailable
  - 적용: 예
  - 근거: problems/tests#R13-R14; architecture/README.md#A9; domain-model/problems/tests.md
- **check/problems#Q1** [충돌] grouping의 사용자용 상세에 claim을 설명하라는 요구가 화면 원칙의 claim 숨김과 충돌한다.
  - 선택지: claim 필드 공개 / 실제 담당·en 작업 상태만 공개
  - 추천: 실제 담당과 수리 작업 상태만 표시하고 claim·기한·연결 식별자는 숨긴다.
  - 적용: 고침: grouping#R12와 domain model·architecture의 화면 projection; 적용함: screen/app-detail#Q2
  - 근거: problems/grouping#R12; screen/app-detail#Q2; shell/wording#R2,R4,R6
- **check/problems#Q2** [충돌] 앱 선언의 고정 문제 문구에 message key·en 요구가 없고 예약 안내의 domain model 값은 한국어다.
  - 선택지: 원문 문구 유지 / key·en 고정 값
  - 추천: 앱 선언도 key·en을 요구하고 당시 release의 고정 안내를 사용하며 예약 안내를 key·en으로 정의한다.
  - 적용: 고침: problem-codes#R2, ProblemCode.message_key 및 예약 안내 3종; architecture 표시 경계
  - 근거: problems/problem-codes#R2,R4,R6; shell#I9; shell/wording#R1,R7,R9
- **check/problems#Q3** [충돌] RecordReport 모델이 ID 하나라도 다르면 conflict라고 하여 새 발생까지 거절한다.
  - 선택지: 모든 ID 차이 충돌 / 같은 ID의 주체·내용 차이만 충돌
  - 추천: 새 ID는 새 발생으로 접수한다.
  - 적용: 고침: reporting 모델의 동일 ID·principal·hash 조건
  - 근거: problems/reporting#R9,R11; domain-model/problems/reporting.md
- **check/problems#Q4** [충돌] Feedback 모델에 전체 3MiB 전송·PNG header 검사가 없고 캡처 조건에 떠 있는 dialog·가려진 view의 구분이 빠져 있다.
  - 선택지: 부분 검사 / requirements 전체 반영
  - 추천: 전체 전송 한도·PNG header와 modal/overlay 캡처 제외를 반영한다.
  - 적용: 고침: feedback#R5와 모델 정책; child modal·shell overlay 및 app view 유지; view 없는 feedback의 관측 시각도 허용
  - 근거: problems/feedback#R5,R8,R9,R10; 최근 사람 결정 1,2
- **check/problems#Q5** [충돌] 현상이 안 보임 확인은 last Report를 비교해야 하나 UserProblemDecision 입력에 그 필드가 없고 부정 확인 재요청 억제 정책도 없다.
  - 선택지: 암묵 조회 / 보호 화면에 결속한 입력·event 정책
  - 추천: last_report와 현재 활성 release 결속 및 동일 release·근거 부정 확인 뒤 재요청 억제를 정의한다.
  - 적용: 고침: closing 모델의 UserProblemDecision.last_report·release 및 부정 확인 정책
  - 근거: problems/closing#R7,R10,R14; architecture/problems.md#7.6
- **check/problems#Q6** [충돌] 해석 연결은 requirements에서 담당 App Engineer만 허용하나 모델·architecture는 user도 직접 허용한다.
  - 선택지: user 권한 추가 / requirements에 맞춤
  - 추천: 담당 App Engineer만 연결·해제한다.
  - 적용: 고침: LinkProblemInterpretation의 actor와 RPC 권한
  - 근거: problems/grouping#R13; domain-model/problems/grouping.md; architecture/problems.md#5.2
- **check/problems#Q7** [충돌] read 출력 schema 검사를 필수로 요구하지만 apps/blueprint에는 출력 schema가 없고 열린 질문이다.
  - 선택지: 출력 schema 신규 강제 / 현재 입력·효과·grant 계약 검사
  - 추천: 현재 입력 계약·read 상태 불변·automation의 command/input/grant와 external/confirm 금지를 검사한다.
  - 적용: 고침: tests#R9 및 모델·architecture app test; grant된 secret의 read/write 가져오기·동기화 허용
  - 근거: problems/tests#R9; apps/blueprint#Q1; apps/automations#R13; apps#I7; 최근 사람 결정 4,5,6
- **check/problems#Q8** [충돌] migration 2종과 현재 앱 효과·automation 실행 범위의 필수 검사가 tests 모델 정책에 빠져 있다.
  - 선택지: architecture에만 유지 / 모델에 반영
  - 추천: 각 소유 apps concern contract를 가리켜 필수 관측 범위를 정의한다.
  - 적용: 고침: tests 모델의 앱 계약 검사 정책
  - 근거: problems/tests#R8,R9; apps/data; apps/blueprint; apps/automations; apps/permissions
- **check/problems#Q9** [충돌] architecture가 대기·retry·보고 본문 cap을 선택했으나 requirements·모델에는 정할 것으로 남아 있다.
  - 선택지: architecture 전용 규칙 / 요구·모델 연결
  - 추천: 기존 architecture 추천 기본값을 요구·모델에 올리고 유한 수집·retry 약속에 연결한다.
  - 적용: 고침: reporting#R16 및 모델의 대기·본문·retry 정책; architecture 한도 근거
  - 근거: architecture/problems#Q1; problems/reporting#R12,R13; problems#I1,I7
- **check/problems#Q10** [충돌] architecture가 조립 timeout·frame·로그 bytes·snapshot bytes를 정했으나 요구·모델에 근거가 없다.
  - 선택지: architecture 전용 규칙 / 요구·모델 연결
  - 추천: 기존 architecture 추천 기본값을 한도로 채택하며 장기 보존 bytes와 구별한다.
  - 적용: 고침: snapshots#R20 및 모델의 조립·로그 cap; stack 누락·잘림 설명과 로그 수집 시각 필드
  - 근거: architecture/problems#Q2; problems/snapshots#R3,R4,R10,R12,R18; problems#I1,I2
- **check/problems#Q11** [충돌] architecture만 Deno 지원·IPC protocol·실행 한도·spool 정리를 강제하고 tests 요구·모델은 정할 것으로 남아 있다.
  - 선택지: architecture 전용 규칙 / 요구·모델 연결
  - 추천: 기존 추천 Deno/IPC·timeout·동시·출력·메모리·24시간 spool 정책을 채택한다.
  - 적용: 고침: tests#R19-R21 및 모델의 실행 범위·한도·임시 자료 정책, TestMethod timeout 상한
  - 근거: architecture/problems#Q3,Q4,Q7; problems/tests#R13-R17; problems#I4
- **check/problems#Q12** [충돌] tests 모델이 spawn 전에 시작 사실을 기록한다고 하여 실제 시작과 시도를 섞는다.
  - 선택지: 시도=시작 / 시도와 실제 시작 분리
  - 추천: 공통 command의 시작 시도만 먼저 확정하고 runner의 실제 spawn·started_at으로 구별한다.
  - 적용: 고침: tests 모델의 시작과 복구 정책
  - 근거: problems/tests#R1,R4,R17; architecture/problems.md#8
- **check/problems#Q13** [충돌] tests#R18에 intent 연결이 없고 architecture가 leaf를 새 번역어로 적는다.
  - 선택지: 그대로 / 공통 규칙 준수
  - 추천: fixture 검증은 problems#I4에 연결하고 문서 말은 leaf를 쓴다.
  - 적용: 고침: tests#R18 의도 줄 추가; architecture leaf concern 표현
  - 근거: problems#I4; docs/README.md; AGENTS.md
- **check/problems#Q14** [질문] platform의 상시 프로세스 표는 report collector가 없고 test runner는 작업 시 bounded child인데 problems는 둘을 장기 프로세스로 감독한다고 한다.
  - 선택지: platform 배치표에 collector·runner control 등록 / collector·work/closing 반응기를 기존 신뢰 worker에 배치
  - 추천: platform 소유자의 배치 결정을 하나로 맞춰 collector ingress와 상시 work/closing 반응기를 실제 감독하도록 한다.
  - 적용: 미적용: 다른 최상위 process 배치 결정 필요
  - 근거: architecture/platform.md#2; architecture/problems.md#2.1; architecture/README.md#A9,A10
- **check/problems#Q15** [질문] RequestTest는 공통 command 기록으로 요청·시작·runner 상실을 복구하지만 platform/ledger는 불변 CommandResult만 정의하여 단계별 기록 command·조회·보존 schema가 없다.
  - 선택지: 기존 결과 UPDATE / 단계별 고정 key의 별도 command 결과와 감독 lifecycle contract / 별도 TestRequest 모델
  - 추천: 별도 큐를 만들기 전에 platform 소유자가 단계별 불변 command 결과 및 감독 lifecycle 조회 contract를 명시한다.
  - 적용: 미적용: platform command·lifecycle contract 필요; 시작 시도와 실제 시작의 구분은 고침
  - 근거: architecture/problems#Q5; domain-model/platform/ledger.md#CommandResult; domain-model/problems/tests.md#정할 것
- **check/problems#Q16** [질문] process 전체 메모리 512MiB 경계가 테스트 접수 조건이나 platform/security·platform architecture에 OS별 강제 adapter contract가 없다.
  - 선택지: V8 heap만 사용 / OS별 전체 process memory adapter 정의
  - 추천: platform에서 OS별 강제 지원 범위를 정하고 불가 환경에서는 요청을 unavailable로 남긴다.
  - 적용: 미적용: platform 소유자의 OS adapter 결정 필요; problems/tests의 강제 불가 시 미실행 조건은 반영
  - 근거: architecture/problems#Q7; problems/tests#R20; platform/security
- **check/problems#Q17** [질문] problems가 새로 소유한 예약 안내 key·en 값이 app-detail screen의 문구 표에는 없다.
  - 선택지: 소유 concern catalog를 합쳐 검증 / screen 표에 동일 key를 참조
  - 추천: screen 작성자는 problems/problem-codes 소유 catalog를 참조하여 사용자 화면 key 누락 검사에 포함한다.
  - 적용: 미적용: screen은 수정 범위 밖; key·en 소유 정의는 반영
  - 근거: problems/problem-codes#R6; domain-model/problems/problem-codes.md; docs/screens/app-detail.md; shell/wording#R7

## lophn-agent (212)

### lophn-agent/assignments

- **lophn-agent/assignments#Q1** [질문] 반복 실패의 공통 연속 3회를 역할·실패 종류별 기준으로 바꿀까.
  - 선택지: 공통 3회 / 역할별 / 실패 종류별
  - 추천: 실제 기록이 쌓일 때까지 공통 3회 유지
  - 적용: 공통 연속 3회
- **lophn-agent/assignments#Q2** [질문] 보관이 아닌 영구 접근 회수·삭제·일시 unavailable에서 자동 pause와 재개 조건을 어떻게 구분할까.
  - 선택지: 모두 pause / 보관만 pause·나머지 호출 차단 / 영구 회수도 pause
  - 추천: 현재 보관만 pause하고 나머지는 호출 차단, 대상 concern과 분류를 맞춘다
  - 적용: 보관 자동 pause·일시 unavailable 호출 차단
- **redesign/lophn-agent#Q10** [범위] 기존 flows가 role-definition·context Operator·별도 role extension 선택을 쓴다
  - 선택지: flow owner 변경
  - 추천: Preset과 project/app scope 및 LOPHN.md·작업 자리로 전파
  - 적용: 미적용: flow owner 작업 필요
  - 근거: docs/flows/add-agent-extension.md; docs/flows/manage-operator.md; docs/flows/set-up-operator.md; docs/flows/connect-provider.md; docs/flows/manage-provider-accounts.md
- **redesign/lophn-agent#Q25** [질문] lophn-agent/assignments#Q1 반복 실패의 공통 연속 3회를 역할·실패 종류별 기준으로 바꿀까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/assignments.md
- **redesign/lophn-agent#Q26** [질문] lophn-agent/assignments#Q2 보관이 아닌 영구 접근 회수·삭제·일시 unavailable에서 자동 pause와 재개 조건을 어떻게 구분할까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/assignments.md
- **redesign/lophn-agent#Q88** [질문] 반복 실패 공통 3회를 역할별·실패 종류별 값으로 바꿀지는 실제 기록 뒤 정한다. 현재 공통 3회다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/assignments.md
- **redesign/lophn-agent#Q89** [질문] archive가 아닌 일시적 대상 unavailable은 호출을 막지만 자동 pause 사유로 확정하지 않았다. 영구 접근 회수·삭제의 분류와 재개 조건은 대상 concern과 맞춘다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/assignments.md

### lophn-agent/conversation

- **lophn-agent/conversation#Q1** [질문] 반복 실패로 멈춘 assignment에서 진단 전용 제한 모델 세션을 예외로 허용할까.
  - 선택지: 현재 비모델 원인·재개 안내만 / 진단 전용 제한 모델 예외
  - 추천: 모델 호출 차단 유지, 비모델 기록으로 안내
  - 적용: paused assignment 모델 우회 없음
- **redesign/lophn-agent#Q16** [질문] lophn-agent/conversation#Q1 반복 실패로 멈춘 assignment에서 진단 전용 제한 모델 세션을 예외로 허용할까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/conversation.md

### lophn-agent/evaluation

- **lophn-agent/evaluation#Q1** [질문] eval 제한 시간을 실제 model 600초·모델 없는 테스트 120초로 시작할까?
  - 선택지: 초기 600/120초;측정 뒤 설정
  - 추천: 실제 model 600초로 시작하며 모델 없는 120초는 각 concern의 테스트가 정한다.
  - 적용: R24의 600초
- **lophn-agent/evaluation#Q2** [질문] 내용 판정의 24/30 보정 기준을 장기 유지할까?
  - 선택지: 24/30 유지;축별 오판 비용으로 조정
  - 추천: 초기는 24/30을 유지하고 사람 표본의 충족·불충족·근거 부족을 균형 있게 구성한다.
  - 적용: R16의 24/30
- **lophn-agent/evaluation#Q3** [질문] 다섯 제품 신호를 eval에 어디까지 포함할까?
  - 선택지: 역할 판단만;비교 가능한 업무별 다섯 신호
  - 추천: 앱 제작 비용·문제 탐지 지연·수리 중 사람 개입·정보 접근 token·검증된 재료 재사용을 각각 비교하고 종합 점수는 만들지 않는다.
  - 적용: 추가 제품 점수 없음
- **redesign/lophn-agent#Q8** [범위] evaluation 24개 요구를 I1~I8/I1~I3 제품 약속에 연결할 근거가 없다
  - 선택지: 개발 품질 concern; 제품 intent 추가
  - 추천: 기존 평가 contract는 유지하되 허위 intent 링크 제거; owner가 개발 범위를 따로 정함
  - 적용: 적용: evaluation intent 링크 제거; 제품 약속 추가 안 함
  - 근거: docs/requirements/lophn-agent/evaluation.md; docs/domain-model/lophn-agent/evaluation.md; docs/intent/lophn-agent.md; docs/intent/lophn-agent/harness.md
- **redesign/lophn-agent#Q22** [질문] lophn-agent/evaluation#Q1 eval 제한 시간을 실제 model 600초·모델 없는 테스트 120초로 시작할까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/evaluation.md
- **redesign/lophn-agent#Q23** [질문] lophn-agent/evaluation#Q2 내용 판정의 24/30 보정 기준을 장기 유지할까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/evaluation.md
- **redesign/lophn-agent#Q24** [질문] lophn-agent/evaluation#Q3 다섯 제품 신호를 eval에 어디까지 포함할까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/evaluation.md
- **redesign/lophn-agent#Q87** [질문] 개발용 eval 결과·격리 workspace 보존 기간 및 파일 schema version. 제품 trace 보존과 독립적으로 정한다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/evaluation.md

### lophn-agent/extensions

- **lophn-agent/extensions#Q1** [질문] 외부 MCP 자원을 서버 연결 외에 안정된 자원 식별로 구별할까?
  - 선택지: 서버만;서버와 안정된 자원
  - 추천: 서버와 도구는 필수이고 자원 식별은 제공될 때 근거로만 쓴다.
  - 적용: 새 lease·자원 잠금은 없음
- **lophn-agent/extensions#Q2** [질문] 이어 읽기가 없는 MCP의 큰 결과를 보관한 원문에서 다시 읽게 할까?
  - 선택지: 생략 표시만;보호된 원문 주소 읽기
  - 추천: lophn-agent/harness/tools의 생략·출처 표시를 유지하고 보호된 원문 재읽기는 실제 사례로 결정한다.
  - 적용: 추가 재읽기 기능 없음
- **lophn-agent/extensions#Q3** [질문] MCP OAuth에 device code를 추가할까?
  - 선택지: Authorization Code·PKCE·loopback;device code도
  - 추천: 초기에는 브라우저와 loopback만 지원한다.
  - 적용: R16의 브라우저·loopback
- **lophn-agent/extensions#Q4** [질문] 설명·입력·MCP 힌트가 그대로인 서버의 숨은 행동 변경을 어떻게 다룰까?
  - 선택지: 사람 검토와 한계 고지;별도 검증
  - 추천: 사람의 분류 검토를 요구하고 자동 탐지를 약속하지 않는다.
  - 적용: R27~R28의 사람 분류
- **lophn-agent/extensions#Q5** [질문] skill 본문과 MCP 도구 목록의 전체 크기 상한을 얼마로 둘까?
  - 선택지: 고정 숫자;모델별 수용 예산
  - 추천: lophn-agent/harness/prompt-assemble의 수용 예산으로 전체 성공 여부를 판정하고 조용한 부분 성공은 금지한다.
  - 적용: R6·R22의 전체 성공 계약
- **lophn-agent/extensions#Q6** [질문] 역할별 기본 skill 및 Operator의 외부 MCP·skill 선택을 언제 늘릴까?
  - 선택지: 선택 없음;실제 사례별 명시 선택
  - 추천: 역할 concern에서 실제 이름·scope·eval 근거를 정할 때만 늘린다.
  - 적용: lophn-agent/roles/app-engineer·lophn-agent/roles/operator에 위임
  - 후속 기록: 2026-10-04 결정 10으로 preset의 외부 MCP·skill 명시 선택은 허용된다. 역할별 제품 기본 skill의 실제 이름·목록과 검증 contract는 아직 미정이다(redesign/lophn-agent#Q35,#Q93).
- **redesign/lophn-agent#Q30** [질문] lophn-agent/extensions#Q1 외부 MCP 자원을 서버 연결 외에 안정된 자원 식별로 구별할까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/extensions.md
- **redesign/lophn-agent#Q31** [질문] lophn-agent/extensions#Q2 이어 읽기가 없는 MCP의 큰 결과를 보관한 원문에서 다시 읽게 할까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/extensions.md
- **redesign/lophn-agent#Q32** [질문] lophn-agent/extensions#Q3 MCP OAuth에 device code를 추가할까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/extensions.md
- **redesign/lophn-agent#Q33** [질문] lophn-agent/extensions#Q4 설명·입력·MCP 힌트가 그대로인 서버의 숨은 행동 변경을 어떻게 다룰까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/extensions.md
- **redesign/lophn-agent#Q34** [질문] lophn-agent/extensions#Q5 skill 본문과 MCP 도구 목록의 전체 크기 상한을 얼마로 둘까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/extensions.md
- **redesign/lophn-agent#Q35** [질문] lophn-agent/extensions#Q6 역할별 기본 skill 및 Operator의 외부 MCP·skill 선택을 언제 늘릴까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/extensions.md
- **redesign/lophn-agent#Q93** [질문] 외부 tool의 되돌림·결과 조회·idempotency 보장을 검증하는 contract 및 현재 네 역할에 허용할 서버·tool 목록. 설정만으로 기존 역할 범위를 넓히지 않는다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/extensions.md
- **redesign/lophn-agent#Q94** [질문] agent runtime 격리에서 MCP stdio 실행 파일 및 skill 꾸러미 읽기를 허용하는 플랫폼 경계. 무제한 shell·파일 tool로 제공하지 않는다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/extensions.md

### lophn-agent/handoff

- **lophn-agent/handoff#Q1** [질문] 같은 원래 사람 요청의 handoff 순환·총 사슬 길이를 어떻게 제한할까.
  - 선택지: assignment 재방문 금지 / 별도 길이 상한 / 각 run 한도만
  - 추천: 첫 판은 각 run 한도만 적용하고 실제 순환 기록이 생기면 재방문 금지 검토
  - 적용: 별도 handoff 상한 없음, harness/run-loop 한도 적용
- **redesign/lophn-agent#Q21** [질문] lophn-agent/handoff#Q1 같은 원래 사람 요청의 handoff 순환·총 사슬 길이를 어떻게 제한할까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/handoff.md
- **redesign/lophn-agent#Q86** [질문] HandoffContent 각 문자열·목록의 크기 상한. 현재 필수 구조만 정하며 transport·prompt 상한은 → lophn-agent/harness/tools, lophn-agent/harness/prompt-assemble을 따른다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/handoff.md

### lophn-agent/harness/model

- **lophn-agent/harness/model#Q1** [질문] 공개 가격 외 계약 가격을 사람이 별도 출처로 보완할 것인가?
  - 선택지: 공개 가격만 / 계약 가격 보완
  - 추천: 첫 판 공개 가격만
  - 적용: 공개 가격만
- **lophn-agent/harness/model#Q2** [질문] catalog 밖 model의 128,000·8,192 token·tool 지원 가정을 허용할 것인가?
  - 선택지: 임시 가정 / 확인 정보·사람 보완 필수
  - 추천: 확인 정보 또는 사람 명시 정보만
  - 적용: 확인 정보·사람 보완 필수
- **lophn-agent/harness/model#Q3** [질문] 첫 설치의 두 model slot을 어떤 목록·순서로 추천할 것인가?
  - 선택지: 추천 없음 / 실제 품질·지연 eval 기반 추천
  - 추천: 자동 배정 없이 eval 기반 추천
  - 적용: 자동 배정 없음, 추천 순서는 미정
- **lophn-agent/harness/model#Q4** [질문] 2,048·8,192·16,384·32,768 추론 예산이 품질 차이를 만드는가?
  - 선택지: 초기 값 유지 / fixture 비교 뒤 보정
  - 추천: 초기 값 유지 후 lophn-agent/evaluation으로 비교
  - 적용: 초기 값 유지
- **lophn-agent/harness/model#Q5** [질문] 강도·예산·토글을 함께 선언한 model의 추론 선택 우선순위는 무엇인가?
  - 선택지: 강도 우선 / provider별 확인 조합
  - 추천: provider별 확인된 방식 하나만 제공
  - 적용: 확인된 방식 하나만 제공
- **lophn-agent/harness/model#Q6** [질문] 첫 판 model input에 이미지를 포함할 것인가?
  - 선택지: 텍스트만 / 이미지 전처리·크기 계약 완성 뒤 포함
  - 추천: 첫 판 텍스트만
  - 적용: 텍스트만
- **lophn-agent/harness/model#Q7** [질문] 정확한 token 계산을 local tokenizer·provider count API 중 무엇으로 제공할 것인가?
  - 선택지: 검증된 local tokenizer / provider count API / UTF-8 상한
  - 추천: 확인 가능한 계산 우선, 없으면 UTF-8 상한
  - 적용: 정확 계산 또는 UTF-8 상한
- **lophn-agent/harness/model#Q8** [질문] Claude 계열을 기본 추천으로 유지할 것인가?
  - 선택지: Claude 추천 / 실제 품질·지연 eval 기반 추천
  - 추천: provider에 독립적인 eval 기반 추천, 자동 배정 없음
  - 적용: 자동 배정 없음
- **lophn-agent/harness/model#Q9** [질문] 한계를 모르는 model을 사용할 조건은 무엇인가?
  - 선택지: 보수 기본값 / 확인 정보·사람 입력 한계
  - 추천: 확인 정보·사람 입력 한계 필수
  - 적용: 확인 정보·사람 입력 한계 필수
- **redesign/lophn-agent#Q1** [질문] judgment/organizing 공통 설정을 실행 slot으로 유지할까
  - 선택지: 공통 강제 slot; 생성 기본값과 preset별 선택
  - 추천: 생성 기본값만 유지하고 organizing 미선택은 같은 preset model
  - 적용: 적용: ModelDefaults, PresetModelSelection, ResolvedModel
  - 근거: docs/intent/lophn-agent.md#I5; docs/intent/lophn-agent/harness.md#I1; docs/domain-model/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q63** [질문] lophn-agent/harness/model#Q1 공개 가격 외 계약 가격을 사람이 별도 출처로 보완할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q64** [질문] lophn-agent/harness/model#Q2 catalog 밖 model의 128,000·8,192 token·tool 지원 가정을 허용할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q65** [질문] lophn-agent/harness/model#Q3 첫 설치의 두 model 선택을 어떤 목록·순서로 추천할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q66** [질문] lophn-agent/harness/model#Q4 2,048·8,192·16,384·32,768 추론 예산이 품질 차이를 만드는가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q67** [질문] lophn-agent/harness/model#Q5 강도·예산·토글을 함께 선언한 model의 추론 선택 우선순위는 무엇인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q68** [질문] lophn-agent/harness/model#Q6 첫 판 model input에 이미지를 포함할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q69** [질문] lophn-agent/harness/model#Q7 정확한 token 계산을 local tokenizer·provider count API 중 무엇으로 제공할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q70** [질문] lophn-agent/harness/model#Q8 Claude 계열을 기본 추천으로 유지할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q71** [질문] lophn-agent/harness/model#Q9 한계를 모르는 model을 사용할 조건은 무엇인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q101** [질문] catalog 밖 model은 확인된 정보 또는 user 명시 한계만으로 허용한다. user 보완값의 확인 UI·검증 책임 경계.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/harness/model.md
- **redesign/lophn-agent#Q102** [질문] reasoning 인자 및 불투명 필수 상태를 요구하는 provider mode의 실제 지원 범위와 메모리 유실 뒤 연속 호출 복구 가능성은 → lophn-agent/harness/provider의 same-run 상태 정책 안에서 정한다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/harness/model.md

### lophn-agent/harness/prompt-assemble

- **lophn-agent/harness/prompt-assemble#Q1** [질문] lophn 시작 자료에 전체 outline 1,500·context와 place 3,000·문서 outline 2,000 token 별도 상한과 run 끝까지 index 고정을 둘 것인가?
  - 선택지: model 총 예산만 / 세 시작 상한·index 고정
  - 추천: 공통 model 총 예산만, 자료 version은 읽은 근거로 고정
  - 적용: 별도 역할 시작 상한 없음
- **lophn-agent/harness/prompt-assemble#Q2** [질문] App Engineer의 별도 시작 token 예산을 둘 것인가?
  - 선택지: 공통 model 총 예산 / 별도 AE 상한
  - 추천: 공통 model 총 예산
  - 적용: 별도 역할 시작 상한 없음
- **lophn-agent/harness/prompt-assemble#Q3** [질문] 같은 구간의 새 압축은 어떤 명시 변경 뒤 허용할 것인가?
  - 선택지: 사람 요청만 / 다음 run의 변경된 입력·model에서도
  - 추천: 같은 구간 자동 반복 금지, 사람 요청·새 run의 실질 변경에서만 새 시도
  - 적용: 같은 구간 자동 반복 금지
- **lophn-agent/harness/prompt-assemble#Q4** [질문] 70%·50%·25%·2,000~15,000 token 초기 압축값을 유지할 것인가?
  - 선택지: 초기값 유지 / 한글·큰 MCP·작은 창 fixture 뒤 조정
  - 추천: 초기값 유지 후 lophn-agent/evaluation으로 검증
  - 적용: 초기값 유지
- **lophn-agent/harness/prompt-assemble#Q5** [충돌] 정함: 옛 작업 층 순서와 새 domain model의 다섯 층 순서가 일치하지 않는다.
  - 선택지: 옛 공통·역할·작업 구조 / 새 지시·tools·자료·이력·현재 입력 구조
  - 추천: 논리적 공통·역할·작업 구분은 유지하고 새 구조에서 현재 입력 전문을 보호
  - 적용: 공통·역할·작업 구분과 고정 prefix, 현재 입력 보호
  - 결정: 2026-10-04 결정 14: 제품 공통 지시+tool → 역할+preset → 사람 지침 → cache 경계 → 세션 이력·자료·run 사실 → 최신 메시지의 turn 동적 context 순서로 대체한다.
- **lophn-agent/harness/prompt-assemble#Q6** [질문] 매 turn 화면 요약 크기와 층 위치를 어떻게 둘까
  - 선택지: 고정 지시 앞 / history 뒤 독립 turn_context
  - 추천: 고정 prefix 뒤·현재 입력 앞; 총8KiB·20탭·앱요약2KiB; 실제 수집 근거 저장
  - 적용: 추천안 적용
  - 근거: lophn-agent/harness#I10; requirements:lophn-agent/harness/prompt-assemble#R25
- **redesign/lophn-agent#Q36** [질문] lophn-agent/harness/prompt-assemble#Q1 lophn 시작 자료에 전체 outline 1,500·context와 place 3,000·문서 outline 2,000 token 별도 상한과 run 끝까지 index 고정을 둘 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/prompt-assemble.md
- **redesign/lophn-agent#Q37** [질문] lophn-agent/harness/prompt-assemble#Q2 App Engineer의 별도 시작 token 예산을 둘 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/prompt-assemble.md
- **redesign/lophn-agent#Q38** [질문] lophn-agent/harness/prompt-assemble#Q3 같은 구간의 새 압축은 어떤 명시 변경 뒤 허용할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/prompt-assemble.md
- **redesign/lophn-agent#Q39** [질문] lophn-agent/harness/prompt-assemble#Q4 70%·50%·25%·2,000~15,000 token 초기 압축값을 유지할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/prompt-assemble.md
- **redesign/lophn-agent#Q40** [질문] 정함: lophn-agent/harness/prompt-assemble#Q5 옛 작업 층 순서와 새 domain model의 다섯 층 순서가 일치하지 않는다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/prompt-assemble.md
  - 결정: 2026-10-04 결정 14: 새 다섯 층 순서로 확정. lophn-agent/harness/prompt-assemble#Q5 및 architecture/lophn-agent#Q7과 같은 결정이다.

### lophn-agent/harness/provider

- **lophn-agent/harness/provider#Q1** [질문] Claude OAuth가 lophn 식별과 프로필·추론 권한으로 실제 tool call을 받는가?
  - 선택지: 검증 뒤 활성화 / 미허용 경로 제외
  - 추천: 검증 전 비활성, 미허용이면 API key 안내
  - 적용: 검증 뒤 활성화
- **lophn-agent/harness/provider#Q2** [질문] ChatGPT·xAI 제3자 OAuth client 발급과 공식 허용 범위는 무엇인가?
  - 선택지: lophn 전용 발급 / 공개 CLI client 허용 범위 확인
  - 추천: 전용 발급 우선, 허용 범위 확인 전 비활성
  - 적용: 허용 확인 뒤 활성화
- **lophn-agent/harness/provider#Q3** [질문] SuperGrok 표준·Heavy 중 어느 요금제가 OAuth 추론을 받는가?
  - 선택지: 요금제별 검증 / 미검증 비활성
  - 추천: 표준·Heavy 각각 검증하고 X Premium+와 구별
  - 적용: 미검증 비활성
- **lophn-agent/harness/provider#Q4** [질문] Claude·ChatGPT 사용량 조회가 lophn 식별로 허용되며 5시간·7일 창과 정확한 리셋을 주는가?
  - 선택지: 응답 header 우선과 설정 열 때 추가 조회 / 추가 조회 제외
  - 추천: header 우선, 허용된 경우만 설정 열 때 조회, 주기 계정 폴링 없음
  - 적용: header 우선, 미확인 추가 조회 없음
- **lophn-agent/harness/provider#Q5** [질문] 온보딩 건너뛰기와 인증 전 slot 진행 금지를 어떻게 함께 지키는가?
  - 선택지: 준비 화면만 건너뛰고 agent 비활성 / 모든 단계 강제
  - 추천: 무인증 loopback도 준비로 인정하고 건너뛰면 agent 비활성
  - 적용: 화면 건너뛰기·agent 비활성
- **lophn-agent/harness/provider#Q6** [질문] 첫 provider 인증 범위와 안전한 secret 보관 불가 환경은 어떻게 처리하는가?
  - 선택지: 명시 지원 목록 / API key·로컬만; 보관 불가는 platform/secrets 정책
  - 추천: 지원 목록 유지, 보관 불가 처리는 platform/secrets 참조
  - 적용: 지원 목록 유지·platform/secrets 참조
- **lophn-agent/harness/provider#Q7** [충돌] PV-16·PV-18의 버림 판정과 credential 하나 제한이 이번 추가 지시·현재 domain model의 여러 credential 요구와 충돌한다.
  - 선택지: credential 하나 / 여러 credential 순서 선택·같은 provider 안 이동
  - 추천: 이번 추가 지시대로 여러 credential 유지
  - 적용: 여러 credential 유지
- **lophn-agent/harness/provider#Q8** [충돌] PV-25와 초안 domain model의 추론 서명 전면 제외가 충돌했고 현재 provider domain model은 필수 opaque 상태의 비영속 재사용으로 수정되었다.
  - 선택지: 전면 제외 / 본문 제외·필수 opaque 상태만 메모리
  - 추천: 본문 제외·opaque 상태만 비영속 재사용
  - 적용: 현재 provider domain model과 일치: 같은 run·provider·model 메모리만
- **lophn-agent/harness/provider#Q9** [질문] 연결 테스트의 대기 상한과 사용량 기록 용도가 아직 정해지지 않았다.
  - 선택지: 공통 model 시간 한도 / 독립 30초 상한; usage 별도 용도 / provider 결과만
  - 추천: 단발 테스트 30초 상한과 실제 유료 시도 usage 기록
  - 적용: 단발 테스트 30초 상한·실제 호출 usage 기록
- **redesign/lophn-agent#Q2** [질문] 고른 계정에서 자동 credential 이동을 어디까지 허용할까
  - 선택지: 선택 계정 하나; 명시 목록 안; provider 전체
  - 추천: Preset의 명시 순서 목록 안 같은 provider/model만; 하나면 이동 없음
  - 적용: 적용: preset credentials와 provider affinity
  - 근거: docs/domain-model/lophn-agent/presets.md; docs/domain-model/lophn-agent/harness/provider.md
- **redesign/lophn-agent#Q49** [질문] lophn-agent/harness/provider#Q1 Claude OAuth가 lophn 식별과 프로필·추론 권한으로 실제 tool call을 받는가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/provider.md
- **redesign/lophn-agent#Q50** [질문] lophn-agent/harness/provider#Q2 ChatGPT·xAI 제3자 OAuth client 발급과 공식 허용 범위는 무엇인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/provider.md
- **redesign/lophn-agent#Q51** [질문] lophn-agent/harness/provider#Q3 SuperGrok 표준·Heavy 중 어느 요금제가 OAuth 추론을 받는가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/provider.md
- **redesign/lophn-agent#Q52** [질문] lophn-agent/harness/provider#Q4 Claude·ChatGPT 사용량 조회가 lophn 식별로 허용되며 5시간·7일 창과 정확한 리셋을 주는가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/provider.md
- **redesign/lophn-agent#Q53** [질문] lophn-agent/harness/provider#Q5 온보딩 건너뛰기와 인증 전 slot 진행 금지를 어떻게 함께 지키는가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/provider.md
- **redesign/lophn-agent#Q54** [질문] lophn-agent/harness/provider#Q6 첫 provider 인증 범위와 안전한 secret 보관 불가 환경은 어떻게 처리하는가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/provider.md
- **redesign/lophn-agent#Q55** [질문] lophn-agent/harness/provider#Q7 PV-16·PV-18의 버림 판정과 credential 하나 제한이 이번 추가 지시·현재 domain model의 여러 credential 요구와 충돌한다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/provider.md
- **redesign/lophn-agent#Q56** [질문] lophn-agent/harness/provider#Q8 PV-25와 초안 domain model의 추론 서명 전면 제외가 충돌했고 현재 provider domain model은 필수 opaque 상태의 비영속 재사용으로 수정되었다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/provider.md
- **redesign/lophn-agent#Q98** [질문] OAuth 제품별 lophn 사용 허용·실제 호출 검증 결과와 공식 endpoint·client 식별 값. 미검증 정의는 활성화하지 않는다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 현재 보호·기록 contract 유지; 구체 owner 형식은 검토 목록
  - 근거: docs/domain-model/lophn-agent/harness/provider.md
- **redesign/lophn-agent#Q99** [질문] 첫 판의 지원 API key·loopback 연결·검증된 OAuth 조합. keychain 없는 환경 정책은 → platform/secrets.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/harness/provider.md

### lophn-agent/harness/run-loop

- **lophn-agent/harness/run-loop#Q1** [질문] provider 끄기·MCP 연결 제거 때 이미 전송한 요청은 어떻게 처리하는가?
  - 선택지: 새 진입만 금지 / 가능한 진행 요청도 취소
  - 추천: 새 진입 금지·가능하면 취소, 이미 시작한 효과는 불명확 또는 결과 보완
  - 적용: 새 진입 금지·가능하면 취소
- **lophn-agent/harness/run-loop#Q2** [질문] 공통 30회·5분·사람 기다림 제외 30분이 실제 일에 충분한가?
  - 선택지: 초기 공통값 유지 / eval 근거로 조정
  - 추천: 현재 공통값 유지 후 lophn-agent/evaluation으로 검증
  - 적용: 공통 30회·5분·30분
- **lophn-agent/harness/run-loop#Q3** [질문] 세션 입력 수·전체 접수 run 수에 어떤 유한 상한을 둘 것인가?
  - 선택지: 고정 상한 없음 / burst·저장 비용 측정 기반 상한
  - 추천: 측정 후 유한 상한, 초과는 저장 전 명시 거절
  - 적용: 구체 숫자 미정, 받은 입력은 보존
- **lophn-agent/harness/run-loop#Q4** [질문] agent 프로세스를 상시 대기시키거나 요청 때 띄울 것인가?
  - 선택지: 상시 대기 / 요청 시 시작
  - 추천: 동작 계약을 유지하는 요청 시 시작
  - 적용: 미정
- **lophn-agent/harness/run-loop#Q5** [질문] run 시간 한도에 사람 답 기다림을 포함할 것인가?
  - 선택지: 포함 / 제외
  - 추천: 진행 없는 시간·전체 시간 모두 제외
  - 적용: 둘 다 제외
- **lophn-agent/harness/run-loop#Q6** [질문] run 한도·반복 tool 실패 기준을 공통값 또는 역할별로 둘 것인가?
  - 선택지: 공통 수치 / 역할별 수치
  - 추천: 공통 수치
  - 적용: 공통 수치
- **redesign/lophn-agent#Q4** [질문] 진행 Run 중 사람 지침과 작업 자리 변경을 언제 읽을까
  - 선택지: Run 시작 고정; 매 call 현재 판
  - 추천: Preset 구성은 Run 고정, 자리·지침은 매 call 확정 snapshot
  - 적용: 적용: RunBasis.initial_work_place, ContextBasis.instructions/work_place
  - 근거: docs/domain-model/lophn-agent/harness/run-loop.md; docs/domain-model/lophn-agent/harness/prompt-assemble.md
- **redesign/lophn-agent#Q43** [질문] lophn-agent/harness/run-loop#Q1 provider 끄기·MCP 연결 제거 때 이미 전송한 요청은 어떻게 처리하는가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/run-loop.md
- **redesign/lophn-agent#Q44** [질문] lophn-agent/harness/run-loop#Q2 공통 30회·5분·사람 기다림 제외 30분이 실제 일에 충분한가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/run-loop.md
- **redesign/lophn-agent#Q45** [질문] lophn-agent/harness/run-loop#Q3 세션 입력 수·전체 접수 run 수에 어떤 유한 상한을 둘 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/run-loop.md
- **redesign/lophn-agent#Q46** [질문] lophn-agent/harness/run-loop#Q4 agent 프로세스를 상시 대기시키거나 요청 때 띄울 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/run-loop.md
- **redesign/lophn-agent#Q47** [질문] lophn-agent/harness/run-loop#Q5 run 시간 한도에 사람 답 기다림을 포함할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/run-loop.md
- **redesign/lophn-agent#Q48** [질문] lophn-agent/harness/run-loop#Q6 run 한도·반복 tool 실패 기준을 공통값 또는 역할별로 둘 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/run-loop.md
- **redesign/lophn-agent#Q97** [질문] 공통 첫 한도 30회·300000ms·1800000ms 및 사람 기다림 제외를 확정할지, 역할별 한도를 둘지.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/harness/run-loop.md

### lophn-agent/harness/safety

- **lophn-agent/harness/safety#Q1** [질문] 두 요청을 번갈아 성공시키는 무진행 반복도 감지할 것인가?
  - 선택지: 같은 요청 실패만 / 교대 반복·같은 결과 감지
  - 추천: 첫 판 동일 요청 최종 실패만, eval 후 결정적 감지 검토
  - 적용: 동일 요청 실패만
- **lophn-agent/harness/safety#Q2** [질문] model API로 나가는 문서·앱 자료 범위를 사람이 어떻게 통제하는가?
  - 선택지: 현재 assignment scope·최소 자료 / provider별 추가 정책 / 별도 scope 동의
  - 추천: 현재 scope와 최소 자료를 지키고 provider별 추가 통제는 별도 결정
  - 적용: 현재 assignment scope·최소 자료
- **redesign/lophn-agent#Q61** [질문] lophn-agent/harness/safety#Q1 두 요청을 번갈아 성공시키는 무진행 반복도 감지할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/safety.md
- **redesign/lophn-agent#Q62** [질문] lophn-agent/harness/safety#Q2 model API로 나가는 문서·앱 자료 범위를 사람이 어떻게 통제하는가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/safety.md

### lophn-agent/harness/tools

- **lophn-agent/harness/tools#Q1** [질문] 이미지·PDF·표의 원본과 부분 preview를 어떤 크기로 반환할 것인가?
  - 선택지: 추출 텍스트·주소만 / 크기 상한 있는 부분 preview
  - 추천: 첫 판 원본 binary 제외, 추출 텍스트·주소·format·outline만
  - 적용: 원본 binary 제외·범위 확인된 텍스트만
- **lophn-agent/harness/tools#Q2** [충돌] 기존 R8의 앱 command 금지·R5의 순서·R15의 confirm read 후행 기록이 새 앱 tool intent와 충돌한다
  - 선택지: 금지 유지 / 역할별 앱 command 제공
  - 추천: 현재 허락·역할 범위와 effect 판정으로 제공
  - 적용: intent에 맞춰 고침
  - 근거: lophn-agent/harness#I9; requirements:lophn-agent/harness/tools#R8; requirements:lophn-agent/harness/tools#R5; requirements:lophn-agent/harness/tools#R15
- **redesign/lophn-agent#Q41** [질문] lophn-agent/harness/tools#Q1 이미지·PDF·표의 원본과 부분 preview를 어떤 크기로 반환할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/tools.md
- **redesign/lophn-agent#Q95** [질문] 이미지·PDF 등 비텍스트 ToolResult 크기 상한. 안전하게 크기를 검사할 수 없으면 model input에 포함하지 않는다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 현재 보호·기록 contract 유지; 구체 owner 형식은 검토 목록
  - 근거: docs/domain-model/lophn-agent/harness/tools.md

### lophn-agent/harness/usage

- **lophn-agent/harness/usage#Q1** [질문] 비용 표시에 선택 환산을 제공할 것인가?
  - 선택지: 원래 통화만 / 환율 출처·시각을 붙인 선택 환산
  - 추천: 첫 판 원래 통화만
  - 적용: 원래 통화만
- **lophn-agent/harness/usage#Q2** [충돌] credential 이동 요구를 되살림에 따라 사용량 재료의 이동 기록 삭제와 충돌한다.
  - 선택지: 이동 기록 삭제 / 같은 provider 안 이동 기록 유지
  - 추천: 실제 선택 credential·이동 관계·과금 경로 기록
  - 적용: 같은 provider 안 이동 기록 유지
- **lophn-agent/harness/usage#Q3** [충돌] 연결 test 실제 시도는 현 domain model의 세 용도 밖이지만 실제 사용량을 빠짐없이 기록해야 한다.
  - 선택지: provider 결과만 / 연결 test 용도 추가
  - 추천: 실제 시도는 연결 test 용도로 기록
  - 적용: 연결 test 용도 포함
- **redesign/lophn-agent#Q72** [질문] lophn-agent/harness/usage#Q1 비용 표시에 선택 환산을 제공할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/usage.md
- **redesign/lophn-agent#Q103** [질문] 독립 연결 test도 connection_test ModelCall로 실제 시도를 기록한다. 결과 요약·call 연결은 → lophn-agent/harness/provider의 ProviderCheck이며 별도 사용량 정본을 만들지 않는다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 현재 보호·기록 contract 유지; 구체 owner 형식은 검토 목록
  - 근거: docs/domain-model/lophn-agent/harness/usage.md
- **redesign/lophn-agent#Q106** [질문] global 실행 slot 필드를 남기면 Preset 선택 정본과 혼동된다
  - 선택지: slot 필드 유지; 용도 필드
  - 추천: ModelCall.model_use로 judgment/organizing 용도를 기록하고 실제 선택은 preset/CallModel 참조
  - 적용: 적용: usage·architecture
  - 근거: docs/domain-model/lophn-agent/harness/usage.md; docs/requirements/lophn-agent/harness/usage.md; docs/architecture/lophn-agent.md

### lophn-agent/harness/waiting-and-recovery

- **lophn-agent/harness/waiting-and-recovery#Q1** [질문] 재시작 후 대기 approval을 같은 요청으로 이을 것인가?
  - 선택지: 미시작 증거가 있으면 같은 요청 / 항상 새 요청
  - 추천: 현재 요청·미시작 증거를 조회해 유효한 같은 요청 유지
  - 적용: 미시작 증거 있는 같은 요청만 유지
- **lophn-agent/harness/waiting-and-recovery#Q2** [질문] 조회 수단 없는 MCP external 효과의 충돌 보류는 언제 풀 것인가?
  - 선택지: 실제 증거 / 사람의 명시 위험 인수
  - 추천: 실제 효과 증거 전 자동 해제 금지, 별도 장기 lock 없음
  - 적용: 실제 증거 전 충돌 후속 call 금지
- **lophn-agent/harness/waiting-and-recovery#Q3** [질문] 완성 압축 summary와 보호 원문 범위를 복구할 근거는 무엇인가?
  - 선택지: 완성 호출 blob 재사용 / 파생 cache만 사용
  - 추천: 완성 호출 출력과 원문 구간으로 재조립
  - 적용: 완성 호출·원문 구간 재조립
- **lophn-agent/harness/waiting-and-recovery#Q4** [질문] H8 Operator가 질문을 기다리는 동안 주기를 계속 건너뛰는 정책을 유지할 것인가?
  - 선택지: 계속 건너뛰기 / 별도 새 회차 허용
  - 추천: lophn-agent/harness/run-loop과 lophn-agent/scheduling대로 계속 건너뛰기
  - 적용: 계속 건너뛰기
- **redesign/lophn-agent#Q57** [질문] lophn-agent/harness/waiting-and-recovery#Q1 재시작 후 대기 approval을 같은 요청으로 이을 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/waiting-and-recovery.md
- **redesign/lophn-agent#Q58** [질문] lophn-agent/harness/waiting-and-recovery#Q2 조회 수단 없는 MCP external 효과의 충돌 보류는 언제 풀 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/waiting-and-recovery.md
- **redesign/lophn-agent#Q59** [질문] lophn-agent/harness/waiting-and-recovery#Q3 완성 압축 summary와 보호 원문 범위를 복구할 근거는 무엇인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/waiting-and-recovery.md
- **redesign/lophn-agent#Q60** [질문] lophn-agent/harness/waiting-and-recovery#Q4 H8 Operator가 질문을 기다리는 동안 주기를 계속 건너뛰는 정책을 유지할 것인가?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/harness/waiting-and-recovery.md
- **redesign/lophn-agent#Q100** [질문] **H8.** Operator가 질문 답을 기다리는 동안 주기 회차를 계속 건너뛰는 정책 유지 여부. 현재는 → lophn-agent/scheduling의 건너뜀 규칙을 따른다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/harness/waiting-and-recovery.md

### lophn-agent/observability

- **lophn-agent/observability#Q1** [충돌] 보존 기본을 자동 삭제 없음으로 둘까, 상세 180일·export 내용 14일·세션 종료 후 90일·UTC 일별 비용 365일로 둘까?
  - 선택지: 자동 삭제 없음;종류별 유한 기간
  - 추천: 별도 사람 합의 전 자동 삭제 없음 유지
  - 적용: R23
- **lophn-agent/observability#Q2** [질문] 유한 기간 합의 뒤 단축 소급·삭제 비복구·정리 주기를 어떻게 적용할까?
  - 선택지: 소급 없음;소급 적용·기동 및 1시간마다 최대 500개
  - 추천: 소급 적용·늘려도 삭제 비복구를 안내하되 정리 주기와 묶음은 platform/ledger·platform/blob-store와 정한다.
  - 적용: 현재 자동 삭제 없음
- **lophn-agent/observability#Q3** [질문] 첫 OTLP GenAI Semantic Conventions version을 무엇으로 고정할까?
  - 선택지: 수집기 검증한 한 version;다중 version
  - 추천: 구현 때 수집기로 검증한 한 version을 고정하고 export에 명시한다.
  - 적용: R15의 version 명시
- **redesign/lophn-agent#Q27** [질문] lophn-agent/observability#Q1 보존 기본을 자동 삭제 없음으로 둘까, 상세 180일·export 내용 14일·세션 종료 후 90일·UTC 일별 비용 365일로 둘까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/observability.md
- **redesign/lophn-agent#Q28** [질문] lophn-agent/observability#Q2 유한 기간 합의 뒤 단축 소급·삭제 비복구·정리 주기를 어떻게 적용할까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/observability.md
- **redesign/lophn-agent#Q29** [질문] lophn-agent/observability#Q3 첫 OTLP GenAI Semantic Conventions version을 무엇으로 고정할까?
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/observability.md
- **redesign/lophn-agent#Q90** [질문] 자동 삭제 없음과 유한 보존 중 선택. 후보는 발생 후 상세 180일·export 내용 14일·세션 종료 뒤 90일·UTC 일별 비용 365일이며 현재 활성 정책은 아니다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/observability.md
- **redesign/lophn-agent#Q91** [질문] 유한 보존의 기간 단축 소급 적용·삭제 비복구 및 삭제된 blob 참조 표현을 → platform/blob-store와 맞춘다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/observability.md
- **redesign/lophn-agent#Q92** [질문] OTLP GenAI Semantic Conventions의 정확한 지원 version.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/observability.md

### lophn-agent/questions

- **lophn-agent/questions#Q1** [충돌] 선택지 개수의 이전 2~6개 제한을 유지할까, 현재 상한 없음으로 갈까.
  - 선택지: 이전: 2~6개·1개/7개/기타/설명 없음 거절 / 현재: 고정 개수 상한 없음
  - 추천: 지금은 현재 모델을 적용하고 사용 사례로 상한 재검토
  - 적용: 현재 모델
- **lophn-agent/questions#Q2** [충돌] 답 기다림 질문의 이전 고정 900초 기한과 현재 기본 무기한 중 무엇을 쓸까.
  - 선택지: 이전: blocking 접수 후 900초·nonblocking 무기한, 899초 수락/900초 종료 / 현재: 기본 기한 없음·명시 기한만 경계 종료
  - 추천: 지금은 현재 모델을 적용
  - 적용: 현재 모델
- **lophn-agent/questions#Q3** [질문] 답 없는 질문에 기본 유한 기한을 도입할까.
  - 선택지: 기본 무기한 / 일정 시간 뒤 답 없음으로 stopped
  - 추천: 현재 기본 무기한 유지, 명시 기한 허용
  - 적용: 기본 기한 없음
- **redesign/lophn-agent#Q17** [질문] lophn-agent/questions#Q1 선택지 개수의 이전 2~6개 제한을 유지할까, 현재 상한 없음으로 갈까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/questions.md
- **redesign/lophn-agent#Q18** [질문] lophn-agent/questions#Q2 답 기다림 질문의 이전 고정 900초 기한과 현재 기본 무기한 중 무엇을 쓸까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/questions.md
- **redesign/lophn-agent#Q19** [질문] lophn-agent/questions#Q3 답 없는 질문에 기본 유한 기한을 도입할까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/questions.md
- **redesign/lophn-agent#Q80** [질문] H8: 답 없는 Operator 질문 동안 주기를 계속 건너뛸지. 현재는 건너뛴다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/questions.md
- **redesign/lophn-agent#Q81** [질문] 답 없는 질문의 기본 기한: 현재 null. 유한 기한을 도입하면 → lophn-agent/harness/waiting-and-recovery와 맞춘다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/questions.md
- **redesign/lophn-agent#Q82** [질문] OptionAction의 정규화·binding hash는 → platform/ledger 및 소유 command schema와 동일한 contract로 정한다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 현재 보호·기록 contract 유지; 구체 owner 형식은 검토 목록
  - 근거: docs/domain-model/lophn-agent/questions.md

### lophn-agent/revert

- **lophn-agent/revert#Q1** [질문] 복원 불가 변경이 섞인 run에 사람이 남는 영향 확인 후 부분 revert를 제공할까.
  - 선택지: 항상 전체 차단 / 명시 확인 뒤 복원 가능 변경 전체 적용
  - 추천: 현재 부분 revert 유지
  - 적용: 기본 차단·사람 명시 확인 뒤 안전한 부분 revert
- **lophn-agent/revert#Q2** [충돌] 기존 R6·domain이 앱 업무 DB 변경을 revert 범위 밖으로 두었다
  - 선택지: 범위 밖 유지 / 지원 command receipt 복원
  - 추천: 지원 write의 receipt로 앱 revert command direct call; 파일 직접 복원은 제외
  - 적용: intent에 맞춰 고침
  - 근거: lophn-agent#I5; requirements:lophn-agent/revert#R6
- **lophn-agent/revert#Q3** [충돌] 기존 R4·domain은 모든 복원을 원자 transaction과 blocked로만 설명한다
  - 선택지: 분산 원자 복원 보장 / 사전 전체 검사·direct call 실제 단계
  - 추천: 사전 충돌 전체 차단; 앱 시작 후 실패·불명확은 partial/uncertain·durable 단계 보존
  - 적용: intent에 맞춰 고침
  - 근거: lophn-agent#I5; apps/runtime; requirements:lophn-agent/revert#R4; domain-model:lophn-agent/revert
- **lophn-agent/revert#Q4** [질문] 사람의 앱 revert를 어떤 actor와 호출 범위로 보낼까
  - 선택지: agent Grant 재사용 / 정확한 사람 복원 결정의 user 통로
  - 추천: user actor와 고정 receipt·command·CAS에 묶인 machine 적용; agent.commands 회수로 사람의 복원 능력을 대신 판정하지 않음
  - 적용: 추천안 적용
  - 근거: lophn-agent#I5; platform/identity; apps/runtime
- **redesign/lophn-agent#Q20** [질문] lophn-agent/revert#Q1 복원 불가 변경이 섞인 run에 사람이 남는 영향 확인 후 부분 revert를 제공할까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/revert.md
- **redesign/lophn-agent#Q83** [질문] 복원 불가 변경이 섞일 때 부분 revert를 제공할지. 현재 모델은 사람의 명시적 동의 뒤 복원 가능 변경 전체만 적용한다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/revert.md
- **redesign/lophn-agent#Q84** [질문] 원자적 검사·복원 대상 수·event 수 한도와 준비 결과 schema는 → platform/ledger 및 각 owner와 정한다. 한도를 넘는 전체 revert를 분할 적용하지 않는다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/revert.md
- **redesign/lophn-agent#Q85** [질문] 원본 연결 문서의 복원 준비·파일 반영 순서와 실패 시 결과는 → documents/file-tracking, documents/versions. 이 문서는 디스크 원본 복구를 보장하지 않는다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 현재 보호·기록 contract 유지; 구체 owner 형식은 검토 목록
  - 근거: docs/domain-model/lophn-agent/revert.md

### lophn-agent/role-definition

- **lophn-agent/role-definition#Q1** [질문] 정함: 내장 세 역할을 사람이 편집하거나 복사할 수 있게 할까.
  - 선택지: 현행 제품 정의 유지·Operator만 정의 / 다른 역할 복사본 편집 허용
  - 추천: 현행 유지
  - 적용: 내장 세 역할 편집·복사 금지
  - 결정: 2026-10-04 결정 10: 역할마다 기본 preset을 두고 사람이 고치거나 새로 만든다. provider·model도 preset마다 선택하며 제품 금지·상한은 바꾸지 못한다.

### lophn-agent/roles/app-engineer

- **lophn-agent/roles/app-engineer#Q1** [질문] H3: App Engineer 주기 검토를 추가할까.
  - 선택지: lophn-agent/roles/app-engineer의 사람 요청만 유지 / 주기 검토 추가
  - 추천: lophn-agent/roles/app-engineer 유지
  - 적용: 사람 요청과 handoff만
- **lophn-agent/roles/app-engineer#Q2** [질문] H7: App Engineer 티켓 생성에 매번 승인을 묻지 않는 lophn-agent/harness/tool-judgment를 유지할까.
  - 선택지: 되돌릴 수 있는 생성 허용 / 매번 approval request
  - 추천: lophn-agent/harness/tool-judgment 유지
  - 적용: 생성·읽기만 허용, 생성은 묻지 않음
- **lophn-agent/roles/app-engineer#Q3** [충돌] 이전 AE-17의 티켓 생성 ask와 lophn-agent/harness/tool-judgment의 매번 묻지 않는 생성을 어떻게 맞출까.
  - 선택지: 이전 티켓 생성마다 approval request / lophn-agent/harness/tool-judgment의 되돌릴 수 있는 생성 허용
  - 추천: lophn-agent/harness/tool-judgment 유지
  - 적용: 현재 모델
- **lophn-agent/roles/app-engineer#Q4** [질문] App Engineer에게 담당 앱의 되돌리기 지원 write도 줄까
  - 선택지: read만 / 담당 앱 read·지원 write
  - 추천: 담당 앱 read·지원 write; confirm approval; external·미지원 write 제외
  - 적용: 추천안 적용
  - 근거: lophn-agent/harness#I9; lophn-agent/roles#I3
- **lophn-agent/roles/app-engineer#Q5** [충돌] 기존 R3·R5와 domain이 담당 앱 command 실행을 금지한다
  - 선택지: 금지 유지 / 역할 상한 안 API 제공
  - 추천: 담당 앱 허락된 read·지원 write 허용; source·blueprint 직접 변경 금지 유지
  - 적용: intent에 맞춰 고침
  - 근거: lophn-agent/harness#I9; requirements:lophn-agent/roles/app-engineer#R3; requirements:lophn-agent/roles/app-engineer#R5
- **redesign/lophn-agent#Q73** [질문] lophn-agent/roles/app-engineer#Q1 H3: App Engineer 주기 검토를 추가할까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/roles/app-engineer.md
- **redesign/lophn-agent#Q74** [질문] lophn-agent/roles/app-engineer#Q2 H7: App Engineer 티켓 생성에 매번 승인을 묻지 않는 lophn-agent/harness/tool-judgment를 유지할까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/roles/app-engineer.md
- **redesign/lophn-agent#Q75** [질문] lophn-agent/roles/app-engineer#Q3 이전 AE-17의 티켓 생성 ask와 lophn-agent/harness/tool-judgment의 매번 묻지 않는 생성을 어떻게 맞출까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/roles/app-engineer.md

### lophn-agent/roles/lophn

- **lophn-agent/roles/lophn#Q1** [질문] 문서 추천의 30일·4회·2개 중 두 조건을 계속 추천 근거로 쓸까.
  - 선택지: 현행 보조 지표 유지 / 실제 사용 뒤 다른 지표로 교체
  - 추천: 사람 요청에서 설명 가능한 보조 근거로 유지
  - 적용: 보조 지표 유지
- **lophn-agent/roles/lophn#Q2** [충돌] 이전 LA-20의 문서 쓰기 허용 본문과 매번 확인이라는 확인 문장 중 무엇을 적용할까.
  - 선택지: 본문의 되돌릴 수 있는 문서 쓰기 허용 / 확인 문장의 매번 approval request
  - 추천: lophn-agent/roles/operator과 현재 역할 정책에 맞춰 요청 범위 문서 저장 허용
  - 적용: 현재 모델
- **lophn-agent/roles/lophn#Q3** [충돌] 기존 R4의 앱 실행 없음과 R16의 의도·취향 질문만이 새 기능과 충돌한다
  - 선택지: 기존 금지 / 앱 API·설정 question 지원
  - 추천: 허락된 앱 command 및 설정 선택 질문을 제공
  - 적용: intent에 맞춰 고침
  - 근거: lophn-agent#I11; lophn-agent/roles#I7; requirements:lophn-agent/roles/lophn#R4; requirements:lophn-agent/roles/lophn#R16
- **redesign/lophn-agent#Q76** [질문] lophn-agent/roles/lophn#Q1 문서 추천의 30일·4회·2개 중 두 조건을 계속 추천 근거로 쓸까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/roles/lophn.md
- **redesign/lophn-agent#Q77** [질문] lophn-agent/roles/lophn#Q2 이전 LA-20의 문서 쓰기 허용 본문과 매번 확인이라는 확인 문장 중 무엇을 적용할까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/roles/lophn.md

### lophn-agent/roles/operator

- **lophn-agent/roles/operator#Q1** [질문] 정함: 구체적 Operator에 외부 MCP tool 선택을 허용할까.
  - 선택지: 현재 0개 유지 / 사람이 서버와 개별 tool을 승인해 선택
  - 추천: 첫 판은 0개 유지, 실제 사례가 생기면 extensions 계약과 함께 검토
  - 적용: 외부 MCP tool 0개
  - 결정: 2026-10-04 결정 10·11: Operator는 project/app에 붙고 MCP를 preset에서 명시 선택할 수 있다. 영구 0개 금지는 폐기하며 실제 tool의 effect·scope 검증은 redesign/lophn-agent#Q93으로 남긴다.
- **lophn-agent/roles/operator#Q2** [질문] 정함: 구체적 Operator에 등록한 반복 절차 skill 선택을 허용할까.
  - 선택지: 현재 0개 유지 / 등록 절차의 정확한 이름 선택
  - 추천: 첫 판은 0개 유지
  - 적용: skill 0개
  - 결정: 2026-10-04 결정 10: 등록 skill은 preset 항목으로 선택할 수 있다. 영구 0개 금지는 폐기하며 제품 금지·상한은 유지한다.

### lophn-agent/scheduling

- **lophn-agent/scheduling#Q1** [질문] Operator에 cron 5칸·IANA 시간대의 현지 달력 주기를 추가할까.
  - 선택지: 현재 고정 간격만 / cron 5칸+IANA 시간대 / 둘 모두; 이전 예: 0 9 * * * + Asia/Seoul은 한국시간 매일 오전 9시
  - 추천: 첫 판은 현재 고정 간격 유지, 생활 시간 사례가 필요하면 현지 달력 추가
  - 적용: UTC 첫 시점·양수 밀리초 간격만
- **lophn-agent/scheduling#Q2** [질문] H8: Operator가 질문 답을 기다리는 동안 모든 회차를 건너뛰는 정책을 유지할까.
  - 선택지: 현재 skip / 질문 기한·대기 정책 변경
  - 추천: lophn-agent/harness/run-loop의 skip 유지
  - 적용: 사람 기다림을 포함한 미종료 run이면 skip
- **redesign/lophn-agent#Q14** [질문] lophn-agent/scheduling#Q1 Operator에 cron 5칸·IANA 시간대의 현지 달력 주기를 추가할까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/scheduling.md
- **redesign/lophn-agent#Q15** [질문] lophn-agent/scheduling#Q2 H8: Operator가 질문 답을 기다리는 동안 모든 회차를 건너뛰는 정책을 유지할까.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/requirements/lophn-agent/scheduling.md
- **redesign/lophn-agent#Q78** [질문] 현지 달력 주기를 지원할지 정한다. 현재 first_at·every_ms만 사용한다. cron 5칸·IANA 시간대·DST 값은 추가하지 않는다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/scheduling.md
- **redesign/lophn-agent#Q79** [질문] **H8.** Operator 질문 대기 중 회차를 모두 skip하는 정책 유지 여부. 현재 accepted·running·waiting_user 모두 skip이다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/scheduling.md

### lophn-agent

- **architecture/lophn-agent#Q1** [충돌] 주기 요구는 기존 앱 runtime scheduler 재사용인데 직전 architecture는 agent 자체 시계다.
  - 선택지: 새 scheduler 프로세스; 각자 중복 구현; 순수 시점 계산 모듈을 공유하고 회차 접수는 각 owner가 처리
  - 추천: 공용 scheduler 계산 모듈을 앱 supervisor와 agent runtime이 재사용하고 agent 회차 command는 agent owner가 유지한다.
  - 적용: 예: 공용 계산 모듈 재사용, 별도 scheduler 프로세스 없음
  - 근거: requirements/lophn-agent/scheduling.md#R2; architecture/README.md#3; old-docs/architecture/agent-runtime.md#5.2
- **architecture/lophn-agent#Q2** [충돌] MCP 선택 요구는 서버·개별 도구 조합인데 RoleExtensionSelection은 서버 이름만 저장한다.
  - 선택지: 서버 전체 자동 선택; 현재 도구의 명시 쌍을 설정에 추가; 사용 불가
  - 추천: platform settings 값에 정확한 서버·원래 tool 쌍 선택을 추가하고 서버 배열은 연결 후보로만 사용한다. 새 tool은 자동 선택하지 않는다.
  - 적용: 예: 정확한 쌍 목록과 RunBasis 정의 hash에 고정; domain model 변경은 별도 필요
  - 근거: requirements/lophn-agent/extensions.md#R31; domain-model/lophn-agent/extensions.md#RoleExtensionSelection
- **architecture/lophn-agent#Q3** [충돌] 정함: 공통 역할 값은 확장 선택 고정 []인데 현재 요구와 사용자 지시는 skill·외부 MCP 지원을 요구한다.
  - 선택지: 확장 연결만 구현하고 항상 사용 금지; []를 초기 기본값으로 두고 사람 설정의 명시 선택 허용
  - 추천: []는 초기 기본값으로 유지하고 platform settings의 사람 명시 선택만 허용한다. 역할의 능력·scope 상한은 절대 확장하지 않는다.
  - 적용: 예: 역할 기본 선택 0개, 사람 설정으로 범위 안 선택 가능; 공통 domain model의 고정 표현 정리 필요
  - 근거: domain-model/lophn-agent/roles/common.md#CommonRoleValues; requirements/lophn-agent/extensions.md#R30,#R31; 사용자 외부 MCP·skill 지원 지시
  - 결정: 2026-10-04 결정 10·15: 역할 구성 정본은 Preset이고 MCP·skill을 사람이 명시 선택한다. RoleValues 글은 domain 값이 아니라 prompt이며 선택을 영구 []로 고정하지 않는다.
- **architecture/lophn-agent#Q4** [충돌] Run 시작 순서는 domain model에서 접수 seq만인데 요구는 세 우선순위·8회 양보다.
  - 선택지: 전체 FIFO; 우선순위만; assignment 안 FIFO와 assignment 간 세 우선순위
  - 추천: assignment 안 FIFO를 지키며 시작 가능한 각 assignment의 맨 앞 run들 사이에서 세 우선순위와 8회 양보를 적용한다.
  - 적용: 예: 두 규칙의 적용 범위를 나누어 설계; domain model 문장 명확화 필요
  - 근거: requirements/lophn-agent/harness/run-loop.md#R4; domain-model/lophn-agent/harness/run-loop.md#불변 조건
- **architecture/lophn-agent#Q5** [충돌] tool domain model은 순차 처리인데 요구는 all-read 묶음 병렬을 허용한다.
  - 선택지: 항상 순차; all-read만 병렬
  - 추천: 처음에는 항상 응답 순서대로 순차 처리한다. 병렬은 필수 아닌 허용이며 후속 최적화로만 둔다.
  - 적용: 예: 순차 기본; 실행 순서·중단 경계를 하나로 유지
  - 근거: requirements/lophn-agent/harness/run-loop.md#R12; domain-model/lophn-agent/harness/tools.md#정책
- **architecture/lophn-agent#Q6** [충돌] ToolDecision 값이 tools와 tool-judgment domain model에서 다른 모양으로 정의되어 있다.
  - 선택지: 각각 저장; 판정 값을 하나로 정하고 기록 참조
  - 추천: tool-judgment의 현재 scope·판·정확한 입력·효과 근거를 공통 판정 결과로 쓰고 ToolCall에는 그 판정 근거를 보존한다.
  - 적용: 예: 하나의 판정 모듈과 ToolCall 기록, 이중 policy 없음; 필드 schema 통일 필요
  - 근거: domain-model/lophn-agent/harness/tools.md#ToolDecision; domain-model/lophn-agent/harness/tool-judgment.md#ToolDecision
- **architecture/lophn-agent#Q7** [충돌] 정함: prompt 요구의 작업 재료 순서와 domain model의 다섯 층 순서가 다르다.
  - 선택지: 요구 순서로 전면 교체; 다섯 층과 각 층 내부 순서를 구별
  - 추천: 다섯 층을 정본 구조로 쓰고 history/current_input 내부에서 요구의 실제 자료·event 순서를 유지한다.
  - 적용: 예: instructions/tools/references/history/current_input 고정
  - 근거: requirements/lophn-agent/harness/prompt-assemble.md; domain-model/lophn-agent/harness/prompt-assemble.md
  - 결정: 2026-10-04 결정 14: 새 다섯 층과 cache 경계를 정본으로 쓰고 현재 탭·앱 화면·시각은 최신 메시지 맨 뒤에 둔다.
- **architecture/lophn-agent#Q8** [충돌] 명시 provider 연결 test의 실제 사용량을 기록해야 하지만 ModelCall purpose와 독립 call 소유 조건에 test가 없다.
  - 선택지: 감사 누락; judgment로 오기록; connection_test 용도와 user test 소유 근거 추가
  - 추천: ModelCall purpose에 connection_test를 추가하고 run/session null인 명시 user test를 ProviderCheck로 연결한다. 가짜 run·세션을 만들지 않는다.
  - 적용: 예: 동일 호출 기록 경계 사용, connection_test schema 확대는 별도 필요
  - 근거: requirements/lophn-agent/harness/provider.md#R30; requirements/lophn-agent/harness/usage.md#R1,#R2; domain-model/lophn-agent/harness/usage.md#ModelCall
- **architecture/lophn-agent#Q9** [질문] OAuth 지원 대상의 lophn client identity·공식 허용·실제 text/tool 성공이 확인되지 않았다.
  - 선택지: 다른 CLI identity 사용; 미검증 경로 활성화; 검증 gate 뒤에 활성화
  - 추천: 세 OAuth 구현 경로는 준비하되 검증된 client/endpoints/scopes와 실제 text/tool 테스트 근거가 없는 경로는 비활성화한다.
  - 적용: 예: 검증 gate 적용, endpoint/client 값을 꾸며 쓰지 않음
  - 근거: requirements/lophn-agent/harness/provider.md#R1,#R15,#Q1,#Q2,#Q3
- **architecture/lophn-agent#Q10** [질문] 등록 MCP stdio 실행 파일과 skill 읽기의 프로세스 권한 경계는 domain model에서 미정이다.
  - 선택지: 무제한 runtime 권한; 서버별 등록 경로 allowlist; 추가 broker
  - 추천: 등록 절대 executable·skill root만 Deno 권한에 허용하고 필요한 권한 변경은 감독자가 옛 runtime 종료 뒤 재기동한다. stdio 자식의 OS sandbox는 보장하지 않는다.
  - 적용: 예: 동적 권한 확대 요청 없음, 임의 shell·파일 tool 없음
  - 근거: domain-model/lophn-agent/extensions.md#정할 것; architecture/README.md#A2,#A9,#A10
- **architecture/lophn-agent#Q11** [질문] 외부 MCP의 실제 reversibility·scope·idempotency·결과 조회를 확인하는 소유 contract는 미정이다.
  - 선택지: 서버 힌트 신뢰; 사람 선언 신뢰; 확인된 owner contract만 사용
  - 추천: owner contract로 scope와 실제 효과가 확인되지 않는 tool은 deny, 범위 안이지만 reversibility 미확인은 ask, 이미 전달한 불명확 효과는 재전송 없이 종료한다.
  - 적용: 예: 설정·MCP hints만으로 allow 없음
  - 근거: domain-model/lophn-agent/extensions.md#정할 것; requirements/lophn-agent/harness/tool-judgment.md#R2,#R3; requirements/lophn-agent/extensions.md#R28
- **architecture/lophn-agent#Q12** [질문] OTLP GenAI semantic convention의 정확한 판과 mapping이 미정이다.
  - 선택지: 최신 명칭을 추측; 임의 mapping; 검증된 고정 exporter profile만 제공
  - 추천: NDJSON v1을 기본으로 제공하고 OTLP/HTTP protobuf는 검증·고정된 mapping profile이 있는 배포에서만 선택 가능하게 한다.
  - 적용: 예: 미확정 attribute 이름·판을 문서에 발명하지 않음
  - 근거: domain-model/lophn-agent/observability.md#정할 것; requirements/lophn-agent/observability.md
- **check/lophn-agent#Q1** [충돌] 전체 범위 lophn·CE 회수 뒤 재생성 경로가 없어 기본 담당이 사라진다.
  - 선택지: 회수 금지 / 자동 재생성
  - 추천: 멈춤·재개만 허용한다.
  - 적용: 고침: R9·domain 전이·WithdrawAssignment·architecture guard 일치. 적용함: screen/roles#Q1
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/assignments.md#R2,R9; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/assignments.md; /home/pyosechang/projects/lophn/docs/architecture/lophn-agent.md
- **check/lophn-agent#Q2** [충돌] paused 대화 허용 추천과 paused 새 실행 접수 금지가 충돌한다.
  - 선택지: 입력까지 거절 / 원문만 보존·명시 실행 / 자동 실행
  - 추천: paused request를 run 없이 보존하고 재개 뒤 사람의 별도 실행 선택으로만 접수한다. enabled 용어를 쓰며 withdrawn은 과거 읽기만 허용한다.
  - 적용: 고침: assignments R16·conversation R14 추가, 상태·메시지·ExecuteStoredRequest·AcceptRun·run-loop R14 종료 경계·architecture 일치. 적용함: screen/roles#Q2
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/assignments.md#R9,R16; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/conversation.md#R7,R14; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/conversation.md; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/run-loop.md; /home/pyosechang/projects/lophn/docs/architecture/lophn-agent.md
- **check/lophn-agent#Q3** [충돌] ToolCall·ToolDefinition의 legacy confirm effect가 독립 confirm boolean 및 세 effect 계약과 다르다.
  - 선택지: legacy 유지 / 세 effect만
  - 추천: read/write/external과 별도 confirm만 사용한다.
  - 적용: 고침: tools effect enum·선행 기록 조건과 tool-judgment 판정표의 legacy confirm 제거
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/tools.md; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/tool-judgment.md; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/harness/tools.md#R4
- **check/lophn-agent#Q4** [충돌] 두 concern이 ToolDecision을 verdict/decision 및 서로 다른 approval 조건으로 중복 정의한다.
  - 선택지: 이중 값 / 정본 하나
  - 추천: tool-judgment 정본 전체를 ToolCall에 저장한다.
  - 적용: 고침: tools의 중복 schema를 정본 참조로 교체
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/tools.md#ToolDecision; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/tool-judgment.md#ToolDecision
- **check/lophn-agent#Q5** [충돌] 정함: 공통 역할의 확장 선택 고정 []가 requirements의 기본 0개 및 명시 선택 지원과 다르다.
  - 선택지: 영구 0개 / 기본 0개
  - 추천: 기본값과 역할별 상한을 분리하고 선택 저장은 extensions에만 둔다.
  - 적용: 고침: CommonRoleValues 기본값·참조 변경; Operator 미확정 추가 능력은 확대하지 않음
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/roles/common.md; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/roles/common.md#R5; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/role-definition.md
  - 결정: 2026-10-04 결정 10·15: MCP·skill 선택 정본은 Preset이며 공통 역할의 영구 [] 제한은 없다. 기본 선택과 제품 상한은 분리한다.
- **check/lophn-agent#Q6** [충돌] RoleExtensionSelection에 서버만 있어 선택 서버의 미래 tool까지 노출될 수 있다.
  - 선택지: 서버 전체 / 정확한 현재 쌍
  - 추천: 서버 배열은 연결 후보로만 쓰고 mcp_tools의 서버·원래 tool 쌍 교집합만 노출한다.
  - 적용: 고침: mcp_tools·검증·현재 선택 재검사·RunBasis 선택 및 정의 hash 추가; skill 없는 이름·전체 선택 거절 명시
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/extensions.md; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/run-loop.md#RunBasis; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/extensions.md#R30,R31
- **check/lophn-agent#Q7** [충돌] McpConnection에 assignment가 없어 요구의 assignment·server별 비공유 수명을 표현하지 못한다.
  - 선택지: server 공유 / assignment별
  - 추천: assignment를 connection identity에 포함한다.
  - 적용: 고침: assignment 필드·조합 유일성·종료 수명 조건 추가
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/extensions.md#McpConnection; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/extensions.md#R18,R21
- **check/lophn-agent#Q8** [충돌] MCP 행동 hints 변경이 분류 hash와 무효화 조건에서 빠졌다.
  - 선택지: 이전 분류 유지 / hints 포함
  - 추천: 이름·설명·schema·hints로 정의 판을 검사한다.
  - 적용: 고침: schema_hash 기준 및 목록 변경 무효화에 hints 추가
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/extensions.md#McpToolClassification; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/extensions.md#R24
- **check/lophn-agent#Q9** [충돌] 정함: Operator domain의 secret 사용 read 제외가 앱 grant를 허락으로 쓰는 최근 결정과 다르다.
  - 선택지: secret 사용만으로 deny / grant 기반 read
  - 추천: secret 값 직접 접근은 금지하되 유효 앱 read의 secret 부착·remote fetch는 read로 처리한다.
  - 적용: 고침: Operator 읽기 정책과 architecture에 호출 주체로 차단하지 않음·추가 approval 없음·전송 부착·host grant 명시
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/roles/operator.md; /home/pyosechang/projects/lophn/docs/architecture/lophn-agent.md; /home/pyosechang/projects/lophn/docs/domain-model/apps/permissions.md; /home/pyosechang/projects/lophn/docs/domain-model/apps/blueprint.md
  - 결정: 최근 결정 4: grant된 secret command를 Operator라는 이유로 막지 않음
- **check/lophn-agent#Q10** [충돌] 공통 Operator 표는 confirm read를 ask로 허용하지만 Operator R5는 확인 필요 명령을 거절한다.
  - 선택지: ask로 능력 확대 / 역할 deny 유지
  - 추천: 더 구체적인 Operator 요구에 맞춰 confirm=false read만 제공한다.
  - 적용: 고침: 공통 역할 표·tool-judgment 역할 guard·architecture의 Operator 상한 일치; Operator requirements는 유지
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/roles/operator.md#R5; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/roles/common.md; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/tool-judgment.md; /home/pyosechang/projects/lophn/docs/architecture/lophn-agent.md
- **check/lophn-agent#Q11** [충돌] reasoning domain이 한국어 화면 문자열을 직접 정한다.
  - 선택지: 직접 문자열 / 영어 message key
  - 추천: enum과 shell/wording 화면 문구를 분리한다.
  - 적용: 고침: reasoning 화면 문구를 영어 message key owner 참조로 변경
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/model.md#ReasoningSupport; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/harness/model.md#R15
- **check/lophn-agent#Q12** [충돌] catalog 가격 통화와 갱신 검증이 USD·단위·경계 검증 요구보다 느슨하다.
  - 선택지: 임의 통화 / catalog USD
  - 추천: catalog는 USD/1000000 token, 실제 provider 청구 통화는 usage에서 별도 보존한다.
  - 적용: 고침: PriceBasis USD 및 catalog 무한대·단위·중복/잘못된 경계 전체 거절 명시
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/model.md; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/harness/model.md#R5,R7; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/usage.md#CallCost
- **check/lophn-agent#Q13** [충돌] eval domain의 1초~1시간 범위는 요구에 없고 집계 문장은 planned까지 결과 합계에 넣는다.
  - 선택지: 임의 범위 유지 / 양수·총수 명확화
  - 추천: 초기 600000ms와 양수만 유지하고 planned와 다섯 결과 수를 분리한다.
  - 적용: 고침: timeout 양수·시작 고정, 나머지 다섯 결과의 합=planned로 명확화
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/evaluation.md; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/evaluation.md#R2,R24
- **check/lophn-agent#Q14** [충돌] Run domain의 전역 접수 seq 시작만으로는 세 우선순위·8회 양보 요구를 표현하지 못한다.
  - 선택지: 전역 FIFO / assignment FIFO와 후보 우선순위 분리
  - 추천: assignment별 맨 앞 시작 가능 후보 사이에 우선순위·양보를 적용한다.
  - 적용: 고침: 같은 assignment FIFO와 assignment 간 세 우선순위·8회 양보 범위 명시
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/run-loop.md; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/harness/run-loop.md#R4
- **check/lophn-agent#Q15** [충돌] 명시 연결 test 사용량 요구가 ModelCall 세 purpose·slot 필수·run 검사와 충돌한다.
  - 선택지: 누락 / 가짜 judgment run / 독립 connection_test
  - 추천: connection_test·slot/run/session null·명시 user 요청 근거·ProviderCheck call 참조를 쓴다.
  - 적용: 고침: usage·provider domain과 architecture에 실제 시도·30초·usage_wait 제외·test_kind·call 연결 추가; 이미 해결된 usage Q2/Q3와 provider Q9 제거
  - 근거: /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/usage.md; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/harness/provider.md; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/harness/usage.md#R1,R2; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/harness/provider.md#R29,R30; /home/pyosechang/projects/lophn/docs/architecture/lophn-agent.md
- **check/lophn-agent#Q16** [질문] AE는 등록 앱마다 거두지 않은 담당 하나가 필요하지만 회수 후 새 담당을 만드는 계약은 AppCreated 재전송밖에 없다.
  - 선택지: AE 회수 금지 / user의 명시 재배정 / 회수 뒤 자동 준비
  - 추천: 자동 재개 금지를 지키는 명시 재배정 계약 또는 AE 회수 금지 중 하나를 owner가 확정해야 한다.
  - 적용: 미적용: AE lifecycle 결정 필요; lophn/CE 예외를 AE에 임의 확대하지 않음
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/assignments.md#R1,R9; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/assignments.md#CreateAppEngineerAssignment
- **check/lophn-agent#Q17** [질문] Operator의 외부 MCP·skill 추가 선택은 별도 열린 질문이고 승인된 tool 상한과 연결할 계약이 없다.
  - 선택지: 현 0개 유지 / 승인 묶음에 확장 선택 포함
  - 추천: 현재 Operator 상한과 0개를 유지하고 확장 지원은 명시 승인 내용·효과·scope까지 결정한 뒤 추가한다.
  - 적용: 미적용: 공통 기본값 수정이 Operator 추가 tool 허락은 아님
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/roles/operator.md#Q1,Q2; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/roles/operator.md; /home/pyosechang/projects/lophn/docs/domain-model/lophn-agent/assignments.md#OperatorApprovalBundle
  - 후속 기록: 2026-10-04 결정 10으로 Operator preset의 확장 선택을 영구 0개로 고정하지 않는다. 승인 묶음·실제 effect·scope 검증의 구체는 여전히 열려 있다(redesign/lophn-agent#Q93).
- **check/lophn-agent#Q18** [범위] paused 대화 보존 및 저장 요청 실행 contract 변경을 screens·flows·shell에 연결해야 한다.
  - 선택지: 입력 차단 / 보존·미실행 표시 및 재개 뒤 실행 action
  - 추천: paused 입력은 저장됨·아직 실행 안 됨을 구분하고 재개 뒤 명시 실행 선택을 연결한다. 내부 assignment/run 이름은 노출하지 않는다.
  - 적용: 미적용: 할당 scope 밖 문서; main에 변경 계약 전달
  - 근거: /home/pyosechang/projects/lophn/docs/screens/roles.md; /home/pyosechang/projects/lophn/docs/screens/conversation.md; /home/pyosechang/projects/lophn/docs/requirements/shell/desktop.md; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/conversation.md#R14; /home/pyosechang/projects/lophn/docs/architecture/lophn-agent.md
- **redesign/lophn-agent#Q13** [범위] 최초 check-docs의 타 subtree intent 오류 9개
  - 선택지: 소유자 재연결
  - 추천: 새 lophn-agent I1~I8/harness I1~I3 또는 각 owner intent로 재연결
  - 적용: 미적용: 소유 범위 밖
  - 근거: docs/requirements/apps/agent-context.md; docs/requirements/apps/sdk.md; docs/requirements/documents/versions.md; docs/requirements/shell/workspace.md

### lophn-agent/visuals

- **lophn-agent/visuals#Q1** [질문] 시각 블록 첫 판 종류와 크기 상한은 무엇인가
  - 선택지: 선언형 표·bar/line/scatter·node/edge·앱 카드 / 임의 HTML 실행
  - 추천: 선언형 8블록·256KiB·표1000행20열·차트8series1000점·도표100node200edge
  - 적용: 추천안 적용
  - 근거: lophn-agent#I9; concerns:lophn-agent/visuals
- **lophn-agent/visuals#Q2** [질문] 시각 블록을 어떤 문서 format으로 남길까
  - 선택지: 실행 코드 없는 HTML snapshot와 명세 / live 앱 embed
  - 추천: 고정 HTML 그림·데이터·설명·출처·명세; 카드 snapshot 없으면 부재와 참조
  - 적용: 추천안 적용
  - 근거: lophn-agent#I10; documents/formats

### lophn-agent/roles/common

- **lophn-agent/roles/common#Q1** [충돌] 기존 공통 R5의 외부 전송 금지와 lophn 앱 external command 지원을 어떻게 맞출까
  - 선택지: 모두 금지 / 앱 contract 안 external만 approval
  - 추천: 앱 contract 밖 전송·직접 secret 금지는 유지하고 허락된 command는 역할별로 제공
  - 적용: intent에 맞춰 고침
  - 근거: lophn-agent/harness#I9; requirements:lophn-agent/roles/common#R5

### lophn-agent/instructions

- **redesign/lophn-agent#Q3** [질문] LOPHN.md 입력 크기 상한을 얼마로 둘까
  - 선택지: 무제한; 파일/전체 상한
  - 추천: 파일 32768 UTF-8 bytes·전체 131072 bytes; 초과·오류는 call 차단
  - 적용: 적용: instructions와 prompt-assemble
  - 근거: docs/domain-model/lophn-agent/instructions.md; docs/requirements/lophn-agent/instructions.md
- **redesign/lophn-agent#Q5** [질문] Preset 첨부 지침의 순서와 version을 어떻게 고를까
  - 선택지: 지역 지침 앞; 뒤; 첨부 version 고정
  - 추천: global→project→app→첨부 배열; 중복은 첫 document; 내용은 매 call 최신 확정 판
  - 적용: 적용: InstructionAttachment, InstructionLayer
  - 근거: docs/domain-model/lophn-agent/instructions.md
- **redesign/lophn-agent#Q11** [범위] 지침 파일 tracking·문서 보호·Instructions 편집기 경로의 owner contract가 필요하다
  - 선택지: instruction 독립 표; documents 재사용
  - 추천: documents/file-tracking·versions의 파일 정본/판을 재사용하고 shell/editor가 편집; agent write 제외를 owner에서도 보장
  - 적용: 미적용: 타 owner 전파 필요; assigned 문서는 참조만 명시
  - 근거: docs/requirements/documents/file-tracking.md; docs/domain-model/documents/file-tracking.md; docs/requirements/documents/versions.md; docs/domain-model/documents/versions.md; docs/requirements/shell/editor.md; docs/architecture/documents.md; docs/architecture/shell.md
- **redesign/lophn-agent#Q105** [질문] 일반 context 자료 읽기와 언제나 읽을 사람 지침의 범위를 어떻게 구분할까
  - 선택지: 같은 자료 scope; 지침 contract 별도 읽기
  - 추천: 작업 자리·첨부 지침만 별도 읽고 연결 주소로 scope 확대 금지; 첨부 부재는 call 차단
  - 적용: 적용: instructions·tool-judgment
  - 근거: docs/domain-model/lophn-agent/instructions.md; docs/domain-model/lophn-agent/harness/tool-judgment.md

### lophn-agent/presets

- **redesign/lophn-agent#Q6** [질문] 제품 기본 preset 개인화와 새 판 적용을 어떻게 나눌까
  - 선택지: 배포 원문 변경; user preset 새 판
  - 추천: 배포 원문은 유지; user preset 저장 뒤 Assignment에 명시 적용; Operator 전체 승인
  - 적용: 적용: Preset commands와 ChangeAssignmentPreset
  - 근거: docs/domain-model/lophn-agent/presets.md; docs/domain-model/lophn-agent/assignments.md
- **redesign/lophn-agent#Q9** [범위] domain-model README의 Role diagram과 Context Operator 범위는 entity-map 한 줄 편집 범위 밖이다
  - 선택지: diagram owner 변경; 그대로
  - 추천: Role→Preset 및 scope App|Project|all diagram 전파
  - 적용: 미적용: entity-map 한 줄만 수정
  - 근거: docs/domain-model/README.md

### lophn-agent/harness/tool-judgment

- **redesign/lophn-agent#Q96** [질문] ToolCall이 담는 판정 필드와 계약 판 식별자의 구체 형식은 → lophn-agent/harness/tools와 맞춘다. 독립 판정 table·command·event는 만들지 않는다.
  - 선택지: 기존 issue 검토; 현재 contract 유지
  - 추천: 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정
  - 적용: 미정: 문서에서 공통 목록으로 이동
  - 근거: docs/domain-model/lophn-agent/harness/tool-judgment.md

## coding-agent (87)

### coding-agent/cli

- **coding-agent/cli#Q1** [질문] H5 TTY 사람 확인을 보호 결정으로 계속 인정할까.
  - 선택지: confirmation window만; TTY와 보호 화면 모두
  - 추천: confirmation window만
  - 적용: TTY yes·script 승인 없음
- **coding-agent/cli#Q2** [질문] H2 coding agent가 준비한 모든 release activation에 사람 승인을 유지할까.
  - 선택지: 항상 사람 승인; 일부 자동 activation
  - 추천: 항상 사람 승인
  - 적용: 준비와 activation 분리·사람 승인
- **coding-agent/cli#Q3** [질문] 옛 앱 간 연결의 목록·생성·비활성화·계약 검사·activation을 첫 판에 포함하고 누가 소유할까.
  - 선택지: 첫 판 보류; 별도 앱 간 연결 concern 신설
  - 추천: 첫 판 보류하고 coding-agent connection으로 오인하지 않음
  - 적용: 앱 간 연결 관리 command 없음
- **coding-agent/cli#Q4** [질문] 효과 불명 invocation의 외부 효과 confirmed·none·사람 증거 기록을 어떤 계약으로 제공할까.
  - 선택지: 현재 invocation 조회만; 고정 invocation·판 근거와 보호 화면 결정 추가
  - 추천: 현재 apps/invocations 조회만 제공하고 사람 효과 판정은 소유 계약 확정 뒤 추가
  - 적용: 기존 효과 확정 command 미제공·효과 불명 유지
- **coding-agent/cli#Q5** [질문] 저장된 검색 관점 전용 CLI를 첫 판에 포함할까.
  - 선택지: keyword 검색·context로 대체; 저장 검색 관점 추가
  - 추천: coding-agent/mcp-server#Q3와 함께 첫 판 보류
  - 적용: keyword 검색·context 제공, 별도 저장 query 모델 없음
- **coding-agent/cli#Q6** [질문] live sample 조회를 CLI 추가 근거에 포함할까.
  - 선택지: 보존 snapshot만; 시간당 10회 제한 sample hook
  - 추천: coding-agent/repair-context#Q1과 함께 첫 판 보존 snapshot만
  - 적용: sample 실행과 별칭 없음
- **redesign/coding-agent#Q12** [충돌] 정함: MCP claim 하나 흐름과 기존 CLI claim·OpenClaw CLI fallback을 어떻게 맞추나
  - 선택지: CLI claim 유지 / 실제 claim은 MCP만
  - 추천: 결정16의 MCP claim을 그대로 적용; CLI는 조회·갱신·반납·보고와 MCP 연결 안내, 미지원 MCP는 claim 없이 code 작업 불가
  - 적용: 적용; I1 CLI 연동의 실제 작업 범위를 사람 검수에 남김
  - 근거: wf-common 결정16; coding-agent#I1; cli#R1,R36,R41; 연구 3.1 OpenClaw
  - 결정: 2026-10-04 결정 16: 실제 coding 작업의 claim은 MCP 하나로 통일한다. CLI 조회·갱신·반납·보고는 가능하나 MCP 미지원 환경에서 CLI claim으로 우회하지 않는다.
- **redesign/coding-agent#Q14** [범위] 기존 CLI의 사람 daemon·secret·파일/project/context/series 관리 요구를 coding-agent intent만으로 정당화할 수 있나
  - 선택지: 삭제 / 기존 기능 유지·소유 concern 위임 / intent 확장
  - 추천: 기존 통로는 유지하되 실제 계약은 소유 concern 위임; coding-agent I1/I2/I3은 얇은 연동 부분만 덮으며 관리 기능 자체 약속은 범위 검수
  - 적용: 모든 의도는 유효 coding-agent I1~I8로 연결; cli R7,R8,R16~R23,R31,R35,R38의 사람 관리 자체는 범위로 기록
  - 근거: docs/intent/coding-agent.md; docs/requirements/coding-agent/cli.md; docs/README.md 요구는 intent 넘지 않음

### coding-agent/connection

- **coding-agent/connection#Q1** [질문] 외부 세션에 claim 상실을 비강제 notification으로도 전달할까.
  - 선택지: 현재 claim 재조회만; 지원 확인된 제품에 notification 추가
  - 추천: 첫 판은 현재 claim 재조회만
  - 적용: 재조회만
- **coding-agent/connection#Q2** [질문] Claude Code의 지원·검증 최소 버전을 고정할까.
  - 선택지: 설치 버전별 capability 검사; 명시 최소 버전 목록
  - 추천: 설치 버전별 실제 skill 발견과 공통 안내 loading 검사
  - 적용: 설치 버전별 검사; 확인 못함을 성공으로 표시하지 않음
- **coding-agent/connection#Q3** [질문] 앱 범위 연결에서 프로젝트 근거를 어떻게 읽을까.
  - 선택지: 전체 연결; 앱에 고정 근거 저장; 별도 제한 읽기 허용 목록
  - 추천: 앞의 두 가지로 해결하고 첫 판에 별도 문서 권한을 추가하지 않음
  - 적용: 범위 밖 근거 내용 미제공
- **redesign/coding-agent#Q13** [빠짐] OS keychain trusted loader와 TUI/MCP/CLI credential 전달의 구체를 어느 concern이 정하나
  - 선택지: 평문 파일 / token env / trusted process-local 통로
  - 추천: identity·secrets가 keychain·자식 process-local 인증 contract를 정하고 terminal은 보호 handle 전달; token은 config·argv·prompt·일반 env·PTY에 금지
  - 적용: coding 문서는 경계만 적용; platform/identity·platform/secrets·shell/terminal 상세 필요
  - 근거: wf-common 결정19; coding-agent/connection#R17; architecture 2.3

### coding-agent/guides

- **coding-agent/guides#Q1** [질문] OpenClaw 별도 workspace에서 앱 공통 안내를 어떤 방식으로 읽게 할까.
  - 선택지: 누락 경고와 명시 읽기; 지원 확인된 import 연동
  - 추천: 누락을 표시하고 앱 정본 명시 읽기를 안내
  - 적용: workspace 변경·지시 복제 없음
- **coding-agent/guides#Q2** [질문] skill 설치는 제품별 발견 위치 adapter를 기본으로 제공할까.
  - 선택지: 일곱 제품 adapter; 임의 디렉터리만
  - 추천: 일곱 제품 adapter와 사람이 고른 디렉터리 지원
  - 적용: 제품별 실제 발견·trust 안내
- **coding-agent/guides#Q3** [질문] 관리 경계가 없는 기존 안내에 최초 설치 때 구간을 추가할까.
  - 선택지: 무변경; 사람 동의 뒤 구간 추가
  - 추천: 일반 갱신은 무변경, 최초 추가는 사람 선택 뒤에만
  - 적용: 자동 추가 없음
- **coding-agent/guides#Q4** [충돌] 옛 SDK 우선순위와 중첩 skill metadata 예시를 첫 판에서도 유지할까.
  - 선택지: 개인 SDK 우선·중첩 metadata; 설치 SDK 우선·문자열 map
  - 추천: 첫 판에는 개인 SDK 없이 설치 SDK 우선, 문자열 map
  - 적용: 설치 SDK 탐색과 문자열 map
- **redesign/coding-agent#Q5** [질문] 관리 marker 없는 기존 안내에 구간을 추가할까
  - 선택지: append / 무변경 / first-create plan
  - 추천: 기존 파일 무변경·복구 안내; 새 템플릿 first-create 별도 명시 plan
  - 적용: 적용
  - 근거: 연구 7장 instruction marker 질문; guides#R15; domain-model/coding-agent/harnesses
- **redesign/coding-agent#Q17** [질문] status hook과 summary hook의 설치 목적을 나눌까
  - 선택지: 같은 hook에 결합 / 별도 collection
  - 추천: Claude summary 전달만 기존 budget 유지, runtime 상태 collection 별도 목적·검증 version·receipt; OpenClaw 미검증 unknown
  - 적용: 적용
  - 근거: 연구 7장 status hook 목적 질문; guides#R25; harnesses#R11
- **redesign/coding-agent#Q21** [질문] 기존 architecture의 문자·줄 계산을 domain에도 명시할까
  - 선택지: 미정 유지 / Unicode code point·logical line
  - 추천: 현재 architecture 추천 유지; 문자 상한 Unicode code point, CRLF를 LF로 센 logical line; test_command 실행 파일 허용 목록은 소유 spec에 위임
  - 적용: 적용; harness native ID에도 같은 code point 사용
  - 근거: architecture/coding-agent.md 5.5,5.6; domain-model/coding-agent/guides,tickets 정할 것

### coding-agent/mcp-server

- **coding-agent/mcp-server#Q1** [충돌] 옛 app test 기본 300초와 아직 미확정인 test runner timeout 정책을 어떻게 맞출까.
  - 선택지: adapter 기본 300초 유지; runner 공통 기본 확정 뒤 변경
  - 추천: 당장은 adapter가 300초를 명시하고 공통 상한·기본은 problems/tests#Q3에서 확정
  - 적용: adapter 기본 300초·runner의 유한 timeout 필수
- **coding-agent/mcp-server#Q2** [질문] 첫 판에 stdio 외 loopback HTTP MCP transport도 제공할까.
  - 선택지: stdio만; 인증된 loopback HTTP 추가
  - 추천: 첫 판 stdio만
  - 적용: stdio만
- **coding-agent/mcp-server#Q3** [질문] 저장된 검색 관점 읽기를 첫 판에 포함하고 어느 concern이 소유할까.
  - 선택지: keyword 검색과 context로 대체; 저장 검색 관점 추가
  - 추천: 첫 판은 documents/outline-and-search와 documents/contexts로 제공하고 별도 저장 query 모델은 보류
  - 적용: 저장 검색 관점 전용 tool 없음
- **coding-agent/mcp-server#Q4** [충돌] coding agent context 변경안이 고정 action 질문을 직접 생성할 수 있을까.
  - 선택지: coding agent 직접 생성 허용; 변경안 문서로 담당 lophn agent에 전달
  - 추천: 현재 질문 생성 권한을 유지하고 고정 변경안 문서 접수 후 담당 agent가 질문 생성
  - 적용: 제안 접수는 제공, coding agent 직접 질문 생성·적용 없음
- **coding-agent/mcp-server#Q5** [충돌] SDK 추가는 고정 import 안내만 반환할까 source import map도 바꿀까.
  - 선택지: 안내만; 명시 source 반영 선택
  - 추천: 안내를 기본으로 하고 명시 허용 source 반영도 제공
  - 적용: 기본 안내·명시 선택 반영·충돌 보존
- **coding-agent/mcp-server#Q6** [충돌] 옛 v2 수리 상세 16 KiB·capture 64 KiB·50개 목록 상한을 새 묶음에도 적용할까.
  - 선택지: 옛 별도 API 유지; 새 수리 자료 계약으로 통합
  - 추천: coding-agent/repair-context의 24 KiB·300줄과 근거별 페이지로 통합
  - 적용: 별도 v2 수리 단계·크기 체계 없음
- **coding-agent/mcp-server#Q7** [질문] runtime의 앱 간 연결 목록 읽기를 첫 판 MCP에 포함할까.
  - 선택지: 첫 판 보류; 별도 앱 간 연결 소유 계약 후 읽기 추가
  - 추천: coding-agent/cli#Q3와 함께 첫 판 보류
  - 적용: coding-agent connection과 다른 앱 간 연결 목록 tool 없음
- **coding-agent/mcp-server#Q8** [질문] blueprint 앱 command를 coding agent에게도 생성 tool로 내보일까
  - 선택지: 미노출 / read만 / write·external 포함
  - 추천: 기존 runtime read 범위를 유지하여 명시 앱 toolset에서 read만 먼저; preview 기본·scope·redaction 동일
  - 적용: 예; requirements R34~R35 적용
  - 근거: coding-agent#I2,I3; coding-agent/mcp-server#R29; apps#I11

### coding-agent/repair-context

- **coding-agent/repair-context#Q1** [질문] 현재 앱 sample hook을 추가 근거로 채택할까.
  - 선택지: immutable snapshot만; sample hook을 문제당 1시간 최대 10번
  - 추천: 첫 판은 보존된 immutable snapshot만
  - 적용: sample 실행 기능 없음
- **coding-agent/repair-context#Q2** [충돌] 옛 화면 64 KiB 상한과 새 24 KiB 상한 중 무엇을 적용할까.
  - 선택지: 화면 64 KiB; 모든 추가 텍스트 24 KiB
  - 추천: 24 KiB 페이지와 cursor
  - 적용: 24 KiB
- **coding-agent/repair-context#Q3** [충돌] 절별 줄 상한과 새 domain model의 자수·개수 상한을 어떻게 합칠까.
  - 선택지: 옛 줄 상한만; 새 자수·개수만; 두 상한 중 작은 것
  - 추천: 기본 묶음에 두 상한을 함께 적용하고 추가 읽기는 별도 페이지 상한
  - 적용: 기본 log 45줄·더 읽기 5줄·반환 4줄 등 더 작은 상한
- **coding-agent/repair-context#Q4** [질문] 근거가 가장 다른 발생의 비교 기준을 무엇으로 정할까.
  - 선택지: 고정 근거 값의 차이; release·오류·invocation 차이 가중
  - 추천: 고정 Report·snapshot의 오류·release·근거 차이를 비교하고 접수 순서로 동률 처리
  - 적용: 고정 근거만 사용·결정적 동률 처리
- **coding-agent/repair-context#Q5** [질문] 2 MiB를 넘는 이미지에 파생 축소나 부분 읽기를 제공할까.
  - 선택지: 크기와 미제공 이유만; 안전한 파생 축소; 부분 읽기
  - 추천: 첫 판은 미제공 이유와 크기를 표시
  - 적용: 상한 초과 이미지 미제공

### coding-agent/tickets

- **coding-agent/tickets#Q1** [질문] 긴 구현 세션에 기본 60분 claim을 유지할까.
  - 선택지: 60분 명시 갱신; 사람이 고른 더 긴 기간
  - 추천: 기본 60분 명시 갱신을 먼저 사용하고 실제 긴 구현 사례로 조정
  - 적용: 60분·명시 갱신만
- **coding-agent/tickets#Q2** [질문] H4 reproduction test 없는 수리 ticket도 사람 acceptance check로 허용할까.
  - 선택지: 현행 ticket 없는 직접 수리; 사람 확인만 조건으로 허용
  - 추천: 현행 직접 수리
  - 적용: reproduction test 없는 수리 ticket 생성 거절
  - 후속 기록: 2026-10-04 결정 16으로 ticket 없는 직접 수리 추천은 폐기한다(redesign/coding-agent#Q20). 모든 요청을 ticket으로 접수하되 reproduction 없는 실행 준비와 사람 acceptance check 허용 여부(H4)는 미정이며 redesign/propagate#Q4·redesign/lophn-agent#Q107과 함께 정한다.
- **coding-agent/tickets#Q3** [질문] 구현 ticket 완료 끝점을 공통 기본값으로 정할까.
  - 선택지: ticket별 test·preview 또는 activation 명시; 공통 기본 끝점
  - 추천: ticket별 명시
  - 적용: activation은 명시 조건일 때만
- **coding-agent/tickets#Q4** [질문] H7 담당 App Engineer의 승인 없는 즉시 ticket 생성을 유지할까.
  - 선택지: lophn-agent/harness/tool-judgment 유지; 생성마다 질문
  - 추천: lophn-agent/harness/tool-judgment 유지
  - 적용: 별도 승인·공개 단계 없이 즉시 열림
- **coding-agent/tickets#Q5** [충돌] 옛 24시간 문제 claim과 읽기 자동 갱신을 유지할까.
  - 선택지: 문제 claim 24시간·읽기 갱신; ticket claim 60분·명시 갱신
  - 추천: problems/repairs과 apps/releases 및 새 ticket 정책
  - 적용: ticket에만 60분 claim·명시 갱신
- **redesign/coding-agent#Q15** [충돌] 모든 coding 작업 ticket화와 다른 최상위의 ticket 없는 수리·release 계약을 어떻게 맞추나
  - 선택지: 직접 수리 유지 / 준비 조사만 유지·작업 ticket화
  - 추천: ticket 준비 전 problem bundle 조사와 과거 기록 조회는 유지; 신규 code·고친 기록·release 준비는 현재 ticket claim 필수
  - 적용: coding 문서 적용; problems/repairs·apps/releases·lophn-agent 역할·flow 수정은 맡은 범위 밖
  - 근거: wf-common 결정16; coding-agent/tickets#R5,R16; coding-agent/mcp-server#R21,R25
- **redesign/coding-agent#Q20** [충돌] 정함: 기존 coding-agent/tickets#Q2의 ticket 없는 직접 수리 추천을 유지할까
  - 선택지: 직접 수리 / ticket 준비만·code 무착수
  - 추천: 결정16으로 기존 추천을 대체; reproduction 부족이면 담당 agent가 ticket 근거를 준비하고 code 작업하지 않음
  - 적용: 적용; 기존 issue 원문은 역사로 보존하며 이 row가 새 결정의 적용 범위
  - 근거: wf-common 결정16; issues/coding-agent__tickets.tsv Q2; coding-agent/tickets#R16
  - 결정: 2026-10-04 결정 16: ticket 없는 직접 coding 수리 추천은 폐기한다. reproduction 부족 때 준비와 code 착수를 분리하며 ticket readiness는 별도 열린 질문이다.
- **redesign/lophn-agent#Q7** [충돌] 근거 부족 repair 생성 금지와 모든 coding 일 ticket 원칙이 충돌한다
  - 선택지: 근거 부족은 ticket 없음; 준비 상태 ticket
  - 추천: 직접 요청·피드백도 ticket으로 남기고 미정·재현 부족을 준비 상태로 표시
  - 적용: 적용: lophn/AE 요구와 기본 ticket.create; ticket 준비 상태는 owner에 전파 필요
  - 근거: docs/requirements/lophn-agent/roles/lophn.md; docs/requirements/lophn-agent/roles/app-engineer.md; docs/requirements/coding-agent/tickets.md; docs/domain-model/coding-agent/tickets.md
- **redesign/lophn-agent#Q104** [충돌] 실행 준비된 ticket 채택 근거 요구와 모든 직접 요청 ticket의 상태를 구분해야 한다
  - 선택지: ticket 생성 보류; 준비 상태 생성
  - 추천: ticket 접수는 남기고 채택·검사 부족은 실행 미준비로 표시
  - 적용: 적용: AE R17; owner 준비 상태 전파 필요
  - 근거: docs/requirements/lophn-agent/roles/app-engineer.md; docs/requirements/coding-agent/tickets.md
- **redesign/lophn-agent#Q107** [충돌] coding-agent/tickets 현재 schema는 준비 상태 없이 채택 질문·검사 조건을 생성 필수로 요구한다
  - 선택지: 현재 생성 제한 유지; owner에 준비 상태 ticket 도입
  - 추천: 모든 직접 coding 일 ticket 원칙에 맞춰 owner가 접수·실행 준비를 분리; 빈 조건·가짜 채택 생성 금지
  - 적용: assigned 역할 요구에 준비 미완료 명시; owner schema 변경 미적용
  - 근거: docs/domain-model/coding-agent/tickets.md:20,58-60; docs/requirements/coding-agent/tickets.md; docs/requirements/lophn-agent/roles/lophn.md; docs/requirements/lophn-agent/roles/app-engineer.md
- **redesign/propagate#Q3** [충돌] 모든 coding 요청의 즉시 ticket 접수와 생성 필수 채택·acceptance check를 어떻게 분리할까?
  - 선택지: 접수 후 readiness / 생성 전 조사만 / 조건 자동 채우기
  - 추천: 접수와 실행 준비를 분리하고 가짜 채택·빈 조건 보충 금지; owner가 states/schema와 claim gating 확정
  - 적용: coding-agent 파일 수정 금지로 미적용; 새 flow는 준비된 ticket만 Start
  - 근거: coding-agent/tickets#R2,R3,R5,R6; lophn-agent/roles/lophn; lophn-agent/roles/app-engineer
- **redesign/propagate#Q4** [충돌] reproduction 없는 코드 수리의 ticket 준비와 보호된 사람 문제 확인을 어떻게 맞출까?
  - 선택지: ticket readiness 차단 / 사람이 정한 acceptance check 추가
  - 추천: ticket 없는 direct repair는 금지; 보호된 사람 확인을 유지하되 ticket owner의 reproduction 조건을 별도 결정
  - 적용: ticket 없는 신규 fallback 제거; 조건 완화 미적용
  - 근거: coding-agent/tickets#R9; problems/closing#R9; problems/repairs#R4

### coding-agent

- **architecture/coding-agent#Q1** [질문] repair context 조립과 ticket machine check를 어느 core 밖 프로세스가 수행할까
  - 선택지: MCP·CLI 각각 조립; coding-agent worker 하나
  - 추천: core가 감독하는 coding-agent worker 하나에서 공통 조립·check, MCP·CLI는 adapter
  - 적용: worker 하나
  - 근거: architecture/README#A2; coding-agent/repair-context#R1; coding-agent/tickets#R20
- **architecture/coding-agent#Q2** [질문] 근거가 가장 다른 발생의 결정적 비교를 어떻게 구현할까
  - 선택지: 가중 similarity; 고정 근거 fingerprint의 Hamming 거리
  - 추천: 고정 release·실패 command·snapshot evidence 종류·stack 위치 fingerprint의 항목 불일치 수, 동률 낮은 Report seq
  - 적용: 추천 적용
  - 근거: coding-agent/repair-context#R13; domain-model/coding-agent/repair-context#정할 것
- **architecture/coding-agent#Q3** [충돌] 기본 log·더 읽기·반환 절 상한이 requirements와 domain model에서 다르다
  - 선택지: 더 큰 domain 값; 두 상한의 교집합
  - 추천: 기본 log 45줄, more 5줄·20참조, return 4줄로 교집합 적용, 추가 log 200줄 유지
  - 적용: 더 좁은 상한 적용
  - 근거: coding-agent/repair-context#R8,R10; domain-model/coding-agent/repair-context#절 순서와 내용
- **architecture/coding-agent#Q4** [질문] OpenClaw gateway가 세션별 stdio 프로세스를 보장하지 않을 때 연결 방식을 어떻게 제공할까
  - 선택지: gateway 공유 stdio를 세션별로 오인; 세션 소유 stdio capability 확인 및 CLI fallback
  - 추천: 공식 mcp.servers 설정 조각은 제공하되 세션 소유·직접 tool loading을 doctor로 확인, 미확인 환경에는 CLI·skill 통로를 성공으로 따로 검사
  - 적용: 세션별 MCP 미확인은 unknown, CLI fallback
  - 근거: coding-agent/mcp-server#R1; coding-agent/connection#R1,R13; https://docs.openclaw.ai/tools/mcp
- **architecture/coding-agent#Q5** [질문] CLI 사람 command가 user token을 보관하지 않으면서 어떻게 사람 권한으로 요청할까
  - 선택지: CLI에 user token 파일; shell main broker
  - 추천: CLI는 confirmation window contract로 사람 요청을 전달하고 shell main이 인증된 호출·결과 전달, headless는 결정 링크만
  - 적용: user token 접근 없음
  - 근거: platform/identity#자격 보관; coding-agent/cli#R7,R8; shell/confirmation-window
- **architecture/coding-agent#Q6** [질문] MCP·CLI가 제출할 파일 경로를 사람 원본 임의 읽기와 어떻게 구별할까
  - 선택지: 무제한 allow-read; 명시 제출 workspace와 등록 source만 허용
  - 추천: lophn adapter는 명시 제출 파일만 읽고 앱 scope는 연결 source로 제한, symlink·운영 data·backup·추적 원본은 거절, 원본 자료는 고정 Version 참조로 제출
  - 적용: 무제한 파일 I/O 권한 제거
  - 근거: coding-agent/connection#R10; coding-agent/mcp-server#R13,R31; platform/identity#원본 차단
- **architecture/coding-agent#Q7** [질문] 일곱 제품의 변화하는 설치 경로와 최소 버전을 어떻게 고정할까
  - 선택지: 미검증 최신 설정도 성공; 설치 version별 capability 검사
  - 추천: 배포 adapter manifest에 확인한 제품 version·설정 schema·경로를 고정하고 네 단계 실제 loading을 별도 검사, 미지원 schema는 조각·수동 설치 안내만
  - 적용: 제품별 version 검사, trust 자동 확대 없음
  - 근거: coding-agent/connection#R12,R13; domain-model/coding-agent/connection#정할 것
- **check/coding-agent#Q1** [충돌] 정함: 사람 화면의 직접 ticket 생성에 전체 작성 양식이 필요했던 규칙이 정보 최소화와 충돌한다.
  - 선택지: 전체 양식; 기존 문제에서 입력 준비
  - 추천: 열린 문제 하나의 수리 입력을 자동 준비하되 기존 생성 검사·채택 답·고정 재현 기준을 유지하고 근거 부족과 새 구현은 App Engineer 대화로 연결한다.
  - 적용: 고침: tickets R26 추가, domain model 생성 불변 조건과 architecture 7.3 연결; 적용함: screen/app-detail#Q1
  - 근거: coding-agent/tickets#R2,R3,R9,R26; screen/app-detail#Q1; product#P17
  - 결정: 최근 결정 7: 전체 ticket 양식을 기본 노출하지 않고 필요한 결정만 받음
- **check/coding-agent#Q2** [충돌] 정함: claim과 내부 필드를 기본 화면에 보이면 최소 정보 원칙과 맞지 않는다.
  - 선택지: 내부 필드 노출; 영어 진행 라벨과 상세 펼치기
  - 추천: 여섯 domain 상태는 유지하고 영어 화면 말로 표현하며 기한·연결 ID·전체 조건·보고·원문 log는 기본에서 숨긴다.
  - 적용: 고침: tickets R27 추가, domain model 사람 화면 정책과 architecture 7.5 반영; 적용함: screen/app-detail#Q2
  - 근거: coding-agent/tickets#R19,R27; screen/app-detail#Q2; shell#I8,I9
  - 결정: 최근 결정 7: claim·안쪽 필드는 기본 화면에서 숨김
- **check/coding-agent#Q3** [충돌] repair context의 기본 log 200줄·반환 5줄과 여러 절의 빠진 상한이 requirements보다 크거나 불완전하다.
  - 선택지: 기존 domain 상한; requirements 상한
  - 추천: 기본 log45줄·반환4줄과 requirements의 모든 줄·문자·개수 상한을 함께 적용한다.
  - 적용: 고침: domain-model repair-context 절별 표·머리·summary 예산을 requirements에 맞춤
  - 근거: coding-agent/repair-context#R4,R5,R6,R7,R8,R9,R10,R11
- **check/coding-agent#Q4** [충돌] more 최대20참조와 failure_basis 항목별1줄은 requirements에 없는 추가 상한이다.
  - 선택지: 추가 상한 유지; 요구만 적용
  - 추천: more5줄·실패 invocation15줄을 적용하고 목록은 실제 추가 페이지로 잇는다.
  - 적용: 고침: domain model과 architecture에서 별도20참조·항목별1줄 제거
  - 근거: coding-agent/repair-context#R7,R10; architecture/coding-agent#5.6
- **check/coding-agent#Q5** [충돌] repair context domain model이 data fence와 부분 수집·미검증 표시를 빠뜨렸다.
  - 선택지: 느슨한 자료 구분; 명시 fence·한계
  - 추천: 자료를 명시 data fence에 두고 해석과 분리하며 한계를 reason·content·summary에 유지한다.
  - 적용: 고침: domain model redaction·데이터 정책 보완
  - 근거: coding-agent/repair-context#R18,R19
- **check/coding-agent#Q6** [충돌] daemon 주소 환경 설정의 우선순위가 architecture에는 있으나 connection 요구에는 빠졌다.
  - 선택지: 환경 설정 제거; 명시 옵션 다음 환경 설정
  - 추천: 명시 주소 옵션·환경 설정·현재 연결 정보·설치 설정·7431 순서를 같은 요구로 유지한다.
  - 적용: 고침: connection R15에서 환경 설정 순서 명시
  - 근거: coding-agent/connection#R15; architecture/coding-agent#2.1
- **check/coding-agent#Q7** [충돌] coding-agent connection token 발급·저장이 core transaction 안이고 token 위치도 platform 소유 contract와 다르다.
  - 선택지: core 발급·다른 위치; 인증 경계의 선행 보호 준비
  - 추천: 인증 경계에서 core 밖 보호 보관을 먼저 준비하고 command는 hash만 받아 원문 없는 결과를 반환한다.
  - 적용: 고침: connection domain command·표 설명, architecture 2.3·RPC·7.1을 platform 인증 contract와 credentials/connections 경로에 맞춤
  - 근거: platform/identity#R5; architecture/platform#5.6; coding-agent/connection#R17
  - 후속 기록: 2026-10-04 결정 19: harness 연결 선택 때 connection을 만들고 credential은 OS keychain에 둔다. MCP server 시작 때 keychain에서 꺼내며 설정 파일에 token을 쓰지 않는다. OS별 process-local 전달 구체는 redesign/propagate#Q2·redesign/coding-agent#Q13에 남긴다.
- **check/coding-agent#Q8** [충돌] CLI의 자체 secret lock·password unlock은 OS keychain 방식과 파일 볼트 폐기에 맞지 않는다.
  - 선택지: 자체 볼트 잠금; OS keychain 사용 가능 여부·OS 안내
  - 추천: 값 등록·삭제는 보호 화면, 잠김·누락은 OS 안내·unavailable로 처리한다.
  - 적용: 고침: cli R38과 architecture secrets command에서 자체 lock·unlock 제거
  - 근거: coding-agent/cli#R38; platform/secrets#R8; platform/secrets#버린 것
- **check/coding-agent#Q9** [충돌] 질문과 approval의 소유 concern 설명에 lophn-agent/questions가 두 번 쓰였다.
  - 선택지: 중복 소유 유지; platform/approvals 참조
  - 추천: 가역 질문은 questions, approval는 platform/approvals로 가리킨다.
  - 적용: 고침: cli R21·mcp-server R18 이유의 contract 참조 수정
  - 근거: coding-agent/cli#R21; coding-agent/mcp-server#R18; platform/approvals
- **check/coding-agent#Q10** [충돌] 새 mcp-server R34,R35의 blueprint 유래 read tool이 architecture 고정15개 목록에 반영되지 않았다.
  - 선택지: 고정 adapter만 제공; 동적 read tool 추가
  - 추천: app toolset에 scope 안 read·비confirm tool을 추가하고 판 변경 재검사·direct call·목록 갱신과 별도 schema 측정을 적용한다.
  - 적용: 고침: architecture 5.2·9에 동적 tool registry와 검증 추가
  - 근거: coding-agent/mcp-server#R34,R35; apps/runtime; coding-agent#I3
- **check/coding-agent#Q11** [충돌] 정함: read 효과라도 confirm이면 coding-agent 통로에서 거절해야 하고 secret 사용은 호출자 종류로 막으면 안 된다.
  - 선택지: 효과만 검사; effect·confirm·앱 grant 각각 검사
  - 추천: read·비confirm만 호출하되 secret 부착은 앱 grant·network host에 따르고 external·confirm automation 금지는 그대로 적용한다.
  - 적용: 고침: architecture 5.2에 최신 command effect·secret·automation contract 연결
  - 근거: coding-agent/mcp-server#R34; apps#I7; apps/automations#R13; wf-common#4,5,6
  - 결정: 최근 결정 4·6: secret은 caller 종류로 막지 않고 confirm 제한은 별개로 검사
- **check/coding-agent#Q12** [충돌] MCP 입력 표에 command input·environment·invocation ID·preview 참조·실제 test 입력·record_fix claim_seq가 누락됐다.
  - 선택지: 구현자 추측; 입력 목록 보완
  - 추천: 각 소유 contract 입력과 현재 claim 출처를 adapter 표에 명시한다.
  - 적용: 고침: architecture lophn_app·lophn_problem 입력 표 보완
  - 근거: coding-agent/mcp-server#R19,R25,R29; problems/tests; problems/repairs
- **check/coding-agent#Q13** [충돌] ticket check가 bundle hash만 맞는 다른 조건·다른 완료 보고의 Verification을 참조할 여지가 있다.
  - 선택지: bundle만 확인; 실제 조건 링크 확인
  - 추천: test_command의 TicketTestLink와 reproduction의 problem·고정 test·after release를 함께 비교한다.
  - 적용: 고침: tickets domain verification 제약과 architecture 7.5에서 소유 test contract의 조건·완료 seq 연결 명시
  - 근거: coding-agent/tickets#R18; problems/tests#TicketTestLink; problems/tests#Verification
- **check/coding-agent#Q14** [충돌] architecture 제작 흐름이 완료 보고 전 ticket test_command를 실행하고 수리 흐름이 준비 before/after release 전 reproduction을 실행할 수 있다.
  - 선택지: 기존 순서; 종류별 실제 전제 순서
  - 추천: app test 뒤 release 준비, 그 뒤 before/after reproduction, 완료 보고 뒤 completion_seq를 가진 test_command 검사 순서를 지킨다.
  - 적용: 고침: architecture 7.3·7.4·7.5 테스트 순서 수정
  - 근거: problems/tests#RequestTest; problems/tests#TicketTestLink; apps/releases; coding-agent/tickets#R18
- **check/coding-agent#Q15** [충돌] guides domain model에 hook 예산·timeout·빈 출력 예외와 서명·version/hash·release 제외 정책이 없다.
  - 선택지: architecture에만 유지; domain 정책 연결
  - 추천: guides R19,R20,R23,R24,R25의 정책을 domain model에도 명시한다.
  - 적용: 고침: guides domain 정책 추가
  - 근거: coding-agent/guides#R19,R20,R23,R24,R25
- **check/coding-agent#Q16** [충돌] inspect 공백 항목 거절과 고정 release source diff 내용이 하위 문서에 빠졌다.
  - 선택지: 빈 위치 허용·현재 source 대체; 요구에 맞춤
  - 추천: 공백 inspect 거절, 고정 release 변경 통계·관련 diff만 읽으며 보존 근거 없음을 표시한다.
  - 적용: 고침: tickets inspect 제약과 architecture 5.6 source diff 규칙 보완
  - 근거: coding-agent/tickets#R2; coding-agent/repair-context#R16
- **check/coding-agent#Q17** [충돌] architecture가 AGENTS.md에서 금지한 번역어를 썼다.
  - 선택지: 번역어 유지; leaf 사용
  - 추천: leaf concern으로 적는다.
  - 적용: 고침: architecture 배치표 뒤 표현 수정
  - 근거: AGENTS.md; architecture/coding-agent#4
- **check/coding-agent#Q18** [질문] repair 문제1~12개와 acceptance check 최대12개가 충돌한다. 문제11개부터 필수 app_test+문제별 reproduction+problems_closed가13개 이상이다.
  - 선택지: 수리 문제 최대10개; 조건 상한14개
  - 추천: 작은 ticket 원칙을 유지해 수리 문제를 최대10개로 줄이는 결정을 권한다. 요구 번호·기존 수치를 임의 선택하지 않고 남긴다.
  - 적용: 미적용: 사람 결정 필요
  - 근거: coding-agent/tickets#R2,R4,R9; domain-model/coding-agent/tickets#problems,conditions
- **check/coding-agent#Q19** [질문] app-detail은 증상만으로 repair ticket을 즉시 생성한다고 하지만 채택 답·고정 reproduction 없는 문제는 생성할 수 없다.
  - 선택지: 무조건 즉시 생성; 준비 가능한 경우만 생성·부족하면 App Engineer
  - 추천: 화면의 Create a task에 준비 중·근거 부족 갈래와 대화 연결을 추가하고 단순 증상만으로 test 기준을 창작하지 않는다고 적는다.
  - 적용: 미적용: screen·flow는 담당 밖; requirements R26에 방어 조건 반영
  - 근거: /home/pyosechang/projects/lophn/docs/screens/app-detail.md#Tasks; coding-agent/tickets#R3,R9,R26; lophn-agent/roles/app-engineer#R8,R16
- **check/coding-agent#Q20** [질문] app-detail 취소는 보호 화면 없이 바로 적용하나 architecture 7.6과 CLI 사람 결정은 confirmation window를 통해 취소한다.
  - 선택지: 취소도 보호 화면; 되돌릴 수 있는 user 취소의 신뢰 shell 경로
  - 추천: secret·승인과 다른 되돌릴 수 있는 ticket 취소가 shell main의 user 경로로 바로 가능한지 platform·shell에서 확인하고 계약을 통일한다.
  - 적용: 미적용: shell·platform·screen 결정 필요
  - 근거: /home/pyosechang/projects/lophn/docs/screens/app-detail.md#행동; coding-agent/tickets#R22; coding-agent/cli#R7; architecture/coding-agent#7.6; architecture/README#A8
- **check/coding-agent#Q21** [충돌] 첫 check-docs에서 기존 cli R19의 roles I4와 여러 다른 concern intent를 없는 약속으로 판정했으나 최종 검사에서는 모두 통과했다.
  - 선택지: 기존 의도 줄 변경; 병렬 변경 완료 뒤 재검사
  - 추천: 기존 의도 줄을 유지하고 최신 원 intent와 checker 결과를 확인한다.
  - 적용: 고침: 의도 줄 무변경, 최종 check-docs 오류0·경고1(의도 없는 요구6개); coding-agent 오류 없음
  - 근거: coding-agent/cli#R19; /home/pyosechang/projects/lophn/tools/check-docs.ts#readPromises; docs/intent/lophn-agent/roles.md

### coding-agent/harnesses

- **redesign/coding-agent#Q1** [질문] 기본 harness가 비었을 때 후보 순서를 고정할까
  - 선택지: 고정 제품 우선순위 / 유일한 후보 제안·복수 chooser
  - 추천: nullable 선택 유지; 설치·TUI 사용 가능한 후보 하나만 제안하고 여러 개면 사람 선택
  - 적용: 적용; 저장 선택 unavailable은 자동 fallback하지 않음
  - 근거: wf-common 결정18; research/harness-catalog.md 7장 default 질문; coding-agent/harnesses#R5
- **redesign/coding-agent#Q2** [질문] enabled=false가 제거·회수를 뜻하나
  - 선택지: 선택 후보 제외 / uninstall / revoke
  - 추천: 선택·launcher 후보 제외만, uninstall/revoke 별도
  - 적용: 적용
  - 근거: 연구 7장 enabled 질문; domain-model/coding-agent/harnesses 정책
- **redesign/coding-agent#Q3** [질문] custom executable와 profile을 어느 범위로 지원할까
  - 선택지: 미지원 / command override만 / explicit profile
  - 추천: 명시 profile identity와 executable·환경 이름·effective config roots를 나누며 임의 shell 문자열은 거절
  - 적용: 적용; profile의 settings 저장 contract는 다른 워커 범위
  - 근거: 연구 7장 custom profile 질문; coding-agent/harnesses#R4
- **redesign/coding-agent#Q4** [질문] unknown version에 어떤 hook을 설치할까
  - 선택지: 최신 event 추정 / 검증 conservative subset / 미설치
  - 추천: 검증 conservative subset 또는 조각 안내; 검증 subset 없으면 미설치·unknown
  - 적용: 적용; upstream source만으로 검증 version을 만들어 넣지 않음
  - 근거: 연구 7장 unknown version hook 질문; coding-agent/harnesses#R11
- **redesign/coding-agent#Q6** [질문] persistent config와 runtime MCP injection을 어떻게 나눌까
  - 선택지: 모두 파일 / 모두 runtime / adapter별 capability
  - 추천: capability를 나누고 현재 일곱 persistent adapter 계약 유지; runtime injection은 현재 실행에 열지 않음
  - 적용: 적용; Codex TOML 조각·OpenClaw stdio 미확인 유지
  - 근거: 연구 7장 MCP 방식 질문; architecture/coding-agent.md 5.5
- **redesign/coding-agent#Q7** [질문] 감지 cache와 version/auth probe의 budget은 무엇인가
  - 선택지: 고정 TTL / identity invalidation·사람 refresh
  - 추천: TTL 없음·env/profile/catalog generation invalidate·명시 refresh; 별도 version/auth probe 5초·64KiB, fallback alias hop8
  - 적용: 추천 값 적용; filesystem lookup과 별도 검사 level 구별; shell RC PATH hydration 실행 안 함
  - 근거: 연구 7장 cache TTL 질문; 연구 O7/P5; domain-model/coding-agent/harnesses
- **redesign/coding-agent#Q8** [질문] receipt/journal 저장 실패와 설치 partial을 어떻게 처리할까
  - 선택지: 성공 표시 / 전체 rollback / component별 partial·recovery
  - 추천: 실제 commit과 component별 partial을 기록하고 journal/hash 재검사로 ownership 복구 전 갱신·제거 금지
  - 적용: 적용; multi-file 원자성 주장 없음
  - 근거: 연구 7장 receipt 실패 질문; coding-agent/harnesses#R9
- **redesign/coding-agent#Q16** [빠짐] harness 선택·profile·native path 설정을 어디에 저장하나
  - 선택지: catalog 수정 / 신규 ledger / 기존 settings
  - 추천: platform/settings 재사용, choice와 machine-local profile/env path 분리; 감지가 저장 선택을 지우지 않음
  - 적용: coding 문서 참조 적용; settings entity/schema는 다른 워커 범위
  - 근거: 연구 7장 custom/default/cache 질문; wf-common 결정18; platform/settings
- **redesign/coding-agent#Q19** [충돌] Codex 연결 선택 뒤 MCP 자동 설치 결정과 TOML 조각 출력 보존 계약을 어떻게 맞추나
  - 선택지: Codex TOML 자동 쓰기 / 조각·수동 적용 유지
  - 추천: 지정된 기존 adapter 위치·manifest 계약을 우선 보존하여 Codex MCP는 조각·안내, skill은 선택 target에 설치; loading 미확인은 unknown
  - 적용: 적용; Codex 연결은 다른 제품처럼 무조건 자동 MCP 완료라 표시하지 않음
  - 근거: computed task 1번 위치·manifest 유지; 연구 6장3; guides#R18; wf-common 결정19

### coding-agent/sessions

- **redesign/coding-agent#Q9** [범위] 사람 [Start]와 TUI 관측을 coding-agent intent가 명시적으로 덮는가
  - 선택지: I1/I4 연동 구현으로 수용 / 별도 intent 약속 추가
  - 추천: I1/I4로 사람 시작·지정 ticket을 연결하되 새로운 자동 시작은 금지; 사람의 intent 검수에 범위 명시
  - 적용: requirements 연결 적용; intent는 수정하지 않음
  - 근거: coding-agent#I1,I4,I6; intent 하지 않는 것 자동 시작 금지; wf-common 결정17
- **redesign/coding-agent#Q10** [질문] readiness·native ID 검증 상한과 resume 공개 범위를 정할까
  - 선택지: 자동 resume / 사람 새 시작 / catalog capability만
  - 추천: readiness10초·ID1024 code point 검증; resume capability만 catalog에 두고 현재 자동/새 resume 명령은 열지 않음
  - 적용: 추천 값 적용; pi transcriptPath 필요; Hermes/OpenClaw 미검증은 unknown
  - 근거: 연구 7장 launch/resume 질문; 연구 3.2; coding-agent/sessions#R5,R7,R10
- **redesign/coding-agent#Q11** [빠짐] ticket 앱의 연결 source가 project에 속하지 않거나 project 폴더가 여러 개인 경우 [Start] cwd를 어떻게 정하나
  - 선택지: 임의 source cwd / project 연결 안내·폴더 선택
  - 추천: 등록 project와 연결 source 관계를 검사하고 여러 폴더는 사람 선택; 없으면 연결 안내·무시작
  - 적용: 적용; project/app 관계 해석과 terminal start contract는 shell/apps/documents에 전파 필요
  - 근거: coding-agent/sessions#R3; documents/projects; apps/registration; shell/terminal
- **redesign/coding-agent#Q18** [범위] 정함: local session observation에 durable execution intent를 추가할까
  - 선택지: 새 ledger session/job / derived만
  - 추천: 관측은 derived; headless·자동 시작·coordinator authority가 열릴 때만 durable intent 별도 설계
  - 적용: 적용; 새 entity·ledger 표 없음
  - 근거: wf-common 결정17,18; 연구 7장 session observation 질문; product P2,P7
  - 결정: 2026-10-04 결정 17·18: 현재 session 관측은 derived이며 새 ledger session/job 표를 두지 않는다. headless·자동 시작·coordinator는 나중 설계한다.
- **redesign/lophn-agent#Q12** [범위] coding agent Start와 MCP 연결 설치·credential은 lophn agent tool이 아니다
  - 선택지: agent 시작 tool; 사람 Start
  - 추천: coding-agent/sessions가 사람 Start·project terminal TUI·첫 prompt를 담당; connection/harnesses가 설치·keychain 처리
  - 적용: 미적용: owner와 흐름 전파 필요; assigned 역할은 ticket 생성만
  - 근거: docs/requirements/coding-agent/sessions.md; docs/domain-model/coding-agent/sessions.md; docs/architecture/coding-agent.md; docs/flows/new-app.md; docs/flows/change-app.md; docs/flows/app-broken.md; docs/flows/manage-tickets.md
- **redesign/propagate#Q7** [충돌] 새 앱의 [Start]는 source→project 연결을 요구하지만 source 연결은 첫 coding 작업에서 준비한다. 최초 연결을 어느 단계에서 만들까?
  - 선택지: 사람이 Start 전 source 연결 / 자기 터미널 bootstrap / launch plan의 별도 explicit project 계약
  - 추천: 사람의 기존 project/source 연결이 있으면 Start; 없으면 추측 없이 준비 차단·직접 터미널 안내. sessions owner가 bootstrap 계약 확정
  - 적용: 새 app flow에 명시; owner 문서 변경 안 함
  - 근거: coding-agent/sessions#R3,R4; flows/new-app; apps/registration

## shell (46)

### shell/app-frame

- **shell/app-frame#Q1** [질문] 문서 session을 고정 판마다 나눌까, 문서 단위로 공유할까?
  - 선택지: 고정 판별;문서별
  - 추천: 고정 판별 메모리 session을 유지한다.
  - 적용: R1·R8·R10
- **shell/app-frame#Q2** [충돌] R25 전체 본문·R27 문서와 나란히 금지·R28 focus native view만 표시가 shell I7과 부딪힌다
  - 선택지: 옛 제한 유지 / intent에 맞춰 각 경계 동시 표시
  - 추천: 앱 공간·패널·카드의 본문 경계 안에서 동시에 표시하고 focus는 하나
  - 적용: intent에 맞춰 고침
  - 근거: shell#I7; shell/app-frame#R25,R27,R28

### shell/confirmation-window

- **shell/confirmation-window#Q1** [질문] TTY의 직접 확인도 사람 승인으로 인정할까(H5)?
  - 선택지: confirmation window만;TTY 증거 추가
  - 추천: confirmation window만 유지하고 CLI는 보호 화면을 여는 안내만 제공한다.
  - 적용: R1
- **shell/confirmation-window#Q2** [질문] MCP sampling·elicitation을 승인 흐름에 쓸까?
  - 선택지: 사용하지 않음;보호 화면 열기 안내만
  - 추천: MCP는 승인할 수 없고 필요하면 confirmation window를 여는 안내만 한다.
  - 적용: R1
- **shell/confirmation-window#Q3** [질문] 앱 동작 전후를 설명·안전 preview 중 무엇으로 보여 줄까?
  - 선택지: 설명;격리 preview;둘 다
  - 추천: 설명을 기본으로 하고 안전 preview가 제공되는 경우에만 추가한다.
  - 적용: R10

### shell/design-system

- **shell/design-system#Q1** [질문] UI customization을 token override만 둘까, slot·fork까지 제공할까?
  - 선택지: token만;slot·fork도
  - 추천: 초기 token override만 제공하고 실제 두 번째 소비자와 앱 SDK 사례 뒤 slot·fork 계약을 정한다.
  - 적용: R3·R4의 token override
- **shell/design-system#Q2** [질문] 앱별 theme 예외와 오래된 SDK의 시각 drift를 어디까지 허용할까?
  - 선택지: 전역 일치 강제;앱 고정 version 유지
  - 추천: apps/sdk의 version 고정을 존중하고 전역 override는 공통으로 존재하는 token에만 적용한다.
  - 적용: 앱별 강제 SDK 변경 없음
- **shell/design-system#Q3** [충돌] 1280px 분할의 읽기 폭은 원문 표 456px인가, 여백 규칙대로 488px인가?
  - 선택지: 456px;488px
  - 추천: 칸 폭 기준16px 여백으로 488px를 사용한다.
  - 적용: R42
- **shell/design-system#Q4** [질문] UI 구현 재료를 CSS Modules·Radix Primitives·Lucide로 유지할까?
  - 선택지: 기존 재료;동등 primitive
  - 추천: 기존 재료로 시작하고 동등 접근성 근거가 있을 때만 교체한다.
  - 적용: R44
- **shell/design-system#Q5** [질문] 입력 경계 대비 1.8:1을 3:1로 강화할까?
  - 선택지: 색 강화;라벨·배경으로 보완
  - 추천: 기존 색표는 유지하되 입력 식별이 필요한 경계·focus의3:1을 검사하고 부족한 경우 보완 또는 강화한다.
  - 적용: R43
- **shell/design-system#Q6** [질문] system font 기본 선택·global compact·사용자 accent 변경을 허용할까?
  - 선택지: 기본 그대로;각각 선택 지원
  - 추천: Pretendard 기본·표만 compact·검증된 전역 accent override로 시작한다.
  - 적용: R45

### shell/desktop

- **shell/desktop#Q1** [질문] Electron·Deno·SQLite 기술 선택을 유지할까(H6)?
  - 선택지: 유지;대체
  - 추천: 기존 기술 선택 유지
  - 적용: R11·R17
- **shell/desktop#Q2** [충돌] 전역 팔레트와 런처 복귀 shortcut의 범위·기능을 구별할까?
  - 선택지: 서로 구별;하나로 통합
  - 추천: 전역 팔레트 Shift+K와 창 안 런처 Shift+L을 구별한다.
  - 적용: R18

### shell

- **architecture/shell#Q1** [질문] confirmation handle의 기한·전송·재시작 무효화는 무엇인가
  - 선택지: 인증된 main 연결 등록·소비 / 서명 증거
  - 추천: core 메모리 등록·결정 transaction 소비, 32 bytes 무작위, 120초와 대상 기한 중 이른 시각, epoch·main·window·대상·내용·결정 결합
  - 적용: 예; platform 담당과 조율하여 인증된 main 연결 등록·소비를 적용
  - 근거: platform/identity#정할 것; platform/approvals#정할 것; shell/confirmation-window#R9
- **architecture/shell#Q2** [충돌] 직전 architecture 앱 메모리 session 추천과 현재 앱 지속 session 요구가 다름
  - 선택지: 메모리 / 앱별 persistent
  - 추천: 현재 요구 우선; live 앱별 persistent, preview bundle별 별도 persistent, 문서 version별 메모리
  - 적용: 예
  - 근거: 직전 architecture/shell#3.2; shell/app-frame#R1,R8,R10
- **architecture/shell#Q3** [충돌] shell/editor가 유휴 2분·800ms를 documents/file-tracking 소유 숫자로 가리키지만 현 documents 요구·domain에 그 값이 없음
  - 선택지: documents에 timer 규칙 추가 / shell timer / 소유자 결과만 소비
  - 추천: shell은 timer를 복제하지 않고 documents의 편집 종료·명시 저장·실제 결과만 소비; 숫자 결정은 documents에서 정리
  - 적용: 예; shell architecture에서 숫자를 고정하지 않음
  - 근거: shell/editor#R1,R2; documents/file-tracking#R4,R17; domain-model/documents/file-tracking#정책
- **architecture/shell#Q4** [질문] OS notification 기본 정책과 정보 최소 범위를 무엇으로 둘까
  - 선택지: 기본 on / opt-in / 창 안만
  - 추천: opt-in, lophn·확인할 일이 있습니다만 OS 표시, notification ID 클릭은 읽음·결정 없이 화면 열기, backlog 재생 없음
  - 적용: 예
  - 근거: platform/notifications#정할 것; shell/desktop#R7,R10,R11
- **architecture/shell#Q5** [질문] feedback 캡처 binding과 최종 redaction 결과를 어떻게 묶을까
  - 선택지: 페이지가 주장 / main 메모리 binding / 영구 capture ledger
  - 추천: main이 button 시점 view·generation·app·release·mode·surface·시각과 raw·redacted hash를 메모리 draftRef에 묶고 최종 선택 전달; 캡처 1500ms 실패는 첨부만 제외
  - 적용: 예
  - 근거: problems/feedback#정할 것; shell/app-frame#R31,R32
- **check/shell#Q1** [충돌] ux가 요구하는 ICU·Intl·message key 패턴이 shell/wording 요구에 없다.
  - 선택지: 추천안 적용 / 방법만 유지
  - 추천: ux 추천을 현재 마지막 R13 다음 R14로 추가한다.
  - 적용: 고침: shell/wording#R14 추가; architecture의 en catalog·ICU·Intl 경계 반영; 적용함: ux#Q1
  - 근거: shell/wording#R1,R3,R7,R14; screens/README.md#4; ux#Q1
- **check/shell#Q2** [충돌] agent 자유 글까지 en message key로 만들라는 wording#R11은 미리 정의되지 않은 글을 catalog에 넣게 한다.
  - 선택지: 고정 문구만 key / 모든 글 key
  - 추천: 고정 틀만 key로 관리하고 자유 글은 en 화면 말 규칙만 지킨다.
  - 적용: 고침: shell/wording#R11과 architecture 문구 검사에서 고정 틀·자유 글 구별
  - 근거: shell/wording#R11; screens/README.md#4; shell#I9
- **check/shell#Q3** [충돌] 정함: architecture의 한국어 합니다체·OS 한국어 문구·release/run/watch 노출 허용이 en 화면 말 규칙과 다르다.
  - 선택지: en 사용자 언어 / 기술 용어 그대로
  - 추천: 고정 문구는 en catalog, 내부 이름은 문서·코드·별도 개발자 diagnostics만 허용한다.
  - 적용: 고침: architecture 문구 검사·OS 최소 본문을 en message key로 변경
  - 근거: shell#I8,I9; shell/wording#R1,R2,R6,R7,R13; architecture/shell#디자인·문구 검사
  - 결정: 최근 결정 7: en/message key와 사용자용 말, 안쪽 이름 기본 노출 금지
- **check/shell#Q4** [충돌] 정함: architecture 보호 화면은 주체·시각·이유·근거를 기본에 전부 보여 새 requirements의 결정 중심 순서와 다르다.
  - 선택지: 새 requirements / 기존 상세 순서
  - 추천: 대상·변경 → 영향·위험 → revert 가능 → 결정만 기본에 보이고 나머지는 Details에 둔다.
  - 적용: 고침: architecture confirmation 표시 순서·좁은 창 배치
  - 근거: shell/confirmation-window#R2,R3; shell#I8
  - 결정: 최근 결정 7: confirmation의 결정 정보만 기본에, 나머지는 Details
- **check/shell#Q5** [충돌] 정함: confirmation.open의 부모 창이 선택 입력이라 부모 없는 보호 창을 허용한다.
  - 선택지: 부모 필수 / 별도 최상위 보호 창
  - 추천: 실제 요청 창을 부모 필수 입력으로 검증한다.
  - 적용: 고침: architecture confirmation.open parentWindow 필수
  - 근거: shell/confirmation-window#R6; architecture/shell#5.1; 최근 결정 1
  - 결정: 최근 결정 1: 요청 창을 parent로 하는 child modal BrowserWindow
- **check/shell#Q6** [충돌] architecture overlay는 tooltip·경계 drag도 keyboard focus를 가져가고 단일 사각형만 설명하여 dialog 안 menu 층이 빠졌다.
  - 선택지: 표면별 focus / 모든 overlay focus
  - 추천: 조작 표면만 focus를 받고 tooltip·drag·notification은 focus를 빼앗지 않으며 같은 overlay 안 sibling DOM으로 층을 유지한다.
  - 적용: 고침: architecture overlay focus·role·sheet·sibling 경계
  - 근거: shell/design-system#R2,R20; shell/app-frame#R24,R29; shell/desktop#R10
- **check/shell#Q7** [충돌] 정함: architecture 좁은 창 운영 패널은 본문 전체 overlay라 앱의 남은 표시 영역을 설명하지 않는다.
  - 선택지: 남은 영역 bounds / 앱 숨김
  - 추천: 720px 패널의 overlay는 앱 view를 숨기지 않고 남은 영역 bounds로 줄인다.
  - 적용: 고침: architecture 앱 운영 패널 배치와 닫힘 복원
  - 근거: shell/app-frame#R26,R36; 최근 결정 2
  - 결정: 최근 결정 2: overlay가 떠도 앱 view를 숨기지 않음
- **check/shell#Q8** [충돌] shell/editor 확인에 documents가 정하지 않은 유휴 2분·800ms가 소유자의 숫자처럼 남아 있다.
  - 선택지: 숫자 삭제 / documents 새 timer
  - 추천: 정하지 않은 숫자를 빼고 소유자의 실제 편집 종료·결과만 소비한다.
  - 적용: 고침: shell/editor#R1,R2의 유휴 2분·800ms 삭제; 의도 줄·번호 유지
  - 근거: shell/editor#R1,R2; documents/file-tracking#R4,R17; domain-model/documents/file-tracking#정책
- **check/shell#Q9** [충돌] 정함: shell/editor는 머리 메타 줄에 저장의 모든 단계를 보이게 하여 documents/file-tracking#R15와 P17에 어긋난다.
  - 선택지: 현재 결과와 Details / 모든 단계 기본
  - 추천: 각 완료 사실은 구별하되 기본은 현재 결과·다음 행동만, 단계별 결과는 Details로 둔다.
  - 적용: 고침: shell/editor#R2,R12와 architecture 문서 저장 presenter
  - 근거: shell#I5,I8; shell/editor#R2,R12; documents/file-tracking#R15; product#P17
  - 결정: 최근 결정 7: 저장 단계는 구별하되 지금 결과·다음 행동만 기본 노출
- **check/shell#Q10** [충돌] shell/desktop#R17 build 요구에 의도 줄이 빠졌다.
  - 선택지: 가장 가까운 shell intent / 미연결 유지
  - 추천: shell의 일관된 데스크톱·공용 SDK 목적에 연결한다.
  - 적용: 고침: shell/desktop#R17에 shell#I1,I2 의도 추가
  - 근거: shell/desktop#R17; shell#I1,I2
- **check/shell#Q11** [충돌] workspace domain의 분할 비율 0.2~0.8이 요구에 없는 배치 제한이고 정보 패널 열림·마지막 탭 복원이 domain에서 빠졌다.
  - 선택지: 요구 최소 폭과 패널 선택 / 임의 비율 상한
  - 추천: 유한 0~1 비율과 두 칸 480px 기준만 쓰고 information_panel 값을 추가한다.
  - 적용: 고침: workspace domain split_ratio·information_panel·폭과 focus·임시 패널 복원 정책; architecture layout adapter 소유 일치
  - 근거: shell/workspace#R3,R4,R6; shell/editor#R6; shell/desktop#R2,R29; domain-model/shell/workspace
- **check/shell#Q12** [충돌] terminal domain에 requirements가 정하지 않은 500열·300행 제한이 있고 시작 실패 설명 필드·폴더 선택·OS shell·종료 취소 정책이 빠졌다.
  - 선택지: 요구의 실제 경계 / 추가 고정 상한
  - 추천: 양수 정수 치수만 유지하고 안전 failure_reason·시작과 종료 확인 정책을 반영한다.
  - 적용: 고침: terminal domain 치수·failure_reason·시작·종료 정책·종료 확인 뒤 재시작 전이
  - 근거: shell/terminal#R1,R2,R4,R6,R9,R10; domain-model/shell/terminal
- **check/shell#Q13** [충돌] architecture는 앱·문서의 browser worker를 첫 구현에서 일괄 금지하지만 해당 requirements에는 이 금지가 없다.
  - 선택지: 기존 sandbox·network 강제 / 새 금지 요구
  - 추천: worker에도 기존 Node integration·CSP·network 경계를 적용하고 별도 일괄 금지를 만들지 않는다.
  - 적용: 고침: architecture 앱·문서 worker blanket 금지 제거
  - 근거: shell/app-frame#R2,R3,R16,R17; architecture/shell#5.2
- **check/shell#Q14** [충돌] architecture feedback에서 이미 보호 창/dialog가 열린 캡처 제외 조건과 전체 3MiB 한도가 빠지고 raw가 feedback renderer 메모리에도 있는 것처럼 보인다.
  - 선택지: 소유 요구 모두 반영 / 부분 한도
  - 추천: 캡처 제외 조건·redaction 뒤 글·전체 한도를 소유 요구로 가리키고 raw는 main·문제 보고 경계만 보유한다.
  - 적용: 고침: architecture feedback binding·3145728 bytes 총량·raw 메모리 소유
  - 근거: shell/app-frame#R31,R32; problems/feedback#R1,R5,R9; architecture/shell#3,#5.2
- **check/shell#Q15** [충돌] architecture에서 최신 secret grant·effect·automation 의미와 전역 UX/정적 screen/flow 정본 구분을 확인하기 어렵다.
  - 선택지: 소유 요구 참조 / shell에서 재정의
  - 추천: 앱 통로의 effect·grant를 그대로 소비하고 shell 화면이 새 caller approval이나 자동화 금지를 만들지 않으며 UX·값·화면·flow 정본을 구별한다.
  - 적용: 고침: architecture 앱 통로 소비 경계·전역 UX/정적 screen/flow 정본 설명; harness I7 미변경
  - 근거: shell#I8,I9; apps#I7; apps/automations; apps/blueprint; docs/README.md; 최근 결정 4~8
  - 후속 기록: 2026-10-04 결정 8: 역사 기록의 harness I7 미변경은 당시 상태다. 현재 I7은 삭제되고 secret 약속은 platform#I8이 맡는다. screen 정적 명세는 없고 전역 규칙은 docs/ui-ux/README.md다.
- **check/shell#Q16** [충돌] screen/roles#Q2가 전제한 회수된 담당의 새 대화 금지 표시가 shell/desktop에서는 암묵적이다.
  - 선택지: 소유 정책으로 input gate / shell 새 업무 규칙
  - 추천: 회수된 담당에는 지난 대화만 표시하고 멈춘 담당의 가능 여부는 소유 정책에 맡긴다.
  - 적용: 고침: shell/desktop#R4와 architecture 역할 input gate; 적용함: screen/roles#Q2 중 shell 표시 경계
  - 근거: shell/desktop#R4; lophn-agent/assignments#R9; screen/roles#Q2
- **check/shell#Q17** [질문] screen/roles#Q2 추천은 paused가 대화를 받는다고 하지만 현재 lophn-agent/assignments#R9는 멈춘 책임이 새 요청을 받지 않는다고 한다.
  - 선택지: paused 과거 대화만 / paused 새 대화 허용
  - 추천: 새 대화와 새 요청의 차이를 lophn-agent 소유자가 먼저 정리하고 shell은 현재 허용 결과를 표시한다.
  - 적용: 미적용: 다른 최상위 업무 정책과 screen은 수정하지 않음
  - 근거: screen/roles#Q2; lophn-agent/assignments#R9; shell/desktop#R4; screens/roles
- **check/shell#Q18** [질문] CLI에서 Electron 창이 전혀 없는 상태로 confirmation을 요청할 때 요청 부모 창을 무엇으로 잡는가.
  - 선택지: 사람이 shell 창을 열 때까지 링크만 / 고정 shell 부모 창 자동 생성
  - 추천: 창 없는 CLI/headless는 링크만 반환하고 사람이 대상 화면을 연 뒤 그 창을 부모로 삼는 경로를 coding-agent와 shell screen에서 연결한다.
  - 적용: 미적용: 다른 최상위·flow·screen에서 경로 확인 필요
  - 근거: shell/confirmation-window#R6; coding-agent/cli#R7; architecture/shell#5.1
- **check/shell#Q19** [질문] ICU key 요구 적용 뒤 일부 screen key는 확인 예제와 다르게 자리 없이 쓰이거나 중간 segment가 더 많다.
  - 선택지: part를 여러 segment 허용 / 엄격한 3 segment
  - 추천: part가 계층 이름을 포함할 수 있는지 key validator에서 정하고 모든 screen key를 같은 규칙으로 맞춘다.
  - 적용: 미적용: screen 파일 수정 범위 밖; ux#Q1 요구는 마지막 R14로 적용
  - 근거: shell/wording#R14; screens/README.md#4; screens/confirmation-window#문구; screens/project-workspace#문구; ux#Q1
- **check/shell#Q20** [질문] project-workspace·document screen의 연결 끊김 문구는 provider와 core 단절을 구별하지 않아 core가 끊겨도 디스크 저장이 계속되는 것으로 읽힌다.
  - 선택지: provider/core 구별 / 항상 편집 저장 가능
  - 추천: provider 단절에서는 로컬 파일 작업을 유지하고 core 단절에서는 초안·마지막 read·터미널을 유지하되 documents/file-tracking의 새 파일 쓰기 gate를 닫는 차이를 screen에 반영한다.
  - 적용: 미적용: screen 수정 범위 밖; shell architecture의 core 단절 gate는 유지
  - 근거: screens/project-workspace#상태; screens/document#상태; domain-model/documents/file-tracking#단절; architecture/shell#8; platform#I6

### shell/workspace

- **shell/workspace#Q1** [질문] 탭 배치·복원 상태를 ledger에 둘까 사람 UI 상태로 따로 둘까
  - 선택지: ledger 표 / 기존 shell layout.json
  - 추천: 기존 shell/layout.json에 프로젝트별 UI 값; 정본 내용·credential·PTY runtime 없음
  - 적용: 예; requirements R6~R8·domain model·architecture 적용
  - 근거: shell#I7; architecture/shell#3
- **shell/workspace#Q2** [질문] 현재 보기 요약의 크기와 탭 상세 page 크기를 무엇으로 할까
  - 선택지: 모든 내용 / 참조 요약과 상세 읽기
  - 추천: UTF-8 2KiB 요약·20개 탭 page; 선택 범위와 앱 화면 참조만, 상세 앱 read command
  - 적용: 예; requirements R9~R11·domain model·architecture 적용
  - 근거: shell#I7; lophn-agent/harness#I10; apps#I12
- **shell/workspace#Q3** [질문] 세션 시각 블록을 shell에 어떻게 그릴까
  - 선택지: 임의 HTML 실행 / 설치 SDK 선언형 registry와 기존 격리 view
  - 추천: 선언형 SDK부터; 문서는 고정 view·앱 카드는 기존 앱 frame sandbox
  - 적용: 예; requirements R12~R13·architecture 적용
  - 근거: shell#I2; lophn-agent#I9,I10; apps#I10

### shell/terminal

- **shell/terminal#Q1** [질문] PTY를 어느 프로세스가 소유할까
  - 선택지: main 직접 / core worker / main 감독 별도 terminal host
  - 추천: main이 감독하는 terminal host; node-pty POSIX PTY·Windows ConPTY; 출력 메모리
  - 적용: 예; domain model·architecture 적용
  - 근거: shell#I7; platform#I3
- **shell/terminal#Q2** [질문] 터미널 shell·출력 보존의 첫 값은 무엇으로 할까
  - 선택지: OS 사용자 shell / 고정 bash; disk 기록 / 메모리 buffer
  - 추천: 사용자 login shell·Windows PowerShell 7 또는 5.1; 최근 10,000줄·5MiB 메모리, 재시작은 종료 placeholder
  - 적용: 예; requirements R4,R7~R9·domain model 적용
  - 근거: shell#I7; platform#I2
- **shell/terminal#Q3** [질문] 나중에 lophn agent가 Orca의 orchestration처럼 터미널의 coding agent를 지휘하게 할 수도 있다(K6과 관계)
  - 선택지: 후속 논의
  - 추천: 지금은 정하지 않음
  - 적용: 아니오; 제어 contract·허락 모델·agent 관계는 문서에 정하지 않음
  - 근거: lophn-agent/roles#하지 않는 것; K6

### shell/wording

- **ux#Q1** [빠짐] shell/wording이 en-only 시작과 message key를 요구하지만 key 이름 규칙, ICU MessageFormat, 날짜·숫자·상대 시각의 Intl 사용은 어디에도 정해져 있지 않다. screens/README.md#4가 방법을 먼저 정했으니 요구로도 고정할까?
  - 선택지: A. shell/wording에 새 요구를 추가한다 / B. screens/README.md의 방법만으로 충분하다고 보고 요구를 추가하지 않는다
  - 추천: A. 다음 요구를 shell/wording에 추가한다: "**[R16]** 화면 message key는 `<screen>.<part>.<name>` 패턴을 쓰고 en 문구는 ICU MessageFormat으로 작성하여 이름·숫자 placeholder와 복수형을 처리하며 날짜·숫자·상대 시각은 Intl.DateTimeFormat·Intl.NumberFormat·Intl.RelativeTimeFormat으로 formatting하고 직접 문자열을 계산해 붙이지 않는다." 이유: key 패턴과 formatting 방법이 없으면 다른 언어를 더할 때 화면마다 다른 방식으로 짜여 있을 위험이 있다. 확인: 모든 message key가 그 패턴이고 날짜·숫자·상대 시각이 Intl 호출로만 나온다. 의도: shell#I9
  - 적용: TSV에 적용 기록 없음
  - 근거: shell/wording
  - 후속 기록: check/shell#Q1에서 shell/wording#R14로 적용함(R16 제안은 당시 번호); check/shell#Q19의 key segment 규칙은 열린 채 유지
- **redesign/propagate#Q6** [범위] 새 Preset·Instructions·Start의 화면 wording/진입점은 어디서 확정할까?
  - 선택지: 전역 README 변경 / concern 계약과 flow만
  - 추천: docs/ui-ux/README.md는 수정하지 않고 기존 정보 최소화·en 원칙 유지
  - 적용: 기존 global UI 규칙 유지; 필요 화면 vocabulary 목록만 기록
  - 근거: shell/editor#R17; shell/terminal#R12; lophn-agent/instructions#R2

## domain model 사이 (14)

### domain model 사이

- **dm#C1** [충돌] RunSource.assignment_revision이 seq인데 Assignment.revision은 1부터 늘어나는 정수
  - 선택지: run-loop를 정수로 / assignments를 seq로
  - 추천: run-loop를 정수로
  - 적용: 해결: run·context basis를 정수 revision으로 맞춤
- **dm#C2** [충돌] tool 이름 표기(역할 파일은 document.save_version 같은 점 표기 제안)와 harness/tools 목록의 이름 규칙
  - 선택지: 점 표기로 통일 / tools.md 규칙으로
  - 추천: tools.md가 정한 규칙으로 역할 파일을 맞춤
  - 적용: 해결: 내장 tool 이름 점 표기로 통일
- **dm#C3** [충돌] approval 한 번 사용(approval_uses)을 apps/invocations·permissions·releases·lophn-agent/assignments가 같은 공통 함수로 써야 함
  - 선택지: 각 파일에 명시 / ledger 공통 command로
  - 추천: platform/approvals의 공통 규칙을 각 파일이 가리키게
- **dm#C4** [충돌] notification 조건 근거(운영 보고인지, machine pause인지, watch 확정)를 각 event payload가 실어야 함
  - 선택지: 각 event payload에 필드 추가
  - 추천: 각 소유 파일에 필드 추가
- **dm#C5** [충돌] revert의 영역별 이전 값·현재 CAS·복원 뒤 의존 검사, 원본 연결 문서의 파일 반영 계약
  - 선택지: 각 영역이 revert 가능 표시와 보정 방법 제공
  - 추천: 각 영역 파일에 revert 정책 절
- **dm#C6** [충돌] (app, document declaration key) 대응과 place 교차 unique의 정본이 apps와 documents 사이에서 미정
  - 선택지: documents/addressing 정본 / apps/registration 정본
  - 추천: documents/addressing 정본
- **dm#C7** [충돌] place_names 예약·rename transaction을 projects와 apps/registration이 공유
  - 선택지: 공통 표 하나 / 각자
  - 추천: documents/addressing의 공통 표 하나
- **dm#C8** [충돌] ledger 공통 command 기록의 compare/prepared 필드와 각 파일 command 입력 이름이 다름
  - 선택지: ledger 이름으로 통일
  - 추천: ledger 이름으로 통일
- **dm#C9** [충돌] provider·model 설정 원본과 일반 settings의 중복 저장
  - 선택지: provider·model은 자기 표 / settings 표
  - 추천: provider·model은 자기 표, settings는 참조만
- **dm#C10** [충돌] repair-context의 대표 발생·추가 근거 상한이 snapshots와 겹칠 수 있음
  - 선택지: repair-context 정본
  - 추천: repair-context 정본, snapshots는 고정 증거만
- **dm#C11** [충돌] Role.ToolSelection은 command 이름만, 승인된 (app, command) 쌍은 Assignment에 고정 — 승인·tools·blueprint가 같은 쌍 검사를 공유해야 함
  - 선택지: 공통 검사 규칙 하나
  - 추천: lophn-agent/assignments 정본
- **dm#C12** [충돌] 정함: extensions(skill, 외부 MCP)가 architecture/agent-runtime.md에는 없다고 적혀 있음
  - 선택지: architecture를 고침
  - 추천: architecture 재작성 때 반영
  - 결정: 2026-10-04 결정 10: 외부 MCP·skill은 preset 구성 항목으로 지원한다. architecture의 확장 없음 단정은 폐기한다.
- **dm#C13** [충돌] 한눈에 보기 예시의 "정해진 기간 재발이 없으면 닫힘"이 problems/closing 규칙(조용히 닫힘 없음)과 다름
  - 선택지: 예시 고침
  - 추천: domain-model/README의 entity 지도 쓸 때 고침
  - 적용: flows/app-broken.md에서 고침
- **dm#C14** [충돌] harness/waiting-and-recovery의 run_wait_resolutions(결정 seq, 요청 key 중복 반영)를 platform/approvals·lophn-agent/questions의 결정 전달과 맞춰야 함
  - 선택지: 한쪽을 정본으로
  - 추천: approvals·questions가 결정을 내고 run_wait_resolutions가 seq로 한 번만 반영
  - 적용: 해결: 대기 decision_seq를 Question·ApprovalRequest의 closed_seq와 맞춤

## product (1)

### product

- **product#Q1** [질문] 기술 선택: SDK·앱·core·MCP server를 TypeScript 하나로 통일하고 Electron·Deno·SQLite를 이어 쓸까(H6)
  - 선택지: 유지 / 바꿈
  - 추천: 유지
  - 적용: 없음(architecture에서 정함)

## flows

- 모두 30건

### flow/receive-operator-report

- **flow/receive-operator-report#Q1** [충돌] documents#I6의 series 등록·멤버 작성·다음 이름·draft·보관을 사람이 쓰는 flow와 screen이 없고, Operator 보고 flow는 기존 문서 새 판만 저장한다. / 함께 합친 내용: Operator가 series의 다음 이름으로 새 보고를 남기는 흐름을 지원할까? 현재 requirements는 기존 문서 새 version만 허용한다.
  - 선택지: 사람의 series flow와 기존 documents/document screen에 연결; Operator에게 다음 독립 문서 생성 허용 / 함께 합친 내용: 기존 승인 문서 새 version만 사용 / series 생성 권한과 승인 계약 추가
  - 추천: Operator 범위는 유지하고 사람의 series flow와 screen 계약을 별도로 추가한다. / 함께 합친 내용: 현행 requirements를 따라 기존 문서 새 version만 쓰고 series 생성은 넣지 않는다.
  - 적용: Operator 보고 flow의 잘못된 documents#I6 및 documents/series metadata 연결만 제거; series flow·screen은 미작성 / 함께 합친 내용: 기존 문서 갱신과 무변화 완료만 flow에 작성함.
  - 근거: /home/pyosechang/projects/lophn/docs/intent/documents.md#I6; /home/pyosechang/projects/lophn/docs/requirements/documents/series.md#R1-R14; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/assignments.md#R6; /home/pyosechang/projects/lophn/docs/flows/receive-operator-report.md / 함께 합친 내용: documents#I6; documents/series#R6; documents/series#R9; lophn-agent/assignments#R6; lophn-agent/assignments 버린 것; lophn-agent/roles/operator#R5; lophn-agent/roles/operator#R7; flow/receive-operator-report
  - 합친 기록: check__flows.tsv [빠짐], flow__4.tsv [충돌]; 같은 id의 질문·선택지·추천·적용·근거를 모두 유지함
- **flow/receive-operator-report#Q2** [충돌] 새 Operator 보고를 notification에서 여는 계기를 추가할까? 현재 계기 표는 일반 문서 저장과 run 종료 notification을 금지한다.
  - 선택지: 보고 갱신 notification 추가 / 보고는 Roles에서 찾고 질문·운영 문제·반복 실패만 notification
  - 추천: 현행 계기 표를 유지하고 결과 문서는 Roles에서 찾으며 사람 결정이 필요한 질문 등만 Things to confirm으로 보낸다.
  - 적용: 보고 읽기와 정해진 notification 계기를 flow에서 분리함.
  - 근거: platform/notifications#R1; platform/notifications#R2; shell/desktop#R3; shell/desktop#R4; flow/receive-operator-report

### flow/manage-tickets

- **flow/manage-tickets#Q1** [충돌] app-detail screen은 Issue 증상에서 검사 조건을 자동으로 정해 Task가 즉시 열린다고 하지만, tickets#R3·R9·R26은 기존 채택 답과 고정 reproduction 기준이 없으면 생성하지 않고 App Engineer로 연결한다. / 함께 합친 내용: app-detail Tasks에 사람이 구현·수리 ticket을 직접 만들고 필요한 고정 설계 근거·acceptance check를 연결하는 경로가 없으며 취소만 명세되어 있다.
  - 선택지: 기존 근거 준비와 필수 검사 통과 때만 직접 생성; 증상만으로 조건 자동 생성 / 함께 합친 내용: App Engineer의 짧은 요청으로 검사 가능한 입력을 준비 / 필요한 입력만 단계적으로 직접 입력
  - 추천: app-detail에 근거가 갖춰진 경우만 직접 생성하고 부족하면 대화로 연결한다고 명시한다. / 함께 합친 내용: 사람에게 원하는 결과와 필요한 결정만 받고 App Engineer가 준비한 고정 근거·검사 조건을 사용하되 직접 생성도 같은 입력 검사를 지킨다.
  - 적용: manage-tickets와 app-broken flow에 생성 조건·대화 경로를 반영; screen은 소유 범위 밖이라 미수정 / 함께 합친 내용: flow는 app-detail을 가장 가까운 화면으로 사용함; 정적 screen 보완 필요
  - 근거: /home/pyosechang/projects/lophn/docs/screens/app-detail.md:23; /home/pyosechang/projects/lophn/docs/requirements/coding-agent/tickets.md#R3,#R9,#R26; /home/pyosechang/projects/lophn/docs/flows/manage-tickets.md; /home/pyosechang/projects/lophn/docs/flows/app-broken.md / 함께 합친 내용: coding-agent/tickets#R2; coding-agent/tickets#R3; coding-agent/tickets#R5; coding-agent/cli#R37; docs/screens/app-detail.md
  - 합친 기록: check__flows.tsv [충돌], flow__5.tsv [빠짐]; 같은 id의 질문·선택지·추천·적용·근거를 모두 유지함
- **flow/manage-tickets#Q2** [빠짐] app-detail에 특정 ticket의 복사 요청 문장·고정 자료와 버려진 작업을 다음 coding agent에게 다시 맡기는 행동이 없다.
  - 선택지: Task 상세에서 요청 문장 복사 / 열린 Task마다 자동 외부 세션 시작
  - 추천: Task 상세에서 현재 맡길 수 있는지와 복사 요청 문장을 제공하고 사람의 명시 지시로만 다시 맡긴다.
  - 적용: flow는 app-detail에서 고정 자료를 받아 직접 지시하는 경로를 사용함; screen 보완 필요
  - 근거: coding-agent/tickets#R11; coding-agent/tickets#R14; coding-agent/tickets#R24; coding-agent/connection#R1; docs/screens/app-detail.md

### flow/manage-provider-accounts

- **flow/manage-provider-accounts#Q1** [충돌] settings screen의 리셋 시각 미상일 때 최대 1시간 뒤라는 안내는 실제 사용 가능 보장이지만 provider#R24는 1시간 뒤 다시 후보가 되는 내부 대기만 정한다.
  - 선택지: 확인된 리셋 시각과 다음 확인 가능 시각을 구별; 최대 1시간 안에 사용 가능으로 표시
  - 추천: 서버 리셋 미상은 확인하지 못함으로 남기고 1시간은 다음 확인 가능 시각으로만 안내한다.
  - 적용: 기존 flow의 구별 유지; settings screen은 소유 범위 밖이라 미수정
  - 근거: /home/pyosechang/projects/lophn/docs/screens/settings.md:64; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/harness/provider.md#R24; /home/pyosechang/projects/lophn/docs/flows/manage-provider-accounts.md:16

### flow/app-broken

- **flow/app-broken#Q1** [빠짐] repair ticket 생성 전에 각 문제의 고정 reproduction test가 필수인데, 아직 테스트가 없는 새 문제에서 누가 ticket 없는 테스트 준비를 맡고 고정 근거를 만드는지 사용자 경로가 없다. App Engineer는 코드·테스트를 만들거나 실행하지 못한다. / 함께 합친 내용: app-detail의 Create a task가 증상에서 acceptance check를 자동으로 정한다고 하지만 App Engineer의 원인 해석·알려진 해결 조건·사람 요청이 먼저 필요한 flow를 시작할 행동이 빠져 있다.
  - 선택지: 사람이 연 coding agent에 직접 reproduction 준비를 시킨 뒤 고정 기준으로 ticket 생성; reproduction 없는 repair ticket 허용; ticket 없이 직접 수리 / 함께 합친 내용: App Engineer에게 봐 달라고 요청한 뒤 조건이 충분할 때 ticket 생성 / 조건 없는 즉시 ticket 생성
  - 추천: 현행 필수 조건은 유지하고 직접 coding agent의 reproduction 준비와 고정 기준 연결 경로를 requirements·screen에서 명시한다. 재현 불가는 현행 직접 수리와 보호된 사람 확인을 따른다. / 함께 합친 내용: app-detail에서 해석 요청과 결과를 먼저 연결하고 검사 가능한 조건이 준비된 경우만 ticket을 만든다.
  - 적용: app-broken에서 생성 전 고정 기준과 생성 후 같은 테스트 검사를 일치시킴; 선행 준비의 새 계약은 미작성 / 함께 합친 내용: flow는 requirements에 맞게 해석 요청과 조건부 ticket 생성을 사용함; screen 변경은 담당 워커에게 남김
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/coding-agent/tickets.md#R6,#R9; /home/pyosechang/projects/lophn/docs/domain-model/coding-agent/tickets.md#AcceptanceCheck; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/roles/app-engineer.md#R3; /home/pyosechang/projects/lophn/docs/flows/app-broken.md; /home/pyosechang/projects/lophn/docs/flows/verify-app-repair.md / 함께 합친 내용: problems/grouping#R12; lophn-agent/roles/app-engineer#R1; lophn-agent/roles/app-engineer#R16; coding-agent/tickets#R9; docs/screens/app-detail.md
  - 합친 기록: check__flows.tsv [빠짐], flow__5.tsv [빠짐]; 같은 id의 질문·선택지·추천·적용·근거를 모두 유지함

### flow/catalog

- **flow/catalog#Q1** [범위] lophn-agent#I8의 개발용 eval을 바이브코딩 사용자의 제품 flow 목록에 넣을까?
  - 선택지: 제품 flow에 포함; 개발 품질 flow로 별도 관리
  - 추천: 제품 기능이 아닌 eval은 개발 품질 flow로 별도 관리
  - 적용: 제품 flow에서 제외하고 uncovered_intents에 남김
  - 근거: /home/pyosechang/projects/lophn/docs/intent/lophn-agent.md#I8; /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/evaluation.md#R21-R23
- **flow/catalog#Q2** [질문] 정함: 사람이 정하는 중인 harness#I7의 prompt injection·secret 보장 장면을 확정할까?
  - 선택지: 사람 결정까지 미확정; 현재 safety 요구로 확정
  - 추천: 사람 결정까지 미확정 유지
  - 적용: lophn-agent/harness#I7을 uncovered_intents에 남김; 기존 platform secret 약속만 별도 flow로 연결
  - 근거: /tmp/claude-1000/-home-pyosechang-projects-lophn/feae6c3e-e963-4ccd-bd65-2ea8cbfa0f35/scratchpad/wf-common.md#21; /home/pyosechang/projects/lophn/docs/intent/lophn-agent/harness.md#I7
  - 결정: 2026-10-04 결정 8: harness intent는 I1~I3만 남고 옛 I7은 삭제되었다. I7 flow 연결 요구는 없으며 secret 약속은 platform#I8이 맡는다.
- **flow/catalog#Q3** [충돌] 세션 visual의 산점 차트를 SDK가 지원한다고 쓸까?
  - 선택지: SDK 산점 지원 추가; 세션 산점 제외; 사람 결정 대기
  - 추천: 사람 결정 전 flow에서는 양쪽이 지원하는 표·선·막대·도표·앱 카드만 예로 든다
  - 적용: 산점 지원 약속을 flow에 추가하지 않음
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/visuals.md#R1; /home/pyosechang/projects/lophn/docs/requirements/apps/sdk.md#R17
- **flow/catalog#Q4** [질문] Claude·ChatGPT 구독 연결을 첫 설치에서 항상 쓸 수 있다고 안내할까?
  - 선택지: 항상 제공; 검증된 경로만 제공
  - 추천: lophn 이름으로 사용 허용과 실제 tool call이 확인된 구독 경로만 제공하고 미검증·거절에는 API key나 로컬 선택을 안내
  - 적용: connect-provider flow에 검증 조건과 대안을 명시
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/harness/provider.md#R1-R15

### flow/install-lophn

- **flow/install-lophn#Q1** [빠짐] OS 설치 과정과 core 기동 실패로 launcher를 정상으로 열 수 없는 경우의 안전한 안내 경로가 화면 목록과 requirements에 없다. 어떤 경로에서 영향·다음 행동·안전한 상세를 제공할까?
  - 선택지: OS installer 안내와 shell의 제한된 시작 실패 화면을 구별 / launcher의 시작 실패 상태로 통합하되 core 정상 기동 없이 동작하는 경계를 명시
  - 추천: 가장 가까운 launcher의 실패 갈래로 연결하되 OS installer 안내와 core 없는 shell 진단의 구체 contract는 소유 concern에서 보완한다.
  - 적용: flow는 launcher를 가리키고 설치 검증·원본 보존·안전 진단 요구만 연결했다. 실패 화면의 구현 contract와 새 화면을 임의로 만들지 않았다.
  - 근거: platform/install-and-update#R1; platform/install-and-update#R11; platform/backup-and-migration#R6; platform/diagnostics#R5; platform/diagnostics#R8; shell/desktop#R24

### flow/edit-document

- **flow/edit-document#Q1** [빠짐] 충돌·파일 쓰기 실패·연결 끊김 때 편집 초안과 새 원본을 함께 보존하는 요구가 없고, 초안의 보존 범위·수명도 정해지지 않았다.
  - 선택지: 편집 세션 안에서만 보존 / 로컬 복구 초안을 두되 저장 판과 구별 / 새 원본을 다시 읽을 때 초안 폐기
  - 추천: 초안을 새 원본으로 덮지 않는 최소 contract를 shell/editor에 추가하고 복구 범위는 별도 결정한다.
  - 적용: flow에는 초안과 원본을 잃지 않는 권리를 유지했으나 재시작 복구·영속 초안 구현은 정하지 않았다.
  - 근거: shell#I5; shell/editor#R2; shell/editor#R12; shell/editor#R15; documents/file-tracking#R11; documents/versions#R4
- **flow/edit-document#Q2** [빠짐] 저장되지 않은 글이 있는 탭·창 닫기 때 사람의 저장·계속 편집·버리기 선택과, 저장 완료 확인 전 닫기를 막는 contract가 없다.
  - 선택지: 닫기 전에 저장 완료 대기와 실패 시 계속 편집 / 저장·버리기·취소 선택 / 항상 닫고 별도 복구
  - 추천: 자동 저장 완료를 확인하고 충돌·실패·미확인이 남으면 사람이 계속 편집 또는 명시 폐기를 결정하게 한다.
  - 적용: flow에는 버릴 결정이 사람에게 남는다고 썼고 버튼·복구 방식은 정하지 않았다.
  - 근거: shell#I5; shell/editor#R1; shell/editor#R2; documents/file-tracking#R15

### flow/organize-documents

- **flow/organize-documents#Q1** [빠짐] 앱의 표시 이름·slug 변경 입력과 허용 주체·비교 기준을 정하는 요구가 없다. 옛 address 안내만으로 rename command contract를 대신할 수 없다.
  - 선택지: 사람 직접 rename / 정확한 질문 선택지로도 rename / 첫 판 앱 rename 제외
  - 추천: 사람 직접 rename을 apps/registration에 추가하고 slug의 옛 예약·참조는 documents/addressing을 따른다.
  - 적용: 앱 이름 변경을 정리 진입의 목적에 포함했으나 새 command·권한을 만들지 않았다.
  - 근거: documents#I3; apps/registration#R6; documents/addressing#R2; documents/addressing#R6
- **flow/organize-documents#Q2** [빠짐] export할 고정 판·원래 바이트의 요구는 있지만 포함·제외 자료와 제외 이유를 사람이 확인하는 export 결과 contract가 없다.
  - 선택지: 선택 판 참조만 반환 / 포함·제외와 안전한 이유의 결과 목록 / export manifest를 별도 파일로 제공
  - 추천: 선택한 고정 판별 포함·제외·안전한 이유를 결과로 제공하고 필요 없는 별도 문서·상태는 만들지 않는다.
  - 적용: flow에는 포함·제외 범위 확인을 유지했고 manifest 형식·파일 구조는 정하지 않았다.
  - 근거: documents#I8; documents/versions#R16; platform/redaction#R14; platform/redaction#R16

### flow/build-context

- **flow/build-context#Q1** [충돌] flow outline은 Context Engineer가 허락된 앱 read command로 자료를 찾는다고 하지만 requirements는 Context Engineer의 앱 command 실행을 금지하고 목록·설명 조회만 허용한다.
  - 선택지: Context Engineer는 계약 조회만 하고 실제 읽기는 승인된 역할이 수행 / Context Engineer에 read 실행 권한 추가
  - 추천: 현재 requirements대로 Context Engineer는 blueprint 계약만 조회하고 앱 read 항목을 제안하며 실제 호출은 해당 역할·assignment와 앱 허락을 다시 검사한다.
  - 적용: flow는 계약 조회만 쓰고 Context Engineer의 앱 command 실행을 넣지 않았다.
  - 근거: lophn-agent/roles/context-engineer#R2; lophn-agent/roles/context-engineer#R4; lophn-agent/roles/common#R11; apps/permissions#R28; apps/runtime#R32

### flow/define-terms

- **flow/define-terms#Q1** [빠짐] Context Engineer가 후보 이름·근거 외 가능한 뜻과 추천 정의를 제안할 수 있을까? requirements는 agent가 후보 이름·근거만 다루도록 제한한다.
  - 선택지: 사람 정의 입력만 사용 / 미확정 뜻 제안을 별도 산출물로 허용하고 확정 금지
  - 추천: 현행 제한에 맞춰 후보 이름·출현 근거와 미정 선택만 제공하고 추천을 사람 정의로 적용하지 않는다.
  - 적용: 가능한 뜻을 agent가 작성한다는 단계는 넣지 않고 사람의 명시 정의와 질문 절차로 작성함.
  - 근거: documents/terms#R1; documents/terms#R2; lophn-agent/roles/context-engineer#R8; lophn-agent/roles/context-engineer#R10; lophn-agent/questions#R3; flow/define-terms

### flow/manage-operator

- **flow/manage-operator#Q1** [빠짐] assignment 일시 멈춤·회수 접수 시 진행 run과 question·approval 대기를 정확히 어떤 command 경계에서 정리할까? run 멈춤과 책임 회수 세션 종료 요구는 있으나 assignment 행동별 정리 계약은 한 곳에 명시되지 않았다.
  - 선택지: assignment 멈춤을 run 멈춤까지 원자적으로 접수 / 새 회차만 막고 진행 run은 완료 허용 / 행동별 별도 정책
  - 추천: assignment 멈춤·회수와 run 멈춤 접수의 연결을 명시하고 현재 멈춤 검사·미실행·늦은 결과 규칙을 함께 따른다.
  - 적용: flow는 새 요청 차단과 run 멈춤이 접수된 이후 규칙을 구별해 쓰고 원자 접수 계약은 단정하지 않음.
  - 근거: lophn-agent/assignments#R9; lophn-agent/role-definition#R14; lophn-agent/harness/run-loop#R15; lophn-agent/harness/run-loop#R16; lophn-agent/conversation#R8; platform/approvals#R13; flow/manage-operator

### flow/verify-app-repair

- **flow/verify-app-repair#Q1** [빠짐] app-detail Issues에서 수리 주장·실제 테스트·미확인 범위와 고쳐짐 또는 아직 이상함의 보호된 사람 확인으로 가는 행동이 빠져 있다.
  - 선택지: Issue 상세에 확인 근거와 필요할 때 사람 확인 / Task의 Fixed 표시로 문제 해결 대체
  - 추천: Issue 상세에서 실제 확인 근거와 닫힌 이유를 구별하고 필요한 경우 confirmation-window에서 현재 문제·release에 묶인 사람 답을 받는다.
  - 적용: flow는 app-detail과 confirmation-window를 사용함; screen의 확인 진입과 상태 명세 보완 필요
  - 근거: problems/tests#R5; problems/closing#R6; problems/closing#R10; problems/closing#R13; docs/screens/app-detail.md; docs/screens/confirmation-window.md

### flow/approve-action

- **flow/approve-action#Q1** [빠짐] 대기 approval request의 명시 취소를 받는 요구가 있지만 confirmation-window의 Cancel과 창 닫기·Escape가 request 취소인지 단순 창 닫기인지 screen에서 구분되지 않는다.
  - 선택지: 명시 request 취소와 창 닫기 구별 / 둘을 같은 동작으로 처리
  - 추천: request 취소는 명시 행동으로 접수하고 창 닫기·Escape는 결정이나 request 취소로 해석하지 않는다.
  - 적용: flow는 명시 취소와 창 닫기를 구별함; screen 행동과 문구 보완 필요
  - 근거: platform/approvals#R4; platform/approvals#R13; shell/confirmation-window#R4; docs/screens/confirmation-window.md

### flow/answer-question

- **flow/answer-question#Q1** [빠짐] flow의 화면 목록에 option action·중요한 approval·secret 입력을 받는 confirmation-window가 빠져 있다.
  - 선택지: conversation·things-to-confirm만 두기 | 실제 지나는 confirmation-window 추가
  - 추천: 보호 결정 화면을 flow screens와 본문에 추가한다.
  - 적용: confirmation-window를 screens와 보호 결정 갈래에 추가함
  - 근거: flow/answer-question; shell/confirmation-window#R6; lophn-agent/questions#R11; lophn-agent/questions#R12; lophn-agent/questions#R13
- **flow/answer-question#Q2** [충돌] outline의 무응답은 답 없음으로 끝낸다는 표현이 기본 기한 없는 질문의 대기와 충돌한다.
  - 선택지: 무응답을 자동 종료 | 기한 없는 무응답은 대기하고 미루기·취소·명시 기한 만료만 답 없음 종료
  - 추천: 기본 기한 없이 기다리는 현재 요구를 따르고 무응답을 동의나 기본 선택으로 처리하지 않는다.
  - 적용: 기한 없는 무응답은 대기하고 명시 종료 사유만 stopped로 남기도록 작성함
  - 근거: lophn-agent/questions#R7; lophn-agent/questions#R8; lophn-agent/harness/waiting-and-recovery#R1; flow/answer-question

### flow/add-agent-extension

- **flow/add-agent-extension#Q1** [범위] 내장 lophn·App Engineer·Context Engineer 정의를 바꿀 수 없는데 확장 flow의 사용할 역할 선택은 내장 역할도 포함하는가.
  - 선택지: 내장 역할 확장 선택 변경 허용 | 변경 가능한 Operator에만 새 skill·tool 선택 허용
  - 추천: 현재 역할 정의 금지를 지키고 확장 선택은 변경 가능한 역할에만 적용한다; 내장 역할에 붙이는 별도 사람 설정 contract가 필요하면 먼저 정한다.
  - 적용: 내장 역할 정의를 덮어쓰지 않고 변경 가능한 역할과 Operator 승인 경로로 작성함
  - 근거: lophn-agent/role-definition#R9; lophn-agent/extensions#R4; lophn-agent/extensions#R31; lophn-agent/assignments#R4; flow/add-agent-extension

### flow/view-agent-visuals

- **flow/view-agent-visuals#Q1** [충돌] 시각 블록은 산점 차트를 받지만 첫 SDK 차트는 산점도를 지원 밖으로 두므로 어떤 계약을 따라 그릴 것인가?
  - 선택지: 첫 범위를 선·막대로 맞추기 / SDK 산점도 지원을 요구에 추가하기
  - 추천: intent의 표·차트 약속은 유지하고 flow 예시는 공통으로 지원하는 선·막대만 쓰며 산점도 요구 충돌은 소유 requirements에서 해소한다.
  - 적용: flow 예시를 선·막대로 제한함; requirements는 미변경
  - 근거: lophn-agent/visuals#R1; apps/sdk#R17; lophn-agent#I9
- **flow/view-agent-visuals#Q2** [빠짐] node·edge 도표를 공용 SDK로 그린다고 요구하지만 첫 SDK 묶음에는 도표 renderer와 입력 계약이 없다; 어느 공용 component가 맡는가?
  - 선택지: 기존 SDK component에 도표 renderer 명시 / 도표 지원을 첫 범위에서 제외
  - 추천: visuals의 도표 요구를 유지하려면 apps/sdk 소유 요구에 선언형 node·edge renderer와 공통 입력 계약을 명시한다; 이 워커는 flow에서 기존 약속만 연결하고 새 Package나 renderer를 만들지 않는다.
  - 적용: 미적용; 소유 requirements 결정 필요
  - 근거: lophn-agent/visuals#R1; shell/workspace#R12; apps/sdk#R4; apps/sdk#R38

### flow/backup-and-restore

- **flow/backup-and-restore#Q1** [빠짐] 사람이 즉시 만드는 수동 플랫폼 backup의 접수·결과·취소 contract는 무엇인가?
  - 선택지: 매일 자동 backup만 제공 | 사람이 같은 검증 worker에 즉시 요청
  - 추천: 자동 backup과 같은 범위·검증·보존 경계를 재사용하는 수동 요청을 requirements에 추가한다.
  - 적용: 미적용: 자동 backup 흐름만 구체화하고 수동 요청 contract를 만들지 않음
  - 근거: platform/backup-and-migration#R8,R9,R10,R12; flow/backup-and-restore 시작
- **flow/backup-and-restore#Q2** [빠짐] 앱 export에서 제외된 외부 자료와 export 묶음 검증 결과를 어떻게 확인하는가?
  - 선택지: blueprint·release·DB만 명시 | 제외 자료와 실제 검증 결과도 소유 concern에서 제공
  - 추천: apps/data에 앱 export의 제외 자료·검증·결과 조회 요구를 추가한다.
  - 적용: 미적용: apps/data#R13의 포함 범위만 확정하고 플랫폼 backup 제외 범위와 구별함
  - 근거: apps/data#R13; platform/backup-and-migration#R11; flow/backup-and-restore#흐름 4
- **flow/backup-and-restore#Q3** [빠짐] 앱 export 진입과 결과를 어느 screen에서 제공하는가?
  - 선택지: settings | app-detail
  - 추천: 앱별 export는 app-detail에 연결하고 settings는 플랫폼 backup·restore를 맡긴다.
  - 적용: 임시 적용: 제공된 flow 화면 중 가장 가까운 settings를 사용함
  - 근거: apps/data#R13; flow/backup-and-restore#흐름 4; screen/app-detail; screen/settings

### flow/update-lophn

- **flow/update-lophn#Q1** [빠짐] 수동 lophn update 전에 변경 내용과 재시작 필요를 제공하는 contract는 무엇인가?
  - 선택지: 설치 패키지 밖 안내 | 검증된 설치 판에 대응하는 로컬 안내
  - 추천: platform/install-and-update에 변경 안내의 출처·설치 판 연결·재시작 필요 확인을 추가한다.
  - 적용: 미적용: 실제 검증 배포와 수동 설치만 쓰고 근거 없는 변경 안내를 확정하지 않음
  - 근거: platform/install-and-update#R1,R13,R14; flow/update-lophn#흐름 1

### flow/work-offline

- **flow/work-offline#Q1** [빠짐] provider 준비나 재로그인으로 이어지는 offline 복구 경로를 어느 화면에서 보여 주는가?
  - 선택지: project-workspace와 app-space의 다음 행동에서 별도 flow로 이동 | settings와 confirmation-window를 이 flow에 포함
  - 추천: 필요한 행동은 현재 화면에 한 줄로 보이고 실제 준비는 설정 도움·provider 연결 flow로 연결한다.
  - 적용: 임시 적용: 지정 화면 project-workspace·app-space의 안내까지만 쓰고 별도 설정 flow로 넘김
  - 근거: lophn-agent/harness/provider#R6,R10,R19,R24; lophn-agent/harness/waiting-and-recovery#R6; flow/work-offline#흐름 5; flow/ask-lophn-help

## screens

- 모두 7건

### check/screens

- **check__screens#1** [빠짐] roles.md가 인라인으로 적은 "screen/roles#Q1"(Withdraw 없이 Pause/Resume만 제공하는 역할)과 "screen/roles#Q2"(Withdrawn 상태에서 대화 입력을 닫는 기준)는 concerns.yaml에 없는 concern id("screen/roles")를 쓰고 있고, screen 문서 종류에는 열린 질문을 남기는 정해진 자리가 없다. 실제로는 lophn-agent/role-definition과 lophn-agent/assignments 요구가 비워 둔 결정이다.
  - 선택지: (a) 두 질문을 lophn-agent/role-definition#Q<n>, lophn-agent/assignments#Q<n>로 옮겨 그 요구 문서의 "## 열린 질문"에 적고 open-issues.md에 선택지·추천을 남긴다 (b) screen 문서도 열린 질문을 남길 수 있는 자리를 docs/README.md의 "screen 쓰는 법"에 정식으로 추가한다
  - 추천: (a). screen 문서는 "무엇을 보여 주나"만 정하고 "역할 정의가 무엇을 허용하나"는 requirements 몫이라는 기존 원칙(docs/README.md)과 맞는다.
  - 적용: no
  - 근거: docs/screens/roles.md:33,42; docs/requirements/lophn-agent/role-definition.md; docs/requirements/lophn-agent/assignments.md
- **check__screens#2** [빠짐] app-detail.md Access tab의 "Which roles can use this app"에는 역할별 command 허락을 켜고 끄는 행동이 있다고 적혀 있지만(행동: "역할 허락 켜고 끄기"), 그 결정이 confirmation-window를 거치는지 바로 적용되는지가 보이는 것·행동 절 어디에도 명시돼 있지 않다. manage-app-permissions flow는 이 결정을 "중요한 결정은 앱이 흉내 낼 수 없는 lophn 화면(confirmation-window)에서만 받는다"고 요구한다.
  - 선택지: (a) app-detail.md에 "역할 허락 켜고 끄기도 confirmation-window를 연다"는 문장을 더한다 (b) 이미 apps/permissions#R1을 Access 전체에 걸어 뒀으니 현재 문구로 충분하다고 본다
  - 추천: (a). Version/Access(파일·network·secret)처럼 역할 허락도 같은 급의 권한 확대이므로 같은 문장으로 명시하는 쪽이 안전하다.
  - 적용: no
  - 근거: docs/screens/app-detail.md (행동 절); docs/flows/manage-app-permissions.md:14
- **check__screens#3** [범위] 여러 화면 문서가 실제 en 문구 key 없이 한국어로 "자세히 보기"/"더 보기" 같은 펼침 자리를 가리킨다(예: settings.md 보안 상태 점검, terminal.md 실행 shell 경로, document.md format 검사·content hash). 이번 검토에서는 가장 근거가 뚜렷한 app-detail.md의 Closed issue 펼침 하나만 실제 key(app-detail.issues.closed_reason.*)를 더해 고쳤고, 나머지는 건드리지 않았다.
  - 선택지: (a) 전체 화면을 한 번 더 돌며 "자세히 보기"류 표현마다 실제 message key(기본값 "Details")를 추가하는 정규화 패스를 별도로 돈다 (b) 지금처럼 Korean 설명 안의 비공식 표현으로 남겨 둔다
  - 추천: (a)를 별도 작업으로 추천. 한 번에 다 고치면 각 화면 담당이 겹쳐 쓸 위험이 커서 이번 범위에서는 뺐다.
  - 적용: no
  - 근거: docs/screens/settings.md:45; docs/screens/terminal.md:19; docs/screens/document.md:21,22; docs/screens/launcher.md:21

### screen/app-detail

- **screen/app-detail#Q1** [충돌] coding-agent/tickets#R2는 ticket 생성에 제목·무엇·왜(각 1~2,000자)·acceptance check(1~12개)·고정 근거를 요구하는데, 화면 원칙(P17, screens/README#G1)은 이런 양식을 바이브코딩 사용자에게 보이지 말라고 한다. manage-tickets flow의 "사람이 직접 만든다"를 app-detail에 어떻게 반영할까?
  - 선택지: A. app-detail에 전체 ticket 작성 양식을 그대로 노출한다 / B. app-detail의 직접 생성은 Issue에서 바로 만드는 repair ticket(증상에서 acceptance check 자동 결정)만 허용하고, 처음부터 새로 쓰는 구현 ticket 작성은 App Engineer와의 대화(new-app/change-app)로만 연다
  - 추천: B. app-detail의 "Create a task"는 열린 Issue 하나를 고치는 repair ticket만 즉시 만들고, 제목·근거·acceptance check는 그 Issue의 증상에서 자동으로 채운다. 완전히 새로운 구현 요청은 conversation에서 App Engineer에게 말해 만들게 한다.
  - 적용: app-detail.md의 Tasks 섹션에 이 해석을 반영해 작성함
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/coding-agent/tickets.md#R2, R9; /home/pyosechang/projects/lophn/docs/product.md#P17; /home/pyosechang/projects/lophn/docs/screens/README.md#G1
  - 후속 기록: check/coding-agent#Q1 및 check/flows의 flow/manage-tickets#Q1과 함께 읽음; 증상만으로 acceptance check를 자동 확정하는 추천은 아직 정함이 아님
- **screen/app-detail#Q2** [충돌] 정함: screens/README#3의 화면 말 표는 claim을 "보이지 않음"으로 정했는데 problems/grouping#R12는 "ticket·claim은 화면에서 사람이 아는 영어로 설명한다"고 요구한다. 같은 사실(코딩 에이전트가 지금 그 일을 맡고 있다는 것)을 app-detail의 Task 상태에 어떻게 보일까?
  - 선택지: A. claim이라는 말과 그 의미(누가, 언제부터, 기한)를 화면에 그대로 설명 / B. claim이라는 단어와 안쪽 필드(기한, 연결 ID)는 계속 숨기고 그 뜻만 Task 상태 라벨(In progress 등)로 녹여 보인다
  - 추천: B. "claim"이라는 말과 기한·연결 식별자는 숨기고, Task 상태를 Open/In progress/Checking/Fixed/Needs another look/Cancelled로만 보여 problems/grouping#R12가 요구하는 "사람이 아는 설명"을 상태 라벨로 충족한다.
  - 적용: app-detail.md의 Tasks 섹션에 이 해석을 반영해 작성함
  - 근거: /home/pyosechang/projects/lophn/docs/screens/README.md#3; /home/pyosechang/projects/lophn/docs/requirements/problems/grouping.md#R12; /home/pyosechang/projects/lophn/docs/requirements/coding-agent/tickets.md#R19
  - 결정: 최근 결정 7: claim·안쪽 필드는 숨기고 사람이 아는 상태로 표시

### screen/roles

- **screen/roles#Q1** [빠짐] lophn-agent/assignments#R9는 모든 assignment의 멈춤·회수를 사람이 결정할 수 있다고 하지만, lophn·Context Engineer처럼 전체 범위를 보는 담당은 R2에 따라 "거두지 않은" 것이 각각 하나뿐이고 회수 뒤 다시 만드는 경로가 정의돼 있지 않다.
  - 선택지: A. lophn·Context Engineer의 전체범위 assignment는 회수를 막고 멈춤만 허용하는 예외를 R9에 추가한다 / B. 회수 시 machine이 같은 역할의 새 assignment를 자동으로 다시 준비하는 규칙을 추가한다 / C. 현재처럼 화면에서만 회수를 숨긴다
  - 추천: A. lophn-agent/assignments#R9에 다음 예외를 추가한다: "거두지 않은 lophn·Context Engineer 전체 범위 assignment는 회수할 수 없고 멈춤·재개만 할 수 있다." 이유: 회수 뒤 재생성 경로가 없어 agent 전체가 조용히 비게 되는 것을 막는다.
  - 적용: roles 화면에서 lophn·Context Engineer에는 Withdraw를 빼고 Pause/Resume만 제공
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/lophn-agent/assignments.md#R2,R9; /home/pyosechang/projects/lophn/docs/screens/roles.md
- **screen/roles#Q2** [빠짐] shell/desktop#R4는 "대화 가능 여부는 lophn-agent/roles 및 lophn-agent/assignments를 따른다"며 대화 불가 역할이 있다고 전제하지만, role-definition·assignments·roles 어디에도 어떤 상태의 assignment가 대화를 받을 수 없는지 정의가 없다.
  - 선택지: A. withdrawn assignment는 새 대화를 받지 않고 지난 대화만 읽는다는 규칙을 lophn-agent/assignments에 추가한다 / B. 모든 상태에서 대화를 항상 허용한다
  - 추천: A. lophn-agent/assignments에 다음 요구를 추가한다: "회수된 assignment는 지난 대화를 읽을 수 있으나 새 대화를 받지 않는다; paused·active는 대화를 받는다." 이유: shell/desktop#R4가 전제한 대화 불가 상태를 실제로 정의해야 화면이 일관되게 입력창을 막을 수 있다.
  - 적용: roles 화면에서 Withdrawn 상태에 한해 대화 입력을 닫고 지난 대화만 보이게 정함
  - 근거: /home/pyosechang/projects/lophn/docs/requirements/shell/desktop.md#R4; /home/pyosechang/projects/lophn/docs/screens/roles.md
  - 후속 기록: check/shell#Q16에서 회수된 담당의 shell 표시 경계만 적용함; paused 새 대화 허용은 check/shell#Q17의 충돌이 남음

## intent 연결

- 모두 48건

### apps

- **intent/apps#Q1** [범위] apps/invocations#R14은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까
  - 선택지: intent에 조회 결과의 완전성·신선도·페이지 일관성 약속 추가 / 요구를 앱별 업무 계약으로 이동
  - 추천: 공용 command 결과 신뢰성이 제품 약속이면 사람이 intent에 추가하고, 아니라면 앱별 업무 계약으로 옮긴다.
  - 적용: TSV에 적용 기록 없음
  - 근거: apps/invocations#R14; apps#I11
  - 후속 기록: check/apps#Q5에서 apps/invocations#R14에 apps#I5 연결을 추가하여 연결 빠짐을 고침
- **intent/apps#Q2** [충돌] 정함: apps/connections#R3이 intent 또는 최근 사람이 정한 것과 부딪힌다.
  - 추천: secret 사용을 호출마다 확인하는 것으로 읽힐 수 있는 확인 조건을 앱 secret grant와 command confirm의 독립 조건으로 고침
  - 적용: intent에 맞춰 고침: secret 사용을 호출마다 확인하는 것으로 읽힐 수 있는 확인 조건을 앱 secret grant와 command confirm의 독립 조건으로 고침
  - 근거: apps#I7; apps#I11; apps/permissions#R14
  - 결정: 최근 결정 4: 앱 secret grant와 command confirm을 독립으로 검사
- **intent/apps#Q3** [충돌] 정함: apps/permissions#R15이 intent 또는 최근 사람이 정한 것과 부딪힌다.
  - 추천: 모든 모드의 secret 사용 거절을 원값 비노출 검사로 바꾸고 grant된 운영·automation 사용과 preview 대역을 구분함
  - 적용: intent에 맞춰 고침: 모든 모드의 secret 사용 거절을 원값 비노출 검사로 바꾸고 grant된 운영·automation 사용과 preview 대역을 구분함
  - 근거: apps#I7; apps/permissions#R14; apps/preview#R4
  - 결정: 최근 결정 4: grant된 secret 사용은 허용하되 원값은 비노출
- **intent/apps#Q4** [충돌] apps/invocations#R7이 intent 또는 최근 사람이 정한 것과 부딪힌다.
  - 추천: 앱 화면의 사람 요청으로 한정한 confirm 접수를 다른 앱·agent 요청에도 같은 사람 approval 규칙으로 적용함
  - 적용: intent에 맞춰 고침: 앱 화면의 사람 요청으로 한정한 confirm 접수를 다른 앱·agent 요청에도 같은 사람 approval 규칙으로 적용함
  - 근거: apps#I11; platform#I7; apps/invocations#R18
- **intent/apps#Q5** [충돌] 정함: apps/automations#R10이 intent 또는 최근 사람이 정한 것과 부딪힌다.
  - 추천: automation의 안쪽 선언·호출 관측 기본 노출을 필요한 상태·다음 행동과 펼쳐 보는 상세로 나눔
  - 적용: intent에 맞춰 고침: automation의 안쪽 선언·호출 관측 기본 노출을 필요한 상태·다음 행동과 펼쳐 보는 상세로 나눔
  - 근거: shell#I8; apps#I5; product#P17
  - 결정: 최근 결정 7: automation 기본 화면은 필요한 상태·다음 행동만
- **intent/apps#Q6** [충돌] 정함: apps/runtime#R13이 intent 또는 최근 사람이 정한 것과 부딪힌다.
  - 추천: 안쪽 runtime 상태 이름의 기본 노출을 필요한 사용자 상태·다음 행동과 상세로 나눔
  - 적용: intent에 맞춰 고침: 안쪽 runtime 상태 이름의 기본 노출을 필요한 사용자 상태·다음 행동과 상세로 나눔
  - 근거: shell#I8; apps#I5; product#P17
  - 결정: 최근 결정 7: 안쪽 runtime 상태 대신 필요한 사용자 상태만
- **intent/apps#Q7** [충돌] 정함: apps/runtime#R14이 intent 또는 최근 사람이 정한 것과 부딪힌다.
  - 추천: 실행 상태와 열린 problem의 별개 사실을 유지하며 모든 관측의 기본 노출 대신 필요한 정보와 상세로 나눔
  - 적용: intent에 맞춰 고침: 실행 상태와 열린 problem의 별개 사실을 유지하며 모든 관측의 기본 노출 대신 필요한 정보와 상세로 나눔
  - 근거: shell#I8; problems#I1; product#P17
  - 결정: 최근 결정 7: 실행 상태·problem은 구별하되 전체 관측은 상세로

### coding-agent

- **intent/coding-agent#Q1** [충돌] 정함: coding-agent/connection#R18의 회수 뒤 현재 ticket 읽기 확인이 coding-agent#I2와 connection#R8의 즉시 읽기 거절과 부딪힌다.
  - 선택지: 회수된 연결의 읽기 허용; 회수 인증 거절로 상실 확인
  - 추천: 회수된 연결은 읽기·쓰기를 즉시 거절하고 인증 거절로 상실을 확인한다.
  - 적용: intent에 맞춰 고침: R18과 확인에서 회수 인증 거절과 허용된 연결의 ticket 재조회를 구별함
  - 근거: coding-agent#I2; coding-agent/connection#R8; coding-agent/connection#R18
  - 결정: 2026-10-04 결정 19: connection 회수 뒤 읽기·쓰기를 즉시 거절한다. 회수된 credential의 ticket 재조회가 아니라 인증 거절로 상실을 확인한다.

### documents

- **intent/documents#Q1** [충돌] 정함: context 기본 화면에서 선택 이유·전체 관점 목록·빈 관점까지 반드시 보여 주어야 할까.
  - 선택지: 기본 화면에 모두 노출 / 필요한 정보만 기본 노출하고 상세는 펼쳐 보기
  - 추천: 목적·지금 필요한 항목만 기본으로 보여 주고 나머지는 펼쳐 보기
  - 적용: intent에 맞춰 고침: context 기본 노출을 목적·지금 필요한 항목으로 줄이고 나머지는 펼쳐 보기로 분리
  - 근거: documents/contexts#R1; shell#I8; product#P17; wf-common#최근 사람이 정한 것-7
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출하고 안쪽 metadata는 상세로 분리
- **intent/documents#Q2** [충돌] 정함: 파일 상태의 관측 시각과 비교한 판을 기본 화면에 항상 보여 주어야 할까.
  - 선택지: 기본 화면에 모두 노출 / 필요한 정보만 기본 노출하고 상세는 펼쳐 보기
  - 추천: 지금 필요한 상태만 기본으로 보여 주고 비교 근거는 펼쳐 보기
  - 적용: intent에 맞춰 고침: 파일 상태 구별은 유지하고 관측 시각·비교 판은 펼쳐 보기로 분리
  - 근거: documents/file-tracking#R9; shell#I8; product#P17; wf-common#최근 사람이 정한 것-7
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출하고 안쪽 metadata는 상세로 분리
- **intent/documents#Q3** [충돌] 정함: 파일 저장의 내부 완료 단계를 기본 화면에 모두 보여 주어야 할까.
  - 선택지: 기본 화면에 모두 노출 / 필요한 정보만 기본 노출하고 상세는 펼쳐 보기
  - 추천: 완료 사실은 각각 보존하고 현재 결과·필요한 다음 행동만 기본으로 표시
  - 적용: intent에 맞춰 고침: 단계별 완료 구별을 유지하고 기본 노출과 상세 상태를 분리
  - 근거: documents/file-tracking#R15; shell#I8; product#P17; wf-common#최근 사람이 정한 것-7
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출하고 안쪽 metadata는 상세로 분리
- **intent/documents#Q4** [충돌] 정함: 전체 목차의 통계와 활동을 기본 화면에 항상 보여 주어야 할까.
  - 선택지: 기본 화면에 모두 노출 / 필요한 정보만 기본 노출하고 상세는 펼쳐 보기
  - 추천: 조회 정보는 유지하고 통계와 활동은 펼쳐 보기
  - 적용: intent에 맞춰 고침: 전체 목차 조회 contract와 사람 화면의 기본 노출을 분리
  - 근거: documents/outline-and-search#R2; shell#I8; product#P17; wf-common#최근 사람이 정한 것-7
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출하고 안쪽 metadata는 상세로 분리
- **intent/documents#Q5** [충돌] 정함: context 목차에서 선택 이유·선택 판·빈 관점을 기본으로 모두 보여 주어야 할까.
  - 선택지: 기본 화면에 모두 노출 / 필요한 정보만 기본 노출하고 상세는 펼쳐 보기
  - 추천: 목적·지금 필요한 항목과 읽기 가능 여부만 기본으로 표시
  - 적용: intent에 맞춰 고침: context 목차 조회 정보는 유지하고 상세 metadata·빈 관점은 펼쳐 보기로 분리
  - 근거: documents/outline-and-search#R4; shell#I8; product#P17; wf-common#최근 사람이 정한 것-7
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출하고 안쪽 metadata는 상세로 분리
- **intent/documents#Q6** [충돌] 정함: 검색 반영 판·최신 판과 내부 처리 상태를 기본 화면에 모두 보여 주어야 할까.
  - 선택지: 기본 화면에 모두 노출 / 필요한 정보만 기본 노출하고 상세는 펼쳐 보기
  - 추천: 결과 판단에 필요한 지연·누락만 기본 표시하고 비교 판·처리 상세는 펼쳐 보기
  - 적용: intent에 맞춰 고침: 검색 응답 metadata는 유지하고 사용자 판단에 필요한 상태와 내부 상세를 분리
  - 근거: documents/outline-and-search#R14; shell#I8; product#P17; wf-common#최근 사람이 정한 것-7
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출하고 안쪽 metadata는 상세로 분리
- **intent/documents#Q7** [충돌] 정함: 프로젝트의 폴더·glob·.gitignore와 문서 수를 기본 화면에 항상 보여 주어야 할까.
  - 선택지: 기본 화면에 모두 노출 / 필요한 정보만 기본 노출하고 상세는 펼쳐 보기
  - 추천: 이름·목적과 지금 필요한 상태만 기본 표시하고 나머지는 펼쳐 보기
  - 적용: intent에 맞춰 고침: 프로젝트 조회 정보는 유지하고 폴더·추적 설정·문서 수는 펼쳐 보기로 분리
  - 근거: documents/projects#R8; shell#I8; product#P17; wf-common#최근 사람이 정한 것-7
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출하고 안쪽 metadata는 상세로 분리

### lophn-agent

- **intent/lophn-agent#Q1** [범위] lophn-agent/scheduling#R2은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까
  - 선택지: 공용 scheduler 재사용을 architecture로 옮긴다 / intent에 구현 재사용 약속을 추가한다
  - 추천: 사용자에게 하는 약속이 아니라 구현 선택이므로 architecture로 옮기고 requirements에서 제거할지 사람이 결정한다
  - 적용: TSV에 적용 기록 없음
  - 근거: lophn-agent/scheduling#R2; lophn-agent#I2; docs/README.md
- **intent/lophn-agent#Q2** [충돌] 정함: lophn-agent/assignments#R3이 기본 화면에 안쪽 상태와 설정 전체를 노출하여 정보 최소화와 충돌한다
  - 선택지: 기본은 목적·현재 진행·행동만; 범위와 설정은 상세
  - 추천: 승인할 때 필요한 범위는 숨기지 않되 평소 설정과 상태는 상세에서 확인한다
  - 적용: intent에 맞춰 고침: 기본 화면은 목적·현재 진행·필요한 행동만 보이고 assignment 설정과 run 구별은 상세로 옮기며 shell/wording을 따른다
  - 근거: lophn-agent/assignments#R3; shell#I8; shell#I9; product#P17
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출하고 복잡한 내용은 상세로 분리
- **intent/lophn-agent#Q3** [충돌] 정함: lophn-agent/questions#R4이 답 전 기본 화면에 역할·관련 일·대기 상태까지 항상 노출하여 정보 최소화와 충돌한다
  - 선택지: 질문·선택·추천·영향을 기본; 운영 정보는 상세
  - 추천: 답의 영향과 판단에 필요한 기한·무응답 결과는 기본으로 유지한다
  - 적용: intent에 맞춰 고침: 판단에 필요한 질문·선택·추천·영향만 기본으로 보이고 역할·관련 일·자세한 이유·대기는 상세로 옮기며 shell/wording을 따른다
  - 근거: lophn-agent/questions#R4; lophn-agent#I7; shell#I8; shell#I9; product#P17
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출하고 복잡한 내용은 상세로 분리
- **intent/lophn-agent#Q4** [충돌] 정함: lophn-agent/observability#R20이 trace의 모든 근거·주체·시각·링크를 기본 화면에 놓아 정보 최소화와 충돌한다
  - 선택지: 기본은 대상·결과·다음 행동; 근거와 주체는 상세
  - 추천: 되짚을 근거는 보존하고 기본 화면의 정보만 줄인다
  - 적용: intent에 맞춰 고침: 대상·결과·필요한 다음 행동만 기본으로 보이고 주체·시각·이유·근거·링크는 상세로 옮기며 shell/wording을 따른다
  - 근거: lophn-agent/observability#R20; lophn-agent#I5; shell#I8; shell#I9; product#P17
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출하고 복잡한 내용은 상세로 분리

### lophn-agent/harness

- **intent/lophn-agent/harness#Q1** [충돌] 정함: lophn-agent/harness/tools#R4가 바깥 조회도 external로 분류하여 최근 사람이 정한 command effect 기준과 충돌한다.
  - 선택지: 외부 요청 전부 external; 외부 상태 변경만 external
  - 추천: 앱 command는 apps/blueprint를 따르고 다른 tool도 외부 조회 read·저장 write·외부 상태 변경 external로 구별한다.
  - 적용: intent에 맞춰 고침: 앱 command effect는 apps/blueprint를 가리키고 외부 상태 변경만 external로 판정하며 확인에 외부 조회·조회 후 저장을 포함함
  - 근거: lophn-agent/harness/tools#R4; lophn-agent/harness#I4; wf-common.md 최근 사람이 정한 것 5
  - 결정: 최근 결정 5: 가져오기 read, 가져와 저장 write, 바깥 상태 변경 external
- **intent/lophn-agent/harness#Q2** [충돌] 정함: lophn-agent/harness/model#R15의 한국어 선택 이름을 화면에 그대로 제공하면 en-only i18n 규칙과 충돌한다.
  - 선택지: 한국어 이름을 화면에 표시; 문서의 수준 의미와 영어 message key를 분리
  - 추천: 문서의 수준 의미는 유지하고 실제 화면 문구는 shell/wording의 영어 message key로 제공한다.
  - 적용: intent에 맞춰 고침: 추론 수준 화면 문구에 shell/wording의 영어 message key 규칙을 명시함
  - 근거: lophn-agent/harness/model#R15; lophn-agent/harness#I1; wf-common.md 최근 사람이 정한 것 7
  - 결정: 최근 결정 7: 화면 문구는 en/message key

### lophn-agent/roles

- **intent/lophn-agent/roles#Q1** [범위] lophn-agent/roles/common#R8은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까
  - 선택지: judgment·organizing 작업 분리를 intent에 추가 / 요구 제거
  - 추천: 작업별 model slot 선택을 약속하려면 사람이 harness intent에 추가하고 그 전까지 연결하지 않는다
  - 적용: 의도 미연결
  - 근거: lophn-agent/roles/common#R8; lophn-agent/roles#I1; lophn-agent/harness#I1
- **intent/lophn-agent/roles#Q2** [범위] lophn-agent/roles/common#R9은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까
  - 선택지: 결정적 계산의 model 호출 제외를 intent에 추가 / 요구 제거
  - 추천: machine이 처리할 결정적 계산을 model 호출에서 제외한다는 약속을 사람이 추가할지 결정하고 그 전까지 연결하지 않는다
  - 적용: 의도 미연결
  - 근거: lophn-agent/roles/common#R9; product#P1; lophn-agent/harness#I3
- **intent/lophn-agent/roles#Q3** [범위] lophn-agent/roles/lophn#R19은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까
  - 선택지: judgment·organizing 작업 분리를 intent에 추가 / 요구 제거
  - 추천: common#R8과 함께 작업별 slot 선택 약속의 필요성을 사람이 결정하고 그 전까지 연결하지 않는다
  - 적용: 의도 미연결
  - 근거: lophn-agent/roles/lophn#R19; lophn-agent/harness#I1
- **intent/lophn-agent/roles#Q4** [범위] lophn-agent/roles/app-engineer#R20은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까
  - 선택지: judgment·organizing 작업 분리를 intent에 추가 / 요구 제거
  - 추천: common#R8과 함께 작업별 slot 선택 약속의 필요성을 사람이 결정하고 그 전까지 연결하지 않는다
  - 적용: 의도 미연결
  - 근거: lophn-agent/roles/app-engineer#R20; lophn-agent/harness#I1
- **intent/lophn-agent/roles#Q5** [범위] lophn-agent/roles/context-engineer#R14은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까
  - 선택지: judgment·organizing 작업 분리를 intent에 추가 / 요구 제거
  - 추천: common#R8과 함께 작업별 slot 선택 약속의 필요성을 사람이 결정하고 그 전까지 연결하지 않는다
  - 적용: 의도 미연결
  - 근거: lophn-agent/roles/context-engineer#R14; lophn-agent/harness#I1
- **intent/lophn-agent/roles#Q6** [충돌] 정함: lophn-agent/roles/common#R5의 secret 사용 금지가 앱 grant를 받은 command에도 적용되는 것으로 읽혀 apps#I7 및 최근 사람이 정한 secret 허락과 충돌한다
  - 선택지: secret 값 직접 접근 금지로 한정 / secret을 쓰는 모든 앱 command 금지
  - 추천: secret 값 직접 접근만 금지하며 허락된 앱 command의 secret 사용은 앱 grant 계약을 따른다
  - 적용: intent에 맞춰 고침: secret 사용 금지를 secret 값 직접 접근 금지로 한정
  - 근거: lophn-agent/roles/common#R5; apps#I7; platform#I8; 최근 사람이 정한 것#4
  - 결정: 최근 결정 4: secret 사용 금지가 아니라 secret 원값 직접 접근 금지

### platform

- **intent/platform#Q1** [충돌] platform/approvals#R8은 앱 화면의 사람만 요청자로 삼아 apps#I11의 agent·다른 앱 command 호출과 apps/invocations#R17·R18의 실제 caller 보존에 부딪힌다.
  - 선택지: 실제 caller와 사람 결정을 구별 / 앱 화면 caller만 허용
  - 추천: 실제 caller를 보존하고 사람의 approval을 별도 결정으로 검증한다.
  - 적용: intent에 맞춰 고침: R8의 요청자를 실제 호출 주체로 남기고 사람 결정과 구별하며 agent·다른 앱 요청의 확인을 추가함
  - 근거: platform/approvals#R8; apps#I11; platform#I7; apps/invocations#R17; apps/invocations#R18

### problems

- **intent/problems#Q1** [범위] problems/tests#R18은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까
  - 선택지: 제품 intent에 개발 fixture 약속 추가 | 개발 검증 명세로 옮기고 제품 요구에서는 제거
  - 추천: 개발 fixture 자체는 제품 약속이 아니므로 개발 검증 명세로 옮기는 것이 낫다. 사람 결정 전 요구와 번호는 유지한다.
  - 적용: TSV에 적용 기록 없음
  - 근거: problems/tests#R18; problems#I4; apps#I3
- **intent/problems#Q2** [충돌] 정함: problems/problem-codes#R6의 한국어 고정 화면 문구가 en 시작과 message key 규칙에 부딪힌다.
  - 선택지: en 문구와 message key로 변경 | 한국어 고정 문구 유지
  - 추천: en 문구와 message key로 제공한다.
  - 적용: intent에 맞춰 고침: 3종 필수 분류의 한국어 고정 문구를 제거하고 shell/wording의 message key·en 규칙을 참조하도록 변경
  - 근거: problems/problem-codes#R6; shell#I9; shell/wording; 최근 사람이 정한 것 7
  - 결정: 최근 결정 7: 고정 한국어 문구 대신 en/message key
- **intent/problems#Q3** [충돌] 정함: problems/grouping#R11이 목록에 발생 수·시각·release를 기본 노출해 정보 최소화에 부딪힌다.
  - 선택지: 기본 목록 최소화와 펼친 상세 | 모든 진단 정보 기본 노출
  - 추천: 기본 목록은 앱·증상·진행·다음 행동만 두고 나머지는 펼친 상세로 옮긴다.
  - 적용: intent에 맞춰 고침: 목록의 기본 정보와 펼친 상세를 구분
  - 근거: problems/grouping#R11; shell#I8; product#P17; 최근 사람이 정한 것 7
  - 결정: 최근 결정 7: 문제 목록의 필요 정보와 상세 분리
- **intent/problems#Q4** [충돌] 정함: problems/grouping#R12가 앱 카드의 상태별 문제 수와 ticket·claim을 화면에 직접 노출한다.
  - 선택지: 필요한 안내 우선과 펼친 상세 | 내부 개념 기본 노출
  - 추천: 지금 필요한 안내·담당·사람 조치만 먼저 보이고 내부 정보는 펼친 상세와 사람이 아는 영어로 설명한다.
  - 적용: intent에 맞춰 고침: 카드 기본 안내를 최소화하고 수·증거·ticket·claim은 펼친 상세로 이동
  - 근거: problems/grouping#R12; shell#I8; shell#I9; product#P17; 최근 사람이 정한 것 7
  - 결정: 최근 결정 7: 문제 카드 최소 안내와 상세 분리
- **intent/problems#Q5** [충돌] 정함: problems/closing#R13이 닫힌 문제에 확인 범위·미확인 부분·release·근거를 구분 없이 노출한다.
  - 선택지: 닫힌 이유·현재 주의 우선과 펼친 상세 | 모든 근거 기본 노출
  - 추천: 닫힌 이유와 지금 필요한 주의는 유지하고 복잡한 근거는 펼친 상세에서 읽게 한다.
  - 적용: intent에 맞춰 고침: 기본 닫힘 안내와 펼친 확인 근거를 구분하고 release를 사람이 아는 영어로 설명
  - 근거: problems/closing#R13; shell#I8; shell#I9; product#P17; 최근 사람이 정한 것 7
  - 결정: 최근 결정 7: 기본 닫힘 안내와 펼친 확인 근거 분리

### shell

- **intent/shell#Q1** [충돌] 정함: shell/app-frame#R26의 좁은 창 view 숨김이 최근 결정 및 R36과 부딪힌다.
  - 선택지: view 숨김 유지 / 남은 영역으로 bounds 축소
  - 추천: 앱 view를 숨기지 않고 bounds 축소
  - 적용: intent에 맞춰 고침: 좁은 창의 운영 패널에서도 앱 view를 유지하고 bounds 축소 및 복원 확인
  - 근거: shell/app-frame#R26, shell/app-frame#R36, shell#I6, shell#I8
  - 결정: 최근 결정 2: 좁은 창에도 앱 view를 숨기지 않음
- **intent/shell#Q2** [충돌] 정함: shell/confirmation-window#R2이 최근 결정 또는 intent와 부딪힌다: confirmation window의 기본 정보는 결정에 필요한 내용으로 줄이고 상세 근거는 펼침으로 분리
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: confirmation window의 기본 정보는 결정에 필요한 내용으로 줄이고 상세 근거는 펼침으로 분리
  - 근거: shell/confirmation-window#R2, shell#I3, shell#I8
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q3** [충돌] 정함: shell/design-system#R41이 최근 결정 또는 intent와 부딪힌다: 한국어 compact·요일 표기를 en 및 locale 기반 format으로 변경
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: 한국어 compact·요일 표기를 en 및 locale 기반 format으로 변경
  - 근거: shell/design-system#R41, shell#I2, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q4** [충돌] 정함: shell/editor#R14이 최근 결정 또는 intent와 부딪힌다: 동일 버전 안내를 en message key 문구로 변경
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: 동일 버전 안내를 en message key 문구로 변경
  - 근거: shell/editor#R14, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q5** [충돌] 정함: shell/wording#R1이 최근 결정 또는 intent와 부딪힌다: 한국어 기본 UI를 en-only 시작과 전 문구 message key 기반 i18n으로 변경
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: 한국어 기본 UI를 en-only 시작과 전 문구 message key 기반 i18n으로 변경
  - 근거: shell/wording#R1, shell#I8, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q6** [충돌] 정함: shell/wording#R2이 최근 결정 또는 intent와 부딪힌다: 화면 용어와 문서·코드 용어를 분리하고 안쪽 개념 노출 제거
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: 화면 용어와 문서·코드 용어를 분리하고 안쪽 개념 노출 제거
  - 근거: shell/wording#R2, shell#I8, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q7** [충돌] 정함: shell/wording#R3이 최근 결정 또는 intent와 부딪힌다: 한국어 조사 전용 요구를 locale별 완성 메시지와 placeholder 처리로 변경
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: 한국어 조사 전용 요구를 locale별 완성 메시지와 placeholder 처리로 변경
  - 근거: shell/wording#R3, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q8** [충돌] 정함: shell/wording#R4이 최근 결정 또는 intent와 부딪힌다: 기술 용어 노출 예외를 제거하고 사용자용 en 라벨 적용
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: 기술 용어 노출 예외를 제거하고 사용자용 en 라벨 적용
  - 근거: shell/wording#R4, shell#I8, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q9** [충돌] 정함: shell/wording#R5이 최근 결정 또는 intent와 부딪힌다: 한국어 합니다체 오류 안내를 짧은 en 영향 안내로 변경
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: 한국어 합니다체 오류 안내를 짧은 en 영향 안내로 변경
  - 근거: shell/wording#R5, shell#I8, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q10** [충돌] 정함: shell/wording#R6이 최근 결정 또는 intent와 부딪힌다: 개발 용어 UI 노출 허용을 사용자 화면 노출 검사로 변경
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: 개발 용어 UI 노출 허용을 사용자 화면 노출 검사로 변경
  - 근거: shell/wording#R6, shell#I8, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q11** [충돌] 정함: shell/wording#R7이 최근 결정 또는 intent와 부딪힌다: 한국어 조사 전용 검사를 message key·en 메시지·placeholder 검증으로 변경
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: 한국어 조사 전용 검사를 message key·en 메시지·placeholder 검증으로 변경
  - 근거: shell/wording#R7, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q12** [충돌] 정함: shell/wording#R11이 최근 결정 또는 intent와 부딪힌다: 화면·문서·agent의 동일 기술 용어 강제를 화면 en/문서·코드 규칙 분리로 변경
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: 화면·문서·agent의 동일 기술 용어 강제를 화면 en/문서·코드 규칙 분리로 변경
  - 근거: shell/wording#R11, shell#I8, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q13** [충돌] 정함: shell/wording#R13이 최근 결정 또는 intent와 부딪힌다: watch·model slot·run·invocation 화면 제목을 사용자용 en 라벨로 변경
  - 선택지: 기존 요구 유지 / intent에 맞춰 수정
  - 추천: intent에 맞춰 수정
  - 적용: intent에 맞춰 고침: watch·model slot·run·invocation 화면 제목을 사용자용 en 라벨로 변경
  - 근거: shell/wording#R13, shell#I8, shell#I9
  - 결정: 최근 결정 7: 필요한 정보만 기본 노출, en/message key와 사용자용 화면 말
- **intent/shell#Q14** [범위] shell/desktop#R17은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까
  - 선택지: intent에 build 환경 약속 추가 / requirements에서 빼고 architecture·spec에서 기술 선택 관리
  - 추천: 사람에게 하는 약속이 아닌 build 환경 선택이므로 requirements에서 빼고 architecture·spec에서 관리한다. 이번 작업에서는 요구를 유지하고 의도는 달지 않는다.
  - 적용: TSV에 적용 기록 없음
  - 근거: shell/desktop#R17, shell#I1, shell#I2
  - 후속 기록: check/shell#Q10에서 shell/desktop#R17에 shell#I1,I2 연결을 추가하여 연결 빠짐을 고침
- **intent/shell#Q15** [충돌] 정함: shell/confirmation-window#R6이 요청 창 위 modal이라고만 적고 최근 결정의 child modal BrowserWindow 경계를 명시하지 않는다.
  - 선택지: 기존 모호한 modal 유지 / child modal BrowserWindow 명시
  - 추천: 요청한 창의 child modal BrowserWindow로 명시
  - 적용: intent에 맞춰 고침: 요청한 창의 child modal BrowserWindow를 명시하고 앱 view 표시·입력 차단 유지
  - 근거: shell/confirmation-window#R6, shell#I3
  - 결정: 최근 결정 1: 요청 창의 child modal BrowserWindow·앱 view 표시·입력만 차단

