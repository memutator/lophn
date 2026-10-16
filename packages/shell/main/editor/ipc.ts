// 파일 IPC. sender는 등록된 desktop 창 본문 main frame만 받는다. 쓰기는 글을 싣으므로 64 KiB JSON
// 상한 대신 schema의 바이트 상한(FILE_TEXT_MAX_BYTES)으로 검사한다. 창 닫기 guard의 알림·답도 여기서 잇는다.
import {
  FILE_CLOSE_ANSWER_CHANNEL,
  FILE_COUNTS_CHANNEL,
  FILE_DELETE_CHANNEL,
  FILE_LIST_CHANNEL,
  FILE_READ_BYTES_CHANNEL,
  FILE_READ_CHANNEL,
  FILE_RENAME_CHANNEL,
  FILE_WATCH_CHANNEL,
  FILE_WRITE_CHANNEL,
  fileCloseAnswerSchema,
  fileCountsSchema,
  fileDeleteSchema,
  fileListSchema,
  fileReadBytesSchema,
  fileReadSchema,
  fileRenameSchema,
  fileWatchSchema,
  fileWriteSchema,
} from "../../ipc/files.ts";
import {
  INSTRUCTIONS_OPEN_CHANNEL,
  instructionsOpenSchema,
} from "../../ipc/instructions.ts";
import {
  checkCaller,
  type ContentsRegistry,
  guardIpc,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import type { CloseGuard } from "./close-guard.ts";
import type { FileAdapter } from "./file-adapter.ts";
import type { Instructions } from "./instructions.ts";

interface FilesIpcMain {
  handle(
    channel: string,
    listener: (event: unknown, input: unknown) => Promise<unknown>,
  ): void;
  on(channel: string, listener: (event: unknown, input: unknown) => void): void;
  removeHandler(channel: string): void;
  removeAllListeners(channel: string): void;
}

interface FilesIpcDeps {
  registry: ContentsRegistry;
  adapter: FileAdapter;
  instructions: Instructions;
  /** sender 창의 guard. 창 본문이 아니면 없다. */
  guardOf(contentsId: number): CloseGuard | undefined;
}

const HANDLED = [
  FILE_LIST_CHANNEL,
  FILE_READ_CHANNEL,
  FILE_READ_BYTES_CHANNEL,
  FILE_WRITE_CHANNEL,
  FILE_RENAME_CHANNEL,
  FILE_DELETE_CHANNEL,
  FILE_WATCH_CHANNEL,
  INSTRUCTIONS_OPEN_CHANNEL,
] as const;
const HEARD = [FILE_COUNTS_CHANNEL, FILE_CLOSE_ANSWER_CHANNEL] as const;

export function registerFilesIpc(ipc: FilesIpcMain, deps: FilesIpcDeps) {
  const reject = (code: "invalid_input" | "forbidden") => ({ ok: false, code });
  const ownerOf = (event: unknown) => (event as IpcEvent).sender.id;

  ipc.handle(FILE_LIST_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      fileListSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.adapter.list(checked.value.path);
  });

  ipc.handle(FILE_READ_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      fileReadSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.adapter.read(checked.value.path);
  });

  ipc.handle(FILE_READ_BYTES_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      fileReadBytesSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.adapter.readBytes(checked.value.path);
  });

  ipc.handle(FILE_WRITE_CHANNEL, async (event, input) => {
    // 글을 싣으므로 64 KiB JSON 상한 대신 schema의 바이트 상한으로 검사한다.
    const caller = checkCaller(deps.registry, event as IpcEvent);
    if (!caller.ok) return reject("forbidden");
    const parsed = fileWriteSchema.safeParse(input);
    if (!parsed.success) return reject("invalid_input");
    return await deps.adapter.write(ownerOf(event), parsed.data);
  });

  ipc.handle(FILE_RENAME_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      fileRenameSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.adapter.rename(checked.value);
  });

  ipc.handle(FILE_DELETE_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      fileDeleteSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.adapter.delete(checked.value);
  });

  ipc.handle(FILE_WATCH_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      fileWatchSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.adapter.watch(ownerOf(event), checked.value.paths);
  });

  ipc.handle(INSTRUCTIONS_OPEN_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      instructionsOpenSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.instructions.open(checked.value);
  });

  ipc.on(FILE_COUNTS_CHANNEL, (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      fileCountsSchema,
      input,
    );
    if (!checked.ok) return;
    deps.guardOf(ownerOf(event))?.setCounts(checked.value);
  });

  ipc.on(FILE_CLOSE_ANSWER_CHANNEL, (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      fileCloseAnswerSchema,
      input,
    );
    if (!checked.ok) return;
    deps.guardOf(ownerOf(event))?.answer(
      checked.value.request,
      checked.value.answer,
    );
  });
}

export function removeFilesIpc(ipc: FilesIpcMain): void {
  for (const channel of HANDLED) ipc.removeHandler(channel);
  for (const channel of HEARD) ipc.removeAllListeners(channel);
}
