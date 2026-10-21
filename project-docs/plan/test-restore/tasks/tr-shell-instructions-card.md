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
- 계약:
  - 쓰는 것: `packages/shell/ipc/instructions.ts`(`instructions.open` 결과의 `path`), `packages/shell/ipc/files.ts`(`FILE_READ_CHANNEL`, `fileReadSchema`), `packages/shell/preload/files-api.ts`(renderer의 `read`), `packages/shell/main/editor/ipc.ts`(main 쪽 file read handler. 고치지 않는다)
  - 내놓는 것: IPC `core` 요청의 `kind`는 `"read" | "command" | "memory" | "upload" | "file"`이다.

## 할 일

`readInstructions`가 `instructions.open`의 `path`를 file read IPC로 읽게 바꾸고 `Link.worker`와 `"worker"` kind를 지운다.
