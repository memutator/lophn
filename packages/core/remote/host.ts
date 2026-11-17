// remote 연결 하나하나를 맡는다. handshake로 받은 공개 key가 등록된 기기(폰, desktop)면 그 기기 자격으로 `call`·`watch`를 받고
// (첫 frame이 `pair`면 다시 pairing이다), 아니면 `pair`만 받는다. listener(WebSocket)는 이 file을 모르고 전송 하나씩 넘긴다. test는 메모리 전송을 넘긴다.
import {
  err,
  type Logger,
  type RandomSource,
  type Result,
} from "../../base/mod.ts";
import type { z } from "zod";
import type { Id } from "../../protocol/base/mod.ts";
import {
  acceptRemote,
  type devicesRegister,
  type KeyPair,
  REMOTE_ALLOWED_EVENTS,
  REMOTE_FRAME_MAX_BYTES,
  type RemoteClientFrame,
  type RemoteServerChannel,
  type RemoteTransport,
  remoteKeyText,
} from "../../protocol/remote/mod.ts";
import { type Bus, createGatewaySession } from "../events/mod.ts";
import type { Admission } from "../supervision/responsiveness/mod.ts";
import {
  type DeviceCredentials,
  devicePrincipal,
  type RemoteCall,
} from "./call.ts";
import type { PairingCodes } from "./pairing.ts";
import type { PhoneConnection, PhoneLink } from "./phone-link.ts";

// handshake와 hello가 이 안에 끝나지 않은 연결은 닫는다. 말 없는 socket이 자리를 붙잡지 못하게.
export const REMOTE_HANDSHAKE_MS = 10_000;
// 틀린 pairing code는 연결마다 이만큼이다. 넘으면 연결을 닫는다.
export const PAIRING_TRIES = 5;
// 등록되지 않은 key가 channel이 열린 뒤 이 안에 pairing을 끝내지 않으면 닫는다. LAN의 아무나 연결을 붙잡지 못하게.
export const REMOTE_PAIRING_MS = 60_000;
// 기기로 붙지 않은 연결(handshake 중과 pairing 전)은 동시에 이만큼이다. 넘는 socket은 받자마자 닫는다.
export const REMOTE_UNATTACHED_MAX = 8;
// 기기로 붙기 전에 받는 frame의 상한이다. `pair` frame은 작다. 붙은 뒤에는 REMOTE_FRAME_MAX_BYTES다.
export const REMOTE_UNATTACHED_FRAME_MAX_BYTES = 4 * 1024;

// 실제 WebSocket은 보내지 못한 byte 수를 안다. Gateway와 같은 한도로 느린 연결을 끊는 데 쓴다.
export type RemoteSocket = RemoteTransport & { bufferedAmount(): number };

export type RemoteTimers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

// pair frame의 기기 칸(kind로 갈린다), hello로 알린 이름, handshake로 받은 공개 key.
type DeviceInput = z.infer<typeof devicesRegister.input>;

// 기기 표. production은 ledger의 devices command·read다.
export type RemoteDevices = {
  find(publicKey: string): Promise<Result<{ id: string } | undefined>>;
  register(input: DeviceInput): Promise<Result<{ id: string }>>;
  // 마지막 연결 시각과 그 연결의 hello로 알린 이름. 실패는 연결을 막지 않는다.
  connected(id: string, name: string): void;
};

export type RemoteHostDeps = {
  staticKey: KeyPair;
  // hello로 알리는 이 기계와 지금 주소 후보. 연결마다 읽어 이름이나 주소가 바뀌면 다음 연결부터 새 것이다.
  machine(): { id: Id<"mch">; name: string; addresses: string[] };
  random: RandomSource;
  timers: RemoteTimers;
  bus: Bus;
  pairing: PairingCodes;
  devices: RemoteDevices;
  credentials: DeviceCredentials;
  call: RemoteCall;
  admission: Admission;
  // 기기의 마지막 연결이 닫혔거나 기기를 끊었다. 그 기기가 한 보고(presence)를 지우는 데 쓴다.
  deviceGone?(device: string): void;
  // core의 앱 view 표. 기기의 마지막 연결이 닫히면 그 기기(owner)의 view를 지운다.
  views: { closeOwner(owner: string): void };
  // core가 폰에 묻는 길. 붙은 연결과 그 연결의 `response`와 닫힘을 알린다.
  phoneLink: Pick<PhoneLink, "attached" | "received" | "closed">;
  logger?: Logger;
};

export type RemoteHost = {
  accept(socket: RemoteSocket): Promise<void>;
  // 기기를 끊었다(표에서 지운 뒤). 자격을 거두고 그 기기의 연결을 모두 닫는다.
  revoked(id: string): void;
  // `closed(shutdown)`을 보내고 모든 연결을 닫는다.
  shutdown(): void;
};

type Connection = {
  channel: RemoteServerChannel;
  // 폰이 `hello.capabilities`에 적은 것. core는 여기 있는 kind만 폰에 묻는다.
  capabilities: readonly string[];
  device?: string;
  // 붙은 기기의 Gateway session. 내려갈 때 `closed(shutdown)`을 보낸다.
  session?: { shutdown(): void };
};

export function createRemoteHost(deps: RemoteHostDeps): RemoteHost {
  const connections = new Set<Connection>();
  let unattached = 0;

  async function serve(
    channel: RemoteServerChannel,
    socket: RemoteSocket,
    // 기기로 붙었다. 붙지 않은 연결 수에서 뺀다.
    attached: () => void,
  ) {
    let closed = false;
    const cleanups: (() => void)[] = [];
    const connection: Connection = {
      channel,
      capabilities: channel.peer.capabilities,
    };
    const publicKey = remoteKeyText(channel.peer.publicKey);
    connections.add(connection);
    channel.onClose(() => {
      closed = true;
      connections.delete(connection);
      const device = connection.device;
      if (
        device !== undefined &&
        ![...connections].some((each) => each.device === device)
      ) {
        deps.deviceGone?.(device);
      }
      for (const cleanup of cleanups.splice(0)) cleanup();
    });
    const pairingTimer = deps.timers.set(
      () => channel.close(),
      REMOTE_PAIRING_MS,
    );
    cleanups.push(() => deps.timers.clear(pairingTimer));

    // 기기 자격으로 붙인다. frame을 받을 함수를 돌려준다. 붙지 못하면 연결을 닫고 undefined다.
    async function attach(
      device: string,
    ): Promise<((frame: RemoteClientFrame) => void) | undefined> {
      // 자격을 받는 사이 기기를 끊으면 revoked가 이 연결을 닫도록 먼저 적는다.
      connection.device = device;
      const credential = await deps.credentials.get(device);
      if (!credential.ok) {
        channel.close();
        return undefined;
      }
      // 찾은 뒤 connection.device를 적기 전에 기기를 끊었으면 revoked가 이 연결을 보지 못했다. 자격을 받은 뒤 다시 찾아
      // 없으면 그 자격을 거둔다. 기기마다 자격을 한 번 쓰는 cache가 끊은 기기의 자격을 내주지 않게 한다.
      const still = await deps.devices.find(publicKey);
      if (still.ok && still.value?.id !== device) {
        deps.credentials.revoke(device);
      }
      if (!still.ok || still.value?.id !== device || closed) {
        channel.close();
        return undefined;
      }
      const owner = devicePrincipal(device);
      const slot = deps.admission.enterEvent(owner);
      if (!slot.ok) {
        channel.close();
        return undefined;
      }
      // owner를 주면 Gateway가 `AppViewEvent`를 이 기기가 연 view의 것만 보낸다.
      const session = createGatewaySession(
        {
          send: (text) => void channel.send(JSON.parse(text)),
          close: () => channel.close(),
          bufferedAmount: () => socket.bufferedAmount(),
        },
        deps.bus,
        { events: REMOTE_ALLOWED_EVENTS, owner },
      );
      cleanups.push(() => {
        session.closed();
        slot.value.release();
        // 폰이 새 연결로 먼저 다시 붙은 뒤 옛 연결의 닫힘이 늦게 오면, 새 연결이 다시 연 view를 지우지 않는다.
        const attachedElsewhere = [...connections].some(
          (other) => other.device === device && other.session !== undefined,
        );
        if (!attachedElsewhere) deps.views.closeOwner(owner);
      });
      connection.session = session;
      deps.timers.clear(pairingTimer);
      channel.setMaxFrameBytes(REMOTE_FRAME_MAX_BYTES);
      attached();
      deps.devices.connected(device, channel.peer.name);
      const phone: PhoneConnection = {
        device,
        capabilities: connection.capabilities,
        send: (frame) => channel.send(frame),
      };
      deps.phoneLink.attached(phone);
      cleanups.push(() => deps.phoneLink.closed(phone));
      return (frame) => {
        if (frame.type === "call") {
          void deps
            .call(credential.value, frame)
            .catch(
              (): Result<unknown> =>
                err({ code: "internal", message: "internal error" }),
            )
            .then((result) => {
              const sent = channel.send(
                result.ok
                  ? {
                      type: "result",
                      id: frame.id,
                      ok: true,
                      value: result.value,
                    }
                  : {
                      type: "result",
                      id: frame.id,
                      ok: false,
                      error: {
                        code: result.error.code,
                        message: result.error.message,
                      },
                    },
              );
              // frame 한도를 넘는 답은 보내지 못했다. 부른 쪽이 그 답을 끝없이 기다리지 않게 오류로 답한다.
              if (!sent.ok && sent.error.code === "invalid_input") {
                channel.send({
                  type: "result",
                  id: frame.id,
                  ok: false,
                  error: {
                    code: "unavailable",
                    message: "the reply is too large to send",
                  },
                });
              }
            });
        } else if (frame.type === "watch") {
          session.receive(JSON.stringify(frame));
        } else if (frame.type === "response") {
          deps.phoneLink.received(phone, frame);
        } else {
          channel.close();
        }
      };
    }

    let tries = 0;
    // 등록되지 않은 key와 다시 pairing하는 등록된 key: `pair` 말고는 연결을 닫는다. 맞으면 기기를 등록하고(같은 key의 옛 등록은
    // devices.register가 바꾼다) 그 자리에서 붙인다. 틀리면 옛 등록은 그대로다.
    async function unpaired(
      frame: RemoteClientFrame,
    ): Promise<((frame: RemoteClientFrame) => void) | undefined> {
      if (frame.type !== "pair") {
        // 꺼져 있는 동안 끊긴 기기는 다음 연결에서 이것을 받는다. 이유 없이 닫으면 닿지 않음으로 보고 헛되이 다시 붙는다.
        channel.send({ type: "closed", reason: "credential_revoked" });
        channel.close();
        return undefined;
      }
      if (!deps.pairing.take(frame.code)) {
        tries += 1;
        channel.send({
          type: "result",
          id: frame.id,
          ok: false,
          error: {
            code: "unauthorized",
            message: "pairing code is wrong or expired",
          },
        });
        if (tries >= PAIRING_TRIES) channel.close();
        return undefined;
      }
      const { type: _type, id: _id, code: _code, ...device } = frame;
      const registered = await deps.devices.register({
        ...device,
        name: channel.peer.name,
        public_key: publicKey,
      });
      if (!registered.ok) {
        channel.send({
          type: "result",
          id: frame.id,
          ok: false,
          error: registered.error,
        });
        return undefined;
      }
      const receive = await attach(registered.value.id);
      if (receive) {
        channel.send({
          type: "result",
          id: frame.id,
          ok: true,
          value: { device: registered.value.id },
        });
      }
      return receive;
    }

    // frame은 onFrame을 걸 때까지 channel에 모여 있다. 기기를 찾은 뒤에 건다.
    const found = await deps.devices.find(publicKey);
    if (!found.ok) return channel.close();
    const known = found.value?.id;
    // 등록된 key는 붙기 전에도 큰 frame을 보낼 수 있다. 붙는 사이 온 frame이 상한에 걸려 끊기지 않게 여기서 올린다.
    if (known !== undefined) channel.setMaxFrameBytes(REMOTE_FRAME_MAX_BYTES);
    let receive: ((frame: RemoteClientFrame) => void) | undefined;
    // frame은 차례로 본다. `pair`의 답이나 붙기를 기다리지 않고 온 frame도 붙은 뒤의 규칙으로 본다.
    // 등록된 key는 첫 frame이 `pair`가 아니면 그 기기로 붙는다. `pair`면 폰이 이 컴퓨터를 잊고 다시 pairing하는 것이다.
    let pending = Promise.resolve();
    channel.onFrame((frame) => {
      if (receive) return receive(frame);
      pending = pending
        .then(async () => {
          if (closed) return;
          if (receive) return receive(frame);
          if (known !== undefined && frame.type !== "pair") {
            receive = await attach(known);
            return receive?.(frame);
          }
          receive = await unpaired(frame);
        })
        .catch(() => channel.close());
    });
  }

  return {
    async accept(socket) {
      if (unattached >= REMOTE_UNATTACHED_MAX) return socket.close();
      unattached += 1;
      let counted = true;
      const release = () => {
        if (!counted) return;
        counted = false;
        unattached -= 1;
      };
      const timer = deps.timers.set(() => socket.close(), REMOTE_HANDSHAKE_MS);
      const opened = await acceptRemote({
        transport: socket,
        staticKey: deps.staticKey,
        capabilities: [],
        random: deps.random,
        maxFrameBytes: REMOTE_UNATTACHED_FRAME_MAX_BYTES,
        machine: deps.machine(),
      });
      deps.timers.clear(timer);
      if (!opened.ok) {
        // 판이 어긋난 기기는 화면에 아무것도 남기지 않으므로 어느 쪽을 올려야 하는지 log에 남긴다.
        if (opened.error.code === "conflict") {
          deps.logger?.warn({
            component: "remote",
            event: "protocol_version_out_of_range",
            message: opened.error.message,
            fields: { ...opened.error.details },
          });
        }
        return release();
      }
      opened.value.onClose(release);
      try {
        await serve(opened.value, socket, release);
      } catch (thrown) {
        deps.logger?.error({
          component: "remote",
          event: "connection_failed",
          fields: { message: String(thrown) },
        });
        opened.value.close();
      }
    },
    revoked(id) {
      deps.credentials.revoke(id);
      deps.deviceGone?.(id);
      for (const connection of [...connections]) {
        if (connection.device !== id) continue;
        connection.channel.send({
          type: "closed",
          reason: "credential_revoked",
        });
        connection.channel.close();
      }
    },
    shutdown() {
      for (const connection of [...connections]) {
        if (connection.session) connection.session.shutdown();
        else connection.channel.close();
      }
    },
  };
}
