// 시작은 ready=false·accepting=false. 앱 code load 뒤에 등록 handler로 attestation을 만든다.
import type { Blueprint } from "../../../../protocol/apps/blueprint/mod.ts";
import { type AppStart, parseAppStart } from "./start-input.ts";
import { type BrokerTransport, createBrokerClient } from "./broker-client.ts";
import {
  createCapHost,
  createStoreAccess,
  encodeChangeset,
  installCapHost,
} from "./cap-host.ts";
import { ensureAppApiPort } from "./app-api-port.ts";
import { createRuntimeState, type RuntimeState } from "./state.ts";
import { attestation } from "./control.ts";

type Started = {
  start: AppStart;
  state: RuntimeState;
};

export function startRuntime(deps: {
  line: string;
  blueprint: Blueprint;
  broker: BrokerTransport;
  dataSchema: number;
}): Started {
  const parsed = parseAppStart(deps.line);
  if (!parsed) throw new Error("app start input is invalid");
  const store = createStoreAccess();
  const state = createRuntimeState({
    identity: {
      app: parsed.app,
      release: parsed.release,
      bundleHash: parsed.bundle_hash,
      mode: parsed.mode,
      processNonce: parsed.process_nonce,
    },
    blueprint: deps.blueprint,
    dataSchema: deps.dataSchema,
    controlSocket: parsed.control_socket,
    store,
    broker: createBrokerClient({
      transport: deps.broker,
      socketPath: parsed.broker_socket,
      credential: parsed.broker_credential,
      child: { process_nonce: parsed.process_nonce, mode: parsed.mode },
    }),
  });
  // cap-net·cap-secret·cap-store의 host다. broker 연결과 호출 문맥을 앱 코드에 내주지 않고
  // SDK가 port로만 쓴다.
  installCapHost(createCapHost({
    mode: parsed.mode,
    dataPath: parsed.data_path,
    store,
    post: (path, body) => state.broker.post(path, body),
    current: () => ensureAppApiPort().current(),
  }));
  // 앱 code를 불러오는 동안 등록 handler가 DB를 쓸 수 있다. 이 구간의 변경도 changeset으로 뜬다.
  store.begin();
  return { start: parsed, state };
}

// 앱 시작이 DB를 바꿨으면 그 changeset을 ready 통보에 싣는다.
export async function publishReady(
  state: RuntimeState,
  startChangeset: Uint8Array | null,
): Promise<boolean> {
  const response = await state.broker.ready(
    attestation(state),
    encodeChangeset(startChangeset),
  );
  return response.status === 200;
}
