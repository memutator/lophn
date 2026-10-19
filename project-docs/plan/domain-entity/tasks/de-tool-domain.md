# de-tool-domain

앱 tool 선언에 `domain`(그 앱의 domain 이름) 칸을 필수로 더한다. 정본 검사(`validateBlueprint`), 읽기 모양(`AppTool`, app-api index), SDK 작성형, 앱 template, 사람이 읽는 SDK guide가 대상이다. 앱의 domain 목록을 아는 쪽(release 준비 검사)은 이 task가 아니라 `de-release-domain`이다. 이 task는 "목록을 주면 그 안에 있는 domain만 받는" 선택 인자까지만 만든다.

- 단위: tool-domain (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/blueprint/`
  - `packages/sdk/blueprint/`
  - `packages/core/apps/packages/template/app/`
  - `packages/core/apps/blueprint/reads_test.ts`
  - `packages/core/apps/mcp/serve_test.ts`
  - `packages/core/apps/releases/compare_test.ts`
  - `packages/core/problems/tests/app-test/`
  - `packages/core/lophn-agent/tools/app-public_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(tool 선언 절), `project-docs/architecture/kinds.md`(앱 domain은 대개 kind 없이 tool로 다룬다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `sdk-api`, `project-docs/module-catalog.yaml`의 `packages/sdk`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 앱 tool의 domain"
  - 본보기(코드): `packages/protocol/apps/blueprint/app-api.ts`(`validateScreensAndTools`, tool 선언 검사), `types.ts`(`ToolDeclaration`, `BlueprintOptions`), `read.ts`(`appToolSchema`, `appApiIndexEntrySchema`)
- 계약:
  - 쓰는 것: `slugSchema`와 같은 규칙(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, 63자 이하). `protocol/apps/blueprint/`는 zod 없이 도는 정본이라 정규식 상수를 이 폴더에 사본으로 둔다.
  - 내놓는 것
    - `ToolDeclaration.domain: string`(필수). `tool`을 선언하는 JSON·작성형 모두 `domain`이 없으면 `invalid`다("tool <name> domain must be a domain name").
    - `BlueprintOptions.domains?: readonly string[]`: 주면 모든 tool의 `domain`이 이 이름 안에 있어야 한다(아니면 `invalid`, "tool <name> domain <domain> is not a domain of this app"). 안 주면 모양만 본다.
    - `validateBlueprint(value, { app?, domains? })`. 정규화한 blueprint와 hash에 `domain`이 든다.
    - `appToolSchema`(`AppTool`)와 `appApiIndexEntrySchema.tools[]`에 `domain: string`. `toMcpTool`·`toolAnnotations`(MCP 항목)에는 싣지 않는다(effect·public처럼 lophn 칸이다).

## 할 일

1. `packages/protocol/apps/blueprint/types.ts`: `ToolDeclaration`에 `domain`을 더하고 `BlueprintOptions`에 `domains`를 더한다. `app-api.ts`의 `validateScreensAndTools`: `exactKeys`의 허용·필수 목록에 `"domain"`을 더하고, 모양 검사와 선택적 목록 검사를 한다. `value.ts`: option 키 검사(`exactKeys(options, ["app"], [])`)에 `domains`를 더하고(문자열 배열, 각 원소가 slug) `validateScreensAndTools`에 넘긴다. `read.ts`: 두 schema에 `domain`을 더한다.
2. `packages/protocol/apps/blueprint/validate_test.ts`: 기존 사례를 `domain`이 든 모양으로 고치고, 위 두 검사(없음, 목록 밖)를 한 사례씩 더한다. 그 안의 "missing public" 같은 줄처럼 한 줄 사례다.
3. `packages/sdk/blueprint/`(`define.ts`, `mod.ts`)는 type을 따라간다. `guide.md`의 tool 선언 절(28째 줄 근처)에 `domain`을 적는다: "tool이 다루는 객체의 domain. 이 앱의 domain 이름 중 하나이고, 앱을 만들면 앱 이름의 domain이 하나 생긴다. 다른 domain은 사람이나 App Engineer가 `domain.create`로 만든 뒤 쓴다."
4. `packages/core/apps/packages/template/app/blueprint.ts.tmpl`의 두 tool에 `domain: "{{APP}}"`를 더한다(치환 표시는 `scaffold.ts`의 `fill`이 채운다). `AGENTS.md.tmpl`의 tool 선언 설명에 한 줄 더하고, `packages/core/apps/packages/template/app/tests/blueprint_test.ts.tmpl`이 선언 칸을 비교하면 따라 고친다.
5. 타입이 깨지는 fixture를 고친다: 위 소유 test file들(`reads_test.ts`, `serve_test.ts`, `compare_test.ts`, `problems/tests/app-test/` 아래 test, `app-public_test.ts`)과 type check가 가리키는 다른 fixture. `domain`을 넣는다. 소유 밖 file이 깨지면 그 줄만 최소로 고치고 보고의 "넘길 줄"에 적는다.
6. 이 task는 release 준비에서 앱의 domain 목록을 넘기는 일(`releases/commands.ts`, `activation/desired.ts`, `blueprint/check.ts`)을 하지 않는다. `domains` option은 안 준 채 두 호출이 돈다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "tool 선언에 `domain`이 없거나 slug가 아니거나, 목록을 줬을 때 목록 밖이면 blueprint 검사가 거절한다" — `packages/protocol/apps/blueprint/validate_test.ts`
- 남지 않음: `grep -rn "public: \(true\|false\)" packages/core/apps/packages/template packages/protocol/apps/blueprint packages/sdk/blueprint`의 모든 줄 근처(앞 3줄)에 `domain`이 있다(선언 하나에 `domain` 하나다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: `domain` 정규식 사본 자리, 선택 `domains` option의 오류 문구
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: release 준비·`blueprint.check`가 아직 앱의 domain 목록을 주지 않는다(`de-release-domain`)
