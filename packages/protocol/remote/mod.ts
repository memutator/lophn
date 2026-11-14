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
  REMOTE_PATH,
  type RemoteClientFrame,
  type RemoteHello,
  type RemotePairing,
  type RemoteServerFrame,
  remoteClientFrameSchema,
  remoteDeviceSchema,
  remotePairingSchema,
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
  type RemoteDevice,
  remotePairedSchema,
} from "./routes.ts";
