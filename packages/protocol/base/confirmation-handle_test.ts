import { assert, assertEquals, assertThrows } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { z } from "zod";
import {
  CONFIRMATION_HANDLE_TTL_MS,
  type ConfirmationHandleMessage,
  confirmationHandleMessageSchema,
  confirmationHandleRegisteredSchema,
  confirmationHandleRegisterSchema,
  confirmationRefSchema,
  defineDecision,
} from "./confirmation-handle.ts";
import { commandRequestSchema } from "./envelope.ts";
import {
  defineCommand,
  defineFile,
  defineRead,
  defineWorker,
} from "./route.ts";

const REF = "A".repeat(43);
const HASH = "ab".repeat(32);
const AT = "2026-10-04T00:00:00.000Z";

const register = {
  type: "confirmation_handle_register",
  window_id: "win-1",
  target_ref: "apr_01arz3ndektsv4rrffq69g5fav",
  content_hash: HASH,
  allowed_decisions: ["grant", "reject"],
  expires_at: AT,
};

Deno.test(
  "platform/identity#R14: handle 등록은 창·대상·내용 기준·허용 결정·기한을 묶고 원문 없이 참조만 돌려준다",
  () => {
    assertEquals(CONFIRMATION_HANDLE_TTL_MS, 120_000);
    assert(confirmationHandleRegisterSchema.safeParse(register).success);
    const registered = confirmationHandleRegisteredSchema.parse({
      type: "confirmation_handle_registered",
      confirmation: REF,
      expires_at: AT,
    });
    assertEquals(Object.keys(registered), [
      "type",
      "confirmation",
      "expires_at",
    ]);
    const message: ConfirmationHandleMessage = registered;
    assert(confirmationHandleMessageSchema.safeParse(message).success);
    assertEquals(defineDecision("delete_file"), "delete_file");
  },
);

Deno.test(
  "platform/identity#R14: 모르는 field·틀린 참조·중복 결정·틀린 hash를 거절한다",
  () => {
    assert(!confirmationRefSchema.safeParse("short").success);
    assert(!confirmationRefSchema.safeParse(`${REF}=`).success);
    assert(
      !confirmationHandleRegisterSchema.safeParse({ ...register, extra: 1 })
        .success,
    );
    assert(
      !confirmationHandleRegisterSchema.safeParse({
        ...register,
        allowed_decisions: ["grant", "grant"],
      }).success,
    );
    assert(
      !confirmationHandleRegisterSchema.safeParse({
        ...register,
        allowed_decisions: [],
      }).success,
    );
    assert(
      !confirmationHandleRegisterSchema.safeParse({
        ...register,
        content_hash: HASH.toUpperCase(),
      }).success,
    );
    assert(
      !confirmationHandleRegisterSchema.safeParse({
        ...register,
        expires_at: "2026-10-04",
      }).success,
    );
    assertEquals(
      defineDecision("RevokeCodingAgentConnection"),
      "RevokeCodingAgentConnection",
    );
    assertThrows(() => defineDecision("delete-file"));
    // apps의 command route 이름은 점으로 나뉜다. 마디가 비면 거절한다.
    assertEquals(defineDecision("grant.revoke"), "grant.revoke");
    assertThrows(() => defineDecision("grant."));
    assertThrows(() => defineDecision(".revoke"));
  },
);

const deleteInput = z.strictObject({
  path: z.string(),
  base_hash: z.string(),
  operation: z.literal("delete"),
});

const guarded = defineCommand({
  resource: "files",
  method: "delete",
  name: "DeleteFile",
  input: deleteInput,
  output: z.object({ recorded: z.boolean() }),
  actors: ["user"],
  errors: ["forbidden", "conflict"],
  confirmation: "required",
  binding: ["path", "base_hash", "operation"],
  display_read: "/v1/files/status",
});

Deno.test(
  "platform/identity#R14: confirmation을 선언한 route는 handle 참조 없는 요청을 거절한다",
  () => {
    assertEquals(guarded.confirmation, "required");
    assertEquals(guarded.binding ? [...guarded.binding] : [], [
      "path",
      "base_hash",
      "operation",
    ]);
    const schema = commandRequestSchema(guarded);
    const body = {
      input: { path: "notes/a.md", base_hash: HASH, operation: "delete" },
      idempotency_key: "k1",
      compare: {},
      prepared: [],
    };
    assert(!schema.safeParse(body).success);
    assert(schema.safeParse({ ...body, confirmation: REF }).success);
    assert(!schema.safeParse({ ...body, confirmation: "not-a-ref" }).success);
    assert(
      !schema.safeParse({ ...body, confirmation: REF, extra: true }).success,
    );
  },
);

Deno.test(
  "platform/identity#R14: 선언 없는 route의 confirmation은 선택이고 선언은 입력 field만 묶는다",
  () => {
    const plain = defineCommand({
      resource: "projects",
      method: "create",
      name: "Create",
      input: z.strictObject({ name: z.string() }),
      output: z.object({ id: z.string() }),
      actors: ["user"],
      errors: ["invalid_input"],
    });
    const schema = commandRequestSchema(plain);
    const body = {
      input: { name: "p" },
      idempotency_key: "k1",
      compare: {},
      prepared: [],
    };
    assert(schema.safeParse(body).success);
    assert(schema.safeParse({ ...body, confirmation: REF }).success);
    const file = defineFile({
      resource: "files",
      method: "delete",
      name: "DeleteFile",
      input: deleteInput,
      contentType: "application/json",
      actors: ["user"],
      errors: ["conflict"],
      confirmation: "required",
      binding: ["path", "base_hash", "operation"],
    });
    assertEquals(file.confirmation, "required");
    const worker = defineWorker({
      resource: "files",
      method: "delete",
      name: "DeleteFile",
      input: deleteInput,
      output: z.object({ ok: z.boolean() }),
      actors: ["machine"],
      errors: ["unavailable"],
      confirmation: "required",
      binding: ["path", "base_hash", "operation"],
    });
    assertEquals(worker.kind, "worker");
    assertThrows(() =>
      defineCommand({
        resource: "files",
        method: "delete",
        name: "DeleteFile",
        input: deleteInput,
        output: z.object({ ok: z.boolean() }),
        actors: ["user"],
        errors: ["conflict"],
        confirmation: "required",
        binding: ["missing"],
      } as never)
    );
    assertThrows(() =>
      defineRead({
        resource: "files",
        method: "status",
        name: "FileStatus",
        input: deleteInput,
        output: z.object({ ok: z.boolean() }),
        actors: ["user"],
        errors: ["not_found"],
        confirmation: "required",
        binding: ["path"],
      } as never)
    );
    for (const code of guarded.errors) assert(ERROR_CODES.includes(code));
  },
);
