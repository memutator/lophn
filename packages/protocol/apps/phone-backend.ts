import { z } from "zod";
import { sha256Schema } from "../base/values.ts";

// 폰에서 도는 앱 backend의 bundle 배치 `phone/backend.json`이다. core가 앱 `main.ts`를 plain JS 한 file로
// 묶어 `phone/backend.js`에 두고, 폰은 이 manifest의 size·sha256으로 받은 file을 확인한다.
export const PHONE_BACKEND_FORMAT = 1;
export const PHONE_BACKEND_MAX_BYTES = 4 * 1024 * 1024;

const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const schemaNumber = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const phoneBackendManifestSchema = z
  .object({
    format: z.literal(PHONE_BACKEND_FORMAT),
    entry: z.literal("backend.js"),
    size: z.number().int().positive().max(PHONE_BACKEND_MAX_BYTES),
    sha256: sha256Schema,
    data_schema: schemaNumber,
    // migration file은 bundle의 `migrations/` 그대로다(backend.js에 넣지 않는다).
    migrations: z.array(
      z
        .object({
          from: schemaNumber,
          to: schemaNumber,
          file: z.string().regex(/^migrations\/\d+-\d+\.sql$/),
          sha256: sha256Schema,
        })
        .strict(),
    ),
    // handler 이름 → effect. 폰은 read·write를 로컬에서 돌리고 external은 컴퓨터로 보낸다.
    operations: z.record(
      z.string().min(1),
      z.enum(["read", "write", "external"]),
    ),
    // 이 backend가 묶은 SDK 판. 폰 host가 그 SDK의 전역 계약을 깐다.
    sdk: z
      .object({
        "@lophn/cap-store": version,
        "@lophn/cap-tool": version,
      })
      .strict(),
  })
  .strict();
export type PhoneBackendManifest = z.infer<typeof phoneBackendManifestSchema>;
