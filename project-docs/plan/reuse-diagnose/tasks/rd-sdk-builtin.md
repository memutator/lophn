# rd-sdk-builtin

`package.list`와 `package.get` tool이 catalog(`@me/*`) 뒤에 설치 사본의 내장 SDK(`@lophn/*`)도 돌려주게 한다. lophn과 App Engineer는 `<data root>/sdk`를 읽을 수 없어서 core가 읽어 주는 route 하나가 필요하다.

- 단위: rd-sdk (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/package-routes.ts`
  - `packages/core/apps/packages/builtin.ts`
  - `packages/core/apps/packages/mod.ts`
  - `packages/core/apps/agent-tools/package.ts`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "lophn과 App Engineer가 내장 SDK를 볼 길이 없다"
  - architecture: `project-docs/architecture/agent-definition.md`의 "role의 tool 목록은 코드가 고정하고…", "agent credential의 operation 상한은 tool이 core에 부르는 route 이름이다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `package-registry`, `agent-tools`(`agent-tool-spi`); `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 본보기: memory route는 `packagePublish`(`package-routes.ts`)와 그 handler 자리(`packages/core/main/daemon/wiring/apps.ts`의 `memory:` 목록), disk를 읽는 memory handler는 `packages/core/apps/blueprint/check.ts`의 `checkBlueprint`
  - 설치 사본 배치: `packages/core/apps/packages/install.ts`의 `packageInstallPath`와 머리 주석
- 계약:
  - 쓰는 것: `packagesList`, `packagesVersions`, `packagesUsage`, `packagesGuideBody`(catalog 읽기, 그대로 둔다)
  - 내놓는 것(모양을 여기서 정한다. 다른 task는 이 route를 쓰지 않는다):
    - route `packages.builtin`: `defineMemory`, resource `packages`, method `builtin`, actors `["agent"]`, errors `invalid_input` `not_found` `unavailable` `forbidden` `unauthorized`. `PACKAGE_ROUTES`에 더한다.
    - input: `{ name?: packageNameSchema }`. `name`은 `@lophn/...`만 받는다(`@me/...`는 `invalid_input`).
    - output: `{ packages: [{ name, version, has_guide }], guide: { text, truncated } | null }`. `name`이 없으면 설치된 내장 SDK 전부(이름순)이고 `guide`는 null이다. `name`이 있으면 `packages`는 그 하나이고 `guide`는 본문이다. 설치되지 않은 이름은 `not_found`다.
    - tool `package.list` 출력: `{ packages: <catalog 그대로>, builtin: [{ name, version, has_guide }] }`
    - tool `package.get` 출력: `@lophn/` 이름이면 `{ name, version, builtin: true, guide, guide_truncated }`. 그 밖의 이름은 지금 모양 그대로다.

## 할 일

1. `package-routes.ts`에 `packagesBuiltin`을 만들고 `PACKAGE_ROUTES`에 더한다(위 모양). 같은 file의 다른 route는 고치지 않는다.
2. `packages/core/apps/packages/builtin.ts`에 `readBuiltinSdk(deps: { dataRoot: string }): MemoryHandler`를 만든다(`checkBlueprint`와 같은 handler 모양). `<dataRoot>/sdk/<part>/<version>/`을 읽는다. `@me` 폴더는 건너뛴다. 이름은 `@lophn/<part>`다. 한 이름에 판이 여럿이면 가장 높은 판이다. 이유: 내장 SDK는 catalog가 아니라 설치 사본이 정본이라고 정했다(archived `platform.md`의 "sdk package가 catalog에 없어…").
   - guide 본문: `guide.md`가 있으면 그것. 없고 `components/<분류>/mod.ts`가 있으면(`@lophn/ui`) 분류마다 `## <분류>` 제목 아래 그 `mod.ts` 원문을 이어 붙인다. 이유: `@lophn/ui`는 `guide.md`가 없고 "언제 쓰나" 한 줄이 `mod.ts` 주석에 있어서, 따로 쓰면 낡는다. 둘 다 없으면(`@lophn/wording`) `has_guide: false`, `guide: null`.
   - 본문은 256 KiB까지만 담고 넘으면 `truncated: true`.
   - dataRoot를 인자로 받는다. 전역 상태와 `Deno.env`를 읽지 않는다.
3. `packages/core/apps/packages/mod.ts`에서 `readBuiltinSdk`를 내보낸다.
4. `agent-tools/package.ts`:
   - `package.list`의 `routes`에 `packagesBuiltin`을 더하고, catalog 뒤에 `builtin`을 붙인다. 설명을 "List the SDK built into lophn and the user packages (@me) with their versions."로 고친다.
   - `package.get`의 `routes`에 `packagesBuiltin`을 더한다. `name`이 `@lophn/`로 시작하면 catalog 대신 `packagesBuiltin`을 `{ name }`으로 불러 위 출력을 만든다. `version`을 주었는데 설치된 판과 다르면 `notFound`. 본문은 `TEXT_MAX_BYTES`로 자른다. 설명에 "built-in SDK names start with @lophn/"를 한 줄 더한다.
5. agent credential 길(확인됨): `defineTool`이 `routes`의 이름을 tool의 `operations`로 만들고, `roleOperations`(`packages/core/agent-roles/credentials.ts`)가 그 합집합을 role의 상한으로 삼으며, 상한은 `agentRuntimePolicies`가 actor `agent`의 policy로 올린다. 그래서 route의 `actors`에 `agent`가 들어 있고 tool `routes`에 적히면 닿는다(`package.publish`가 같은 길이다). `package.list`·`package.get`은 모든 role의 읽기 tool이라 모든 role이 이 route를 부를 수 있다. 내장 SDK 안내는 비밀이 아니라 괜찮다.
6. 확인(commit하지 않는다): `.dev-data/rd-sdk-builtin/`에 core를 한 번 띄워 `<data root>/sdk`를 만든 뒤(`LOPHN_HOME`, 끝나면 끈다), 같은 폴더의 임시 script에서 `readBuiltinSdk({ dataRoot })`를 직접 불러 목록에 `@lophn/ui`·`app-ui`·`blueprint`·`cap-app-api`·`cap-problem`·`cap-project`·`cap-store`·`wording`이 있고 `@lophn/ui`의 guide에 8개 분류가 들어 있고 `@lophn/cap-store` guide가 `guide.md`와 같음을 본다. (`cap-fs`·`cap-net`·`cap-secret`은 `rd-cap-fs`·`rd-cap-net-transport`·`rd-cap-secret-supervisor`가 land해야 보인다.)

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(읽기 전용 목록이고 권한 경계를 넓히지 않는다).
- 남지 않음: `grep -rn "SDK and user packages" packages`가 0줄이다(옛 `package.list` 설명).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 `packages/core/main/daemon/wiring/apps.ts`의 `memory:` 목록에 한 항목을 더한다 — `[`${packagesBuiltin.resource}/${packagesBuiltin.method}`, readBuiltinSdk({ dataRoot: ctx.root.path })]`. 이 한 줄이 들어가기 전에는 두 tool이 `unavailable`이다(보고에 그렇게 적는다).
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
