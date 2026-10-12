// `problems.closing` 반응기의 core loopback HTTP 통로. test-runner worker가
// hello가 준 machine credential로 event 읽기·문제 기준 읽기·닫힘 command·cursor 전진을
// 낸다. ledger를 직접 열지 않는다. fetch는 주입받는다(EXTERNAL_FETCH tripwire: bare fetch
// 대신 property 접근으로 넘긴다).
import { err, ERROR_CODES, ok, type Result } from "../../../../base/mod.ts";
import type { LophnError } from "../../../../base/mod.ts";
import { CLOSING_SUBSCRIBER, type ClosingReactionPorts } from "../work.ts";
export type { ClosingReactionPorts };

export type LoopbackFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; bytes: Uint8Array }>;

export type ClosingClientOptions = {
  baseUrl: string;
  credential: string;
  fetch: LoopbackFetch;
};

const decoder = new TextDecoder();

function codeOf(value: unknown): LophnError["code"] {
  return (ERROR_CODES as readonly unknown[]).includes(value)
    ? value as LophnError["code"]
    : "internal";
}

export function createClosingPorts(
  options: ClosingClientOptions,
): ClosingReactionPorts {
  const base = options.baseUrl.replace(/\/$/, "");
  async function call(
    path: string,
    body: unknown,
  ): Promise<Result<Record<string, unknown>, LophnError>> {
    let response: { status: number; bytes: Uint8Array };
    try {
      response = await options.fetch(`${base}/v1/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      return err({ code: "unavailable", message: "core request failed" });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(response.bytes));
    } catch {
      parsed = undefined;
    }
    if (response.status !== 200) {
      const failure = (parsed as { error?: { code?: unknown } } | undefined)
        ?.error;
      return err({
        code: codeOf(failure?.code),
        message: "core request failed",
      });
    }
    if (typeof parsed !== "object" || parsed === null) {
      return err({ code: "internal", message: "core answer is not JSON" });
    }
    return ok(parsed as Record<string, unknown>);
  }
  return {
    async events(after, types) {
      const read = await call("events/list", {
        after_seq: after,
        types: [...types],
      });
      if (!read.ok) return read;
      const events = read.value["events"];
      const scanned = read.value["scanned_through_seq"];
      const head = read.value["head_seq"];
      if (
        !Array.isArray(events) || typeof scanned !== "string" ||
        typeof head !== "string"
      ) {
        return err({ code: "internal", message: "events answer is malformed" });
      }
      return ok({
        events: events as never,
        scanned_through_seq: scanned,
        head_seq: head,
      });
    },
    async problem(problem) {
      const read = await call("problems/get", { problem });
      // 없거나 범위 밖인 문제는 같은 not_found라 반응할 것이 없다.
      if (!read.ok) return read.error.code === "not_found" ? ok(null) : read;
      const found = read.value["problem"] as { seq?: unknown } | undefined;
      if (typeof found?.seq !== "string") {
        return err({
          code: "internal",
          message: "problem answer is malformed",
        });
      }
      return ok({ seq: found.seq });
    },
    async close(call_) {
      return await call("problems/close-verified", {
        input: call_.input,
        idempotency_key: call_.key,
        compare: call_.compare,
        prepared: [],
      });
    },
    async advance(through, from) {
      return await call("events/advance-cursor", {
        input: { subscriber: CLOSING_SUBSCRIBER, scanned_through_seq: through },
        idempotency_key: `cursor:${CLOSING_SUBSCRIBER}:${through}`,
        compare: { processed_through_seq: from },
        prepared: [],
      });
    },
  };
}
