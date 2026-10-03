---
type: domain-model
concerns: [lophn-agent/evaluation]
---
# lophn-agent/evaluation

개발용 eval fixture·고정 조건·시행 결과·내용 판정 값을 정의한다.

## EvalFixture (값)

제품 ledger entity가 아닌 versioned 개발 자료다. 제품의 Role·Run·Message를 재정의하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | 비어 있지 않은 문자열 | 아니오 | suite 안 unique | 사례 이름 |
| `version` | content hash 또는 version 문자열 | 아니오 | 시작 전 고정 | fixture 판 |
| `suite` | `regression / capability` | 아니오 | user 채택·이동만 | 사례 묶음 |
| `initial_materials` | 고정 자료 참조·복사본 manifest | 아니오 | 문서·앱·세션 및 version 빠짐 금지 | 초기 자료 |
| `intent` | 비어 있지 않은 문자열 | 아니오 | 비밀 없는 최소 입력 | 요청 |
| `role / tools / permissions` | 고정 정의·목록·정책 snapshot | 아니오 | 제품 contract 및 판 고정; → lophn-agent/role-definition, lophn-agent/harness/tools, lophn-agent/harness/tool-judgment | 평가 조건 |
| `human_answers` | 질문·approval 조건→명시 답 map | 아니오 | fixture 값만 사용; 기본 `{}` | 모의 사람 결정 |
| `expected` | 검사 predicate 배열 | 아니오 | 비어 있지 않음; 실제 산출물·상태 기준 | 필수 결과 |
| `forbidden_changes` | 검사 predicate 배열 | 아니오 | 부작용 항목 명시; 기본 `[]` | 금지 변경 |
| `mode` | `real_model` | 아니오 | 결정적 model 없는 test는 해당 concern의 테스트 | 시행 방식 |
| `timeout_ms` | 정수 ms | 아니오 | 기본 600000; 1000~3600000; 시작 전 고정 | 상한 |
| `judging_rules` | ContentJudgingRule 배열 | 아니오 | 필요 축·질문·경계 명시 | 판정 기준 |

## EvalSnapshot (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `fixture_versions / initial_material_hashes` | 참조 배열 각각 | 아니오 | 시작 snapshot 불변 | 자료 조건 |
| `product_version` | 비어 있지 않은 문자열 | 아니오 | 실제 빌드 판 | 제품 |
| `role_prompt_skill_tool_permission_versions` | 이름→판 map | 아니오 | 전부 실제 적용 판 | harness 조건 |
| `provider / model / sampling` | 정의 참조 / 이름 / JSON object | 아니오 | 실제 model 명시; 운영 credential 복제 금지 | 대상 model |
| `judging_model / judging_rule_versions` | model 선택 / 판 배열 | 예 / 아니오 | 내용 판단 필요면 calibrated model 필수 | 판정 조건 |
| `repetitions` | 양의 정수 | 아니오 | regression 3, capability 5 | 반복 |
| `workspace` | 격리 fixture 폴더·DB 참조 | 아니오 | 매 시행 fresh copy; 운영 자료·credential·MCP와 분리 | 시행 환경 |

## EvalTrialResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `fixture / fixture_version / repetition` | 이름 / 판 / 양의 정수 | 아니오 | `(suite_snapshot,fixture,repetition)` unique | 시행 key |
| `snapshot` | EvalSnapshot | 아니오 | 시작 조건 불변 | 조건 |
| `state` | `prepared / running / finished` | 아니오 | 아래 전이 | 시행 상태 |
| `outcome` | `satisfied / unsatisfied / evaluation_error / insufficient_evidence` | 예 | finished에 필수 | 품질·평가 장애 구별 |
| `actual` | 실제 산출물·상태·금지 변경 검사 결과 | 예 | finished에 확인된 범위 및 부재 명시 | 결과 |
| `reason` | 안전한 코드·설명 | 예 | 실패·오류·부족에 필수 | 근거 |
| `trace_refs` | 원본 run·call·event 참조 배열 | 아니오 | 격리 eval 환경 원본만; → lophn-agent/observability | 관측 연결 |
| `comparison_counts` | call·tool·error·같은 인자 재요청·truncation 수 | 아니오 | 비교용만; 통과 기준 아님 | 보조 수치 |

### 상태

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | prepared | 개발용 runner | fixture 중복·자료·기준·반복·시간 검증 | 없음; 개발용 result |
| prepared | running | 개발용 runner | fresh 격리 복사본 및 snapshot 고정; user 명시 지시 | 없음; 개발용 result |
| prepared/running | finished | 개발용 runner | 준비 오류 또는 실제 시행·판정 종료; 최초 결과 보존 | 없음; 개발용 result |

## ContentJudgingRule (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `axis` | `readability / evidence_fidelity` | 아니오 | 두 축만 | 이해하기 쉬움·근거 충실함 |
| `version` | 문자열 또는 hash | 아니오 | 시작 전 고정 | 기준 판 |
| `question / satisfied_boundary / unsatisfied_boundary` | 비어 있지 않은 문자열 각각 | 아니오 | 사람 채택; 사례의 기대를 낮추지 않음 | 판단 경계 |
| `answer` | `satisfy / unsatisfy / undecidable` | 예 | 세 값 이외 답은 최대 1회 재질문 | 실제 내용 판정 |

## ContentJudgeCalibration (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `model` | 명시 provider·model 선택 | 아니오 | 평가 대상 model과 다름 | 내용 판정 model |
| `axis / rule_version` | 축 / 판 | 아니오 | 축별 별도 보정 | 기준 |
| `state` | `uncalibrated / collecting / calibrated / invalidated` | 아니오 | 아래 정책 | 통과 근거 사용 가능 여부 |
| `human_samples` | 사람 확정 답 30개 | 아니오 | 보정 완료에는 정확 30개 | 보정 자료 |
| `matches` | 0~30 정수 | 아니오 | 24 이상이어야 calibrated | 일치 |
| `suites_since_review` | 0 이상 정수 | 아니오 | 실제 eval suite만 | 재확인 주기 |
| `review_matches` | 0~5 정수 | 예 | 10 suite마다 최근 5개 재확인 | 보정 유지 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| uncalibrated/invalidated | collecting | 개발용 runner·user | 새 model·기준 또는 재보정; 사람 답 수집 | 없음 |
| collecting | calibrated | 개발용 runner | 30개 중 24개 이상 일치 | 없음 |
| calibrated | invalidated | user·개발용 runner | 10 suite마다 최근 5개 중 2개 이상 불일치 또는 model·기준 변경 | 없음 |

## EvalSuiteResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `snapshot` | EvalSnapshot | 아니오 | 변경 불가 | 조건 |
| `planned / satisfied / unsatisfied / errors / insufficient / missing` | 0 이상 정수 각각 | 아니오 | 서로 겹치지 않음; 합계 planned | 시행 집계 |
| `pass_rate` | 0~1 십진수 문자열 | 예 | errors·insufficient·missing이 모두 0일 때만 | 전체 비율 |
| `passed` | boolean | 예 | regression은 모든 시행 satisfied; 불완전이면 null | 전체 통과 |

## 정책

- **저장 경계.** fixture·기준·snapshot·결과는 개발 도구의 versioned 파일·격리 DB이며 제품 ledger 표·command·event·domain ID를 추가하지 않는다. 제품 UI·자동 스케줄 기능이 아니다.
- **접수 gate.** 이름 중복·시작 자료·기준 누락·0 이하 반복·시간·잘못된 반복 수는 model 없이 evaluation_error다. 평가 대상 agent는 fixture·기준을 변경하지 못한다.
- **시행 독립.** 매 시행 fresh fixture 복사본이다. 운영 데이터·운영 credential·운영 MCP·전 시행 세션·변경·prompt·approval은 읽거나 이어받지 않는다. 외부 MCP는 가짜 eval 서버이며 분류·tool 판정은 제품 규칙 그대로다. 사람 답은 fixture만 사용한다.
- **판정 순서.** 준비 자료 → 출력 format → 실제 결과·금지 변경 → 필요한 내용 판단. agent의 성공 문장·세션 전문 문자열 일치·정확 tool 순서는 통과 기준이 아니다. agent 인자·산출물 format 오류는 unsatisfied, fixture·판정기 결함·예상 밖 provider 장애·중단·재생 오류는 evaluation_error다.
- **내용 판단.** 결과 문서 및 근거 문서만 준다. 전체 세션·시스템 지시·tool 경로는 보내지 않는다. 축별 satisfy·unsatisfy·undecidable만; 두 번째 invalid 답·근거 부재·미보정 model은 insufficient_evidence다.
- **보정.** 새 model·기준은 축마다 사람 확정 30개 중 24개 이상 일치 전 통과 근거로 사용하지 않는다. 실제 suite 10회마다 최근 5개 재확인에서 2개 이상 다르면 무효화하고 30개 재보정한다.
- **반복.** regression 3회, capability 5회. regression은 모든 사례·모든 시행이 만족해야 통과한다. capability는 최근 3 suite에서 매번 5회 모두 통과했을 때만 사람에게 regression 이동 후보로 제공한다.
- **최초 결과.** 장애를 통과로 만들거나 성공할 때까지 재시행하여 첫 실패·오류를 지우지 않는다. 오류·부족·누락 하나라도 있으면 전체 비율·전후 차이를 숫자로 내지 않는다.
- **전후 비교.** 조건 하나만 변경하고 같은 fixture·자료·반복·기준을 별도 fresh workspace에서 실제 model로 시행한다. 홀수 반복은 전 먼저, 짝수는 후 먼저다.
- **공통 fixture.** 이름 같은 문서 2개·이미 적용된 변경·후보 2개·대소문자 검색·접힌 section·잘린 output·문서 2개 일·scope 밖 변경·큰 문서의 9가지 함정에 필수·금지 결과를 각각 둔다. 권한 거절·approval 대기 취소·응답 중 취소·steering·MCP injection은 별도 regression이다. subagent 사례는 없다.
- **변경 검증.** prompt·model·role·skill·tool·권한·조립 변경은 user 지시의 실제 model regression 근거를 요구한다. 결과 없음·실패·불완전은 품질 유지 증거가 아니다. 운영 실패·거절은 user가 비밀 없는 최소 사례로 채택한 뒤 capability에 넣는다.

## 정할 것

- 개발용 eval 결과·격리 workspace 보존 기간 및 파일 schema version. 제품 trace 보존과 독립적으로 정한다.
