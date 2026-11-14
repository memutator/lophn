// 폰 대신 core의 remote listener에 붙어 보는 개발용 client. 폰 앱이 할 일을 같은 protocol code로 한다.
// 실행:
//   node tools/remote-client.ts pair --state <file> --qr '<pairing/start가 준 JSON>' [--address <host>] [--name <name>]
//   node tools/remote-client.ts call --state <file> <resource>/<method> ['<body JSON>'] [--watch <초>] [--address <host>]
//   node tools/remote-client.ts file --state <file> <resource>/<method> ['<body JSON>'] --out <path> [--address <host>]
// pair는 이 client의 key와 core 정보를 --state file에 남긴다. call은 그 key로 다시 붙어 route 하나를 부르고,
// file은 file route 하나를 불러 답의 base64를 bytes로 풀어 --out에 쓴다. --watch를 주면 그 동안 기기가 받을 수 있는 모든 event(REMOTE_ALLOWED_EVENTS)를 찍는다. 주소는 QR의 후보를 차례로 붙어 보고, --address가 있으면 그것만 쓴다.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import { cryptoRandom } from "../packages/base/mod.ts";
import {
  connectRemote,
  generateKeyPair,
  type KeyPair,
  REMOTE_PATH,
  type RemoteClientChannel,
  type RemoteServerFrame,
  type RemoteTransport,
  remoteKeyBytes,
  remoteKeyText,
  remotePairingSchema,
} from "../packages/protocol/remote/mod.ts";

type State = {
  addresses: string[];
  port: number;
  key: string;
  secret_key: string;
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    state: { type: "string" },
    qr: { type: "string" },
    address: { type: "string" },
    name: { type: "string" },
    watch: { type: "string" },
    out: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
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
  state: State,
  phone: KeyPair,
): Promise<RemoteClientChannel> {
  const remoteStatic = remoteKeyBytes(state.key);
  if (!remoteStatic) fail("core key is not base64url");
  const addresses = values.address ? [values.address] : state.addresses;
  for (const address of addresses) {
    const host = address.includes(":") ? `[${address}]` : address;
    const url = `ws://${host}:${state.port}${REMOTE_PATH}`;
    const transport = await socket(url).catch(() => undefined);
    if (!transport) continue;
    const channel = await connectRemote({
      transport,
      staticKey: phone,
      remoteStatic,
      capabilities: [],
      random: cryptoRandom,
    });
    if (!channel.ok)
      fail(`handshake failed at ${url}: ${channel.error.message}`);
    console.error(`connected ${url}`);
    return channel.value;
  }
  return fail("no address answered");
}

function print(frame: RemoteServerFrame) {
  console.log(JSON.stringify(frame));
}

let ending = false;

// 답 하나를 기다린다. 그 사이와 그 뒤의 다른 frame(event 등)은 찍는다.
function result(
  channel: RemoteClientChannel,
  id: string,
): Promise<Extract<RemoteServerFrame, { type: "result" }>> {
  return new Promise((resolve) => {
    channel.onClose(() => {
      if (!ending) fail("connection closed by core");
    });
    channel.onFrame((frame) => {
      if (frame.type === "result" && frame.id === id) resolve(frame);
      else print(frame);
    });
  });
}

const [command, target, body] = positionals;
if (!values.state) fail("--state <file> is required");

if (command === "pair") {
  if (!values.qr) fail("--qr '<json>' is required");
  const qr = remotePairingSchema.parse(JSON.parse(values.qr));
  const phone = generateKeyPair(cryptoRandom);
  const state: State = {
    addresses: qr.addresses,
    port: qr.port,
    key: qr.key,
    secret_key: remoteKeyText(phone.secretKey),
  };
  const channel = await open(state, phone);
  const answer = result(channel, "pair");
  channel.send({
    type: "pair",
    id: "pair",
    code: qr.code,
    name: values.name ?? "remote-client",
    os: "android",
    width: 412,
    height: 915,
    dpr: 2.625,
  });
  const done = await answer;
  print(done);
  if (done.ok) {
    writeFileSync(values.state, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  }
  ending = true;
  channel.close();
  process.exit(done.ok ? 0 : 1);
} else if (command === "call" || command === "file") {
  const [resource, method] = (target ?? "").split("/");
  if (!resource || !method) fail(`${command} needs <resource>/<method>`);
  if (command === "file" && !values.out) fail("file needs --out <path>");
  const state = JSON.parse(readFileSync(values.state, "utf8")) as State;
  const secret = remoteKeyBytes(state.secret_key);
  if (!secret) fail("state file has no key");
  const phone = generateKeyPair({ fill: (out) => out.set(secret) });
  const channel = await open(state, phone);
  const seconds = Number(values.watch ?? 0);
  if (seconds > 0) channel.send({ type: "watch", conditions: [{}] });
  const answer = result(channel, "call");
  channel.send({
    type: "call",
    id: "call",
    resource,
    method,
    body: body === undefined ? {} : JSON.parse(body),
  });
  const done = await answer;
  if (command === "file" && done.ok) {
    const { content_type, base64 } = done.value as {
      content_type: string;
      base64: string;
    };
    const bytes = Buffer.from(base64, "base64");
    writeFileSync(values.out!, bytes);
    console.log(
      JSON.stringify({ out: values.out, content_type, bytes: bytes.length }),
    );
  } else {
    print(done);
  }
  if (seconds > 0) await new Promise((r) => setTimeout(r, seconds * 1000));
  ending = true;
  channel.close();
  process.exit(0);
} else {
  fail("usage: remote-client.ts <pair|call|file> --state <file> ...");
}
