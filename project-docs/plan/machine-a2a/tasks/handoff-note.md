# handoff-note

session이 handoff note를 남기고 그 note가 다른 기계로 흐르게 한다. agent는 `lophn handoff write`로 어디까지 했고 다음이 무엇인지 쓰고, program은 기계, project 정체(`pri_`), branch와 commit, 시각을 붙인다. note는 `computers` 폴더의 자기 하위 폴더에 file로 놓여 mail과 같은 길(folder-sync: 연결, 폰, 같이 보는 폴더)로 가고, 다른 기계는 `handoff/list`로 자기에게 있는 project의 note를 읽는다. 화면은 `handoff-screen`이 한다.

- 단위: handoff (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/handoff.ts` (새 file)
  - `packages/protocol/remote/{carry.ts,carry_test.ts}`
  - `packages/core/folder/export/manifest.ts`
  - `packages/core/projects/handoff/{write.ts,list.ts,handoff_test.ts}` (새 file)
  - `packages/core/projects/identity/git.ts`
  - `packages/core/main/daemon/wiring/{handoff.ts,folder.ts,context.ts}` (`handoff.ts`는 새 file)
  - `packages/cli/commands/handoff.ts` (새 file)
  - `packages/coding-agent/skills/lophn-agent.ts`
- flows(줄만 고친다): `project-docs/flows/areas/agents.yaml` 또는 `projects.yaml`(`handoff/write`, `handoff/list`, CLI `handoff write`. `node tools/flows.ts entries --unaccounted`로 area를 정하고 `areas.yaml`의 그 area entries에 `handoff.ts`를 더한다), `project-docs/flows/tests/core-rest.yaml`, `project-docs/flows/tests/libs-tooling.yaml`
- 읽을 것:
  - 계획 README "정한 것"(handoff note), roadmap `a2a-multi-device.md` "handoff note"와 정한 것 6·9·13·14
  - architecture: `project-docs/architecture/folder-sync.md` "내 컴퓨터들(`computers`)과 옮기는 길", "목록의 사슬"; `project-docs/architecture/project-identity.md`(두 id, git을 읽기만 한다); `project-docs/architecture/agent-call.md` 시야 10(private)
  - `project-docs/plan/machine-a2a/tasks/mail-carry.md`(같은 꼴로 manifest에 `mail` 칸을 더한 길. 이 task는 `notes` 칸을 더한다)
  - 본보기: `packages/core/folder/export/manifest.ts`의 선택 칸 `packages`·`mail`, `packages/core/folder/import/mail.ts`(다른 기계 폴더 읽기와 검사), `packages/core/projects/lookups.ts`의 `projectByIdentity`
- 계약:
  - 쓰는 것: `ctx.peek.computerSigningKey`, `ctx.peek.machineLinks`(컴퓨터 이름), call 정책의 `isPrivate`, `createFolderWriter`·`createFolderReader`, `COMPUTERS_DIR`
  - 내놓는 것(`handoff.ts`, `handoff-screen`이 쓴다):
    - `HANDOFF_TEXT_MAX_BYTES = 32 * 1024`, `HANDOFF_MAX_AGE_MS = 7일`
    - `handoffFileSchema = z.object({ format: z.literal(1), machine: idSchema("mch"), session: idSchema("ses"), identity: idSchema("pri"), agent: z.string().min(1).max(64), name: z.string().min(1).max(64), text: z.string(), branch: z.string().nullable(), commit: z.string().nullable(), written_at: atSchema })`
    - `handoffWrite = defineMemory({ resource: "handoff", method: "write", name: "handoff.write", input: z.strictObject({ text: z.string().min(1) }), output: z.strictObject({ identity: idSchema("pri"), branch: z.string().nullable(), commit: z.string().nullable(), written_at: atSchema }), actors: ["agent"], errors: ["invalid_input", "forbidden", "not_found", "unavailable"] })`
    - `handoffNoteSchema = z.strictObject({ machine: idSchema("mch"), computer: z.string(), session: idSchema("ses"), project: idSchema("prj"), agent_name: z.string(), text: z.string(), branch: z.string().nullable(), commit: z.string().nullable(), written_at: atSchema })`(`project`는 이 기계의 project)
    - `handoffList = defineMemory({ resource: "handoff", method: "list", name: "handoff.list", input: z.strictObject({ project: idSchema("prj").optional() }), output: z.strictObject({ notes: z.array(handoffNoteSchema) }), actors: ["user"], errors: ["invalid_input", "forbidden", "unavailable"] })`. 새것부터.
    - `HANDOFF_ROUTES`
    - `carry.ts`: `NOTE_FILE_MAX_BYTES = 64 * 1024`, `notesDir(machine) = machines/<mch>/notes`, `noteFilePath(machine, session) = machines/<mch>/notes/<ses>.json`, manifest 선택 칸 `notes`(`mail`과 같은 규칙).

## 할 일

1. protocol: `handoff.ts`와 `carry.ts`의 `notes`(path 읽기, manifest refine, `manifestEntries`). 칸을 모르는 schema로 읽어도 서명이 검증되는지 `carry_test.ts`.
2. `git.ts`의 `GitReader`에 `head(dir): Promise<{ branch: string | null; commit: string | null }>`(`rev-parse --abbrev-ref HEAD`, `rev-parse HEAD`. git이 아니거나 읽지 못하면 둘 다 null. 읽기만 한다).
3. `handoff/write`(`projects/handoff/write.ts`, `wiring/handoff.ts`가 memory로 낸다): `ctx.conditions.session`의 session을 읽는다. workspace가 project가 아니면 `invalid_input`("a handoff note belongs to a project session"), 그 project가 이 기계의 call 정책에서 private이면 `forbidden`(roadmap 정한 것 13), `identity`가 null이면 `invalid_input`("this project has no id shared across computers; run lophn project share"). 글이 `HANDOFF_TEXT_MAX_BYTES`를 넘으면 `invalid_input`. redaction을 거친다. 첫 등록 폴더의 `head`로 branch와 commit, `ctx.clock`으로 시각, agent 이름은 `requesterName`. `computers` 폴더의 `noteFilePath(me, session)`에 `encodeRecord`로 쓴다(session마다 하나. 다시 쓰면 바꾼다: temp와 rename). 쓴 뒤 나르기를 깨운다(아래 5).
4. `handoff/list`(`projects/handoff/list.ts`): `computers` 폴더의 다른 기계마다 `notesDir(origin)`을 읽는다. file을 `handoffFileSchema`로 읽고, `file.machine === origin`, `computerSigningKey(origin) !== null`, `written_at`이 `HANDOFF_MAX_AGE_MS` 안, `projectByIdentity(identity)`가 이 기계의 active project이고 그 project가 private이 아닐 때만 낸다. 컴퓨터 이름은 명단에서. input `project`가 있으면 그 project만.
5. 나르기(`wiring/folder.ts`, `export/manifest.ts`): manifest가 `notesDir(me)`를 읽어 `notes` 칸에 싣는다(`packages`처럼 폴더를 읽는다. temp와 rename으로만 놓인다). `carryOut`이 `HANDOFF_MAX_AGE_MS`보다 옛 자기 note file을 지운다. 다른 wiring이 나르기를 깨우는 late key `folderCarry: { kick(): void }`를 `context.ts`에 더하고 folder wiring이 낸다.
6. CLI `handoff.ts`: `handoff.write`("Leave a handoff note for this session: where the work stands and what comes next. It replaces this session's earlier note. lophn adds this computer, the project's shared id, the git branch and commit and the time, and carries the note to the person's other computers, where the person can continue from it."), input `{ body: z.string().min(1) }`, routes `[handoffWrite]`, `workspaces: ["project"]`, `effect: "write"`.
7. skill `lophn-agent.ts`: "Handoff note" 짧은 절. 언제 쓸지는 지침과 사람이 정한다(program은 쓰라고 하지 않는다. roadmap 정한 것 14). 다른 컴퓨터가 켜져 있으면 note 대신 `call send --on <computer> --reply none`으로 넘긴다. transcript, file, commit하지 않은 변경은 가지 않으니 note에 어디서 가져올지(branch, push 여부)를 쓴다.

## 끝남

- `npm run check`가 통과한다. 폰이 `carry.ts`를 같이 읽으므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다.
- 위험 test(`packages/core/projects/handoff/handoff_test.ts`, 임시 data root와 SQLite. handler 입력에서 file과 목록까지):
  - "private workspace의 session은 handoff note를 남기지 못하고 file이 생기지 않으며, 받는 기계에서 private인 project의 note는 목록에 보이지 않는다"
  - "지금 명단의 컴퓨터 폴더에 있고 그 기계가 쓴 7일 안의 note만 목록에 보인다"
- 남지 않음: `grep -rn "handoff_notes" packages tests`가 0줄이다(ledger 표를 만들지 않았다. note는 file 하나다).

## 보고

- 바꾼 file
- 통과한 check(폰 포함)
- 등록할 것: `HANDOFF_ROUTES`(→ `packages/protocol/lophn-agent/registry.ts`), `handoffWiring`(→ `WIRINGS`, `remoteWiring` 앞), `handoff` 명령 목록(→ `packages/cli/commands/mod.ts`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
