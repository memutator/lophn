// 읽기 명령 `machine.environment`의 출력. 읽는 쪽은 모르는 칸을 무시한다.
// `sections`는 뒤 계획이 명령의 code를 고치지 않고 이름 붙은 칸을 채우는 자리다(top, 기계마다, 앱마다).
import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import { addressesSchema, alwaysOnSchema } from "./records.ts";

export const FOLDER_ERROR_CODES = [
  "destination_missing",
  "not_writable",
  "foreign_writer",
  "invalid_file",
  "newer_format",
  "too_large",
  "clock_ahead",
  "apply_failed",
  "app_not_running",
  "release_incomplete",
  "away_too_long",
  // 앱 source의 git bundle을 만들거나 받지 못했다(git이 없거나 실패). data 내보내기와 읽기는 막지 않는다.
  "source_failed",
] as const;
export type FolderErrorCode = (typeof FOLDER_ERROR_CODES)[number];

// `clock_ahead`의 details. message는 "The clock of <name> is <n> minutes ahead"다.
export const clockAheadDetailsSchema = z.object({
  machine: idSchema("mch"),
  machine_name: z.string(),
  ahead_ms: z.number().int().nonnegative(),
});

export const folderErrorSchema = z.object({
  code: z.enum(FOLDER_ERROR_CODES),
  message: z.string(),
  at: atSchema,
  details: z.record(z.string(), z.unknown()).optional(),
});
export type FolderError = z.infer<typeof folderErrorSchema>;

export const sectionsSchema = z.record(z.string(), z.unknown());

export const destinationStateSchema = z.enum(["ok", "missing", "not_writable"]);
export type DestinationState = z.infer<typeof destinationStateSchema>;

const count = z.number().int().nonnegative();

export const machineEnvironmentSchema = z.object({
  this_machine: z.object({ id: idSchema("mch"), name: z.string() }),
  machines: z.array(
    z.object({
      id: idSchema("mch"),
      name: z.string(),
      // 이름이 겹친 기계는 `이름 (id 앞 6자)`.
      display_name: z.string(),
      always_on: alwaysOnSchema.nullable(),
      addresses: addressesSchema,
      lophn_version: z.string().nullable(),
      record_at: atSchema.nullable(),
      destinations: z.array(z.string()),
      sections: sectionsSchema,
    }),
  ),
  destinations: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      state: destinationStateSchema,
      machines: count,
    }),
  ),
  apps: z.array(
    z.object({
      app: idSchema("app"),
      name: z.string(),
      sync_to: z.string().nullable(),
      destination: z.enum(["set", "not_set_here"]).nullable(),
      release: sha256Schema.nullable(),
      export: z
        .object({
          exported_at: atSchema.nullable(),
          head: count,
          pending: count,
          error: folderErrorSchema.nullable(),
        })
        .nullable(),
      imports: z.array(
        z.object({
          machine: idSchema("mch"),
          imported_at: atSchema.nullable(),
          cursor: count,
          waiting_for: count.nullable(),
          held: count,
          error: folderErrorSchema.nullable(),
        }),
      ),
      // horizon 밖에 있다(`away_too_long`): 언제부터, held 수, held 변경의 표·종류·때.
      away: z
        .object({
          since: atSchema,
          held: count,
          changes: z.array(
            z.object({ table: z.string(), op: z.string(), at: atSchema }),
          ),
        })
        .nullable(),
      sections: sectionsSchema,
    }),
  ),
  // 다른 기계가 내놓았고 이 기계에 아직 없는 앱.
  available: z.array(
    z.object({
      app: idSchema("app"),
      name: z.string(),
      slug: z.string(),
      machine: idSchema("mch"),
      release: z
        .object({
          bundle_hash: sha256Schema,
          data_schema: count,
          created_at: atSchema,
        })
        .nullable(),
    }),
  ),
  sections: sectionsSchema,
});
export type MachineEnvironment = z.infer<typeof machineEnvironmentSchema>;
