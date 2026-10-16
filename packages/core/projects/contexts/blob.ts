// context blob의 core 쪽 길. command는 blob 파일을
// 쓰지 않는다: core가 command 앞에서 값을 정규 직렬화한 bytes를 요청 자격의 이름으로 준비하고(긴 준비를
// transaction 안에 넣지 않는다), command가 같은 값에서 같은 hash를 만들어 소유 변경과 같은 transaction에서
// 영구 참조만 등록한다. 준비가 없으면 등록이 실패해 command 전체가 되돌아가고, 등록되지 않은 준비는
// 수명(10분)이 지나 사라진다.
//   - bundle.open_draft: 빈 골격(적용된 판이 없는 context의 첫 초안 내용).
//   - bundle.submit: 초안 폴더의 bundle.json(판의 content).
// 모양이 틀렸거나 command가 거절할 요청은 건드리지 않고 지나가 command의 검사가 거절한다.
import { ok, type Result } from "../../../base/mod.ts";
import {
  bundleContentSchema,
  bundleOpenDraftRoute,
  bundleSubmitRoute,
  CONTEXT_CONTENT_PURPOSE,
  contextContentBytes,
} from "../../../protocol/projects/mod.ts";
import { EMPTY_DRAFT_CONTENT } from "./folders.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { CommandEnvelope, Writer } from "../../storage/ledger/mod.ts";
import {
  type BodyPrepare,
  prepareBytes,
  rejected,
} from "../../lophn-agent/session/message-body.ts";

type ContextBlobDeps = {
  // 준비 통로. I/O worker가 뜨기 전에는 없다(unavailable).
  relay(): BodyPrepare | undefined;
  // 제출할 초안 폴더의 bundle.json 내용. 판이나 파일이 없거나 JSON이 아니면 undefined다.
  draftContent(bundle: string): Promise<unknown>;
};

export function createContextBlobPreparer(deps: ContextBlobDeps): (
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
) => Promise<Result<CommandEnvelope>> {
  const prepare = async (
    ctx: AuthenticatedContext,
    bytes: Uint8Array,
    what: string,
  ): Promise<Result<string>> => {
    const relay = deps.relay();
    if (relay === undefined) {
      return rejected("unavailable", "blob preparation is not available");
    }
    return await prepareBytes(relay, ctx, CONTEXT_CONTENT_PURPOSE, bytes, what);
  };

  return async (ctx, envelope) => {
    if (envelope.command === bundleOpenDraftRoute.name) {
      const prepared = await prepare(
        ctx,
        contextContentBytes(EMPTY_DRAFT_CONTENT),
        "context draft",
      );
      return prepared.ok ? ok(envelope) : prepared;
    }
    if (envelope.command === bundleSubmitRoute.name) {
      const asked = bundleSubmitRoute.input.safeParse(envelope.input);
      if (!asked.success) return ok(envelope);
      const content = bundleContentSchema.safeParse(
        await deps.draftContent(asked.data.bundle),
      );
      if (!content.success) return ok(envelope);
      const prepared = await prepare(
        ctx,
        contextContentBytes(content.data),
        "context bundle",
      );
      return prepared.ok ? ok(envelope) : prepared;
    }
    return ok(envelope);
  };
}

// writer.command 앞에 context blob 준비를 끼운다. 나머지 Writer 동작은 그대로다.
export function withContextBlobs(
  writer: Writer,
  prepare: ReturnType<typeof createContextBlobPreparer>,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const ready = await prepare(ctx, envelope);
      if (!ready.ok) return ready;
      return await writer.command(ctx, ready.value);
    },
  };
}
