// 다른 컴퓨터로 file을 보내고(offline이면 hub가 맡았다가 켜지면 나른다) 받은 file을 확인·정리하는 계약이다.
import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { atSchema, sha256Schema } from "../base/values.ts";

export const TRANSFER_MAX_FILES = 64;
export const TRANSFER_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const TRANSFER_NOTE_MAX_CHARS = 4000;
export const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const transferFileEntrySchema = z.strictObject({
  name: z.string().min(1).max(255),
  rel_path: z.string().min(1).max(512),
  size: z.number().int().min(0).max(TRANSFER_MAX_FILE_BYTES),
  sha256: sha256Schema,
  executable_stripped: z.boolean().optional(),
});
export type TransferFileEntry = z.infer<typeof transferFileEntrySchema>;

export const transferDeliveryStateSchema = z.enum([
  "queued",
  "held_at_hub",
  "delivered",
  "expired",
  "failed",
]);
export type TransferDeliveryState = z.infer<typeof transferDeliveryStateSchema>;

export const transferRecordSchema = z.strictObject({
  id: idSchema("trf"),
  from_machine: idSchema("mch"),
  from_name: z.string().min(1).max(128),
  to_machine: idSchema("mch"),
  to_name: z.string().min(1).max(128),
  direction: z.enum(["outgoing", "incoming"]),
  note: z.string().nullable(),
  files: z.array(transferFileEntrySchema),
  state: transferDeliveryStateSchema,
  held_by: z.array(idSchema("mch")).optional(),
  inbox_dir: z.string().nullable(),
  created_at: atSchema,
  updated_at: atSchema,
  expires_at: atSchema,
});
export type TransferRecord = z.infer<typeof transferRecordSchema>;

export const transfersSend = defineMemory({
  resource: "transfers",
  method: "send",
  name: "transfers.send",
  input: z.strictObject({
    to: z.string().min(1).max(128),
    paths: z.array(z.string().min(1)).min(1).max(TRANSFER_MAX_FILES),
    note: z.string().max(TRANSFER_NOTE_MAX_CHARS).optional(),
    allow_outside_workspace: z.boolean().optional(),
  }),
  output: z.strictObject({
    transfer: idSchema("trf"),
    to_machine: idSchema("mch"),
    to_name: z.string(),
    state: transferDeliveryStateSchema,
    held_by: z.array(idSchema("mch")).optional(),
    files: z.array(transferFileEntrySchema),
    created_at: atSchema,
    expires_at: atSchema,
  }),
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "conflict",
    "unavailable",
  ],
});

export const transfersList = defineMemory({
  resource: "transfers",
  method: "list",
  name: "transfers.list",
  input: z.strictObject({
    direction: z.enum(["incoming", "outgoing", "all"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  output: z.strictObject({
    transfers: z.array(transferRecordSchema),
  }),
  actors: ["user", "agent"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

export const transfersStatus = defineMemory({
  resource: "transfers",
  method: "status",
  name: "transfers.status",
  input: z.strictObject({
    transfer: idSchema("trf"),
  }),
  output: z.strictObject({
    transfer: transferRecordSchema,
  }),
  actors: ["user", "agent"],
  errors: ["invalid_input", "not_found", "forbidden", "unavailable"],
});

export const transfersClear = defineMemory({
  resource: "transfers",
  method: "clear",
  name: "transfers.clear",
  input: z.strictObject({
    transfer: idSchema("trf"),
    delete_inbox_files: z.boolean().optional(),
  }),
  output: z.strictObject({
    cleared: z.boolean(),
  }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "forbidden", "unavailable"],
});

export const TRANSFER_ROUTES = [
  transfersSend,
  transfersList,
  transfersStatus,
  transfersClear,
] as const;
