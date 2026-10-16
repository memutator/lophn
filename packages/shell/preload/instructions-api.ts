// desktop renderer가 쓰는 [Instructions] 통로. channel 이름은 closure 안에만 있다. renderer는 층과
// 자리 id만 보내고 지침 파일의 경로·target 이름은 모른다.
import {
  type EditorReply,
  INSTRUCTIONS_OPEN_CHANNEL,
  type InstructionsApi,
} from "../ipc/instructions.ts";

export function createInstructionsApi(
  transport: { invoke(channel: string, input: unknown): Promise<unknown> },
): InstructionsApi {
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
      open: (input) => invoke(INSTRUCTIONS_OPEN_CHANNEL, input),
    } satisfies InstructionsApi,
  );
}
