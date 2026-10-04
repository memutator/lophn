import { err } from "../../base/mod.ts";
import type {
  ReadDefinition,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import { openReaderConnection } from "./reader-connection.ts";
import {
  executeRead,
  type ReaderRegistrationModule,
  readKey,
} from "./reads.ts";

const self = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown): void;
};

self.onmessage = async (event: MessageEvent) => {
  const { path, modules } = event.data as { path: string; modules: string[] };
  try {
    const registrations = await Promise.all(modules.map(async (url) => {
      const module: ReaderRegistrationModule = await import(url);
      return module.createReaderRegistration();
    }));
    const definitions = new Map<string, {
      read: ReadDefinition;
      ports: ReadonlyMap<unknown, unknown>;
    }>();
    for (const registration of registrations) {
      for (const read of registration.reads) {
        const key = readKey(read.route);
        if (definitions.has(key)) {
          throw new Error("duplicate read registration");
        }
        definitions.set(key, { read, ports: registration.ports });
      }
    }
    const opened = openReaderConnection(path);
    if (!opened.ok) {
      self.postMessage({ ready: opened });
      return;
    }
    const connection = opened.value;
    self.onmessage = (request: MessageEvent) => {
      const { id, key, ctx, input } = request.data as {
        id: number;
        key: string;
        ctx: RequestContext;
        input: unknown;
      };
      const definition = definitions.get(key);
      const result = definition
        ? executeRead(connection, definition.read, definition.ports, ctx, input)
        : err({ code: "not_found", message: "등록되지 않은 read다" });
      self.postMessage({ id, result });
    };
    self.postMessage({ ready: { ok: true, value: [...definitions.keys()] } });
  } catch {
    self.postMessage({
      ready: err({ code: "unavailable", message: "reader 기동에 실패했다" }),
    });
  }
};
