import { assert } from "@std/assert";
import {
  applyMessagesInputSchema,
  applyMessagesOutputSchema,
  messageCommandOutputSchema,
  messagesListInputSchema,
  messagesListOutputSchema,
  messageSnapshotSchema,
} from "./messages.ts";
import { body, mcl, msg, msg2, run, ses } from "./message-fixtures.ts";

const unassigned = {
  id: msg,
  session: ses,
  actor: "user",
  body,
  run: null,
  mode: "request",
  applied_at_call: null,
  links: [],
  copied_from: null,
};

Deno.test("lophn-agent/conversation#R5: list and apply keep created order without claiming first application", () => {
  const snapshot = {
    message: { ...unassigned, run, actor: "machine", mode: null },
    created_seq: "3",
    state_seq: "4",
  };
  assert(
    messagesListInputSchema.safeParse({
      session: ses,
      after_seq: "1",
      through_seq: "9",
      limit: Number.MAX_SAFE_INTEGER,
    }).success,
  );
  assert(
    !messagesListInputSchema.safeParse({
      session: ses,
      after_seq: "9",
      through_seq: "9",
    }).success,
  );
  assert(
    !messagesListInputSchema.safeParse({ session: ses, limit: 0 }).success,
  );
  assert(!messagesListInputSchema.safeParse({ session: "session" }).success);
  assert(
    messagesListOutputSchema.safeParse({
      as_of_seq: "5",
      next_cursor: null,
      messages: [snapshot, {
        ...snapshot,
        message: { ...snapshot.message, id: msg2 },
        created_seq: "5",
        state_seq: "5",
      }],
    }).success,
  );
  assert(
    !messagesListOutputSchema.safeParse({
      as_of_seq: "5",
      next_cursor: null,
      messages: [snapshot, snapshot],
    }).success,
  );
  assert(
    !messagesListOutputSchema.safeParse({
      as_of_seq: "3",
      next_cursor: null,
      messages: [snapshot],
    }).success,
  );
  assert(
    applyMessagesInputSchema.safeParse({ messages: [msg, msg2], call: mcl })
      .success,
  );
  assert(
    !applyMessagesInputSchema.safeParse({ messages: [msg, msg], call: mcl })
      .success,
  );
  assert(
    !applyMessagesOutputSchema.safeParse({
      messages: [snapshot, snapshot],
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R5: malformed seq values fail without throwing", () => {
  const snapshot = { message: unassigned, created_seq: "3", state_seq: "4" };
  for (const invalid of ["bad", "01", "-1", "1.5", ""]) {
    assert(
      !messagesListInputSchema.safeParse({
        session: ses,
        after_seq: invalid,
        through_seq: "9",
      }).success,
    );
    assert(
      !messagesListInputSchema.safeParse({
        session: ses,
        after_seq: "1",
        through_seq: invalid,
      }).success,
    );
    for (const field of ["created_seq", "state_seq"]) {
      const malformed = { ...snapshot, [field]: invalid };
      assert(!messageSnapshotSchema.safeParse(malformed).success);
      assert(!messageCommandOutputSchema.safeParse(malformed).success);
      assert(
        !applyMessagesOutputSchema.safeParse({ messages: [malformed] }).success,
      );
      assert(
        !messagesListOutputSchema.safeParse({
          as_of_seq: "5",
          next_cursor: null,
          messages: [malformed],
        }).success,
      );
    }
    assert(
      !messagesListOutputSchema.safeParse({
        as_of_seq: invalid,
        next_cursor: null,
        messages: [snapshot],
      }).success,
    );
  }
});
