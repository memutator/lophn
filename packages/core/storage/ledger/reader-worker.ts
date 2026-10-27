import { parentPort, workerData } from "node:worker_threads";
import { err } from "../../../base/mod.ts";
import type {
  ReadDefinition,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { createKnownSecretRegistry } from "../../../base/redaction/mod.ts";
import { KNOWN_SECRETS } from "./known-secrets.ts";
import { openReaderConnection } from "./reader-connection.ts";
import {
  executeRead,
  type ReaderRegistrationModule,
  readKey,
} from "./reads.ts";

const port = parentPort!;
// core가 Worker를 만들 때 넘긴 ledger 경로와 등록 module이다.
const boot = workerData as { path: string; modules: string[] };

async function start(): Promise<void> {
  try {
    const loaded: ReaderRegistrationModule[] = await Promise.all(
      boot.modules.map((url) => import(url)),
    );
    const registrations = loaded.flatMap((module) =>
      module.createReaderRegistration
        ? [module.createReaderRegistration()]
        : [],
    );
    // 알려진 secret 값은 이 Worker의 보호 메모리(이 closure)에만 있다. handler에는 일치 검사만
    // 하는 matcher를 port로 준다. 값은 core가 pool로 보내는 등록·회수 message로만 바뀐다.
    const known = createKnownSecretRegistry();
    // 처음에는 준비되지 않았다. core가 현재 참조의 값을 모두 넣고 알려야 true가 된다.
    let ready = false;
    const matcher = Object.freeze({
      match: (text: string) => known.match(text),
      prefixFrom: (text: string) => known.prefixFrom(text),
      get ready() {
        return ready;
      },
    });
    const definitions = new Map<
      string,
      {
        read: ReadDefinition;
        ports: ReadonlyMap<unknown, unknown>;
      }
    >();
    // writer의 tx port처럼 어느 registration이 등록한 port든 모든 read가 쓴다. 같은 key를 두 곳에서 등록하면
    // 조용히 덮이지 않게 기동 때 던진다.
    const sharedPorts = new Map<unknown, unknown>();
    for (const registration of registrations) {
      for (const [key, registeredPort] of registration.ports) {
        if (sharedPorts.has(key)) {
          throw new Error(
            `duplicate reader port ${(key as { name: string }).name}`,
          );
        }
        sharedPorts.set(key, registeredPort);
      }
    }
    for (const registration of registrations) {
      for (const read of registration.reads) {
        const key = readKey(read.route);
        if (definitions.has(key)) {
          throw new Error("duplicate read registration");
        }
        definitions.set(key, {
          read,
          ports: new Map([...sharedPorts, [KNOWN_SECRETS, matcher]]),
        });
      }
    }
    const opened = openReaderConnection(boot.path);
    if (!opened.ok) {
      port.postMessage({ ready: opened });
      return;
    }
    const connection = opened.value;
    port.on("message", (message) => {
      const change = (
        message as {
          known?: {
            id: number;
            op: "register" | "revoke" | "ready" | "unready";
            values: string[];
          };
        }
      ).known;
      if (change !== undefined) {
        if (change.op === "register") known.register(change.values);
        else if (change.op === "revoke") known.revoke(change.values);
        else ready = change.op === "ready";
        port.postMessage({ known_ack: change.id });
        return;
      }
      const { id, key, ctx, input } = message as {
        id: number;
        key: string;
        ctx: RequestContext;
        input: unknown;
      };
      const definition = definitions.get(key);
      const result = definition
        ? executeRead(connection, definition.read, definition.ports, ctx, input)
        : err({ code: "not_found", message: "등록되지 않은 read다" });
      port.postMessage({ id, result });
    });
    port.postMessage({ ready: { ok: true, value: [...definitions.keys()] } });
  } catch {
    port.postMessage({
      ready: err({ code: "unavailable", message: "reader 기동에 실패했다" }),
    });
  }
}

await start();
