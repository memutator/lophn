# de-domain-core

domain entity(`dom_`)를 새로 만든다. protocol 계약(id, 값, route, event, port, 경로 helper)과 core module `domains`(표, command, 읽기, tx port, agent tool 정의)가 전부 새 file이다. 다른 task는 이 task가 내놓는 모양만 읽는다. 기존 file은 `packages/protocol/base/ids.ts`(prefix 하나)와 `tools/check-deps.ts`(module 하나)뿐이다.

- 단위: domain-core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/domains/`(새 폴더)
  - `packages/core/domains/`(새 폴더)
  - `packages/core/main/daemon/wiring/domains-registration.ts`(새 file)
  - `packages/protocol/base/ids.ts`
  - `tools/check-deps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(domain module 규칙), `project-docs/architecture/kinds.md`, `project-docs/architecture/artifact.md`("자리는 …" 항목)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `projects`, `apps`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > domain entity / domain을 만드는 쪽 / 앱의 domain", `project-docs/products/roadmap/domain.md`의 "그릇과 domain", "domain이 가진 것"
  - 본보기(코드): `packages/protocol/projects/project-api.ts`(command·read 정의 꼴), `packages/protocol/apps/apps.ts`(`definePort`, `defineEvent`), `packages/core/apps/registration/`(`commands.ts`, `store.ts`, `rows.ts`, `schema.ts`, `ports.ts`, `reads.ts`), `packages/core/projects/register.ts`(`createLedgerRegistration`·`createReaderRegistration`), `packages/core/main/daemon/wiring/lophn-agent-registration.ts`(`defineTxPort`로 꽂는 `appProjectLookupPort`), `packages/core/apps/agent-tools/app.ts`(`defineTool` 꼴)
- 계약:
  - 쓰는 것: `slugSchema`(`packages/protocol/projects/values.ts`), `idSchema`(`packages/protocol/base/ids.ts`), `defineCommand`·`defineRead`(`packages/protocol/base/route.ts`), `defineEvent`(`packages/protocol/base/event.ts`), `definePort`(`packages/protocol/base/ports.ts`)
  - 내놓는 것(다른 task가 import하는 이름. 이 이름과 모양을 바꾸지 않는다)
    - `packages/protocol/domains/values.ts`: `domainIdSchema = idSchema("dom")`, `domainNameSchema = slugSchema`, `domainOwnerSchema = {kind: "project", id: prj} | {kind: "app", id: app}`(`DomainOwner`), `ownerKey(owner): string`
    - `packages/protocol/domains/domains.ts`: `domainRecordSchema {id, name, title, purpose, owner, revision, status}`, command `domainCreate`(`domain.create`, resource `domains`, 입력 `{id?, name, title, purpose, owner}`, actor user·agent), `domainArchive`(`domain.archive`)·`domainUnarchive`(`domain.unarchive`)(입력 `{domain}`, actor user, compare `base_revision`), read `domainList`(`domain.list`, 입력 `{owner?, status?, cursor?, limit?}`, 출력 `{domains, next_cursor}`)·`domainGet`(`domain.get`, 입력 `{domain}`, 출력 `{domain}`)(actor user·agent·machine), event `domainCreated`·`domainArchived`·`domainUnarchived`(subject `dom`), `DOMAIN_ROUTES`
    - `packages/protocol/domains/ports.ts`: `domainLookupPort`(`get(id) → {id, name, owner, status} | null`, `ofOwner(owner, status?) → 같은 모양의 목록(이름순)`, `byName(name) → … | null`), `domainProvisioningPort`(`create(input: {name, title, purpose, owner}) → Result<{id}>`. 다른 module의 command가 같은 tx 안에서 부른다. 구현은 `domains` register가 `ports`로 낸다)
    - `packages/protocol/domains/paths.ts`(import 없음. shell main이 import한다): `DOMAINS_AREA = "domains"`, `DOMAIN_DOC_FILE = "DOMAIN.md"`, `DOMAIN_KINDS_FILE = "kinds.yaml"`, `DOMAIN_SKILLS_FOLDER = "skills"`, `DOMAIN_ARTIFACTS_FOLDER = "artifacts"`, `domainFolder(dataRoot, domain)`(= `<data>/domains/<dom>`), `domainKindsFile`, `domainDocFile`, `domainSkillsFolder`, `domainArtifactsFolder`, `domainIdOfFolder(name) → string | null`
    - `packages/protocol/domains/artifact.ts`(import 없음): `packages/protocol/projects/artifact.ts`의 순수 함수를 그대로 옮긴 사본(`ARTIFACT_ENTRY`, `ARTIFACT_DATA_FOLDER`, `ARTIFACT_ENTRIES_FILE`, `parseArtifactMeta`)과, domain이 보이는 `artifactMentions(text, known: readonly {domain, name}[])`(대화 글의 `…/domains/<dom>/artifacts/<name>` path 조각만 잡는다). 옛 file은 지우지 않는다(쓰는 task가 옮기고 cleanup이 지운다).
    - `packages/protocol/domains/values.ts`에 `artifactNameSchema`(= `slugSchema`)도 둔다.
    - `packages/protocol/domains/mod.ts`: 위를 모두 내보내고 `ROUTES`를 준다.
    - `packages/core/domains/lookups.ts`: wiring이 SQL 없이 부르는 읽기 함수 `domainsOfOwner(sql, owner, status?)`, `domainOwnerOf(sql, domain)`, `domainIdsOfOwner(sql, owner)`, `activeDomainIds(sql)`.
    - `packages/core/domains/agent-tools.ts`: `DOMAIN_AGENT_TOOLS`(`domain.list`, `domain.get`, `domain.create`. `defineTool`, protocol·base·`lophn-agent/tools/spi.ts`만 import한다. `domain.list`는 입력 없이 부른 agent의 그릇 domain 목록, `domain.create`는 `{name, title, purpose}`로 부른 agent의 그릇(PM은 project, App Engineer는 app)에 만든다. 그릇은 입력으로 받지 않고 `ToolContext.place`에서 정한다. `domain.create`의 effect는 `write`이고 Gate에 묻지 않는다(정의에 `gate`를 두지 않는다. 그릇 안에 만드는 것이라 권한이 넓어지지 않는다. 예전 context 만들기도 Gate가 없었다)).

## 할 일

1. `packages/protocol/base/ids.ts`의 `ID_PREFIXES`에 `dom: "Domain"`을 더한다. 위 protocol file을 새로 만든다.
2. core module `packages/core/domains/`를 `packages/core/apps/registration/` 꼴로 만든다: `schema.ts`(표 `domains`: `id` pk, `name` UNIQUE(보관한 것 포함, 이름은 전 domain에서 하나), `title`, `purpose`, `owner_kind in ('project','app')`, `owner_id`, `revision`, `status in ('active','archived')`, 정체성(`id`, `name`, `owner_kind`, `owner_id`) 불변 trigger, 지우기 trigger, `(owner_kind, owner_id, status)` index), `rows.ts`, `store.ts`, `commands.ts`, `reads.ts`, `ports.ts`, `lookups.ts`, `register.ts`(`createLedgerRegistration`·`createReaderRegistration`. `projects/register.ts` 꼴), `agent-tools.ts`, `mod.ts`.
3. `domain.create`: user는 어느 그릇에든 만들 수 있다(`id`를 미리 배정하는 것도 user만). agent는 자기 그릇에만 만든다(자격 조건 `ctx.conditions.project`가 owner project이거나 `ctx.conditions.app`이 owner app이어야 하고, 아니면 `forbidden`). 그릇이 없으면 `not_found`, 보관된 그릇이면 `conflict`, 이름이 겹치면 `conflict`다. 그릇 존재 확인은 `ownerLookupPort`(이 module의 `ports.ts`에 정의, `{get(owner) → {status} | null}`)로 한다: domain module은 projects·apps를 import하지 못한다(`layers.md`).
4. `domain.archive`: 그릇이 app이고 이 domain이 그 앱의 active domain 가운데 하나뿐이면 `conflict`("마지막 domain은 보관하지 못한다"). 그릇이 project이면 0개가 돼도 된다. `domain.unarchive`는 상태만 되돌린다. 이름 변경과 그릇 옮기기는 두지 않는다.
5. `domain.list`·`domain.get`: user·machine은 전체. agent는 자격 조건 `project`·`app`이 있으면 그 그릇의 domain만 읽고(다른 그릇은 `not_found`/빈 목록), 조건이 없는 agent(lophn)는 전체를 읽는다. `domain.get`은 이름이 아니라 id로 읽는다.
6. 같은 tx에서 domain을 만드는 `domainProvisioningPort` 구현을 `register.ts`의 `ports`로 낸다(`TxPortRegistration`). `domain.create` command도 같은 함수를 쓴다. owner 존재 확인을 하지 않는 것은 provisioning뿐이다(호출한 module의 command가 이미 같은 tx에서 확인했다).
7. `packages/core/main/daemon/wiring/domains-registration.ts`에 `createCoreRegistration`을 둔다: `ownerLookupPort`를 `defineTxPort`로 꽂는다. project는 `packages/core/projects/lookups.ts`의 `projectExists`와 status 읽기, app은 `packages/core/apps/lookups.ts`의 읽기를 쓴다(표를 SQL로 직접 읽지 않는다. 필요한 읽기 함수가 없으면 그 module의 `lookups.ts`에 한 줄 더한다. 두 file은 다른 task의 소유지만 읽기 함수 추가만 허락한다 — 보고의 "넘길 줄"에 적는다).
8. `tools/check-deps.ts`: `CORE_DOMAINS`에 `"domains"`를 더한다. `ROLE_NAMES`와 `HARNESS_DOMAIN_PROTOCOLS`는 건드리지 않는다.
9. 위험 test(`write-test`): 아래 "끝남"의 둘. 표 schema는 `apps/registration/commands_test.ts`처럼 `DatabaseSync(":memory:")`에 schema step을 올려 돌린다. subprocess·서버는 쓰지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "앱의 마지막 active domain은 보관되지 않고(`conflict`), project의 마지막 domain은 보관된다" — `packages/core/domains/commands_test.ts`
  - "agent는 자기 그릇이 아닌 owner에 domain을 만들지 못하고(`forbidden`), 이름이 겹치면 만들지 못한다" — 같은 file
- 남지 않음: 없음(새 file이다)

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것(lead): `packages/protocol/mod.ts`(`export * as domains`, `ALL_ROUTES`에 `DOMAIN_ROUTES`), `packages/core/main/daemon/assembly.ts`(`TEAMS`에 `createLedgerRegistration`과 `wiring/domains-registration.ts`의 `createCoreRegistration`, `TEAM_MODULES`에 두 file). `DOMAIN_AGENT_TOOLS`를 `packages/core/main/agent-tools.ts`에 모으는 일과 role 목록(`tool-lists.ts`)에 이름을 더하는 일은 `de-roles-core`가 한다
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `packages/core/projects/lookups.ts`·`packages/core/apps/lookups.ts`에 더한 읽기 함수
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

## lead가 먼저 할 것

- 이 task를 띄우기 전에 plan branch에 작은 commit 하나를 한다: 빈 `packages/core/domains/mod.ts`(`export {};`)와 `project-docs/module-catalog.yaml`·`project-docs/boundary-catalog.yaml`의 `domains` 항목(module `packages/core/domains`, boundary `domains`: "core의 domain entity(project나 app 안의 책임 경계)와 그 owner 규칙")이다. `tools/check-modules.ts`가 폴더와 catalog를 짝으로 보므로 worker의 check가 이것 없이는 서지 않는다.
- merge 직후, wave 2를 열기 전에 위 "등록할 것"(`protocol/mod.ts`, `assembly.ts`)을 commit하고 `deno task check`가 통과하는지 본다. `de-place-restore`가 임시로 `z.string()`으로 둔 `domains` 칸을 `idSchema("dom")`으로 좁힌다.
