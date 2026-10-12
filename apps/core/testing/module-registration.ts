// format module 묶음 보존 통합 테스트가 writer 안에서 다시 import하는 command.
// blob 준비(preflight된 prepared)를 purpose `format_module` 소유자의 `bundle`
// field에 등록한다. 제품 등록과 같은 길(tx.registerBlobRef)로 등록한다.

import { z } from "zod";
import { err, ok } from "../../../packages/base/mod.ts";
import {
  ACTOR_KINDS,
  type CommandDefinition,
  defineBlobField,
  defineCommand,
  defineEvent,
  type PreparedBlob,
  preparedBlobSchema,
} from "../../../packages/protocol/platform/mod.ts";

const field = defineBlobField({
  owner_kind: "format_module",
  field: "bundle",
  retention: { kind: "permanent" },
  general_read: true,
});

const input = z.strictObject({
  owner_key: z.string().regex(/^[a-z][a-z0-9_]*:[A-Za-z0-9_.:-]+$/),
  prepared: preparedBlobSchema,
});

const route = defineCommand({
  resource: "moduleref",
  method: "attach",
  name: "moduleref.attach",
  input,
  output: z.object({ hash: z.string() }),
  actors: ACTOR_KINDS,
  errors: ["invalid_input", "forbidden", "unavailable", "conflict"],
});

const attached = defineEvent("ModuleAttached", {
  subject: z.string(),
  payload: z.object({ owner_key: z.string() }),
});

export function createCoreRegistration(): {
  blobFields: readonly [typeof field];
  commands: readonly CommandDefinition[];
} {
  return {
    blobFields: [field],
    commands: [{
      route,
      handle(tx, _ctx, raw) {
        const parsed = input.safeParse(raw);
        if (!parsed.success) {
          return err({
            code: "invalid_input",
            message: "module 등록 입력이 schema와 다르다",
          });
        }
        const prepared: PreparedBlob = parsed.data.prepared;
        const seq = tx.emit(
          attached,
          parsed.data.owner_key,
          { owner_key: parsed.data.owner_key },
        );
        const registered = tx.registerBlobRef({
          owner_kind: field.owner_kind,
          owner_key: parsed.data.owner_key,
          field: field.field,
          registered_seq: seq,
          source: { kind: "prepared", blob: prepared },
        });
        if (!registered.ok) return registered;
        return ok({ hash: registered.value.hash });
      },
    }],
  };
}
