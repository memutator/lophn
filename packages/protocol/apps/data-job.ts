import { z } from "zod";
import { dataChangeSchema, dataResultSchema } from "./releases.ts";

export const DATA_JOB_KINDS = [
  "inspect",
  "backup",
  "migrate",
  "restore",
  "test",
] as const;
export const dataJobKindSchema = z.enum(DATA_JOB_KINDS);

const dataJobFields = {
  kind: dataJobKindSchema,
  app: z.string().regex(/^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/),
  release: z.string().regex(/^rel_[0-7][0-9a-hjkmnp-tv-z]{25}$/),
  activation_seq: z.string().refine((value) => value !== "0", {
    message: "activation_seq must be positive",
  }),
  data_path: z.string().min(1),
  // migration은 DataChange의 script_hash를 bundle에서 찾는다.
  bundle_path: z.string().min(1).optional(),
  // backup·restore는 보호 blob 참조다. 일반 문서 읽기 경로로 내보내지 않는다.
  backup_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  data_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  // migrate만 쓴다. release의 data_changes이고 각 단계의 script는 bundle 안 `migrations/<from>-<to>.sql`이며
  // 그 byte의 sha256이 script_hash와 같아야 한다.
  data_changes: z.array(dataChangeSchema).optional(),
  // migrate 결과에 실리는 원래 migration 관측이다.
  invocation: z.string().regex(/^inv_[0-7][0-9a-hjkmnp-tv-z]{25}$/).optional(),
};

// stdin JSON 한 줄. token과 secret은 argv·환경에 없다.
export const dataJobInputSchema = z.strictObject(dataJobFields);
export type DataJobInput = z.infer<typeof dataJobInputSchema>;

// 결과는 DataResult다. problems test runner도 같은 결과를 낸다.
// migration 결과에는 invocation이 필수고 성공 제출은 integrity_ok true다.
export const dataJobOutputSchema = z.strictObject({
  result: dataResultSchema,
  // backup 작업이 만든 DB 파일 byte의 sha256이다. 이 byte가 보호 blob이 되고 restore는 같은 hash의 파일만
  // 복원한다.
  backup_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).refine(
  (value) => value.result.integrity_ok,
  { message: "successful data job result must have integrity_ok true" },
);
export type DataJobOutput = z.infer<typeof dataJobOutputSchema>;
