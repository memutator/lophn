import { assert } from "@std/assert";
import { z } from "zod";
import {
  commandRequestSchema,
  commandResponseSchema,
  idempotencyKeySchema,
  withReadCommon,
} from "./envelope.ts";
import { defineCommand, defineRead } from "./route.ts";

const route = defineCommand({
  resource: "documents",
  method: "save",
  name: "Save",
  input: z.strictObject({ title: z.string() }),
  output: z.object({ id: z.string() }),
  compare: z.strictObject({ hash: z.string() }),
  actors: ["user"],
  errors: ["conflict"],
});

const body = {
  input: { title: "a" },
  idempotency_key: "k1",
  compare: { hash: "h" },
  prepared: [],
};

Deno.test(
  "platform/ledger#R20: command 요청은 route input을 검사하고 본문 actor를 거절한다",
  () => {
    const schema = commandRequestSchema(route);
    assert(schema.safeParse(body).success);
    assert(!schema.safeParse({ ...body, actor: "user" }).success);
    assert(
      !schema.safeParse({ ...body, input: { title: "a", extra: 1 } }).success,
    );
    assert(!schema.safeParse({ ...body, compare: {} }).success);
  },
);

Deno.test(
  "platform/ledger#R12: compare가 없는 command는 빈 객체만 받는다",
  () => {
    const created = defineCommand({
      resource: "projects",
      method: "create",
      name: "Create",
      input: z.strictObject({ name: z.string() }),
      output: z.object({ id: z.string() }),
      actors: ["user"],
      errors: ["invalid_input"],
    });
    const schema = commandRequestSchema(created);
    assert(
      schema.safeParse({ ...body, input: { name: "p" }, compare: {} }).success,
    );
    assert(
      !schema.safeParse({
        ...body,
        input: { name: "p" },
        compare: { seq: "1" },
      }).success,
    );
  },
);

Deno.test(
  "platform/ledger#R13: idempotency key는 UTF-8 1~128 bytes다",
  () => {
    assert(idempotencyKeySchema.safeParse("a").success);
    assert(idempotencyKeySchema.safeParse("a".repeat(128)).success);
    assert(!idempotencyKeySchema.safeParse("").success);
    assert(!idempotencyKeySchema.safeParse("a".repeat(129)).success);
    // 한 글자가 3 bytes라 43글자면 129 bytes다.
    assert(!idempotencyKeySchema.safeParse("가".repeat(43)).success);
    assert(idempotencyKeySchema.safeParse("가".repeat(42)).success);
  },
);

Deno.test(
  "platform/ledger#R5: command 응답의 seq는 함께 null이거나 함께 값이고 last가 first 이상이다",
  () => {
    const schema = commandResponseSchema(route);
    assert(
      schema.safeParse({
        result: { id: "doc_x" },
        first_seq: null,
        last_seq: null,
        replayed: false,
      }).success,
    );
    assert(
      schema.safeParse({
        result: { id: "doc_x" },
        first_seq: "4",
        last_seq: "9",
        replayed: true,
      }).success,
    );
    assert(
      !schema.safeParse({
        result: { id: "doc_x" },
        first_seq: "4",
        last_seq: null,
        replayed: false,
      }).success,
    );
    assert(
      !schema.safeParse({
        result: { id: "doc_x" },
        first_seq: "9",
        last_seq: "4",
        replayed: false,
      }).success,
    );
  },
);

Deno.test(
  "platform/api#R6: command 응답은 모르는 선택 field를 견딘다",
  () => {
    const schema = commandResponseSchema(route);
    const parsed = schema.safeParse({
      result: { id: "doc_x", added: true },
      first_seq: "1",
      last_seq: "1",
      replayed: false,
      later: 1,
    });
    assert(parsed.success);
  },
);

Deno.test(
  "platform/ledger#R14: read 응답은 as_of_seq와 next_cursor와 생략 범위를 싣는다",
  () => {
    const read = defineRead({
      resource: "documents",
      method: "list",
      name: "List",
      input: z.strictObject({}),
      output: withReadCommon(z.object({ items: z.array(z.string()) })),
      actors: ["user"],
      errors: ["not_found"],
    });
    const ok = {
      items: ["a"],
      as_of_seq: "12",
      next_cursor: null,
      omitted: [{ reason: "page_limit", count: 2 }],
    };
    assert(read.output.safeParse(ok).success);
    const withCursor = { ...ok, next_cursor: "c1", later: true };
    assert(read.output.safeParse(withCursor).success);
    assert(!read.output.safeParse({ ...ok, as_of_seq: "01" }).success);
    assert(
      !read.output.safeParse({
        ...ok,
        omitted: [{ reason: "scope", count: 1 }],
      }).success,
    );
  },
);
