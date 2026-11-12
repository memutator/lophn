# files-transfer

Explorer 붙여넣기에 필요한 디스크 동작 둘(복사, 바이트 쓰기)을 파일 경계에 더한다. 붙여넣기 이름 규칙(같은 이름이 있으면 `a copy.md`)을 순수 함수 하나로 둔다.

- 단위: `files` (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/files.ts`
  - `packages/shell/preload/files-api.ts`
  - `packages/shell/main/editor/file-adapter.ts`
  - `packages/shell/main/editor/file-adapter_test.ts`
  - `packages/shell/main/editor/ipc.ts`
  - `packages/shell/renderer/workspace/source.ts`
  - `packages/shell/renderer/workspace/core-source.ts`
  - `packages/shell/renderer/workspace/fake-source.ts`
  - `packages/shell/renderer/workspace/files/`
- 추가 소유:
  - `packages/design/i18n/catalog/project.ts`의 key 더하기만(문구는 lead가 이미 넣었다. 더 필요한 key가 있으면 보고의 "계약 바꾸기 요청"에 적는다)
- 읽을 것:
  - architecture: `project-docs/architecture/workspace-layout.md`(Files panel)
  - 기존 코드: `packages/shell/main/editor/file-adapter.ts`(guarded·accept·failureOf·inside), `packages/shell/main/editor/ipc.ts`(guardIpc), `packages/shell/renderer/workspace/source.ts`(`WorkspaceSource`, `FileOpResult`)
  - 배경: `project-docs/products/change-log/0.2/explorer-vscode-trash-delete.yaml`, `project-docs/products/change-log/0.9/explorer-folder-collapse-fix.yaml`
- 계약(이 task가 정하고 explorer·editor task가 이것을 쓴다. 이름과 모양을 바꾸지 않는다):
  - `packages/shell/ipc/files.ts`:
    - `FILE_COPY_CHANNEL = "shell:file-copy"`, `const fileCopySchema = z.object({ from: path, to: path }).strict()`
    - `FILE_WRITE_BYTES_CHANNEL = "shell:file-write-bytes"`, `const fileWriteBytesSchema = z.object({ path, bytes })`, 여기서 `bytes`는 `packages/shell/ipc/core.ts`의 `bytes`와 같은 이름표 검사(`[object Uint8Array]`)를 쓰고, 크기는 `.refine(v => v.byteLength <= FILE_VIEW_MAX_BYTES)`로 막는다(넘으면 schema 실패라 `invalid_input`이 아니라 `too_large`로 답하고 싶으면 handler에서 크기를 먼저 본다. 그쪽으로 한다).
    - `FilesApi`에 두 method를 더한다:
      - `copy(input: { from: string; to: string }): Promise<FileReply<Record<PropertyKey, never>>>`
      - `writeBytes(input: { path: string; bytes: Uint8Array }): Promise<FileReply<{ hash: string }>>`
  - `WorkspaceSource`에 둘을 더한다. 둘 다 `FileOpResult`를 돌려준다(새 결과 type을 만들지 않는다):
    - `copy(from: string, to: string): Promise<FileOpResult>`
    - `writeBytes(path: string, bytes: Uint8Array): Promise<FileOpResult>`
  - `packages/shell/renderer/workspace/files/paste-names.ts`(새 file, explorer·editor task가 import한다):
    ```ts
    /** 같은 이름이 있으면 비켜 간다. copy는 `a copy.md`, `a copy 2.md`. number는 `image 2.png`. 점으로 시작하는 이름의 점은 확장자로 보지 않는다. */
    export function freeName(
      name: string,
      taken: Iterable<string>,
      style: "copy" | "number",
    ): string;
    ```
- 할 일:
  1. `file-adapter.ts`에 `copy`와 `writeBytes`를 더한다.
     - `copy`: `from`을 `guarded`로 받고, `to`는 `accept`로 받는다(secret 거절). `from`이 디스크에 없으면 `not_found`, `to`가 이미 있으면 `conflict`(아무것도 덮지 않는다), `to`가 `from` 안이면 `invalid_input`. 없는 위쪽 폴더는 `mkdir(recursive)`로 만든다. 복사는 `node:fs/promises`의 `cp(from, to, { recursive: true, errorOnExist: true, force: false })`로 file과 폴더를 같이 처리한다.
     - `writeBytes`: `guarded`로 받고 `open(path, "wx", 0o644)`로 **새 file만** 만든다(이미 있으면 EEXIST → `conflict`). 상한은 `FILE_VIEW_MAX_BYTES`이고 넘으면 `too_large`. 위쪽 폴더는 `mkdir(recursive)`. 임시 file+rename은 쓰지 않는다(새 file이라 원본이 없다).
     - 두 동작 모두 기존 `failureOf`의 code로 실패를 돌려준다.
  2. `ipc.ts`에 두 channel을 등록한다. 기존 handler와 같은 `guardIpc`(desktop 창 본문 main frame만)를 쓴다. `file-write-bytes`는 `file-write`처럼 64 KiB JSON 상한을 피해야 하니 `checkCaller` + `fileWriteBytesSchema.safeParse`로 직접 검사한다(`HANDLED` 목록에도 더한다).
  3. `preload/files-api.ts`에 `copy`·`writeBytes`를 잇는다.
  4. `core-source.ts`에 `copy`·`writeBytes`를 잇는다(`fileOp` helper를 쓴다).
  5. `fake-source.ts`에 같은 두 동작을 메모리 tree로 흉내 낸다(복사는 node를 deep clone, 이름이 겹치면 `conflict`, 없는 path면 `not_found`). `writeBytes`는 file node를 만들고 이미 있으면 `conflict`.
  6. `files/paste-names.ts`를 계약대로 쓴다.
  7. `file-adapter_test.ts`에 위험한 것만 시험한다: 복사가 이미 있는 `to`를 덮지 않고 `conflict`이며 원본 `to` 내용이 그대로다(폴더 복사도 한 번), 복사한 폴더의 아래 file이 같이 온다, `writeBytes`가 이미 있는 file을 덮지 않고 `conflict`다, 상한을 넘으면 `too_large`이고 file이 생기지 않는다, secret 거절.
- 끝남:
  - `npm run check:full`이 통과한다(`project-docs/plan/tools/lead/boot.sh`도 `boot 1 exit 0`, `boot 2 exit 0`).
  - 위험 test: "복사와 writeBytes는 이미 있는 대상을 덮지 않는다(사용자 file이 남는다)"
  - `grep -rn "file-copy\|file-write-bytes" packages`가 ipc·preload·main·renderer에서 나온다.
- 보고:
  - 바꾼 file
  - 통과한 check
  - 등록할 것: lead가 `project-docs/flows/areas/ipc.yaml` links와 `projects.yaml` flow, `tests/shell.yaml`을 고친다. 그 목록을 적는다.
  - 안 쓰게 된 export
  - 정한 것
  - 넘길 줄
  - 계약 바꾸기 요청
  - **무겁게 짠 것**: 없으면 "없음"
  - **알려진 미완 동작**: 없으면 "없음"
