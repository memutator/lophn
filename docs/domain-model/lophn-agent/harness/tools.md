---
type: domain-model
concerns: [lophn-agent/harness/tools]
---

# lophn-agent/harness/tools

ToolCall과 tool 정의·결과의 구조 및 선행·후행 기록 제약을 정의한다.

## ToolCall (`tcl`)

| 필드                       | 타입                                                 | null   | 제약                                                                    | 뜻                  |
| -------------------------- | ---------------------------------------------------- | ------ | ----------------------------------------------------------------------- | ------------------- |
| `id`                       | `tcl` ID                                             | 아니오 | PK; 최초 call은 업무 command idempotency key                            | 시도                |
| `run`                      | `run` ID                                             | 아니오 | → lophn-agent/harness/run-loop                                          | 수행 run            |
| `model_call`               | `mcl` ID                                             | 아니오 | 같은 run의 완전 성공 응답; → lophn-agent/harness/usage                  | 요청 응답           |
| `response_key`             | 비어 있지 않은 문자열                                | 아니오 | 최초 요청 `(model_call,response_key)` unique                            | 응답 내부 call key  |
| `response_order`           | 0 이상 정수                                          | 아니오 | 응답 순서 불변                                                          | 순차 처리 순서      |
| `tool`                     | 비어 있지 않은 문자열                                | 아니오 | 고정 목록의 정확 이름; 추측 수정 금지                                   | 동작                |
| `definition_revision`      | 비어 있지 않은 문자열                                | 아니오 | Run.basis의 정의 판                                                     | contract 기준       |
| `effect`                   | `read / write / external`                            | 아니오 | 소유 contract 값; model이 변경 불가; confirm은 별도 boolean             | 효과                |
| `app_command`              | AppCommandBinding                                    | 예     | 자동 앱 tool일 때 필수                                                  | 앱 contract 판      |
| `confirm`                  | boolean                                              | 아니오 | 앱 blueprint 값; 그 밖 기본 false; effect와 독립                        | approval 강제       |
| `extension`                | `{server_name,configuration_revision,original_tool}` | 예     | 외부 MCP에만; → lophn-agent/extensions                                  | 외부 출처           |
| `input`                    | sha256                                               | 아니오 | redaction된 불변 blob                                                   | 인자                |
| `output`                   | sha256                                               | 예     | 실제 결과; finished 성공에 필수                                         | 결과                |
| `retry_of`                 | `tcl` ID                                             | 예     | 같은 요청의 최초 ID; retry chain 금지                                   | 업무 중복 방지 기준 |
| `attempt`                  | 0 이상 정수                                          | 아니오 | 최초 0; 자동 retry는 최대 1                                             | 시도 순번           |
| `retry_at`                 | 시각                                                 | 예     | 허용 일시 retry만; 멈춤·steering 뒤 적용 불가                           | 예정 시각           |
| `decision`                 | ToolDecision                                         | 예     | 요청 후·진입 전에 필수; 판정 정의는 → lophn-agent/harness/tool-judgment | 실제 판정 snapshot  |
| `state`                    | `requested / started / finished`                     | 아니오 | 아래 전이                                                               | 기록 상태           |
| `started_at / finished_at` | 시각 각각                                            | 예     | started_at은 실제 진입; finished_at은 terminal 필수                     | 시각                |
| `duration_ms`              | 0 이상 정수 ms                                       | 예     | 단조 시계 측정값                                                        | 실제 call 시간      |
| `outcome`                  | ToolOutcome                                          | 예     | finished에 필수; 그 외 null                                             | 실제 결과           |

### 상태

| 상태        | 뜻                                     |
| ----------- | -------------------------------------- |
| `requested` | 요청 기록; ask 대기 call도 여기에 있음 |
| `started`   | 실제 contract 진입                     |
| `finished`  | 성공·실패·미실행·불명확 확정           |

| 전          | 후          | actor   | 조건                                                                           | event                  |
| ----------- | ----------- | ------- | ------------------------------------------------------------------------------ | ---------------------- |
| 없음        | `requested` | machine | 쓰기·confirm·external은 진입 전, read는 실제 읽기 뒤 기록                      | `ToolCallRequested`    |
| `requested` | 같은 상태   | machine | 판정 기준·이유 기록; ask면 approval 및 Run 대기 연결                           | `ToolCallDecided`      |
| `requested` | `started`   | machine | 현재 run·assignment·scope·input·CAS·판정·승인 재검사; read는 실제 진입 뒤 기록 | `ToolCallStarted`      |
| `requested` | `finished`  | machine | deny·사람 거절·수정·run 멈춤; 미실행                                           | `ToolCallFinished`     |
| `started`   | `finished`  | machine | 실제 결과·안전한 실패 또는 확인 불가 기록                                      | `ToolCallFinished`     |
| `finished`  | `finished`  | machine | 늦은 효과 확인 감사 보완; 기존 outcome 유지                                    | `ToolCallSupplemented` |

### 불변 조건

- tool 업무 동작 하나는 다른 concern의 contract 호출 하나다. 여러 영역의 숨은
  절차는 없다. 판정·기록·approval 대기는 공통 처리다.
- 완전한 model 응답만 처리한다. 최초 요청 중복 key는
  `(model_call,response_key)`이며 retry는 최초 tcl ID를 업무 idempotency key로
  유지한다.
- confirm=false인 read는 현재 assignment·scope·멈춤 확인 뒤 직접 호출하며
  요청·판정·진입·결과 기록은 뒤따른다. 읽기 응답은 ledger 저장을 기다리지 않되
  다음 model 판단 전에는 결과를 저장한다.
- write·confirm=true·external은 요청 및 진입 기록 저장 성공 뒤에만 시작한다.
  ledger 쓰기의 대상 변경과 ToolCall 성공 기록은 같은 짧은 command
  transaction이다.
- 승인 허락은 성공이 아니다. 고정 대상·input·비교 기준·효과가 달라졌으면 옛
  approval을 사용하지 않는다. approval 사용과 업무 변경 또는 외부 진입은 같은
  transaction에서 한 번 확정한다. → platform/approvals.
- 다중 대상 중 deny 하나면 전체 미실행; deny 없고 ask 있으면 하나의 고정
  approval로 묻는다. 일부부터 바꾸지 않는다.
- 응답 순서대로 하나씩 처리하며 쓰기 최종 실패 뒤 남은 미시작 call은 미실행으로
  닫고 새 판단을 받는다.
- 인자를 추측해 고치거나 숫자 문자열을 숫자로 바꾸지 않는다. 정의에 없는
  필드·동작은 `invalid_input`이다.
- 밖으로 전달한 call의 응답이 없으면 미실행이 아니라 uncertain이다. 결과
  조회·idempotency 보장 없이는 자동 retry하지 않는다.
- terminal run의 늦은 결과는 감사 보완만이며 새 대상 변경·다음 model call을
  만들지 않는다. 불명확 효과와 충돌할 후속 call은 확인 전 차단한다.

## ToolDecision 참조

값의 정본은 → lophn-agent/harness/tool-judgment의 ToolDecision이다.
ToolCall.decision에는 그 값 전체를 저장하며 별도 verdict·approval 규칙을
정의하지 않는다.

## ToolOutcome (값)

| 필드   | 타입                                           | null   | 제약                                                                        | 뜻   |
| ------ | ---------------------------------------------- | ------ | --------------------------------------------------------------------------- | ---- |
| `kind` | `success / failure / not_executed / uncertain` | 아니오 | 진입 없는 call은 success·uncertain 불가                                     | 결과 |
| `code` | 안전한 짧은 코드                               | 아니오 | 사람 결정 미실행은 `human_decision`; 반복 차단은 `repeated_failure_blocked` | 이유 |

## ToolDefinition (값)

제품 코드 또는 검증된 extension 목록의 값이며 ledger entity가 아니다.

| 필드                            | 타입                       | null        | 제약                                                                                                                                                          | 뜻             |
| ------------------------------- | -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `name / description / revision` | 비어 있지 않은 문자열 각각 | 아니오      | 이름 unique; 내장 name은 `<영역>.<동작>` 점 표기(예: `document.save_version`, `ticket.create`, `problem.set_interpretation`); 외부는 → lophn-agent/extensions | 정의           |
| `input_schema / output_schema`  | JSON Schema 각각           | 아니오      | 검증 가능; actor·권한을 model이 지정할 필드 없음                                                                                                              | 입출력         |
| `effect`                        | `read / write / external`  | 아니오      | 소유 contract 값; 없으면 목록·호출 제외                                                                                                                       | 실제 영향      |
| `confirm`                       | boolean                    | 아니오      | 기본 false; 앱은 blueprint의 별도 값                                                                                                                          | 사람 확인      |
| `app_command`                   | AppCommandBinding          | 예          | 자동 생성 앱 tool에 필수                                                                                                                                      | 원래 command   |
| `scope_check`                   | contract 검사 이름         | 아니오      | 현재 대상 범위 검사                                                                                                                                           | 범위           |
| `contract`                      | concern·contract 이름      | 아니오      | 업무 호출 하나만                                                                                                                                              | 대응 contract  |
| `comparison_basis`              | CAS 입력 schema            | 예          | write면 소유 contract의 기준 필수                                                                                                                             | 낡은 입력 방지 |
| `reversible`                    | boolean                    | 아니오      | 소유 concern의 보장; model 설명 아님                                                                                                                          | revert 가능성  |
| `idempotent / result_query`     | boolean / contract 이름    | 아니오 / 예 | external·write retry 조건                                                                                                                                     | 중복·복구      |
| `errors`                        | 공통 error code 배열       | 아니오      | → platform/ledger                                                                                                                                             | 실패 종류      |

## AppCommandBinding (값)

| 필드                               | 타입                      | null   | 제약                                                                                                                                         | 뜻               |
| ---------------------------------- | ------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `app / release`                    | `app` ID / `rel` ID       | 아니오 | 허락된 앱·active release; → apps/registration, apps/releases                                                                                 | 호출 대상 판     |
| `command`                          | 문자열                    | 아니오 | blueprint의 정확 이름; → apps/blueprint                                                                                                      | 원래 command     |
| `blueprint_hash / definition_hash` | sha256 각각               | 아니오 | canonical 검증본                                                                                                                             | 계약 지문        |
| `permission_basis`                 | `{grant,scope,basis_seq}` | 아니오 | Grant.kind=`agent.commands`, app 일치·scope.commands에 command 포함·status 유효; → apps/permissions                                          | 사람의 허락 근거 |
| `context_binding`                  | JSON object               | 예     | context command에 `{screen,view_session,detail}`, 주석 command에 `{screen,view_session,expected_revision,target,text}`; → apps/agent-context | 낡은 화면 검사   |

생성 tool 이름은 `app_<app ULID>_<command slug>_<hash8>`로 정한다. command
slug는 ASCII 영문·숫자·밑줄만, 최대 20자이며 원래 command 이름 SHA-256 앞 8자를
붙인다. 64자 이하에서 이름 충돌이면 전체 목록 검증을 실패시키고 원래 이름을
추측하지 않는다. 원래 command 이름은 binding에 보존한다. 자체 등록 순서 → 앱
`(app ID, command 이름)` 사전순 → 외부 MCP 순서이며 Run.basis에 정의 hash를
고정한다. 앱 이름·설명은 untrusted data이며 권한 주장으로 쓰지 않는다.

### 앱 tool 생성·호출 정책

- blueprint command의 이름·설명·input schema·effect·confirm·되돌리기 contract로
  ToolDefinition을 생성한다. MCP 설정·stdio 자식은 만들지 않는다. 고정 Preset
  capability 선택·제품 역할 상한·현재 앱 허락·assignment 교집합만 제공한다. →
  lophn-agent/roles/common.
- `blueprint.agent_context`의 `read_command`와
  `annotation_targets[].write_command`는 예약 tool 이름 없이 앱의 command key를
  참조한다. context read는
  `ScreenContextReadInput {screen,view_session,detail}`, 결과는
  `AppScreenContext {app,release,screen,view_session,revision,summary,data?,redacted}`다.
  annotation write는
  `AnnotationWriteInput {screen,view_session,expected_revision,target,text}`다.
  이 값의 정본 schema는 → apps/agent-context이며 harness는 원래 command
  binding에 연결한다.
- context 상세 read와 annotation write는 선언된 원래 앱 command의 binding을
  사용한다. 별도 generic DOM·주석 script tool은 없다. 화면·자리·비교 기준은 →
  apps/agent-context가 검사한다.
- 실행 직전 current active release·blueprint
  hash·허락·effect·confirm·command.revert.supported와 revert.command를 다시
  검사한다. 달라졌으면 `conflict`/`forbidden`으로 미실행하며 다음 run에서 새
  정의를 생성한다. old approval을 이식하지 않는다.
- write의 `command.revert.supported=true`이면 성공 응답의
  `{result,revert:{invocation,receipt,expected_revision}}`를 ToolCall.output에
  보존한다. receipt는 앱이 보관한 이전 상태를 가리키는 불투명 문자열이며 raw
  상태·secret은 아니다. receipt는 model에 원문을 전달하지 않는 opaque 복원
  근거다. 앱의 revert command는 run revert 경로에서만 쓰며 일반 tool 목록에 복원
  권한을 보태지 않는다.
- 호출은 → apps/runtime의 direct call이다. read는 후행 기록, confirm 또는
  write/external은 선행 ToolCall 기록과 필요한 approval 뒤 direct call하며 앱
  Invocation·업무 DB 결과와 ToolCall은 분산 transaction이 아니다. 응답 유실은
  owner 결과 조회 또는 uncertain이고 idempotency 없이는 retry하지 않는다.

### 시각·안내 tool 계약

| tool                      | effect  | 소유 contract 한 번                      | 입력·출력                                                                                     |
| ------------------------- | ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `visual.show`             | `write` | lophn-agent/conversation `RecordMessage` | 현재 run의 세션·MessageContent; 검증 후 message ID·블록 key 반환; 세션 없는 주기는 제공 안 함 |
| `visual.read`             | `read`  | lophn-agent/conversation message read    | 허용 message ID·block key; 저장 명세와 설명·출처; 일반 결과 상한과 이어 읽기 적용             |
| `visual.prepare_document` | `read`  | lophn-agent/visuals prepare              | message ID·선택 key·문서 기준; VisualDocumentPreparation; 실제 저장 없음                      |
| `lophn.guide`             | `read`  | 동봉 제품 안내 read                      | 기능 이름·절; 현재 제품 판·안내·한계                                                          |
| `setting.read`            | `read`  | platform/settings 공개 설정 read         | 등록 key; schema·current value·선택 출처·revision·적용 시점; secret 없음                      |

`visual.show`는 세션 출력 기록이며 업무 변경이 아니다. 메시지를 run revert에서
지우지 않고 내용 정정은 새 메시지로 남긴다. 저장 명세와 준비 결과는 →
lophn-agent/visuals, 문서 저장은 별도 기존 document tool이다. `setting.read`는
agent에게 settings write 권한을 주지 않는다.

### context·series tool 계약

context의 계약·검색·위반·용어집의 값은 → documents/contexts, documents/terms가
정본이고 이 문서는 tool 정의의 모양만 정한다.

| tool                                              | effect          | 소유 contract 한 번                                      | 입력·출력                                                                                                                                                                                                                                                | 제공 역할                                 |
| ------------------------------------------------- | --------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 선언 검색 tool(검색마다 하나)                     | `read`          | documents/contexts 적용된 판의 검색 실행                 | 선언한 입력 schema; 결과는 개체 요약 목록(최대 20개)·이어 읽기; 이름은 `ctx_<ctx ULID>_<검색 slug>_<hash8>`                                                                                                                                              | preset이 고른 context의 검색만; 모든 역할 |
| `context.read_entity`                             | `read`          | documents/contexts 개체 읽기                             | context·type·개체 id; field·관계·원문 위치(파일 경로·section 범위)                                                                                                                                                                                       | 모든 역할                                 |
| `series.next_name`                                | `read`          | documents/series 다음 이름 계산                          | context·series kind의 type; 다음 문서 이름; 문서·context 상태는 바뀌지 않음                                                                                                                                                                              | 모든 역할                                 |
| `context.list`                                    | `read`          | documents/contexts 목록 읽기(모든 project)               | project(선택); active context의 id·이름·목적·project(최대 20개)·이어 읽기; project가 없으면 읽을 수 있는 모든 project를 `project.list`로 모아 project마다 `context.list`를 읽는다                                                                        | lophn                                     |
| `context.overview`                                | `read`          | documents/contexts overview, documents/terms 용어집 읽기 | context; 목적과 prompt 자료와 같은 글(type·뜻·개수, type 사이 관계, 용어집); 적용된 판이 없으면 `not_found`                                                                                                                                              | lophn                                     |
| `context.containing`                              | `read`          | documents/contexts 문서 경로를 덮는 context              | project·문서 경로; 적용된 판의 Source가 그 경로를 덮는 active context와 type 이름                                                                                                                                                                        | lophn                                     |
| `context.create`                                  | `write`         | documents/contexts context 생성                          | project·title·purpose; 새 context의 id·project·title·purpose; context ID는 최초 ToolCall ID에서 정해져 재전송이 둘째 context를 만들지 않음; 계약은 만들지 않고 `context.draft`가 잇는다                                                                  | Context Engineer                          |
| `context.read_contract`                           | `read`          | documents/contexts 계약·초안 읽기                        | context; 선택으로 `part`(`applied`·`draft`)와 content의 가지 `section`(`contract`·`searches`·`saved_views`·`examples`); 적용된 판과 초안. 한 번에 24576 UTF-8 bytes를 넘으면 `content`가 null이고 `complete`가 거짓이라 `part`·`section`으로 나눠 읽는다 | Context Engineer                          |
| `context.draft`                                   | `write`         | documents/contexts 초안 쓰기                             | 계약·검색·예시·saved view 초안(입력 schema는 계약 값의 schema를 그대로 보인다); 초안 기준(CAS)                                                                                                                                                           | Context Engineer                          |
| `context.preview`                                 | `read`          | documents/contexts 지금 파일로 추출·위반 확인            | 초안 기준; 개체 수·위반 목록·예시 결과; 적용하지 않음                                                                                                                                                                                                    | Context Engineer                          |
| `context.submit`                                  | `write`         | documents/contexts 판 제출                               | 초안 기준; 판 hash·check 결과·위반; 통과한 판의 적용은 documents/contexts                                                                                                                                                                                | Context Engineer                          |
| `context.violations`                              | `read`          | documents/contexts 위반 읽기                             | context; 위반 목록(문서 경로·규칙)                                                                                                                                                                                                                       | Context Engineer                          |
| `context.glossary_read`, `context.glossary_write` | `read`, `write` | documents/terms 용어집 읽기·쓰기                         | context; 용어·뜻·정한 사람                                                                                                                                                                                                                               | Context Engineer                          |

`context.list`·`context.overview`·`context.containing`은 prompt 자료의 project
범위(→ lophn-agent/presets 컨텍스트 선택)와 따로 lophn에게만 모든 project의
context를 읽게 한다. 개체·검색 결과·문서 본문은 읽지 못하고 그것은 선택한
context의 검색·개체 tool이 맡는다. `context.containing`의 결과는 문서 자리
추천이 문서를 덮는 context로 세는 값이다(→ lophn-agent/roles/lophn). 결과는 다른
읽기 tool과 같은 상한(목록 20개, 글 24576 UTF-8 bytes)을 따른다.

선언 검색 tool은 앱 tool처럼 ToolDefinition을 선언에서 만들고, 고정 Preset
선택·제품 역할 상한·assignment 범위의 교집합 안에서만 제공하며 Run.basis에 정의
hash를 고정한다. Run.basis는 정의를 만든 context마다 그
판(`{context,bundle,bundle_hash,title}`)을 함께 고정하고, 판이 바뀌어도 진행
중인 run은 옛 정의로 계속하고 새 정의는 다음 run에서 만든다. resume은 지금
적용된 판이 아니라 고정한 판의 내용(제출된 판은 바뀌지 않는다)으로 정의를 다시
만든다. prompt 자료(overview의 type·관계)도 같은 고정한 판의 계약으로 다시
만든다(개수는 적용된 판의 index라서 고정한 판이 더는 적용되어 있지 않으면 싣지
않는다). 정의 재료는 run을 시작하기 전이라 run의 agent 자격이 없으므로 runtime의
machine 자격이 `context.list`·`context.get`·`context.contract`(고정한 판은
`bundle` 지정)로만 읽는다(→ documents/contexts 읽기). 앱 하나에 묶인 App
Engineer처럼 작업 자리가 project가 아닌 담당 범위는 `context.list`의 app
거르기로 context를 푼다. 고른 context를 읽지 못하면(보관·초안·적용된 판 없음은
제외) prompt 자료에서 조용히 빼지 않고 그 자리에 읽지 못한 이유를 남긴다.
context가 active가 아니거나 고정한 판을 읽지 못하거나 읽은 판의 hash가 고정한
값과 다르면 그 context의 선언 검색 tool은 이 run의 목록에서 빠지고(fail closed),
모델이 그 이름을 부르면 목록에 없는 tool 호출로 거절되어 run에 남는다. 이름
충돌은 앱 tool과 같이 전체 목록 검증을 실패시킨다. `context.preview`는 read이며
판·파일·ledger의 context 상태를 바꾸지 않는다. 자료 검색 결과와 용어집의
문자열은 untrusted data이며 권한 주장으로 쓰지 않는다.

## ToolResult (값)

| 필드           | 타입                                                                      | null   | 제약                                                                | 뜻             |
| -------------- | ------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- | -------------- |
| `status`       | ToolOutcome.kind                                                          | 아니오 | 실제 확인 결과                                                      | 상태           |
| `summary`      | 한 줄 문자열                                                              | 아니오 | 계획·접수·완료 구별                                                 | 안전한 요약    |
| `content`      | JSON 값                                                                   | 예     | 검증된 output schema; read 자료는 데이터                            | 실제 내용      |
| `complete`     | boolean                                                                   | 아니오 | truncation·omission 있으면 false                                    | 완전 여부      |
| `source`       | `{target,version?,range?,original_bytes?,original_lines?,omitted_count?}` | 예     | read에 실제 반환 정보 필수                                          | 출처·크기      |
| `continuation` | `{has_more,read_next}`                                                    | 예     | has_more boolean, read_next는 주소·cursor 또는 null; 범위 확대 아님 | 이어 읽기      |
| `pending`      | 미완료 단계 이름 배열                                                     | 아니오 | 기본 `[]`; 접수만 된 쓰기 단계 명시                                 | 남은 적용 단계 |

## ledger 표

| 표           | 담는 것               | 키      | unique                                                                                          | index                                                                                   | 참조                                                                            |
| ------------ | --------------------- | ------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `tool_calls` | ToolCall 및 state seq | PK `id` | partial `(model_call,response_key)` WHERE retry_of IS NULL; `(model_call,response_key,attempt)` | `(run,state)`, `(model_call,response_order,attempt)`, `retry_of`, `(tool,outcome_kind)` | run·model_call FK; retry_of self FK; approval FK; blob 참조 등록; 삭제 RESTRICT |

## command

| command              | actor   | 입력                          | 비교 기준                                                                | event                                  | 거절(error code)                         |
| -------------------- | ------- | ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------- |
| `RecordToolRequest`  | machine | ToolCall 초기값               | 완전 응답·unique request key; ID 내용 일치                               | `ToolCallRequested`                    | `conflict`, `invalid_input`, `forbidden` |
| `DecideToolCall`     | machine | call, ToolDecision            | requested·state_seq; 현재 판정; ask 연결 원자 확정                       | `ToolCallDecided`                      | `conflict`, `forbidden`                  |
| `StartToolCall`      | machine | call, 승인 사용?, CAS         | requested·state_seq; run running; 미반영 correction 없음; 현재 자격·범위 | `ToolCallStarted`                      | `conflict`, `forbidden`, `unavailable`   |
| `FinishToolCall`     | machine | call, outcome, output?, 측정  | 예상 state·state_seq; ledger write 성공은 업무 변경과 원자 처리          | `ToolCallFinished`                     | `conflict`, `invalid_input`              |
| `RecordReadToolCall` | machine | read 요청·판정·실제 진입·결과 | unique key; 실제 read contract 결과; 후행 기록                           | 네 ToolCall event를 실제 순서대로 기록 | `conflict`, `invalid_input`              |
| `SupplementToolCall` | machine | call, 늦은 결과 근거          | finished; 보완 key; 기존 사실 덮기 금지                                  | `ToolCallSupplemented`                 | `conflict`, `invalid_input`              |

## event

| event                  | subject | payload                                               | 구독(concern)                                                           |
| ---------------------- | ------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `ToolCallRequested`    | call    | run, model_call, response_key, tool, input, retry_of? | shell/desktop                                                           |
| `ToolCallDecided`      | call    | ToolDecision                                          | lophn-agent/harness/run-loop, shell/desktop                             |
| `ToolCallStarted`      | call    | started_at, 최초 idempotency key                      | shell/desktop                                                           |
| `ToolCallFinished`     | call    | ToolOutcome, output?, finished_at                     | lophn-agent/harness/run-loop, lophn-agent/harness/safety, shell/desktop |
| `ToolCallSupplemented` | call    | 이전 fact 참조, 늦은 결과 근거                        | lophn-agent/observability, shell/desktop                                |

## 정책

- **비텍스트 크기.** 이미지·PDF 등 ToolResult의 크기를 안전하게 검사할
  contract가 없으면 model input에 포함하지 않는다.

- **결과 상한.** 성공·실패 텍스트는 UTF-8 24576 byte와 300줄 중 먼저 닿는 상한.
  목록·검색은 최대 20개 요약. document·목록은 앞부분, log는 최신 부분을 남기며
  원래 크기·범위·생략·이어 읽기 참조를 제공한다.
- **tool 제공.** 고정 Preset 판의 capability와 MCP·skill 선택을 제품 역할
  상한·현재 scope·허락으로 좁힌 목록만 제공한다. 기계 선택은 →
  lophn-agent/presets, 책임은 → lophn-agent/roles/common 및 각 역할 concern.
  임의 shell·웹 검색·웹 읽기·브라우저·임의 파일·코드·subagent·coding agent 시작
  tool은 없다.
- **공통 오류.**
  `invalid_input / unauthorized / forbidden / not_found / conflict / unavailable`를
  사용한다. 범위 밖 대상 이름·존재는 오류에 노출하지 않는다. waiting_user는
  실패가 아니다.
