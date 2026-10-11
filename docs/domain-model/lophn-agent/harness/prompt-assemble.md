---
type: domain-model
concerns: [lophn-agent/harness/prompt-assemble]
---
# lophn-agent/harness/prompt-assemble

Prompt의 조립 층·근거·크기 계산과 사람이 부른 Compact·자동 압축 summary의 derived 값을 정의한다.

## PromptAssembly (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `rule_version` | 비어 있지 않은 문자열 | 아니오 | 같은 재료·판은 같은 바이트 출력 | 조립 규칙 판 |
| `layers` | PromptLayer 배열 | 아니오 | 아래 순서 고정; 공통·역할 필수 | 입력 층 |
| `basis` | ContextBasis | 아니오 | 실제 포함·생략 전체 기록 | 선택 근거 |
| `cache_boundaries` | 구조 위치 배열 | 아니오 | 최대 3개; 자료 문자열에서 추출 금지 | cache 위치 |
| `input_budget` | 양의 정수 token | 아니오 | min(input_limit, context_limit − reserved_output) | 입력 상한 |
| `reserved_output` | 양의 정수 token | 아니오 | output_limit 이하 | 출력 여유 |
| `measured_tokens` | 0 이상 정수 token | 아니오 | tool 정의·포장·매체 포함; budget 이하 | 실제 크기 또는 검증된 상한 |
| `count_method` | 검증된 계산법 이름·판 | 아니오 | 판정 불가면 call 금지 | 크기 계산 근거 |

## PromptLayer (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | 아래 층 이름 | 아니오 | 순서 고정 | 층 |
| `content` | 구조화 입력 값 | 아니오 | 출처 유형 유지; → lophn-agent/harness/safety | 전송 재료 |
| `hash` | sha256 | 아니오 | 동일 판 고정 prefix 불변 | 층 해시 |

| 순서 | kind | 포함 |
|---|---|---|
| 1 | `product` | 제품 공통 지시+고정 tool 정의; 실제 허용 schema만 |
| 2 | `role_agent` | 제품 역할 지시; resolved agent의 켜진 skill 이름·설명만 |
| 3 | `user_instructions` | global→project→app→agent instructions; 작업 자리로 resolve한 확정 판 |
| cache 경계 | — | 1·2·3 끝 최대 3개; 사람 지침 뒤가 안정 prefix 끝 |
| 4 | `work_material` | 목적·scope·run 사실·허용 outline/주소/고정 자료·Compact/압축 summary·세션/model/tool 이력·이번 request와 미반영 corrections; 이력 순서·call/result 쌍 유지 |
| 5 | `turn_context` | 이력 뒤 맨 마지막 최신 메시지에 붙이는 현재 시각·허용 탭·초점·앱 화면 짧은 요약 |

순서 5는 앞의 이력 사이에 끼우거나 user_instructions 앞에 넣지 않는다. 이번 turn에 새 실제 사람 메시지가 없으면 machine이 수집한 data 메시지를 최신 위치에 붙이며 사람 발언 Message를 만들어 저장하지 않는다. organizing은 최신 화면을 수집하지 않고 같은 제품·역할·사람 지침 뒤 지정 원문만 넣는다.

## ContextBasis (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `agent_hash / assignment_revision` | sha256 / 양의 정수 | 아니오 | Run call이면 RunBasis.agent.hash·assignment.revision과 일치; Compact 요약 call은 부른 시점에 resolve한 agent의 hash; → lophn-agent/harness/run-loop | 지시·scope 판 |
| `assignment_seq / tools_revision` | seq / 판 문자열 | 아니오 | Run call이면 RunBasis.assignment.basis_seq 및 tools.revision과 일치; Compact 요약은 이번 준비의 고정 선택 근거 | scope·tool 근거 |
| `extension_revision` | 양의 정수 | 아니오 | Run call이면 RunBasis.extensions.settings_revision과 일치; Compact 요약은 이번 준비의 설정 snapshot; → lophn-agent/extensions | 공급 확장 설정 판 |
| `work_place / work_place_revision` | WorkPlace / 양의 정수 | 아니오 | 세션의 고정 자리·자리 revision 또는 세션 없는 run의 Assignment scope·Assignment.revision; → lophn-agent/conversation | 지침 선택 근거 |
| `instructions` | InstructionLayer[] | 아니오 | 이번 call의 순서·확정 version·hash·부재; → lophn-agent/instructions | 사람 지침 근거 |
| `references` | `{target, section?, returned_range?}` 배열 | 아니오 | 실제 포함 자료만; target은 파일 경로 또는 개체 참조; → documents/outline-and-search, documents/contexts | 자료 근거 |
| `context_materials` | `{context, bundle_hash, counts_at, omitted?}` 배열 | 아니오 | resolved agent의 context마다 하나; `bundle_hash`는 run 시작 때 고정한 판; `counts_at`은 run 시작 때 센 시각; → documents/contexts | context 자료 근거 |
| `message_ranges` | `{session, from_seq, through_seq}` 배열 | 아니오 | 요약 대상 세션; 원래 순서·구간 보존 | 원문 구간 |
| `summaries` | SummaryRef 배열 | 아니오 | 완성 summary만; 기본 `[]` | summary 근거 |
| `omissions` | `{source, range?, reason}` 배열 | 아니오 | 기본 `[]`; scope 밖 이름 노출 금지 | 생략 |
| `rule_version / layer_hashes` | 문자열 / sha256 배열 | 아니오 | 실제 조립 판·순서 | 재현 기준 |
| `turn_context` | TurnContext | 예 | judgment에 필수; organizing에는 null | 실제 현재 화면 근거 |
| `size` | `{input_budget,reserved_output,measured_tokens,count_method}` | 아니오 | PromptAssembly와 일치 | 크기 기록 |

## TurnContext (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `collected_at` | 시각 | 아니오 | 매 judgment turn 직전 새 UTC 시각 | 수집 시각 |
| `timezone` | IANA timezone 문자열 | 예 | 사람이 설정한 timezone; 미상은 null | 사람의 시간대 |
| `workspace_revision` | 불투명 판 | 예 | → shell/workspace; 없으면 null | 탭 snapshot 판 |
| `tabs` | 허용 탭 요약 배열 | 아니오 | 최대 20개; focused 우선, 나머지 화면 순서; 범위 밖 제목·주소 제외 | 현재 열린 탭 |
| `focused_tab` | 탭 참조 | 예 | 반환 tabs 중 하나 | 지금 보는 대상 |
| `app_screen` | `{app,release,screen,view_session,revision,observed_at,summary,redacted}` | 예 | 초점 앱의 AppScreenContext summary만; data 제외·redaction·범위 검사; → apps/agent-context | 현재 화면 요약 |
| `omitted_count` | 0 이상 정수 | 아니오 | 미포함 탭 수; 제목·대상 누출 없음 | 생략 |
| `unavailable` | 안전한 코드 배열 | 아니오 | 기본 []; `no_workspace / app_unavailable / redacted / scope_excluded` | 부재·제외 |

tab은 shell/workspace의 opaque 참조·kind·허용된 title·문서 고정 version 또는 앱 참조·focused만 포함한다. 상세 화면·선택 본문은 자동 수집하지 않고 허용 앱 command tool로 읽는다. opened tab이 앱 사용 허락을 만들지 않는다.

- 직렬화·data 포장까지 총 8192 UTF-8 bytes, app summary 2048 UTF-8 bytes다. 줄이는 순서는 non-focused 탭 끝 → 앱 summary이며 범위·생략 수를 남긴다. JSON·Unicode·문장을 깨뜨려 자르지 않고 최소 안전 요약 또는 부재를 쓴다.
- session 없는 run·shell 부재는 tabs=[], focused_tab=null, app_screen=null이다. 옛 context를 현재 사실로 재사용하지 않는다. observed_at은 앱 수집 시각이고 collected_at과 구별한다.
- machine이 수집한 시각·판만 확인 사실이며 title·앱 summary는 data 포장·redaction을 거친다. provider system/developer 역할이 어떤 것이든 데이터가 시스템 지시로 승격되지 않는다.
- organizing call은 새로운 화면 수집 없이 지정한 원문 구간을 요약한다. judgment의 실제 TurnContext는 ModelCall.context_basis에 저장하고 재현 때 다시 live read하지 않는다.

## SummaryRef (값)

독립 Summary entity·ID가 없는 derived 값이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `compact / compaction` | 아니오 | `compact`는 사람이 부른 Compact, `compaction`은 자동 압축 | summary 종류 |
| `session` | `ses` ID | 예 | compact에 필수; → lophn-agent/conversation | 원문 세션 |
| `run` | `run` ID | 예 | compaction에 필수; 같은 run에서만 재사용 | 적용 run |
| `from_seq / through_seq` | seq 각각 | 아니오 | from ≤ through; 실제 포함한 완료 구간 | 원문 범위 |
| `summary_call` | `mcl` ID | 아니오 | organizing·conversation_compression 완전 성공; → lophn-agent/harness/usage | 실제 요약 call |
| `body_hash` | sha256 | 아니오 | 완전 출력 blob; 원문 대체 저장 아님 | 본문 |
| `rule_version` | 문자열 | 아니오 | 비어 있지 않음 | summary 규칙 판 |
| `references` | 고정 자료 참조 배열 | 아니오 | 읽은 version 포함; 낡음·확인 불가 표시 | 근거 |
| `parts` | 여섯 부분 값 | 아니오 | 목적, 사람 결정·제약, 확인 진행·근거, 미완료, 실패·다음 행동, 추정·불확실성 | 출처 구분 구조 |

## CompactionResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `state` | `completed / failed` | 아니오 | 완료 조건 아래 정책 | 결과 |
| `ranges` | seq 구간 배열 | 아니오 | tool call·result 짝 분리 금지; 구간 누락 금지 | 처리 범위 |
| `calls` | `mcl` ID 배열 | 아니오 | chunk·merge 시도 모두 포함 | 비용·usage 근거 |
| `summary` | SummaryRef | 예 | completed에 필수; failed에 null | 새 summary |
| `reason` | 안전한 코드 | 예 | failed에 필수 | 실패 이유 |

## 정책

- **불투명 추론 상태.** 사람이 읽는 추론 본문은 조립 재료가 아니다. provider가 요구하는 signature·encrypted reasoning item은 구조화 prompt·ContextBasis·저장 input blob 밖의 전송 adapter 메모리 상태이며 같은 run·provider·model의 연속 요청에만 원형대로 붙인다. 세션·summary·다른 run으로 저장·전달하지 않는다. 크기 검사는 이 상태를 포함한 실제 전송 크기를 검증한다. → lophn-agent/harness/provider.
- **저장.** 조립·summary 캐시는 ledger 밖 derived store다. 독립 command·event·ledger 표를 만들지 않는다. 실제 입력과 ContextBasis는 → lophn-agent/harness/usage의 input·context_basis blob에 남긴다. summary 실패 시도도 ModelCall로 기록한다.
- **고정 prefix.** 제품·역할과 resolved agent(skill·tool·model)는 Run 시작 판이며 LOPHN.md 층과 agent instructions는 call 직전 현재 확정 판이다(→ lophn-agent/instructions). 세션의 작업 자리는 열 때 고정이다. 한 call 안에서는 모두 snapshot하고 현재 scope 회수·멈춤은 매 call 검사한다. 지침 편집은 다음 call의 prefix부터 반영한다.
- **초기 자료.** context마다 머리(이름·id)와 overview(type·뜻·type 사이 관계·type별 개수)와 용어집만 넣는다. 검색 결과·개체 목록·본문·관점 표시·변경 표시는 없다. 같은 `bundle_hash`와 `counts_at`이면 byte가 같고 run 안에서 바뀌지 않는다. 계약·용어집 값은 → documents/contexts, documents/terms.
- **중복.** 같은 context를 여러 선택이 가리켜도 한 번만 넣고 tool 이력 본문을 초기 자료에 복제하지 않는다.
- **cache 경계.** product 끝·role_agent 끝·user_instructions 끝의 최대 3개다. work_material 이력은 append-only prefix로 유지하고 turn_context는 최신 메시지 끝에만 붙인다. 지침 변경은 prefix를 바꾸지만 탭·시각 변경만으로 기존 이력을 재직렬화하지 않는다. 단발 압축은 새 명시 cache가 없고 protocol 번역은 provider다.
- **크기.** cache hit도 context 점유를 줄이지 않는다. 정확 token 계산 또는 검증된 보수 상한을 사용하고 매체 크기 판정 불가면 call하지 않는다. model 한계는 → lophn-agent/harness/model.
- **compaction 시작·목표.** 전체 요청이 budget의 70% 이상이면 시작하며 50% 이하가 목표다. 최근 이력은 budget의 25%를 2000~15000 token으로 clamp하여 보존하고 call·result 짝 경계 초과를 허용하되 입력 한계는 넘지 않는다.
- **보호.** 공통·역할·사람 지침(agent instructions 포함), 현재 목적, 최신 사람 request 전문, 유효 결정, 필수 근거는 자르지 않는다.
- **결정적 축소.** 보호 밖 오래된 text tool result가 2000 Unicode code point를 넘고 원문 재조회 길이 있으면 앞 1000·뒤 1000과 별도 생략 표시·재조회 참조를 남긴다. 원본은 바꾸지 않는다.
- **summary call.** 축소 후에도 목표 초과면 Workspace의 Model for summaries(비면 agent model)로 완료된 오래된 구간을 요약한다. 출력 상한은 min(budget의 10%,4000 token). 재료가 organizing 입력 budget 절반을 넘으면 짝을 지켜 절반 이하 chunk로 요약·병합하며 단일 짝도 못 넣으면 실패다.
- **완료 조건.** 비어 있지 않은 완전 응답, 여섯 부분·모든 범위·보호 전문 유지, 재조립 크기 감소, 50% 목표 이하를 모두 만족해야 한다. 별도 재검토 model call은 추가하지 않는다.
- **실패.** 원문 유지 및 실패 표시; 같은 구간 자동 summary 반복 금지. 원문이 한계 안이면 진행, 밖이면 불완전 prompt로 call하지 않는다.
- **초기 자료 축소.** 용어집 → overview 순으로 뒤에서부터 축소하며 context 이름·id·type 이름은 남긴다. 생략을 기록한다. 보호 입력만으로 한계 초과면 call 금지다.
- **Compact.** 사람이 부른 같은 세션의 앞 구간만 요약하고(`CompactSession` → lophn-agent/conversation) 최신 완성 summary 하나와 그 구간 뒤 원문을 이후 call에 넣는다. 닫기·화면 닫기 때 model call을 강제하지 않는다. `SessionCompacted`로 최신 summary를 바꾸고 `SessionClosed`로 그 세션의 summary 캐시를 비운다. 캐시 유실은 기존 완성 call 조회 또는 새 organizing call로 처리하며 같은 문장 재생을 보장하지 않는다.
- **재사용 범위.** compaction은 같은 run에만, compact는 그 세션의 이후 call에만 사용한다. 다른 세션·Fork한 세션·handoff에 이전 세션을 자동 주입하지 않는다. 장기 기억은 없다.
- **skill.** skill·MCP 고르기는 → lophn-agent/agents, 발견·읽기·서버 설정은 → lophn-agent/extensions. 선택은 RunBasis.agent의 resolved agent로 고정한다. 본문은 선택해 읽은 tool 이력에만 넣으며 압축으로 없어지면 다시 읽는 길을 남긴다.
