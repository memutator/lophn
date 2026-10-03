# 열린 질문과 결정

설계하면서 나온 질문과 충돌을 모은 곳이다. 2026-10-04에 전부 정했다. 새 질문은 `<concern id>#Q<n>`으로 여기에 올리고, 사람이 정해야 하는 것만 "사람이 정할 것"에 둔다.

- 모두 755건: 추천대로 626, 다르게 정함 30, 대체됨 69, 이미 정함 30
- 사람이 정한 큰 결정은 아래 "정한 원칙"에 있다. 문서는 이 결정을 따른다.

## 사람이 정할 것

없음.

## 정한 원칙

| 번호 | 결정 |
|---|---|
| D1 | confirmation window는 요청한 창 위의 child modal BrowserWindow다. 앱 view는 숨기지 않고 입력만 막는다. |
| D2 | menu·popover·palette·dialog·tooltip과 경계 drag는 앱 view 위의 shell overlay view에 그린다. 앱 view를 숨기지 않는다. |
| D3 | 터미널: 터미널 제어 contract도 없고 "agent는 터미널을 쓰지 못한다"는 단정도 없다. 나중에 Orca식 coordinator 여지를 남긴다. |
| D4 | secret: 사람이 그 앱에 준 grant가 허락이다. 호출마다 approval을 받지 않고, 누가 command를 불렀는지(사람 화면, agent, automation, 다른 앱)로 막지 않는다. 값은 앱 코드와 agent에 가지 않고 보낼 때 lophn이 붙인다(apps I7). |
| D5 | command effect: external은 앱 밖의 상태를 바꾸는 것(보내기, 결제, 외부 서비스에 만들기·고치기·지우기)이다. 바깥에서 가져오기만 하면 read, 가져와 저장하면 write다. 바깥 요청은 network grant의 host로만 간다. |
| D6 | automation은 external·confirm command를 아직 못 돌린다(H1 남은 부분). 가져오기·동기화는 돌린다. |
| D7 | 화면(P17, shell I8, I9): 화면에는 지금 필요한 것만 보이고 복잡한 내용과 과정은 숨긴다. 화면 말은 영어(i18n, 처음엔 en만)이고 ledger·invocation·assignment 같은 안쪽 개념을 화면에 내보내지 않는다. docs/README.md의 "말" 표는 문서와 코드의 말이다. |
| D8 | harness intent는 I1~I3 세 줄만 남았다(고른 model과 계정, 잃거나 두 번 하지 않음, 비용). prompt injection·secret 약속은 없앴다. secret은 platform I8이 맡는다. |
| D9 | lophn agent는 lophn, 앱, agent 관리와 사용의 복잡도를 추상화한다(docs/intent/lophn-agent.md I1~I8). roles intent 노드는 없앴다. |
| D10 | preset: agent 구성 하나(역할 종류, prompt, capability, context, MCP, skill, provider·model, 지침). 역할마다 제품 기본 preset이 있고 사람이 고치거나 새로 만든다. 제품이 고정한 금지·상한은 preset으로 못 바꾼다. concern은 lophn-agent/presets(Role entity 대신 Preset). lophn-agent/role-definition은 presets로 옮겼다(moved_to). |
| D11 | 역할별 개수: lophn 전역 하나, App Engineer 앱마다 하나, Context Engineer 전역 하나, Operator는 project나 app마다 원하는 만큼. Operator는 문서 context가 아니라 project나 app에 붙고, 읽을 자료(context)는 preset 항목이다. |
| D12 | 사용자 지침: coding agent용 AGENTS.md와 다른 lophn 전용 Markdown 파일(LOPHN.md). 전역 ~/.lophn/LOPHN.md, project 폴더의 LOPHN.md, 앱 자리의 LOPHN.md. textarea가 아니라 파일이고 문서 version으로 이력을 얻는다. 화면에서는 [Instructions]로 lophn 편집기에서 연다. 지침으로 권한·approval·제품 안전 규칙을 넓히지 못한다. 사람만 고치고 agent는 question으로 제안한다. concern은 lophn-agent/instructions. |
| D13 | 작업 자리(파일 cwd 대신): App Engineer는 맡은 앱, Operator는 붙은 project/app. lophn과 Context Engineer는 세션을 연 곳을 세션의 작업 자리로 잡고 사람이 명시적으로 바꿀 때만 바뀐다. 읽을 지침 층은 작업 자리로 정한다. |
| D14 | prompt 층 순서: 1 제품 공통 지시+tool 정의 → 2 역할 지시+preset prompt → 3 사람 지침(전역 → project → app) → [cache 경계] → 4 세션 이력·자료·run 사실 → 5 이번 turn 동적 context(시각, 지금 보는 탭·앱 화면)는 맨 뒤 최신 메시지에 붙인다. |
| D15 | 역할의 RoleValues(관점, 기대 결과, 상황 같은 글)는 domain model 값이 아니라 prompt 글이다. 기계가 쓰는 값(tool, 읽기 범위, model)만 preset에 둔다. |
| D16 | 모든 coding 일은 ticket이 된다. 사람의 직접 요청이나 피드백도 lophn·App Engineer가 ticket으로 만든다. coding agent의 흐름은 하나다: MCP로 ticket claim → 일 → 보고. |
| D17 | coding agent 시작은 "시작(ticket, harness, 방식)" 동작 하나다. 지금 지원: (a) 사람이 자기 터미널에서 직접 시작(지금처럼), (b) ticket의 [Start]를 사람이 누르면 lophn이 그 project의 터미널 탭에서 harness를 TUI로 첫 prompt와 함께 연다. 누르는 것이 사람의 허락이다. 나중: headless와 자동 시작(preset에 미리 준 허락이 있을 때), coordinator. "lophn은 외부 프로세스를 시작하지 않는다" 같은 규칙은 (b)를 허용하도록 고친다. |
| D18 | harness 연동: 제품이 배포하는 harness catalog(감지, 버전·인증 확인, MCP·skill·지침·hook 자리와 형식, 실행 계약) + 이 컴퓨터의 감지·관측(실행 파일, 버전, 인증, 설치 파일, 로딩, session을 따로, 모르면 모름) + lophn이 쓴 것의 설치 기록(receipt, hash가 맞을 때만 갱신·제거, 사람이 고친 파일은 덮어쓰지 않고 충돌로). 감지는 PATH와 정해진 fallback만 읽고, 다시 감지는 사람이 누를 때. 설치는 사람이 고른 harness에만. 기본 harness는 사람이 고르는 값(비면 정한 규칙). 처음엔 이 컴퓨터만, WSL·원격 관측 기록은 처음부터 나눠 둔다. session 관측은 derived이고 ledger 표를 새로 두지 않는다. 근거: scratchpad/research/harness-catalog.md. |
| D19 | credential: 사람이 harness 연결을 고르면 lophn이 connection을 만들고 MCP·skill을 설치한다. token은 설정 파일에 쓰지 않고 lophn MCP server가 시작할 때 OS keychain에서 꺼낸다. lophn이 터미널 탭에서 시작한 session에는 시작할 때 붙인다. 권한 경계(scope, 회수 즉시 거절, 승인·권한·secret·문제 닫기 불가)는 그대로다. concern: coding-agent/connection(권한), coding-agent/harnesses(catalog·감지·설치 기록), coding-agent/sessions(시작·관측). |
| D20 | intent v3(사람이 승인): 모든 intent는 사용자가 체감하는 가치만 약속한다. 번호의 뜻이 바뀌었다(예: platform I3은 이제 승인 원칙). 옛 의도 줄은 번호가 같아도 뜻이 다를 수 있으니 전부 다시 본다. |
| D21 | 승인 원칙: 되돌릴 수 없거나 심각한 일(지우기, 돈이 나가는 일, 밖으로 보내기)만 사람에게 묻는다. 나머지는 묻지 않고 진행한다. 사람들은 harness의 approve도 대부분 bypass로 쓴다. UI component 하나 바꾸는 데 결재받지 않는다. ask·approval 기준을 이 원칙으로 다시 본다. |
| D22 | 접근성은 범위 밖(작은 오픈소스 MVP): screen reader, ARIA 이름·역할, WCAG 대비 검증, reduced-motion, "키보드만으로 모든 조작" 요구를 뺀다. 키보드 shortcut(팔레트 등)은 남긴다. |
| D23 | H1: automation도 external command를 돌린다. 사람이 automation을 켤 때 command·입력·주기를 한 번 승인하고 언제든 끈다. confirm=true command만 automation에서 뺀다. |
| D24 | H2: 새 release는 사람이 한 번 눌러 고른다. H3: App Engineer 주기 검토 없음. H5: 승인은 confirmation window에서만. H7: App Engineer의 ticket 생성은 묻지 않는다. H8: Operator는 답을 기다리는 동안 주기를 건너뛴다. |
| D25 | H4: reproduction test를 만들 수 없는 repair는 사람의 확인을 acceptance check로 허용하고 "내가 확인함"으로 표시한다(테스트 통과와 구별). problems intent I3이 이를 약속한다. |
| D26 | 기록 보존: 큰 자료(model 호출 본문, snapshot 첨부, trace 본문, 운영 log)는 용량 상한을 넘으면 오래된 것부터 정리한다. 변경 기록, 결정, 확정 결과는 영구 보존한다. |
| D27 | MVP로 뺀 것: OTLP·network trace export(로컬 파일 export만), 계약 가격 보완, 비용 환산(USD만), CLI의 사람 관리 command(secret·project·context·series 관리는 화면에서; CLI는 coding agent용 command와 daemon 시작·중지·상태만), CLI의 secret lock·password unlock. |
| D28 | 되돌림을 모르는 외부 MCP tool은 external로 보고 묻는다. 사람이 preset에서 그 tool을 안전하다고 표시하면 묻지 않는다. ticket 취소는 묻지 않는다. lophn과 Context Engineer는 늘 하나이고 회수 대신 멈춤만 둔다. |
| D29 | docs/flows/jobs.md는 지웠다. product.md P1은 flow를 가리킨다. |
| D30 | 열린 질문은 전부 정했다. 판정은 아래 "결정 기록"에 있다. |

큰 질문(H1–H8, G1–G3)의 답은 D23–D25와 D29에 있다. G1(git)과 G2(problem 문서 타입 없음)도 정했다.

## 결정 기록

### platform (85)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| architecture/platform#Q1 | command·read·구독·worker의 첫 유한 한도를 얼마로 둘까 | 추천대로 | 고정 안전 기본값부터 복합 부하 테스트로 검증 |
| architecture/platform#Q10 | Deno 내장 SQLite의 native query 중단·Worker 죽음 복구가 지원 OS에서 어떻게 동작하는가 | 추천대로 | JS timeout을 native 중단으로 주장하지 않고 실행기 격리와 bounded query를 검증 |
| architecture/platform#Q11 | 플랫폼 RPC 목록과 다른 최상위의 실제 경로 목록을 누가 정의하는가 | 추천대로 | platform 공통 transport·platform 경로만 정의하고 다른 소유 contract를 등록 |
| architecture/platform#Q12 | 부모 사망·single instance·blob directory sync를 OS별로 어떤 수준까지 검증할까 | 추천대로 | 실제 lock/감독 pipe와 OS child 종료 테스트; 안전 불가 환경 실행 거절 |
| architecture/platform#Q2 | idempotency와 approval binding의 입력 정규화를 무엇으로 고정할까 | 추천대로 | RFC8785·seq 십진 문자열·sha256를 공통 사용 |
| architecture/platform#Q3 | token·WS 인증·OS 시작 전달의 구체 값은 무엇인가 | 추천대로 | 32byte 불투명 token·constant-time digest 비교·상속 pipe; WS header만 |
| architecture/platform#Q4 | macOS·Windows 데이터 위치와 최소 OS/CPU·패키지 검증 matrix를 어떻게 고정할까 | 추천대로 | 공통 home .lophn와 OS별 cache 위치; 배포 검증 전 완료 표시 금지 |
| architecture/platform#Q5 | 첫 redaction 규칙의 실제 gitleaks commit·credential prefix 목록을 무엇으로 pin할까 | 추천대로 | 입출력 동일 content-hash 규칙 bundle과 공통 key/PEM fixture |
| architecture/platform#Q6 | secret 이전 보호 export format·KDF·AEAD를 어떻게 고정할까 | 추천대로 | format1·Argon2id 64MiB/3회/p1·salt16B·AES256GCM nonce12B native 보호 adapter |
| architecture/platform#Q7 | 내부 secret 전송 부착에서 값을 반환하는 주체·core 실행 경계를 어떻게 지킬까 | 추천대로 | core는 scope/목적지/용도만 조정하고 값은 신뢰 adapter callback 메모리에만 전달 |
| architecture/platform#Q8 | secret OS 삭제·사용 프로세스 종료 미완료 관측을 재시작 뒤 어디에 보존할까 | 추천대로 | 새 entity 없이 keychain 항목과 현재 ledger 참조·감독 실제 종료를 대조 |
| architecture/platform#Q9 | backup manifest 교환 format과 상대 경로를 어떻게 고정할까 | 추천대로 | 먼저 검사 가능한 directory bundle와 JSON format1 |
| check/platform#Q1 | confirm의 requester·caller를 앱 화면 user로 고정한 model이 실제 agent·앱 caller를 보존하는 R8과 충돌한다. | 추천대로 | 결정 user와 실제 요청자를 구별하고 ask·confirm이 겹치면 approval 한 번만 사용 |
| check/platform#Q10 | blob model이 권한 0400·7일 유예·기동/매일 점검·저장 공간 보호를 구체적으로 반영하지 않는다. | 추천대로 | 참조 blob 보호·정지 GC·설치 권한·실제 공간 제한을 model에 반영 |
| check/platform#Q11 | backup model이 매일 1회·완료 7개와 migration 복구본 명시 삭제를 정할 것으로 남긴다. | 추천대로 | 정해진 주기·개수·보존을 policy에 고정 |
| check/platform#Q12 | secrets model에 R9의 보호 export/import 동작·실패 계약이 없다. | 추천대로 | 암호 보호 별도 이전·평문 중간 파일 없음·실패 시 기존 참조 유지 |
| check/platform#Q13 | redaction model에 64자·2KiB 표본·wildcard 거절·80자 화면 문자열과 표시 type/길이 숨김이 없다. | 추천대로 | R7·R9~R12를 model policy에 반영 |
| check/platform#Q14 | diagnostics model에 info 기본 level·보안 진단 종류·doctor 검사 항목이 빠졌다. | 추천대로 | R6·R9·R10·R11을 실제 관측 정책으로 model에 연결 |
| check/platform#Q15 | ledger·blob·diagnostics model이 ~/.lophn 경로를 고정하여 LOPHN_HOME root 선택과 충돌한다. | 추천대로 | 모든 하위 저장 경로를 시작 때 고정한 data root 기준으로 표현 |
| check/platform#Q16 | ledger model에 확정 결과 보존이 미정으로 남지만 R10은 기간 삭제를 금지한다. | 추천대로 | 현재 보존 정책 명시; 향후에도 옛 key 재효과 금지 |
| check/platform#Q17 | 정함: platform architecture가 최신 child modal·앱 view 유지·overlay 경계를 명시적으로 연결하지 않는다. | 이미 정함 | 정함: platform architecture가 최신 child modal·앱 view 유지·overlay 경계를 명시적으로 연결하지 않는다. |
| check/platform#Q18 | 외부 MCP stdio 설정의 secret_ref 환경 값 선언과 platform의 환경 원값 금지·HTTP 전송 직전 부착만 허용 규칙을 어떻게 맞출까. | 추천대로 | 현재 원값 금지를 유지하고 stdio secret_ref 설정은 안전한 사용 불가로 처리하는 요구를 lophn-agent/extensions 소유자가 확정 |
| check/platform#Q19 | OS 표시 실패의 안전한 이유를 재시작 뒤 어떻게 다시 확인할까. | 추천대로 | 별도 ledger 배달 상태 없이 shell의 안전 derived 관측·관측 시각을 쓰고 없으면 확인 불가 |
| check/platform#Q2 | 정함: secret 사용 흐름의 앱 approval/접수 검사가 최신 grant 기반 사용 결정과 다르다. | 이미 정함 | 정함: secret 사용 흐름의 앱 approval/접수 검사가 최신 grant 기반 사용 결정과 다르다. |
| check/platform#Q20 | architecture의 고정 queue·token·blob·redaction·진단·암호 parameter를 실제 OS에서 검증하고 어느 수치까지 acceptan… | 추천대로 | 현재 architecture 기본값과 기존 issue 추천안을 유지하고 OS 검증·부하·보호 export interoperability 테스트로 확정 |
| check/platform#Q21 | diagnostics R10의 오래 미사용 grant를 어떤 사용 관측과 기간으로 판정할까. | 추천대로 | apps/permissions의 실제 사용 근거와 기간 기준을 먼저 정하고 미관측을 미사용으로 단정하지 않음 |
| check/platform#Q3 | machine provider·외부 MCP 인증 갱신 contract에 대응하는 requirements와 model 용도·소유 경계가 빠졌다. | 추천대로 | 신뢰 adapter 보호 준비·소유 CAS·안전 참조 확정만 허용 |
| check/platform#Q4 | settings R27·R28의 사람이 읽는 설명·위험·되돌림·영향 registry가 model에 description만으로 남아 있다. | 추천대로 | 같은 registry의 message key·영향·적용 시점으로 화면과 역할이 설명 |
| check/platform#Q5 | settings R29의 고정 option action 적용이 model에서 machine 적용 경로 없이 사람 apply만으로 남아 있다. | 추천대로 | 실제 선택의 정확한 action을 검증해 기존 ApplySettings 한 번 적용 |
| check/platform#Q6 | 정함: settings와 approvals의 기본 노출이 최소화 원칙을 구체적으로 받치지 않는다. | 이미 정함 | 정함: settings와 approvals의 기본 노출이 최소화 원칙을 구체적으로 받치지 않는다. |
| check/platform#Q7 | platform I9의 focus 유지가 platform 요구와 model에서 shell 화면 규칙에만 의존한다. | 추천대로 | 명시 Open만 이동; 자동 표시는 현재 작업 유지 |
| check/platform#Q8 | notifications model의 정할 것에 OS opt-in·실패 표시가 미정으로 남지만 R9·R10은 정했다. | 추천대로 | opt-in 최소 정보·다음 조회 안전 실패 이유·retry 업무 상태 없음 |
| check/platform#Q9 | identity model의 모든 범위 밖 forbidden 정책이 앱 범위 대상의 not_found 요구와 충돌한다. | 추천대로 | 앱 범위 밖 대상 조회만 not_found; 일반 금지 동작 forbidden |
| platform/api#Q1 | API major 지원 기간과 호환 변경 규칙을 어떻게 고정할까? | 추천대로 | 첫 판은 major 1만 지원하고 같은 major의 선택 필드 추가만 허용하며 upgrade 때 미지원 클라이언트를 명시적으로 거절 |
| platform/api#Q2 | RPC와 오류 응답의 정확한 wire 식별자를 requirements에 적을까? | 추천대로 | README의 코드 식별자 금지에 따라 의미·구간·HTTP 상태만 요구에 적고 정확한 wire는 platform/api spec에서 고정 |
| platform/approvals#Q1 | H5: CLI TTY 확인을 사람의 승인으로 인정할까. | 추천대로 | confirmation window만 승인(H5) |
| platform/backup-and-migration#Q1 | migration 전 backup의 보존 종료와 삭제 보장은 무엇일까. | 추천대로 | 명시 삭제까지 보존; 물리 흔적 제거 보장 안 함 |
| platform/backup-and-migration#Q2 | 여러 컴퓨터 동기화를 첫 판에 지원할까. | 추천대로 | 단일 컴퓨터; sync는 이후 별도 설계 |
| platform/backup-and-migration#Q3 | event를 180일 뒤 압축 archive로 옮길까. | 추천대로 | 새 단일 ledger 원본의 영구 조회; 180일 삭제나 이동 없음 |
| platform/backup-and-migration#Q4 | 미적용 migration 전체를 하나로 확정할까, 단계별로 확정할까. | 추천대로 | 새 domain model의 단계별 원자성 |
| platform/backup-and-migration#Q5 | 매일 자동 backup은 ledger만일까, blob까지 포함한 플랫폼 묶음일까. | 추천대로 | 복원 가능한 참조 blob 포함 묶음, 매일 1회 최근 7개 |
| platform/blob-store#Q1 | 큰 원문·수리 근거·model 호출 본문의 보존 기간과 삭제 뒤 참조 흔적을 어떻게 정할까? | 다르게 정함 | 보존: 큰 자료(model 호출 본문, snapshot 첨부, trace 본문, 운영 log)는 용량 상한을 넘으면 오래된 것부터 정리하고, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함 20… |
| platform/blob-store#Q2 | 보안상 전면 삭제를 공유 참조·derived 사본·backup까지 어디까지 보장할까? | 추천대로 | 첫 판은 자동 전면 삭제를 약속하지 않고 반환 차단과 실제 적용 범위를 명시하며 backup 범위는 platform/backup-and-migration과 합의 |
| platform/blob-store#Q3 | 기동·매일 GC와 현재 모델의 정지 유지보수 GC를 어떻게 함께 지킬까? | 추천대로 | 주기 점검과 정지 유지보수 삭제 분리 |
| platform/blob-store#Q4 | blob 크기·stream·구간 한도와 준비 결과 수명을 얼마로 둘까? | 추천대로 | 내용 종류별 유한 한도를 측정해 고정하고 초과 시 명시적 거절·부분 반환 |
| platform/diagnostics#Q1 | security audit을 별도로 제공할까, doctor에 합칠까. | 추천대로 | doctor 상태 점검에 통합 |
| platform/diagnostics#Q2 | 개발자 진단 화면에 원문 오류를 제공할까. | 추천대로 | 새 model에 따라 redaction 안전 내용만 |
| platform/diagnostics#Q3 | 운영 log 회전 크기·총 보존 한도·crash 기록 기간은 얼마일까. | 다르게 정함 | 보존: 큰 자료(model 호출 본문, snapshot 첨부, trace 본문, 운영 log)는 용량 상한을 넘으면 오래된 것부터 정리하고, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함 20… |
| platform/identity#Q1 | 현재 identity의 범위 밖 forbidden과 옛 앱 범위 조회의 not_found 가운데 무엇을 적용할까? | 추천대로 | 존재 보호를 위해 대상 조회만 안전한 부재 응답을 적용 |
| platform/identity#Q2 | IPv4만인 옛 Host 목록과 현재 IPv4·IPv6 loopback을 어떻게 맞출까? | 추천대로 | 현재 두 loopback 가족을 지원하고 실제 port를 포함한 정확한 목록만 사용 |
| platform/identity#Q3 | token 무작위 byte 수·hash 방식·OS별 안전 전달을 무엇으로 정할까? | 추천대로 | OS CSPRNG 32byte와 검증된 hash·constant-time 비교 권고; OS 전달은 architecture에서 고정 |
| platform/identity#Q4 | WebSocket token을 subprotocol에 넣는 옛 방식과 token 전송 최소화를 어떻게 맞출까? | 추천대로 | 정상 클라이언트는 브라우저 밖이므로 HTTP upgrade의 Authorization header만 사용 |
| platform/install-and-update#Q1 | Electron 없는 headless 서버 지원을 첫 판에 제공할까. | 추천대로 | desktop 설치만 지원; 창 닫아도 플랫폼 유지 |
| platform/install-and-update#Q2 | Linux·macOS·Windows별 최소 OS version·CPU·설치 형식·데이터 폴더를 무엇으로 정할까. | 추천대로 | 세 OS 지원 약속 유지; Linux 기존 값 유지, macOS·Windows 최소 version·CPU·패키지·기본 폴더는 OS별 실제 검증 때 확정 |
| platform/install-and-update#Q3 | H6 기술 stack Electron·Deno/TypeScript·SQLite를 유지할까. | 추천대로 | 유지 |
| platform/install-and-update#Q4 | lophn 자체 update는 어떻게 제공할까. | 추천대로 | 첫 판 수동 OS별 설치 패키지 교체; Linux .deb 재설치; 무단 download·install·restart 없음 |
| platform/ledger#Q1 | H6의 SQLite·Deno 기술 선택을 유지할까? | 추천대로 | SQLite·Deno 유지; Deno 내장 SQLite 3.53·FTS5와 외부 SQLite 의존성 없음 적용 |
| platform/ledger#Q2 | core 영역의 반응을 모두 event로만 연결할까? | 추천대로 | 불변식 검사는 직접 하고 비동기 반응만 event·처리 위치로 연결하며 불필요한 내부 queue는 추가하지 않음 |
| platform/ledger#Q3 | SQLite NORMAL과 FULL 동기화 가운데 어느 것을 적용할까? | 추천대로 | 현재 모델의 FULL |
| platform/ledger#Q4 | event 온라인 보관 180일과 영구 append-only가 충돌한다. | 추천대로 | 현재 모델의 event와 확정 결과 영구 보존; 용량 부족은 신규 변경 제한 |
| platform/ledger#Q5 | command·read·queue·구독·변경 행 수의 유한 한도를 얼마로 둘까? | 추천대로 | 무제한 금지와 제어 요청 여유를 먼저 적용하고 responsiveness의 검증 부하로 기본값을 결정 |
| platform/ledger#Q6 | 확정 command 결과를 공간 때문에 정리할 수 있을까? | 추천대로 | 첫 판은 영구 보존하고 저장 부족 때 신규 변경을 제한 |
| platform/ledger#Q7 | 변화가 어디로 번졌는지 되짚는 영향 관계를 어떤 기록과 소유 concern으로 나타낼까? | 추천대로 | R3의 원인·대상·run으로 실제 확정 변경을 추적하고 예상 영향은 실제 전파와 구별; 별도 관계가 필요하면 소유 concern부터 확정 |
| platform/notifications#Q1 | 닫힌 세션 뒤 관련 notification을 어떻게 골라 묶어 보여 줄까. | 추천대로 | 개별 근거를 유지하고 발생 순서대로 모두 이어 읽기 |
| platform/notifications#Q2 | OS 전달 retry 간격과 실패 표시 시점을 어떻게 정할까. | 추천대로 | 자동 retry 없이 다음 화면 조회에서 즉시 안전한 실패 이유 표시 |
| platform/notifications#Q3 | OS notification 기본 제공을 어떻게 정할까. | 추천대로 | opt-in; 최소 제목과 대상 열기만 |
| platform/redaction#Q1 | 첫 gitleaks commit과 credential prefix 목록을 무엇으로 고정할까? | 추천대로 | 구현 시점에 한 commit과 OpenAI·Anthropic·GitHub·AWS·Slack·JWT·PEM 공통 표본을 고정하고 인증 형태 추가는 같은 정본에 반영 |
| platform/redaction#Q2 | 알려진 secret의 URL encoding·Base64도 자동 검출할까? | 추천대로 | 첫 판은 exact value·패턴·명시 비공개 제외를 적용하고 encoding 지원은 누출·오탐 테스트 뒤 추가하며 완전 탐지는 약속하지 않음 |
| platform/redaction#Q3 | 수집한 비밀을 패턴 redaction만으로 충분히 막을 수 있을까? | 추천대로 | 패턴만을 안전 근거로 삼지 않고 수집 최소화·알려진 값·명시 정책을 함께 적용 |
| platform/redaction#Q4 | secret 대체 표시는 옛 별표 셋·redacted 표식과 현재 모델의 별표 하나 중 무엇인가? | 추천대로 | 현재 모델의 별표 하나; 화면의 시각 표시는 shell/wording |
| platform/redaction#Q5 | 텍스트·JSON·이미지 크기와 redaction 처리 기한을 얼마로 둘까? | 추천대로 | 매체별 측정 한도를 정하고 초과·불확실은 원문 제외 |
| platform/responsiveness#Q1 | 응답 목표와 기준 장치·복합 부하 수치를 제품 acceptance 기준으로 채택할까? | 추천대로 | 먼저 제안 수치로 구현·측정하고 사용자의 실제 장치 결과로 조정하되 목표와 측정 방법은 제거하지 않음 |
| platform/responsiveness#Q2 | queue 크기·주체별 점유·reserved 제어 여유·worker 수의 기본값을 얼마로 둘까? | 추천대로 | 기준 부하에서 R6·R7을 달성하는 유한값을 측정해 고정하며 예약 제어 여유는 반드시 둠 |
| platform/secrets#Q1 | Linux Secret Service 없는 desktop·headless에서 어떤 대체 보호 저장소를 지원할까? | 추천대로 | 현재 모델대로 fail closed; OS adapter는 지원 OS가 확정될 때 정하고 파일 볼트는 재도입하지 않음 |
| platform/secrets#Q2 | 암호 보호 secret export의 형식·암호 파생 강도·지원 OS 사이 호환을 어떻게 고정할까? | 추천대로 | 검증된 인증 암호화·강한 password 파생을 사용하는 전용 이전 형식; 사람의 명시적 선택과 OS keychain 전용 import로 제한하고 평문 중간 파일 금지 |
| platform/secrets#Q3 | agent에 secret의 수정·마지막 사용 시각도 내보낼까? | 추천대로 | 현재 모델의 최소 조회를 적용하고 사용 이력은 원값 없이 별도 정책을 정함 |
| platform/security#Q1 | 배포용 Ubuntu sandbox를 끈 테스트를 성공으로 인정할까? | 추천대로 | 현재 안전 원칙에 따라 배포에서는 실제 sandbox를 검사하고 개발 우회는 제한만 기록 |
| platform/settings#Q1 | 설정 교환 format version과 옛 항목 migration을 첫 판부터 제공할까. | 추천대로 | version 1 왕복; 실제 항목 변경 update에 명시 변환 |
| platform/settings#Q2 | assignment별 지속 설정 override가 필요할까. | 추천대로 | 실제 서로 다른 수요가 생기기 전에는 세 층만 유지 |
| platform/settings#Q3 | 일반 설정을 자동 reload할까. | 추천대로 | 명시 apply/reload만; 외부 파일 감시 없음 |
| platform/settings#Q4 | 모르는 항목을 경고하고 무시할까, 오류로 거절할까. | 추천대로 | 엄격 거절 |
| platform/settings#Q5 | lophn 역할의 설정 설명과 변경 근거를 어디서 읽을까 | 추천대로 | 사람 이름·설명·영향·되돌림·적용 시점을 같은 registry로 읽고 question option action 적용 |
| redesign/propagate#Q1 | 공개 설정 key와 machine-local profile 선택의 정확한 저장 schema를 어디서 확정할까? | 추천대로 | 공통 registry는 enabled·nullable 기본/profile 선택만; local path·관측은 harness owner |
| redesign/propagate#Q2 | OS별 coding credential 보호 process-local 전달은 무엇으로 구현할까? | 추천대로 | 실제 loader·child generation·connection 결합을 검증; argv·일반 env·PTY 금지 |
| redesign/propagate#Q8 | 옛 일반 설정의 role 층과 Role ID를 새 Preset 구성으로 언제 migrate할까? | 추천대로 | 두 원본 금지; source 기록을 보존한 명시 migration을 실제 구현 schema 변경에서 설계 |

### documents (88)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| architecture/documents#Q1 | saved view 요구에 맞는 ledger 표와 command가 초기 domain model에 없다 | 추천대로 | 사람이 저장한 조건은 saved_views에 두고 목록만 derived로 계산 |
| architecture/documents#Q2 | document MIME 목록이 requirements와 domain model의 내장 선언 표에서 다르다 | 추천대로 | 요구의 넓은 MIME 목록을 내장 module에 적용하고 plain text는 heading 없이 추출 |
| architecture/documents#Q3 | format의 시간·난수·동적 코드 실행 금지를 Deno 권한만으로 강제할 수 없다 | 추천대로 | 내장 format부터 QuickJS WASM 새 context에서 실행하고 guest 전역·host binding을 차단한다 |
| architecture/documents#Q4 | scan·안정 읽기·format 실행의 초기 자원 한도를 정해야 한다 | 추천대로 | 준비 worker 2, 60초 scan, 750ms 안정 대기, 안정 읽기 3회, format 5초·64MiB guest memory·16MiB 입력·8MiB 출력에서 시작한다 |
| architecture/documents#Q5 | 재생성 seq S snapshot과 source_seq 당시 context 구성 근거를 어떻게 얻나 | 추천대로 | platform read의 일관된 snapshot과 event 구독 계약을 사용하고 context 구성은 before·after event를 source_seq까지 재생하여 계산한다 |
| architecture/documents#Q6 | SavedView ViewFilter는 series를 허용하지만 requirements의 첫 조건 범위에는 없고 보관 여부 조건은 요구만 있다 | 추천대로 | series 필터와 status active/archived/all 조건을 검증한 ViewFilter로 취급하고 보관은 영구 삭제가 아닌 view.archive로 처리 |
| architecture/documents#Q7 | SavedView 저장·변경 actor가 domain model에는 CE agent도 있으나 requirements는 사람의 동작만 적는다 | 추천대로 | requirements대로 저장·변경·보관을 사람만 허용한다 |
| architecture/documents#Q8 | versions 정책에 Series·draft 없음이라는 이전 문장이 남아 있다 | 추천대로 | 가족·draft는 documents/series로 구현하고 Operator 기존 출력 Document 제한은 유지한다 |
| architecture/documents#Q9 | ContentFile canonical JSON과 glob·gitignore 라이브러리를 고정해야 한다 | 추천대로 | 경로 codepoint 순, 고정 필드 JSON, UTF-8 SHA-256을 사용하며 picomatch와 ignore를 정확한 dependency 묶음에 고정한다 |
| check/documents#Q1 | versions에 Series·다음 번호·draft 없음이라는 이전 정책이 남아 있다. | 추천대로 | 채택한 series 요구를 따른다. |
| check/documents#Q10 | OutlinePage가 section 범위·hash·estimated token과 root 통계·활동·목록 저장 주체 및 series/view 종류를 누락한다. | 추천대로 | 본문 없이 필요한 metadata와 종류를 반환한다. |
| check/documents#Q11 | 검색 model은 tokenizer를 미정으로 두고 architecture는 가용 주제 텍스트 검색을 빠뜨린다. | 추천대로 | R10,R11의 keyword 규약을 따른다. |
| check/documents#Q12 | 요약 일치를 원문 snippet/ranges로만 반환하면 model 요약의 말을 원문의 일치 근거처럼 꾸미게 된다. | 추천대로 | 원문·summary·topic 일치 출처와 cache 입력 판·stale를 분리한다. |
| check/documents#Q13 | 추출 결과는 text_hash만 있으나 architecture는 대표 텍스트를 받으며 derived store와 blob의 위치도 다르게 적혀 있다. | 추천대로 | 정규화 text와 hash를 반환하고 바이트는 derived_texts에 둔다. |
| check/documents#Q14 | agent TermEvidence에 section·줄 범위를 전부 생략한 근거를 넣을 수 있다. | 추천대로 | 고정 판의 section 또는 유효 줄 범위와 실제 출현을 검사한다. |
| check/documents#Q15 | restore가 과거 format까지 복원한다는 요구와 base_version format으로만 준비한다는 저장 규칙이 맞지 않는다. | 추천대로 | 명시 restore를 허용된 format 선택으로 다루고 최신 판 CAS는 유지한다. |
| check/documents#Q16 | 보관 자리 제외 요구가 model·architecture에서 문서 보관 필터로만 구현되어 낡은 index가 보관 자리 자료를 반환할 수 있다. | 추천대로 | 기본 목록·검색의 현재 문서·자리 상태를 검사하고 고정 판 읽기는 유지한다. |
| check/documents#Q17 | 설치 안내 R17,R18을 받치는 고정 안내 값과 실제 read 경로가 없었다. | 추천대로 | BundledGuide는 설치 manifest 고정 참조이며 사용자 entity가 아니다. |
| check/documents#Q18 | 정함: 문서 목록 요구는 저장 주체·format 등의 전체 metadata를 기본 화면에 보여 주는 것으로 읽히며 최근 정보 최소화 결정과 충돌한다. | 이미 정함 | 정함: 문서 목록 요구는 저장 주체·format 등의 전체 metadata를 기본 화면에 보여 주는 것으로 읽히며 최근 정보 최소화 결정과 충돌 |
| check/documents#Q19 | 문서 architecture의 잎과 model의 가림은 프로젝트 말 규칙을 위반한다. | 추천대로 | leaf·redaction을 쓴다. |
| check/documents#Q2 | format domain model 내장 MIME 표가 Markdown·HTML만 허용하고 plain text·XHTML·별도 Markdown MIME 요구를 누… | 추천대로 | 요구 전체와 plain text의 heading 없음 규칙을 반영한다. |
| check/documents#Q20 | file-tracking model의 동시 처리 한도 전부 구현값이라는 설명은 초기 worker 2개 요구를 흐린다. | 추천대로 | 준비 worker 2개는 R5를 따르고 그 밖의 초기 자원값은 조절값이다. |
| check/documents#Q21 | SeriesInstance는 문서당 가족 하나를 강제하고 Series.name 불변을 선언하지만 requirements에 다중 가족 금지·이름 변경 금지가 없다. | 추천대로 | 가족의 현재 단순 모델을 유지할지 사람이 정한 뒤 requirements와 맞춘다. |
| check/documents#Q22 | coding-agent architecture의 lophn_project는 등록 폴더·label·연결 context를 반환하고 CLI는 folder ID/defa… | 추천대로 | coding-agent의 외부 통로를 documents의 현재 요구·값으로 맞춘다. |
| check/documents#Q23 | Context Engineer 후보는 다른 문서 3개 이상·근거 최대5개를 요구하지만 documents/terms model은 고정 임계값 없음으로 적는다. | 추천대로 | terms의 최소 본문 근거와 별도 역할의 후보 선정 정책을 구별하고 CE에 적용할 실제 값은 담당 concern에서 확인한다. |
| check/documents#Q24 | Context export R14의 목적·관점·이유·고정 읽기 판·glossary는 정의됐지만 파일 형식과 한 export의 판 선택 기준은 아직 없다. | 추천대로 | 기존 documents/contexts#Q2에서 형식과 선택 판 기준을 함께 확정한다. |
| check/documents#Q25 | 사용자 documents screen 기본 결과가 최신 저장 주체·시각을 항상 노출하며 format을 기본 filter로 두는 반면 최근 결정7과 보강한 R3,R… | 추천대로 | documents screen에서 결과 판단에 불필요한 저장 근거·format을 상세/More filters로 접는다. |
| check/documents#Q3 | Markdown 추출 정책에 HTML pre 안 heading 제외가 빠져 있다. | 추천대로 | HTML pre 제외를 반영한다. |
| check/documents#Q4 | format 선언에 요구한 구조·metadata·template·vocabulary가 없고 Series 정렬·draft가 없는 필드를 참조한다. | 추천대로 | format 안내·작성 시작값과 metadata 타입을 같은 고정 묶음에 둔다. |
| check/documents#Q5 | Project 생성에 tracking=true 입력이 가능하고 update의 folders 변경이 미리보기 검사를 우회한다. | 추천대로 | 생성은 tracking=false, 폴더·규칙 변경은 같은 미리보기 기준을 검사한다. |
| check/documents#Q6 | TrackingPreview의 상대 path만으로 여러 등록 루트에 있는 같은 이름 파일을 구별할 수 없다. | 추천대로 | 각 entry를 등록 루트와 결합한다. |
| check/documents#Q7 | 가장 깊은 등록 폴더 해석 요구가 Project model·architecture read contract에 없다. | 추천대로 | 꺼진 tracking의 중첩 루트도 가장 깊은 등록 루트로 해석한다. |
| check/documents#Q8 | SavedView가 요구의 삭제 대신 archive만 제공하고 revision을 공통 event seq가 아닌 1씩 증가하는 정수로 정의한다. | 추천대로 | view.delete·SavedViewDeleted와 event seq CAS를 쓰고 문서는 바꾸지 않는다. |
| check/documents#Q9 | SavedView가 요구에 없는 Series 멤버 조건·name/text/limit 상한·조건 없는 view 금지를 추가했다. | 추천대로 | 명시한 문서 조건과 공통 outline 예산만 지원한다. |
| documents/addressing#Q1 | hash 동일·5글자 shingle Jaccard 0.8 이상·0.5~0.8 대응과 사람 확정을 유지할까. | 추천대로 | 같은 key만 |
| documents/addressing#Q2 | section보다 작은 code block·table 주소를 추가할까. | 추천대로 | 첫 판 section·줄 범위만 |
| documents/addressing#Q3 | 문서 영문 address 이름을 어떻게 고르고 최대 길이는 얼마로 할까. | 추천대로 | 자동 제안 후 사람 수정; 최대 길이는 spec에서 결정 |
| documents/addressing#Q4 | 현재 이름 우선·문자열 redirect chain을 유지할까 영구 ID 예약으로 직접 해석할까. | 추천대로 | 영구 ID 예약 |
| documents/addressing#Q5 | 저장 위치를 MCP 원본 경로로 자동 결정할까. | 추천대로 | 실제 연결 또는 명시 자리; 없으면 자리 없음 |
| documents/contexts#Q1 | context 분할·병합을 실제 동작으로 추가할까. | 추천대로 | 첫 판 평면 편집만 |
| documents/contexts#Q2 | context export의 파일 형식과 고정 판 참조 포함 범위를 어떻게 정할까. | 추천대로 | context 항목·용어 export; 하위 context 없음 |
| documents/contexts#Q3 | 상위 context·용어 상속·최대 3단 구조를 추가할까. | 추천대로 | 평면 유지 |
| documents/contexts#Q4 | 문서 사이 영향·근거 간선을 기록하는 contract를 추가할까. | 추천대로 | 이번은 직접 항목만; 관계는 후속 |
| documents/contexts#Q5 | context 목차에 문서·context 관계 간선과 related context를 넣을까. | 추천대로 | 이번은 관계 지도 없음 |
| documents/contexts#Q6 | 확정한 관계로 관련 context를 탐색하게 할까. | 추천대로 | 직접 항목 역조회만 |
| documents/contexts#Q7 | watch section rename 자동 추적과 이력의 같은 대응 계산을 유지할까. | 추천대로 | 같은 key 비교·소실 |
| documents/contexts#Q8 | context 항목의 기준/참고/watch를 깊이 설정과 묶을까. | 추천대로 | 요청별 읽기 깊이 |
| documents/contexts#Q9 | 새 saved view·series 채택이 context의 View·Series 항목 금지를 바꿀까. | 추천대로 | context target 유지 |
| documents/file-tracking#Q1 | agent가 원본 연결 문서를 고치는 통로를 추가할까. | 추천대로 | 별도 제안 문서와 사람 편집 유지 |
| documents/file-tracking#Q2 | 초기 worker 2개를 요구로 유지할까 구현 조절값으로만 둘까. | 추천대로 | 초기 2개 후 측정 조정 |
| documents/file-tracking#Q3 | 안정 읽기 재시도·파일 수·바이트·시간 한도의 초기 값을 무엇으로 할까. | 추천대로 | 실측으로 정하고 한도 초과는 미확인 |
| documents/file-tracking#Q4 | 편집 세션당 감사 기록 한 번 규칙을 유지할까. | 추천대로 | 작업별 결과 |
| documents/file-tracking#Q5 | 앱의 허용된 파일 I/O도 사람 전용 원본 파일 API로 우회할까. | 추천대로 | 앱 I/O는 apps/permissions 소유 |
| documents/formats#Q1 | 설계 문서의 domain story·요구·불변식·테스트·blueprint 연결을 전용 format으로 결정적으로 검사할까. | 추천대로 | 첫 판 일반 Markdown, 판단 품질은 lophn-agent/evaluation |
| documents/formats#Q2 | 문서에 실행 capability를 허용할까. | 추천대로 | 첫 판 정적·격리 view |
| documents/formats#Q3 | slide·data report의 초기 section 추출을 추가할까. | 추천대로 | 후속 확장 |
| documents/formats#Q4 | 사람이 추가 format module을 설치할 수 있게 할까. | 추천대로 | 첫 판 내장만 |
| documents/formats#Q5 | 묵시 format 검사 실패에도 원문 version을 남길까. | 추천대로 | 새 모델의 원문 보존 |
| documents/formats#Q6 | 새 모델의 지원 MIME 목록을 기존 plain text·XHTML·별도 Markdown MIME까지 넓힐까. | 추천대로 | 기존 5개 MIME 유지 |
| documents/formats#Q7 | 격리 format 실행의 시간·메모리·입출력 상한을 무엇으로 할까. | 추천대로 | H6 환경 선택 뒤 실측하고 초과 실행만 종료 |
| documents/formats#Q8 | 동적 HTML은 원본 HTML과 렌더링 DOM 중 무엇을 추출할까. | 추천대로 | 결정적 원본 HTML |
| documents/formats#Q9 | 독립 format 규칙 번호와 기존 index 자동 재작성 금지를 유지할까. | 추천대로 | 정확한 module 보존 |
| documents/outline-and-search#Q1 | 문서 제목 30자·요약 200자·최상위 section 설명 80자를 organizing model로 보강하는 별도 요청 contract를 둘까. | 추천대로 | 먼저 원문 발췌, 후속 요청 기반 cache |
| documents/outline-and-search#Q2 | embedding 검색을 추가할까. | 추천대로 | 첫 판 keyword만 |
| documents/outline-and-search#Q3 | 한국어 검색에 기존 trigram을 유지할까 다른 tokenizer로 바꿀까. | 추천대로 | 기존 trigram 유지 후 실측 |
| documents/outline-and-search#Q4 | token 추정치를 model별로 보정할까. | 추천대로 | 첫 판 codepoint/3 |
| documents/outline-and-search#Q5 | 기존 section rename 이력과 대응 chain을 새 key 원칙에 맞춰 어떻게 처리할까. | 추천대로 | 같은 key 비교만 |
| documents/outline-and-search#Q6 | saved view 없음이라는 기존 outline domain model을 이번 채택에 맞춰 확장해야 한다. | 추천대로 | saved view 저장 조건 |
| documents/outline-and-search#Q7 | 단순 offset cursor와 갱신 시각 정렬을 새 기준 고정 규칙에 그대로 쓸까. | 추천대로 | 기준 결합 cursor |
| documents/outline-and-search#Q8 | saved view의 처음 지원 조건·정렬 범위를 이대로 둘까. | 추천대로 | 현재 정의된 문서 조건만 |
| documents/projects#Q1 | 여러 프로젝트의 추적 폴더 겹침 금지를 유지할까. | 추천대로 | 겹침 금지 |
| documents/projects#Q2 | 폴더의 label·기본 여부와 기본 추적 행의 존재 의미를 새 모델에도 유지할까. | 추천대로 | 폴더 설명과 명시적 스위치 |
| documents/projects#Q3 | 프로젝트의 폴더·원본 경로 정보를 별도 export로 제공할까. | 추천대로 | 별도 export는 후속으로 두고 지금 backup만 |
| documents/projects#Q4 | 미리보기와 적용 후 파일 목록의 일치를 고정 디스크 snapshot으로 보장할까. | 추천대로 | 같은 규칙·구성 기준 |
| documents/series#Q1 | 기존 domain model의 Series 없음 정책을 이번 채택에 맞춰 어떻게 갱신할까. | 추천대로 | 독립 가족 허용 |
| documents/series#Q2 | 정렬 기준을 format metadata 필드로 둘까 key의 결정적 정렬로 둘까. | 추천대로 | 선언된 format 값과 key fallback |
| documents/series#Q3 | 주간 보고용 날짜·주차 다음 이름 규칙을 추가할까. | 추천대로 | 우선 기존 숫자 규칙, 날짜는 수동 key |
| documents/series#Q4 | draft 값을 첫 version 없는 Document로 저장하던 구조를 유지할까. | 추천대로 | 가족 내 작성 준비 값 |
| documents/series#Q5 | Operator가 series의 다음 독립 문서를 만들 수 있게 assignment를 넓힐까. | 추천대로 | 이번은 기존 문서 새 판만 유지하고 가족은 사람·허용 앱·coding agent가 생성 |
| documents/terms#Q1 | context 사이 같은 뜻의 다른 용어를 실제 대응으로 연결할까. | 추천대로 | 현재는 보고·질문만 |
| documents/terms#Q2 | 기존 alias·translation을 새 Term에 유지할까. | 추천대로 | 정확한 이름과 사람 정의 |
| documents/versions#Q1 | 자리 문서·version export의 선택 판·첨부 포함 범위를 어떻게 확정할까. | 추천대로 | 원문·고정 판만 export하고 derived는 재생성 |
| documents/versions#Q2 | 대용량 HTML·data의 파일 수·바이트·준비 시간 상한을 무엇으로 할까. | 추천대로 | 실측 상한과 명시적 실패 |
| documents/versions#Q3 | 문서 영구 삭제를 추가할까. | 추천대로 | 첫 판 보관만 |
| documents/versions#Q4 | series 없음이라는 기존 domain model 정책을 이번 series 채택에 맞춰 어떻게 바꿀까. | 추천대로 | 독립 가족은 documents/series |
| documents/versions#Q5 | MCP 작업 디렉터리를 저장 원본으로 기록할까. | 추천대로 | 실제 관측 또는 명시 연결 |
| documents/versions#Q6 | lophn과 함께 배포하는 사용 안내를 어디에 둘까 | 추천대로 | 설치 guides catalog의 version·title·content hash; 사용자 Document 자동 생성 없음 |
| redesign/propagate#Q5 | 전역 LOPHN.md의 Project 없는 source를 어떻게 version에 연결할까? | 추천대로 | place=null exact global instruction source; data-root recursive tracking 금지 |

### apps (86)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| apps/agent-context#Q1 | context command 이름과 화면 주석 입력을 어떻게 정할까? | 추천대로 | 예약 이름 없이 read_command와 target의 write_command를 참조하고 view_session·revision으로 현재 화면에 묶기 |
| apps/agent-context#Q2 | turn에 넣는 앱 상태 요약의 상한은 얼마로 할까? | 추천대로 | redaction 뒤 2048byte 이하 요약만 넣고 상세는 같은 read command로 조회 |
| apps/automations#Q1 | H1: automation의 외부 효과를 정확한 release·명령·입력·범위의 반복 사전 허락으로 지원할까? | 다르게 정함 | automation도 external을 돌린다. 켤 때 한 번 승인, confirm command만 뺀다(H1) |
| apps/automations#Q2 | 달력 시각·파일 변경·event와 누락 회차 정책을 첫 판에 추가할까? | 추천대로 | 시작·간격만, 놓친 회차 skip |
| apps/automations#Q3 | 이전 옮김 재료의 최대 retry 10회와 현재 자동 retry 0회 중 어느 쪽을 유지할까? | 추천대로 | 현재 모델의 0회 |
| apps/blueprint#Q1 | 출력·오류 schema와 opaque JSON 계약을 이번 작은 command 모델에도 추가할까? | 추천대로 | 현재 domain model의 입력 계약만 사용하고 추가는 별도 결정한다. |
| apps/blueprint#Q2 | tagged union·nullable 조합과 입력 줄임 문법을 어디까지 지원할까? | 추천대로 | 현재 한 타입 schema를 요구로 사용하며 줄임 문법은 spec에서 정한다. |
| apps/blueprint#Q3 | blueprint 작성형은 TypeScript만 받을까 선언형 YAML도 받을까? | 추천대로 | TypeScript의 권한 없는 10초 추출을 유지한다. |
| apps/blueprint#Q4 | 전체·패널·카드 화면을 어떤 선언으로 구별할까? | 추천대로 | 같은 반응형 screen에 full/panel/card 지원 목록을 두고 실제 지원 모드만 열기 |
| apps/blueprint#Q5 | write의 되돌리기 지원을 어떤 실제 계약으로 검증할까? | 추천대로 | 되돌림 command와 invocation에 묶인 receipt·expected_revision을 선언하고 app test로 변경/복원/중복/충돌 확인 |
| apps/blueprint#Q6 | 앱의 되돌림 지원과 기존 run revert의 앱 업무 DB는 범위 밖이라는 규칙을 어떻게 잇나? | 추천대로 | 앱이 선언한 receipt·revision으로 앱 revert command를 호출하고 실제 성공/충돌을 별도 확인 |
| apps/connections#Q1 | 앱 쌍 한 번 허락의 command 범위를 어떻게 보관할까? | 추천대로 | 방향 있는 caller/target 앱 쌍의 정확한 command 목록을 기존 Grant에 두고 새 key는 새 허락 |
| apps/connections#Q2 | 앱끼리 호출 경로의 순환과 깊이를 어떻게 제한할까? | 추천대로 | 서명된 현재 path의 중복을 거절하고 최대 8개 앱으로 제한 |
| apps/data#Q1 | 업무 첨부 파일을 지원하면 backup을 DB와 첨부까지 넓힐까? | 추천대로 | 첫 판 SQLite만 |
| apps/data#Q2 | 운영 후 사람이 손실을 확인하는 별도 restore를 제공할까? | 추천대로 | activation 전 실패 복원만 |
| apps/invocations#Q1 | 일반 invocation 후행 기록에 durable 전달 보관이 필요한가? | 추천대로 | 제한된 메모리 재전송으로 시작하고 손실 진단 |
| apps/invocations#Q2 | 전체 운영 통계에 호출·실행 기회·실패 분모·계측 공백의 bounded rollup을 제공할까? | 추천대로 | 첫 판은 실제 보존된 관측만, 전체 실패율 주장 없음 |
| apps/invocations#Q3 | confirm 증명 기한·접수 marker 용량·summary byte·기록 메시지 용량·backoff 값을 얼마로 정할까? | 추천대로 | platform/identity와 실측 후 유한값 확정 |
| apps/invocations#Q4 | 기존 confirm R7의 앱 화면 사람 요청 한정과 앱/agent API 호출을 어떻게 맞출까? | 추천대로 | user/app/agent caller를 유지하고 정확한 사람 approval을 같은 accepted/proof로 한 번 사용 |
| apps/permissions#Q1 | 앱이 선언한 channel로 직접 notification을 보내는 permission을 첫 판에 넣을까? | 추천대로 | platform/notifications의 platform/notifications 계기만 쓰고 앱 notification permission은 넣지 않는다. |
| apps/permissions#Q2 | network wildcard와 port 0 및 host만의 grant를 유지할까 좁은 domain model을 따를까? | 추천대로 | 현재 domain model의 wildcard·port 0 금지를 적용한다. |
| apps/permissions#Q3 | loopback 주소 정규화에서 중복을 제거할까 중복 선언을 거절할까? | 추천대로 | 현재 정규 범위의 중복 거절 |
| apps/permissions#Q4 | 앱 소유 secret의 무승인 생성·조회·변경·삭제 통로를 유지할까? | 이미 정함 | secret은 grant가 허락이고 호출별 확인 없음(2026-10-03 결정 4) |
| apps/permissions#Q5 | symlink 교체 공격 저항과 OS별 추가 보안 경계를 어느 수준까지 제공할까? | 추천대로 | 현재 한계를 명시하고 OS별 실제 테스트 결과로 추가 경계를 정한다. |
| apps/permissions#Q6 | 기존 external command의 일괄 확인 문구를 effect와 독립인 confirm 계약으로 바꿀까? | 추천대로 | apps/invocations과 추가 지시의 confirm 독립 계약을 적용한다. |
| apps/permissions#Q7 | network 방향 정책을 OS 제한과 플랫폼 전송부에 어떻게 나눌까? | 추천대로 | 넓은 Deno flag로 우회하지 않고 표현 불가 요청은 거절한다. |
| apps/permissions#Q8 | 정함: secret 원값을 앱에 줄까 플랫폼 전송부가 인증만 대신할까? | 이미 정함 | 정함: secret 원값을 앱에 줄까 플랫폼 전송부가 인증만 대신할까? |
| apps/permissions#Q9 | agent가 앱 command를 쓰게 여는 허락을 어디에 둘까? | 추천대로 | 앱별 정확한 command 목록을 기존 Grant로 열고 역할/assignment 범위와 교차하기 |
| apps/preview#Q1 | 이전 source 직접 실행과 현재 완성된 고정 bundle 실행 중 무엇을 preview 대상으로 할까? | 추천대로 | 현재 고정 bundle |
| apps/registration#Q1 | 앱 slug 변경 때 관리 폴더와 외부 source를 어디까지 이동할까? | 추천대로 | 외부 source는 이동하지 않고 주소 변경은 documents/addressing을 따른다. |
| apps/releases#Q1 | machine 생성물 변경 거절과 설계 변경 경고를 어디서 어떤 대상으로 검사할까? | 추천대로 | 실제 변경 거절은 app test와 release 준비 경계에서 하고 지침은 coding-agent/guides에 둔다. |
| apps/releases#Q2 | H2: coding agent의 모든 activation도 매번 사람이 승인할까? | 추천대로 | 새 release는 사람이 한 번 눌러 고른다(H2) |
| apps/releases#Q3 | 현재 데이터와 다른 schema의 이전 release를 어디까지 허용할까? | 추천대로 | 같은 schema만 바로 허용하고 restore는 apps/data로 구별한다. |
| apps/releases#Q4 | 앱 health의 정상 신호·주기 metric·비교 조건과 상태 점검 선언을 지원할까? | 추천대로 | 이번에 정하지 않고 시작 준비 확인과 업무 정상을 구별한다. |
| apps/releases#Q5 | release 준비의 바이트·파일 수·시간 상한을 얼마로 정할까? | 추천대로 | 실제 앱 bundle을 측정해 상한을 정하며 무제한 준비는 허용하지 않는다. |
| apps/runtime#Q1 | H6: 앱 runtime의 Deno 기술 선택을 유지할까? | 추천대로 | Deno 유지를 적용하고 배포 포함은 platform/install-and-update, TypeScript 공통 SDK·템플릿 계약은 apps/sdk를 따른다. |
| apps/runtime#Q2 | 지원 OS별 CPU·RSS·disk 한도와 추가 격리 수준을 어떻게 정할까? | 추천대로 | 실제 앱 수별 RSS/PSS·CPU·기동 시간을 먼저 측정하고 검증된 OS 제한만 지원한다. |
| apps/runtime#Q3 | 앱 GUI는 앱 프로세스가 serve할까 플랫폼이 정적 bundle을 serve할까? | 추천대로 | 앱 프로세스의 local HTTP 유지 |
| apps/runtime#Q4 | subprocess가 반드시 필요한 사용자 앱을 이번 범위에서 지원할까? | 추천대로 | 현재 금지하고 미래 container 교체 자리만 미리 만들지 않는다. |
| apps/runtime#Q5 | 시작 timeout·종료 유예·재시작 값은 이전 숫자를 유지할까 OS별 실측 뒤 확정할까? | 추천대로 | 이전 숫자를 요구로 유지하고 OS 테스트로 조정한다. |
| apps/runtime#Q6 | 한 앱이 다른 앱 command를 부르는 앱 사이 연결을 지원할까? | 대체됨 | 앱끼리 command 호출은 정했다(apps/connections, apps I7) |
| apps/runtime#Q7 | Windows에서도 두 로컬 통로를 Unix socket으로 제공할까 OS별 transport를 둘까? | 추천대로 | 같은 direct call·사용자 전용 계약을 지키는 OS별 실측으로 결정한다. |
| apps/runtime#Q8 | 기존 apps/runtime Q6의 앱 사이 연결 지원 여부와 확정 intent를 어떻게 맞출까? | 추천대로 | 확정 intent에 따라 apps/connections로 지원하되 기존 질문 번호와 요구는 보존 |
| apps/sdk#Q1 | 개인 Package 등록·승격·2개 사용처·도메인 이름·입출력·추출 뒤 정상 확인과 patch/minor 묶음·major 앱별 전파 계약을 도입할까? | 추천대로 | 설치 제공만, 실제 2개 앱 재사용 뒤 별도 결정 |
| apps/sdk#Q10 | 새 보고 모델에서 표본 evidence hook을 첫 판에 제공할까? | 추천대로 | problems/snapshots와 크기·권한 계약 후 제한된 hook |
| apps/sdk#Q11 | 이전 설치 SDK directory 직접 읽기와 현재 운영 bundle에 포함한 고정 byte 중 어느 것을 유지할까? | 추천대로 | 현재 domain-model의 bundle |
| apps/sdk#Q12 | 초기 SDK 공개 version은 새 1.0.0으로 시작하고 과거 공개 version을 재사용하지 않을까? | 추천대로 | 이전 이름 유지, 새 API는 1.0.0, 과거 byte로 가장하지 않음 |
| apps/sdk#Q13 | 모든 앱 템플릿의 초기 migration 의무와 DB 미사용 앱의 schema 0 허용을 어떻게 맞출까? | 추천대로 | DB 사용 시만 migration |
| apps/sdk#Q14 | 패널·카드 반응형 기본 지원 폭은 얼마로 할까? | 추천대로 | container resize 기반으로 패널 320px·카드 240px부터 페이지 가로 scroll 없이 제공 |
| apps/sdk#Q15 | 기존 버린 것의 첫 판에는 앱 사이 호출이 없다는 문구와 새 앱 command API 약속을 어떻게 맞출까? | 추천대로 | 옛 read-model Package는 복원하지 않고 cap-schedule에 direct command client를 추가 |
| apps/sdk#Q2 | 앱 UI SDK를 React로 고정할까 Web Components로 만들까? | 추천대로 | 기존 React 유지 |
| apps/sdk#Q3 | SDK registry 전체 git 관리를 제공할까 플랫폼 export로 backup과 이전을 보장할까? | 추천대로 | platform/backup-and-migration의 export로 통합 |
| apps/sdk#Q4 | SDK 공개 type와 입력·출력 호환 비교를 개발 검사에 둘까 제품 등록에도 둘까? | 추천대로 | 개발 테스트에서 type와 입력·출력·unknown-field policy를 검사 |
| apps/sdk#Q5 | 공개 slot 교체와 props/major 불일치시 해당 slot fallback을 첫 판에 제공할까? | 추천대로 | 첫 판 없음, shell/design-system과 실제 사례 뒤 결정 |
| apps/sdk#Q6 | platform/notifications 표 밖 앱 notification을 위한 @lophn/cap-notify를 제공할까? | 추천대로 | platform/notifications 표만 |
| apps/sdk#Q7 | 2 major 뒤처짐 주간 보고와 이름·prop 유사 component 경고를 제공할까? | 추천대로 | 첫 판 자동 경고 없음, 요청된 Operator 보고로 사례 확인 |
| apps/sdk#Q8 | Deno의 lophn-sdk 해석은 파일 경로 치환과 로컬 registry server 중 무엇을 쓸까? | 추천대로 | 개발 때 로컬 파일 경로 치환, 운영은 고정 bundle |
| apps/sdk#Q9 | 약 1.9MB font를 release마다 포함할까 desktop 공유를 쓸까? | 추천대로 | release 독립 font로 재현성 우선 |
| architecture/apps#Q1 | Deno가 net.fetch와 net.listen 방향을 구별하지 못할 때 실제 강제를 어떻게 할까? | 추천대로 | fetch는 supervisor 비동기 전송부에서 exact host·port를 검사하고 listen은 방향 강제 OS 어댑터 검증 전 거절 |
| architecture/apps#Q2 | 정함: secret 원값을 앱에 전달할까 인증만 플랫폼이 대신할까? | 이미 정함 | 플랫폼 인증 전송, 검사는 선언 이름∩grant(결정 4) |
| architecture/apps#Q3 | release 준비의 바이트·파일 수·시간 기본 상한은 얼마로 할까? | 추천대로 | 입력 source 64MiB·완성 bundle 256MiB·10000파일·300000ms로 시작하고 설치 테스트로 확인 |
| architecture/apps#Q4 | confirm marker와 후행 invocation 전달 목록·summary·backoff 수치는 얼마로 할까? | 추천대로 | marker 프로세스당 4096개, 전달 4096 메시지 또는 8MiB·summary 16KiB·1s부터 30s backoff; durable outbox 없음 |
| architecture/apps#Q5 | 앱 안 automation clock을 유지하며 전체 동시 한도 4개를 어떻게 보장할까? | 추천대로 | clock과 handler는 앱 안, 전체 permit만 supervisor; 대기 없이 skip·실제 종료에 반환 |
| architecture/apps#Q6 | 운영 화면은 앱 프로세스가 serve할까 별도 정적 플랫폼 server가 serve할까? | 추천대로 | bundle의 완성 화면 byte를 앱 socket으로 serve하고 Electron main이 direct 조회 |
| architecture/apps#Q7 | lophn-sdk scheme을 운영에서 어떻게 해석할까? | 추천대로 | 준비 때 공개 hash 검사 후 bundle 내부 상대 file import map으로 치환 |
| architecture/apps#Q8 | bundle에 실제 test result를 넣으면서 동일 bundle hash를 test한 결과를 요구하면 hash 순환이 생기는가? | 추천대로 | bundle byte 완성 후 test하고 실제 Verification은 Release.tests와 release_tests에 불변 참조; bundle byte는 test 뒤 변경하지 않음 |
| architecture/apps#Q9 | Windows에서 고정 Deno의 Unix socket HTTP가 모든 지원 설치에서 가능한가? | 추천대로 | AF_UNIX 우선 설치 테스트, 미지원 때 같은 HTTP 메시지와 credential 검증의 사용자 전용 ACL named pipe 어댑터; 검증 전 unavailable |
| check/apps#Q1 | 정함: SecretUseContext가 confirm=true와 필수 ledger invocation을 요구해 grant 기반 secret 사용 및 성공 일반 r… | 이미 정함 | 정함: SecretUseContext가 confirm=true와 필수 ledger invocation을 요구해 grant 기반 secret 사용 |
| check/apps#Q10 | 여러 apps requirements의 버린 것과 runtime Q6가 현재 지원하는 앱 사이 command 호출을 없거나 미정이라고 한다. | 추천대로 | 앱 사이 command 호출 지원과 과거 read model·provider export 폐기를 구분한다. |
| check/apps#Q11 | permissions Q6·Q8이 최근 사람이 정한 독립 confirm과 원값 미전달을 다시 선택지로 내놓는다. | 추천대로 | effect·confirm 독립과 grant 기반 secret 사용은 유지하고 요청 schema만 후속 질문으로 둔다. |
| check/apps#Q12 | SDK Package에 R2의 한 종류 필드가 없고 설치 권한·초기 version·SemVer·trace·조건부 migration이 하위 model에 빠졌다. | 추천대로 | Package.kind와 command/event 계약을 연결하고 확정 요구를 model에 반영한다. |
| check/apps#Q13 | data model이 기본 backup 보존 5개와 진행 복원 참조 보호를 명시하지 않는다. | 추천대로 | 진행 복원에 필요한 backup은 최근 5개 기본 한도와 별개로 보호한다. |
| check/apps#Q14 | apps I9의 앱과 데이터 export가 blueprint·이력·DB만 보장하여 실제 실행 bundle과 정확한 SDK byte 반출을 보장하지 않는다. | 추천대로 | 고정 실행 내용까지 export하고 secret·credential은 제외하며 외부 자료 포함 여부를 명시한다. |
| check/apps#Q15 | architecture의 release 준비 수치가 requirements에는 상한 미정으로 남아 있다. | 추천대로 | source 64MiB·bundle 256MiB·10000파일·300000ms 기본값을 요구로 연결하고 실측 조정만 열린 질문으로 둔다. |
| check/apps#Q16 | architecture의 confirm marker·후행 전달·summary·backoff 수치가 requirements와 model에서는 전부 미정이다. | 추천대로 | 4096 marker·4096 메시지/8MiB·16KiB summary·1/2/4초 최대 30초 backoff를 일치시킨다. |
| check/apps#Q17 | 공용 UI SDK·앱 템플릿이 shell/wording의 i18n·en-only 계약을 build/test·고정 bundle에 연결하지 않는다. | 추천대로 | 전역 규칙은 shell/wording이 소유하고 SDK는 재사용·catalog 고정·검사 연결만 맡는다. |
| check/apps#Q18 | apps blueprint의 같은 선언 반복 저장에 필요한 (app,key)→Document 대응 정본이 documents/versions model과 archi… | 추천대로 | 첫 저장과 안정 대응을 documents/versions가 같은 transaction으로 소유하고 이름 변경·재전송에도 같은 Document를 찾게 한다. |
| check/apps#Q19 | apps I9 export를 사람이 찾고 실행하는 flow가 현재 flow 목록에 없다. | 추천대로 | export 대상·포함/제외·일관된 사본 준비·파일 저장·실패/취소를 다루는 flow를 연결하고 불필요한 내부 개념은 숨긴다. |
| check/apps#Q2 | 정함: permissions model의 시작 코드 secret 사용과 준비 모드 금지가 겹치고 원값 반환이 열린 선택으로 남았다. | 이미 정함 | 정함: permissions model의 시작 코드 secret 사용과 준비 모드 금지가 겹치고 원값 반환이 열린 선택으로 남았다. |
| check/apps#Q3 | 정함: architecture가 secret command의 automation 선언·실행을 금지한다. | 이미 정함 | 정함: architecture가 secret command의 automation 선언·실행을 금지한다. |
| check/apps#Q4 | releases R1이 test result를 이미 고정한 bundle 안에 넣어 R5의 같은 완성 bundle hash 테스트와 순환한다. | 추천대로 | test result는 release의 불변 참조이며 테스트 뒤 bundle byte를 바꾸지 않는다. |
| check/apps#Q5 | invocations R14에 intent 연결이 없다. | 추천대로 | 읽기 결과의 관측 의미와 이어 읽기 정합성은 apps I5를 따른다. |
| check/apps#Q6 | automations model이 1초 검사·전체 동시 한도 4·10분 timeout·실행 시 external/confirm 금지를 충분히 받치지 않는다. | 추천대로 | 요구와 architecture의 단조 시계·비대기 permit·실제 종료 반환을 동일하게 연결한다. |
| check/apps#Q7 | preview model에 실제 confirm handler·approval 소비와 다른 앱·loopback·문서 저장 금지가 빠졌다. | 추천대로 | preview는 실제 효과와 approval 소비를 하지 않고 없는 preview를 운영 앱으로 대체하지 않는다. |
| check/apps#Q8 | runtime model과 direct invoke 입력이 release 없는 preview에도 필수 rel ID를 요구한다. | 추천대로 | PreviewInput의 bundle_hash에 결속하고 live release만 필수로 한다. |
| check/apps#Q9 | runtime model의 정할 것과 Q5가 이미 R2·R15·R19로 정한 기본값을 전부 미정으로 되돌린다. | 추천대로 | 시작 30초·종료 유예 10초·1/2/4초 최대 5분 backoff·10분 5회 초과 종료 정책을 명시한다. |

### problems (51)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| architecture/problems#Q1 | 보고 대기·retry·snapshot timeout의 첫 기본값은 무엇인가 | 추천대로 | SDK 32개/4MiB, collector 128개/16MiB·동시4, 조립2초, retry3회 250/1000/3000ms |
| architecture/problems#Q2 | 로그 bytes·오류 frame·snapshot bytes의 첫 기본값은 무엇인가 | 추천대로 | 로그64KiB·frame32·snapshot2359296bytes, 넘친 항목은 실제 이유와 제외 |
| architecture/problems#Q3 | test runtime·관측 protocol·native test command의 첫 지원 범위는 무엇인가 | 추천대로 | Deno test만 지원하고 app command·화면 fixture를 harness에서 호출; 관측은 kind별 JSON, runner가 실제 lifecycle·약화 검사로 판정 |
| architecture/problems#Q4 | test 한도와 작업 폴더 보관 기본값은 무엇인가 | 추천대로 | 동시2·대기16, timeout 필수 최대300초/제안60초, 출력1MiB/side·메모리512MiB/process, 확정 뒤 즉시 정리·미확정 안전 spool 최대24시간 뒤 판정불가 복구 |
| architecture/problems#Q5 | RequestTest 공통 command 기록에서 접수·시작시도·실제 시작·runner 상실을 어떻게 복구 가능한가 | 추천대로 | 고정 요청·시작시도·runner 식별을 공통 기록, 실제 시작 관측과 감독 lifecycle로 구별; 미확인 시작을 Verification으로 꾸미지 않음 |
| architecture/problems#Q6 | feedback 캡처·비공개 영역·추가 redaction·최종 hash binding을 어떻게 통일하는가 | 추천대로 | shell 앱 화면 틀의 동일 캡처 binding·관측 시점·선택·최종 안전 이미지 hash를 collector가 검증; 변화·불명은 이미지 제외 |
| architecture/problems#Q7 | Deno heap 제한이 전체 메모리 제한을 보장하지 않을 때 테스트를 실행할 수 있는가 | 추천대로 | V8 heap256MiB 외 전체 process512MiB는 platform/security 경계로 강제 가능한 환경만 접수; 불가 환경 unavailable |
| check/problems#Q1 | grouping의 사용자용 상세에 claim을 설명하라는 요구가 화면 원칙의 claim 숨김과 충돌한다. | 추천대로 | 실제 담당과 수리 작업 상태만 표시하고 claim·기한·연결 식별자는 숨긴다. |
| check/problems#Q10 | architecture가 조립 timeout·frame·로그 bytes·snapshot bytes를 정했으나 요구·모델에 근거가 없다. | 추천대로 | 기존 architecture 추천 기본값을 한도로 채택하며 장기 보존 bytes와 구별한다. |
| check/problems#Q11 | architecture만 Deno 지원·IPC protocol·실행 한도·spool 정리를 강제하고 tests 요구·모델은 정할 것으로 남아 있다. | 추천대로 | 기존 추천 Deno/IPC·timeout·동시·출력·메모리·24시간 spool 정책을 채택한다. |
| check/problems#Q12 | tests 모델이 spawn 전에 시작 사실을 기록한다고 하여 실제 시작과 시도를 섞는다. | 추천대로 | 공통 command의 시작 시도만 먼저 확정하고 runner의 실제 spawn·started_at으로 구별한다. |
| check/problems#Q13 | tests#R18에 intent 연결이 없고 architecture가 leaf를 새 번역어로 적는다. | 추천대로 | fixture 검증은 problems#I4에 연결하고 문서 말은 leaf를 쓴다. |
| check/problems#Q14 | platform의 상시 프로세스 표는 report collector가 없고 test runner는 작업 시 bounded child인데 problems는 둘을 장… | 추천대로 | platform 소유자의 배치 결정을 하나로 맞춰 collector ingress와 상시 work/closing 반응기를 실제 감독하도록 한다. |
| check/problems#Q15 | RequestTest는 공통 command 기록으로 요청·시작·runner 상실을 복구하지만 platform/ledger는 불변 CommandResult만 정의하… | 추천대로 | 별도 큐를 만들기 전에 platform 소유자가 단계별 불변 command 결과 및 감독 lifecycle 조회 contract를 명시한다. |
| check/problems#Q16 | process 전체 메모리 512MiB 경계가 테스트 접수 조건이나 platform/security·platform architecture에 OS별 강제 adap… | 추천대로 | platform에서 OS별 강제 지원 범위를 정하고 불가 환경에서는 요청을 unavailable로 남긴다. |
| check/problems#Q17 | problems가 새로 소유한 예약 안내 key·en 값이 app-detail screen의 문구 표에는 없다. | 추천대로 | screen 작성자는 problems/problem-codes 소유 catalog를 참조하여 사용자 화면 key 누락 검사에 포함한다. |
| check/problems#Q2 | 앱 선언의 고정 문제 문구에 message key·en 요구가 없고 예약 안내의 domain model 값은 한국어다. | 추천대로 | 앱 선언도 key·en을 요구하고 당시 release의 고정 안내를 사용하며 예약 안내를 key·en으로 정의한다. |
| check/problems#Q3 | RecordReport 모델이 ID 하나라도 다르면 conflict라고 하여 새 발생까지 거절한다. | 추천대로 | 새 ID는 새 발생으로 접수한다. |
| check/problems#Q4 | Feedback 모델에 전체 3MiB 전송·PNG header 검사가 없고 캡처 조건에 떠 있는 dialog·가려진 view의 구분이 빠져 있다. | 추천대로 | 전체 전송 한도·PNG header와 modal/overlay 캡처 제외를 반영한다. |
| check/problems#Q5 | 현상이 안 보임 확인은 last Report를 비교해야 하나 UserProblemDecision 입력에 그 필드가 없고 부정 확인 재요청 억제 정책도 없다. | 추천대로 | last_report와 현재 활성 release 결속 및 동일 release·근거 부정 확인 뒤 재요청 억제를 정의한다. |
| check/problems#Q6 | 해석 연결은 requirements에서 담당 App Engineer만 허용하나 모델·architecture는 user도 직접 허용한다. | 추천대로 | 담당 App Engineer만 연결·해제한다. |
| check/problems#Q7 | read 출력 schema 검사를 필수로 요구하지만 apps/blueprint에는 출력 schema가 없고 열린 질문이다. | 추천대로 | 현재 입력 계약·read 상태 불변·automation의 command/input/grant와 external/confirm 금지를 검사한다. |
| check/problems#Q8 | migration 2종과 현재 앱 효과·automation 실행 범위의 필수 검사가 tests 모델 정책에 빠져 있다. | 추천대로 | 각 소유 apps concern contract를 가리켜 필수 관측 범위를 정의한다. |
| check/problems#Q9 | architecture가 대기·retry·보고 본문 cap을 선택했으나 requirements·모델에는 정할 것으로 남아 있다. | 추천대로 | 기존 architecture 추천 기본값을 요구·모델에 올리고 유한 수집·retry 약속에 연결한다. |
| problems/closing#Q1 | 부분 완화와 잔여 문제를 별도 닫힘 사유로 추가할까. | 추천대로 | 문제는 열린 채 잔여 범위·후속 ticket을 설명 |
| problems/closing#Q2 | 조용한 문제를 실행 기회·무보고 기간으로 자동 닫을까. | 추천대로 | 현 domain model의 자동 닫힘 없음 |
| problems/feedback#Q1 | 자동 준비한 screenshot과 화면 상태의 기본 포함 범위를 유지할까. | 추천대로 | 현재 모델의 후자 |
| problems/feedback#Q2 | feedback 원문·metadata·미완료 수 quota를 얼마로 제한할까. | 추천대로 | 별도 quota가 정해지기 전 보고율 및 자료 한도 적용 |
| problems/feedback#Q3 | 최근 read command 8개·각 20행/16KiB 및 invocation 10개·오류 20개를 화면 상태에 자동 붙일까. | 추천대로 | 업무 원값 자동 수집을 금지한 현재 모델 |
| problems/feedback#Q4 | 자동 캡처한 screenshot을 사람 선택 없이 첨부하던 규칙을 유지할까. | 추천대로 | 현재 problems/feedback 모델의 사람 선택 |
| problems/grouping#Q1 | 사람의 문제 병합·분리 기능을 추가할까. | 추천대로 | 첫 판은 고정 grouping만 |
| problems/grouping#Q2 | 앱 사이 공통 원인 관계를 사람에게 연결하게 할까. | 추천대로 | 첫 판은 앱별 문제만 |
| problems/grouping#Q3 | feedback을 기존 문제로 묶는 방식은 사람의 명시적 선택으로 유지할까. | 추천대로 | 사람 선택 |
| problems/problem-codes#Q1 | 사람이 조정할 문제에 별도 앱 command·화면 조치 링크를 제공할까. | 추천대로 | 첫 판은 고정 문구만 |
| problems/problem-codes#Q2 | health check와 사용자 label·문제 연결 검사를 별도 기능으로 유지할까. | 추천대로 | 첫 판은 지원하지 않고 선언 보고를 사용 |
| problems/problem-codes#Q3 | 옛 runtime 예약 code 전체와 별도 오탐 code를 필수로 유지할까. | 추천대로 | 현재 problems/problem-codes 모델의 필수 3종 |
| problems/repairs#Q1 | 앱이 남기던 변경 메모를 코드 수리 기록으로 계속 받을까. | 추천대로 | 현재 problems/repairs 모델의 coding agent 전용 |
| problems/reporting#Q1 | view의 같은 지문 60초 1회 제한을 서로 다른 발생에도 적용할까. | 추천대로 | 현재 보고 모델의 발생 보존 규칙 |
| problems/reporting#Q2 | crash·메모리·command 실패·permission 거절·view load 실패를 별도 예약 problem code로 즉시 추가할까. | 추천대로 | 첫 판은 필수 3종만 유지 |
| problems/reporting#Q3 | health check·health 탭과 진단 전용 신호를 유지할까. | 추천대로 | 첫 판은 지원하지 않음 |
| problems/reporting#Q4 | 보고 메모리 대기 크기·총 bytes·재전송 횟수·간격을 얼마로 둘까. | 추천대로 | 운영 command 재실행 없이 유한 메모리 대기 |
| problems/snapshots#Q1 | snapshot 자료의 사람 전용 명시 삭제와 재전송·재연결 복원 방지를 첫 판에 추가할까. | 추천대로 | 첫 판은 자동·명시 삭제 없이 보존; 보안 삭제 예외는 별도 결정 |
| problems/snapshots#Q2 | 요청할 때만 앱에서 안전한 추가 표본을 받는 기능을 지원할까. | 추천대로 | 첫 판은 현재 snapshot만 |
| problems/snapshots#Q3 | 큰 관측 자료의 보존 기간과 앱별·전체 bytes 한도를 어떻게 정할까. | 다르게 정함 | 보존: 큰 자료(model 호출 본문, snapshot 첨부, trace 본문, 운영 log)는 용량 상한을 넘으면 오래된 것부터 정리하고, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함 20… |
| problems/snapshots#Q4 | 로그 총 bytes·오류 frame 수·전체 수집 timeout·동시 수의 기본값을 얼마로 둘까. | 추천대로 | 실측 후 결정하고 최근30줄만 확정 |
| problems/snapshots#Q5 | 옛 첨부 90일 자동 삭제를 불변 snapshot 참조 유지보다 우선할까. | 다르게 정함 | 보존: 큰 자료(model 호출 본문, snapshot 첨부, trace 본문, 운영 log)는 용량 상한을 넘으면 오래된 것부터 정리하고, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함 20… |
| problems/snapshots#Q6 | 첫3개·최근50개 발생 보존 및 error300자·frame10개·로그 첫10+최근30·줄300자 기본값을 그대로 가져올까. | 추천대로 | 현재 model의 보고 불변성과 로그30줄 우선 |
| problems/tests#Q1 | 앱 runtime별 테스트 진입점과 판정 protocol·format을 무엇으로 지원할까. | 추천대로 | Deno 우선; 종료값만으로 reproduction 판정하지 않음 |
| problems/tests#Q2 | health check fixture 통과를 별도 필수 검사로 유지할까. | 추천대로 | 첫 판은 별도 health check 없음 |
| problems/tests#Q3 | 테스트 timeout 기본·상한과 출력·메모리 한도·작업 폴더 보관 기간을 얼마로 둘까. | 추천대로 | 실측 후 runtime별 유한 한도 |
| problems/tests#Q4 | 옛 Deno test의 무제한 allow-read·allow-write·allow-env·allow-net을 유지할까. | 추천대로 | 운영 자원 접근 금지 우선 |

### lophn-agent (212)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| architecture/lophn-agent#Q1 | 주기 요구는 기존 앱 runtime scheduler 재사용인데 직전 architecture는 agent 자체 시계다. | 추천대로 | 공용 scheduler 계산 모듈을 앱 supervisor와 agent runtime이 재사용하고 agent 회차 command는 agent owner가 유지한다. |
| architecture/lophn-agent#Q10 | 등록 MCP stdio 실행 파일과 skill 읽기의 프로세스 권한 경계는 domain model에서 미정이다. | 추천대로 | 등록 절대 executable·skill root만 Deno 권한에 허용하고 필요한 권한 변경은 감독자가 옛 runtime 종료 뒤 재기동한다. stdio 자식의 OS sandbox는 보장하지 않는… |
| architecture/lophn-agent#Q11 | 외부 MCP의 실제 reversibility·scope·idempotency·결과 조회를 확인하는 소유 contract는 미정이다. | 다르게 정함 | 되돌림을 모르는 외부 MCP tool은 external로 보고 묻는다. 사람이 preset에서 그 tool을 안전하다고 표시하면 묻지 않는다 |
| architecture/lophn-agent#Q12 | OTLP GenAI semantic convention의 정확한 판과 mapping이 미정이다. | 다르게 정함 | OTLP network export는 첫 판에서 뺀다. 로컬 파일 export만 둔다(MVP) |
| architecture/lophn-agent#Q2 | MCP 선택 요구는 서버·개별 도구 조합인데 RoleExtensionSelection은 서버 이름만 저장한다. | 추천대로 | platform settings 값에 정확한 서버·원래 tool 쌍 선택을 추가하고 서버 배열은 연결 후보로만 사용한다. 새 tool은 자동 선택하지 않는다. |
| architecture/lophn-agent#Q3 | 정함: 공통 역할 값은 확장 선택 고정 []인데 현재 요구와 사용자 지시는 skill·외부 MCP 지원을 요구한다. | 이미 정함 | 정함: 공통 역할 값은 확장 선택 고정 []인데 현재 요구와 사용자 지시는 skill·외부 MCP 지원을 요구한다. |
| architecture/lophn-agent#Q4 | Run 시작 순서는 domain model에서 접수 seq만인데 요구는 세 우선순위·8회 양보다. | 추천대로 | assignment 안 FIFO를 지키며 시작 가능한 각 assignment의 맨 앞 run들 사이에서 세 우선순위와 8회 양보를 적용한다. |
| architecture/lophn-agent#Q5 | tool domain model은 순차 처리인데 요구는 all-read 묶음 병렬을 허용한다. | 추천대로 | 처음에는 항상 응답 순서대로 순차 처리한다. 병렬은 필수 아닌 허용이며 후속 최적화로만 둔다. |
| architecture/lophn-agent#Q6 | ToolDecision 값이 tools와 tool-judgment domain model에서 다른 모양으로 정의되어 있다. | 추천대로 | tool-judgment의 현재 scope·판·정확한 입력·효과 근거를 공통 판정 결과로 쓰고 ToolCall에는 그 판정 근거를 보존한다. |
| architecture/lophn-agent#Q7 | 정함: prompt 요구의 작업 재료 순서와 domain model의 다섯 층 순서가 다르다. | 이미 정함 | 정함: prompt 요구의 작업 재료 순서와 domain model의 다섯 층 순서가 다르다. |
| architecture/lophn-agent#Q8 | 명시 provider 연결 test의 실제 사용량을 기록해야 하지만 ModelCall purpose와 독립 call 소유 조건에 test가 없다. | 추천대로 | ModelCall purpose에 connection_test를 추가하고 run/session null인 명시 user test를 ProviderCheck로 연결한다. 가짜 run·세션을 만들지 않… |
| architecture/lophn-agent#Q9 | OAuth 지원 대상의 lophn client identity·공식 허용·실제 text/tool 성공이 확인되지 않았다. | 추천대로 | 세 OAuth 구현 경로는 준비하되 검증된 client/endpoints/scopes와 실제 text/tool 테스트 근거가 없는 경로는 비활성화한다. |
| check/lophn-agent#Q1 | 전체 범위 lophn·CE 회수 뒤 재생성 경로가 없어 기본 담당이 사라진다. | 다르게 정함 | lophn과 Context Engineer는 늘 하나다. 회수 대신 멈춤만 둔다(결정 11) |
| check/lophn-agent#Q10 | 공통 Operator 표는 confirm read를 ask로 허용하지만 Operator R5는 확인 필요 명령을 거절한다. | 추천대로 | 더 구체적인 Operator 요구에 맞춰 confirm=false read만 제공한다. |
| check/lophn-agent#Q11 | reasoning domain이 한국어 화면 문자열을 직접 정한다. | 추천대로 | enum과 shell/wording 화면 문구를 분리한다. |
| check/lophn-agent#Q12 | catalog 가격 통화와 갱신 검증이 USD·단위·경계 검증 요구보다 느슨하다. | 추천대로 | 공개 catalog 가격만 쓴다. 계약 가격 보완은 두지 않는다(MVP) |
| check/lophn-agent#Q13 | eval domain의 1초~1시간 범위는 요구에 없고 집계 문장은 planned까지 결과 합계에 넣는다. | 추천대로 | 초기 600000ms와 양수만 유지하고 planned와 다섯 결과 수를 분리한다. |
| check/lophn-agent#Q14 | Run domain의 전역 접수 seq 시작만으로는 세 우선순위·8회 양보 요구를 표현하지 못한다. | 추천대로 | assignment별 맨 앞 시작 가능 후보 사이에 우선순위·양보를 적용한다. |
| check/lophn-agent#Q15 | 명시 연결 test 사용량 요구가 ModelCall 세 purpose·slot 필수·run 검사와 충돌한다. | 대체됨 | slot 대신 preset model(결정 10) |
| check/lophn-agent#Q16 | AE는 등록 앱마다 거두지 않은 담당 하나가 필요하지만 회수 후 새 담당을 만드는 계약은 AppCreated 재전송밖에 없다. | 추천대로 | 자동 재개 금지를 지키는 명시 재배정 계약 또는 AE 회수 금지 중 하나를 owner가 확정해야 한다. |
| check/lophn-agent#Q17 | Operator의 외부 MCP·skill 추가 선택은 별도 열린 질문이고 승인된 tool 상한과 연결할 계약이 없다. | 대체됨 | preset으로 모든 역할에 MCP·skill을 고른다(결정 10) |
| check/lophn-agent#Q18 | paused 대화 보존 및 저장 요청 실행 contract 변경을 screens·flows·shell에 연결해야 한다. | 추천대로 | 적용대로(flow 연결은 일관성 검사에서) |
| check/lophn-agent#Q2 | paused 대화 허용 추천과 paused 새 실행 접수 금지가 충돌한다. | 추천대로 | 적용대로 |
| check/lophn-agent#Q3 | ToolCall·ToolDefinition의 legacy confirm effect가 독립 confirm boolean 및 세 effect 계약과 다르다. | 추천대로 | read/write/external과 별도 confirm만 사용한다. |
| check/lophn-agent#Q4 | 두 concern이 ToolDecision을 verdict/decision 및 서로 다른 approval 조건으로 중복 정의한다. | 추천대로 | tool-judgment 정본 전체를 ToolCall에 저장한다. |
| check/lophn-agent#Q5 | 정함: 공통 역할의 확장 선택 고정 []가 requirements의 기본 0개 및 명시 선택 지원과 다르다. | 이미 정함 | 정함: 공통 역할의 확장 선택 고정 []가 requirements의 기본 0개 및 명시 선택 지원과 다르다. |
| check/lophn-agent#Q6 | RoleExtensionSelection에 서버만 있어 선택 서버의 미래 tool까지 노출될 수 있다. | 추천대로 | 서버 배열은 연결 후보로만 쓰고 mcp_tools의 서버·원래 tool 쌍 교집합만 노출한다. |
| check/lophn-agent#Q7 | McpConnection에 assignment가 없어 요구의 assignment·server별 비공유 수명을 표현하지 못한다. | 추천대로 | assignment를 connection identity에 포함한다. |
| check/lophn-agent#Q8 | MCP 행동 hints 변경이 분류 hash와 무효화 조건에서 빠졌다. | 추천대로 | 이름·설명·schema·hints로 정의 판을 검사한다. |
| check/lophn-agent#Q9 | 정함: Operator domain의 secret 사용 read 제외가 앱 grant를 허락으로 쓰는 최근 결정과 다르다. | 이미 정함 | 정함: Operator domain의 secret 사용 read 제외가 앱 grant를 허락으로 쓰는 최근 결정과 다르다. |
| lophn-agent/assignments#Q1 | 반복 실패의 공통 연속 3회를 역할·실패 종류별 기준으로 바꿀까. | 추천대로 | 실제 기록이 쌓일 때까지 공통 3회 유지 |
| lophn-agent/assignments#Q2 | 보관이 아닌 영구 접근 회수·삭제·일시 unavailable에서 자동 pause와 재개 조건을 어떻게 구분할까. | 추천대로 | 현재 보관만 pause하고 나머지는 호출 차단, 대상 concern과 분류를 맞춘다 |
| lophn-agent/conversation#Q1 | 반복 실패로 멈춘 assignment에서 진단 전용 제한 모델 세션을 예외로 허용할까. | 추천대로 | 모델 호출 차단 유지, 비모델 기록으로 안내 |
| lophn-agent/evaluation#Q1 | eval 제한 시간을 실제 model 600초·모델 없는 테스트 120초로 시작할까? | 추천대로 | 실제 model 600초로 시작하며 모델 없는 120초는 각 concern의 테스트가 정한다. |
| lophn-agent/evaluation#Q2 | 내용 판정의 24/30 보정 기준을 장기 유지할까? | 추천대로 | 초기는 24/30을 유지하고 사람 표본의 충족·불충족·근거 부족을 균형 있게 구성한다. |
| lophn-agent/evaluation#Q3 | 다섯 제품 신호를 eval에 어디까지 포함할까? | 추천대로 | 앱 제작 비용·문제 탐지 지연·수리 중 사람 개입·정보 접근 token·검증된 재료 재사용을 각각 비교하고 종합 점수는 만들지 않는다. |
| lophn-agent/extensions#Q1 | 외부 MCP 자원을 서버 연결 외에 안정된 자원 식별로 구별할까? | 추천대로 | 서버와 도구는 필수이고 자원 식별은 제공될 때 근거로만 쓴다. |
| lophn-agent/extensions#Q2 | 이어 읽기가 없는 MCP의 큰 결과를 보관한 원문에서 다시 읽게 할까? | 추천대로 | lophn-agent/harness/tools의 생략·출처 표시를 유지하고 보호된 원문 재읽기는 실제 사례로 결정한다. |
| lophn-agent/extensions#Q3 | MCP OAuth에 device code를 추가할까? | 추천대로 | 초기에는 브라우저와 loopback만 지원한다. |
| lophn-agent/extensions#Q4 | 설명·입력·MCP 힌트가 그대로인 서버의 숨은 행동 변경을 어떻게 다룰까? | 추천대로 | 사람의 분류 검토를 요구하고 자동 탐지를 약속하지 않는다. |
| lophn-agent/extensions#Q5 | skill 본문과 MCP 도구 목록의 전체 크기 상한을 얼마로 둘까? | 추천대로 | lophn-agent/harness/prompt-assemble의 수용 예산으로 전체 성공 여부를 판정하고 조용한 부분 성공은 금지한다. |
| lophn-agent/extensions#Q6 | 역할별 기본 skill 및 Operator의 외부 MCP·skill 선택을 언제 늘릴까? | 대체됨 | preset으로 모든 역할에 MCP·skill을 고른다(결정 10) |
| lophn-agent/handoff#Q1 | 같은 원래 사람 요청의 handoff 순환·총 사슬 길이를 어떻게 제한할까. | 추천대로 | 첫 판은 각 run 한도만 적용하고 실제 순환 기록이 생기면 재방문 금지 검토 |
| lophn-agent/harness/model#Q1 | 공개 가격 외 계약 가격을 사람이 별도 출처로 보완할 것인가? | 추천대로 | 공개 catalog 가격만 쓴다. 계약 가격 보완은 두지 않는다(MVP) |
| lophn-agent/harness/model#Q2 | catalog 밖 model의 128,000·8,192 token·tool 지원 가정을 허용할 것인가? | 추천대로 | 확인 정보 또는 사람 명시 정보만 |
| lophn-agent/harness/model#Q3 | 첫 설치의 두 model slot을 어떤 목록·순서로 추천할 것인가? | 대체됨 | 기본 preset의 model로 정한다(결정 10) |
| lophn-agent/harness/model#Q4 | 2,048·8,192·16,384·32,768 추론 예산이 품질 차이를 만드는가? | 추천대로 | 초기 값 유지 후 lophn-agent/evaluation으로 비교 |
| lophn-agent/harness/model#Q5 | 강도·예산·토글을 함께 선언한 model의 추론 선택 우선순위는 무엇인가? | 추천대로 | provider별 확인된 방식 하나만 제공 |
| lophn-agent/harness/model#Q6 | 첫 판 model input에 이미지를 포함할 것인가? | 추천대로 | 첫 판 텍스트만 |
| lophn-agent/harness/model#Q7 | 정확한 token 계산을 local tokenizer·provider count API 중 무엇으로 제공할 것인가? | 추천대로 | 확인 가능한 계산 우선, 없으면 UTF-8 상한 |
| lophn-agent/harness/model#Q8 | Claude 계열을 기본 추천으로 유지할 것인가? | 추천대로 | provider에 독립적인 eval 기반 추천, 자동 배정 없음 |
| lophn-agent/harness/model#Q9 | 한계를 모르는 model을 사용할 조건은 무엇인가? | 추천대로 | 확인 정보·사람 입력 한계 필수 |
| lophn-agent/harness/prompt-assemble#Q1 | lophn 시작 자료에 전체 outline 1,500·context와 place 3,000·문서 outline 2,000 token 별도 상한과 run 끝까지 i… | 추천대로 | 공통 model 총 예산만, 자료 version은 읽은 근거로 고정 |
| lophn-agent/harness/prompt-assemble#Q2 | App Engineer의 별도 시작 token 예산을 둘 것인가? | 추천대로 | 공통 model 총 예산 |
| lophn-agent/harness/prompt-assemble#Q3 | 같은 구간의 새 압축은 어떤 명시 변경 뒤 허용할 것인가? | 추천대로 | 같은 구간 자동 반복 금지, 사람 요청·새 run의 실질 변경에서만 새 시도 |
| lophn-agent/harness/prompt-assemble#Q4 | 70%·50%·25%·2,000~15,000 token 초기 압축값을 유지할 것인가? | 추천대로 | 초기값 유지 후 lophn-agent/evaluation으로 검증 |
| lophn-agent/harness/prompt-assemble#Q5 | 정함: 옛 작업 층 순서와 새 domain model의 다섯 층 순서가 일치하지 않는다. | 이미 정함 | 정함: 옛 작업 층 순서와 새 domain model의 다섯 층 순서가 일치하지 않는다. |
| lophn-agent/harness/prompt-assemble#Q6 | 매 turn 화면 요약 크기와 층 위치를 어떻게 둘까 | 추천대로 | 고정 prefix 뒤·현재 입력 앞; 총8KiB·20탭·앱요약2KiB; 실제 수집 근거 저장 |
| lophn-agent/harness/provider#Q1 | Claude OAuth가 lophn 식별과 프로필·추론 권한으로 실제 tool call을 받는가? | 추천대로 | 검증 전 비활성, 미허용이면 API key 안내 |
| lophn-agent/harness/provider#Q2 | ChatGPT·xAI 제3자 OAuth client 발급과 공식 허용 범위는 무엇인가? | 추천대로 | 전용 발급 우선, 허용 범위 확인 전 비활성 |
| lophn-agent/harness/provider#Q3 | SuperGrok 표준·Heavy 중 어느 요금제가 OAuth 추론을 받는가? | 추천대로 | 표준·Heavy 각각 검증하고 X Premium+와 구별 |
| lophn-agent/harness/provider#Q4 | Claude·ChatGPT 사용량 조회가 lophn 식별로 허용되며 5시간·7일 창과 정확한 리셋을 주는가? | 추천대로 | header 우선, 허용된 경우만 설정 열 때 조회, 주기 계정 폴링 없음 |
| lophn-agent/harness/provider#Q5 | 온보딩 건너뛰기와 인증 전 slot 진행 금지를 어떻게 함께 지키는가? | 대체됨 | preset이 provider·model을 고른다(결정 10) |
| lophn-agent/harness/provider#Q6 | 첫 provider 인증 범위와 안전한 secret 보관 불가 환경은 어떻게 처리하는가? | 추천대로 | 지원 목록 유지, 보관 불가 처리는 platform/secrets 참조 |
| lophn-agent/harness/provider#Q7 | PV-16·PV-18의 버림 판정과 credential 하나 제한이 이번 추가 지시·현재 domain model의 여러 credential 요구와 충돌한다. | 추천대로 | 이번 추가 지시대로 여러 credential 유지 |
| lophn-agent/harness/provider#Q8 | PV-25와 초안 domain model의 추론 서명 전면 제외가 충돌했고 현재 provider domain model은 필수 opaque 상태의 비영속 재사용으… | 추천대로 | 본문 제외·opaque 상태만 비영속 재사용 |
| lophn-agent/harness/provider#Q9 | 연결 테스트의 대기 상한과 사용량 기록 용도가 아직 정해지지 않았다. | 추천대로 | 단발 테스트 30초 상한과 실제 유료 시도 usage 기록 |
| lophn-agent/harness/run-loop#Q1 | provider 끄기·MCP 연결 제거 때 이미 전송한 요청은 어떻게 처리하는가? | 추천대로 | 새 진입 금지·가능하면 취소, 이미 시작한 효과는 불명확 또는 결과 보완 |
| lophn-agent/harness/run-loop#Q2 | 공통 30회·5분·사람 기다림 제외 30분이 실제 일에 충분한가? | 추천대로 | 현재 공통값 유지 후 lophn-agent/evaluation으로 검증 |
| lophn-agent/harness/run-loop#Q3 | 세션 입력 수·전체 접수 run 수에 어떤 유한 상한을 둘 것인가? | 추천대로 | 측정 후 유한 상한, 초과는 저장 전 명시 거절 |
| lophn-agent/harness/run-loop#Q4 | agent 프로세스를 상시 대기시키거나 요청 때 띄울 것인가? | 추천대로 | 동작 계약을 유지하는 요청 시 시작 |
| lophn-agent/harness/run-loop#Q5 | run 시간 한도에 사람 답 기다림을 포함할 것인가? | 추천대로 | 진행 없는 시간·전체 시간 모두 제외 |
| lophn-agent/harness/run-loop#Q6 | run 한도·반복 tool 실패 기준을 공통값 또는 역할별로 둘 것인가? | 추천대로 | 공통 수치 |
| lophn-agent/harness/safety#Q1 | 두 요청을 번갈아 성공시키는 무진행 반복도 감지할 것인가? | 추천대로 | 첫 판 동일 요청 최종 실패만, eval 후 결정적 감지 검토 |
| lophn-agent/harness/safety#Q2 | model API로 나가는 문서·앱 자료 범위를 사람이 어떻게 통제하는가? | 추천대로 | 현재 scope와 최소 자료를 지키고 provider별 추가 통제는 별도 결정 |
| lophn-agent/harness/tools#Q1 | 이미지·PDF·표의 원본과 부분 preview를 어떤 크기로 반환할 것인가? | 추천대로 | 첫 판 원본 binary 제외, 추출 텍스트·주소·format·outline만 |
| lophn-agent/harness/tools#Q2 | 기존 R8의 앱 command 금지·R5의 순서·R15의 confirm read 후행 기록이 새 앱 tool intent와 충돌한다 | 추천대로 | 현재 허락·역할 범위와 effect 판정으로 제공 |
| lophn-agent/harness/usage#Q1 | 비용 표시에 선택 환산을 제공할 것인가? | 추천대로 | 비용은 USD로만 보인다. 환산은 두지 않는다(MVP) |
| lophn-agent/harness/usage#Q2 | credential 이동 요구를 되살림에 따라 사용량 재료의 이동 기록 삭제와 충돌한다. | 추천대로 | 실제 선택 credential·이동 관계·과금 경로 기록 |
| lophn-agent/harness/usage#Q3 | 연결 test 실제 시도는 현 domain model의 세 용도 밖이지만 실제 사용량을 빠짐없이 기록해야 한다. | 추천대로 | 실제 시도는 연결 test 용도로 기록 |
| lophn-agent/harness/waiting-and-recovery#Q1 | 재시작 후 대기 approval을 같은 요청으로 이을 것인가? | 추천대로 | 현재 요청·미시작 증거를 조회해 유효한 같은 요청 유지 |
| lophn-agent/harness/waiting-and-recovery#Q2 | 조회 수단 없는 MCP external 효과의 충돌 보류는 언제 풀 것인가? | 다르게 정함 | 되돌림을 모르는 외부 MCP tool은 external로 보고 묻는다. 사람이 preset에서 그 tool을 안전하다고 표시하면 묻지 않는다 |
| lophn-agent/harness/waiting-and-recovery#Q3 | 완성 압축 summary와 보호 원문 범위를 복구할 근거는 무엇인가? | 추천대로 | 완성 호출 출력과 원문 구간으로 재조립 |
| lophn-agent/harness/waiting-and-recovery#Q4 | H8 Operator가 질문을 기다리는 동안 주기를 계속 건너뛰는 정책을 유지할 것인가? | 추천대로 | lophn-agent/harness/run-loop과 lophn-agent/scheduling대로 계속 건너뛰기 |
| lophn-agent/observability#Q1 | 보존 기본을 자동 삭제 없음으로 둘까, 상세 180일·export 내용 14일·세션 종료 후 90일·UTC 일별 비용 365일로 둘까? | 다르게 정함 | 보존: 큰 자료(model 호출 본문, snapshot 첨부, trace 본문, 운영 log)는 용량 상한을 넘으면 오래된 것부터 정리하고, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함 20… |
| lophn-agent/observability#Q2 | 유한 기간 합의 뒤 단축 소급·삭제 비복구·정리 주기를 어떻게 적용할까? | 다르게 정함 | 보존: 큰 자료는 용량 상한을 넘으면 오래된 것부터 정리, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함) |
| lophn-agent/observability#Q3 | 첫 OTLP GenAI Semantic Conventions version을 무엇으로 고정할까? | 다르게 정함 | OTLP network export는 첫 판에서 뺀다. 로컬 파일 export만 둔다(MVP) |
| lophn-agent/questions#Q1 | 선택지 개수의 이전 2~6개 제한을 유지할까, 현재 상한 없음으로 갈까. | 추천대로 | 지금은 현재 모델을 적용하고 사용 사례로 상한 재검토 |
| lophn-agent/questions#Q2 | 답 기다림 질문의 이전 고정 900초 기한과 현재 기본 무기한 중 무엇을 쓸까. | 추천대로 | 지금은 현재 모델을 적용 |
| lophn-agent/questions#Q3 | 답 없는 질문에 기본 유한 기한을 도입할까. | 추천대로 | 현재 기본 무기한 유지, 명시 기한 허용 |
| lophn-agent/revert#Q1 | 복원 불가 변경이 섞인 run에 사람이 남는 영향 확인 후 부분 revert를 제공할까. | 추천대로 | 현재 부분 revert 유지 |
| lophn-agent/revert#Q2 | 기존 R6·domain이 앱 업무 DB 변경을 revert 범위 밖으로 두었다 | 추천대로 | 지원 write의 receipt로 앱 revert command direct call; 파일 직접 복원은 제외 |
| lophn-agent/revert#Q3 | 기존 R4·domain은 모든 복원을 원자 transaction과 blocked로만 설명한다 | 추천대로 | 사전 충돌 전체 차단; 앱 시작 후 실패·불명확은 partial/uncertain·durable 단계 보존 |
| lophn-agent/revert#Q4 | 사람의 앱 revert를 어떤 actor와 호출 범위로 보낼까 | 추천대로 | user actor와 고정 receipt·command·CAS에 묶인 machine 적용; agent.commands 회수로 사람의 복원 능력을 대신 판정하지 않음 |
| lophn-agent/role-definition#Q1 | 정함: 내장 세 역할을 사람이 편집하거나 복사할 수 있게 할까. | 이미 정함 | 정함: 내장 세 역할을 사람이 편집하거나 복사할 수 있게 할까. |
| lophn-agent/roles/app-engineer#Q1 | H3: App Engineer 주기 검토를 추가할까. | 추천대로 | lophn-agent/roles/app-engineer 유지 |
| lophn-agent/roles/app-engineer#Q2 | H7: App Engineer 티켓 생성에 매번 승인을 묻지 않는 lophn-agent/harness/tool-judgment를 유지할까. | 추천대로 | App Engineer의 ticket 생성은 묻지 않는다(H7) |
| lophn-agent/roles/app-engineer#Q3 | 이전 AE-17의 티켓 생성 ask와 lophn-agent/harness/tool-judgment의 매번 묻지 않는 생성을 어떻게 맞출까. | 추천대로 | App Engineer의 ticket 생성은 묻지 않는다(H7) |
| lophn-agent/roles/app-engineer#Q4 | App Engineer에게 담당 앱의 되돌리기 지원 write도 줄까 | 추천대로 | 담당 앱 read·지원 write; confirm approval; external·미지원 write 제외 |
| lophn-agent/roles/app-engineer#Q5 | 기존 R3·R5와 domain이 담당 앱 command 실행을 금지한다 | 추천대로 | 담당 앱 허락된 read·지원 write 허용; source·blueprint 직접 변경 금지 유지 |
| lophn-agent/roles/common#Q1 | 기존 공통 R5의 외부 전송 금지와 lophn 앱 external command 지원을 어떻게 맞출까 | 다르게 정함 | agent는 앱 external command를 쓸 수 있고, external은 묻는다(승인 원칙, apps I7) |
| lophn-agent/roles/lophn#Q1 | 문서 추천의 30일·4회·2개 중 두 조건을 계속 추천 근거로 쓸까. | 추천대로 | 사람 요청에서 설명 가능한 보조 근거로 유지 |
| lophn-agent/roles/lophn#Q2 | 이전 LA-20의 문서 쓰기 허용 본문과 매번 확인이라는 확인 문장 중 무엇을 적용할까. | 추천대로 | lophn-agent/roles/operator과 현재 역할 정책에 맞춰 요청 범위 문서 저장 허용 |
| lophn-agent/roles/lophn#Q3 | 기존 R4의 앱 실행 없음과 R16의 의도·취향 질문만이 새 기능과 충돌한다 | 추천대로 | 허락된 앱 command 및 설정 선택 질문을 제공 |
| lophn-agent/roles/operator#Q1 | 정함: 구체적 Operator에 외부 MCP tool 선택을 허용할까. | 이미 정함 | 정함: 구체적 Operator에 외부 MCP tool 선택을 허용할까. |
| lophn-agent/roles/operator#Q2 | 정함: 구체적 Operator에 등록한 반복 절차 skill 선택을 허용할까. | 이미 정함 | 정함: 구체적 Operator에 등록한 반복 절차 skill 선택을 허용할까. |
| lophn-agent/scheduling#Q1 | Operator에 cron 5칸·IANA 시간대의 현지 달력 주기를 추가할까. | 추천대로 | 첫 판은 현재 고정 간격 유지, 생활 시간 사례가 필요하면 현지 달력 추가 |
| lophn-agent/scheduling#Q2 | H8: Operator가 질문 답을 기다리는 동안 모든 회차를 건너뛰는 정책을 유지할까. | 추천대로 | lophn-agent/harness/run-loop의 skip 유지 |
| lophn-agent/visuals#Q1 | 시각 블록 첫 판 종류와 크기 상한은 무엇인가 | 추천대로 | 선언형 8블록·256KiB·표1000행20열·차트8series1000점·도표100node200edge |
| lophn-agent/visuals#Q2 | 시각 블록을 어떤 문서 format으로 남길까 | 추천대로 | 고정 HTML 그림·데이터·설명·출처·명세; 카드 snapshot 없으면 부재와 참조 |
| redesign/lophn-agent#Q1 | judgment/organizing 공통 설정을 실행 slot으로 유지할까 | 추천대로 | 생성 기본값만 유지하고 organizing 미선택은 같은 preset model |
| redesign/lophn-agent#Q10 | 기존 flows가 role-definition·context Operator·별도 role extension 선택을 쓴다 | 추천대로 | Preset과 project/app scope 및 LOPHN.md·작업 자리로 전파 |
| redesign/lophn-agent#Q100 | **H8.** Operator가 질문 답을 기다리는 동안 주기 회차를 계속 건너뛰는 정책 유지 여부. 현재는 → lophn-agent/scheduling의 건너뜀… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q101 | catalog 밖 model은 확인된 정보 또는 user 명시 한계만으로 허용한다. user 보완값의 확인 UI·검증 책임 경계. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q102 | reasoning 인자 및 불투명 필수 상태를 요구하는 provider mode의 실제 지원 범위와 메모리 유실 뒤 연속 호출 복구 가능성은 → lophn-age… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q103 | 독립 연결 test도 connection_test ModelCall로 실제 시도를 기록한다. 결과 요약·call 연결은 → lophn-agent/harness/p… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q105 | 일반 context 자료 읽기와 언제나 읽을 사람 지침의 범위를 어떻게 구분할까 | 추천대로 | 작업 자리·첨부 지침만 별도 읽고 연결 주소로 scope 확대 금지; 첨부 부재는 call 차단 |
| redesign/lophn-agent#Q106 | global 실행 slot 필드를 남기면 Preset 선택 정본과 혼동된다 | 추천대로 | ModelCall.model_use로 judgment/organizing 용도를 기록하고 실제 선택은 preset/CallModel 참조 |
| redesign/lophn-agent#Q11 | 지침 파일 tracking·문서 보호·Instructions 편집기 경로의 owner contract가 필요하다 | 추천대로 | documents/file-tracking·versions의 파일 정본/판을 재사용하고 shell/editor가 편집; agent write 제외를 owner에서도 보장 |
| redesign/lophn-agent#Q13 | 최초 check-docs의 타 subtree intent 오류 9개 | 추천대로 | 새 lophn-agent I1~I8/harness I1~I3 또는 각 owner intent로 재연결 |
| redesign/lophn-agent#Q14 | lophn-agent/scheduling#Q1 Operator에 cron 5칸·IANA 시간대의 현지 달력 주기를 추가할까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q15 | lophn-agent/scheduling#Q2 H8: Operator가 질문 답을 기다리는 동안 모든 회차를 건너뛰는 정책을 유지할까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q16 | lophn-agent/conversation#Q1 반복 실패로 멈춘 assignment에서 진단 전용 제한 모델 세션을 예외로 허용할까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q17 | lophn-agent/questions#Q1 선택지 개수의 이전 2~6개 제한을 유지할까, 현재 상한 없음으로 갈까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q18 | lophn-agent/questions#Q2 답 기다림 질문의 이전 고정 900초 기한과 현재 기본 무기한 중 무엇을 쓸까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q19 | lophn-agent/questions#Q3 답 없는 질문에 기본 유한 기한을 도입할까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q2 | 고른 계정에서 자동 credential 이동을 어디까지 허용할까 | 추천대로 | Preset의 명시 순서 목록 안 같은 provider/model만; 하나면 이동 없음 |
| redesign/lophn-agent#Q20 | lophn-agent/revert#Q1 복원 불가 변경이 섞인 run에 사람이 남는 영향 확인 후 부분 revert를 제공할까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q21 | lophn-agent/handoff#Q1 같은 원래 사람 요청의 handoff 순환·총 사슬 길이를 어떻게 제한할까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q22 | lophn-agent/evaluation#Q1 eval 제한 시간을 실제 model 600초·모델 없는 테스트 120초로 시작할까? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q23 | lophn-agent/evaluation#Q2 내용 판정의 24/30 보정 기준을 장기 유지할까? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q24 | lophn-agent/evaluation#Q3 다섯 제품 신호를 eval에 어디까지 포함할까? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q25 | lophn-agent/assignments#Q1 반복 실패의 공통 연속 3회를 역할·실패 종류별 기준으로 바꿀까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q26 | lophn-agent/assignments#Q2 보관이 아닌 영구 접근 회수·삭제·일시 unavailable에서 자동 pause와 재개 조건을 어떻게 구분할까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q27 | lophn-agent/observability#Q1 보존 기본을 자동 삭제 없음으로 둘까, 상세 180일·export 내용 14일·세션 종료 후 90일·UTC 일… | 다르게 정함 | 보존: 큰 자료는 용량 상한을 넘으면 오래된 것부터 정리, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함) |
| redesign/lophn-agent#Q28 | lophn-agent/observability#Q2 유한 기간 합의 뒤 단축 소급·삭제 비복구·정리 주기를 어떻게 적용할까? | 다르게 정함 | 보존: 큰 자료는 용량 상한을 넘으면 오래된 것부터 정리, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함) |
| redesign/lophn-agent#Q29 | lophn-agent/observability#Q3 첫 OTLP GenAI Semantic Conventions version을 무엇으로 고정할까? | 다르게 정함 | OTLP network export는 첫 판에서 뺀다. 로컬 파일 export만 둔다(MVP) |
| redesign/lophn-agent#Q3 | LOPHN.md 입력 크기 상한을 얼마로 둘까 | 추천대로 | 파일 32768 UTF-8 bytes·전체 131072 bytes; 초과·오류는 call 차단 |
| redesign/lophn-agent#Q30 | lophn-agent/extensions#Q1 외부 MCP 자원을 서버 연결 외에 안정된 자원 식별로 구별할까? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q31 | lophn-agent/extensions#Q2 이어 읽기가 없는 MCP의 큰 결과를 보관한 원문에서 다시 읽게 할까? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q32 | lophn-agent/extensions#Q3 MCP OAuth에 device code를 추가할까? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q33 | lophn-agent/extensions#Q4 설명·입력·MCP 힌트가 그대로인 서버의 숨은 행동 변경을 어떻게 다룰까? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q34 | lophn-agent/extensions#Q5 skill 본문과 MCP 도구 목록의 전체 크기 상한을 얼마로 둘까? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q35 | lophn-agent/extensions#Q6 역할별 기본 skill 및 Operator의 외부 MCP·skill 선택을 언제 늘릴까? | 대체됨 | preset으로 모든 역할에 MCP·skill을 고른다(결정 10) |
| redesign/lophn-agent#Q36 | lophn-agent/harness/prompt-assemble#Q1 lophn 시작 자료에 전체 outline 1,500·context와 place 3,000·… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q37 | lophn-agent/harness/prompt-assemble#Q2 App Engineer의 별도 시작 token 예산을 둘 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q38 | lophn-agent/harness/prompt-assemble#Q3 같은 구간의 새 압축은 어떤 명시 변경 뒤 허용할 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q39 | lophn-agent/harness/prompt-assemble#Q4 70%·50%·25%·2,000~15,000 token 초기 압축값을 유지할 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q4 | 진행 Run 중 사람 지침과 작업 자리 변경을 언제 읽을까 | 추천대로 | Preset 구성은 Run 고정, 자리·지침은 매 call 확정 snapshot |
| redesign/lophn-agent#Q40 | 정함: lophn-agent/harness/prompt-assemble#Q5 옛 작업 층 순서와 새 domain model의 다섯 층 순서가 일치하지 않는다. | 이미 정함 | 정함: lophn-agent/harness/prompt-assemble#Q5 옛 작업 층 순서와 새 domain model의 다섯 층 순서가 일 |
| redesign/lophn-agent#Q41 | lophn-agent/harness/tools#Q1 이미지·PDF·표의 원본과 부분 preview를 어떤 크기로 반환할 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q43 | lophn-agent/harness/run-loop#Q1 provider 끄기·MCP 연결 제거 때 이미 전송한 요청은 어떻게 처리하는가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q44 | lophn-agent/harness/run-loop#Q2 공통 30회·5분·사람 기다림 제외 30분이 실제 일에 충분한가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q45 | lophn-agent/harness/run-loop#Q3 세션 입력 수·전체 접수 run 수에 어떤 유한 상한을 둘 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q46 | lophn-agent/harness/run-loop#Q4 agent 프로세스를 상시 대기시키거나 요청 때 띄울 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q47 | lophn-agent/harness/run-loop#Q5 run 시간 한도에 사람 답 기다림을 포함할 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q48 | lophn-agent/harness/run-loop#Q6 run 한도·반복 tool 실패 기준을 공통값 또는 역할별로 둘 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q49 | lophn-agent/harness/provider#Q1 Claude OAuth가 lophn 식별과 프로필·추론 권한으로 실제 tool call을 받는가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q5 | Preset 첨부 지침의 순서와 version을 어떻게 고를까 | 추천대로 | global→project→app→첨부 배열; 중복은 첫 document; 내용은 매 call 최신 확정 판 |
| redesign/lophn-agent#Q50 | lophn-agent/harness/provider#Q2 ChatGPT·xAI 제3자 OAuth client 발급과 공식 허용 범위는 무엇인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q51 | lophn-agent/harness/provider#Q3 SuperGrok 표준·Heavy 중 어느 요금제가 OAuth 추론을 받는가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q52 | lophn-agent/harness/provider#Q4 Claude·ChatGPT 사용량 조회가 lophn 식별로 허용되며 5시간·7일 창과 정확한 리셋을 주는… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q53 | lophn-agent/harness/provider#Q5 온보딩 건너뛰기와 인증 전 slot 진행 금지를 어떻게 함께 지키는가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q54 | lophn-agent/harness/provider#Q6 첫 provider 인증 범위와 안전한 secret 보관 불가 환경은 어떻게 처리하는가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q55 | lophn-agent/harness/provider#Q7 PV-16·PV-18의 버림 판정과 credential 하나 제한이 이번 추가 지시·현재 domain m… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q56 | lophn-agent/harness/provider#Q8 PV-25와 초안 domain model의 추론 서명 전면 제외가 충돌했고 현재 provider doma… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q57 | lophn-agent/harness/waiting-and-recovery#Q1 재시작 후 대기 approval을 같은 요청으로 이을 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q58 | lophn-agent/harness/waiting-and-recovery#Q2 조회 수단 없는 MCP external 효과의 충돌 보류는 언제 풀 것인가? | 다르게 정함 | 되돌림을 모르는 외부 MCP tool은 external로 보고 묻는다. 사람이 preset에서 그 tool을 안전하다고 표시하면 묻지 않는다 |
| redesign/lophn-agent#Q59 | lophn-agent/harness/waiting-and-recovery#Q3 완성 압축 summary와 보호 원문 범위를 복구할 근거는 무엇인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q6 | 제품 기본 preset 개인화와 새 판 적용을 어떻게 나눌까 | 추천대로 | 배포 원문은 유지; user preset 저장 뒤 Assignment에 명시 적용; Operator 전체 승인 |
| redesign/lophn-agent#Q60 | lophn-agent/harness/waiting-and-recovery#Q4 H8 Operator가 질문을 기다리는 동안 주기를 계속 건너뛰는 정책을 유지할 것… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q61 | lophn-agent/harness/safety#Q1 두 요청을 번갈아 성공시키는 무진행 반복도 감지할 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q62 | lophn-agent/harness/safety#Q2 model API로 나가는 문서·앱 자료 범위를 사람이 어떻게 통제하는가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q63 | lophn-agent/harness/model#Q1 공개 가격 외 계약 가격을 사람이 별도 출처로 보완할 것인가? | 추천대로 | 공개 catalog 가격만 쓴다. 계약 가격 보완은 두지 않는다(MVP) |
| redesign/lophn-agent#Q64 | lophn-agent/harness/model#Q2 catalog 밖 model의 128,000·8,192 token·tool 지원 가정을 허용할 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q65 | lophn-agent/harness/model#Q3 첫 설치의 두 model 선택을 어떤 목록·순서로 추천할 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q66 | lophn-agent/harness/model#Q4 2,048·8,192·16,384·32,768 추론 예산이 품질 차이를 만드는가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q67 | lophn-agent/harness/model#Q5 강도·예산·토글을 함께 선언한 model의 추론 선택 우선순위는 무엇인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q68 | lophn-agent/harness/model#Q6 첫 판 model input에 이미지를 포함할 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q69 | lophn-agent/harness/model#Q7 정확한 token 계산을 local tokenizer·provider count API 중 무엇으로 제공할 것… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q70 | lophn-agent/harness/model#Q8 Claude 계열을 기본 추천으로 유지할 것인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q71 | lophn-agent/harness/model#Q9 한계를 모르는 model을 사용할 조건은 무엇인가? | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q72 | lophn-agent/harness/usage#Q1 비용 표시에 선택 환산을 제공할 것인가? | 추천대로 | 비용은 USD로만 보인다. 환산은 두지 않는다(MVP) |
| redesign/lophn-agent#Q73 | lophn-agent/roles/app-engineer#Q1 H3: App Engineer 주기 검토를 추가할까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q74 | lophn-agent/roles/app-engineer#Q2 H7: App Engineer 티켓 생성에 매번 승인을 묻지 않는 lophn-agent/harness… | 추천대로 | App Engineer의 ticket 생성은 묻지 않는다(H7) |
| redesign/lophn-agent#Q75 | lophn-agent/roles/app-engineer#Q3 이전 AE-17의 티켓 생성 ask와 lophn-agent/harness/tool-judgment의 … | 추천대로 | App Engineer의 ticket 생성은 묻지 않는다(H7) |
| redesign/lophn-agent#Q76 | lophn-agent/roles/lophn#Q1 문서 추천의 30일·4회·2개 중 두 조건을 계속 추천 근거로 쓸까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q77 | lophn-agent/roles/lophn#Q2 이전 LA-20의 문서 쓰기 허용 본문과 매번 확인이라는 확인 문장 중 무엇을 적용할까. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q78 | 현지 달력 주기를 지원할지 정한다. 현재 first_at·every_ms만 사용한다. cron 5칸·IANA 시간대·DST 값은 추가하지 않는다. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q79 | **H8.** Operator 질문 대기 중 회차를 모두 skip하는 정책 유지 여부. 현재 accepted·running·waiting_user 모두 skip이… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q8 | evaluation 24개 요구를 I1~I8/I1~I3 제품 약속에 연결할 근거가 없다 | 추천대로 | 기존 평가 contract는 유지하되 허위 intent 링크 제거; owner가 개발 범위를 따로 정함 |
| redesign/lophn-agent#Q80 | H8: 답 없는 Operator 질문 동안 주기를 계속 건너뛸지. 현재는 건너뛴다. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q81 | 답 없는 질문의 기본 기한: 현재 null. 유한 기한을 도입하면 → lophn-agent/harness/waiting-and-recovery와 맞춘다. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q82 | OptionAction의 정규화·binding hash는 → platform/ledger 및 소유 command schema와 동일한 contract로 정한다. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q83 | 복원 불가 변경이 섞일 때 부분 revert를 제공할지. 현재 모델은 사람의 명시적 동의 뒤 복원 가능 변경 전체만 적용한다. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q84 | 원자적 검사·복원 대상 수·event 수 한도와 준비 결과 schema는 → platform/ledger 및 각 owner와 정한다. 한도를 넘는 전체 rever… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q85 | 원본 연결 문서의 복원 준비·파일 반영 순서와 실패 시 결과는 → documents/file-tracking, documents/versions. 이 문서는 디스… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q86 | HandoffContent 각 문자열·목록의 크기 상한. 현재 필수 구조만 정하며 transport·prompt 상한은 → lophn-agent/harness/t… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q87 | 개발용 eval 결과·격리 workspace 보존 기간 및 파일 schema version. 제품 trace 보존과 독립적으로 정한다. | 다르게 정함 | 보존: 큰 자료는 용량 상한을 넘으면 오래된 것부터 정리, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함) |
| redesign/lophn-agent#Q88 | 반복 실패 공통 3회를 역할별·실패 종류별 값으로 바꿀지는 실제 기록 뒤 정한다. 현재 공통 3회다. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q89 | archive가 아닌 일시적 대상 unavailable은 호출을 막지만 자동 pause 사유로 확정하지 않았다. 영구 접근 회수·삭제의 분류와 재개 조건은 대상 … | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q9 | domain-model README의 Role diagram과 Context Operator 범위는 entity-map 한 줄 편집 범위 밖이다 | 추천대로 | Role→Preset 및 scope App/Project/all diagram 전파 |
| redesign/lophn-agent#Q90 | 자동 삭제 없음과 유한 보존 중 선택. 후보는 발생 후 상세 180일·export 내용 14일·세션 종료 뒤 90일·UTC 일별 비용 365일이며 현재 활성 정책… | 다르게 정함 | 보존: 큰 자료는 용량 상한을 넘으면 오래된 것부터 정리, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함) |
| redesign/lophn-agent#Q91 | 유한 보존의 기간 단축 소급 적용·삭제 비복구 및 삭제된 blob 참조 표현을 → platform/blob-store와 맞춘다. | 다르게 정함 | 보존: 큰 자료는 용량 상한을 넘으면 오래된 것부터 정리, 변경 기록·결정·확정 결과는 영구 보존(사람이 정함) |
| redesign/lophn-agent#Q92 | OTLP GenAI Semantic Conventions의 정확한 지원 version. | 다르게 정함 | OTLP network export는 첫 판에서 뺀다. 로컬 파일 export만 둔다(MVP) |
| redesign/lophn-agent#Q93 | 외부 tool의 되돌림·결과 조회·idempotency 보장을 검증하는 contract 및 현재 네 역할에 허용할 서버·tool 목록. 설정만으로 기존 역할 범위… | 다르게 정함 | 되돌림을 모르는 외부 MCP tool은 external로 보고 묻는다. 사람이 preset에서 그 tool을 안전하다고 표시하면 묻지 않는다 |
| redesign/lophn-agent#Q94 | agent runtime 격리에서 MCP stdio 실행 파일 및 skill 꾸러미 읽기를 허용하는 플랫폼 경계. 무제한 shell·파일 tool로 제공하지 않는… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q95 | 이미지·PDF 등 비텍스트 ToolResult 크기 상한. 안전하게 크기를 검사할 수 없으면 model input에 포함하지 않는다. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q96 | ToolCall이 담는 판정 필드와 계약 판 식별자의 구체 형식은 → lophn-agent/harness/tools와 맞춘다. 독립 판정 table·command… | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q97 | 공통 첫 한도 30회·300000ms·1800000ms 및 사람 기다림 제외를 확정할지, 역할별 한도를 둘지. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q98 | OAuth 제품별 lophn 사용 허용·실제 호출 검증 결과와 공식 endpoint·client 식별 값. 미검증 정의는 활성화하지 않는다. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |
| redesign/lophn-agent#Q99 | 첫 판의 지원 API key·loopback 연결·검증된 OAuth 조합. keychain 없는 환경 정책은 → platform/secrets. | 추천대로 | 현재 명시된 contract를 유지하고 owner 검토 목록에서 결정 |

### coding-agent (87)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| architecture/coding-agent#Q1 | repair context 조립과 ticket machine check를 어느 core 밖 프로세스가 수행할까 | 추천대로 | core가 감독하는 coding-agent worker 하나에서 공통 조립·check, MCP·CLI는 adapter |
| architecture/coding-agent#Q2 | 근거가 가장 다른 발생의 결정적 비교를 어떻게 구현할까 | 추천대로 | 고정 release·실패 command·snapshot evidence 종류·stack 위치 fingerprint의 항목 불일치 수, 동률 낮은 Report seq |
| architecture/coding-agent#Q3 | 기본 log·더 읽기·반환 절 상한이 requirements와 domain model에서 다르다 | 추천대로 | 기본 log 45줄, more 5줄·20참조, return 4줄로 교집합 적용, 추가 log 200줄 유지 |
| architecture/coding-agent#Q4 | OpenClaw gateway가 세션별 stdio 프로세스를 보장하지 않을 때 연결 방식을 어떻게 제공할까 | 추천대로 | 공식 mcp.servers 설정 조각은 제공하되 세션 소유·직접 tool loading을 doctor로 확인, 미확인 환경에는 CLI·skill 통로를 성공으로 따로 검사 |
| architecture/coding-agent#Q5 | CLI 사람 command가 user token을 보관하지 않으면서 어떻게 사람 권한으로 요청할까 | 대체됨 | CLI의 사람 관리 command를 뺐다(redesign/coding-agent#Q14) |
| architecture/coding-agent#Q6 | MCP·CLI가 제출할 파일 경로를 사람 원본 임의 읽기와 어떻게 구별할까 | 추천대로 | lophn adapter는 명시 제출 파일만 읽고 앱 scope는 연결 source로 제한, symlink·운영 data·backup·추적 원본은 거절, 원본 자료는 고정 Version 참조로 제출 |
| architecture/coding-agent#Q7 | 일곱 제품의 변화하는 설치 경로와 최소 버전을 어떻게 고정할까 | 추천대로 | 배포 adapter manifest에 확인한 제품 version·설정 schema·경로를 고정하고 네 단계 실제 loading을 별도 검사, 미지원 schema는 조각·수동 설치 안내만 |
| check/coding-agent#Q1 | 정함: 사람 화면의 직접 ticket 생성에 전체 작성 양식이 필요했던 규칙이 정보 최소화와 충돌한다. | 이미 정함 | 정함: 사람 화면의 직접 ticket 생성에 전체 작성 양식이 필요했던 규칙이 정보 최소화와 충돌한다. |
| check/coding-agent#Q10 | 새 mcp-server R34,R35의 blueprint 유래 read tool이 architecture 고정15개 목록에 반영되지 않았다. | 추천대로 | app toolset에 scope 안 read·비confirm tool을 추가하고 판 변경 재검사·direct call·목록 갱신과 별도 schema 측정을 적용한다. |
| check/coding-agent#Q11 | 정함: read 효과라도 confirm이면 coding-agent 통로에서 거절해야 하고 secret 사용은 호출자 종류로 막으면 안 된다. | 이미 정함 | 정함: read 효과라도 confirm이면 coding-agent 통로에서 거절해야 하고 secret 사용은 호출자 종류로 막으면 안 된다. |
| check/coding-agent#Q12 | MCP 입력 표에 command input·environment·invocation ID·preview 참조·실제 test 입력·record_fix claim_s… | 추천대로 | 각 소유 contract 입력과 현재 claim 출처를 adapter 표에 명시한다. |
| check/coding-agent#Q13 | ticket check가 bundle hash만 맞는 다른 조건·다른 완료 보고의 Verification을 참조할 여지가 있다. | 추천대로 | test_command의 TicketTestLink와 reproduction의 problem·고정 test·after release를 함께 비교한다. |
| check/coding-agent#Q14 | architecture 제작 흐름이 완료 보고 전 ticket test_command를 실행하고 수리 흐름이 준비 before/after release 전 rep… | 추천대로 | app test 뒤 release 준비, 그 뒤 before/after reproduction, 완료 보고 뒤 completion_seq를 가진 test_command 검사 순서를 지킨다. |
| check/coding-agent#Q15 | guides domain model에 hook 예산·timeout·빈 출력 예외와 서명·version/hash·release 제외 정책이 없다. | 추천대로 | guides R19,R20,R23,R24,R25의 정책을 domain model에도 명시한다. |
| check/coding-agent#Q16 | inspect 공백 항목 거절과 고정 release source diff 내용이 하위 문서에 빠졌다. | 추천대로 | 공백 inspect 거절, 고정 release 변경 통계·관련 diff만 읽으며 보존 근거 없음을 표시한다. |
| check/coding-agent#Q17 | architecture가 AGENTS.md에서 금지한 번역어를 썼다. | 추천대로 | leaf concern으로 적는다. |
| check/coding-agent#Q18 | repair 문제1~12개와 acceptance check 최대12개가 충돌한다. 문제11개부터 필수 app_test+문제별 reproduction+problem… | 다르게 정함 | 테스트를 만들 수 없는 문제는 사람 확인 acceptance(H4) |
| check/coding-agent#Q19 | app-detail은 증상만으로 repair ticket을 즉시 생성한다고 하지만 채택 답·고정 reproduction 없는 문제는 생성할 수 없다. | 다르게 정함 | 모든 coding 일은 ticket(결정 16), 테스트 불가면 사람 확인 acceptance(H4) |
| check/coding-agent#Q2 | 정함: claim과 내부 필드를 기본 화면에 보이면 최소 정보 원칙과 맞지 않는다. | 이미 정함 | 정함: claim과 내부 필드를 기본 화면에 보이면 최소 정보 원칙과 맞지 않는다. |
| check/coding-agent#Q20 | app-detail 취소는 보호 화면 없이 바로 적용하나 architecture 7.6과 CLI 사람 결정은 confirmation window를 통해 취소한다. | 다르게 정함 | ticket 취소는 되돌릴 수 있는 일이라 묻지 않는다(승인 원칙). app-detail screen은 없앴다 |
| check/coding-agent#Q21 | 첫 check-docs에서 기존 cli R19의 roles I4와 여러 다른 concern intent를 없는 약속으로 판정했으나 최종 검사에서는 모두 통과했다. | 추천대로 | 기존 의도 줄을 유지하고 최신 원 intent와 checker 결과를 확인한다. |
| check/coding-agent#Q3 | repair context의 기본 log 200줄·반환 5줄과 여러 절의 빠진 상한이 requirements보다 크거나 불완전하다. | 추천대로 | 기본 log45줄·반환4줄과 requirements의 모든 줄·문자·개수 상한을 함께 적용한다. |
| check/coding-agent#Q4 | more 최대20참조와 failure_basis 항목별1줄은 requirements에 없는 추가 상한이다. | 추천대로 | more5줄·실패 invocation15줄을 적용하고 목록은 실제 추가 페이지로 잇는다. |
| check/coding-agent#Q5 | repair context domain model이 data fence와 부분 수집·미검증 표시를 빠뜨렸다. | 추천대로 | 자료를 명시 data fence에 두고 해석과 분리하며 한계를 reason·content·summary에 유지한다. |
| check/coding-agent#Q6 | daemon 주소 환경 설정의 우선순위가 architecture에는 있으나 connection 요구에는 빠졌다. | 추천대로 | 명시 주소 옵션·환경 설정·현재 연결 정보·설치 설정·7431 순서를 같은 요구로 유지한다. |
| check/coding-agent#Q7 | coding-agent connection token 발급·저장이 core transaction 안이고 token 위치도 platform 소유 contract와 … | 대체됨 | credential 자동 발급·keychain 보관(결정 19) |
| check/coding-agent#Q8 | CLI의 자체 secret lock·password unlock은 OS keychain 방식과 파일 볼트 폐기에 맞지 않는다. | 다르게 정함 | CLI의 secret lock·password unlock을 없앤다. secret은 OS keychain만 |
| check/coding-agent#Q9 | 질문과 approval의 소유 concern 설명에 lophn-agent/questions가 두 번 쓰였다. | 추천대로 | 가역 질문은 questions, approval는 platform/approvals로 가리킨다. |
| coding-agent/cli#Q1 | H5 TTY 사람 확인을 보호 결정으로 계속 인정할까. | 추천대로 | confirmation window만 |
| coding-agent/cli#Q2 | H2 coding agent가 준비한 모든 release activation에 사람 승인을 유지할까. | 추천대로 | 새 release는 사람이 한 번 눌러 고른다(H2) |
| coding-agent/cli#Q3 | 옛 앱 간 연결의 목록·생성·비활성화·계약 검사·activation을 첫 판에 포함하고 누가 소유할까. | 추천대로 | 첫 판 보류하고 coding-agent connection으로 오인하지 않음 |
| coding-agent/cli#Q4 | 효과 불명 invocation의 외부 효과 confirmed·none·사람 증거 기록을 어떤 계약으로 제공할까. | 추천대로 | 현재 apps/invocations 조회만 제공하고 사람 효과 판정은 소유 계약 확정 뒤 추가 |
| coding-agent/cli#Q5 | 저장된 검색 관점 전용 CLI를 첫 판에 포함할까. | 추천대로 | coding-agent/mcp-server#Q3와 함께 첫 판 보류 |
| coding-agent/cli#Q6 | live sample 조회를 CLI 추가 근거에 포함할까. | 추천대로 | coding-agent/repair-context#Q1과 함께 첫 판 보존 snapshot만 |
| coding-agent/connection#Q1 | 외부 세션에 claim 상실을 비강제 notification으로도 전달할까. | 추천대로 | 첫 판은 현재 claim 재조회만 |
| coding-agent/connection#Q2 | Claude Code의 지원·검증 최소 버전을 고정할까. | 추천대로 | 설치 버전별 실제 skill 발견과 공통 안내 loading 검사 |
| coding-agent/connection#Q3 | 앱 범위 연결에서 프로젝트 근거를 어떻게 읽을까. | 추천대로 | 앞의 두 가지로 해결하고 첫 판에 별도 문서 권한을 추가하지 않음 |
| coding-agent/guides#Q1 | OpenClaw 별도 workspace에서 앱 공통 안내를 어떤 방식으로 읽게 할까. | 추천대로 | 누락을 표시하고 앱 정본 명시 읽기를 안내 |
| coding-agent/guides#Q2 | skill 설치는 제품별 발견 위치 adapter를 기본으로 제공할까. | 추천대로 | 일곱 제품 adapter와 사람이 고른 디렉터리 지원 |
| coding-agent/guides#Q3 | 관리 경계가 없는 기존 안내에 최초 설치 때 구간을 추가할까. | 추천대로 | 일반 갱신은 무변경, 최초 추가는 사람 선택 뒤에만 |
| coding-agent/guides#Q4 | 옛 SDK 우선순위와 중첩 skill metadata 예시를 첫 판에서도 유지할까. | 추천대로 | 첫 판에는 개인 SDK 없이 설치 SDK 우선, 문자열 map |
| coding-agent/mcp-server#Q1 | 옛 app test 기본 300초와 아직 미확정인 test runner timeout 정책을 어떻게 맞출까. | 추천대로 | 당장은 adapter가 300초를 명시하고 공통 상한·기본은 problems/tests#Q3에서 확정 |
| coding-agent/mcp-server#Q2 | 첫 판에 stdio 외 loopback HTTP MCP transport도 제공할까. | 추천대로 | 첫 판 stdio만 |
| coding-agent/mcp-server#Q3 | 저장된 검색 관점 읽기를 첫 판에 포함하고 어느 concern이 소유할까. | 추천대로 | 첫 판은 documents/outline-and-search와 documents/contexts로 제공하고 별도 저장 query 모델은 보류 |
| coding-agent/mcp-server#Q4 | coding agent context 변경안이 고정 action 질문을 직접 생성할 수 있을까. | 추천대로 | 현재 질문 생성 권한을 유지하고 고정 변경안 문서 접수 후 담당 agent가 질문 생성 |
| coding-agent/mcp-server#Q5 | SDK 추가는 고정 import 안내만 반환할까 source import map도 바꿀까. | 추천대로 | 안내를 기본으로 하고 명시 허용 source 반영도 제공 |
| coding-agent/mcp-server#Q6 | 옛 v2 수리 상세 16 KiB·capture 64 KiB·50개 목록 상한을 새 묶음에도 적용할까. | 추천대로 | 적용대로 |
| coding-agent/mcp-server#Q7 | runtime의 앱 간 연결 목록 읽기를 첫 판 MCP에 포함할까. | 추천대로 | coding-agent/cli#Q3와 함께 첫 판 보류 |
| coding-agent/mcp-server#Q8 | blueprint 앱 command를 coding agent에게도 생성 tool로 내보일까 | 추천대로 | 기존 runtime read 범위를 유지하여 명시 앱 toolset에서 read만 먼저; preview 기본·scope·redaction 동일 |
| coding-agent/repair-context#Q1 | 현재 앱 sample hook을 추가 근거로 채택할까. | 추천대로 | 첫 판은 보존된 immutable snapshot만 |
| coding-agent/repair-context#Q2 | 옛 화면 64 KiB 상한과 새 24 KiB 상한 중 무엇을 적용할까. | 추천대로 | 24 KiB 페이지와 cursor |
| coding-agent/repair-context#Q3 | 절별 줄 상한과 새 domain model의 자수·개수 상한을 어떻게 합칠까. | 추천대로 | 기본 묶음에 두 상한을 함께 적용하고 추가 읽기는 별도 페이지 상한 |
| coding-agent/repair-context#Q4 | 근거가 가장 다른 발생의 비교 기준을 무엇으로 정할까. | 추천대로 | 고정 Report·snapshot의 오류·release·근거 차이를 비교하고 접수 순서로 동률 처리 |
| coding-agent/repair-context#Q5 | 2 MiB를 넘는 이미지에 파생 축소나 부분 읽기를 제공할까. | 추천대로 | 첫 판은 미제공 이유와 크기를 표시 |
| coding-agent/tickets#Q1 | 긴 구현 세션에 기본 60분 claim을 유지할까. | 추천대로 | 기본 60분 명시 갱신을 먼저 사용하고 실제 긴 구현 사례로 조정 |
| coding-agent/tickets#Q2 | H4 reproduction test 없는 수리 ticket도 사람 acceptance check로 허용할까. | 추천대로 | 현행 직접 수리 |
| coding-agent/tickets#Q3 | 구현 ticket 완료 끝점을 공통 기본값으로 정할까. | 추천대로 | ticket별 명시 |
| coding-agent/tickets#Q4 | H7 담당 App Engineer의 승인 없는 즉시 ticket 생성을 유지할까. | 추천대로 | App Engineer의 ticket 생성은 묻지 않는다(H7) |
| coding-agent/tickets#Q5 | 옛 24시간 문제 claim과 읽기 자동 갱신을 유지할까. | 추천대로 | problems/repairs과 apps/releases 및 새 ticket 정책 |
| redesign/coding-agent#Q1 | 기본 harness가 비었을 때 후보 순서를 고정할까 | 추천대로 | nullable 선택 유지; 설치·TUI 사용 가능한 후보 하나만 제안하고 여러 개면 사람 선택 |
| redesign/coding-agent#Q10 | readiness·native ID 검증 상한과 resume 공개 범위를 정할까 | 추천대로 | readiness10초·ID1024 code point 검증; resume capability만 catalog에 두고 현재 자동/새 resume 명령은 열지 않음 |
| redesign/coding-agent#Q11 | ticket 앱의 연결 source가 project에 속하지 않거나 project 폴더가 여러 개인 경우 [Start] cwd를 어떻게 정하나 | 추천대로 | 등록 project와 연결 source 관계를 검사하고 여러 폴더는 사람 선택; 없으면 연결 안내·무시작 |
| redesign/coding-agent#Q12 | 정함: MCP claim 하나 흐름과 기존 CLI claim·OpenClaw CLI fallback을 어떻게 맞추나 | 이미 정함 | 정함: MCP claim 하나 흐름과 기존 CLI claim·OpenClaw CLI fallback을 어떻게 맞추나 |
| redesign/coding-agent#Q13 | OS keychain trusted loader와 TUI/MCP/CLI credential 전달의 구체를 어느 concern이 정하나 | 추천대로 | identity·secrets가 keychain·자식 process-local 인증 contract를 정하고 terminal은 보호 handle 전달; token은 config·argv·prompt… |
| redesign/coding-agent#Q14 | 기존 CLI의 사람 daemon·secret·파일/project/context/series 관리 요구를 coding-agent intent만으로 정당화할 수 있나 | 다르게 정함 | CLI는 coding agent용 command와 최소한의 사람 운영(daemon 시작·중지·상태)만 둔다. secret·project·context·series 관리는 화면에서 한다(MVP) |
| redesign/coding-agent#Q15 | 모든 coding 작업 ticket화와 다른 최상위의 ticket 없는 수리·release 계약을 어떻게 맞추나 | 추천대로 | ticket 준비 전 problem bundle 조사와 과거 기록 조회는 유지; 신규 code·고친 기록·release 준비는 현재 ticket claim 필수 |
| redesign/coding-agent#Q16 | harness 선택·profile·native path 설정을 어디에 저장하나 | 추천대로 | platform/settings 재사용, choice와 machine-local profile/env path 분리; 감지가 저장 선택을 지우지 않음 |
| redesign/coding-agent#Q17 | status hook과 summary hook의 설치 목적을 나눌까 | 추천대로 | Claude summary 전달만 기존 budget 유지, runtime 상태 collection 별도 목적·검증 version·receipt; OpenClaw 미검증 unknown |
| redesign/coding-agent#Q18 | 정함: local session observation에 durable execution intent를 추가할까 | 이미 정함 | 정함: local session observation에 durable execution intent를 추가할까 |
| redesign/coding-agent#Q19 | Codex 연결 선택 뒤 MCP 자동 설치 결정과 TOML 조각 출력 보존 계약을 어떻게 맞추나 | 다르게 정함 | 사람이 Codex를 고르면 사용자 config(~/.codex/config.toml)에 receipt와 함께 설치한다. 앱 단위 TOML은 만들지 않는다 |
| redesign/coding-agent#Q2 | enabled=false가 제거·회수를 뜻하나 | 추천대로 | 선택·launcher 후보 제외만, uninstall/revoke 별도 |
| redesign/coding-agent#Q20 | 정함: 기존 coding-agent/tickets#Q2의 ticket 없는 직접 수리 추천을 유지할까 | 이미 정함 | 정함: 기존 coding-agent/tickets#Q2의 ticket 없는 직접 수리 추천을 유지할까 |
| redesign/coding-agent#Q21 | 기존 architecture의 문자·줄 계산을 domain에도 명시할까 | 추천대로 | 현재 architecture 추천 유지; 문자 상한 Unicode code point, CRLF를 LF로 센 logical line; test_command 실행 파일 허용 목록은 소유 spec에 … |
| redesign/coding-agent#Q3 | custom executable와 profile을 어느 범위로 지원할까 | 추천대로 | 명시 profile identity와 executable·환경 이름·effective config roots를 나누며 임의 shell 문자열은 거절 |
| redesign/coding-agent#Q4 | unknown version에 어떤 hook을 설치할까 | 추천대로 | 검증 conservative subset 또는 조각 안내; 검증 subset 없으면 미설치·unknown |
| redesign/coding-agent#Q5 | 관리 marker 없는 기존 안내에 구간을 추가할까 | 추천대로 | 기존 파일 무변경·복구 안내; 새 템플릿 first-create 별도 명시 plan |
| redesign/coding-agent#Q6 | persistent config와 runtime MCP injection을 어떻게 나눌까 | 추천대로 | capability를 나누고 현재 일곱 persistent adapter 계약 유지; runtime injection은 현재 실행에 열지 않음 |
| redesign/coding-agent#Q7 | 감지 cache와 version/auth probe의 budget은 무엇인가 | 추천대로 | TTL 없음·env/profile/catalog generation invalidate·명시 refresh; 별도 version/auth probe 5초·64KiB, fallback alias ho… |
| redesign/coding-agent#Q8 | receipt/journal 저장 실패와 설치 partial을 어떻게 처리할까 | 추천대로 | 실제 commit과 component별 partial을 기록하고 journal/hash 재검사로 ownership 복구 전 갱신·제거 금지 |
| redesign/coding-agent#Q9 | 사람 [Start]와 TUI 관측을 coding-agent intent가 명시적으로 덮는가 | 추천대로 | I1/I4로 사람 시작·지정 ticket을 연결하되 새로운 자동 시작은 금지; 사람의 intent 검수에 범위 명시 |
| redesign/lophn-agent#Q104 | 실행 준비된 ticket 채택 근거 요구와 모든 직접 요청 ticket의 상태를 구분해야 한다 | 추천대로 | ticket 접수는 남기고 채택·검사 부족은 실행 미준비로 표시 |
| redesign/lophn-agent#Q107 | coding-agent/tickets 현재 schema는 준비 상태 없이 채택 질문·검사 조건을 생성 필수로 요구한다 | 추천대로 | 모든 직접 coding 일 ticket 원칙에 맞춰 owner가 접수·실행 준비를 분리; 빈 조건·가짜 채택 생성 금지 |
| redesign/lophn-agent#Q12 | coding agent Start와 MCP 연결 설치·credential은 lophn agent tool이 아니다 | 추천대로 | coding-agent/sessions가 사람 Start·project terminal TUI·첫 prompt를 담당; connection/harnesses가 설치·keychain 처리 |
| redesign/lophn-agent#Q7 | 근거 부족 repair 생성 금지와 모든 coding 일 ticket 원칙이 충돌한다 | 추천대로 | 직접 요청·피드백도 ticket으로 남기고 미정·재현 부족을 준비 상태로 표시 |
| redesign/propagate#Q3 | 모든 coding 요청의 즉시 ticket 접수와 생성 필수 채택·acceptance check를 어떻게 분리할까? | 추천대로 | 접수와 실행 준비를 분리하고 가짜 채택·빈 조건 보충 금지; owner가 states/schema와 claim gating 확정 |
| redesign/propagate#Q4 | reproduction 없는 코드 수리의 ticket 준비와 보호된 사람 문제 확인을 어떻게 맞출까? | 추천대로 | ticket 없는 direct repair는 금지; 보호된 사람 확인을 유지하되 ticket owner의 reproduction 조건을 별도 결정 |
| redesign/propagate#Q7 | 새 앱의 [Start]는 source→project 연결을 요구하지만 source 연결은 첫 coding 작업에서 준비한다. 최초 연결을 어느 단계에서 만들까? | 추천대로 | 사람의 기존 project/source 연결이 있으면 Start; 없으면 추측 없이 준비 차단·직접 터미널 안내. sessions owner가 bootstrap 계약 확정 |

### shell (46)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| architecture/shell#Q1 | confirmation handle의 기한·전송·재시작 무효화는 무엇인가 | 추천대로 | core 메모리 등록·결정 transaction 소비, 32 bytes 무작위, 120초와 대상 기한 중 이른 시각, epoch·main·window·대상·내용·결정 결합 |
| architecture/shell#Q2 | 직전 architecture 앱 메모리 session 추천과 현재 앱 지속 session 요구가 다름 | 추천대로 | 현재 요구 우선; live 앱별 persistent, preview bundle별 별도 persistent, 문서 version별 메모리 |
| architecture/shell#Q3 | shell/editor가 유휴 2분·800ms를 documents/file-tracking 소유 숫자로 가리키지만 현 documents 요구·domain에 그 값… | 추천대로 | shell은 timer를 복제하지 않고 documents의 편집 종료·명시 저장·실제 결과만 소비; 숫자 결정은 documents에서 정리 |
| architecture/shell#Q4 | OS notification 기본 정책과 정보 최소 범위를 무엇으로 둘까 | 추천대로 | opt-in, lophn·확인할 일이 있습니다만 OS 표시, notification ID 클릭은 읽음·결정 없이 화면 열기, backlog 재생 없음 |
| architecture/shell#Q5 | feedback 캡처 binding과 최종 redaction 결과를 어떻게 묶을까 | 추천대로 | main이 button 시점 view·generation·app·release·mode·surface·시각과 raw·redacted hash를 메모리 draftRef에 묶고 최종 선택 전달; 캡처 … |
| check/shell#Q1 | ux가 요구하는 ICU·Intl·message key 패턴이 shell/wording 요구에 없다. | 추천대로 | ux 추천을 현재 마지막 R13 다음 R14로 추가한다. |
| check/shell#Q10 | shell/desktop#R17 build 요구에 의도 줄이 빠졌다. | 추천대로 | shell의 일관된 데스크톱·공용 SDK 목적에 연결한다. |
| check/shell#Q11 | workspace domain의 분할 비율 0.2~0.8이 요구에 없는 배치 제한이고 정보 패널 열림·마지막 탭 복원이 domain에서 빠졌다. | 추천대로 | 유한 0~1 비율과 두 칸 480px 기준만 쓰고 information_panel 값을 추가한다. |
| check/shell#Q12 | terminal domain에 requirements가 정하지 않은 500열·300행 제한이 있고 시작 실패 설명 필드·폴더 선택·OS shell·종료 취소 정책… | 추천대로 | 양수 정수 치수만 유지하고 안전 failure_reason·시작과 종료 확인 정책을 반영한다. |
| check/shell#Q13 | architecture는 앱·문서의 browser worker를 첫 구현에서 일괄 금지하지만 해당 requirements에는 이 금지가 없다. | 추천대로 | worker에도 기존 Node integration·CSP·network 경계를 적용하고 별도 일괄 금지를 만들지 않는다. |
| check/shell#Q14 | architecture feedback에서 이미 보호 창/dialog가 열린 캡처 제외 조건과 전체 3MiB 한도가 빠지고 raw가 feedback rendere… | 추천대로 | 캡처 제외 조건·redaction 뒤 글·전체 한도를 소유 요구로 가리키고 raw는 main·문제 보고 경계만 보유한다. |
| check/shell#Q15 | architecture에서 최신 secret grant·effect·automation 의미와 전역 UX/정적 screen/flow 정본 구분을 확인하기 어렵다. | 추천대로 | 앱 통로의 effect·grant를 그대로 소비하고 shell 화면이 새 caller approval이나 자동화 금지를 만들지 않으며 UX·값·화면·flow 정본을 구별한다. |
| check/shell#Q16 | screen/roles#Q2가 전제한 회수된 담당의 새 대화 금지 표시가 shell/desktop에서는 암묵적이다. | 추천대로 | 회수된 담당에는 지난 대화만 표시하고 멈춘 담당의 가능 여부는 소유 정책에 맡긴다. |
| check/shell#Q17 | screen/roles#Q2 추천은 paused가 대화를 받는다고 하지만 현재 lophn-agent/assignments#R9는 멈춘 책임이 새 요청을 받지 않는… | 추천대로 | 새 대화와 새 요청의 차이를 lophn-agent 소유자가 먼저 정리하고 shell은 현재 허용 결과를 표시한다. |
| check/shell#Q18 | CLI에서 Electron 창이 전혀 없는 상태로 confirmation을 요청할 때 요청 부모 창을 무엇으로 잡는가. | 추천대로 | 창 없는 CLI/headless는 링크만 반환하고 사람이 대상 화면을 연 뒤 그 창을 부모로 삼는 경로를 coding-agent와 shell screen에서 연결한다. |
| check/shell#Q19 | ICU key 요구 적용 뒤 일부 screen key는 확인 예제와 다르게 자리 없이 쓰이거나 중간 segment가 더 많다. | 대체됨 | screen 명세를 없앴다 |
| check/shell#Q2 | agent 자유 글까지 en message key로 만들라는 wording#R11은 미리 정의되지 않은 글을 catalog에 넣게 한다. | 추천대로 | 고정 틀만 key로 관리하고 자유 글은 en 화면 말 규칙만 지킨다. |
| check/shell#Q20 | project-workspace·document screen의 연결 끊김 문구는 provider와 core 단절을 구별하지 않아 core가 끊겨도 디스크 저장이 … | 추천대로 | provider 단절에서는 로컬 파일 작업을 유지하고 core 단절에서는 초안·마지막 read·터미널을 유지하되 documents/file-tracking의 새 파일 쓰기 gate를 닫는 차이를 s… |
| check/shell#Q3 | 정함: architecture의 한국어 합니다체·OS 한국어 문구·release/run/watch 노출 허용이 en 화면 말 규칙과 다르다. | 이미 정함 | 정함: architecture의 한국어 합니다체·OS 한국어 문구·release/run/watch 노출 허용이 en 화면 말 규칙과 다르다. |
| check/shell#Q4 | 정함: architecture 보호 화면은 주체·시각·이유·근거를 기본에 전부 보여 새 requirements의 결정 중심 순서와 다르다. | 이미 정함 | 정함: architecture 보호 화면은 주체·시각·이유·근거를 기본에 전부 보여 새 requirements의 결정 중심 순서와 다르다. |
| check/shell#Q5 | 정함: confirmation.open의 부모 창이 선택 입력이라 부모 없는 보호 창을 허용한다. | 이미 정함 | 정함: confirmation.open의 부모 창이 선택 입력이라 부모 없는 보호 창을 허용한다. |
| check/shell#Q6 | architecture overlay는 tooltip·경계 drag도 keyboard focus를 가져가고 단일 사각형만 설명하여 dialog 안 menu 층이 … | 추천대로 | 조작 표면만 focus를 받고 tooltip·drag·notification은 focus를 빼앗지 않으며 같은 overlay 안 sibling DOM으로 층을 유지한다. |
| check/shell#Q7 | 정함: architecture 좁은 창 운영 패널은 본문 전체 overlay라 앱의 남은 표시 영역을 설명하지 않는다. | 이미 정함 | 정함: architecture 좁은 창 운영 패널은 본문 전체 overlay라 앱의 남은 표시 영역을 설명하지 않는다. |
| check/shell#Q8 | shell/editor 확인에 documents가 정하지 않은 유휴 2분·800ms가 소유자의 숫자처럼 남아 있다. | 추천대로 | 정하지 않은 숫자를 빼고 소유자의 실제 편집 종료·결과만 소비한다. |
| check/shell#Q9 | 정함: shell/editor는 머리 메타 줄에 저장의 모든 단계를 보이게 하여 documents/file-tracking#R15와 P17에 어긋난다. | 이미 정함 | 정함: shell/editor는 머리 메타 줄에 저장의 모든 단계를 보이게 하여 documents/file-tracking#R15와 P17에 어 |
| redesign/propagate#Q6 | 새 Preset·Instructions·Start의 화면 wording/진입점은 어디서 확정할까? | 추천대로 | docs/ui-ux/README.md는 수정하지 않고 기존 정보 최소화·en 원칙 유지 |
| shell/app-frame#Q1 | 문서 session을 고정 판마다 나눌까, 문서 단위로 공유할까? | 추천대로 | 고정 판별 메모리 session을 유지한다. |
| shell/app-frame#Q2 | R25 전체 본문·R27 문서와 나란히 금지·R28 focus native view만 표시가 shell I7과 부딪힌다 | 추천대로 | 앱 공간·패널·카드의 본문 경계 안에서 동시에 표시하고 focus는 하나 |
| shell/confirmation-window#Q1 | TTY의 직접 확인도 사람 승인으로 인정할까(H5)? | 추천대로 | confirmation window만 승인(H5) |
| shell/confirmation-window#Q2 | MCP sampling·elicitation을 승인 흐름에 쓸까? | 추천대로 | MCP는 승인할 수 없다 |
| shell/confirmation-window#Q3 | 앱 동작 전후를 설명·안전 preview 중 무엇으로 보여 줄까? | 추천대로 | 설명을 기본으로 하고 안전 preview가 제공되는 경우에만 추가한다. |
| shell/design-system#Q1 | UI customization을 token override만 둘까, slot·fork까지 제공할까? | 추천대로 | 초기 token override만 제공하고 실제 두 번째 소비자와 앱 SDK 사례 뒤 slot·fork 계약을 정한다. |
| shell/design-system#Q2 | 앱별 theme 예외와 오래된 SDK의 시각 drift를 어디까지 허용할까? | 추천대로 | apps/sdk의 version 고정을 존중하고 전역 override는 공통으로 존재하는 token에만 적용한다. |
| shell/design-system#Q3 | 1280px 분할의 읽기 폭은 원문 표 456px인가, 여백 규칙대로 488px인가? | 추천대로 | 칸 폭 기준16px 여백으로 488px를 사용한다. |
| shell/design-system#Q4 | UI 구현 재료를 CSS Modules·Radix Primitives·Lucide로 유지할까? | 추천대로 | CSS Modules·Radix Primitives·Lucide 유지 |
| shell/design-system#Q5 | 입력 경계 대비 1.8:1을 3:1로 강화할까? | 대체됨 | 접근성은 범위 밖. 대비 강화 검사를 두지 않는다 |
| shell/design-system#Q6 | system font 기본 선택·global compact·사용자 accent 변경을 허용할까? | 추천대로 | Pretendard 기본·표만 compact·검증된 전역 accent override로 시작한다. |
| shell/desktop#Q1 | Electron·Deno·SQLite 기술 선택을 유지할까(H6)? | 추천대로 | 기존 기술 선택 유지 |
| shell/desktop#Q2 | 전역 팔레트와 런처 복귀 shortcut의 범위·기능을 구별할까? | 추천대로 | 전역 팔레트 Shift+K와 창 안 런처 Shift+L을 구별한다. |
| shell/terminal#Q1 | PTY를 어느 프로세스가 소유할까 | 추천대로 | main이 감독하는 terminal host; node-pty POSIX PTY·Windows ConPTY; 출력 메모리 |
| shell/terminal#Q2 | 터미널 shell·출력 보존의 첫 값은 무엇으로 할까 | 추천대로 | 사용자 login shell·Windows PowerShell 7 또는 5.1; 최근 10,000줄·5MiB 메모리, 재시작은 종료 placeholder |
| shell/terminal#Q3 | 나중에 lophn agent가 Orca의 orchestration처럼 터미널의 coding agent를 지휘하게 할 수도 있다(K6과 관계) | 추천대로 | 지금은 정하지 않음 |
| shell/workspace#Q1 | 탭 배치·복원 상태를 ledger에 둘까 사람 UI 상태로 따로 둘까 | 추천대로 | 기존 shell/layout.json에 프로젝트별 UI 값; 정본 내용·credential·PTY runtime 없음 |
| shell/workspace#Q2 | 현재 보기 요약의 크기와 탭 상세 page 크기를 무엇으로 할까 | 추천대로 | UTF-8 2KiB 요약·20개 탭 page; 선택 범위와 앱 화면 참조만, 상세 앱 read command |
| shell/workspace#Q3 | 세션 시각 블록을 shell에 어떻게 그릴까 | 추천대로 | 선언형 SDK부터; 문서는 고정 view·앱 카드는 기존 앱 frame sandbox |
| ux#Q1 | shell/wording이 en-only 시작과 message key를 요구하지만 key 이름 규칙, ICU MessageFormat, 날짜·숫자·상대 시각의 I… | 추천대로 | A. 다음 요구를 shell/wording에 추가한다: "**[R16]** 화면 message key는 `<screen>.<part>.<name>` 패턴을 쓰고 en 문구는 ICU MessageFo… |

### domain model 사이 (14)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| dm#C1 | RunSource.assignment_revision이 seq인데 Assignment.revision은 1부터 늘어나는 정수 | 추천대로 | run-loop를 정수로 |
| dm#C10 | repair-context의 대표 발생·추가 근거 상한이 snapshots와 겹칠 수 있음 | 추천대로 | repair-context 정본, snapshots는 고정 증거만 |
| dm#C11 | Role.ToolSelection은 command 이름만, 승인된 (app, command) 쌍은 Assignment에 고정 — 승인·tools·blueprint… | 대체됨 | Role은 Preset으로 바뀐다(결정 10) |
| dm#C12 | 정함: extensions(skill, 외부 MCP)가 architecture/agent-runtime.md에는 없다고 적혀 있음 | 대체됨 | architecture를 다시 썼고 extensions가 들어 있다 |
| dm#C13 | 한눈에 보기 예시의 "정해진 기간 재발이 없으면 닫힘"이 problems/closing 규칙(조용히 닫힘 없음)과 다름 | 추천대로 | domain-model/README의 entity 지도 쓸 때 고침 |
| dm#C14 | harness/waiting-and-recovery의 run_wait_resolutions(결정 seq, 요청 key 중복 반영)를 platform/approva… | 추천대로 | approvals·questions가 결정을 내고 run_wait_resolutions가 seq로 한 번만 반영 |
| dm#C2 | tool 이름 표기(역할 파일은 document.save_version 같은 점 표기 제안)와 harness/tools 목록의 이름 규칙 | 추천대로 | tools.md가 정한 규칙으로 역할 파일을 맞춤 |
| dm#C3 | approval 한 번 사용(approval_uses)을 apps/invocations·permissions·releases·lophn-agent/assignme… | 추천대로 | platform/approvals의 공통 규칙을 각 파일이 가리키게 |
| dm#C4 | notification 조건 근거(운영 보고인지, machine pause인지, watch 확정)를 각 event payload가 실어야 함 | 추천대로 | 각 소유 파일에 필드 추가 |
| dm#C5 | revert의 영역별 이전 값·현재 CAS·복원 뒤 의존 검사, 원본 연결 문서의 파일 반영 계약 | 추천대로 | 각 영역 파일에 revert 정책 절 |
| dm#C6 | (app, document declaration key) 대응과 place 교차 unique의 정본이 apps와 documents 사이에서 미정 | 추천대로 | documents/addressing 정본 |
| dm#C7 | place_names 예약·rename transaction을 projects와 apps/registration이 공유 | 추천대로 | documents/addressing의 공통 표 하나 |
| dm#C8 | ledger 공통 command 기록의 compare/prepared 필드와 각 파일 command 입력 이름이 다름 | 추천대로 | ledger 이름으로 통일 |
| dm#C9 | provider·model 설정 원본과 일반 settings의 중복 저장 | 추천대로 | provider·model은 자기 표, settings는 참조만 |

### product (1)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| product#Q1 | 기술 선택: SDK·앱·core·MCP server를 TypeScript 하나로 통일하고 Electron·Deno·SQLite를 이어 쓸까(H6) | 추천대로 | 유지 |

### flows (30)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| flow/add-agent-extension#Q1 | 내장 lophn·App Engineer·Context Engineer 정의를 바꿀 수 없는데 확장 flow의 사용할 역할 선택은 내장 역할도 포함하는가. | 대체됨 | preset으로 모든 역할에 MCP·skill을 붙인다(결정 10) |
| flow/answer-question#Q1 | flow의 화면 목록에 option action·중요한 approval·secret 입력을 받는 confirmation-window가 빠져 있다. | 추천대로 | 보호 결정 화면을 flow screens와 본문에 추가한다. |
| flow/answer-question#Q2 | outline의 무응답은 답 없음으로 끝낸다는 표현이 기본 기한 없는 질문의 대기와 충돌한다. | 추천대로 | 기본 기한 없이 기다리는 현재 요구를 따르고 무응답을 동의나 기본 선택으로 처리하지 않는다. |
| flow/app-broken#Q1 | repair ticket 생성 전에 각 문제의 고정 reproduction test가 필수인데, 아직 테스트가 없는 새 문제에서 누가 ticket 없는 테스트 준… | 다르게 정함 | 테스트를 만들 수 없으면 사람 확인을 acceptance로(H4). 모든 coding 일은 ticket(결정 16) |
| flow/approve-action#Q1 | 대기 approval request의 명시 취소를 받는 요구가 있지만 confirmation-window의 Cancel과 창 닫기·Escape가 request 취… | 추천대로 | request 취소는 명시 행동으로 접수하고 창 닫기·Escape는 결정이나 request 취소로 해석하지 않는다. |
| flow/backup-and-restore#Q1 | 사람이 즉시 만드는 수동 플랫폼 backup의 접수·결과·취소 contract는 무엇인가? | 추천대로 | 자동 backup과 같은 범위·검증·보존 경계를 재사용하는 수동 요청을 requirements에 추가한다. |
| flow/backup-and-restore#Q2 | 앱 export에서 제외된 외부 자료와 export 묶음 검증 결과를 어떻게 확인하는가? | 추천대로 | apps/data에 앱 export의 제외 자료·검증·결과 조회 요구를 추가한다. |
| flow/backup-and-restore#Q3 | 앱 export 진입과 결과를 어느 screen에서 제공하는가? | 추천대로 | 앱별 export는 app-detail에 연결하고 settings는 플랫폼 backup·restore를 맡긴다. |
| flow/build-context#Q1 | flow outline은 Context Engineer가 허락된 앱 read command로 자료를 찾는다고 하지만 requirements는 Context Eng… | 추천대로 | 현재 requirements대로 Context Engineer는 blueprint 계약만 조회하고 앱 read 항목을 제안하며 실제 호출은 해당 역할·assignment와 앱 허락을 다시 검사한다. |
| flow/catalog#Q1 | lophn-agent#I8의 개발용 eval을 바이브코딩 사용자의 제품 flow 목록에 넣을까? | 추천대로 | 제품 기능이 아닌 eval은 개발 품질 flow로 별도 관리 |
| flow/catalog#Q2 | 정함: 사람이 정하는 중인 harness#I7의 prompt injection·secret 보장 장면을 확정할까? | 추천대로 | 사람 결정까지 미확정 유지 |
| flow/catalog#Q3 | 세션 visual의 산점 차트를 SDK가 지원한다고 쓸까? | 추천대로 | 사람 결정 전 flow에서는 양쪽이 지원하는 표·선·막대·도표·앱 카드만 예로 든다 |
| flow/catalog#Q4 | Claude·ChatGPT 구독 연결을 첫 설치에서 항상 쓸 수 있다고 안내할까? | 추천대로 | lophn 이름으로 사용 허용과 실제 tool call이 확인된 구독 경로만 제공하고 미검증·거절에는 API key나 로컬 선택을 안내 |
| flow/define-terms#Q1 | Context Engineer가 후보 이름·근거 외 가능한 뜻과 추천 정의를 제안할 수 있을까? requirements는 agent가 후보 이름·근거만 다루도록 … | 추천대로 | 현행 제한에 맞춰 후보 이름·출현 근거와 미정 선택만 제공하고 추천을 사람 정의로 적용하지 않는다. |
| flow/edit-document#Q1 | 충돌·파일 쓰기 실패·연결 끊김 때 편집 초안과 새 원본을 함께 보존하는 요구가 없고, 초안의 보존 범위·수명도 정해지지 않았다. | 추천대로 | 초안을 새 원본으로 덮지 않는 최소 contract를 shell/editor에 추가하고 복구 범위는 별도 결정한다. |
| flow/edit-document#Q2 | 저장되지 않은 글이 있는 탭·창 닫기 때 사람의 저장·계속 편집·버리기 선택과, 저장 완료 확인 전 닫기를 막는 contract가 없다. | 추천대로 | 자동 저장 완료를 확인하고 충돌·실패·미확인이 남으면 사람이 계속 편집 또는 명시 폐기를 결정하게 한다. |
| flow/install-lophn#Q1 | OS 설치 과정과 core 기동 실패로 launcher를 정상으로 열 수 없는 경우의 안전한 안내 경로가 화면 목록과 requirements에 없다. 어떤 경로에… | 추천대로 | 가장 가까운 launcher의 실패 갈래로 연결하되 OS installer 안내와 core 없는 shell 진단의 구체 contract는 소유 concern에서 보완한다. |
| flow/manage-operator#Q1 | assignment 일시 멈춤·회수 접수 시 진행 run과 question·approval 대기를 정확히 어떤 command 경계에서 정리할까? run 멈춤과 책… | 추천대로 | assignment 멈춤·회수와 run 멈춤 접수의 연결을 명시하고 현재 멈춤 검사·미실행·늦은 결과 규칙을 함께 따른다. |
| flow/manage-provider-accounts#Q1 | settings screen의 리셋 시각 미상일 때 최대 1시간 뒤라는 안내는 실제 사용 가능 보장이지만 provider#R24는 1시간 뒤 다시 후보가 되는 내… | 추천대로 | 서버 리셋 미상은 확인하지 못함으로 남기고 1시간은 다음 확인 가능 시각으로만 안내한다. |
| flow/manage-tickets#Q1 | app-detail screen은 Issue 증상에서 검사 조건을 자동으로 정해 Task가 즉시 열린다고 하지만, tickets#R3·R9·R26은 기존 채택 답… | 다르게 정함 | ticket은 채택한 근거로 만들고, 테스트 불가면 사람 확인 acceptance(H4) |
| flow/manage-tickets#Q2 | app-detail에 특정 ticket의 복사 요청 문장·고정 자료와 버려진 작업을 다음 coding agent에게 다시 맡기는 행동이 없다. | 추천대로 | Task 상세에서 현재 맡길 수 있는지와 복사 요청 문장을 제공하고 사람의 명시 지시로만 다시 맡긴다. |
| flow/organize-documents#Q1 | 앱의 표시 이름·slug 변경 입력과 허용 주체·비교 기준을 정하는 요구가 없다. 옛 address 안내만으로 rename command contract를 대신할… | 추천대로 | 사람 직접 rename을 apps/registration에 추가하고 slug의 옛 예약·참조는 documents/addressing을 따른다. |
| flow/organize-documents#Q2 | export할 고정 판·원래 바이트의 요구는 있지만 포함·제외 자료와 제외 이유를 사람이 확인하는 export 결과 contract가 없다. | 추천대로 | 선택한 고정 판별 포함·제외·안전한 이유를 결과로 제공하고 필요 없는 별도 문서·상태는 만들지 않는다. |
| flow/receive-operator-report#Q1 | documents#I6의 series 등록·멤버 작성·다음 이름·draft·보관을 사람이 쓰는 flow와 screen이 없고, Operator 보고 flow는 기… | 추천대로 | Operator는 기존 문서 새 판만. 사람이 쓰는 series flow를 따로 둔다 |
| flow/receive-operator-report#Q2 | 새 Operator 보고를 notification에서 여는 계기를 추가할까? 현재 계기 표는 일반 문서 저장과 run 종료 notification을 금지한다. | 추천대로 | 현행 계기 표를 유지하고 결과 문서는 Roles에서 찾으며 사람 결정이 필요한 질문 등만 Things to confirm으로 보낸다. |
| flow/update-lophn#Q1 | 수동 lophn update 전에 변경 내용과 재시작 필요를 제공하는 contract는 무엇인가? | 추천대로 | platform/install-and-update에 변경 안내의 출처·설치 판 연결·재시작 필요 확인을 추가한다. |
| flow/verify-app-repair#Q1 | app-detail Issues에서 수리 주장·실제 테스트·미확인 범위와 고쳐짐 또는 아직 이상함의 보호된 사람 확인으로 가는 행동이 빠져 있다. | 추천대로 | Issue 상세에서 실제 확인 근거와 닫힌 이유를 구별하고 필요한 경우 confirmation-window에서 현재 문제·release에 묶인 사람 답을 받는다. |
| flow/view-agent-visuals#Q1 | 시각 블록은 산점 차트를 받지만 첫 SDK 차트는 산점도를 지원 밖으로 두므로 어떤 계약을 따라 그릴 것인가? | 추천대로 | intent의 표·차트 약속은 유지하고 flow 예시는 공통으로 지원하는 선·막대만 쓰며 산점도 요구 충돌은 소유 requirements에서 해소한다. |
| flow/view-agent-visuals#Q2 | node·edge 도표를 공용 SDK로 그린다고 요구하지만 첫 SDK 묶음에는 도표 renderer와 입력 계약이 없다; 어느 공용 component가 맡는가? | 추천대로 | visuals의 도표 요구를 유지하려면 apps/sdk 소유 요구에 선언형 node·edge renderer와 공통 입력 계약을 명시한다; 이 워커는 flow에서 기존 약속만 연결하고 새 Packa… |
| flow/work-offline#Q1 | provider 준비나 재로그인으로 이어지는 offline 복구 경로를 어느 화면에서 보여 주는가? | 추천대로 | 필요한 행동은 현재 화면에 한 줄로 보이고 실제 준비는 설정 도움·provider 연결 flow로 연결한다. |

### screens (7)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| check__screens#1 | roles.md가 인라인으로 적은 "screen/roles#Q1"(Withdraw 없이 Pause/Resume만 제공하는 역할)과 "screen/roles#Q2"… | 대체됨 | screen 명세를 없앴다 |
| check__screens#2 | app-detail.md Access tab의 "Which roles can use this app"에는 역할별 command 허락을 켜고 끄는 행동이 있다고 적… | 대체됨 | screen 명세를 없앴다 |
| check__screens#3 | 여러 화면 문서가 실제 en 문구 key 없이 한국어로 "자세히 보기"/"더 보기" 같은 펼침 자리를 가리킨다(예: settings.md 보안 상태 점검, ter… | 대체됨 | screen 명세를 없앴다 |
| screen/app-detail#Q1 | coding-agent/tickets#R2는 ticket 생성에 제목·무엇·왜(각 1~2,000자)·acceptance check(1~12개)·고정 근거를 요구하… | 대체됨 | screen 명세를 없앴다 |
| screen/app-detail#Q2 | 정함: screens/README#3의 화면 말 표는 claim을 "보이지 않음"으로 정했는데 problems/grouping#R12는 "ticket·claim은… | 대체됨 | screen 명세를 없앴다 |
| screen/roles#Q1 | lophn-agent/assignments#R9는 모든 assignment의 멈춤·회수를 사람이 결정할 수 있다고 하지만, lophn·Context Enginee… | 대체됨 | screen 명세를 없앴다 |
| screen/roles#Q2 | shell/desktop#R4는 "대화 가능 여부는 lophn-agent/roles 및 lophn-agent/assignments를 따른다"며 대화 불가 역할이 … | 대체됨 | screen 명세를 없앴다 |

### intent 연결 (48)

| id | 질문 | 판정 | 결정 |
|---|---|---|---|
| intent/apps#Q1 | apps/invocations#R14은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/apps#Q2 | 정함: apps/connections#R3이 intent 또는 최근 사람이 정한 것과 부딪힌다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/apps#Q3 | 정함: apps/permissions#R15이 intent 또는 최근 사람이 정한 것과 부딪힌다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/apps#Q4 | apps/invocations#R7이 intent 또는 최근 사람이 정한 것과 부딪힌다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/apps#Q5 | 정함: apps/automations#R10이 intent 또는 최근 사람이 정한 것과 부딪힌다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/apps#Q6 | 정함: apps/runtime#R13이 intent 또는 최근 사람이 정한 것과 부딪힌다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/apps#Q7 | 정함: apps/runtime#R14이 intent 또는 최근 사람이 정한 것과 부딪힌다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/coding-agent#Q1 | 정함: coding-agent/connection#R18의 회수 뒤 현재 ticket 읽기 확인이 coding-agent#I2와 connection#R8의 즉시 … | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/documents#Q1 | 정함: context 기본 화면에서 선택 이유·전체 관점 목록·빈 관점까지 반드시 보여 주어야 할까. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/documents#Q2 | 정함: 파일 상태의 관측 시각과 비교한 판을 기본 화면에 항상 보여 주어야 할까. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/documents#Q3 | 정함: 파일 저장의 내부 완료 단계를 기본 화면에 모두 보여 주어야 할까. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/documents#Q4 | 정함: 전체 목차의 통계와 활동을 기본 화면에 항상 보여 주어야 할까. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/documents#Q5 | 정함: context 목차에서 선택 이유·선택 판·빈 관점을 기본으로 모두 보여 주어야 할까. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/documents#Q6 | 정함: 검색 반영 판·최신 판과 내부 처리 상태를 기본 화면에 모두 보여 주어야 할까. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/documents#Q7 | 정함: 프로젝트의 폴더·glob·.gitignore와 문서 수를 기본 화면에 항상 보여 주어야 할까. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent#Q1 | lophn-agent/scheduling#R2은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent#Q2 | 정함: lophn-agent/assignments#R3이 기본 화면에 안쪽 상태와 설정 전체를 노출하여 정보 최소화와 충돌한다 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent#Q3 | 정함: lophn-agent/questions#R4이 답 전 기본 화면에 역할·관련 일·대기 상태까지 항상 노출하여 정보 최소화와 충돌한다 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent#Q4 | 정함: lophn-agent/observability#R20이 trace의 모든 근거·주체·시각·링크를 기본 화면에 놓아 정보 최소화와 충돌한다 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent/harness#Q1 | 정함: lophn-agent/harness/tools#R4가 바깥 조회도 external로 분류하여 최근 사람이 정한 command effect 기준과 충돌한다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent/harness#Q2 | 정함: lophn-agent/harness/model#R15의 한국어 선택 이름을 화면에 그대로 제공하면 en-only i18n 규칙과 충돌한다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent/roles#Q1 | lophn-agent/roles/common#R8은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent/roles#Q2 | lophn-agent/roles/common#R9은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent/roles#Q3 | lophn-agent/roles/lophn#R19은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent/roles#Q4 | lophn-agent/roles/app-engineer#R20은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent/roles#Q5 | lophn-agent/roles/context-engineer#R14은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/lophn-agent/roles#Q6 | 정함: lophn-agent/roles/common#R5의 secret 사용 금지가 앱 grant를 받은 command에도 적용되는 것으로 읽혀 apps#I7 및… | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/platform#Q1 | platform/approvals#R8은 앱 화면의 사람만 요청자로 삼아 apps#I11의 agent·다른 앱 command 호출과 apps/invocations… | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/problems#Q1 | problems/tests#R18은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/problems#Q2 | 정함: problems/problem-codes#R6의 한국어 고정 화면 문구가 en 시작과 message key 규칙에 부딪힌다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/problems#Q3 | 정함: problems/grouping#R11이 목록에 발생 수·시각·release를 기본 노출해 정보 최소화에 부딪힌다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/problems#Q4 | 정함: problems/grouping#R12가 앱 카드의 상태별 문제 수와 ticket·claim을 화면에 직접 노출한다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/problems#Q5 | 정함: problems/closing#R13이 닫힌 문제에 확인 범위·미확인 부분·release·근거를 구분 없이 노출한다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q1 | 정함: shell/app-frame#R26의 좁은 창 view 숨김이 최근 결정 및 R36과 부딪힌다. | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q10 | 정함: shell/wording#R6이 최근 결정 또는 intent와 부딪힌다: 개발 용어 UI 노출 허용을 사용자 화면 노출 검사로 변경 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q11 | 정함: shell/wording#R7이 최근 결정 또는 intent와 부딪힌다: 한국어 조사 전용 검사를 message key·en 메시지·placeholder … | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q12 | 정함: shell/wording#R11이 최근 결정 또는 intent와 부딪힌다: 화면·문서·agent의 동일 기술 용어 강제를 화면 en/문서·코드 규칙 분리로… | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q13 | 정함: shell/wording#R13이 최근 결정 또는 intent와 부딪힌다: watch·model slot·run·invocation 화면 제목을 사용자용 … | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q14 | shell/desktop#R17은 어느 약속에도 안 붙는다. intent에 약속을 더할까, 요구를 버릴까 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q15 | 정함: shell/confirmation-window#R6이 요청 창 위 modal이라고만 적고 최근 결정의 child modal BrowserWindow 경계를… | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q2 | 정함: shell/confirmation-window#R2이 최근 결정 또는 intent와 부딪힌다: confirmation window의 기본 정보는 결정에 필… | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q3 | 정함: shell/design-system#R41이 최근 결정 또는 intent와 부딪힌다: 한국어 compact·요일 표기를 en 및 locale 기반 form… | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q4 | 정함: shell/editor#R14이 최근 결정 또는 intent와 부딪힌다: 동일 버전 안내를 en message key 문구로 변경 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q5 | 정함: shell/wording#R1이 최근 결정 또는 intent와 부딪힌다: 한국어 기본 UI를 en-only 시작과 전 문구 message key 기반 i1… | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q6 | 정함: shell/wording#R2이 최근 결정 또는 intent와 부딪힌다: 화면 용어와 문서·코드 용어를 분리하고 안쪽 개념 노출 제거 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q7 | 정함: shell/wording#R3이 최근 결정 또는 intent와 부딪힌다: 한국어 조사 전용 요구를 locale별 완성 메시지와 placeholder 처리로… | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q8 | 정함: shell/wording#R4이 최근 결정 또는 intent와 부딪힌다: 기술 용어 노출 예외를 제거하고 사용자용 en 라벨 적용 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
| intent/shell#Q9 | 정함: shell/wording#R5이 최근 결정 또는 intent와 부딪힌다: 한국어 합니다체 오류 안내를 짧은 en 영향 안내로 변경 | 대체됨 | intent v3로 다시 연결하며 다시 본다 |
