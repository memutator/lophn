// desktop renderer가 쓰는 [Memory] 통로. channel 이름은 closure 안에만 있다. renderer는 어느 memory인지만 보내고
// 파일의 경로는 모른다.
import type { EditorReply } from "../ipc/instructions.ts";
import { MEMORY_OPEN_CHANNEL, type MemoryApi } from "../ipc/memory.ts";

export function createMemoryApi(transport: {
  invoke(channel: string, input: unknown): Promise<unknown>;
}): MemoryApi {
  async function invoke<T>(
    channel: string,
    input: unknown,
  ): Promise<EditorReply<T>> {
    try {
      return (await transport.invoke(channel, input)) as EditorReply<T>;
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }
  return Object.freeze({
    open: (input) => invoke(MEMORY_OPEN_CHANNEL, input),
  } satisfies MemoryApi);
}
