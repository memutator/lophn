// 폰이 import하는 좁은 입구: 연결(channel), frame 모양, 초대장 모양(QR), 접속 path, key, 명단 계산. route 정의와 기기 route 목록은 끌고 오지 않는다.
// 폰 화면 bundle에 protocol 전체가 들지 않게 한다. core와 도구는 `mod.ts`를 쓴다.
export {
  connectRemote,
  REMOTE_FRAME_MAX_BYTES,
  type RemoteClientChannel,
  type RemotePeer,
  type RemoteTransport,
} from "./channel.ts";
export {
  REMOTE_PATH,
  REMOTE_PROTOCOL_MIN_VERSION,
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientFrame,
  type RemotePhone,
  type RemoteServerHello,
  type RemoteServerFrame,
} from "./frames.ts";
export {
  generateKeyPair,
  type KeyPair,
  remoteKeyBytes,
  remoteKeyText,
} from "./noise.ts";
export { relayPhoneUrl } from "./relay.ts";
export {
  mergeRoster,
  type RosterDevice,
  type RosterEntryBody,
  type RosterInvitedStatement,
  type RosterInviteText,
  rosterInviteTextSchema,
  rosterFresh,
  rosterJoinedSchema,
  rosterPending,
  type RosterReach,
  type RosterSnapshot,
  type RosterStatement,
  type RosterView,
  rosterView,
  signDetached,
  signRoster,
  verifyDetached,
  verifyRoster,
} from "./roster.ts";
