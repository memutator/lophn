---
type: domain-model
concerns: [apps/blueprint]
---
# apps/blueprint

release에 고정하는 blueprint와 선언 값의 정규형을 정의한다.

## Blueprint (값)

독립 ID·상태·event는 없다. 큰 정규 JSON은 blob이며 release가 해시로 참조한다(→ apps/releases, platform/blob-store).

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | 문자열 | 아니오 | 빈 문자열 금지 | 앱 이름 |
| `description` | 문자열 | 아니오 | 빈 문자열·줄바꿈 금지 | 한 줄 설명 |
| `screens` | ScreenDeclaration[] | 아니오 | 빈 목록 허용; key unique | 화면 목록 |
| `commands` | CommandDeclaration[] | 아니오 | key unique; 실제 handler 목록과 일치 | 명령 목록 |
| `automatic_tasks` | AutomationDeclaration[] | 아니오 | 빈 목록 허용; key unique | automation 목록; 실행 정책 → apps/automations |
| `permissions` | PermissionRequirement[] | 아니오 | 빈 목록 허용; `(kind,정규 scope)` 중복 금지 | 요구 목록; 부여 → apps/permissions |
| `problem_codes` | 값 목록 | 아니오 | 필수 code와 항목 구조·이름 unique → problems/problem-codes | problem code 자리 |
| `documents` | DocumentDeclaration[] | 아니오 | 빈 목록 허용; key unique | 앱 문서 선언 |
| `agent_context` | AgentContextDeclaration[] | 아니오 | 빈 목록 허용; 구조 → apps/agent-context | 화면 context와 주석 자리 |
| `app_connections` | AppCommandUseDeclaration[] | 아니오 | 빈 목록 허용; 구조 → apps/connections | 쓸 다른 앱 command |
| `sdk_dependencies` | SDKDependency[] | 아니오 | name unique | 고정 SDK 의존 |

## ScreenDeclaration (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | 문자열 | 아니오 | 빈 문자열 금지; 목록 안 unique | 앱 안 화면 이름 |
| `label` | 문자열 | 아니오 | 빈 문자열 금지 | 화면 이름 |
| `path` | 문자열 | 아니오 | `/`로 시작하는 앱 내부 경로; scheme·authority·`..` 금지 | 묶음 안 진입 경로 |
| `sizes` | (`full` / `panel` / `card`)[] | 아니오 | 비어 있지 않음; 중복 금지; 해당 크기의 반응형 화면 테스트 | 지원 크기 |

## CommandDeclaration (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | 문자열 | 아니오 | 빈 문자열 금지; 목록 안 unique | handler 이름 |
| `label` | 문자열 | 아니오 | 빈 문자열 금지 | 명령 이름 |
| `description` | 문자열 | 아니오 | 빈 문자열 금지; 목적·입력 뜻·결과·부작용 설명 | tool에도 쓰는 명령 설명 |
| `effect` | `read` / `write` / `external` | 아니오 | 복합 효과는 `external > write > read`; 가져오기만 하는 바깥 요청은 external이 아님 | 업무 효과 |
| `confirm` | boolean | 아니오 | effect와 독립; secret 사용과 무관 | 호출 하나의 사람 확인 |
| `input` | InputSchema | 예 | 없음은 입력 없는 명령; schema 외 입력 거절 | 입력 검사 형태 |
| `revert` | CommandRevertDeclaration | 아니오 | effect=read/external은 supported=false; write만 true 허용 | 되돌림 지원 |

- `read`는 앱 업무 데이터와 앱 밖의 상태를 바꾸지 않는다. 바깥에서 가져오는 요청과 grant된 secret 사용은 할 수 있다. 플랫폼 report·invocation 기록은 업무 쓰기가 아니다.
- `external`은 앱 밖의 상태를 바꾼다(보내기·결제·외부 생성/변경/삭제). 가져와 업무 데이터에 저장만 하면 `write`다. 어느 effect든 바깥 요청은 network grant의 host로만 간다.
- `write`는 앱 업무 데이터 변경이다. `external` 자체는 앱의 confirm을 뜻하지 않지만 agent의 ask 판정은 → lophn-agent/harness/tool-judgment다. 선행 approval 접수는 `confirm=true`에 적용한다(→ apps/invocations).
- 앱 데이터·secret 원값·handler 코드·별도 Query 선언은 blueprint에 넣지 않는다.

## CommandRevertDeclaration (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `supported` | boolean | 아니오 | 기본값 없이 명시; read/external은 false | 앱 업무 되돌림 지원 |
| `command` | 문자열 | 예 | supported=true일 때 필수; 같은 blueprint의 다른 write command; supported=false면 부재 | 되돌림 handler |

- 지원 write의 성공 결과는 `{result,revert:{invocation,receipt,expected_revision}}`를 포함한다. `receipt`는 앱 DB에 보관한 변경 전 상태를 가리키는 불투명 문자열이며 secret·상태 원문을 담지 않는다. 앱은 invocation에 결속한 receipt와 현재 revision을 검사한다.
- 되돌림 handler의 InputSchema는 `{invocation,receipt,expected_revision}`를 포함한다. 재호출은 새 변경 없이 같은 결과를 반환하고 후속 업무 변경과 충돌하면 conflict다. receipt를 못 만드는 성공을 reversible 성공으로 응답하지 않는다.
- app test는 변경→되돌림→업무 상태 일치·후속 변경 충돌·중복 되돌림을 검사한다. 지원 선언만으로 실제 안전을 증명하지 않는다. run 전체의 되돌림 조립과 결과는 → lophn-agent/revert다.

## InputSchema (값)

의존성 없는 JSON Schema 부분집합이다. schema 자체의 unknown keyword·외부 참조는 거절한다. 아래 선택 필드의 null은 JSON null이 아니라 필드 부재를 뜻한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `type` | `object` / `array` / `string` / `integer` / `number` / `boolean` / `null` | 아니오 | 노드마다 한 타입 | JSON 값 타입 |
| `description` | 문자열 | 예 | JSON 문자열 | 입력 설명 |
| `enum` | JSON 값[] | 예 | 비어 있지 않음; 해당 type과 일치; 중복 금지 | 허용 값 |
| `default` | JSON 값 | 예 | 자신의 schema 통과; `type=null`의 null 기본값 허용 | 검사 전에 채울 값 |
| `properties` | map<string, InputSchema> | 예 | object에만; key unique | object 필드 |
| `required` | 문자열[] | 예 | object에만; properties의 key; 중복 금지 | 필수 필드 |
| `additionalProperties` | boolean | 예 | object에만; 정규형은 `false` | 미선언 필드 금지 |
| `items` | InputSchema | 예 | array에 필수; tuple schema 금지 | 배열 원소 |
| `minItems`, `maxItems` | 0 이상 정수 | 예 | array에만; min ≤ max | 배열 길이 |
| `minLength`, `maxLength` | 0 이상 정수 | 예 | string에만; min ≤ max | 문자열 길이 |
| `minimum`, `maximum` | 유한 number | 예 | integer/number에만; min ≤ max | 수 범위 |

- `$ref`, `oneOf`, 실행 코드·원격 schema·사용자 정의 format은 지원하지 않는다. 줄임 작성형을 받더라도 release에는 이 정규 schema만 둔다.
- default를 채운 입력의 정규 JSON을 한 규칙으로 hash하여 approval과 실제 호출에 함께 쓴다. approval의 입력 결속 → platform/approvals, byte/hash 공통 규칙 → platform/ledger.

## PermissionRequirement (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | permission 종류 | 아니오 | `fs.read`, `fs.write`, `net.fetch`, `net.listen`, `secret.use`, `document.save`; app.call 요구는 app_connections, agent.commands 상한은 commands | 요구 종류 |
| `scope` | PermissionScope | 아니오 | kind별 구조·제약 → apps/permissions | 요구 범위 |
| `reason` | 문자열 | 아니오 | 빈 문자열 금지 | approval 화면에 표시할 선언 설명 |

secret 선언 자리는 `permissions`의 `{kind:"secret.use",scope:{name},reason}`이다. 별도 secret entity·값·secret 해시를 blueprint에 두지 않는다. 이름 문법은 → platform/secrets, 사용 범위는 → apps/permissions.

## AutomationDeclaration (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | 문자열 | 아니오 | 빈 문자열 금지; 목록 안 unique | automation 이름 |
| `label` | 문자열 | 아니오 | 빈 문자열 금지 | 화면 이름 |
| `when` | `{kind:"on_start"}` / `{kind:"interval",interval_ms:integer}` | 아니오 | interval_ms ≥ 60000; 다른 필드 금지 | 계기 |
| `command` | 문자열 | 아니오 | 같은 blueprint commands.key; confirm=false; external도 허용 | 같은 handler 참조 |
| `input` | JSON 값 | 예 | 명령 schema 통과; default를 채운 고정 입력; 입력 없는 명령이면 부재 | 반복 입력 |

external automation의 켜기 approval과 command·입력·주기 결속은 → apps/automations#R13, apps/permissions가 맡는다. 선언 검증은 grant를 주지 않는다.

## DocumentDeclaration (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | 문자열 | 아니오 | 빈 문자열 금지; 목록 안 unique | 같은 문서의 식별 이름 |
| `name` | 문자열 | 아니오 | 빈 문자열 금지 | 문서 이름 |
| `description` | 문자열 | 아니오 | 빈 문자열 금지 | 문서 설명 |
| `format` | format 참조 값 | 아니오 | → documents/formats | 저장 계약 |
| `document` | `doc` ID | 예 | → documents/versions; 자기 앱 place의 문서 | 이미 존재하는 문서 |

`document`가 없으면 첫 저장에 자기 앱 place의 문서를 만들고 `(app,key)`로 이어 찾는다. 이 대응의 정본은 → documents/versions. 선언과 `document.save` grant가 모두 필요하다.

## SDKDependency (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | 문자열 | 아니오 | → apps/sdk의 Package.name | 공개 패키지 이름 |
| `version` | 정확한 버전 문자열 | 아니오 | 범위·latest 금지; 공개 버전 존재 | 고정 버전 |

## 정책

- **정규형.** snake_case field, 목록은 key(name)를 기준으로 정렬, object key 정렬, 중복 제거가 아니라 중복 거절. unknown blueprint field는 거절하며 옛 `context` 필드도 거절한다. 새 `agent_context`는 → apps/agent-context의 현재 schema로만 받는다.
- **검증.** 같은 bundle의 선언·handler·고정 SDK·문서 format·permission scope·automation 입력·필수 problem code를 검사한다. app test 결과는 → problems/tests; 시작의 재검사는 → apps/runtime.
- **작성형 격리.** TypeScript 작성형의 값 추출은 권한 없는 별도 프로세스에서 10000ms 제한으로 한다. core·supervisor에서 import하지 않는다.

## 정할 것

- InputSchema의 줄임 작성형 문법과 정규 JSON의 수·문자열 encoding을 spec에서 고정한다. 정규형에 새 keyword를 조용히 허용하지 않는다.
- blueprint 작성형을 TypeScript만 지원할지 선언형 파일도 지원할지 정한다.
