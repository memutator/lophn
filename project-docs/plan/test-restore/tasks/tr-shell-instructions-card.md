# tr-shell-instructions-card

Agents 탭 Instructions 카드가 `instructions.open`이 주는 path를 이미 있는 file read IPC(`FILE_READ_CHANNEL`)로 읽어 project LOPHN.md 내용을 보이게 한다. 이것 하나 때문에 남은 renderer의 `Link.worker`와 IPC kind `"worker"`를 지운다. core route는 넓히지 않는다.

- 단위: shell (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/core-extensions.ts`
  - `packages/shell/renderer/workspace/agents/core-link.ts`
  - `packages/shell/renderer/workspace/agents/core-source.ts`
  - `packages/shell/renderer/workspace/agents/core-source_test.ts`
  - `packages/shell/ipc/core.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/agent-definition.md`의 "Agents 탭의 Instructions 카드가 LOPHN.md 내용을 늘 비워 보인다"(20-33. "고치려면"의 첫 줄이 추천안이다)
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것" 마지막에서 두 번째 줄(Instructions 카드)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`; `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/shell/ipc`
  - 코드
    - 지금 길: `packages/shell/renderer/workspace/agents/core-extensions.ts` 176-208(`readInstructions`: `instructions.open` 뒤 `link.worker("documents", "read", …)`), `packages/shell/renderer/workspace/agents/core-source.ts` 70-85(`AgentsDeps`, `windowInstructions`), 127-139(`coreAgentsSource`의 deps), 383-389(`instructionsOf`. overview 406-411, agent 상세 355, 새 Operator 532가 부른다), `packages/shell/renderer/workspace/agents/core-link.ts` 15-39·41-86(`Link`, `createLink`), `packages/shell/ipc/core.ts` 1-22(`coreCallSchema`의 kind)
    - main 쪽(고치지 않는다): `packages/shell/main/editor/instructions.ts` 32-58(`open`은 path만 정하고 `document`·`version`은 늘 null이다. project에 폴더가 있으면 그 첫 폴더의 `LOPHN.md`, 없으면 `<data root>/projects/<prj>/`를 만들고 그 아래 `LOPHN.md`), `packages/shell/main/desktop/wiring/editor.ts` 62-73(`firstFolder`는 core의 project 목록을 읽기만 한다), `packages/shell/main/editor/ipc.ts` 88-97(`FILE_READ_CHANNEL` → `adapter.read`), `packages/shell/main/editor/file-adapter.ts` 171-197(`accept`: data root의 `secrets.json`만 거절한다), 304-321(`read`)
    - IPC와 bridge: `packages/shell/ipc/instructions.ts`(`InstructionsApi`, 결과 `path`), `packages/shell/ipc/files.ts` 38(`fileReadSchema`), 72(`FileText`), 98-107(`FileReply`, `FilesApi.read`), `packages/shell/preload/shell.ts` 113(`lophnFiles`를 desktop 창에 연다), `packages/shell/renderer/desktop/launcher/projects/core-source.ts` 76-79(`windowFiles` 꼴)
    - 카드: `packages/shell/renderer/workspace/agents/agents-tab.tsx` 132(`overview.instructions.text`의 앞 줄을 미리 보인다. 고치지 않는다)
- 계약:
  - 쓰는 것: `packages/shell/ipc/instructions.ts`(`instructions.open` 결과의 `path`), `packages/shell/ipc/files.ts`(`FILE_READ_CHANNEL`, `fileReadSchema`), `packages/shell/preload/files-api.ts`(renderer의 `read`), `packages/shell/main/editor/ipc.ts`(main 쪽 file read handler. 고치지 않는다)
  - 내놓는 것: IPC `core` 요청의 `kind`는 `"read" | "command" | "memory" | "upload" | "file"`이다.

## 할 일

근거는 이슈의 추천안과 README "정한 것"이다. 지금 카드가 비는 까닭은 둘이다: main의 `open`이 `document`·`version`을 늘 null로 주어 `readInstructions`가 188-191에서 바로 `""`를 돌려주고, 그 뒤의 `documents.read` worker route도 core·main allowlist에 없다.

`instructions.open`의 부수 효과: 편집기 탭을 열지 않고(탭은 [Edit]의 `packages/shell/renderer/editor/instructions-entry.tsx`가 연다) `LOPHN.md`를 만들지도 않는다. 폴더가 없는 project에서만 `<data root>/projects/<prj>/` 폴더 하나를 만든다. Agents 탭은 지금도 overview·상세를 읽을 때마다 `open`을 부르므로 읽기에 쓰면서 새 부수 효과가 생기지 않는다. 피할 일이 없다.

1. `packages/shell/renderer/workspace/agents/core-extensions.ts`
   - `readInstructions(instructions: InstructionsApi | undefined, files: Pick<FilesApi, "read"> | undefined, place: string): Promise<string>`로 바꾼다(`link` 인자를 뺀다). `open({ target: { layer: "project", place } })`가 ok면 `files.read({ path: opened.value.path })`의 `text`, 실패나 bridge 없음이면 `""`다. 파일이 아직 없으면 read가 실패하고 `""`다. `document`·`version` 검사를 지운다. 던지는 것은 지금처럼 `""`로 받는다.
   - 머리의 doc 주석(176)에 무엇을 읽는지 적는다: [Edit]이 여는 path(`instructions.open`)를 shell main의 file read로 읽는다.
   - `FilesApi` type을 `../../../ipc/files.ts`에서 import한다.
2. `packages/shell/renderer/workspace/agents/core-source.ts`
   - `AgentsDeps`(70-79)에 `files: Pick<FilesApi, "read"> | undefined`를 더한다(주석: project LOPHN.md를 읽는 main file 통로. 없으면 지침 미리보기는 빈 글이다).
   - `windowInstructions`(81-85) 옆에 `windowFiles()`를 둔다: `globalThis.lophnFiles`가 있고 `read`가 함수면 그것, 아니면 undefined(`desktop/launcher/projects/core-source.ts` 76-79 꼴).
   - `coreAgentsSource`(130-133)에서 `const files = "files" in deps ? deps.files : windowFiles();`를 두고 `instructionsOf`(388)가 `readInstructions(instructions, files, place)`를 부른다.
3. `packages/shell/renderer/workspace/agents/core-link.ts`: `Link.worker`(28-33), `call`의 kind union(43)과 `fetchValue`의 kind union(59)의 `"worker"`, `worker: fetchValue("worker")`(73)를 지운다.
4. `packages/shell/ipc/core.ts`: `coreCallSchema.kind`(13)에서 `"worker"`를 지우고, 머리 주석(1-4)에서 "worker에서 조립하는 읽기"와 allowlist 문장의 "worker·"를 지운다. main의 allowlist(`packages/shell/main/desktop/core/allowlist.ts`)는 kind를 글로 보며 `worker`를 이미 받지 않으므로 고칠 것이 없다(`npm run check`로 확인한다).
5. `packages/shell/renderer/workspace/agents/core-source_test.ts`: 지금 test는 `files`를 주지 않아 Deno에서 `windowFiles()`가 undefined이므로 그대로 통과해야 한다. type이 깨질 때만 고친다. 새 test는 쓰지 않는다.
   - 정한 것: 위험 test를 두지 않는다. 이유: 화면에 보일 data를 채우는 길이고 처음 고치는 bug다(`.claude/skills/write-test/SKILL.md` "쓰지 않는 test"의 화면). file read의 경로 검사는 main 쪽 `file-adapter_test`의 몫이다.
6. 화면 모양은 바뀌지 않는다. 카드는 지금도 `overview.instructions.text`를 그린다. 바뀌는 것은 늘 `""`였던 그 값뿐이라 wireframe(`ui-design` skill)과 wording은 손대지 않는다.
7. 할 수 있으면 `deno task dev`로 띄워 project 폴더에 `LOPHN.md`를 두고 Agents 탭 Instructions 카드에 첫 줄들이 보이는지, 지운 뒤에는 빈 미리보기인지 본다(`run` skill). 띄울 수 없으면 보고에 적는다.

## 끝남

- `deno task check`가 통과한다(shell이 바뀌어 renderer `deno check`, shell fmt·lint, `shell main`의 `npm run check`가 같이 돈다).
- `deno test --no-check packages/shell/renderer/workspace/agents/core-source_test.ts`가 통과한다.
- renderer build가 된다: `deno run -A packages/shell/renderer/build.ts`(`check:full`이 보지 않는다, `write-test` skill).
- 위험 test: 없음(위 "정한 것")
- 남지 않음: `grep -rn "worker" packages/shell/renderer/workspace/agents packages/shell/ipc/core.ts`가 0줄이다. `grep -rn "\"documents\"" packages/shell/renderer`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(renderer build 포함)
- 등록할 것: 없음이면 "없음"
- 안 쓰게 된 export: `packages/shell/ipc/instructions.ts`의 `InstructionsOpened.document`·`version`은 이제 읽는 곳이 없다(main은 늘 null을 준다). 소유 밖이라 지우지 않고 적는다
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(예: 화면으로 확인하지 못했으면 그것). 없으면 "없음"
