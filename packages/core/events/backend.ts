import { err, ok, type Result } from "../../base/mod.ts";
import {
  eventsList,
  type RequestContext,
} from "../../protocol/platform/mod.ts";
import type { ReaderPool } from "../storage/ledger/reader-pool.ts";
import type { EventBackend } from "./subscribe.ts";
import { validateOutput } from "../storage/ledger/output.ts";

// event read는 registered ListEvents를 통해 reader Worker에서 실행한다.
export function createReaderEventBackend(
  pool: ReaderPool,
  current: (credentialRef: string) => Promise<Result<RequestContext>>,
): EventBackend {
  return {
    current,
    async read(ctx, scan) {
      try {
        const position = BigInt(scan.position);
        const result = await pool.read(eventsList, ctx, {
          after_seq: scan.inclusive && position > 0n
            ? (position - 1n).toString()
            : scan.position,
          types: scan.types ? [...scan.types] : [],
          subjects: scan.subjects ? [...scan.subjects] : [],
          limit: scan.limit ?? 256,
        });
        if (!result.ok) return result;
        const output = validateOutput(eventsList.output, result.value);
        if (!output.ok) return output;
        return ok({
          events: output.value.events,
          scanned_through_seq: output.value.scanned_through_seq,
          head_seq: output.value.head_seq,
        });
      } catch {
        return err({
          code: "unavailable",
          message: "event reader를 사용할 수 없다",
        });
      }
    },
  };
}
