import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import {
  RUN_BODY_VIEW_MAX_BYTES,
  runBodyView,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  RequestContext,
  SqlParams,
  SqlRow,
} from "../../../protocol/server/mod.ts";
import {
  runBodyRead,
  type RunBodyViewEnvironment,
  runBodyViewRead,
} from "./reads.ts";

// ReadRunBodyView: 사람 화면이 저장된 본문을 지금의 redaction을 거쳐 읽는 길. ledger 표와 blob store는
// 메모리로 두고 판정만 본다. 실제 core의 기동 조립은 core 쪽 시험이 맡는다.

const RUN = "run_01h455vb4pex5v6nkc6gd5fd01";
const TOOL = "tcl_01h455vb4pex5v6nkc6gd5fd01";
const encoder = new TextEncoder();

async function world(
  value: unknown,
  redact: RunBodyViewEnvironment["redact"],
  refHash?: string,
) {
  const bytes = encoder.encode(JSON.stringify(value));
  const hash = await sha256Hex(bytes);
  const environment: RunBodyViewEnvironment = {
    snapshot<T>(
      read: (
        sql: { get(query: string, params: SqlParams): SqlRow | undefined },
        asOfSeq: string,
      ) => Result<T>,
    ) {
      return read({
        get(query): SqlRow | undefined {
          if (query.includes("from tool_calls")) {
            return { id: TOOL, run: RUN, hash };
          }
          if (query.includes("from blob_refs")) {
            return { hash: refHash ?? hash, size_bytes: bytes.length };
          }
          return undefined;
        },
      }, "7");
    },
    bytes: (want, offset, length) =>
      Promise.resolve(
        want === hash
          ? ok({
            hash,
            sizeBytes: bytes.length,
            bytes: bytes.slice(offset, offset + length),
          })
          : err({ code: "not_found", message: "missing" }),
      ),
    redact,
  };
  return runBodyViewRead(environment);
}

const ctx = (actor: string) => ({ actor }) as unknown as RequestContext;
const mask = (text: string) => text.replaceAll("sk-secret", "[removed]");

Deno.test("lophn-agent/observability#R21: a person reads a stored tool result after the current redaction, with the run it belongs to", async () => {
  const read = await world(
    { summary: "Wrote one.", content: { note: "token sk-secret here" } },
    mask,
  );
  const result = await read.handle(ctx("user"), {
    kind: "tool_call_output",
    id: TOOL,
  });
  assert(result.ok);
  assertEquals(result.value.run, RUN);
  assertEquals(result.value.truncated, false);
  assertEquals(result.value.value, {
    summary: "Wrote one.",
    content: { note: "token [removed] here" },
  });
  assertEquals(
    runBodyView.output.safeParse(result.value).success,
    true,
  );
});

Deno.test("lophn-agent/observability#R20: only a person reads, and every other actor gets the same answer as a missing body", async () => {
  const read = await world({ a: 1 }, mask);
  for (const actor of ["machine", `agent:asg_01h455vb4pex5v6nkc6gd5fd01`]) {
    const result = await read.handle(ctx(actor), {
      kind: "tool_call_input",
      id: TOOL,
    });
    assert(!result.ok);
    assertEquals(result.error.code, "not_found");
  }
});

Deno.test("lophn-agent/observability#R20: a body that redaction cannot finish, or whose stored hash disagrees, is not shown", async () => {
  const unfinished = await world({ a: "x" }, () => null);
  const first = await unfinished.handle(ctx("user"), {
    kind: "tool_call_output",
    id: TOOL,
  });
  assert(!first.ok);
  assertEquals(first.error.code, "unavailable");
  const mismatched = await world({ a: "x" }, mask, "0".repeat(64));
  const second = await mismatched.handle(ctx("user"), {
    kind: "tool_call_output",
    id: TOOL,
  });
  assert(!second.ok);
  assertEquals(second.error.code, "unavailable");
});

Deno.test("lophn-agent/observability#R21: a value over the limit is cut on a character boundary and marked truncated", async () => {
  const long = "한".repeat(RUN_BODY_VIEW_MAX_BYTES);
  const read = await world({ long }, mask);
  const result = await read.handle(ctx("user"), {
    kind: "tool_call_output",
    id: TOOL,
  });
  assert(result.ok);
  assertEquals(result.value.truncated, true);
  const shown = result.value.value as string;
  assert(typeof shown === "string");
  assert(encoder.encode(shown).length <= RUN_BODY_VIEW_MAX_BYTES);
  assert(!shown.includes("�"));
});

Deno.test("lophn-agent/handoff#R5: the machine reads the handoff content a receiving run owns, and no one else does", async () => {
  const content = {
    what: "Tidy the glossary words.",
    why: "the glossary needs one owner",
    excludes: [],
    expected_outputs: ["one context"],
  };
  const bytes = encoder.encode(JSON.stringify(content));
  const hash = await sha256Hex(bytes);
  const queries: string[] = [];
  const read = runBodyRead({
    snapshot<T>(
      read: (
        sql: { get(query: string, params: SqlParams): SqlRow | undefined },
        asOfSeq: string,
      ) => Result<T>,
    ) {
      return read({
        get(query, params): SqlRow | undefined {
          queries.push(query);
          if (!query.includes("from blob_refs") || !params.includes(RUN)) {
            return undefined;
          }
          return { run: RUN, hash, size_bytes: bytes.length };
        },
      }, "9");
    },
    bytes: (want, offset, length) =>
      Promise.resolve(
        want === hash
          ? ok({
            hash,
            sizeBytes: bytes.length,
            bytes: bytes.slice(offset, offset + length),
          })
          : err({ code: "not_found", message: "missing" }),
      ),
  });
  const result = await read.handle(ctx("machine"), {
    kind: "handoff_content",
    id: RUN,
  });
  assert(result.ok);
  assertEquals(result.value.run, RUN);
  assertEquals(result.value.value, content);
  assert(queries[0]!.includes("field = 'handoff_content'"));
  const other = await read.handle(ctx("user"), {
    kind: "handoff_content",
    id: RUN,
  });
  assert(!other.ok);
  assertEquals(other.error.code, "not_found");
});

Deno.test("lophn-agent/agents#R26: the machine reads the resolved agent a run fixed by its own blob reference, and no one else does", async () => {
  const agent = { assignment: "asg_01h455vb4pex5v6nkc6gd5fd01", hash: "a" };
  const bytes = encoder.encode(JSON.stringify(agent));
  const hash = await sha256Hex(bytes);
  const queries: string[] = [];
  const read = runBodyRead({
    snapshot<T>(
      read: (
        sql: { get(query: string, params: SqlParams): SqlRow | undefined },
        asOfSeq: string,
      ) => Result<T>,
    ) {
      return read({
        get(query, params): SqlRow | undefined {
          queries.push(query);
          if (!query.includes("from blob_refs") || !params.includes(RUN)) {
            return undefined;
          }
          return { run: RUN, hash, size_bytes: bytes.length };
        },
      }, "9");
    },
    bytes: (want, offset, length) =>
      Promise.resolve(
        want === hash
          ? ok({
            hash,
            sizeBytes: bytes.length,
            bytes: bytes.slice(offset, offset + length),
          })
          : err({ code: "not_found", message: "missing" }),
      ),
  });
  const result = await read.handle(ctx("machine"), {
    kind: "run_agent",
    id: RUN,
  });
  assert(result.ok);
  assertEquals(result.value.run, RUN);
  assertEquals(result.value.value, agent);
  assert(queries[0]!.includes("field = 'agent'"));
  const other = await read.handle(ctx("user"), { kind: "run_agent", id: RUN });
  assert(!other.ok);
  assertEquals(other.error.code, "not_found");
});
