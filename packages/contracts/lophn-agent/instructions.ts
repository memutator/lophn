import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import { definePort, idSchema } from "../platform/mod.ts";
import { positiveRevisionSchema } from "./run-values.ts";

export const INSTRUCTION_LAYERS = ["global", "project", "app"] as const;

// LOPHN.md 자리. 경로 규칙은 documents가 갖고, 이 값은 그 등록 참조다.
const locationFields = {
  layer: z.enum(INSTRUCTION_LAYERS),
  place: z.string().min(1),
};

export const instructionLocationSchema = z.strictObject(locationFields);
export const instructionLocationOutputSchema = z.object(locationFields);

export type InstructionLocation = z.infer<typeof instructionLocationSchema>;

// 한 문서가 어느 preset 판의 몇 번째 지침인지. order는 그 판 안 적용 순서다.
const attachmentFields = {
  preset: idSchema("pst"),
  revision: positiveRevisionSchema,
  document: idSchema("doc"),
  order: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
};

export const instructionAttachmentSchema = z.strictObject(attachmentFields);
export const instructionAttachmentOutputSchema = z.object(attachmentFields);

export type InstructionAttachment = z.infer<typeof instructionAttachmentSchema>;

const presetRevisionFields = {
  preset: idSchema("pst"),
  revision: positiveRevisionSchema,
};

export const instructionAttachmentRefSchema = z.strictObject(
  presetRevisionFields,
);
export const instructionAttachmentRefOutputSchema = z.object(
  presetRevisionFields,
);

export type InstructionAttachmentRef = z.infer<
  typeof instructionAttachmentRefSchema
>;

// documents가 document.save·move·set_source의 transaction에서 현재 상태로 판정한다.
// 결과가 비어 있지 않으면 agent·coding_agent·app 쓰기는 forbidden이다.
export interface InstructionAttachmentsLookup {
  attachments(document: string): Result<InstructionAttachmentRef[]>;
}

export const InstructionAttachments = definePort<InstructionAttachmentsLookup>(
  "InstructionAttachments",
);

export const ASSIGNMENT_STATES = ["enabled", "paused", "withdrawn"] as const;

const operatorOutputFields = {
  assignment: idSchema("asg"),
  revision: positiveRevisionSchema,
  state: z.enum(ASSIGNMENT_STATES),
};

export const operatorOutputRefSchema = z.strictObject(operatorOutputFields);
export const operatorOutputRefOutputSchema = z.object(operatorOutputFields);

export type OperatorOutputRef = z.infer<typeof operatorOutputRefSchema>;

// 그 문서를 출력으로 가진 Operator가 없으면 null.
export interface OperatorOutputLookup {
  output(document: string): Result<OperatorOutputRef | null>;
  // 그 assignment가 Operator인지. agent credential의 상한(scope.agent)은 ledger의 현재 자격에
  // 실리지 않으므로 documents가 Operator 자격의 저장 범위를 정할 때 같은 Tx에서 묻는다.
  isOperator(assignment: string): Result<boolean>;
}

export const OperatorOutput = definePort<OperatorOutputLookup>(
  "OperatorOutput",
);
