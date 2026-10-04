import type {
  LedgerTestRegistration,
  LedgerTestRegistrationModule,
} from "../../../apps/core/testing/ledger-types.ts";
import {
  createNotificationCommand,
  markNotificationReadCommand,
} from "./commands.ts";
import { NOTIFICATIONS_SCHEMA_STEPS } from "./schema.ts";

export const createLedgerTestRegistration:
  LedgerTestRegistrationModule["createLedgerTestRegistration"] = () =>
    ({
      schemaSteps: [...NOTIFICATIONS_SCHEMA_STEPS],
      commands: [createNotificationCommand, markNotificationReadCommand],
    }) as unknown as LedgerTestRegistration;
