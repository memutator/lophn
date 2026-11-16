# project-id-core

**opus high.**

기계를 넘는 project id의 계약과 ledger를 짓는다: 접두사 `pri`, 저장소 안 file의 꼴과 순수 함수(읽기, 충돌 풀기, remote key, 힌트), `ProjectRecord`의 새 칸, schema step, 폴더에서 읽은 값을 ledger에 적는 machine command `project.record_identity`와 한 기계 안 유일 규칙, clone이 project를 등록할 machine 자격, wave 2가 handler를 짓는 memory route의 protocol 정의. file I/O와 git은 하지 않는다(`project-id-sync`, `project-id-clone`).

- 단위: project-id-core (wave 1)
- 선행: 없음. `machine-identity`가 main에 land된 뒤 띄운다(그 계획도 `ids.ts`, `wiring/remote.ts`, lock을 고친다).
- 소유(이 task만 고친다):
  - `packages/protocol/base/ids.ts`
  - `packages/protocol/projects/identity.ts`(새 file. 순수 함수)
  - `packages/protocol/projects/identity_test.ts`(새 file)
  - `packages/protocol/projects/identity-api.ts`(새 file. memory route와 record command 정의)
  - `packages/protocol/projects/project-api.ts`
  - `packages/protocol/projects/values.ts`
  - `packages/protocol/projects/mod.ts`
  - `packages/core/projects/registry`
  - `packages/core/projects/lookups.ts`
  - `packages/core/projects/register.ts`
  - `packages/core/storage/migration/schema-steps.lock.json`
  - `packages/core/main/daemon/wiring/remote.ts`(`schemaStepsAfterTeams` 끝의 한 줄과 그 import만)
- 읽을 것:
  - 계획: `project-docs/plan/project-identity/README.md`의 "정한 것"과 "다른 계획이 기대는 계약" 1·2·5·6
  - 조사: `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md` F(project 표, `prj_` id를 key로 쓰는 표, file 자리)
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 9.1(remote 정규화 규칙의 표), 9.2(한 기계에 같은 key 둘), `t3code.md` 8.2(local remote 버림, 대표 remote), `paseo.md` 8.2(scp·ssh·http 꼴, 기본 아닌 port만 남김, `#subdir`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `projects`, `project-docs/module-catalog.yaml`의 `packages/core/projects`
  - 지금 코드: `packages/core/projects/registry/schema.ts`(`projectsSchemaSteps`, trigger 넷), `model.ts`(`Project`), `rows.ts`(`projectFromRows`), `store.ts`(`insertProject`, `replaceMetadata`는 칸을 이름으로 적어 새 칸을 덮지 않는다. 그대로 둔다), `reads.ts`(`list`의 page basis), `commands.ts`(`register`의 `requireUser`, `set_icon`은 revision을 올리지 않는다), `record.ts`, `registry_test.ts`(저장소만 쓰는 준비)
  - machine 자격 본보기: `packages/core/apps/registration/source-folder.ts`의 `SOURCE_FOLDER_CONTEXT`, `packages/core/apps/registration/commands.ts`의 `requireWriter`(user·agent·machine), `packages/protocol/apps/apps.ts`의 `appConnectSource`(actors에 `machine`)
  - memory route 본보기: `packages/protocol/diagnostics/diagnostics.ts`의 `defineMemory` route, machine-identity 계약의 `machineStatus`(`packages/protocol/machine/mod.ts`)
  - ledger step 규칙: AGENTS.md "호환성", `packages/core/main/daemon/wiring/remote.ts` 머리 주석과 `schemaStepsAfterTeams`, `packages/core/apps/sync/schema.ts` 머리 주석(끝에 붙는 step의 주석 꼴)
- 계약:
  - 쓰는 것: `idSchema`, `createIdSource`(test에서 id 만들기), `Result`
  - 내놓는 것:
    - `ids.ts`의 `ID_PREFIXES`에 `pri: "ProjectIdentity"`.
    - `packages/protocol/projects/values.ts`: `projectIdentitySchema = idSchema("pri")`.
    - `packages/protocol/projects/identity.ts`(node import 없음, renderer와 폰이 import한다):
      - `PROJECT_IDENTITY_FILE = ".lophn-project.json"`, `IDENTITY_FORMAT = 1`.
      - `serializeIdentityFile(id): string` = `JSON.stringify({ lophn_project: 1, id }, null, 2) + "\n"`.
      - `parseIdentityFile(text: string): { kind: "ok"; id } | { kind: "conflict"; id; ids: string[] } | { kind: "unreadable"; reason: "empty" | "not_json" | "bad_shape" | "newer_format" }`. 충돌 표지가 있으면 `<<<<<<<`~`=======`(diff3면 `|||||||` 앞까지)와 `=======`~`>>>>>>>`를 각각 JSON으로 읽어(표지 밖 줄은 양쪽에 다 붙인다) 맞는 id를 모으고, 가장 작은 id(문자열 비교. ULID라 먼저 만든 것)가 `id`다. 한쪽도 못 읽으면 `unreadable`(`bad_shape`).
      - `remoteKeyOf(remotes: readonly { name: string; url: string }[], subpath: string): { key: string; url: string } | null`. README "정한 것"의 remote 규칙. `url`은 고른 remote의 URL에서 `user:password@`의 자격만 뗀 것(scp의 `git@`은 남긴다). `subpath`가 빈 글이 아니면 key 뒤에 `#<subpath>`(`/`로 잇는다).
      - `type ProjectKeys = { id: string; identity: string | null; remote_key: string | null }`, `matchProjects(local, other)`(README 계약 5).
    - `ProjectRecord`(`project-api.ts`의 `projectRecordSchema`)에 `identity: projectIdentitySchema.nullable()`, `repo: z.enum(["git", "none"]).nullable()`, `remote: z.object({ key: z.string(), url: z.string() }).nullable()`.
    - `project.list` 입력에 `identity: projectIdentitySchema.optional()`(그 id를 가진 project만. 없으면 빈 목록).
    - `identity-api.ts`의 `projectIdentityApi`(mod.ts에서 `export *`):
      - `recordIdentity`: `defineCommand`, resource `projects`, method `record_identity`, name `project.record_identity`, input `z.strictObject({ project: projectIdSchema, found: z.boolean(), repo: z.enum(["git","none"]).nullable(), file_identity: projectIdentitySchema.nullable(), remote: z.strictObject({ key: z.string().min(1).max(1024), url: z.string().min(1).max(2048) }).nullable() })`, output `projectRecordSchema`, changes `projects`, actors `["machine"]`, errors `invalid_input`·`not_found`·`forbidden`. handler가 이 task에 있으므로 mod.ts의 `ROUTES`에 이 task가 펼친다.
      - memory route 넷: `identity`(name `project.identity`, input `{ project }`, actors `["user","agent"]`, 출력 README 계약 3의 `projectIdentityStatusSchema`), `createIdentity`(`project.create_identity`, input `{ project }`, actors `["user","agent"]`, 출력 같은 status), `renewIdentity`(`project.renew_identity`, input `{ project }`, actors `["user"]`, 출력 같은 status), `match`(`project.match`, input `{ path: absolutePathSchema }`, actors `["user"]`, 출력 `projectMatchSchema` = `{ found, repo, file, identity, remote, same: ProjectRecord | null, suggestions: ProjectRecord[] }`). errors는 route마다 `invalid_input`·`not_found`·`conflict`·`forbidden`·`unavailable` 가운데 쓰는 것만. `changes`는 `projects`. 넷을 `PROJECT_IDENTITY_MEMORY_ROUTES`로 export하되 **`ROUTES`에 펼치지 않는다**: core 기동은 handler 없는 memory route를 거절한다(`core.ts`의 `memoryRouteMismatch`). handler를 짓는 `project-id-sync`가 펼친다. `project.clone` route는 `project-id-clone`이 자기 file에 정의한다.
    - `packages/core/projects/registry/contexts.ts`(registry/mod.ts에서 export): `PROJECT_IDENTITY_CONTEXT`(principal `machine:projects-identity`, operation `project.record_identity`만), `PROJECT_CLONE_CONTEXT`(principal `machine:projects-clone`, operation `project.create`만). 꼴은 `SOURCE_FOLDER_CONTEXT`. wiring의 `records`에 올리는 것은 wave 2다.
    - `packages/core/projects/lookups.ts`: `projectByIdentity(sql, identity): string | null`(prj id).
    - schema step `projects.registry.identity`(`registry/schema.ts`의 `PROJECTS_IDENTITY_STEPS`, 아래 할 일 3).

## 할 일

1. 접두사, `projectIdentitySchema`, `identity.ts`의 순수 함수를 위 계약대로 짓는다. remote 규칙: fetch URL만 받는다(입력이 이미 이름과 URL 짝이다). local remote(`file:`, `/`나 `.`으로 시작하는 경로, `C:\` 같은 drive, scp 꼴이 아닌 경로)는 버린다. 고르는 순서 `origin`, `upstream`, 그다음 이름순. URL 꼴(`ssh://`, `git://`, `http(s)://`)과 scp 꼴(`[user@]host:path`)을 `host[:port]/path`로 맞춘다: host 소문자와 끝 점 제거, 자격 제거, 기본 port(ssh 22, https 443, http 80, git 9418) 제거, path의 앞뒤 `/`와 끝 `.git` 제거, host가 `github.com`이면 path도 소문자. `matchProjects`는 README 계약 5.
2. `ProjectRecord`와 `Project`에 세 칸을 더하고 `rows.ts`, `store.ts`(insert는 세 칸을 null로), `reads.ts`(`list`의 `identity` 거르기. page basis에 넣어 cursor가 거른 목록과 맞게), `record.ts`가 따라오게 한다. `project.update`·`relink_folder`·`archive`·`unarchive`는 세 칸을 건드리지 않는다.
3. schema step `projects.registry.identity`: `ALTER TABLE projects ADD COLUMN identity TEXT`, `ADD COLUMN repo TEXT CHECK (repo IS NULL OR repo IN ('git','none'))`, `ADD COLUMN remote_key TEXT`, `ADD COLUMN remote_url TEXT`, `CREATE UNIQUE INDEX projects_identity ON projects(identity) WHERE identity IS NOT NULL`. 기존 행은 모두 null이다. `registry/schema.ts`에 `PROJECTS_IDENTITY_STEPS`로 두고(머리 주석: 낸 목록 끝에 붙어야 해서 마지막 wiring의 `schemaStepsAfterTeams`에서 잇는다), `wiring/remote.ts`의 `schemaStepsAfterTeams` 맨 끝에 펼치고, `schema-steps.lock.json` 끝에 `{id, sha256}`를 더한다. 이미 낸 step은 고치지 않는다.
4. `project.record_identity` handler(`commands.ts`, `register.ts`의 commands 목록에 더한다). 자격은 machine이고 principal이 `machine:projects-identity`일 때만(아니면 `forbidden`). 규칙(README "정한 것"):
   - `found`가 false: 아무것도 바꾸지 않고 지금 record를 돌려준다(못 읽은 것은 아무것도 지우지 않는다).
   - `repo`, `remote_key`, `remote_url`은 받은 값으로 바꾼다.
   - `file_identity`가 null: `identity`는 그대로 둔다(file이 없거나 못 읽어도 잊지 않는다).
   - `file_identity`가 지금 값과 같다: 그대로.
   - 다르다: 그 id를 가진 다른 project(holder)가 없으면 이 project의 값으로 바꾼다. holder가 `archived`이고 이 project가 `active`면 holder의 값을 null로 하고 이 project에 준다. 그 밖이면 이 project의 `identity`를 null로 한다(같은 file을 읽은 두 번째 copy다).
   - `revision`은 올리지 않는다. `projects` change는 낸다. 다른 표(`project_folders`, session 등)는 건드리지 않는다.
5. `project.create`가 user에 더해 principal `machine:projects-clone`의 machine 자격을 받게 한다(route actors에 `machine`, handler의 `requireUser`를 그 principal만 더 받게). `authorizeProject`가 machine 자격을 어떻게 판정하는지 보고 막히면 machine principal을 통과시키는 최소 길을 낸다(`requireWriter`의 본보기).
6. `lookups.ts`에 `projectByIdentity`.
7. `identity-api.ts`의 route 정의를 위 계약대로 짓는다. `ROUTES`에는 `recordIdentity`만 펼친다. 출력 schema(`projectIdentityStatusSchema`, `projectMatchSchema`)는 이 file에서 export한다.

## 끝남

- `npm run check`가 통과한다(schema step lock 검사는 `npm run check:full`에도 걸리면 돌린다).
- 위험 test:
  - `packages/core/projects/registry/registry_test.ts`(저장소만, 표로): "새 step을 지나도 기존 project의 `prj_` id, name, 폴더, 그 id를 key로 쓰는 행이 그대로이고 `identity`는 null이다"(새 step 앞까지의 step으로 표를 만들고 project와 그 project를 key로 쓰는 다른 표 한 행을 넣은 뒤 새 step을 돌린다. 다른 표는 test 안에서 만든 작은 표로 충분하다), "`record_identity`: 없는 file은 id를 지우지 않고, 같은 id를 읽은 두 번째 active project는 null이 되고, 보관한 holder는 active project에 넘기고, id가 바뀌어도 `prj_` id와 폴더 행이 그대로다", "machine-projects-identity가 아닌 자격의 `record_identity`는 `forbidden`이다".
  - `packages/protocol/projects/identity_test.ts`(순수): "충돌 표지가 든 file은 어느 쪽 순서로 놓여도 가장 작은 id로 읽히고, 판이 더 높은 file은 `unreadable`이다", "remote URL의 자격(`user:token@`)이 key와 url 어디에도 남지 않는다".
- 남지 않음: 없음(새로 만든다).
- flows catalog: `project-register`(machine 자격 갈래), `project-read`(새 칸과 `identity` 거르기), 새 flow `project-identity-record`(entry `route:projects/record_identity`, area `projects`)를 `project-docs/flows/areas/projects.yaml`에서, 두 test file의 줄을 `project-docs/flows/tests/core-rest.yaml`에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). memory route 다섯의 flow는 wave 2가 쓴다. `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서:

- 넘길 줄: `wiring/remote.ts`의 `schemaStepsAfterTeams`에 `...PROJECTS_IDENTITY_STEPS` 한 줄과 import 한 줄. 이 file은 `machine-identity`와 다른 계획도 고치므로 다른 줄은 고치지 않는다.
- lead가 고칠 목록: 새 `architecture/project-identity.md`의 재료(record 규칙 표).
