import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { atSchema, seqSchema, sha256Schema } from "./values.ts";

// backup 복원의 main↔core 비공개 통로(platform/backup-and-migration#R13). 사람 결정 handle과
// 같은 pipe를 쓴다. main이 고른 묶음(`created_at`)의 계획을 읽고, 사람이 잃을 범위를 확인한
// handle(결정 `restore_backup`)로 복원을 청한다. 응답에는 짝 id가 없어 한 번에 하나씩 보낸다.

// main → core. 계획만 읽는다. core는 아무것도 멈추지 않는다.
export const restorePlanRequestSchema = z.strictObject({
  type: z.literal("restore_plan_request"),
  created_at: atSchema,
});

// core → main. `lost`는 복원하면 잃는 기록(묶음 끝 다음부터 현재 끝까지)이고 없으면 null이다.
// `target`·`content_hash`는 이 계획을 사람 확인에 묶는 기준으로, main이 handle을 발급할 때
// `target_ref`·`content_hash`에 그대로 쓴다(결정 이름은 `restore_backup`).
export const restorePlanSchema = z.strictObject({
  type: z.literal("restore_plan"),
  created_at: atSchema,
  through_seq: seqSchema,
  current_through_seq: seqSchema,
  lost: z.strictObject({
    from_seq: seqSchema,
    through_seq: seqSchema,
    events: z.number().int().positive(),
  }).nullable(),
  target: z.string().min(1),
  content_hash: sha256Schema,
});

// main → core. handle이 맞으면 core는 모든 worker·writer를 멈추고 복원한 뒤 같은 pipe로 새
// hello를 보내며 다시 시작한다. 맞지 않으면 아무것도 멈추지 않고 `restore_failed`만 답한다.
export const restoreRequestSchema = z.strictObject({
  type: z.literal("restore_request"),
  created_at: atSchema,
  confirmation: z.string().min(1),
});

// core → main. 복원을 마쳤다. 이 메시지 다음에 새 core의 hello가 온다.
export const restoreResultSchema = z.strictObject({
  type: z.literal("restore_result"),
  created_at: atSchema,
  restored_through_seq: seqSchema,
  previous_through_seq: seqSchema.nullable(),
});

// core → main. 계획을 읽지 못했거나 복원하지 못했다. `restarted`가 false이면 core는 그대로
// 서비스 중이다. 정지한 뒤 검증·교체가 실패하면 현재 자료는 그대로이고 core는 그 자료로 다시
// 시작한다(`restarted: true`, 새 hello가 따른다).
export const restoreFailedSchema = z.strictObject({
  type: z.literal("restore_failed"),
  stage: z.enum(["plan", "restore"]),
  created_at: atSchema,
  code: z.enum(ERROR_CODES),
  message: z.string(),
  restarted: z.boolean(),
});

export type RestorePlanRequest = z.infer<typeof restorePlanRequestSchema>;
export type RestorePlanMessage = z.infer<typeof restorePlanSchema>;
export type RestorePipeRequest = z.infer<typeof restoreRequestSchema>;
export type RestoreResult = z.infer<typeof restoreResultSchema>;
export type RestoreFailed = z.infer<typeof restoreFailedSchema>;
