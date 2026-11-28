import { z } from "zod";
import { atSchema } from "../../base/values.ts";
import { withReadCommon } from "../../base/envelope.ts";
import { defineCommand, defineRead } from "../../base/route.ts";
import { appIdSchema, releaseIdSchema } from "../channel-values.ts";
import { activationComparisonSchema } from "./activation.ts";

// activation 동의. 새 release가 선언을 넓히면 사람이 허락해야 activation이 이어진다.
// 동의 대기는 ledger 표에 남아 재시작을 넘는다. 같은 release는 한 줄이고, 더 새 release의 activation이
// 시작되면 이전 대기는 cancelled로 닫힌다.
// approvals protocol을 import하지 않는다(approvals가 이미 apps를 import해 거꾸로 두면 protocol-cycle이다).
// 남지 않는 event(`packages/protocol/events/transient.ts`): ActivationConsentRequested { app, app_name, release },
//   ActivationConsentClosed { app, release, outcome: "allow" | "reject" | "cancelled" }.
// activation 줄의 phase는 `waiting_consent`다.
export const activationConsentSchema = z.object({
  app: appIdSchema,
  // 사람에게 보일 이름. 알림과 대기 목록이 id 대신 쓴다.
  app_name: z.string().min(1),
  release: releaseIdSchema,
  comparison: activationComparisonSchema,
  requested_at: atSchema,
});
export type ActivationConsent = z.infer<typeof activationConsentSchema>;

const CHOICES = ["allow", "reject"] as const;
const choiceSchema = z.enum(CHOICES);

const consentErrors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

// compare의 requested_at은 사람이 본 동의 대기의 값이다. 지금 대기의 값과 다르거나 대기가 없으면
// conflict다(그 사이 다시 물었거나 더 새 release가 이전 대기를 닫았다). 거절은 이유를 싣지 않는다.
export const activationConsent = defineCommand({
  resource: "activations",
  method: "consent",
  name: "activation.consent",
  changes: [
    { name: "activation_consents", id: (input) => input.release },
    "releases",
  ],
  input: z.strictObject({
    release: releaseIdSchema,
    choice: choiceSchema,
  }),
  compare: z.strictObject({ requested_at: atSchema }),
  output: z.object({ release: releaseIdSchema, outcome: choiceSchema }),
  actors: ["user"],
  errors: [...consentErrors],
});

// 같은 release는 한 줄이다.
export const activationAskConsent = defineCommand({
  resource: "activations",
  method: "ask_consent",
  name: "activation.ask_consent",
  changes: [{ name: "activation_consents", id: (input) => input.release }],
  input: z.strictObject({
    release: releaseIdSchema,
    comparison: activationComparisonSchema,
  }),
  output: z.object({ created: z.boolean() }),
  actors: ["machine"],
  errors: [...consentErrors],
});

export const activationConsents = defineRead({
  resource: "activations",
  method: "consents",
  name: "activations.consents",
  input: z.strictObject({ app: appIdSchema.optional() }),
  output: withReadCommon(
    z.object({
      consents: z.array(activationConsentSchema),
    }),
  ),
  reads: ["activation_consents"],
  actors: ["user", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
