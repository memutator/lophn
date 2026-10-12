// desktop renderer가 쓰는 [Instructions] 통로. channel 이름은 closure 안에만 있다. renderer는 층과
// 자리 id만 보내고 지침 파일의 경로·target 이름은 모른다.
import {
  INSTRUCTIONS_CREATE_CHANNEL,
  INSTRUCTIONS_OPEN_CHANNEL,
  type InstructionsApi,
} from "../ipc/instructions.ts";
import type { EditorReply } from "../ipc/editor.ts";
import type { EditorTransport } from "./editor-api.ts";

export function createInstructionsApi(
  transport: Pick<EditorTransport, "invoke">,
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
      create: (input) => invoke(INSTRUCTIONS_CREATE_CHANNEL, input),
    } satisfies InstructionsApi,
  );
}
