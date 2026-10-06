// 편집기 IPC. sender는 등록된 desktop 창 본문 main frame만 받는다. 쓰기는 바이트를 싣으므로
// 64 KiB JSON 상한 대신 schema의 바이트 상한(EDITOR_MAX_BYTES)으로 검사한다.
import {
  EDITOR_CLOSE_ANSWER_CHANNEL,
  EDITOR_COUNTS_CHANNEL,
  EDITOR_CREATE_CHANNEL,
  EDITOR_CURRENT_CHANNEL,
  EDITOR_LOOKUP_CHANNEL,
  EDITOR_OPEN_CHANNEL,
  EDITOR_RELEASE_CHANNEL,
  EDITOR_RESTORE_CHANNEL,
  EDITOR_WATCH_CHANNEL,
  EDITOR_WRITE_CHANNEL,
  editorCloseAnswerSchema,
  editorCountsSchema,
  editorCreateSchema,
  editorLookupSchema,
  editorOpenSchema,
  editorRestoreSchema,
  editorSessionSchema,
  editorWatchSchema,
  editorWriteSchema,
} from "../../ipc/editor.ts";
import {
  INSTRUCTIONS_CREATE_CHANNEL,
  INSTRUCTIONS_OPEN_CHANNEL,
  instructionsCreateSchema,
  instructionsOpenSchema,
} from "../../ipc/instructions.ts";
import {
  checkCaller,
  type ContentsRegistry,
  guardIpc,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import type { CloseGuard } from "./close-guard.ts";
import type { DocumentCreator } from "./create.ts";
import type { FileAdapter } from "./file-adapter.ts";
import type { Instructions } from "./instructions.ts";
import type { Restorer } from "./restore.ts";

export interface EditorIpcMain {
  handle(
    channel: string,
    listener: (event: unknown, input: unknown) => Promise<unknown>,
  ): void;
  on(channel: string, listener: (event: unknown, input: unknown) => void): void;
  removeHandler(channel: string): void;
  removeAllListeners(channel: string): void;
}

export interface EditorIpcDeps {
  registry: ContentsRegistry;
  adapter: FileAdapter;
  restorer: Restorer;
  creator: DocumentCreator;
  instructions: Instructions;
  /** sender 창의 guard. 창 본문이 아니면 없다. */
  guardOf(contentsId: number): CloseGuard | undefined;
}

const HANDLED = [
  EDITOR_OPEN_CHANNEL,
  EDITOR_WRITE_CHANNEL,
  EDITOR_LOOKUP_CHANNEL,
  EDITOR_CURRENT_CHANNEL,
  EDITOR_WATCH_CHANNEL,
  EDITOR_RELEASE_CHANNEL,
  EDITOR_RESTORE_CHANNEL,
  EDITOR_CREATE_CHANNEL,
  INSTRUCTIONS_OPEN_CHANNEL,
  INSTRUCTIONS_CREATE_CHANNEL,
] as const;
const HEARD = [EDITOR_COUNTS_CHANNEL, EDITOR_CLOSE_ANSWER_CHANNEL] as const;

export function registerEditorIpc(ipc: EditorIpcMain, deps: EditorIpcDeps) {
  const reject = (code: "invalid_input" | "forbidden") => ({ ok: false, code });

  ipc.handle(EDITOR_OPEN_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      editorOpenSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.adapter.open(
      (event as IpcEvent).sender.id,
      checked.value.document,
    );
  });

  ipc.handle(EDITOR_WRITE_CHANNEL, async (event, input) => {
    const caller = checkCaller(deps.registry, event as IpcEvent);
    if (!caller.ok) return reject("forbidden");
    const parsed = editorWriteSchema.safeParse(input);
    if (!parsed.success) return reject("invalid_input");
    return await deps.adapter.write((event as IpcEvent).sender.id, parsed.data);
  });

  ipc.handle(EDITOR_LOOKUP_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      editorLookupSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.adapter.lookup(
      (event as IpcEvent).sender.id,
      checked.value,
    );
  });

  ipc.handle(EDITOR_CURRENT_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      editorSessionSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.adapter.current(
      (event as IpcEvent).sender.id,
      checked.value,
    );
  });

  ipc.handle(EDITOR_WATCH_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      editorWatchSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.adapter.watch(
      (event as IpcEvent).sender.id,
      checked.value,
    );
  });

  ipc.handle(EDITOR_RELEASE_CHANNEL, (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      editorSessionSchema,
      input,
    );
    if (checked.ok) {
      deps.adapter.release(
        (event as IpcEvent).sender.id,
        checked.value.session,
      );
    }
    return Promise.resolve(undefined);
  });

  ipc.handle(EDITOR_RESTORE_CHANNEL, async (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      editorRestoreSchema,
      input,
    );
    if (!checked.ok) return reject(checked.error.code);
    return await deps.restorer.restore(checked.value);
  });

  ipc.handle(EDITOR_CREATE_CHANNEL, async (event, input) => {
    // 바이트를 싣으므로 쓰기처럼 64 KiB JSON 상한 대신 schema의 바이트 상한으로 검사한다.
    const caller = checkCaller(deps.registry, event as IpcEvent);
    if (!caller.ok) return reject("forbidden");
    const parsed = editorCreateSchema.safeParse(input);
    if (!parsed.success) return reject("invalid_input");
    return await deps.creator.create(parsed.data);
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

  ipc.handle(INSTRUCTIONS_CREATE_CHANNEL, async (event, input) => {
    // 바이트를 싣으므로 쓰기처럼 64 KiB JSON 상한 대신 schema의 바이트 상한으로 검사한다.
    const caller = checkCaller(deps.registry, event as IpcEvent);
    if (!caller.ok) return reject("forbidden");
    const parsed = instructionsCreateSchema.safeParse(input);
    if (!parsed.success) return reject("invalid_input");
    return await deps.instructions.create(parsed.data);
  });

  ipc.on(EDITOR_COUNTS_CHANNEL, (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      editorCountsSchema,
      input,
    );
    if (!checked.ok) return;
    deps.guardOf((event as IpcEvent).sender.id)?.setCounts(checked.value);
  });

  ipc.on(EDITOR_CLOSE_ANSWER_CHANNEL, (event, input) => {
    const checked = guardIpc(
      deps.registry,
      event as IpcEvent,
      editorCloseAnswerSchema,
      input,
    );
    if (!checked.ok) return;
    deps.guardOf((event as IpcEvent).sender.id)?.answer(
      checked.value.request,
      checked.value.answer,
    );
  });
}

export function removeEditorIpc(ipc: EditorIpcMain): void {
  for (const channel of HANDLED) ipc.removeHandler(channel);
  for (const channel of HEARD) ipc.removeAllListeners(channel);
}
