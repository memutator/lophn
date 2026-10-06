// desktop renderer가 쓰는 편집 통로. channel 이름과 Electron event는 closure 안에만 있다.
// renderer는 문서 id와 session handle만 보내고 경로·core port는 모른다.
import {
  type CloseAnswer,
  EDITOR_CLOSE_ANSWER_CHANNEL,
  EDITOR_CLOSE_REQUEST_CHANNEL,
  EDITOR_COUNTS_CHANNEL,
  EDITOR_CURRENT_CHANNEL,
  EDITOR_LOOKUP_CHANNEL,
  EDITOR_OPEN_CHANNEL,
  EDITOR_RELEASE_CHANNEL,
  EDITOR_RESTORE_CHANNEL,
  EDITOR_WATCH_CHANNEL,
  EDITOR_WRITE_CHANNEL,
  type EditorFilesApi,
  type EditorReply,
} from "../ipc/editor.ts";

export interface EditorTransport {
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

export function createEditorApi(transport: EditorTransport): EditorFilesApi {
  async function invoke<T>(
    channel: string,
    input: unknown,
  ): Promise<EditorReply<T>> {
    try {
      return await transport.invoke(channel, input) as EditorReply<T>;
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }
  return Object.freeze(
    {
      open: (input) => invoke(EDITOR_OPEN_CHANNEL, input),
      write: (input) => invoke(EDITOR_WRITE_CHANNEL, input),
      lookup: (input) => invoke(EDITOR_LOOKUP_CHANNEL, input),
      current: (input) => invoke(EDITOR_CURRENT_CHANNEL, input),
      watch: (input) => invoke(EDITOR_WATCH_CHANNEL, input),
      restore: (input) => invoke(EDITOR_RESTORE_CHANNEL, input),
      async release(input) {
        await invoke(EDITOR_RELEASE_CHANNEL, input);
      },
      counts(input) {
        transport.send(EDITOR_COUNTS_CHANNEL, input);
      },
      onCloseRequest(listener) {
        const callback = (_event: unknown, payload: unknown) => {
          if (typeof payload === "number" && Number.isInteger(payload)) {
            listener(payload);
          }
        };
        transport.on(EDITOR_CLOSE_REQUEST_CHANNEL, callback);
        return () =>
          transport.removeListener(EDITOR_CLOSE_REQUEST_CHANNEL, callback);
      },
      answerClose(request: number, answer: CloseAnswer) {
        transport.send(EDITOR_CLOSE_ANSWER_CHANNEL, { request, answer });
      },
    } satisfies EditorFilesApi,
  );
}
