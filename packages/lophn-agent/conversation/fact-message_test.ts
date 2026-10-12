import { assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { envelope } from "../harness/run-loop/testing/mod.ts";
import { serializeMessageContent } from "../../contracts/lophn-agent/mod.ts";
import {
  code,
  count,
  eventsOf,
  machineCred,
  messageRow,
  open,
  openLophn,
  output,
  seed,
  sql,
} from "./world_test.ts";
import { factMessageContent } from "./mod.ts";

// 사실 메시지(lophn-agent/revert R19): 다른 command가 같은 transaction에서 session에 machine 메시지를
// 남긴다. 실제 등록 executor(harness)와 임시 ledger를 쓴다.

Deno.test("lophn-agent/revert#R19: a fact message is a machine message without a run, with its body reference in the same transaction", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const text = "Undid edit to notes/a.md";
    const { message } = output<{ message: string }>(
      await h.command(
        machineCred,
        envelope("SeedFactMessage", { session, text }),
      ),
    );
    const hash = createHash("sha256")
      .update(serializeMessageContent(factMessageContent(text)))
      .digest("hex");
    const row = (await messageRow(h, message))!;
    assertEquals(
      [row["actor"], row["run"], row["body"], row["session"]],
      ["machine", null, hash, session],
    );
    assertEquals((await eventsOf(h, "MessageRecorded", message)).length, 1);
    assertEquals(
      (await sql(h, "select hash from blob_refs where owner_key = ?", [
        message,
      ])).map((ref) => ref["hash"]),
      [hash],
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R19: a fact message is not recorded in a session that is not there", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    code(
      await h.command(
        machineCred,
        envelope("SeedFactMessage", {
          session: "ses_01arz3ndektsv4rrffq69g5fzz",
          text: "Undid edit to a.md",
        }),
      ),
      "not_found",
    );
    assertEquals(await count(h, "messages", `session = '${session}'`), 0);
  } finally {
    await h.close();
  }
});
