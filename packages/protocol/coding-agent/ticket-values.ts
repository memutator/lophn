import { z } from "zod";
import { addressSchema } from "../projects/address.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";

// 앱 source 안 상대 위치. 절대 경로·루트 밖 `..`·빈 조각은 거절한다.
export const sourceRelativePathSchema = z.string().min(1).refine(
  (value) =>
    value === "." ||
    (!/^[\\/]|^[A-Za-z]:|\\/.test(value) && !value.includes("\u0000") &&
      !/[\r\n]/.test(value) &&
      value.split("/").every((part) => part !== ".." && part !== "")),
  { message: "path must stay inside source" },
);

export const TICKET_KINDS = ["implementation", "repair"] as const;
export const ticketKindSchema = z.enum(TICKET_KINDS);
export type TicketKind = z.infer<typeof ticketKindSchema>;

export const TICKET_STATES = [
  "open",
  "claimed",
  "reported",
  "confirmed",
  "check_failed",
  "cancelled",
] as const;
export const ticketStateSchema = z.enum(TICKET_STATES);
export type TicketState = z.infer<typeof ticketStateSchema>;

// lead 결정(coding-agent 계획 Q11). 진행 state와 별개다.
export const TICKET_READINESS = ["needs_confirmation", "ready"] as const;
export const ticketReadinessSchema = z.enum(TICKET_READINESS);
export type TicketReadiness = z.infer<typeof ticketReadinessSchema>;

export const ACCEPTANCE_KINDS = [
  "test_command",
  "app_test",
  "reproduction_test",
  "release_active",
  "problems_closed",
  "human_confirmation",
] as const;

const noShell = z.string().min(1).refine(
  (value) => !value.includes("\u0000") && !/[\r\n]/.test(value),
  { message: "shell string" },
);

// executable은 공백 금지. argv 항목은 공백을 그대로 둔다.
const executableSchema = noShell.refine(
  (value) =>
    /\S/.test(value) && !/^[\\/]/.test(value) && !/^[A-Za-z]:/.test(value),
  { message: "executable" },
);

const testCommandFields = {
  kind: z.literal("test_command"),
  executable: executableSchema,
  argv: z.array(
    z.string().refine((value) =>
      !value.includes("\u0000") && !/[\r\n]/.test(value)
    ),
  ),
  cwd: sourceRelativePathSchema,
  timeout_ms: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  expected_exit_code: z.number().int().min(Number.MIN_SAFE_INTEGER).max(
    Number.MAX_SAFE_INTEGER,
  ),
};

const marker = (kind: "app_test" | "release_active" | "problems_closed") =>
  z.strictObject({ kind: z.literal(kind) });

// human_confirmation은 어느 문제의 reproduction을 대신하는지 problem을 갖는다.
export const acceptanceCheckInputSchema = z.discriminatedUnion("kind", [
  z.strictObject(testCommandFields),
  marker("app_test"),
  z.strictObject({
    kind: z.literal("reproduction_test"),
    problem: idSchema("prb"),
    test_hash: sha256Schema,
  }),
  marker("release_active"),
  marker("problems_closed"),
  z.strictObject({
    kind: z.literal("human_confirmation"),
    problem: idSchema("prb"),
  }),
]);
export const acceptanceCheckSchema = z.discriminatedUnion("kind", [
  z.object(testCommandFields),
  z.object({ kind: z.literal("app_test") }),
  z.object({
    kind: z.literal("reproduction_test"),
    problem: idSchema("prb"),
    test_hash: sha256Schema,
  }),
  z.object({ kind: z.literal("release_active") }),
  z.object({ kind: z.literal("problems_closed") }),
  z.object({
    kind: z.literal("human_confirmation"),
    problem: idSchema("prb"),
  }),
]);
export type AcceptanceCheck = z.infer<typeof acceptanceCheckSchema>;

const referenceFields = {
  kind: z.enum(["version", "problem", "ticket", "release"]),
  target: z.string().min(1),
  address: addressSchema.nullable(),
  section: z.string().min(1).nullable(),
};
const referencePrefix = {
  version: "ver",
  problem: "prb",
  ticket: "tkt",
  release: "rel",
} as const;

function referenceKey(value: {
  kind: string;
  target: string;
  address: {
    place: string;
    document: string;
    section: string | null;
    version: number | null;
  } | null;
  section: string | null;
}): string {
  const address = value.address === null ? "" : [
    value.address.place,
    value.address.document,
    value.address.section ?? "",
    String(value.address.version ?? ""),
  ].join("\0");
  return [value.kind, value.target, address, value.section ?? ""].join("\0");
}

export const ticketReferenceListSchema = z.array(
  z.strictObject(referenceFields),
)
  .max(20)
  .refine((values) => {
    const keys = values.map(referenceKey);
    return new Set(keys).size === keys.length &&
      values.every((value) =>
        (value.kind === "version") === (value.address !== null) &&
        (value.section === null || value.kind === "version") &&
        idSchema(referencePrefix[value.kind]).safeParse(value.target).success
      );
  }, { message: "reference target" });

export const ticketReferenceInputSchema = z.strictObject(referenceFields)
  .refine(
    (value) =>
      (value.kind === "version") === (value.address !== null) &&
      (value.section === null || value.kind === "version") &&
      idSchema(referencePrefix[value.kind]).safeParse(value.target).success,
    { message: "reference target" },
  );
export const ticketReferenceSchema = z.object(referenceFields).refine(
  (value) =>
    (value.kind === "version") === (value.address !== null) &&
    (value.section === null || value.kind === "version"),
  { message: "reference target" },
);
export type TicketReference = z.infer<typeof ticketReferenceSchema>;

export const ticketClaimSchema = z.object({
  connection: idSchema("cac"),
  claim_seq: seqSchema,
  expires_at: atSchema,
});
export type TicketClaim = z.infer<typeof ticketClaimSchema>;

// 조건 번호는 0부터의 position이다. hash는 조건 입력의 RFC 8785 sha256.
export const ticketConditionSchema = z.object({
  position: z.number().int().min(0).max(11),
  kind: z.enum(ACCEPTANCE_KINDS),
  input: acceptanceCheckSchema,
  condition_hash: sha256Schema,
}).refine((value) => value.input.kind === value.kind && value.position >= 0, {
  message: "condition kind",
});
export type TicketCondition = z.infer<typeof ticketConditionSchema>;

export const CLAIM_RELEASE_REASONS = [
  "returned",
  "expired",
  "connection_revoked",
] as const;
export const claimReleaseReasonSchema = z.enum(CLAIM_RELEASE_REASONS);

export const CHECK_RESULTS = ["pass", "fail", "inconclusive"] as const;
export const checkResultSchema = z.enum(CHECK_RESULTS);

export const TICKET_LIST_LIMIT = 20;
export const CLAIM_DURATION_MS = 3_600_000;
export const TICKET_NEEDS_LIMIT = 12;

export const ticketIdSchema = idSchema("tkt");
export type TicketId = z.infer<typeof ticketIdSchema>;
