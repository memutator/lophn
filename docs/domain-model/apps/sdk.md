---
type: domain-model
concerns: [apps/sdk]
---
# apps/sdk

Package와 불변 공개 SDK version, 템플릿 값을 정의한다.

## Package (`pkg`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `pkg` ID | 아니오 | PK | 패키지 ID |
| `name` | 문자열 | 아니오 | unique; import에서 쓰는 공개 이름; 빈 문자열 금지 | 패키지 이름 |
| `description` | 문자열 | 아니오 | 빈 문자열·줄바꿈 금지 | 한 줄 목적 |
| `kind` | `component` / `capability` / `domain` / `format` | 아니오 | Package마다 한 종류; 공개 후 다른 종류로 변경 금지 | 제공 재료 종류 |
| `versions` | PackageVersion[] | 아니오 | `(package,version)` unique; 조회 시 조립 | 실제 제공된 공개 판 |

독립 version ID·공개/승격 상태는 없다. 현재 등록 주체는 플랫폼 설치의 machine만이다.

### 불변 조건

- 공개한 name·version의 코드·안내는 변경/삭제하지 않는다. 변경은 새 version이다.
- 정확한 공개 version만 사용한다. 범위·latest·암묵적 최신 선택은 거절한다. 준비 bundle의 전체 의존 byte와 공개 hash가 일치해야 한다.
- SDK 추가 설치는 기존 release의 의존을 변경하지 않는다. dependency 갱신은 새 release로 한다.

## PackageVersion (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `version` | 정확한 버전 문자열 | 아니오 | 하나의 완전한 SemVer 2.0.0; range/latest 금지 | 공개 판 |
| `bundle_hash` | sha256 | 아니오 | → platform/blob-store; 실제 공개 코드 | 불변 SDK byte |
| `guide_hash` | sha256 | 아니오 | → platform/blob-store; 해당 version의 사용 안내 | 사용법·import 예·API 예 |

## AppTemplate (값)

설치 제공 파일의 불변 bundle이며 별도 entity·상태는 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `bundle_hash` | sha256 | 아니오 | → platform/blob-store; 검증된 설치 내용 | template byte |
| `sdk_dependencies` | SDKDependency[] | 아니오 | → apps/blueprint; 정확한 공개 version만 | 최초 고정 의존 |
| `files` | 상대 경로[] | 아니오 | path unique; `..`·절대 경로 금지; DB 사용 때만 migration 필수 | 진입 코드·blueprint·lock/import map·migration·test·fixture·화면 source·안내 |

## ResponsiveScreenProps (값)

공용 `@lophn/ui-layout`의 화면 container 입력은 `{size:"full"|"panel"|"card",width_px,height_px}`다. 실제 container resize를 사용하고 panel은 width≥320px, card는 width≥240px에서 페이지 가로 scroll을 만들지 않는다. 표의 내부 scroll은 허용한다. 색·치수 정본은 → shell/design-system다.

## SharedVisualInput (값)

`@lophn/ui-chart`와 `@lophn/ui-table`은 앱과 host가 같은 version의 선언형 JSON 입력을 사용한다. chart의 종류는 시계열·막대·누적 막대·분포·산점과 node·edge 도표이고(→ apps/sdk#R17) table은 column 선언과 rows다. script·HTML·remote import는 입력에 없다. 세션 블록의 보관·크기·문서화 명세는 → lophn-agent/visuals다. SDK는 데이터 rendering과 loading/empty/error·접근 가능한 데이터 표만 소유한다.

## SharedLocalization (값)

공용 UI SDK와 앱 템플릿은 → shell/wording의 message key·en-only catalog·ICU MessageFormat·Intl formatting 계약을 같은 방식으로 사용한다. catalog와 고정 의존은 release의 고정 bundle에 포함하고 운영 중 새 locale이나 formatter를 다운로드하지 않는다. 앱 screen/command key와 message key는 별개이며 사용자 이름·업무 데이터는 고정 문구 검사를 이유로 번역하거나 변경하지 않는다. en 누락·placeholder 불일치·고정 문구 직접 삽입 검사는 template build/test 기본 연결이다. 전역 화면 언어의 상세 정책은 복제하지 않는다.

## Screen context SDK API (값)

`@lophn/blueprint`의 `defineAgentContext`는 → apps/agent-context의 AgentContextDeclaration 검증을 공유한다. `@lophn/cap-schedule`의 `registerScreenContext`는 read handler·revision 공급자·민감 path 제거를 등록하고 `registerAnnotationTarget`는 선언된 write handler의 target/revision 검사를 연결한다. 새로운 예약 command key나 DOM 접근 통로를 만들지 않는다. AppScreenContext·ScreenContextReadInput·AnnotationWriteInput type 정본은 → apps/agent-context다.

## App command client API (값)

`@lophn/cap-schedule`의 `connectAppCommands`는 `{app,commands}`를 받고 현재 프로세스 신원과 → apps/connections의 선언·Grant로 제한된 direct client를 반환한다. 요청 준비는 broker의 `/apps/connect`, 업무 실행은 target direct socket이다. 같은 API에서 실제 invocation 부모와 call path를 SDK 비동기 문맥으로 연결하며 user/agent를 caller로 위조하지 않는다. 새 `cap-read-model` Package는 만들지 않는다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Package | 공개 version | PackageVersion | 1..N | 삭제 금지 |
| → apps/releases | SDK 의존 | PackageVersion | 0..N | 사용 중 byte·안내 유지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `packages` | Package 기본 필드 | PK `id` | `name` | `(name)` | 없음 |
| `package_versions` | 공개 version 값 | PK `(package,version)` | 동일 PK | `(package,version)` | package → packages; bundle_hash·guide_hash → blob |

release의 SDK 사용처는 고정 blueprint 의존을 기준으로 조회한다. 별도 SDK ledger·승격 queue·mutable latest pointer는 없다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `package.register_version` | machine | name,description,kind,version,bundle_hash,guide_hash | 신뢰된 설치 결과·실제 hash; 기존 공개 판·Package kind 불변; key | `PackageVersionRegistered` | `forbidden`, `invalid_input`, `conflict` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `PackageVersionRegistered` | Package | name,kind,version,bundle_hash,guide_hash | coding-agent/connection; 앱 자동 갱신/agent 자동 run 없음 |

## 정책

- **목록.** 실제 사용할 수 있는 공개 version·안내만 읽기 경로에서 제공한다. @me 이름이 존재하면 @lophn 이름보다 먼저 정렬하되 현재 개인 Package 등록은 지원하지 않는다.
- **runtime 고정.** sdk/<name>/<version>의 설치 사본은 derived이며 파일 0444·디렉터리 0555로 읽기 전용 제공한다. 운영은 bundle에 넣은 고정 SDK만 읽고 다운로드하지 않는다. 통로 미지원이면 시작을 unavailable로 거절하며 새 SDK로 몰래 바꾸지 않는다.
- **공개 묶음.** 최초 공개 이름 목록은 apps/sdk#R4가 소유하며 모두 정확한 1.0.0으로 시작한다. 과거 공개 byte를 같은 version으로 바꾸지 않는다.
- **SemVer.** patch는 API·동작을 유지한 내부 수정·문서·예제, minor는 기존 API를 유지한 추가, major는 API·동작 제거/변경 또는 요구 permission 증가다. 외부 Package 등록 없이 검증한 설치 제공 version만 추가한다.
- **template.** `LOPHN_APP_TEMPLATE` 다음 `<LOPHN_HOME>/templates/app`에서 검증된 template을 찾는다. template은 SDK 진입점·문제 보고/예외 수집을 기본 연결한다. 안내 내용은 → coding-agent/guides, 실제 검사 결과는 → problems/tests.
- **scope.** SDK에는 grant 발급·core DB 접근·problem 닫기 통로가 없다. 문서 저장은 선언 key·기대 version·재전송 key를 받으며 실제 저장 → documents/versions. secret → apps/permissions; problem 보고 의미 → problems/reporting.
- **문맥.** command/automation의 실제 app·release·mode·invocation ID를 비동기 callback에도 전달한다. 알려지지 않은 invocation을 꾸미지 않는다. 내부 trace 이름은 inv ID와 다른 값이며 최대 64자다. Deno 2.9에서 비동기 callback·timer·SQLite·fetch 뒤 문맥 유지를 실제 테스트로 확인한다.

- **responsive/visual.** host와 앱은 공용 UI package를 소비하며 별도 host chart/table 구현을 만들지 않는다. 임의 앱 코드를 세션의 차트 JSON으로 실행하지 않는다. 앱 카드만 별도 격리된 app view에서 현재 release의 card 화면을 연다(→ shell/app-frame).
- **context/주석.** SDK 등록은 blueprint의 read/write command 목록과 정확히 일치해야 한다. 등록이 Grant를 주지 않으며 handler의 실제 revision CAS와 민감 path 제거는 앱 test로 확인한다. stale 화면 상태를 자동 재사용하지 않는다.

## 정할 것

- 개인 Package 등록·자동 승격/전파는 현재 없으며 실제 복수 앱 재사용 사례가 생기면 별도 결정한다.
- 오래된 통로 지원 기간을 정한다. 최초 공개 이름·1.0.0은 apps/sdk#R4를 따르며 내용 보존과 통로 호환 기간은 별개다.
- template 화면의 React/UI package 지원 목록과 font의 bundle 포함/desktop 공유를 고정한다.
