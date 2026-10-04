import { z } from "zod";
import { ok, type Result } from "../../base/mod.ts";
import { appRegistrationLookup } from "../../contracts/apps/mod.ts";
import {
  connectionRevokeInputSchema,
  connectionRevokeOutputSchema,
} from "../../contracts/coding-agent/mod.ts";
import {
  confirmationRefSchema,
  defineCommand,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  connectionAuthFromTx,
  connectionAuthPort,
  connectionSchemaSteps,
  createConnectionCommands,
  createConnectionReads,
  lookupConnectionAuth,
  revokeConnection,
} from "./mod.ts";

type LedgerEnvironment = {
  currentCredential(credentialRef: string): Result<RequestContext>;
};

// 테스트 전용 registration이다. 앱 존재는 apps가 제공할 lookup을 fake Map으로 대신한다.
// harness Worker가 이 module을 읽는다. Deno.test는 없다.
const apps = new Map<string, { id: string; status: string }>();

const setApps = defineCommand({
  resource: "coding_agent_connections",
  method: "set_apps",
  name: "coding_agent_connections.set_apps",
  input: z.strictObject({
    apps: z.array(z.strictObject({
      id: z.string(),
      status: z.string(),
    })),
  }),
  output: z.strictObject({ ready: z.boolean() }),
  actors: ["user"],
  errors: [],
});

// ledger executor는 confirmation route를 unavailable로 막는다.
// harness는 확인 창 근거를 이 command로 넘겨 같은 revoke를 실행한다.
const revokeWithEvidence = defineCommand({
  resource: "coding_agent_connections",
  method: "revoke_with_evidence",
  name: "coding_agent_connections.revoke_with_evidence",
  input: connectionRevokeInputSchema.extend({
    confirmation: confirmationRefSchema,
  }),
  output: connectionRevokeOutputSchema,
  compare: z.strictObject({
    base_revision: connectionRevokeInputSchema.shape.base_revision,
  }),
  actors: ["user", "coding_agent"],
  errors: ["not_found", "forbidden", "conflict", "invalid_input"],
});

const readAuth = defineCommand({
  resource: "coding_agent_connections",
  method: "read_auth",
  name: "coding_agent_connections.read_auth",
  input: z.strictObject({ principal: z.string().min(1) }),
  output: z.strictObject({
    found: z.boolean(),
    state: z.enum(["active", "revoked"]).nullable(),
    token_digest: z.string().nullable(),
  }),
  actors: ["user"],
  errors: [],
});

function createRegistration() {
  const commands = createConnectionCommands();
  const reads = createConnectionReads();
  return {
    schemaSteps: connectionSchemaSteps,
    commands: [commands.create, commands.revoke],
    testCommands: [
      {
        route: setApps,
        handle(
          _tx: Tx,
          _ctx: RequestContext,
          input: { apps: { id: string; status: string }[] },
        ) {
          apps.clear();
          for (const app of input.apps) apps.set(app.id, app);
          return ok({ ready: true });
        },
      },
      {
        route: revokeWithEvidence,
        handle(
          tx: Tx,
          ctx: RequestContext,
          input: {
            connection: string;
            base_revision: string;
            confirmation: string;
          },
          compare: { base_revision: string },
        ) {
          return revokeConnection(
            tx,
            ctx,
            input,
            compare,
            input.confirmation,
          );
        },
      },
      {
        route: readAuth,
        handle(tx: Tx, _ctx: RequestContext, input: { principal: string }) {
          const auth = lookupConnectionAuth(tx.sql, input.principal);
          return ok({
            found: auth !== undefined,
            state: auth?.state ?? null,
            token_digest: auth?.token_digest ?? null,
          });
        },
      },
    ],
    reads: [reads.list, reads.show],
    ports: [{
      key: appRegistrationLookup,
      create: () => ({
        get(app: string) {
          const found = apps.get(app);
          return ok(
            found
              ? {
                id: found.id,
                slug: "notes",
                status: found.status === "archived" ? "archived" : "active",
              }
              : null,
          );
        },
      }),
    }, {
      key: connectionAuthPort,
      create: connectionAuthFromTx,
    }],
  };
}

export function createLedgerTestRegistration(
  _environment: LedgerEnvironment,
) {
  return createRegistration();
}
