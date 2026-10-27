// mock 모드의 core 연결과 event 연결. core는 provider 읽기만 대신 답하고(그 밖의 호출은 unavailable이다),
// event 연결은 대기 항목을 채운 fake Gateway다.
import type { ConnectionState, CoreSource } from "../connection/connection.ts";
import { createFakeWaiting } from "../connection/waiting/fake-source.ts";

const PROVIDERS = [
  {
    id: "pvd_01h455vb4pex5v6nkc6gd5fd01",
    name: "Claude",
    credential: { state: "available" },
  },
  {
    id: "pvd_01h455vb4pex5v6nkc6gd5fd02",
    name: "ChatGPT",
    credential: { state: "available" },
  },
];

/** 항상 ready인 core 통로. provider 목록만 읽히고 나머지 호출은 unavailable이다. */
export function mockCore(): CoreSource {
  const state: ConnectionState = { state: "ready", confirmedAt: Date.now() };
  return {
    subscribe(listener) {
      listener(state);
      return () => {};
    },
    current: () => state,
    call(input) {
      if (input.resource === "providers" && input.method === "list") {
        return Promise.resolve({
          ok: true,
          value: { providers: PROVIDERS, next_cursor: null },
        });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "mock mode has no core" },
      });
    },
  };
}

/** 대기 목록이 읽는 fake Gateway. 결정하면 항목이 빠진다. */
export function mockEvents(): CoreSource {
  return createFakeWaiting();
}
