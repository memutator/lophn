// 시작은 ready=false·accepting=false. 앱 code load 뒤에 등록 handler로 attestation을 만든다.
import type { Clock, IdSource } from "@lophn/base";
import type { Blueprint } from "../../blueprint/mod.ts";
import { type AppStart, parseAppStart } from "./start-input.ts";
import { type BrokerTransport, createBrokerClient } from "./broker-client.ts";
import { createRuntimeState, type RuntimeState } from "./state.ts";
import { commandsMatchBlueprint } from "./control.ts";
import { decodeVerifyKey, type VerifyKey } from "./signature.ts";
import type { RuntimeMode } from "./wire.ts";

export type Started = {
  start: Omit<AppStart, "mode"> & { mode: RuntimeMode };
  state: RuntimeState;
};

export async function readStartLine(
  read: () => Promise<string | null>,
): Promise<string> {
  const line = await read();
  if (!line) throw new Error("app start input missing");
  return line;
}

export function startRuntime(deps: {
  line: string;
  blueprint: Blueprint;
  key?: VerifyKey;
  clock: Clock;
  ids: IdSource;
  broker: BrokerTransport;
  dataSchema: number;
  screenBytes?: RuntimeState["screenBytes"];
}): Started {
  const parsed = parseAppStart(deps.line);
  if (!parsed) throw new Error("app start input is invalid");
  const key = deps.key ?? decodeVerifyKey(parsed.verify_key);
  if (!key) throw new Error("verify key is invalid");
  const state = createRuntimeState({
    identity: {
      app: parsed.app,
      release: parsed.release,
      bundleHash: parsed.bundle_hash,
      mode: parsed.mode,
      processNonce: parsed.process_nonce,
    },
    blueprint: deps.blueprint,
    key,
    clock: deps.clock,
    ids: deps.ids,
    dataSchema: deps.dataSchema,
    directSocket: parsed.direct_socket,
    broker: createBrokerClient({
      transport: deps.broker,
      socketPath: parsed.broker_socket,
      credential: parsed.broker_credential,
      child: { process_nonce: parsed.process_nonce, mode: parsed.mode },
    }),
    screenBytes: deps.screenBytes,
  });
  return { start: parsed, state };
}

export async function publishReady(state: RuntimeState): Promise<boolean> {
  if (!commandsMatchBlueprint(state)) return false;
  const response = await state.broker.ready({
    release: state.identity.release,
    bundle_hash: state.identity.bundleHash,
    commands: state.blueprint.commands.map((command) => command.key),
    data_schema: state.dataSchema,
    process_nonce: state.identity.processNonce,
    connection_ok: true,
  });
  return response.status === 200;
}
