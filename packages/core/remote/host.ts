// remote 연결 하나하나를 맡는다. 붙는 쪽(폰, 다른 컴퓨터)의 첫 frame은 `join`이고, handshake로 받은 공개 key가 내 기기 명단에
// 있으면(내민 statement를 합친 뒤) 그 기기 자격으로 `call`·`watch`·`roster`를 받는다. 명단에 있는 key는 첫 frame이 `join`이
// 아니어도 붙는다. listener(WebSocket)는 이 file을 모르고 전송 하나씩 넘긴다. test는 메모리 전송을 넘긴다.
import {
  err,
  type Logger,
  type RandomSource,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import {
  acceptRemote,
  type KeyPair,
  REMOTE_ALLOWED_EVENTS,
  REMOTE_FRAME_MAX_BYTES,
  type RemoteClientFrame,
  type RemotePhone,
  type RemoteServerChannel,
  type RemoteTransport,
  ROSTER_JOIN_MAX_BYTES,
  type RosterSnapshot,
  type RosterStatement,
  remoteKeyText,
} from "../../protocol/remote/mod.ts";
import { type Bus, createGatewaySession } from "../events/mod.ts";
import type { Admission } from "../supervision/responsiveness/mod.ts";
import {
  type DeviceCredentials,
  devicePrincipal,
  type RemoteCall,
} from "./call.ts";
import type { PhoneConnection, PhoneLink } from "./phone-link.ts";
import type { RosterJoined } from "./roster.ts";

// handshake와 hello가 이 안에 끝나지 않은 연결은 닫는다. 말 없는 socket이 자리를 붙잡지 못하게.
export const REMOTE_HANDSHAKE_MS = 10_000;
// 틀린 `join`은 연결마다 이만큼이다. 넘으면 연결을 닫는다.
export const JOIN_TRIES = 5;
// 명단에 없는 key가 channel이 열린 뒤 이 안에 붙지 않으면 닫는다. LAN의 아무나 연결을 붙잡지 못하게.
export const REMOTE_JOIN_MS = 60_000;
// 기기로 붙지 않은 연결(handshake 중과 join 전)은 동시에 이만큼이다. 넘는 socket은 받자마자 닫는다.
export const REMOTE_UNATTACHED_MAX = 8;

// 실제 WebSocket은 보내지 못한 byte 수를 안다. Gateway와 같은 한도로 느린 연결을 끊는 데 쓴다.
export type RemoteSocket = RemoteTransport & { bufferedAmount(): number };

export type RemoteTimers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

// 내 기기 명단. production은 main thread의 명단 사본(roster.ts)이다.
export type RemoteRoster = {
  // key가 지금 명단의 기기면 그 id.
  find(key: string): string | undefined;
  // 붙는 쪽의 첫 frame. 거절은 `details.reason`(빠진 key면 `details.removal`)을 싣는다.
  join(
    key: string,
    statements: readonly RosterStatement[],
  ): Promise<Result<RosterJoined>>;
  // 붙은 연결이 보낸 명단을 받고 이 컴퓨터의 명단을 낸다.
  receive(roster: RosterSnapshot): Promise<Result<RosterSnapshot>>;
};

// 이 컴퓨터만의 기기 행. production은 ledger의 devices command다.
export type RemoteDevices = {
  // 붙었다: 마지막 연결 시각과 그 연결의 hello로 알린 이름(폰은 화면도). 실패는 연결을 막지 않는다.
  connected(input: { id: string; name: string; phone?: RemotePhone }): void;
};

export type RemoteHostDeps = {
  staticKey: KeyPair;
  // hello로 알리는 이 기계와 지금 주소 후보. 연결마다 읽어 이름이나 주소가 바뀌면 다음 연결부터 새 것이다.
  machine(): { id: Id<"mch">; name: string; addresses: string[] };
  random: RandomSource;
  timers: RemoteTimers;
  bus: Bus;
  roster: RemoteRoster;
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
  // 명단이 바뀌었다. 빠진 id의 자격을 거두고, key가 더는 그 id의 기기가 아닌 연결(뺀 key, 충돌한 key, 접힌 id)을 닫는다.
  revoked(ids: readonly string[]): void;
  // 붙은 연결마다 이 컴퓨터의 명단을 민다.
  pushRoster(roster: RosterSnapshot): void;
  // `closed(shutdown)`을 보내고 모든 연결을 닫는다.
  shutdown(): void;
};

type Connection = {
  channel: RemoteServerChannel;
  key: string;
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
    const publicKey = remoteKeyText(channel.peer.publicKey);
    const connection: Connection = {
      channel,
      key: publicKey,
      capabilities: channel.peer.capabilities,
    };
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
    const joinTimer = deps.timers.set(() => channel.close(), REMOTE_JOIN_MS);
    cleanups.push(() => deps.timers.clear(joinTimer));

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
      // 찾은 뒤 connection.device를 적기 전에 기기를 뺐으면 revoked가 이 연결을 보지 못했다. 자격을 받은 뒤 다시 찾아
      // 없으면 그 자격을 거둔다. 기기마다 자격을 한 번 쓰는 cache가 뺀 기기의 자격을 내주지 않게 한다.
      if (deps.roster.find(publicKey) !== device) {
        deps.credentials.revoke(device);
        channel.close();
        return undefined;
      }
      if (closed) {
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
      deps.timers.clear(joinTimer);
      channel.setMaxFrameBytes(REMOTE_FRAME_MAX_BYTES);
      attached();
      deps.devices.connected({
        id: device,
        name: channel.peer.name,
        ...(channel.peer.phone === undefined
          ? {}
          : { phone: channel.peer.phone }),
      });
      const phone: PhoneConnection = {
        device,
        capabilities: connection.capabilities,
        send: (frame) => channel.send(frame),
      };
      deps.phoneLink.attached(phone);
      cleanups.push(() => deps.phoneLink.closed(phone));
      return (frame) => {
        if (frame.type === "call") {
          // frame의 `by`(컴퓨터가 싣는 요청한 쪽)도 같이 간다. call이 기기 종류와 맞춰 보고 입구 handler가 쓴다.
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
                      // details도 싣는다: 다른 컴퓨터가 넘긴 call(`machines/call`)은 오류를 그대로 화면에 낸다.
                      error: {
                        code: result.error.code,
                        message: result.error.message,
                        ...(result.error.details === undefined
                          ? {}
                          : { details: result.error.details }),
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
        } else if (frame.type === "roster") {
          void deps.roster
            .receive(frame.roster)
            .catch(
              (): Result<RosterSnapshot> =>
                err({ code: "internal", message: "internal error" }),
            )
            .then((result) =>
              channel.send(
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
              ),
            );
        } else {
          channel.close();
        }
      };
    }

    let tries = 0;
    // 명단에 없는 key: `join` 말고는 연결을 닫는다. 내민 statement로 명단에 들면 그 자리에서 붙인다. 틀리면 이유를 답한다.
    async function joining(
      frame: RemoteClientFrame,
    ): Promise<((frame: RemoteClientFrame) => void) | undefined> {
      if (frame.type !== "join") {
        // 꺼져 있는 동안 빠진 기기는 다음 연결에서 이것을 받는다. 이유 없이 닫으면 닿지 않음으로 보고 헛되이 다시 붙는다.
        channel.send({ type: "closed", reason: "credential_revoked" });
        channel.close();
        return undefined;
      }
      const joined = await deps.roster.join(publicKey, frame.statements);
      if (!joined.ok) {
        tries += 1;
        channel.send({
          type: "result",
          id: frame.id,
          ok: false,
          error: joined.error,
        });
        if (tries >= JOIN_TRIES) channel.close();
        return undefined;
      }
      const receive = await attach(joined.value.device);
      if (receive) {
        channel.send({
          type: "result",
          id: frame.id,
          ok: true,
          value: joined.value,
        });
      }
      return receive;
    }

    // 명단의 key는 붙기 전에도 큰 frame을 보낼 수 있다. 붙는 사이 온 frame이 상한에 걸려 끊기지 않게 여기서 올린다.
    if (deps.roster.find(publicKey) !== undefined) {
      channel.setMaxFrameBytes(REMOTE_FRAME_MAX_BYTES);
    }
    let receive: ((frame: RemoteClientFrame) => void) | undefined;
    // frame은 차례로 본다. `join`의 답이나 붙기를 기다리지 않고 온 frame도 붙은 뒤의 규칙으로 본다.
    let pending = Promise.resolve();
    channel.onFrame((frame) => {
      if (receive) return receive(frame);
      pending = pending
        .then(async () => {
          if (closed) return;
          if (receive) return receive(frame);
          const known = deps.roster.find(publicKey);
          if (known !== undefined && frame.type !== "join") {
            receive = await attach(known);
            return receive?.(frame);
          }
          receive = await joining(frame);
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
        maxFrameBytes: ROSTER_JOIN_MAX_BYTES,
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
    revoked(ids) {
      for (const id of ids) {
        deps.credentials.revoke(id);
        deps.deviceGone?.(id);
      }
      for (const connection of [...connections]) {
        const device = connection.device;
        if (device === undefined) continue;
        if (deps.roster.find(connection.key) === device) continue;
        deps.credentials.revoke(device);
        connection.channel.send({
          type: "closed",
          reason: "credential_revoked",
        });
        connection.channel.close();
      }
    },
    pushRoster(roster) {
      for (const connection of connections) {
        if (connection.session === undefined) continue;
        connection.channel.send({ type: "roster", roster });
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
