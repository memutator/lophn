// desktop renderer가 쓰는 파일 통로. channel 이름과 Electron event는 closure 안에만 있다.
import {
  type CloseAnswer,
  FILE_CHANGED_CHANNEL,
  FILE_CLOSE_ANSWER_CHANNEL,
  FILE_CLOSE_REQUEST_CHANNEL,
  FILE_COUNTS_CHANNEL,
  FILE_DELETE_CHANNEL,
  FILE_LIST_CHANNEL,
  FILE_READ_BYTES_CHANNEL,
  FILE_READ_CHANNEL,
  FILE_RENAME_CHANNEL,
  FILE_WATCH_CHANNEL,
  FILE_WRITE_CHANNEL,
  type FileChanged,
  type FileReply,
  type FilesApi,
} from "../ipc/files.ts";

interface FilesTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
  send(channel: string, input: unknown): void;
  on(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
}

export function createFilesApi(transport: FilesTransport): FilesApi {
  async function invoke<T>(
    channel: string,
    input: unknown,
  ): Promise<FileReply<T>> {
    try {
      return await transport.invoke(channel, input) as FileReply<T>;
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }
  return Object.freeze(
    {
      list: (input) => invoke(FILE_LIST_CHANNEL, input),
      read: (input) => invoke(FILE_READ_CHANNEL, input),
      readBytes: (input) => invoke(FILE_READ_BYTES_CHANNEL, input),
      write: (input) => invoke(FILE_WRITE_CHANNEL, input),
      rename: (input) => invoke(FILE_RENAME_CHANNEL, input),
      delete: (input) => invoke(FILE_DELETE_CHANNEL, input),
      watch: (input) => invoke(FILE_WATCH_CHANNEL, input),
      onChanged(listener) {
        const callback = (_event: unknown, payload: unknown) => {
          const change = payload as FileChanged | null;
          if (
            change && typeof change.path === "string" &&
            (change.hash === null || typeof change.hash === "string")
          ) {
            listener({ path: change.path, hash: change.hash });
          }
        };
        transport.on(FILE_CHANGED_CHANNEL, callback);
        return () => transport.removeListener(FILE_CHANGED_CHANNEL, callback);
      },
      counts(input) {
        transport.send(FILE_COUNTS_CHANNEL, input);
      },
      onCloseRequest(listener) {
        const callback = (_event: unknown, payload: unknown) => {
          if (typeof payload === "number" && Number.isInteger(payload)) {
            listener(payload);
          }
        };
        transport.on(FILE_CLOSE_REQUEST_CHANNEL, callback);
        return () =>
          transport.removeListener(FILE_CLOSE_REQUEST_CHANNEL, callback);
      },
      answerClose(request: number, answer: CloseAnswer) {
        transport.send(FILE_CLOSE_ANSWER_CHANNEL, { request, answer });
      },
    } satisfies FilesApi,
  );
}
