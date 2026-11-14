// 폰이 import하는 좁은 입구: 연결(channel), frame 모양, key. route 정의와 기기 route 목록은 끌고 오지 않는다.
// 폰 화면 bundle에 protocol 전체가 들지 않게 한다. core와 도구는 `mod.ts`를 쓴다.
export {
  connectRemote,
  REMOTE_FRAME_MAX_BYTES,
  type RemoteClientChannel,
  type RemotePeer,
  type RemoteTransport,
} from "./channel.ts";
export {
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientFrame,
  type RemoteHello,
  type RemoteServerFrame,
} from "./frames.ts";
export {
  generateKeyPair,
  type KeyPair,
  remoteKeyBytes,
  remoteKeyText,
} from "./noise.ts";
