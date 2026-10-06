---
type: domain-model
concerns: [lophn-agent/visuals]
---
# lophn-agent/visuals

Message에 들어가는 VisualBlock의 선언값·크기, AppCardReference와 문서로 남기기 위한 고정값을 정의한다.

## VisualBlock (값)

독립 entity·ID·ledger 표는 없다. Message.body blob에 들어간다. → lophn-agent/conversation.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | 문자열 | 아니오 | 메시지 안 unique; `[a-z0-9_-]{1,64}` | 블록 선택 키 |
| `schema_version` | 정수 | 아니오 | 첫 판 `1` | 명세 판 |
| `kind` | `table / chart / diagram / app_card` | 아니오 | kind별 payload 하나만 | 종류 |
| `title` | 문자열 | 아니오 | 1~200 Unicode code points | 제목 |
| `description` | 문자열 | 아니오 | 1~2000 Unicode code points; 빈·누락·추정 표시 포함 | 글로 읽는 설명 |
| `sources` | VisualSource 배열 | 아니오 | 기본 `[]`; 근거 없는 값은 description에 명시 | 읽은 근거 |
| `payload` | kind별 값 | 아니오 | 엄격 schema; unknown field·실행 코드·임의 URL 거절 | 선언 데이터 |

## VisualSource (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `document / app_command / estimate` | 아니오 | 종류별 참조 하나 | 근거 종류 |
| `reference` | JSON object | 아니오 | document는 `{document,version,section?}` → documents/versions; app_command는 `{app,release,command,tool_call}` → apps/releases, lophn-agent/harness/tools; estimate는 `{label}` | 고정 출처 |
| `observed_at` | 시각 | 예 | 앱 결과에는 필수; → platform/ledger | 수집 시각 |

앱·문서 주소를 참조한다고 read scope가 확대되지는 않는다. tool 결과로 검증한 참조만 넣는다.

## TableSpec (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `columns` | `{key,label,type,unit?}` 배열 | 아니오 | 1~20개; key unique; type `string / number / boolean` | 열 정의 |
| `rows` | JSON object 배열 | 아니오 | 0~1000개; 선언 열 key만; 값은 열 타입 또는 null; 숫자는 유한값 | 행 |

## ChartSpec (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `type` | `bar / line / scatter` | 아니오 | 첫 판 지원 목록 | 차트 종류 |
| `x` | `{label,type,unit?}` | 아니오 | type `category / number / time`; time은 UTC 시각 | 가로축 |
| `y` | `{label,unit?}` | 아니오 | 값은 유한 number 또는 null | 세로축 |
| `series` | `{key,label,points}` 배열 | 아니오 | 최대 8개; key unique; 전체 points 최대 1000개 | series |

point는 `{x,y}`다. null은 결측이며 0으로 바꾸지 않는다. line은 입력 순서대로 연결하며 scatter의 x는 number 또는 time이다. 색·축·hover의 구현은 → apps/sdk, shell/design-system.

## DiagramSpec (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `nodes` | `{key,label,description?}` 배열 | 아니오 | 최대 100개; key unique; label 1~200자 | node |
| `edges` | `{from,to,label?}` 배열 | 아니오 | 최대 200개; 양끝은 존재하는 node key | 방향 edge |

좌표·SVG·Mermaid 코드·HTML은 입력으로 받지 않는다. 배치는 SDK가 정한다.

## AppCardReference (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | `app` ID | 아니오 | 현재 scope 안; → apps/registration | 앱 |
| `release` | `rel` ID | 아니오 | 참조 생성 때의 active release; → apps/releases | 카드 계약 판 |
| `view` | 문자열 | 아니오 | 해당 blueprint의 card 지원 view; → apps/blueprint | 화면 |
| `input` | JSON object | 아니오 | view 계약 검사; secret·credential·임의 URL 없음 | 카드 입력 |

카드는 live 표시이며 과거 command 결과 snapshot이 아니다. 저장된 release와 현재 release가 달라지면 `contract_changed`, 사라지면 `unavailable`로 표시한다. 자동 최신판 전환은 없다. 앱 frame·view session 격리는 → shell/app-frame, shell/workspace.

## VisualDocumentPreparation (값)

ledger entity가 아닌 문서 준비 결과다. 실제 Document·Version은 → documents/versions.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `source_message` | `msg` ID | 아니오 | 확정 agent 메시지; → lophn-agent/conversation | 원래 메시지 |
| `source_body` | sha256 | 아니오 | 읽은 메시지 본문 blob의 hash(저장된 값) | 고정 근거 |
| `block_keys` | 문자열 배열 | 아니오 | 1~8개; source_message에 존재; 중복 없음; 메시지 순서 | 선택 블록 |
| `text` | 글(`text/html`) | 아니오 | 실행 코드·외부 자원 없음; UTF-8 128 KiB 이하; 결과 한계 안의 창으로 이어 읽는다 | 준비한 본문 글 |
| `snapshots` | `{block_key,status,captured_at}` 배열 | 아니오 | 앱 카드별 하나; status `captured / unavailable`; captured만 hash를 더하고 captured_at이 있다 | 카드의 redaction된 snapshot |

준비한 본문은 글 값이다. 준비는 blob을 만들지 않고 hash를 계산하지 않으며 문서도 저장하지 않는다(`saved: false`). 저장은 문서 tool이 글 값으로 하고 core가 redaction과 blob 준비를 맡으므로 저장한 Version 파일의 hash가 본문 hash이고, 저장 전에는 준비하지 않은 blob의 hash를 만들어 두지 않는다. 문서 대상(`document`, `base_version`, place, name)은 저장 tool의 입력이 정한다.

본문은 제목·설명·출처, 같은 데이터를 읽을 수 있는 표·목록, 검증한 명세를 escaped JSON으로 읽을 수 있는 절을 포함한다. 명세를 script에 넣거나 앱 iframe·token·network 자원을 포함하지 않는다. 앱 카드 snapshot 준비는 → apps/agent-context, 앱 view contract이며 실패를 live 화면으로 대체하지 않는다. AppScreenContext의 JSON data를 snapshot 이미지가 있다고 가정하지 않는다.

## 정책

- **상한.** Message당 VisualBlock 최대 8개, canonical JSON 합계 262144 UTF-8 bytes. unknown field·상한 초과·깨진 참조는 `invalid_input`이며 부분 블록 저장 없음이다.
- **불변성.** 저장된 블록은 Message.body와 함께 불변이다. 정정은 새 Message다. renderer 상태는 derived이며 원래 payload를 고치지 않는다.
- **안전.** 저장·model 전송·snapshot·문서 준비에 → platform/redaction을 적용한다. 앱·문서·블록의 문자열은 지시가 아닌 data다. 색·레이아웃·스크립트 실행 명세를 model에 주지 않는다.
- **문서로 남기기.** 명시 사람 요청에서만 준비한다. 문서 생성·저장은 기존 `document.create / document.save_version` 계약 한 번으로 확정한다. 새로운 publish contract나 VisualBlock entity를 만들지 않는다. Operator는 승인된 기존 output 문서만 저장한다.
- **model 이력.** 블록 전체 데이터나 그림을 매 turn 복제하지 않고 key·kind·title·description·출처·재읽기 참조를 둔다. 원명세는 → lophn-agent/harness/tools의 `visual.read`로 읽는다.
