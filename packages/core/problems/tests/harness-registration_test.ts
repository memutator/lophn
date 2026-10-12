import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type BlobRefRegistration,
  type CommandDefinition,
  defineCommand,
  type PermanentBlobReference,
  type PortKey,
  type RequestContext,
  type Tx,
} from "../../../protocol/platform/mod.ts";
import {
  appendActualSideStart,
  appendRequestObservation,
  type ObservationInput,
  type SideStartInput,
} from "./commands.ts";
import { requestTestCommand } from "./commands.ts";
import { recordVerificationCommand } from "./record.ts";
import {
  getTestRequestRead,
  getVerificationRead,
  listVerificationsRead,
} from "./reads.ts";
import { testAdmissionPort, testEvidencePort } from "./ports.ts";
import { TEST_SCHEMA_STEPS } from "./schema.ts";
import type { LifecycleProof } from "./proof.ts";
import type { PreparedAdmission, PreparedResultEvidence } from "./model.ts";
type LedgerTestEnvironment = {
  currentCredential(credentialRef: string): unknown;
};
type LedgerTestRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly CommandDefinition[];
  testCommands?: readonly CommandDefinition[];
  reads?: readonly unknown[];
  ports?: readonly {
    readonly key: { readonly name: string };
    readonly create: (tx: Tx) => unknown;
  }[];
  registerBlobRef?: (
    tx: Tx,
    ctx: RequestContext,
    reference: BlobRefRegistration,
  ) => Result<PermanentBlobReference>;
};

function defineTxPort<T>(
  key: PortKey<T>,
  create: (tx: Tx) => T,
) {
  return { key, create };
}

// 켜져 있으면 frozen_code callback이 err를 돌려 writer rollback을 보게 한다.
export const FAILING_BLOB_FIELD = "frozen_code";

// port가 돌려주는 준비 값. Worker module 상태에만 있고 Deno.test는 없다.
let admissionValue: PreparedAdmission | null = null;
let evidenceValue: PreparedResultEvidence | null = null;
let failBlobField: string | null = null;

const jsonText = z.string();
const setAdmission = defineCommand({
  resource: "problems",
  method: "set-test-admission",
  name: "problems.tests.set-admission",
  input: z.object({ prepared: jsonText.nullable() }),
  output: z.object({ ready: z.boolean() }),
  actors: ["user", "machine", "coding_agent"],
  errors: [],
});
const setEvidence = defineCommand({
  resource: "problems",
  method: "set-test-evidence",
  name: "problems.tests.set-evidence",
  input: z.object({ prepared: jsonText.nullable() }),
  output: z.object({ ready: z.boolean() }),
  actors: ["machine"],
  errors: [],
});
const observeRequest = defineCommand({
  resource: "problems",
  method: "observe-test-request",
  name: "problems.tests.observe-request",
  input: z.object({
    observation: z.unknown(),
    proof: z.unknown(),
  }),
  output: z.object({ seq: z.string() }),
  actors: ["machine"],
  errors: ["forbidden", "conflict", "not_found", "invalid_input"],
});
const startSide = defineCommand({
  resource: "problems",
  method: "start-test-side",
  name: "problems.tests.start-side",
  input: z.object({
    start: z.unknown(),
    proof: z.unknown(),
  }),
  output: z.object({ seq: z.string() }),
  actors: ["machine"],
  errors: ["forbidden", "conflict", "not_found", "invalid_input"],
});
const setBlobFailure = defineCommand({
  resource: "problems",
  method: "set-test-blob-failure",
  name: "problems.tests.set-blob-failure",
  input: z.object({ field: z.string().nullable() }),
  output: z.object({ ready: z.boolean() }),
  actors: ["machine"],
  errors: [],
});
// tx마다 새 구현이고 같은 tx 안에서는 같은 identity다.
const checkPorts = defineCommand({
  resource: "problems",
  method: "check-test-ports",
  name: "problems.tests.check-ports",
  input: z.object({}),
  output: z.object({ admission: z.number(), evidence: z.number() }),
  actors: ["machine"],
  errors: [],
});

let admissionSerial = 0;
let evidenceSerial = 0;
let previousAdmission: unknown;
let previousEvidence: unknown;

export function createLedgerTestRegistration(
  _environment: LedgerTestEnvironment,
): LedgerTestRegistration {
  const testCommands: CommandDefinition[] = [
    {
      route: setAdmission,
      handle(_tx, _ctx, raw) {
        const parsed = setAdmission.input.parse(raw);
        admissionValue = parsed.prepared === null
          ? null
          : JSON.parse(parsed.prepared) as PreparedAdmission;
        return ok({ ready: admissionValue !== null });
      },
    },
    {
      route: setEvidence,
      handle(_tx, _ctx, raw) {
        const parsed = setEvidence.input.parse(raw);
        evidenceValue = parsed.prepared === null
          ? null
          : JSON.parse(parsed.prepared) as PreparedResultEvidence;
        return ok({ ready: evidenceValue !== null });
      },
    },
    {
      route: observeRequest,
      handle(tx, ctx, raw) {
        const parsed = observeRequest.input.parse(raw) as {
          observation: ObservationInput;
          proof: LifecycleProof | null;
        };
        const stored = appendRequestObservation(
          tx,
          ctx,
          parsed.observation,
          parsed.proof,
        );
        return stored.ok ? ok({ seq: stored.value.toString() }) : stored;
      },
    },
    {
      route: startSide,
      handle(tx, ctx, raw) {
        const parsed = startSide.input.parse(raw) as {
          start: SideStartInput;
          proof: LifecycleProof | null;
        };
        const stored = appendActualSideStart(
          tx,
          ctx,
          parsed.start,
          parsed.proof,
        );
        return stored.ok ? ok({ seq: stored.value.toString() }) : stored;
      },
    },
    {
      route: setBlobFailure,
      handle(_tx, _ctx, raw) {
        const parsed = setBlobFailure.input.parse(raw);
        failBlobField = parsed.field;
        return ok({ ready: failBlobField !== null });
      },
    },
    {
      route: checkPorts,
      handle(tx) {
        const admission = tx.port(testAdmissionPort);
        const evidence = tx.port(testEvidencePort);
        if (
          admission !== tx.port(testAdmissionPort) ||
          evidence !== tx.port(testEvidencePort) ||
          admission === previousAdmission ||
          evidence === previousEvidence
        ) throw new Error("port identity differs");
        previousAdmission = admission;
        previousEvidence = evidence;
        return ok({
          admission: (admission as unknown as { serial: number }).serial,
          evidence: (evidence as unknown as { serial: number }).serial,
        });
      },
    },
  ];
  return {
    schemaSteps: [
      ...TEST_SCHEMA_STEPS,
      {
        id: "test-blob-refs",
        sql: `create table test_blob_refs (
          owner_kind text not null,
          owner_key text not null,
          field text not null,
          hash text not null,
          registered_seq integer not null,
          primary key (owner_kind, owner_key, field)
        );`,
      },
    ],
    commands: [requestTestCommand, recordVerificationCommand],
    testCommands,
    reads: [getTestRequestRead, getVerificationRead, listVerificationsRead],
    ports: [
      defineTxPort(testAdmissionPort, () => {
        const serial = ++admissionSerial;
        const implementation = (
          _ctx: RequestContext,
          _input: unknown,
        ): PreparedAdmission | null => admissionValue;
        return Object.assign(implementation, { serial });
      }),
      defineTxPort(testEvidencePort, () => {
        const serial = ++evidenceSerial;
        const implementation = (
          _input: unknown,
        ): PreparedResultEvidence | null => evidenceValue;
        return Object.assign(implementation, { serial });
      }),
    ],
    registerBlobRef(tx, _ctx, reference) {
      if (reference.source.kind !== "prepared") {
        return err({ code: "forbidden", message: "prepared blob만 등록한다" });
      }
      if (failBlobField !== null && reference.field === failBlobField) {
        return err({ code: "unavailable", message: "테스트 blob 등록 실패" });
      }
      tx.sql.run(
        `insert into test_blob_refs (
           owner_kind, owner_key, field, hash, registered_seq
         ) values (?, ?, ?, ?, ?)`,
        [
          reference.owner_kind,
          reference.owner_key,
          reference.field,
          reference.source.blob.hash,
          BigInt(reference.registered_seq),
        ],
      );
      return ok({
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
        field: reference.field,
        hash: reference.source.blob.hash,
        registered_seq: reference.registered_seq,
      });
    },
  };
}
