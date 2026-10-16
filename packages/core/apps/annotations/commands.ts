// 저장 command. annotation.send(memory route)가 사람의 자격으로 부른다: 묶음 저장, 전달 실패 때 정리,
// 전달한 session 기록 ref 남기기. sweep은 core 안 machine이 부른다.
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import { defineCommand } from "../../../protocol/base/mod.ts";
import {
  ANNOTATION_BATCH_MAX,
  annotationBatchIdSchema,
  annotationIdSchema,
  annotationInputSchema,
  annotationSourceSchema,
} from "../../../protocol/apps/annotation.ts";
import { appRegistrationLookup } from "../../../protocol/apps/apps.ts";
import { appIdSchema } from "../../../protocol/projects/values.ts";
import type { CommandDefinition } from "../../../protocol/server/mod.ts";
import { addRef, deleteAnnotations, sweep } from "./retention.ts";
import { headSeq } from "./store.ts";

const noCompare = z.strictObject({});

export const annotationPersist = defineCommand({
  resource: "annotations",
  method: "persist",
  name: "AnnotationPersist",
  input: z.strictObject({
    app: appIdSchema,
    // source는 core가 release의 source map으로 푼 값이다. 못 풀었으면 null이다.
    annotations: z.array(z.strictObject({
      input: annotationInputSchema,
      source: annotationSourceSchema.nullable(),
    })).min(1).max(ANNOTATION_BATCH_MAX),
  }),
  output: z.object({
    batch: annotationBatchIdSchema,
    annotations: z.array(annotationIdSchema),
  }),
  compare: noCompare,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const annotationDiscard = defineCommand({
  resource: "annotations",
  method: "discard",
  name: "AnnotationDiscard",
  input: z.strictObject({ batch: annotationBatchIdSchema }),
  output: z.object({}),
  compare: noCompare,
  actors: ["user"],
  errors: ["forbidden"],
});

export const annotationAddRefs = defineCommand({
  resource: "annotations",
  method: "add_refs",
  name: "AnnotationAddRefs",
  input: z.strictObject({
    annotations: z.array(annotationIdSchema).min(1).max(ANNOTATION_BATCH_MAX),
    owner_kind: z.literal("session_message"),
    owner_id: z.string().min(1),
  }),
  output: z.object({}),
  compare: noCompare,
  actors: ["user"],
  errors: ["forbidden", "not_found"],
});

export const annotationSweep = defineCommand({
  resource: "annotations",
  method: "sweep",
  name: "AnnotationSweep",
  input: z.strictObject({}),
  output: z.object({ removed: z.number().int() }),
  compare: noCompare,
  actors: ["machine"],
  errors: ["forbidden"],
});

const forbidden = (message: string) =>
  err({ code: "forbidden" as const, message });

export function createAnnotationCommands(): {
  persist: CommandDefinition<typeof annotationPersist>;
  discard: CommandDefinition<typeof annotationDiscard>;
  addRefs: CommandDefinition<typeof annotationAddRefs>;
  sweep: CommandDefinition<typeof annotationSweep>;
} {
  return {
    persist: {
      route: annotationPersist,
      handle(tx, ctx, input) {
        if (ctx.actor !== "user") return forbidden("only a person sends");
        const registered = tx.port(appRegistrationLookup).get(input.app);
        if (!registered.ok) return registered;
        if (registered.value === null) {
          return err({ code: "not_found", message: "app does not exist" });
        }
        if (registered.value.status === "archived") {
          return err({
            code: "conflict",
            message: "an archived app does not take new input",
          });
        }
        const batch = tx.newId("anb");
        tx.sql.run(
          `INSERT INTO annotation_batches (id, app, sent_at, sent_by)
           VALUES (?, ?, ?, ?)`,
          [batch, input.app, tx.now(), ctx.actor],
        );
        const registeredSeq = headSeq(tx.sql);
        const ids: string[] = [];
        for (const { input: item, source } of input.annotations) {
          const id = tx.newId("ann");
          ids.push(id);
          tx.sql.run(
            `INSERT INTO annotations
               (id, batch, app, n, kind, note, screenshot_hash, screenshot_size,
                component, source_file, source_line, element, rect, view, release,
                bundle_position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              batch,
              input.app,
              item.n,
              item.kind,
              item.note,
              item.screenshot?.hash ?? null,
              item.screenshot?.size_bytes ?? null,
              item.component,
              source?.file ?? null,
              source?.line ?? null,
              JSON.stringify(item.element),
              JSON.stringify(item.rect),
              JSON.stringify(item.view),
              item.release,
              item.bundle_position === null
                ? null
                : JSON.stringify(item.bundle_position),
            ],
          );
          if (item.screenshot !== null) {
            const blob = tx.registerBlobRef({
              owner_kind: "annotation",
              owner_key: id,
              field: "screenshot",
              registered_seq: registeredSeq,
              source: { kind: "prepared", blob: { ...item.screenshot } },
            });
            if (!blob.ok) return blob;
          }
        }
        return ok({ batch, annotations: ids } as never);
      },
    },
    discard: {
      route: annotationDiscard,
      handle(tx, ctx, input) {
        if (ctx.actor !== "user") return forbidden("only a person sends");
        const ids = tx.sql.all(
          "SELECT id FROM annotations WHERE batch = ?",
          [input.batch],
        ).map((row) => String(row["id"]));
        const deleted = deleteAnnotations(tx, ids);
        return deleted.ok ? ok({}) : deleted;
      },
    },
    addRefs: {
      route: annotationAddRefs,
      handle(tx, ctx, input) {
        if (ctx.actor !== "user") return forbidden("only a person sends");
        for (const id of input.annotations) {
          if (
            tx.sql.get("SELECT 1 AS found FROM annotations WHERE id = ?", [
              id,
            ]) ===
              undefined
          ) {
            return err({
              code: "not_found",
              message: "annotation does not exist",
            });
          }
          addRef(tx.sql, id, input.owner_kind, input.owner_id);
        }
        return ok({});
      },
    },
    sweep: {
      route: annotationSweep,
      handle(tx, ctx) {
        if (ctx.actor !== "machine") return forbidden("only the core sweeps");
        const removed = sweep(tx);
        return removed.ok ? ok({ removed: removed.value }) : removed;
      },
    },
  };
}
