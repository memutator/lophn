# layer-checks

`tools/check-deps.ts`가 나눈 층을 지키게 한다: harness(`packages/core/lophn-agent`), role 층(`packages/core/agent-roles`), domain(`apps`, `problems`, `projects`) 사이의 import 방향, harness 폴더의 domain protocol import와 role 이름 문자열, tool 정의 file의 import 범위. 앞 task들이 못 끊은 곳은 file 이름과 이유를 적은 예외 목록으로 드러내서 새로 생기는 것만 막는다.

- 단위: layer-checks (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/check-deps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`("규칙과 그 이유", "실행 때 import가 뜻하는 것")
  - roadmap: `project-docs/products/roadmap/harness-domain-split.md`("끝남 기준" 첫 둘, "지켜야 할 것")
  - 코드: `tools/check-deps.ts`의 `coreLayerViolation`, `CORE_DOMAIN_EDGES`, `CORE_LAYER_EXCEPTIONS`, `checkRepo(root)`(인자로 다른 root를 받아 fixture 폴더로 돌릴 수 있다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `agent-tool-spi`, `lophn-agent`
- 계약:
  - 쓰는 것: 앞 wave 결과. `lophn-agent`는 `agent-roles`와 domain을 import하지 않고, `agent-roles`는 domain을 import하지 않으며, domain의 tool 정의 file(`apps/agent-tools/`, `problems/agent-tools.ts`)과 `agent-roles/tools/`는 `tools/spi.ts` 같은 harness SPI와 protocol만 쓴다.
  - 내놓는 것: `deno task check`의 deps 단계가 아래 규칙 R1~R3을 어기는 새 import·문자열을 `core-layer`, `harness-domain`, `tool-file` rule 이름으로 막는다.

## 규칙

- **R1 층 방향** (`coreLayerViolation`을 고친다). module을 넷으로 센다: 바닥(그 밖 전부), harness(`lophn-agent`), role 층(`agent-roles`), domain(`projects`, `apps`, `problems`), 조립(`main`).
  - 바닥은 harness, role 층, domain을 import하지 않는다. (`agent-roles`를 바닥으로 세지 않는다.)
  - harness는 role 층과 domain을 import하지 않는다.
  - role 층은 domain을 import하지 않는다. domain은 role 층을 import하지 않는다.
  - role 층과 domain은 harness를 import할 수 있다.
  - domain끼리는 `problems>apps`, `projects>apps`만(범위 밖이라 그대로).
  - `CORE_LAYER_EXCEPTIONS`가 비었으므로 상수와 그 분기를 지운다. 주석("아직 못 끊은 예외 둘")을 하나만 남은 `projects>apps` 이야기로 고친다.
- **R2 harness 폴더 내용** (rule `harness-domain`). `packages/core/lophn-agent/**`의 test가 아닌 file에서:
  - `protocol/apps`, `protocol/problems`, `protocol/projects`, `protocol/coding-agent`를 import하지 않는다.
  - string literal `"project_manager"`, `"app_engineer"`, `"operator"`가 없다(`readImports`처럼 소스를 읽어 찾는다. 주석은 뺀다).
  - 지금 코드에는 앞 task들이 못 옮긴 곳이 남아 있다(이름이 아니라 file 단위로 찾는다. 예상: 동적 app-api tool `tools/app-tools.ts`·`app-toolkit.ts`·`tools/app-api/`, machine이 읽는 route 목록 `run-loop/runtime-access.ts`, `agents/`(`BUILTIN_NAMES`, `DEFAULT_PROFILES`, `resolve.ts`, `inspect.ts`, `validate.ts`…), `session/model.ts`, `instructions/`, `places/`, `tools/call/target.ts`, `extensions/`, `register.ts`). 먼저 규칙을 켜고 나온 위반을 file별로 모아 `HARNESS_LEFTOVERS: ReadonlyMap<file, 이유>`로 적는다. 이유는 한 문장이고 "범위 밖(README 정한 것 4)"이나 "앞 task가 못 옮김: …"처럼 구체적이어야 한다. 이 목록의 file은 R2를 면제받는다. 목록에 없는 file의 새 위반만 막는다. 목록의 file이 위반을 다 없앴으면 검사가 "목록에서 빼라"고 알려준다(남은 예외가 썩지 않게).
- **R3 tool 정의 file** (rule `tool-file`). 아래 file은 agent runtime child에서 실리므로 store·DB 코드를 끌어오면 안 된다.
  - 대상: `packages/core/apps/agent-tools/**`, `packages/core/problems/agent-tools.ts`, `packages/core/agent-roles/tools/**`(test 제외).
  - 허용 import: `packages/base`, `packages/protocol`, `zod`, `node:*`(단 `node:sqlite` 금지), 같은 대상 폴더 안, `packages/core/lophn-agent/tools/spi.ts`. `agent-roles/tools/**`는 `agent-roles` 안 어디든, harness 어디든 import할 수 있다(R1이 허용). 막는 것은 아래 금지뿐이다. domain 대상(`apps/agent-tools/**`, `problems/agent-tools.ts`)은 `spi.ts` 말고 `lophn-agent`를 import하지 못한다.
  - 금지: `packages/core/storage/**`, 그 module의 store·ledger·register, `node:sqlite`.

## 할 일

1. R1을 구현한다. 새 module 이름은 상수로 둔다(`CORE_HARNESS`, `CORE_ROLES`, `CORE_DOMAINS`). 메시지는 한국어로 지금 말투를 따른다.
2. R2를 구현하고 `HARNESS_LEFTOVERS`를 채운다.
3. R3을 구현한다.
4. 규칙마다 위반하는 import를 일부러 넣어 check가 실패하는 것을 보고(fixture를 scratchpad 폴더에 두고 `deno run -A tools/check-deps.ts <fixture root>`, 또는 임시로 repo file을 고쳤다가 되돌린다) 되돌린다. commit에는 남기지 않는다. 보고에 어떤 위반을 넣어 어떤 줄이 나왔는지 적는다.
5. `README`/문서는 고치지 않는다. 남은 예외 목록(`HARNESS_LEFTOVERS`)은 보고에 그대로 붙인다(lead가 `plan/gaps.md`와 `layers.md`로 옮긴다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (규칙은 check 자체가 지킨다. 4번의 손 검증으로 갈음한다)
- 남지 않음:
  - `grep -n "CORE_LAYER_EXCEPTIONS\|lophn-agent>projects" tools/check-deps.ts`가 0줄이다.
  - `HARNESS_LEFTOVERS`의 모든 항목에 이유가 있고, 이유 없는 항목이 없다.
  - R2 위반이 목록 밖 file에서 0이다.

## 지켜야 할 것(계획 README)

- 동작을 바꾸지 않는다. agent가 보는 tool 목록과 입력이 role마다 나누기 전과 같아야 한다(`tools/registry_test.ts`가 role별 목록을 본다).
- tool 정의 file은 agent runtime child에서 실린다. domain의 store나 DB 코드를 import하지 않는다(`layers.md` "실행 때 import가 뜻하는 것").
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 위 규칙을 구현하며 정한 것(주석을 뺀다는 기준, role 문자열 찾는 방법)
- 넘길 줄: 없음이 기본. 위반을 고치려고 남의 file을 건드리지 않는다. 예외 목록으로 둔다
- 계약 바꾸기 요청: 없음이 기본
- **무겁게 짠 것**: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- **알려진 미완 동작**: `HARNESS_LEFTOVERS` 전체와 각 이유(lead가 gaps로 옮긴다)
