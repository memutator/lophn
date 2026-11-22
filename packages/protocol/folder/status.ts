// 읽기 명령 `machine.environment`의 출력. 읽는 쪽은 모르는 칸을 무시한다.
// `sections`는 뒤 계획이 명령의 code를 고치지 않고 이름 붙은 칸을 채우는 자리다(top, 기계마다, 앱마다).
import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { followStateSchema, updateStateSchema } from "../apps/update-state.ts";
import { addressesSchema, alwaysOnSchema, commitSchema } from "./records.ts";

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
      // 이름이 겹친 기계는 `이름 (id 끝 6자)`. id 앞쪽은 만든 시각(ULID)이라 같은 때 만든 두 기계가 겹친다.
      display_name: z.string(),
      always_on: alwaysOnSchema.nullable(),
      addresses: addressesSchema,
      lophn_version: z.string().nullable(),
      record_at: atSchema.nullable(),
      // 폴더 꼴 판 범위(`apps/update_state`의 기계 칸과 같다). 이 기계는 늘 ok.
      exchange: z.enum(["ok", "update_this", "update_peer"]),
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
      // 선언의 `sync`가 table을 보내는 destination마다: 그리 가는 표(null이면 모든 표, 옛 release), 그 이름이 이 기계에
      // 있는지, 그 stream의 내보내기와 출처 기계마다의 읽기. 보내지 않는 앱은 비었다.
      destinations: z.array(
        z.object({
          name: z.string(),
          tables: z.array(z.string()).nullable(),
          state: z.enum(["set", "not_set_here"]),
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
              // 그 기계의 snapshot을 합쳤지만 다른 곳에서 지워진 row를 아직 지우지 않았다: 그 기계가 이 기계의 변경을 다
              // 받으면 그 기계의 다음 snapshot으로 한 번 더 합치며 지운다.
              owes_absent_pass: z.boolean(),
              error: folderErrorSchema.nullable(),
            }),
          ),
        }),
      ),
      release: commitSchema.nullable(),
      // `apps/update_state`와 같은 값. 폴더로 맞추지 않는 앱은 follow가 null이고 held·machines가 비었다.
      follow: followStateSchema.nullable(),
      held: updateStateSchema.shape.held,
      machines: updateStateSchema.shape.machines,
      // horizon 밖에 있거나 풀리지 않은 held 줄이 있다: 떨어진 때(떨어져 있지 않으면 null), held 수, held 변경의 표·종류·때.
      away: z
        .object({
          since: atSchema.nullable(),
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
          code_commit: commitSchema,
          data_schema: count,
          created_at: atSchema,
        })
        .nullable(),
    }),
  ),
  sections: sectionsSchema,
});
export type MachineEnvironment = z.infer<typeof machineEnvironmentSchema>;
