// blob 준비·등록 통합 테스트가 writer 안에서 다시 import하는 command.
// 제품 등록과 같은 길(createCoreRegistration)로 blob field와 command를 낸다.
// 테스트 전용 입구(notePrepared)는 쓰지 않는다.

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
} from "../../../packages/protocol/server/mod.ts";

const field = defineBlobField({
  owner_kind: "document_version",
  field: "file",
  retention: { kind: "permanent" },
  general_read: true,
});

const input = z.strictObject({
  owner_key: z.string().regex(/^[a-z][a-z0-9_]*:[A-Za-z0-9_.:-]+$/),
  prepared: preparedBlobSchema,
});

const route = defineCommand({
  resource: "blobref",
  method: "attach",
  name: "blobref.attach",
  input,
  output: z.object({ hash: z.string() }),
  actors: ACTOR_KINDS,
  errors: ["invalid_input", "forbidden", "unavailable", "conflict"],
});

const attached = defineEvent("BlobAttached", {
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
            message: "blob 등록 입력이 schema와 다르다",
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
