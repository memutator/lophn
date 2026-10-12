import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../server/identity.ts";
import { definePort, type PortKey } from "../base/ports.ts";
import { defineWorker } from "../base/route.ts";
import {
  secretAdapterContextSchema,
  type SecretDestination,
  secretNameSchema,
  secretOpaqueRefSchema,
  secretPipeErrors,
  secretPreparationSchema,
  secretPrepare,
  type SecretPurpose,
  secretPurposeSchema,
  secretReferenceSchema,
  secretRevisionSchema,
  secretSend,
  secretStoreRefresh,
  type SecretValue,
} from "./secrets.ts";

const uniqueNames = <T extends { name: string }>(values: T[]) =>
  new Set(values.map((value) => value.name)).size === values.length;

// 보호 export는 사람이 고른 참조만 받는다. 원값·암호는 schema 밖 callback 메모리 인자다.
export const secretExportInputSchema = z.strictObject({
  context: secretAdapterContextSchema,
  secrets: z.array(z.strictObject({
    name: secretNameSchema,
    sealed_ref: secretOpaqueRefSchema,
    purpose: secretPurposeSchema,
    owner: z.string().min(1),
  })).min(1).refine(uniqueNames, { message: "duplicate secret name" }),
});
export type SecretExportInput = z.infer<typeof secretExportInputSchema>;
// 암호문 bytes는 pipe의 byte chunk로 나간다. JSON에는 크기만 있다.
export const secretExportOutputSchema = z.object({
  format: z.literal(1),
  ciphertext_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type SecretExportOutput = z.infer<typeof secretExportOutputSchema>;

// 암호문 bytes는 byte chunk로 들어온다. current는 같은 snapshot의 현재 참조다.
export const secretImportInputSchema = z.strictObject({
  context: secretAdapterContextSchema,
  current: z.array(secretReferenceSchema).refine(uniqueNames, {
    message: "duplicate secret name",
  }),
});
export type SecretImportInput = z.infer<typeof secretImportInputSchema>;
// 새 준비와 기록 때의 CAS. sealed_ref null은 같은 이름이 없던 경우다.
export const secretImportCommitSchema = z.object({
  name: secretNameSchema,
  preparation: secretPreparationSchema,
  compare: z.union([
    z.object({ sealed_ref: z.null(), revision: z.null() }),
    z.object({
      sealed_ref: secretOpaqueRefSchema,
      revision: secretRevisionSchema,
    }),
  ]),
});
export type SecretImportCommit = z.infer<typeof secretImportCommitSchema>;
export const secretImportOutputSchema = z.object({
  commits: z.array(secretImportCommitSchema).refine(uniqueNames, {
    message: "duplicate secret name",
  }),
});
export type SecretImportOutput = z.infer<typeof secretImportOutputSchema>;

export type SecretExportCallback = (
  passphrase: SecretValue,
) => Promise<Result<Uint8Array>>;
export type SecretImportCallback = (
  passphrase: SecretValue,
  ciphertext: Uint8Array,
) => Promise<Result<SecretImportOutput>>;

// 공개 HTTP route가 아니다. supervision worker envelope의 op로만 부른다.
export const SECRET_EXPORT_OP = "secret.export";
export const secretExport = defineWorker({
  resource: "secrets",
  method: "export",
  name: SECRET_EXPORT_OP,
  input: secretExportInputSchema,
  output: secretExportOutputSchema,
  actors: ["machine"],
  errors: secretPipeErrors,
});
export const SECRET_IMPORT_OP = "secret.import";
export const secretImport = defineWorker({
  resource: "secrets",
  method: "import",
  name: SECRET_IMPORT_OP,
  input: secretImportInputSchema,
  output: secretImportOutputSchema,
  actors: ["machine"],
  errors: secretPipeErrors,
});

export const SECRET_PIPE_OPS = [
  secretPrepare,
  secretSend,
  secretStoreRefresh,
  secretExport,
  secretImport,
] as const;

// 앱 사용의 현재 grant 판정. apps가 구현하고 platform secret.send·store-refresh가 부른다.
// 현재 grant·release·process가 이 이름·purpose·목적지를 허용할 때만 ok, 아니면 forbidden이다.
export type SecretAllowanceRequest = {
  context: AuthenticatedContext;
  name: string;
  purpose: SecretPurpose;
  destination: SecretDestination | null;
};
export type SecretAllowanceCheck = (
  request: SecretAllowanceRequest,
) => Result<void>;
export const SecretAllowance: PortKey<SecretAllowanceCheck> = definePort<
  SecretAllowanceCheck
>("SecretAllowance");

// context의 process가 지금 살아 있는 같은 감독 generation인지. 끝났거나 모르면 false다.
export type ProcessLivenessCheck = (context: AuthenticatedContext) => boolean;
export const ProcessLiveness: PortKey<ProcessLivenessCheck> = definePort<
  ProcessLivenessCheck
>("ProcessLiveness");
