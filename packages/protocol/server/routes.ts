import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { idempotencyKeySchema, withReadCommon } from "../base/envelope.ts";
import {
  credentialConditionsSchema,
  credentialScopeSchema,
} from "./identity.ts";
import { ACTOR_KINDS, defineRead } from "../base/route.ts";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";

const healthObservationSchema = z
  .object({
    component: z.string().min(1),
    available: z.boolean(),
    reason: z.string().min(1).optional(),
    observed_at: atSchema,
  })
  .refine((value) => value.available || value.reason !== undefined, {
    message: "unavailable observation needs a safe reason",
  });
export type HealthObservation = z.infer<typeof healthObservationSchema>;

export const commandResultSchema = z
  .object({
    principal: z.string().min(1),
    idempotency_key: idempotencyKeySchema,
    fingerprint: sha256Schema,
    result: z.record(z.string(), z.json()),
    first_seq: seqSchema.nullable(),
    last_seq: seqSchema.nullable(),
    at: atSchema,
  })
  .refine(
    (value) =>
      (value.first_seq === null) === (value.last_seq === null) &&
      (value.first_seq === null ||
        value.last_seq === null ||
        BigInt(value.last_seq) >= BigInt(value.first_seq)),
    {
      message: "invalid result seq range",
    },
  );

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "unavailable",
  "internal",
] as const;

export const platformStatus = defineRead({
  resource: "platform",
  method: "status",
  name: "PlatformStatus",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      ready: z.boolean(),
      schema: z.number().int().nonnegative(),
      data_root: z.string().min(1),
      ledger_id: z.string().min(1),
      components: z.array(healthObservationSchema),
    }),
  ),
  actors: ACTOR_KINDS,
  errors,
});
export const platformHealth = defineRead({
  resource: "platform",
  method: "health",
  name: "PlatformHealth",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      observations: z.array(healthObservationSchema),
      observed_at: atSchema,
    }),
  ),
  actors: ACTOR_KINDS,
  errors,
});
export const identityCurrent = defineRead({
  resource: "identity",
  method: "current",
  name: "IdentityCurrent",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      actor: actorSchema,
      scope: z.object(credentialScopeSchema.shape),
      conditions: z.object(credentialConditionsSchema.shape),
    }),
  ),
  actors: ACTOR_KINDS,
  errors,
});
export const commandsResult = defineRead({
  resource: "commands",
  method: "result",
  name: "CommandResult",
  // principal은 caller context에서 정한다. 부재는 미실행 증거가 아니다.
  input: z.strictObject({ idempotency_key: idempotencyKeySchema }),
  output: withReadCommon(z.object({ result: commandResultSchema.nullable() })),
  actors: ACTOR_KINDS,
  errors,
});
