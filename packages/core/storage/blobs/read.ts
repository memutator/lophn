// blob 읽기.
// hash가 아니라 허용 owner·고정 판·field의 참조에서 시작하고 매 조각마다 scope를 다시 검사한다.
// 참조된 blob이 없거나 hash가 다르면 unavailable이며 빈 내용을 돌려주지 않는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type { RequestContext, Sql } from "../../../protocol/server/mod.ts";
import {
  type BlobFieldDefinition,
  type BlobReadInput,
  blobReadInputSchema,
  type BlobReadResult,
} from "../../../protocol/storage/mod.ts";
import type { BlobAuthorizer } from "./refs.ts";
import {
  fieldDefined,
  generalReadAllowed,
  observedMatches,
  readAnswer,
  readWindow,
  unavailableAnswer,
} from "./refs.ts";

type StoredBlobRef = {
  hash: string;
  size_bytes: number;
};

type BlobBytes = {
  // 등록된 hash의 그 구간. 없거나 관측 hash가 다르면 err다.
  read(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
};

type BlobReadDeps = {
  fields: readonly BlobFieldDefinition[];
  // 소유 concern이 그 owner·고정 판·field를 지금 자격으로 읽을 수 있는지.
  authorize: BlobAuthorizer;
  bytes: BlobBytes;
};

// 참조 행에서 시작한다. hash만 아는 읽기는 이 행이 없으면 거절된다.
function storedRef(
  sql: Pick<Sql, "get">,
  input: Pick<BlobReadInput, "owner_kind" | "owner_key" | "field">,
): Result<StoredBlobRef | undefined> {
  const row = sql.get(
    `select hash, size_bytes from blob_refs
     where owner_kind = ? and owner_key = ? and field = ?`,
    [input.owner_kind, input.owner_key, input.field],
  );
  if (row === undefined) return ok(undefined);
  const hash = row["hash"];
  const size = row["size_bytes"];
  if (
    typeof hash !== "string" ||
    (typeof size !== "bigint" && typeof size !== "number")
  ) {
    return err({ code: "unavailable", message: "blob 참조를 읽지 못했다" });
  }
  return ok({ hash, size_bytes: Number(size) });
}

// 한 조각의 판정. scope 검사는 호출자가 매 조각 전에 다시 한다.
type ReadWindow = {
  offset_bytes: number;
  length_bytes: number;
  truncated: boolean;
};

type ReadDecision =
  | {
    kind: "bytes";
    hash: string;
    size_bytes: number;
    window: ReadWindow;
  }
  | { kind: "unavailable"; answer: BlobReadResult };

function decideRead(
  fields: readonly BlobFieldDefinition[],
  ctx: RequestContext,
  authorize: BlobAuthorizer,
  input: BlobReadInput,
  stored: StoredBlobRef | undefined,
): Result<ReadDecision> {
  const field = fieldDefined(fields, input.owner_kind, input.field);
  if (!field.ok) return field;
  const readable = generalReadAllowed(field.value);
  if (!readable.ok) return readable;
  const allowed = authorize(ctx, input);
  if (!allowed.ok) return allowed;
  if (stored === undefined) {
    return err({ code: "not_found", message: "blob 참조가 없다" });
  }
  const window = readWindow(
    stored.size_bytes,
    input.offset_bytes,
    input.length_bytes,
  );
  if (!window.ok) return window;
  return ok({
    kind: "bytes",
    hash: stored.hash,
    size_bytes: stored.size_bytes,
    window: window.value,
  });
}

// snapshot 안에서 하는 판정. 연결은 이 결과만 들고 닫는다. blob 바이트를 기다리며
// SQLite snapshot을 유지하지 않는다. 바이트는 finishBlobRead가 그 뒤에 읽는다.
export function planBlobRead(
  sql: Pick<Sql, "get">,
  deps: Pick<BlobReadDeps, "fields" | "authorize">,
  ctx: RequestContext,
  input: BlobReadInput,
): Result<
  | { kind: "answer"; result: BlobReadResult }
  | {
    kind: "bytes";
    hash: string;
    size_bytes: number;
    window: ReadWindow;
    input: BlobReadInput;
  }
> {
  const parsed = blobReadInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "blob 읽기 입력이 올바르지 않다",
    });
  }
  const allowed = deps.authorize(ctx, parsed.data);
  if (!allowed.ok) return allowed;
  const stored = storedRef(sql, parsed.data);
  if (!stored.ok) return stored;
  const decision = decideRead(
    deps.fields,
    ctx,
    deps.authorize,
    parsed.data,
    stored.value,
  );
  if (!decision.ok) return decision;
  if (decision.value.kind === "unavailable") {
    return ok({ kind: "answer", result: decision.value.answer });
  }
  return ok({
    kind: "bytes",
    hash: decision.value.hash,
    size_bytes: decision.value.size_bytes,
    window: decision.value.window,
    input: parsed.data,
  });
}

// snapshot을 닫은 뒤 바이트를 읽고, 돌려주기 직전에 scope를 다시 검사한다.
export async function finishBlobRead(
  deps: Pick<BlobReadDeps, "authorize" | "bytes">,
  ctx: RequestContext,
  plan: {
    hash: string;
    size_bytes: number;
    window: ReadWindow;
    input: BlobReadInput;
  },
): Promise<Result<BlobReadResult>> {
  const observed = await deps.bytes.read(
    plan.hash,
    plan.window.offset_bytes,
    plan.window.length_bytes,
  );
  if (!observed.ok) {
    const reason = observed.error.code === "not_found" ? "missing" : "corrupt";
    return ok(
      unavailableAnswer(
        { hash: plan.hash, size_bytes: plan.size_bytes },
        reason,
      ).result,
    );
  }
  const matches = observedMatches(
    { hash: plan.hash, size_bytes: plan.size_bytes },
    observed.value,
  );
  if (!matches.ok) {
    return ok(
      unavailableAnswer(
        { hash: plan.hash, size_bytes: plan.size_bytes },
        "corrupt",
      ).result,
    );
  }
  const again = deps.authorize(ctx, plan.input);
  if (!again.ok) return again;
  return ok(
    readAnswer(
      { hash: plan.hash, size_bytes: plan.size_bytes },
      plan.window,
      observed.value.bytes,
    ).result,
  );
}

// read handler가 부르는 비동기 경계. snapshot SQL은 동기이고 바이트는 그 뒤에 읽는다.

