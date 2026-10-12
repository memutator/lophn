// documents/outline-and-search#R14: search 목록의 lagging은 cursor가 ledger 끝까지 가야 풀린다.
// consumer가 쓰지 않는 documents event가 ledger 끝에 붙어도 feed는 search 확인을 깨워 cursor를
// scanned_through_seq까지 전진시켜야 한다.
import { assert } from "@std/assert";
import { ok } from "../../../../base/mod.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import type { EventEnvelope } from "../../../../protocol/events/mod.ts";
import type {
  EventBackend,
  EventSession,
} from "../../../storage/ledger/mod.ts";
import { type DocumentsFeedDeps, startDocumentsFeed } from "./feed.ts";

const CONTEXT: RequestContext = {
  principal: "machine:documents-feed",
  actor: "machine",
  scope: { operations: ["ListEvents"], targets: {} },
  conditions: {},
  credential_ref: "machine:documents-feed",
};

function envelope(seq: number, type: string): EventEnvelope {
  return {
    seq: String(seq),
    type,
    subject: "doc_01kq12a1pha000000000000000",
    actor: "user",
    run: null,
    payload: {},
    at: "2026-10-06T00:00:00.000Z",
  };
}

function fakeBackend() {
  const log: EventEnvelope[] = [];
  const backend: EventBackend = {
    current: () => Promise.resolve(ok(CONTEXT)),
    read(_ctx, scan) {
      const from = BigInt(scan.position) + (scan.inclusive ? 0n : 1n);
      const events = log.filter((event) => BigInt(event.seq) >= from);
      const head = log.at(-1)?.seq ?? "0";
      return Promise.resolve(ok({
        events: scan.limit === 1 ? [] : events,
        scanned_through_seq: scan.limit === 1 ? "0" : head,
        head_seq: head,
      }));
    },
  };
  return { backend, log };
}

async function until(what: string, ready: () => boolean): Promise<void> {
  for (let waited = 0; waited < 300 && !ready(); waited++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert(ready(), `timed out: ${what}`);
}

Deno.test("documents/outline-and-search#R14: 소비하지 않는 documents event도 search 확인을 깨운다", async () => {
  const { backend, log } = fakeBackend();
  const sessions = new Set<EventSession>();
  let checks = 0;
  const feed = startDocumentsFeed({
    runtime: {
      events: backend,
      track: (session: EventSession) => {
        sessions.add(session);
        return () => sessions.delete(session);
      },
    } as unknown as DocumentsFeedDeps["runtime"],
    roots: () => undefined,
    basis: () => undefined,
    search: () => ({
      check() {
        checks += 1;
        return Promise.resolve();
      },
      stop() {},
    }),
    debounceMs: 10,
    retryMs: 10,
  });
  try {
    await until("subscribed", () => feed.open && checks >= 1);
    const before = checks;
    // DocumentSourceChanged는 feed에는 열려 있지만 search consumer가 쓰지 않는 event다.
    log.push(envelope(1, "DocumentSourceChanged"));
    for (const session of sessions) session.catchUp();
    await until("search woken by a non-consumed event", () => checks > before);
  } finally {
    feed.stop();
  }
});
