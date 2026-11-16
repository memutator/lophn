# machine-id

**opus high.**

core에 기계 신분을 둔다: `<root>/machine.json`에 기계 id를 한 번 만들고, OS의 기계 값과 묶은 binding으로 복사된 data root를 기동 때 알아채 새 기계로 바꾸고, 컴퓨터의 이름(기본 hostname, 사람이 바꾸면 고정)을 들고, 그것을 `ctx.machine`과 memory route 둘로 낸다. 다른 다섯 계획이 이 모양 위에 선다.

- 단위: machine-id (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/machine`(새 폴더 전체)
  - `packages/protocol/machine`(새 폴더 전체)
  - `packages/protocol/base/ids.ts`
  - `packages/protocol/registry.ts`
  - `packages/core/main/daemon/core.ts`
  - `packages/core/main/daemon/wiring/machine.ts`(새 file)
  - `packages/core/main/daemon/assembly.ts`
  - `project-docs/module-catalog.yaml`
  - `project-docs/boundary-catalog.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/machine-identity/README.md`의 "정한 것"과 "다른 계획이 기대는 계약" 1
  - 조사: `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md` A(지금 신분 비슷한 것, 복사본이 나누는 것), (2)의 1·3
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 1.1~1.3(복제, Orca `machineBinding`), 2.2~2.3(rename-if-default)
  - architecture: `project-docs/architecture/platform.md`(core 수명, 기동, data root 하나에 core 하나)
  - boundary·module: `project-docs/boundary-catalog.yaml`과 `project-docs/module-catalog.yaml`의 `packages/core/remote`·`packages/core/diagnostics` 항목(꼴)
  - 본보기: `packages/core/storage/migration/ledger-id.ts`(root의 식별 file, temp에 쓰고 rename), `packages/core/remote/host-key.ts`(못 읽는 file을 덮지 않는다), `packages/core/main/daemon/wiring/diagnostics.ts`의 `build`가 내는 `memory` handler와 `packages/protocol/diagnostics/diagnostics.ts`의 `diagnosticsStatus`·`DIAGNOSTIC_STATUS_ROUTES`(그것을 `packages/protocol/registry.ts`의 `ROUTES`에 올리는 길), `packages/core/main/app-supervisor/main.ts`의 `createIdSource({ clock, random })`
  - 기동: `packages/core/main/daemon/core.ts` 200~235줄(migration → `applyDataSteps` → `ensureLedgerId` → `ctx.provide("ledgerId")`)
- 계약:
  - 쓰는 것: `packages/base`의 `Result`, `Clock`, `RandomSource`, `createIdSource`
  - 내놓는 것(README "다른 계약" 1을 그대로 짓는다):
    - `packages/protocol/base/ids.ts`의 `ID_PREFIXES`에 `mch: "Machine"`.
    - `packages/protocol/machine/mod.ts`: `machineIdSchema = idSchema("mch")`, `machineNameSchema = z.string().trim().min(1).max(64)`, `machineStatusSchema = z.strictObject({ id, name: machineNameSchema, name_source: z.enum(["hostname", "person"]), hostname: z.string(), cloned_from: machineIdSchema.nullable(), cloned_at: atSchema.nullable() })`, `type MachineStatus`, route `machineStatus`(`defineMemory`, resource `machine`, method `status`, name `machine.status`, input `{}`, actors `["user"]`, errors `invalid_input`·`forbidden`)와 `machineRename`(method `rename`, name `machine.rename`, input `z.strictObject({ name: machineNameSchema.nullable() })`, 출력 `machineStatusSchema`, actors `["user"]`, errors `invalid_input`·`forbidden`·`unavailable`), `MACHINE_ROUTES = [machineStatus, machineRename] as const`.
    - `packages/core/machine/mod.ts`:
      - `type MachineIdentity = { id: Id<"mch">; status(): MachineStatus; rename(name: string | null): Promise<Result<MachineStatus>> }`
      - `ensureMachine(deps): Promise<Result<MachineIdentity>>`. deps는 `{ root: string; osMachineId(): Promise<string | null>; hostname(): string; ids: IdSource; clock: Clock; logger?: Logger }`.
      - `readMachineId(root: string): Promise<Result<Id<"mch">>>`(file이 없거나 깨졌으면 `unavailable`). data step과 app supervisor가 쓴다.
      - `readMachineIdSync(root: string): Result<Id<"mch">>`: 같은 판정을 `readFileSync`로 한다. 비동기 기동 앞에서 도는 code(`always-on`의 OS 서비스 진입)가 쓴다. 두 함수는 parse·검사 함수 하나를 같이 쓴다.
      - `readOsMachineId(platform: NodeJS.Platform, io: { readFile(path): Promise<string>; exec(file: string, args: string[], timeoutMs: number): Promise<string> }): Promise<string | null>`
    - Late 칸 `machine: MachineIdentity`(`wiring/context.ts`. 아래 "넘길 줄").

## 할 일

1. `packages/protocol/machine/mod.ts`와 `ids.ts`의 접두사를 위 계약대로 짓는다. route 둘을 `packages/protocol/registry.ts`의 `ROUTES`에 올린다(`DIAGNOSTIC_STATUS_ROUTES`와 같은 길).
2. `packages/core/machine/os-id.ts`: `readOsMachineId`. Linux는 `/etc/machine-id`, 없으면 `/var/lib/dbus/machine-id`(trim해 32 hex만 받는다). macOS는 `ioreg -rd1 -c IOPlatformExpertDevice`의 `"IOPlatformUUID" = "<uuid>"`. Windows는 `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid /reg:64`의 값. 못 읽거나 꼴이 틀리거나 5초 안에 끝나지 않으면 null이다(던지지 않는다). file과 process는 `io` 인자로 받는다(AGENTS.md "코드"). 값은 log에 쓰지 않는다(systemd 문서가 machine-id를 비밀로 다루라고 한다).
3. `packages/core/machine/identity.ts`: `ensureMachine`, `readMachineId`, `readMachineIdSync`.
   - file은 `<root>/machine.json`, 꼴은 README 계약 1. 쓰기는 `ledger-id.ts`처럼 `machine.json.tmp`에 0600으로 쓰고 datasync한 뒤 rename한다.
   - `binding = HMAC-SHA256(key = OS 값, message = "lophn-machine:" + id)`의 hex. OS 값 자체는 어디에도 남기지 않는다.
   - 판정(기동마다 한 번):
     - file이 없다(ENOENT): 새 id(`ids.newId("mch")`), `name: null`, binding(OS 값이 없으면 null), `created_at`, `cloned_from: null`, `cloned_at: null`. 이 판 전부터 있던 설치도 이 길로 처음 id를 받는다(data step이 아니다: 기동마다 판정해야 해서다).
     - file을 읽지 못하거나 꼴이 틀리다: 덮지 않고 `unavailable`로 기동을 거절한다. message에 file path와 "지우면 이 컴퓨터는 새 기계가 되고 폰을 다시 pairing해야 한다"를 쓴다.
     - OS 값이 null: file 그대로. 경고 log 한 줄(값 없이).
     - 저장된 binding이 null이고 OS 값이 있다: binding만 채워 쓴다(복제 판정을 하지 않는다. 알 수 없으면 같은 기계).
     - binding이 맞다: 그대로.
     - binding이 다르다: 복제다. 새 id, `name: null`(hostname을 따른다), 새 binding, `cloned_from: <옛 id>`, `cloned_at: now`로 쓴다. 경고 log 한 줄(옛 id와 새 id). 다른 상태(host key, 기기 표, app sync node)는 여기서 건드리지 않는다: 각자 자기 표지(README "정한 것"의 기계에 묶인 상태 규칙)로 `machine-hello`와 `machine-consumers`가 맞춘다.
   - 이름: `status().name`은 `name ?? 기본`이고 `name_source`는 `name`이 있으면 `person`이다. 기본은 `hostname()`에서 끝의 `.local`을 떼고 64자로 자른 것, 비면 `"lophn"`. `hostname`은 status를 만들 때마다 읽는다(사람이 OS 이름을 바꾸면 따라간다).
   - `rename(name)`: trim한 이름(빈 글은 null로 본다)을 `machineNameSchema`로 검사하고(`invalid_input`) file을 다시 쓴다. 쓰지 못하면 `unavailable`이고 메모리 값도 바꾸지 않는다. null이면 hostname을 다시 따른다.
4. `core.ts` 기동: `applyMigrations` 뒤, `applyDataSteps` **앞**에 `ensureMachine`을 부르고(실패면 기동 실패) `ctx.provide("machine", …)`. data step `remote.host-key.machine`(`machine-hello`)이 `readMachineId`로 이 file을 읽으므로 순서가 계약이다. production 값: `osMachineId`는 `readOsMachineId(process.platform, { readFile, exec })`(`node:fs/promises`와 `node:child_process`의 `execFile`), `hostname`은 `node:os`의 `hostname`, `ids`는 `createIdSource({ clock, random })`. test가 core를 띄울 때도 그대로 돈다(한 기계 안에서는 OS 값이 고정이라 판정이 같다). 기동 options에 test용 `osMachineId`를 더하는 것은 필요할 때만.
5. `wiring/machine.ts`의 `machineWiring`: `build`가 `memory`로 `machine/status`(`ok(ctx.machine.status())`)와 `machine/rename`(`ctx.machine.rename(input.name)`)을 낸다. `assembly.ts`의 `WIRINGS`에 diagnostics 근처로 올린다(schema step이 없어 위치는 자유다).
6. module·boundary catalog: `module-catalog.yaml`에 `packages/core/machine`(boundary `machine`, notes에 "machine.json의 유일한 주인. 다른 module은 `ctx.machine`이나 `readMachineId`로만 읽는다"), `boundary-catalog.yaml`에 `machine`(kind와 꼴은 이웃 core module 항목을 따른다. description은 "설치마다의 기계 id, 복제 판정, 컴퓨터 이름"). `node tools/check-modules.ts`가 통과해야 한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/machine/identity_test.ts`, 임시 폴더와 가짜 `osMachineId`·`hostname`):
  - "OS 값이 같으면 `machine.json`을 다른 폴더로 옮겨 띄워도 id가 같고, OS 값이 다르면 새 id와 `cloned_from`이 생기고 사람이 지은 이름이 hostname으로 돌아간다"
  - "OS 값을 읽지 못하면 id와 binding을 그대로 두고, 깨진 `machine.json`은 덮지 않고 거절한다"
- 남지 않음: 없음(새로 만든다).
- flows catalog: 이 task가 더하는 route(`machine/status`, `machine/rename`)와 test file의 줄을 `project-docs/flows/`에서 고친다(자기 줄만. area는 `core-platform`. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서:

- 넘길 줄: `packages/core/main/daemon/wiring/context.ts`의 `Late`에 `machine: MachineIdentity;`(주석 한 줄: "기동이 data step 전에 낸다") 한 줄과 `LATE_KEYS`에 `machine: true` 한 줄만 더한다. 이 file은 `machine-device-kind`도 한 줄씩 더하므로 다른 줄은 고치지 않는다.
- 세 OS에서 실제로 읽어 본 것과 못 본 것(이 machine은 Linux다. macOS·Windows는 출력 견본으로 parse만 test했는지 적는다).
- lead가 고칠 목록: `architecture/platform.md`의 기동 순서, 새 `architecture/machine.md`의 재료(판정 표).
