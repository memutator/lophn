import { assertEquals } from "@std/assert";
import { ok } from "../../packages/base/mod.ts";
import {
  runBody,
  toolCallList,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import { savedDocumentLinks } from "./answer-links.ts";
import type { CoreCall } from "./core-call.ts";

const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const MODEL_CALL = "mcl_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);
const DOC_A = "doc_01arz3ndektsv4rrffq69g5fa1";
const DOC_B = "doc_01arz3ndektsv4rrffq69g5fa2";
const VER = (n: number) => `ver_01arz3ndektsv4rrffq69g5fb${n}`;
const tcl = (n: number) => `tcl_01arz3ndektsv4rrffq69g5fc${n}`;

type Call = {
  id: string;
  tool: string;
  outcome: "success" | "failure";
  content: unknown;
};

function machine(calls: Call[], pageSize = 100): CoreCall {
  return (path, body) => {
    if (path === routePath(toolCallList)) {
      const input = body as { cursor?: string };
      const start = input.cursor === undefined ? 0 : Number(input.cursor);
      const page = calls.slice(start, start + pageSize);
      const next = start + pageSize < calls.length
        ? String(start + pageSize)
        : null;
      return Promise.resolve(ok({
        tool_calls: page.map((call, index) => ({
          id: call.id,
          run: RUN,
          model_call: MODEL_CALL,
          response_key: `key${start + index}`,
          response_order: start + index,
          tool: call.tool,
          definition_revision: "1",
          effect: "write",
          app_command: null,
          confirm: false,
          extension: null,
          input: HASH,
          output: call.outcome === "success" ? HASH : null,
          retry_of: null,
          attempt: 0,
          retry_at: null,
          decision: null,
          state: "finished",
          started_at: "2026-10-10T00:00:00.000Z",
          finished_at: "2026-10-10T00:00:01.000Z",
          duration_ms: 1,
          outcome: { kind: call.outcome, code: call.outcome },
        })),
        as_of_seq: "1",
        next_cursor: next,
      }));
    }
    if (path === routePath(runBody)) {
      const input = body as { id: string };
      const call = calls.find((item) => item.id === input.id)!;
      return Promise.resolve(ok({
        kind: "tool_call_output",
        id: call.id,
        run: RUN,
        hash: HASH,
        size_bytes: 10,
        value: { status: "success", content: call.content },
        as_of_seq: "1",
        next_cursor: null,
      }));
    }
    throw new Error(`unexpected route ${path}`);
  };
}

const saved = (document: string, version: string) => ({
  accepted: true,
  version_confirmed: true,
  status: "saved",
  document,
  version,
});

Deno.test("lophn-agent/conversation#R4: run이 저장한 문서 판만 결과 링크가 되고 같은 문서는 마지막 판이다", async () => {
  const links = await savedDocumentLinks(
    machine([
      {
        id: tcl(1),
        tool: "document.create",
        outcome: "success",
        content: saved(DOC_A, VER(1)),
      },
      {
        id: tcl(2),
        tool: "document.save_version",
        outcome: "success",
        content: saved(DOC_A, VER(2)),
      },
      {
        id: tcl(3),
        tool: "document.create",
        outcome: "success",
        content: saved(DOC_B, VER(3)),
      },
    ]),
    RUN,
  );
  assertEquals(
    links,
    ok([
      { kind: "version", document: DOC_A, version: VER(2) },
      { kind: "version", document: DOC_B, version: VER(3) },
    ]),
  );
});

Deno.test("lophn-agent/conversation#R4: 실패·불명확·새 판 없음·읽기 call은 링크가 아니고 저장이 없으면 링크가 없다", async () => {
  const links = await savedDocumentLinks(
    machine([
      {
        id: tcl(1),
        tool: "document.create",
        outcome: "failure",
        content: null,
      },
      {
        id: tcl(2),
        tool: "document.save_version",
        outcome: "success",
        content: { ...saved(DOC_A, VER(1)), status: "unchanged" },
      },
      {
        id: tcl(3),
        tool: "document.create",
        outcome: "success",
        content: { accepted: null, version_confirmed: false, document: DOC_B },
      },
      {
        id: tcl(4),
        tool: "document.read_version",
        outcome: "success",
        content: saved(DOC_B, VER(2)),
      },
    ]),
    RUN,
  );
  assertEquals(links, ok([]));
});

Deno.test("lophn-agent/conversation#R4: tool call 목록이 여러 쪽이어도 모든 저장을 본다", async () => {
  const calls: Call[] = [
    {
      id: tcl(1),
      tool: "document.create",
      outcome: "success",
      content: saved(DOC_A, VER(1)),
    },
    {
      id: tcl(2),
      tool: "document.create",
      outcome: "success",
      content: saved(DOC_B, VER(2)),
    },
  ];
  const links = await savedDocumentLinks(machine(calls, 1), RUN);
  assertEquals(
    links,
    ok([
      { kind: "version", document: DOC_A, version: VER(1) },
      { kind: "version", document: DOC_B, version: VER(2) },
    ]),
  );
});
