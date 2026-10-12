// context blob의 core 쪽 길(documents/contexts#R19·R25, platform/blob-store#R1·R4). command는 blob 파일을
// 쓰지 않는다: core가 command 앞에서 값을 정규 직렬화한 bytes를 요청 자격의 이름으로 준비하고(긴 준비를
// transaction 안에 넣지 않는다), command가 같은 값에서 같은 hash를 만들어 소유 변경과 같은 transaction에서
// 영구 참조만 등록한다. 준비가 없으면 등록이 실패해 command 전체가 되돌아가고, 등록되지 않은 준비는
// 수명(10분)이 지나 사라진다.
//   - bundle.save_draft: 초안 content.
//   - context.hand_off_violations: 서버가 붙이는 근거와 그 근거를 옮긴 요청 글. 근거는 command와 같은
//     함수(evidenceOf)로, 위반과 적용된 판의 계약을 같은 읽기에서 얻어 만든다. 준비한 뒤 위반이 바뀌면
//     command가 만든 hash가 달라 등록이 실패한다(다시 요청한다).
// 모양이 틀렸거나 command가 거절할 요청은 건드리지 않고 지나가 command의 검사가 거절한다.
import { ok, type Result } from "../../packages/base/mod.ts";
import {
  bundleSaveDraftRoute,
  chooseViolations,
  CONTEXT_CONTENT_PURPOSE,
  CONTEXT_PAGE_MAX,
  contextContentBytes,
  contextHandOffViolationsRoute,
  evidenceOf,
  type StoredViolation,
} from "../../packages/protocol/projects/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import type {
  CommandEnvelope,
  Writer,
} from "../../packages/platform/ledger/mod.ts";
import type { ReadHandler } from "../../packages/platform/api/mod.ts";
import { handOffContent } from "./contexts-handoff.ts";
import { type BodyPrepare, prepareBytes, rejected } from "./message-body.ts";

const VIOLATIONS_READ = "contexts/violations";
const CONTRACT_READ = "contexts/contract";
// 위반 목록을 page로 읽는 횟수의 안전 한도(page 100개). 넘으면 준비하지 않고 지나가
// command가 등록에서 거절한다.
const MAX_PAGES = 50;

type Entry = Record<string, unknown>;

const isEntry = (value: unknown): value is Entry =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export type ContextBlobDeps = {
  // 준비 통로. I/O worker가 뜨기 전에는 없다(unavailable).
  relay(): BodyPrepare | undefined;
  // 위반과 계약을 읽는 core의 read 처리기(context.violations, context.contract).
  reads(): ReadonlyMap<string, ReadHandler> | undefined;
};

// 현재 위반 전부(page를 이어 읽는다). 읽지 못하면 undefined다.
async function readViolations(
  read: ReadHandler,
  ctx: AuthenticatedContext,
  context: string,
): Promise<StoredViolation[] | undefined> {
  const all: StoredViolation[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await read(ctx, {
      context,
      limit: CONTEXT_PAGE_MAX,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!result.ok || !isEntry(result.value)) return undefined;
    const rows = result.value["violations"];
    if (!Array.isArray(rows)) return undefined;
    for (const row of rows) {
      if (!isEntry(row)) return undefined;
      const { handed_off: _handedOff, ...stored } = row;
      all.push(stored as StoredViolation);
    }
    const next = result.value["next_cursor"];
    if (typeof next !== "string") return all;
    cursor = next;
  }
  return undefined;
}

// 적용된 판 content의 contract다. 적용된 판이 없거나 읽지 못하면 undefined다.
async function readContract(
  read: ReadHandler,
  ctx: AuthenticatedContext,
  context: string,
): Promise<{ contract: unknown } | undefined> {
  const result = await read(ctx, { context });
  if (!result.ok || !isEntry(result.value)) return undefined;
  const content = result.value["content"];
  return isEntry(content) ? { contract: content["contract"] } : undefined;
}

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
    if (envelope.command === bundleSaveDraftRoute.name) {
      const parsed = bundleSaveDraftRoute.input.safeParse(envelope.input);
      if (!parsed.success) return ok(envelope);
      const prepared = await prepare(
        ctx,
        contextContentBytes(parsed.data.content),
        "context draft",
      );
      return prepared.ok ? ok(envelope) : prepared;
    }
    if (envelope.command === contextHandOffViolationsRoute.name) {
      const parsed = contextHandOffViolationsRoute.input.safeParse(
        envelope.input,
      );
      const reads = deps.reads();
      const violationsRead = reads?.get(VIOLATIONS_READ);
      const contractRead = reads?.get(CONTRACT_READ);
      if (
        !parsed.success || violationsRead === undefined ||
        contractRead === undefined
      ) return ok(envelope);
      const context = parsed.data.context;
      const stored = await readViolations(violationsRead, ctx, context);
      const contract = await readContract(contractRead, ctx, context);
      if (stored === undefined || contract === undefined) return ok(envelope);
      const chosen = chooseViolations(stored, parsed.data.violations);
      if (!chosen.ok || chosen.value.length === 0) return ok(envelope);
      const evidence = evidenceOf(context, contract.contract, chosen.value);
      const evidenceBytes = await prepare(
        ctx,
        contextContentBytes(evidence),
        "hand-off evidence",
      );
      if (!evidenceBytes.ok) return evidenceBytes;
      const request = await prepare(
        ctx,
        contextContentBytes(handOffContent(evidence)),
        "hand-off request",
      );
      return request.ok ? ok(envelope) : request;
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
