// 폰 대신 core의 remote listener에 붙어 보는 개발용 client. 폰 앱이 할 일을 같은 protocol·remote-client code로 한다.
// 실행:
//   node tools/remote-client.ts join --state <file> --invite '<roster/invite가 준 글>' [--address <host>] [--name <name>]
//   node tools/remote-client.ts call --state <file> <resource>/<method> ['<body JSON>'] [--watch <초>] [--address <host>] [--name <name>]
//   node tools/remote-client.ts file --state <file> <resource>/<method> ['<body JSON>'] --out <path> [--address <host>] [--name <name>]
// join은 새 폰 key로 초대장의 명단에 들어가(kind phone, 새 기기 id) 이 client의 key와 core 정보를 --state file에 남기고 답(기기 id,
// 명단)을 찍는다. --name은 hello와 명단 항목의 이 client 이름이다. call은 그 key로 다시 붙어 `join`을 먼저 보낸 뒤 route 하나를 부르고
// (hello의 기계 id가 state와 다르면 아무것도 보내지 않고 conflict로 끝난다), file은 file route 하나를 불러 답의 base64를 bytes로 풀어
// --out에 쓴다. --watch를 주면 그 동안 기기가 받을 수 있는 모든 event(REMOTE_ALLOWED_EVENTS)를 찍는다. 주소는 초대장의 후보를 차례로
// 붙어 보고, --address가 있으면 그것만 쓴다.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../packages/base/mod.ts";
import type { Id } from "../packages/protocol/base/mod.ts";
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
} from "../packages/protocol/remote/mod.ts";
import {
  dialWebSocket,
  join,
  parseInviteText,
} from "../packages/remote-client/mod.ts";

type State = {
  addresses: string[];
  port: number;
  key: string;
  secret_key: string;
  machine?: Id<"mch">;
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    state: { type: "string" },
    invite: { type: "string" },
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

// 이 client가 알리는 폰 화면(흔한 Android 폰).
const SCREEN = {
  os: "android",
  width: 412,
  height: 915,
  dpr: 2.625,
} as const;

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
      name: values.name ?? "remote-client",
      // 진짜 폰처럼 hello마다 화면을 싣는다: 명단으로만 이 폰을 안 컴퓨터가 첫 연결에 기기 행을 만든다.
      phone: SCREEN,
      machine: state.machine,
      random: cryptoRandom,
    });
    if (!channel.ok) {
      fail(
        `handshake failed at ${url}: ${channel.error.code} ${channel.error.message}${
          channel.error.details
            ? ` ${JSON.stringify(channel.error.details)}`
            : ""
        }`,
      );
    }
    const { machine } = channel.value.peer;
    console.error(`connected ${url} (${machine.name}, ${machine.id})`);
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

if (command === "join") {
  if (!values.invite) fail("--invite '<text>' is required");
  // roster/invite 답의 invite 칸(QR과 "Show as text"의 글)을 받는다.
  const invite = parseInviteText(values.invite);
  if (!invite) fail("--invite is not an invite text");
  const issuer = invite.issuer.body;
  if (issuer.type !== "entry") fail("the invite's issuer is not an entry");
  const phone = generateKeyPair(cryptoRandom);
  const name = values.name ?? "remote-client";
  const addresses = values.address ? [values.address] : invite.reach.addresses;
  const done = await join(
    { ...invite, reach: { ...invite.reach, addresses } },
    {
      key: phone,
      dial: dialWebSocket,
      random: cryptoRandom,
      name,
      capabilities: [],
      phone: SCREEN,
      entry: {
        id: createIdSource({ clock: systemClock, random: cryptoRandom }).newId(
          "dev",
        ),
        kind: "phone",
        key: remoteKeyText(phone.publicKey),
        signing_key: null,
        machine: null,
        name,
        os: SCREEN.os,
        rev: 1,
      },
    },
  );
  console.log(JSON.stringify(done.ok ? done.joined : done.failure));
  if (done.ok) {
    const state: State = {
      addresses: invite.reach.addresses,
      port: invite.reach.port,
      key: issuer.key,
      secret_key: remoteKeyText(phone.secretKey),
      ...(issuer.machine === null
        ? {}
        : { machine: issuer.machine as Id<"mch"> }),
    };
    writeFileSync(values.state, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  }
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
  // 연결의 첫 frame은 늘 join이다. core는 이 key를 명단으로 안다.
  const joined = result(channel, "join");
  channel.send({ type: "join", id: "join", statements: [] });
  const admitted = await joined;
  if (!admitted.ok) {
    print(admitted);
    process.exit(1);
  }
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
  fail("usage: remote-client.ts <join|call|file> --state <file> ...");
}
