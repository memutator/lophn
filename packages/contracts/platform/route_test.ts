import { assert, assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import {
  ACTOR_KINDS,
  defineCommand,
  defineFile,
  defineMemory,
  defineRead,
  defineUpload,
  defineWorker,
  ROUTE_KINDS,
  routePath,
} from "./route.ts";

const input = z.strictObject({ title: z.string() });
const output = z.object({ id: z.string() });

Deno.test(
  "platform/api#R2: 경로는 /v1/<resource>/<method> 정확히 세 구간이다",
  () => {
    const route = defineCommand({
      resource: "documents",
      method: "confirm-next",
      name: "ConfirmNext",
      input,
      output,
      actors: ["user"],
      errors: ["invalid_input", "conflict"],
    });
    assertEquals(route.kind, "command");
    assertEquals(routePath(route), "/v1/documents/confirm-next");
    assertEquals(
      routePath(defineRead({
        resource: "events",
        method: "preview_tracking",
        name: "PreviewTracking",
        input,
        output,
        actors: ["machine"],
        errors: ["not_found"],
      })),
      "/v1/events/preview_tracking",
    );
    for (const bad of ["Documents", "1events", "a/b", ""]) {
      assertThrows(() =>
        defineCommand({
          resource: bad,
          method: "ok",
          name: "Ok",
          input,
          output,
          actors: ["user"],
          errors: ["invalid_input"],
        })
      );
    }
  },
);

Deno.test(
  "platform/api#R3 shell/workspace#R10: route kind는 command·read·file·worker·memory이고 file은 바이트 응답이다",
  () => {
    const file = defineFile({
      resource: "documents",
      method: "read-file",
      name: "ReadFile",
      input,
      contentType: "text/markdown",
      actors: ["user"],
      errors: ["not_found", "forbidden"],
    });
    assertEquals(file.kind, "file");
    assertEquals(file.output, { contentType: "text/markdown" });
    const worker = defineWorker({
      resource: "diagnostics",
      method: "check",
      name: "Check",
      input,
      output,
      actors: ["machine"],
      errors: ["unavailable"],
    });
    assertEquals(worker.kind, "worker");
    const memory = defineMemory({
      resource: "workspace",
      method: "publish",
      name: "Publish",
      input,
      output,
      actors: ["user"],
      errors: ["unavailable"],
    });
    assertEquals(memory.kind, "memory");
    assertThrows(() =>
      defineMemory({
        resource: "workspace",
        method: "bind",
        name: "Bind",
        input,
        output,
        actors: ["user"],
        errors: ["conflict"],
        confirmation: "required",
        binding: ["title"],
      } as never)
    );
    assertEquals([...ROUTE_KINDS], [
      "command",
      "read",
      "file",
      "worker",
      "memory",
      "upload",
    ]);
    assertEquals([...ACTOR_KINDS], [
      "user",
      "coding_agent",
      "agent",
      "app",
      "machine",
    ]);
  },
);

Deno.test(
  "platform/api#R3: upload route는 바이트 body와 상한을 선언하고 사람 결정·CAS를 받지 않는다",
  () => {
    const upload = defineUpload({
      resource: "documents",
      method: "upload",
      name: "Upload",
      input,
      output,
      actors: ["user"],
      errors: ["invalid_input", "unavailable"],
      max_bytes: 1024,
    });
    assertEquals(upload.kind, "upload");
    assertEquals(upload.max_bytes, 1024);
    assertEquals(routePath(upload), "/v1/documents/upload");
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      assertThrows(() =>
        defineUpload({
          resource: "documents",
          method: "upload",
          name: "Upload",
          input,
          output,
          actors: ["user"],
          errors: ["invalid_input"],
          max_bytes: bad,
        })
      );
    }
    assertThrows(() =>
      defineUpload({
        resource: "documents",
        method: "upload",
        name: "Upload",
        input,
        output,
        actors: ["user"],
        errors: ["invalid_input"],
        max_bytes: 10,
        confirmation: "required",
        binding: ["title"],
      } as never)
    );
  },
);

Deno.test(
  "platform/api#R3: route 오류는 공통 7종 안이고 입력 schema type이 route에 남는다",
  () => {
    const route = defineCommand({
      resource: "approvals",
      method: "grant",
      name: "GrantApproval",
      input,
      output,
      compare: z.strictObject({ seq: z.string() }),
      actors: ["user"],
      errors: ["conflict"],
      display_read: "/v1/approvals/get",
    });
    assertEquals(route.display_read, "/v1/approvals/get");
    assert(route.input.safeParse({ title: "x" }).success);
    const accepted: z.infer<typeof route.input> = { title: "x" };
    assertEquals(accepted.title, "x");
    assertThrows(() =>
      defineRead({
        resource: "approvals",
        method: "get",
        name: "Get",
        input,
        output,
        actors: ["user"],
        errors: ["nope" as "conflict"],
      })
    );
  },
);

Deno.test(
  "shell/confirmation-window#R1: confirmation 종류는 decision과 secret_input이고 confirmation 없이 쓰지 않는다",
  () => {
    const secret = defineCommand({
      resource: "secrets",
      method: "set",
      name: "SetSecret",
      input: z.strictObject({ name: z.string() }),
      output: z.object({}),
      actors: ["user"],
      errors: [],
      confirmation: "required",
      binding: ["name"],
      confirmation_kind: "secret_input",
    });
    assertEquals(secret.confirmation_kind, "secret_input");
    assertThrows(() =>
      defineCommand({
        resource: "secrets",
        method: "remove",
        name: "RemoveSecret",
        input: z.strictObject({ name: z.string() }),
        output: z.object({}),
        actors: ["user"],
        errors: [],
        confirmation_kind: "decision",
      })
    );
  },
);
