# ad-discovery

skill 찾기 구현 둘(turn용 비동기 `discoverSkills`, 화면·`/` 메뉴용 동기 `listSkillsSync`)을 동기 구현 하나로 합친다. 동기 쪽을 남기는 이유는 core의 read handler(`ReadSkills`, `ListCommands`, agents read)가 동기라 비동기 구현을 부를 수 없고, agent runtime의 turn 준비는 비동기 함수 안에서 동기 함수를 그대로 부를 수 있기 때문이다. 합치면서 내장 skill의 role 거르기를 발견 한 곳(`role` 인자)으로 모은다. 지금 turn prompt의 skill 목록과 agents read의 skill 수는 role 없이(`role: null`) 찾은 목록을 써서, lophn과 Operator의 prompt에 `kinds-yaml`이 실리고(`skill.read`는 그 이름을 not_found로 낸다) Agents 탭의 skill 수에 다른 role의 내장 skill이 섞인다. ad-builtin-skills가 내장 skill 13개를 더하면 이 새는 곳이 커진다.

- 단위: discovery (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/extensions/{skills.ts,skill-read.ts,skill-folders.ts,skills-handler.ts,registry.ts,mod.ts,skills_test.ts}`
  - `packages/core/lophn-agent/extensions/skills-sync.ts`(지운다)
  - `packages/core/lophn-agent/extensions/adapters/node-fs.ts`
  - `packages/core/lophn-agent/register.ts`(skill import, `globalSkillSources`·`extensionRegistry`·`agentLookups`·`globalSkillNames`·`createSkillsRead`·`commandSkillsOf`를 부르는 줄만)
  - `packages/core/lophn-agent/run-loop/{prepare.ts,prepare_test.ts}`(`skills` dep에 role을 더하는 줄만)
  - `packages/core/lophn-agent/agents/{ports.ts,reads.ts}`(`AgentLookups.skills`에 role)
  - `packages/core/main/agent-runtime/product-driver.ts`(skill 발견 wiring만)
- 읽을 것:
  - 계획: `project-docs/plan/agent-definition/README.md`의 "정한 것"(skill 찾기는 동기 구현 하나로 합치고 `content_hash`와 딸린 `.md`의 실행 검사를 지운다, 내장 skill의 role 거르기를 찾기 안으로 옮긴다, 내장 skill은 모두 `can_disable: false`, 위험 test 둘). roadmap `project-docs/products/roadmap/agent-definition.md`의 "지금 코드"의 skill 줄(찾기 구현이 둘이다)
  - architecture: `project-docs/architecture/agent-definition.md` "지키는 것"의 "지침 층은 덮지 않고 이어 붙인다"(35-36줄: 끌 수 없는 내장 skill은 같은 이름의 사람 skill이 덮지 못한다, 층의 자리와 내장 skill 폴더는 role 층이 정하고 읽기 허락과 발견이 같은 값을 쓴다), "skill은 목록(이름과 설명)만 prompt에 넣고"(72줄), "agent 정의의 `domains`와 `skills`"(73줄: prompt 목록, `skill.read`, `/` 메뉴가 같은 규칙 `skillReceived`를 쓴다). `project-docs/architecture/layers.md` 76-78줄(harness는 role 이름을 모르고, 내장 skill은 role 층 `skills/`다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`(role 이름을 모르는 harness), `agents`, `run-loop`, `agent-roles`(내장 skill); `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/agent-roles`, `packages/core/main`
  - 코드(줄은 main `15f282fcd`. ae-builds는 아래 file을 고치지 않아 처음 쓴 `dd956b49f`와 줄이 같다)
    - `packages/core/lophn-agent/extensions/skills-sync.ts` 전체(207줄). `SyncSkillFiles` 25-32, `SkillSources` 36-41, `SkillListing` 44-47, `attempt` 51-57, `listSkillsSync` 60-207이 남길 구현이다. 196-205에서 `bundle_path`를 버린다.
    - `packages/core/lophn-agent/extensions/skills.ts`
      - 남길 것: `parseSkillFrontmatter` 101-145, `SkillCandidate` 173-179, `undeclaredBuiltinReason` 186-190, `builtinForRole` 193-197, `mergeSkillLayers` 203-242, `skillReceived` 247-254, `pickSkills` 258-270, `DomainStore` 297, `joinPath` 363-367, `folderSkipReason` 427-438
      - 지울 것: `sha256Hex` import 2, `SkillFilesPort` 17-29, `SkillSupplemental` 31-36, `SkillEntry`의 `content_hash`·`supplemental` 39-45, `Candidate`·`SkillDiscoveryInput` 274-295, `SkillDiscovery`와 비동기 `discoverSkills` 299-357(308-313이 끈 이름 형식을 보고 349-352가 role로 거른다), 빈 주석 359, `scanFolders` 369-425, `addBundle` 440-504, `scanSupplemental` 506-553(530-537이 실행 권한 검사)
    - `packages/core/lophn-agent/extensions/skill-read.ts`: `SkillSnapshotDeps` 22-33, `createSkillSnapshot` 55-146(66-75 비동기 발견. role은 이미 `session.role`을 넘긴다), `readFixed` 149-172(163-170이 `supplemental`을 읽는다), `turnSkillReader` 187-214
    - `packages/core/lophn-agent/extensions/skill-folders.ts`: `projectOff` 71-80, `domainStores` 84-104(97-100 `presentFolder`), `registeredSkillEntries` 107-114, `discoverProductSkills` 117-142(131줄 `role: null`이 prompt 쪽 새는 곳), `productSkillSnapshotDeps` 146-168, `presentFolder` 170-177, `productFiles` 197-323(허락 규칙 `inArea`·`projectPath`·`allowed` 201-238, `executable` 311-321), `under`·`privateRoot`·`lexical` 325-364
    - `packages/core/lophn-agent/extensions/skills-handler.ts` 107-119(`ReadSkills`, `role: null`), 121-128(내보내는 6칸)
    - `packages/core/lophn-agent/extensions/registry.ts`: 머리 주석 27-31, `ExtensionRegistry` 49-54, cache 열쇠 `key` 56-58(place뿐), `skills` 86-101(98줄 `role: null`), `commandSkillsOf` 121-147(137-139가 메뉴만 role로 거른다)
    - `packages/core/lophn-agent/extensions/adapters/node-fs.ts` 12, 47-82(`createNodeSkillFiles`: `lstat`로 보고 symlink를 따라가지 않는다)
    - `packages/core/lophn-agent/extensions/mod.ts` 7-28
    - `packages/core/lophn-agent/register.ts`: protocol import 115-131(`Role`이 없다), extensions import 132-147, `globalSkillSources` 365-376, 동기 file API 주석과 adapter 열기 378-391, `extensionRegistry` 392-413, `agentLookups` 427-460(433-437: 한 읽기의 등록부 하나를 그 읽기의 모든 agent가 같이 쓴다, 447-452 `skills`), `globalSkillNames` 462-472(470줄 `role: null`), `createSkillsRead` 643-654, `/` 메뉴 skill 686-707(699줄 `role: null`, 704줄 `session.role`)
    - `packages/core/lophn-agent/agents/ports.ts` 34-37, `agents/reads.ts` 53-86(57줄 `lookups.skills(loaded.place)`, 74-75줄 수), `agents/inspect.ts` 29-44(`openAgentContext`가 읽기마다 lookups 하나), `agents/resolve.ts`의 `AvailableSkill` 29-33과 `receivedSkills` 196-208
    - `packages/core/lophn-agent/run-loop/prepare.ts`: `SkillEntry` import 35, `skills` dep 168-169, `promptSkills` 272-286, 부르는 곳 530-533(prompt 목록)과 670-676(resolve의 재료)
    - `packages/core/main/agent-runtime/product-driver.ts`: skill import 57-62, `SKILL_PLACES` 68-72, `turnSkillReader` 225-229, `skills` dep 257-262
    - `packages/core/lophn-agent/commands/reads.ts` 23-37(`/` 메뉴 skill port가 받는 session에 `role`이 있다. 고치지 않는다)
    - `packages/protocol/lophn-agent/skill-settings.ts`의 `BUILTIN_SKILLS` 21-29와 `SkillEntry` 31-40(ad-builtin-skills가 `BUILTIN_SKILLS`의 `description`을 지운다. 이 task는 `name`, `roles`, `can_disable`만 읽는다)
    - `packages/core/lophn-agent/tools/bundles/skill.ts`(`skill.read`의 `path`), `packages/core/lophn-agent/tools/ports.ts` 50-57(`SkillReader`)
    - test의 가짜: `packages/core/lophn-agent/extensions/project-settings.ts`의 `DomainSkillLayer` 33-40·`ProjectLayer` 43-52, `extensions/place-store.ts`의 `PlaceFiles` 8-11
    - test: `.claude/skills/write-test/SKILL.md`, `packages/core/lophn-agent/extensions/skills_test.ts` 전체
- 계약:
  - 쓰는 것:
    - `packages/protocol/lophn-agent/skill-settings.ts`의 `BUILTIN_SKILLS`에서 `name`, `roles`, `can_disable`만 읽는다(ad-builtin-skills가 `description` 칸을 지운다), `SkillEntry`(protocol의 skill 한 줄 `{name, description, source, enabled, can_disable, domain}`)
    - core module graph에는 동기 file API를 두지 않는다(`register.ts` 378줄 주석). core 쪽 handler는 지금처럼 URL로 연 node-fs adapter를 쓴다.
  - 내놓는 것(`packages/core/lophn-agent/extensions/skills.ts`):
    - `type SkillFiles = { list(dir: string): readonly string[] | null; kind(path: string): "file" | "dir" | "symlink" | null; read(path: string, maxBytes: number): { text: string; complete: boolean } | null }`. 없으면 null이고 그 밖의 실패는 던진다(지금 `SyncSkillFiles`).
    - `type SkillSources = { bundled: string | null; registered: readonly string[]; personal: string | null; domains: readonly DomainStore[] }`
    - `discoverSkills(files: SkillFiles, sources: SkillSources, options: { role: Role | null; off: readonly string[] }): SkillListing`. `role`이 있으면 그 role에 선언된 내장 skill만 후보가 된다. null은 사람 화면(`ReadSkills`)만 쓴다.
    - `type SkillListing = { entries: readonly SkillEntry[]; skipped: readonly SkillSkipped[] }`, `type SkillEntry = SkillRow & { bundle_path: string }`
    - 이름을 그대로 두는 것: `parseSkillFrontmatter`, `mergeSkillLayers`, `skillReceived`, `pickSkills`, `builtinForRole`, `SKILL_MANIFEST`, `SKILL_BODY_MAX_BYTES`, `DomainStore`, `SkillSkipped`, `createSkillSnapshot`, `turnSkillReader`, `SkillSnapshotDeps`, `productSkillSnapshotDeps`, `productSkillStores`, `registeredSkillEntries`, `createSkillsRead`, `createExtensionRegistry`, `commandSkillsOf`
    - 없어지는 이름: `listSkillsSync`, `SyncSkillFiles`, `SkillFilesPort`, `SkillDiscovery`, 비동기 `discoverSkills`의 입력 `SkillDiscoveryInput`, `SkillEntry`의 `content_hash`·`supplemental`
    - role을 받는 곳: `ExtensionRegistry.skills(place: AgentPlace, role: Role | null): SkillListing`(cache 열쇠는 place와 role), `AgentLookups.skills(place: Place | null, role: Role): readonly AvailableSkill[]`, prepare deps `skills?(place: AgentPlace | null, role: Role): Promise<readonly SkillEntry[]>`, `registeredSkillEntries(machine, stores, role, agentOff?)`
    - `commandSkillsOf(entries, chosen, domains)`는 role로 이미 거른 목록을 받는다(ad-commands가 이름 그대로 쓴다).

## 할 일

줄 번호는 main `15f282fcd` 기준이다. 다른 계획 `reactor-remove`의 rr-program-from도 `prepare.ts`를 고친다(`noticeText` 근처의 program `from`). 그 task가 먼저 main에 land했으면 줄이 밀려 있으니 줄 대신 아래 이름으로 찾는다.

근거는 README "정한 것"의 "skill 찾기는 동기 구현 하나로", "내장 skill의 role 거르기를 찾기 안으로"와 `agent-definition.md` 73줄(prompt 목록, `skill.read`, `/` 메뉴가 한 규칙을 쓴다)이다. 작업 중에는 `deno test --no-check packages/core/lophn-agent/extensions packages/core/lophn-agent/agents packages/core/lophn-agent/run-loop/prepare_test.ts`만 돌린다.

1. 한 구현으로 합친다(`skills.ts`).
   - `skills-sync.ts`의 `SyncSkillFiles`(25-32)를 `SkillFiles`로 이름을 바꿔 옮기고, `SkillSources`(36-41), `SkillListing`(44-47), `attempt`(51-57)를 옮긴다. `listSkillsSync`(60-207)를 옮겨 `discoverSkills`로 이름을 바꾼다.
   - 결과 줄에 `bundle_path`를 남긴다(`readFixed`가 읽는다). 196-205의 map을 지우고 `mergeSkillLayers` 결과를 그대로 `SkillEntry`(`SkillRow & { bundle_path }`)로 낸다. `SkillListing.entries`는 `readonly SkillEntry[]`다. `ReadSkills`는 지금처럼 6칸만 골라 내므로 `bundle_path`가 밖으로 나가지 않는다(`skills-handler.ts` 121-128).
   - `skills.ts`에서 위 "읽을 것"의 지울 것을 지운다. `DomainStore`(297)는 남긴다. `folderSkipReason`과 `undeclaredBuiltinReason`은 `skills.ts` 안에서만 쓰게 되면 export를 뗀다.
   - 두 구현이 다른 곳은 동기 쪽을 따른다.
     - 아직 없는 내장·개인 보관소·domain 폴더는 조용히 빈 출처이고, 사람이 등록한 폴더가 없을 때만 `skipped`에 알린다(`reportMissing`). 지금 비동기 쪽은 부르는 곳의 `presentFolder`로 같은 일을 한다.
     - 끈 이름의 형식 검사(비동기 308-313의 `invalid_input`)는 두지 않는다. 끈 이름은 설정 schema(`skillNameSchema`)와 `parseProjectExtensions`가 이미 거른다.
     - 읽기 상한은 `SKILL_BODY_MAX_BYTES` 하나다. `max_file_bytes` 입력이 없다.
   - role 거르기는 합치기 전이다(지금 `listSkillsSync` 192-195와 같다). 그래서 다른 role의 내장 skill이 같은 이름의 사람 skill을 가리지 않는다.
   - 머리 주석(10-14)을 고친다: 발견은 동기다(core read handler가 동기라서), 파일 IO는 `SkillFiles`로 받는다, 내장 skill은 `role`에 선언된 것만 후보다.
   - `skills-sync.ts`를 `git rm`한다.
2. 딸린 파일과 `content_hash`
   - `SkillEntry`의 `content_hash`와 `supplemental`, 딸린 파일의 실행 권한 검사를 지운다. `content_hash`는 읽는 곳이 없고, 딸린 `.md`는 읽기만 하고 실행하지 않는다(README).
   - `skill-read.ts`의 `readFixed`(149-172)가 본문을 읽을 때 같은 `SkillFiles`로 `entry.bundle_path`를 `list`해 딸린 `.md`를 모은다. 받는 것은 `.`로 시작하지 않고, `SKILL.md`가 아니고, `.md`로 끝나고, `kind`가 `"file"`이고, `SKILL_BODY_MAX_BYTES` 안에서 다 읽힌 파일이다. 조건에 맞지 않는 파일(symlink, 폴더, 상한 넘김)은 건너뛴다. 지금 발견이 그런 파일을 `supplemental`에서 빼는 것과 같다. map 열쇠는 지금처럼 파일 이름이다(`skill.read`의 `path`).
   - `SkillFiles`가 던지면(허락 밖, IO 오류) `readFixed`는 그 skill을 읽을 수 없는 것(null)으로 둔다. 지금처럼 `skill.read`가 `unavailable`을 낸다.
3. port를 `SkillFiles`로 바꾼다.
   - `skill-read.ts`: `SkillSnapshotDeps.port`의 type만 `SkillFiles`로 바꾼다(칸 이름은 그대로). `createSkillSnapshot` 66-88은 `discoverSkills(deps.port, { bundled: deps.builtin_root, registered: global.roots, personal: deps.personal_store, domains: layer.domain_stores }, { role: session.role, off })`를 부르고 `found.ok` 갈래를 지운다. `readFixed`는 동기 함수가 된다. `skill-read.ts`와 `skills.ts`는 `mod.ts`를 거쳐 core graph(`register.ts`)에 실리므로 `node:fs`나 `Deno.*Sync`를 import하지 않는다.
   - `skill-folders.ts`의 `productFiles`(197-323)는 `SkillFiles`를 낸다. 허락 규칙(`inArea`, `projectPath`, `allowed`, `under`, `privateRoot`, `lexical`)은 그대로 두고, 허락 밖 path는 던진다. 읽기는 `adapters/node-fs.ts`의 `createNodeSkillFiles()`를 감싸 쓴다(`lstat`로 보고 symlink를 따라가지 않는 규칙이 지금 `openStat`과 같다). `executable`(311-321)을 지운다. `skill-folders.ts`는 agent runtime child(`product-driver.ts`)만 import한다. `mod.ts`에서 내보내지 않는다(내보내면 core graph에 `node:fs`가 실린다).
   - `presentFolder`(170-177)와 그 쓰임(`discoverProductSkills` 127·129, `domainStores` 97-100)을 지운다. 없는 폴더는 1의 발견이 조용히 넘긴다.
   - `projectOff`(71-80)는 동기 `port.read`를 부르고 던지면 끈 것이 없는 것으로 본다(지금 `read`가 실패하면 빈 목록인 것과 같다).
   - `discoverProductSkills`(117-142)를 `registeredSkillEntries`(107-114)에 합친다: `registeredSkillEntries(machine, stores, role: Role)`(부르는 곳이 넘기지 않는 `agentOff` 인자는 지운다)가 `discoverSkills(port, { bundled: stores.bundled, registered: roots, personal: stores.personal, domains: await domainStores(machine, stores) }, { role, off: [...new Set([...off, ...projectOff(...), ...agentOff])] }).entries`를 낸다.
4. prompt 쪽에 role을 넘긴다.
   - `prepare.ts` 168-169: `skills?(place: AgentPlace | null, role: Role): Promise<readonly SkillEntry[]>;`. 주석에 "그 role에 선언된 내장 skill만이다"를 더한다.
   - 부르는 곳 둘: 531 `deps.skills?.(resolved.place, resolved.role)`, 670 `deps.skills?.(session.place, session.agent.role)`.
   - `product-driver.ts` 257-262: `skills: (place, role) => registeredSkillEntries(calls.machine, productSkillStores(place, SKILL_PLACES), role)`. 257줄 주석에 role을 더한다. `turnSkillReader`(225-229)는 이미 `session.agent.role`을 넘기므로 고치지 않는다.
   - `prepare_test.ts`는 `promptSkills`만 보고 `as SkillEntry`로 만든 줄이라 고칠 것이 없을 수 있다. type이 깨질 때만 맞춘다.
5. 화면·`/` 메뉴·agents read 쪽에 role을 넘긴다.
   - `registry.ts`
     - `ExtensionRegistry.skills(place: AgentPlace, role: Role | null): SkillListing`. cache 열쇠를 place와 role 둘로 한다(예: `${place.kind}:${place.id}:${role ?? "all"}`). 이유: `agentLookups`는 한 읽기에서 등록부 하나를 같은 place의 여러 agent(PM과 그 project의 Operator)가 같이 쓴다(`register.ts` 433-437). 열쇠가 place뿐이면 먼저 읽은 role의 목록이 다른 role에 간다. MCP 서버의 cache(`servers`)는 그대로 place 열쇠다.
     - 92-98의 `listSkillsSync`를 `discoverSkills(deps.skillFiles, …, { role, off })`로 바꾼다. `deps.skillFiles`의 type은 `SkillFiles`다.
     - `commandSkillsOf`(121-147)에서 `role` 인자와 137-139의 `builtinForRole` 거르기를 지운다. 받은 목록은 이미 role로 걸렀다. 121-122 주석의 마지막 문장("내장 skill은 선언한 role의 메뉴에만 보인다")을 "받는 목록은 발견이 role로 거른 것이다"로 고친다.
     - 머리 주석(27-31)의 "비동기 발견을 기다리지 못한다"를 지운다. 발견은 하나이고 동기다.
   - `register.ts`
     - import: extensions(132-147)에서 `listSkillsSync`, `SyncSkillFiles`를 빼고 `discoverSkills`, `SkillFiles`를 넣는다. protocol import(115-131)에 `type Role`을 더한다.
     - adapter type(386-389): `createNodeSkillFiles(): SkillFiles`.
     - `agentLookups.skills`(447-452): `(place, role) => place === null ? globalSkillNames(sql, layers, role) : registryOf()?.skills(place, role).entries.filter((entry) => entry.enabled) ?? []`.
       - 정한 것: 두 갈래 모두 켜진 skill만 낸다. 이유: 지금 lophn 갈래(`globalSkillNames`)만 끈 skill을 빼서, place에 있는 agent의 Agents 탭 skill 수에는 전역·project에서 끈 skill이 섞인다. 같은 줄을 고치므로 맞춘다. 수를 세는 곳은 `agents/reads.ts` 74-75 하나다.
     - `globalSkillNames`(462-472): `role: Role` 인자를 받아 `discoverSkills(skillFiles, { ...globalSkillSources(sql, layers), domains: [] }, { role, off: registeredSkillsOff(sql) }).entries.filter((entry) => entry.enabled)`.
     - `/` 메뉴(692-706): place가 null이면 `discoverSkills(skillFiles, { ...globalSkillSources(sql, ports), domains: [] }, { role: session.role, off: registeredSkillsOff(sql) }).entries`, 아니면 `extensionRegistry(sql, ports)?.skills(session.place, session.role).entries ?? []`. `commandSkillsOf`에 role을 넘기지 않는다. 686-689 주석의 마지막 줄을 "내장 skill은 발견이 role로 거른다"로 고친다. 691줄 `roleCommands`와 `createCommandReads` 자체는 ad-commands가 고친다(건드리지 않는다).
     - `createSkillsRead`(644-654)는 그대로 `skillFiles`를 넘긴다(type만 바뀐다).
   - `agents/ports.ts` 34-37: `skills(place: Place | null, role: Role): readonly AvailableSkill[]`. 주석에 "그 role에 선언된 내장 skill과 켜진 skill만이다"를 더한다.
   - `agents/reads.ts` 57: `lookups.skills(loaded.place, loaded.role)`.
   - test의 가짜 lookups(`agents/commands_test.ts` 22, `agents/reads_test.ts` 27의 `skills: () => []`)는 인자를 덜 받아도 type이 맞아 고치지 않는다.
6. 나머지 이름을 맞춘다.
   - `skills-handler.ts`: import(18-23)를 `skills.ts`의 `discoverSkills`, `type SkillFiles`, `type SkillSources`로 바꾼다. `SkillsReadDeps.skillFiles: SkillFiles`. 107-119는 `discoverSkills(deps.skillFiles, …, { role: null, off })`다. 사람 화면이라 role이 null이다(README). 25-29 머리 주석의 "내장 skill은 role을 가리지 않고 모두 낸다"는 그대로 맞다.
   - `mod.ts` 7-26: `skills.ts`에서 `discoverSkills`, `type SkillFiles`, `type SkillSources`, `type SkillListing`을 더 내보내고, `type SkillFilesPort`, `type SkillDiscovery`와 `./skills-sync.ts` 묶음(21-26)을 지운다.
   - `adapters/node-fs.ts` 12: `import type { SkillFiles } from "../skills.ts";`, 48: `createNodeSkillFiles(): SkillFiles`.
7. 옛 test를 정리한다(`skills_test.ts`).
   - `treeOf`(17-43)는 `SkillFiles` 하나를 낸다(`port`와 `sync` 둘이 아니다). `executable`이 없다. 부르는 곳(145, 224, 283, 315)을 맞춘다.
   - 두 구현을 비교하던 줄을 지운다: 178-188(같은 규칙을 동기로 한 번 더 읽기)과 314-333(동기 목록의 domain 줄). 이제 한 구현이라 같은 동작을 두 번 본다(`write-test` "이미 다른 test가 보는 동작"). 같은 이름의 domain skill이 domain마다 남는 것은 그 test의 앞쪽(`createSkillSnapshot`이 `dom_b`에 `B`를 준다)이 이미 본다.
   - 나머지(끌 수 없는 내장 skill의 표 `CASES`, 끌 수 있는 skill, 고른 이름, 같은 이름의 domain skill)는 `createSkillSnapshot`으로 그대로 둔다. `CASES`의 Operator 두 줄은 `skill.read` 쪽(`createSkillSnapshot`)을 보므로 남긴다.
8. 위험 test 하나를 `skills_test.ts`에 더한다. 이름은 "skill에 role을 적으면 다른 role의 prompt와 / 메뉴에 뜨지 않는다"다. 순수 함수와 가짜 port이고 준비는 한 번, 표 하나다(`write-test` "모양").
   - tree(메모리): `/b/kinds-yaml/SKILL.md`(내장 폴더, description `built-in`)와 `/g/kinds-yaml/SKILL.md`(사람이 등록한 폴더, description `human`). 지금 `skillFile` helper는 description을 고정하므로 description을 받게 고친다. 출처는 `{ bundled: "/b", registered: ["/g"], personal: null, domains: [] }`다.
   - 메뉴 재료: `createExtensionRegistry` 하나를 표 전체가 같이 쓴다. deps는 root `/r`, 가짜 `ProjectLayer`(`projectOf`는 null, 나머지 자리는 아무 데도 없는 path), `files`는 `{ read: () => null, writeAtomic: () => {} }`, `skillFiles`는 위 tree, `domains`는 빈 목록, `global`은 `{ servers: [], skills: { bundled: "/b", registered: ["/g"], personal: null }, skillsOff: [] }`다.
   - 표(이 순서로 돈다. PM 뒤에 같은 project의 Operator를 읽어 등록부 cache가 role을 나누는지 본다):

     | role | place | 기대 description |
     |---|---|---|
     | `lophn` | null | `human` |
     | `project_manager` | project `prj_01` | `built-in` |
     | `operator` | project `prj_01` | `human` |
     | `app_engineer` | app `app_01` | `built-in` |
     | `operator` | app `app_01` | `human` |

   - 줄마다 두 가지를 본다.
     - prompt 재료: `discoverSkills(files, sources, { role, off: [] }).entries`에서 이름이 `kinds-yaml`인 줄의 description 목록이 `[기대]`다.
     - `/` 메뉴: place가 null이면 위 prompt 재료를, 아니면 `registry.skills(place, role).entries`를 `commandSkillsOf(…, [], [])`에 넣는다(`register.ts`의 `/` 메뉴와 같은 갈래). 결과에서 이름이 `kinds-yaml`인 줄의 description 목록이 `[기대]`다.
   - 판정은 description으로 한다. 메뉴 줄의 출처 칸(`origin`)은 ad-commands가 바꿀 수 있다. 호출 횟수를 세지 않는다.
   - 이 test 하나만 더한다. prompt 목록을 조립하는 `registeredSkillEntries`는 core loopback과 실제 폴더를 읽어 가볍게 준비할 수 없다. 그 함수는 role을 `discoverSkills`에 그대로 넘기기만 하므로 test하지 않는다.
9. 남은 이름을 grep한다(아래 "끝남"). `deno task check`를 돌린다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "skill에 role을 적으면 다른 role의 prompt와 / 메뉴에 뜨지 않는다"(`packages/core/lophn-agent/extensions/skills_test.ts`). README의 위험 test 첫째다.
- 기존 test가 그대로 통과한다: `skills_test.ts`의 `kinds-yaml stays: …` 표, "a skill that can be turned off goes off, …", "the agent gets only the skills it chose, …", "same-name skills in a global layer and domains go to the agent by the domains it works in", `prepare_test.ts` 둘.
- 남지 않음: `git grep -nE "listSkillsSync|SyncSkillFiles|SkillFilesPort|SkillDiscovery|skills-sync|content_hash|supplemental" -- packages/core/lophn-agent packages/core/main`이 0줄이다.
- role 없이 찾는 곳은 사람 화면 하나다: `git grep -n "role: null" -- packages/core/lophn-agent/extensions packages/core/lophn-agent/register.ts ':!*_test.ts'`가 `extensions/skills-handler.ts` 한 줄이다.
- 내장 skill의 role 거르기는 발견 한 곳이다: `git grep -n "builtinForRole(" -- packages ':!*_test.ts'`가 `extensions/skills.ts`의 정의와 `discoverSkills` 안의 한 줄이다.
- core graph에 동기 file API가 없다: `git grep -nE "node:fs|Sync\(" -- packages/core/lophn-agent/extensions/skills.ts packages/core/lophn-agent/extensions/skill-read.ts packages/core/lophn-agent/extensions/registry.ts packages/core/lophn-agent/extensions/skills-handler.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음이면 "없음". 계획 끝에 lead가 `project-docs/architecture/agent-definition.md` 73줄에 "내장 skill은 선언한 role의 agent만 발견한다. prompt 목록, `skill.read`, `/` 메뉴, Agents 탭의 skill 수가 같은 발견을 쓰고, 사람 화면(`ReadSkills`)만 role 없이 모두 본다"를 더한다(README "다 끝나면"). 그 밖에 lead가 고칠 목록 file
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 예상은 `builtinForRole`(이제 `skills.ts` 안에서만 부른다. 계약이 이름을 남긴다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것": 두 갈래 모두 켜진 skill만, 그리고 두 구현이 다른 곳에서 동기 쪽을 따른 것을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
