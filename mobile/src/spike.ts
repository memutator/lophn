import { getRandomValues } from "expo-crypto";
import { z } from "zod";
import {
  connectRemote,
  generateKeyPair,
  type KeyPair,
  REMOTE_PATH,
  type RemoteClientChannel,
  type RemotePairing,
  type RemoteServerFrame,
  type RemoteTransport,
  remoteKeyBytes,
  remoteKeyText,
} from "./remote.ts";

const random = { fill: (bytes: Uint8Array) => getRandomValues(bytes) };

// Hermes features the protocol code leans on. Each line is "name: result".
export function hermesChecks(): string[] {
  const lines: string[] = [];
  const check = (name: string, run: () => string) => {
    try {
      lines.push(`${name}: ${run()}`);
    } catch (e) {
      lines.push(`${name}: FAIL ${(e as Error).message}`);
    }
  };
  check("TextDecoder fatal", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const good = decoder.decode(new TextEncoder().encode("한글 ok"));
    try {
      decoder.decode(Uint8Array.of(0xff, 0xfe));
      return `decoded "${good}" but invalid bytes did NOT throw`;
    } catch {
      return `ok ("${good}", invalid bytes throw)`;
    }
  });
  check("zod", () => {
    const schema = z.strictObject({ a: z.number().int() });
    const bad = schema.safeParse({ a: 1, b: 2 }).success;
    return schema.parse({ a: 1 }).a === 1 && !bad ? "ok" : "wrong";
  });
  check("btoa/atob", () => {
    const bytes = new Uint8Array(32);
    random.fill(bytes);
    const back = remoteKeyBytes(remoteKeyText(bytes));
    return back && back.every((b, i) => b === bytes[i]) ? "ok" : "mismatch";
  });
  check("expo-crypto random", () => {
    const a = new Uint8Array(32);
    const b = new Uint8Array(32);
    random.fill(a);
    random.fill(b);
    return a.some((x, i) => x !== b[i]) ? "ok" : "same bytes";
  });
  check("x25519", () => {
    const pair = generateKeyPair(random);
    return pair.publicKey.length === 32 ? "ok" : "bad key";
  });
  return lines;
}

function socket(url: string): Promise<RemoteTransport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const handlers = { message: (_: Uint8Array) => {}, close: () => {} };
    ws.onmessage = (event) =>
      handlers.message(new Uint8Array(event.data as ArrayBuffer));
    ws.onclose = () => handlers.close();
    ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
    ws.onopen = () =>
      resolve({
        send: (bytes) => ws.send(bytes),
        close: () => ws.close(),
        onMessage: (fn) => {
          handlers.message = fn;
        },
        onClose: (fn) => {
          handlers.close = fn;
        },
      });
  });
}

async function open(
  qr: RemotePairing,
  address: string,
  phone: KeyPair,
): Promise<RemoteClientChannel> {
  const remoteStatic = remoteKeyBytes(qr.key);
  if (!remoteStatic) throw new Error("core key is not base64url");
  const transport = await socket(`ws://${address}:${qr.port}${REMOTE_PATH}`);
  const channel = await connectRemote({
    transport,
    staticKey: phone,
    remoteStatic,
    capabilities: [],
    random,
  });
  if (!channel.ok) throw new Error(channel.error.message);
  return channel.value;
}

function result(
  channel: RemoteClientChannel,
  id: string,
): Promise<RemoteServerFrame> {
  return new Promise((resolve, reject) => {
    channel.onClose(() => reject(new Error("closed by core")));
    channel.onFrame((frame) => {
      if (frame.type === "result" && frame.id === id) resolve(frame);
    });
  });
}

// Same steps as `tools/remote-client.ts pair` then `call`: pair on one connection, reconnect with the same key and call one read route.
export async function pairAndCall(
  qr: RemotePairing,
  address: string,
  log: (line: string) => void,
): Promise<void> {
  const phone = generateKeyPair(random);
  const first = await open(qr, address, phone);
  log("handshake ok");
  const paired = result(first, "pair");
  first.send({
    type: "pair",
    id: "pair",
    code: qr.code,
    name: "spike-emulator",
    os: "android",
    width: 412,
    height: 915,
    dpr: 2.625,
  });
  log(`pair: ${JSON.stringify(await paired)}`);
  first.close();
  const second = await open(qr, address, phone);
  const called = result(second, "call");
  second.send({
    type: "call",
    id: "call",
    resource: "session_snapshots",
    method: "list",
    body: {},
  });
  log(`call session_snapshots/list: ${JSON.stringify(await called)}`);
  second.close();
}
