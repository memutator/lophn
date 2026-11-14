import type { z } from "zod";
import {
  err,
  type LophnError,
  ok,
  type RandomSource,
  type Result,
} from "../../base/mod.ts";
import {
  REMOTE_PROLOGUE,
  REMOTE_PROTOCOL_MIN_VERSION,
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientFrame,
  type RemoteHello,
  type RemoteServerFrame,
  remoteClientFrameSchema,
  remoteServerFrameSchema,
} from "./frames.ts";
import {
  initiatorHandshake,
  type KeyPair,
  NOISE_MAX_MESSAGE_BYTES,
  NOISE_TAG_BYTES,
  responderHandshake,
  type Transport,
} from "./noise.ts";

// 메시지 경계를 지키는 전송 하나(WebSocket binary message 등). 연결 하나에 handler를 하나씩 건다.
export type RemoteTransport = {
  send(bytes: Uint8Array): void;
  close(): void;
  onMessage(handler: (bytes: Uint8Array) => void): void;
  onClose(handler: () => void): void;
};

// handshake와 hello로 안 상대. publicKey가 기기 신원이다. 누구인지는 부르는 쪽이 정한다.
export type RemotePeer = {
  publicKey: Uint8Array;
  version: number;
  capabilities: string[];
};

// frame 하나는 JSON 하나다. 받는 쪽은 onFrame을 걸 때까지 frame을 모아 둔다.
// 바뀌거나 빠지거나 순서가 바뀐 record, schema 밖 frame을 받으면 연결을 끊는다.
export type RemoteChannel<Out, In> = {
  peer: RemotePeer;
  send(frame: Out): Result<void>;
  onFrame(handler: (frame: In) => void): void;
  onClose(handler: () => void): void;
  close(): void;
  // 받는 frame의 상한을 바꾼다. 상대가 누구인지 안 뒤에 올린다(REMOTE_FRAME_MAX_BYTES까지).
  setMaxFrameBytes(bytes: number): void;
};

export type RemoteClientChannel = RemoteChannel<
  RemoteClientFrame,
  RemoteServerFrame
>;
export type RemoteServerChannel = RemoteChannel<
  RemoteServerFrame,
  RemoteClientFrame
>;

// 받는 frame 상한의 기본값이자 보내는 frame의 상한이다. 상대가 더 큰 frame을 보내면 끊는다. 메모리를 상대가 정하지 못하게 하는 상한이다.
export const REMOTE_FRAME_MAX_BYTES = 16 * 1024 * 1024;

// record 하나의 평문은 `last(1) || data`다. 큰 frame은 record 여럿으로 나누고 마지막 record만 last가 1이다.
// nonce는 방향마다 0부터 오르는 counter라 record가 빠지거나 순서가 바뀌면 복호화가 실패한다.
const CHUNK_BYTES = NOISE_MAX_MESSAGE_BYTES - NOISE_TAG_BYTES - 1;
const EMPTY = new Uint8Array();
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const prologue = encoder.encode(REMOTE_PROLOGUE);

type Options = {
  transport: RemoteTransport;
  staticKey: KeyPair;
  capabilities: string[];
  random: RandomSource;
  // 받는 frame의 상한. 없으면 REMOTE_FRAME_MAX_BYTES다. handshake 직후부터 건다.
  maxFrameBytes?: number;
};

// 폰 쪽. remoteStatic은 QR로 받은 core의 공개 key이고, 다른 key의 core와는 handshake가 서지 않는다.
export function connectRemote(
  options: Options & { remoteStatic: Uint8Array },
): Promise<Result<RemoteClientChannel>> {
  const handshake = initiatorHandshake({ ...options, prologue });
  return open(options, remoteServerFrameSchema, {
    initiator: true,
    first: handshake.writeMessage(EMPTY),
    finish: (bytes) => handshake.readMessage(bytes).transport,
  });
}

// core 쪽. handshake와 hello가 끝나기 전에는 어떤 frame도 부르는 쪽에 넘기지 않는다.
export function acceptRemote(
  options: Options,
): Promise<Result<RemoteServerChannel>> {
  const handshake = responderHandshake({ ...options, prologue });
  return open(options, remoteClientFrameSchema, {
    initiator: false,
    finish: (bytes) => {
      handshake.readMessage(bytes);
      const { message, transport } = handshake.writeMessage(EMPTY);
      options.transport.send(message);
      return transport;
    },
  });
}

// 양쪽 다 handshake 메시지를 하나씩 받는다. 받고 나면 initiator가 hello를 먼저 보내고, responder는 그 hello를
// 보고 판이 맞을 때 자기 hello를 보낸다. 상대 hello가 맞으면 channel이 열린다.
function open<Out, In extends { type: string }>(
  options: Options,
  schema: z.ZodType<In>,
  role: {
    initiator: boolean;
    first?: Uint8Array;
    // 상대 handshake 메시지를 처리하고 transport key를 낸다. 틀리면 던진다.
    finish: (bytes: Uint8Array) => Transport;
  },
): Promise<Result<RemoteChannel<Out, In>>> {
  const { transport } = options;
  const hello = {
    type: "hello",
    version: REMOTE_PROTOCOL_VERSION,
    capabilities: options.capabilities,
  };
  let keys: Transport | undefined;
  let peer: RemotePeer | undefined;
  let closed = false;
  let chunks: Uint8Array[] = [];
  let chunkBytes = 0;
  let maxFrameBytes = Math.min(
    options.maxFrameBytes ?? REMOTE_FRAME_MAX_BYTES,
    REMOTE_FRAME_MAX_BYTES,
  );
  let handler: ((frame: In) => void) | undefined;
  const queued: In[] = [];
  const closeHandlers: (() => void)[] = [];
  let settle: (result: Result<RemoteChannel<Out, In>>) => void = () => {};

  function close(error: LophnError = unavailable) {
    if (closed) return;
    closed = true;
    transport.close();
    if (!peer) settle(err(error));
    for (const h of closeHandlers) h();
  }

  function send(frame: unknown): Result<void> {
    if (closed || !keys) return err(unavailable);
    const bytes = encoder.encode(JSON.stringify(frame));
    if (bytes.length > REMOTE_FRAME_MAX_BYTES) {
      return err({ code: "invalid_input", message: "remote frame too large" });
    }
    let offset = 0;
    do {
      const data = bytes.subarray(offset, offset + CHUNK_BYTES);
      offset += data.length;
      const plain = new Uint8Array(1 + data.length);
      plain[0] = offset >= bytes.length ? 1 : 0;
      plain.set(data, 1);
      transport.send(keys.send.encrypt(EMPTY, plain));
    } while (offset < bytes.length);
    return ok(undefined);
  }

  // 다 모인 frame을 돌려준다. 아직 모으는 중이면 undefined다. 틀리면 던진다.
  function readRecord(current: Transport, bytes: Uint8Array): In | undefined {
    if (bytes.length > NOISE_MAX_MESSAGE_BYTES) {
      throw new Error("record too large");
    }
    const plain = current.receive.decrypt(EMPTY, bytes);
    const last = plain[0];
    if (last !== 0 && last !== 1) throw new Error("bad record flag");
    chunkBytes += plain.length - 1;
    if (chunkBytes > maxFrameBytes) throw new Error("frame too large");
    chunks.push(plain.subarray(1));
    if (last === 0) return undefined;
    const whole = new Uint8Array(chunkBytes);
    let offset = 0;
    for (const chunk of chunks) {
      whole.set(chunk, offset);
      offset += chunk.length;
    }
    chunks = [];
    chunkBytes = 0;
    return schema.parse(JSON.parse(decoder.decode(whole)));
  }

  function received(current: Transport, frame: In) {
    if (peer) {
      if (handler) handler(frame);
      else queued.push(frame);
      return;
    }
    if (frame.type !== "hello") return close(protocolError);
    const theirs = frame as unknown as RemoteHello;
    if (theirs.version < REMOTE_PROTOCOL_MIN_VERSION) {
      return close({
        code: "conflict",
        message: "remote protocol version too old",
      });
    }
    if (!role.initiator) send(hello);
    peer = {
      publicKey: current.remoteStatic,
      version: theirs.version,
      capabilities: theirs.capabilities,
    };
    settle(ok(channel));
  }

  const channel: RemoteChannel<Out, In> = {
    get peer() {
      return peer as RemotePeer;
    },
    send: (frame) => send(frame),
    onFrame(next) {
      handler = next;
      for (const frame of queued.splice(0)) next(frame);
    },
    // 이미 닫혔으면 바로 부른다. 닫힘을 놓친 owner가 자리를 붙잡지 않게.
    onClose(next) {
      if (closed) next();
      else closeHandlers.push(next);
    },
    close: () => close(),
    setMaxFrameBytes(bytes) {
      maxFrameBytes = Math.min(bytes, REMOTE_FRAME_MAX_BYTES);
    },
  };

  transport.onClose(() => close());
  transport.onMessage((bytes) => {
    if (closed) return;
    if (!keys) {
      try {
        keys = role.finish(bytes);
      } catch {
        return close({
          code: "unauthorized",
          message: "remote handshake failed",
        });
      }
      if (role.initiator) send(hello);
      return;
    }
    let frame: In | undefined;
    try {
      frame = readRecord(keys, bytes);
    } catch {
      return close(protocolError);
    }
    if (frame) received(keys, frame);
  });

  return new Promise((resolve) => {
    settle = resolve;
    if (role.first) transport.send(role.first);
  });
}

const unavailable: LophnError = {
  code: "unavailable",
  message: "remote connection closed",
};
const protocolError: LophnError = {
  code: "invalid_input",
  message: "remote protocol violation",
};
