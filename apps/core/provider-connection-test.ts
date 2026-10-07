import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  type CallModel,
  connectionTest,
  connectionTestInputSchema,
  type ModelCallRecord,
} from "../../packages/contracts/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  SecretSendInput,
  SecretUse,
} from "../../packages/contracts/platform/mod.ts";
import {
  billingRouteOf,
  createAuthTransport,
  createFetchTransport,
  createInvokeModelCall,
  loadProvider,
  lookupProviderSecretUse,
  providerSecretDestination,
} from "../../packages/lophn-agent/harness/provider/mod.ts";
import {
  type ConnectionTestPort,
  type InvokeModelCall,
  runConnectionTest,
} from "../../packages/lophn-agent/harness/provider/mod.ts";
import { snapshotCatalogEntry } from "../../packages/lophn-agent/harness/model/mod.ts";
import {
  openConnection,
  type KnownSecretMatch,
  type Writer,
} from "../../packages/platform/ledger/mod.ts";
import {
  createSecretAttach,
  type KeychainAdapter,
  SECRET_SEND,
} from "../../packages/platform/secrets/mod.ts";

// 명시 연결 test(provider#R29, R30)의 HTTP 요청을 core가 답한다. 사람의 요청만 이
// route에 닿는다(route actors가 user). ledger이 아니라 writer queue 앞의 처리기로
// 돈다: secret attach와 fetch가 네트워크를 기다리므로 ledger transaction 안에 있을
// 수 없다(platform/ledger#R4). 설정 조회(read·list)는 이 처리기를 부르지 않으므로
// model call이 나가지 않는다(R29). 실제 전송 시도의 기록·사용량은 machine 자격의
// StartModelCall·FinishModelCall로 남고 사용량 대기 credential은 보내지 않는다(R24, R30).

export const CONNECTION_TEST_PRINCIPAL = "machine:provider-connection-test";

// test 실행이 model call 기록·provider 상태를 쓰는 core 내부 machine 자격이다.
// token이 없어 HTTP로는 이 principal이 될 수 없고 ledger credential 기록으로만
// writer가 현재 자격을 본다. 기동 때 record한다(ticket-claims와 같은 자리다).
export const CONNECTION_TEST_CONTEXT: AuthenticatedContext = {
  principal: CONNECTION_TEST_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      "StartModelCall",
      "FinishModelCall",
      "RecordProviderAvailability",
      "RecordProviderCheck",
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: CONNECTION_TEST_PRINCIPAL,
};

export type ConnectionTestWriterDeps = {
  ledgerPath: string;
  keychain: () => KeychainAdapter;
  known: () => KnownSecretMatch | undefined;
};

// writer queue 앞의 처리기. 이 command만 가로채고 나머지 command와 Writer 동작은
// 그대로다(withReleasePreparation과 같은 모양).
export function withConnectionTest(
  writer: Writer,
  deps: ConnectionTestWriterDeps,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      if (envelope.command !== connectionTest.name) {
        return await writer.command(ctx, envelope);
      }
      const parsed = connectionTestInputSchema.safeParse(envelope.input);
      if (!parsed.success) {
        return err({
          code: "invalid_input",
          message: "연결 test 입력이 올바르지 않다",
        });
      }
      const handled = await runConnectionTest(
        connectionTestDeps(writer, deps),
        parsed.data,
        new AbortController().signal,
      );
      if (!handled.ok) return handled;
      return ok({
        result: { check: handled.value.check },
        replayed: false,
        first_seq: null,
        last_seq: null,
        wake: false,
      });
    },
  };
}

function connectionTestDeps(
  writer: Writer,
  deps: ConnectionTestWriterDeps,
): Parameters<typeof runConnectionTest>[0] {
  const machine = CONNECTION_TEST_CONTEXT;
  return {
    port: connectionTestPort(writer, deps, machine),
    invoke: connectionTestInvoke(deps, machine),
    nowMs: () => Date.now(),
    newCallId: () => crypto.randomUUID(),
    at: (ms) => new Date(ms).toISOString(),
  };
}

function connectionTestPort(
  writer: Writer,
  deps: ConnectionTestWriterDeps,
  machine: AuthenticatedContext,
): ConnectionTestPort {
  const send = async (
    name: string,
    input: unknown,
    compare: Record<string, string>,
    suffix: string,
  ): Promise<Result<unknown>> => {
    const sent = await writer.command(machine, {
      command: name,
      input,
      idempotency_key: `connection-test:${input ?? ""}:${suffix}`,
      compare,
      prepared: [],
    } as never);
    if (!sent.ok) return sent;
    return ok(sent.value);
  };
  return {
    async readProvider(id) {
      const opened = openConnection(deps.ledgerPath);
      if (!opened.ok) return opened;
      try {
        const loaded = loadProvider(opened.value.sql, id);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) {
          return err({ code: "not_found", message: "provider not found" });
        }
        return ok(loaded.value);
      } finally {
        opened.value.close();
      }
    },
    resolveModel(provider, credential, modelName) {
      // 명시 선택(provider·credential·model)을 동봉 catalog로 검증해 CallModel로
      // 만든다(provider#R2, lophn-agent/harness/model). entry가 없는 model은
      // 한계를 모른 채 보내지 않는다.
      const entry = snapshotCatalogEntry(provider.definition.key, modelName);
      if (entry === undefined) {
        return Promise.resolve(err({
          code: "not_found",
          message: "catalog에 없는 model 이름이다",
        }));
      }
      if (
        entry.context_limit === null || entry.input_limit === null ||
        entry.output_limit === null || entry.supports_tools === null
      ) {
        return Promise.resolve(err({
          code: "not_found",
          message: "catalog에 완전한 한계가 없는 model이다",
        }));
      }
      return Promise.resolve(ok({
        provider: provider.id,
        name: modelName,
        protocol: provider.protocol,
        credential_key: credential.key,
        credential_revision: credential.revision,
        options: {},
        requested_reasoning: null,
        applied_reasoning: null,
        limits: {
          context_limit: entry.context_limit,
          input_limit: entry.input_limit,
          output_limit: entry.output_limit,
          supports_tools: entry.supports_tools,
        },
        catalog_basis: { source: entry.source },
        price_basis: entry.price_basis,
        billing_route: billingRouteOf(credential),
      } satisfies CallModel));
    },
    startCall: async (call: ModelCallRecord) => {
      const done = await send(
        "StartModelCall",
        {
          call,
          applied_messages: [],
          state_seq: "1",
          timeout_ms: 30_000,
        },
        { state_seq: "1" },
        "start",
      );
      return done.ok ? ok(undefined) : done;
    },
    finishCall: async (input) => {
      const done = await send(
        "FinishModelCall",
        { ...input, state_seq: "2" },
        { state_seq: "1" },
        "finish",
      );
      return done.ok ? ok(undefined) : done;
    },
    recordAvailability: async (providerId, key, change) => {
      const current = await readRevision(deps.ledgerPath, providerId);
      if (!current.ok) return current;
      const done = await send(
        "RecordProviderAvailability",
        { provider: providerId, key, ...change },
        { revision: current.value },
        "availability",
      );
      return done.ok ? ok(undefined) : done;
    },
    recordCheck: async (providerId, check) => {
      const current = await readRevision(deps.ledgerPath, providerId);
      if (!current.ok) return current;
      const done = await send(
        "RecordProviderCheck",
        { provider: providerId, check },
        { revision: current.value },
        "check",
      );
      return done.ok ? ok(undefined) : done;
    },
  };
}

function readRevision(
  ledgerPath: string,
  providerId: string,
): Promise<Result<string>> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return Promise.resolve(opened);
  try {
    const row = opened.value.sql.get(
      "select revision from providers where id = ?",
      [providerId],
    );
    if (row === undefined) {
      return Promise.resolve(err({
        code: "not_found",
        message: "provider not found",
      }));
    }
    return Promise.resolve(ok(String(row["revision"])));
  } finally {
    opened.value.close();
  }
}

function connectionTestInvoke(
  deps: ConnectionTestWriterDeps,
  machine: AuthenticatedContext,
): InvokeModelCall {
  const attach = createSecretAttach({
    keychain: deps.keychain(),
    references: {
      current(use) {
        const opened = openConnection(deps.ledgerPath);
        if (!opened.ok) return Promise.resolve(opened);
        try {
          return Promise.resolve(
            lookupProviderSecretUse(opened.value.sql, use),
          );
        } finally {
          opened.value.close();
        }
      },
    },
    // provider credential은 apps의 grant가 아니라 provider 참조의 현재 상태로
    // 허용한다(agent-runtime-secret.ts와 같은 판정).
    allowance: (allowed) =>
      allowed.purpose === "provider_credential"
        ? ok(undefined)
        : err({
          code: "forbidden",
          message: "secret 전송을 허용하지 않는다",
        }),
    processes: () => true,
  });
  return (input, signal) => {
    const use: SecretUse = {
      sealed_ref: input.model.credential_key ?? "",
      revision: input.model.credential_revision ?? 0,
      purpose: "provider_credential",
      destination: providerSecretDestination(input.endpoint) ?? {
        kind: "https",
        origin: new URL(input.endpoint).origin,
      },
    };
    const transport = createAuthTransport({
      attach,
      transport: createFetchTransport(),
      context: machine,
      use,
      operation: SECRET_SEND,
      headerName: input.model.protocol === "anthropic-messages"
        ? "x-api-key"
        : "authorization",
      kind: input.model.protocol === "anthropic-messages" ? "api_key" : "bearer",
    });
    return createInvokeModelCall({
      transport,
      nowMs: () => Date.now(),
      at: (ms) => new Date(ms).toISOString(),
    })(input, signal);
  };
}
