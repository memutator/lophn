// 폰과 core 사이 암호화된 연결: Noise IK handshake, 암호화한 frame, frame schema.
export {
  acceptRemote,
  connectRemote,
  REMOTE_FRAME_MAX_BYTES,
  type RemoteChannel,
  type RemoteClientChannel,
  type RemotePeer,
  type RemoteServerChannel,
  type RemoteTransport,
} from "./channel.ts";
export {
  REMOTE_PROLOGUE,
  REMOTE_PROTOCOL_MIN_VERSION,
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientFrame,
  type RemoteHello,
  type RemoteServerFrame,
  remoteClientFrameSchema,
  remoteDeviceSchema,
  remoteServerFrameSchema,
} from "./frames.ts";
export {
  generateKeyPair,
  type KeyPair,
  remoteKeyBytes,
  remoteKeyText,
} from "./noise.ts";
export { REMOTE_ALLOWED_EVENTS, REMOTE_ALLOWED_ROUTES } from "./allowlist.ts";
export {
  devicesConnected,
  devicesList,
  devicesRegister,
  devicesRename,
  devicesRevoke,
  devicesSetPrimary,
  pairingStart,
  REMOTE_PATH,
  type RemoteDevice,
  type RemotePairing,
  remotePairedSchema,
  remotePairingSchema,
} from "./routes.ts";
