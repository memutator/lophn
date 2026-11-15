// 폰과 core 사이 암호화된 연결: Noise IK handshake, 암호화한 frame, frame schema.

export { REMOTE_ALLOWED_EVENTS, REMOTE_ALLOWED_ROUTES } from "./allowlist.ts";
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
  REMOTE_PATH,
  REMOTE_PROLOGUE,
  REMOTE_PROTOCOL_MIN_VERSION,
  REMOTE_PROTOCOL_VERSION,
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
export {
  type HostToRelay,
  hostToRelaySchema,
  RELAY_DATA_PATH,
  RELAY_HOST_PATH,
  RELAY_IDLE_TIMEOUT_MS,
  RELAY_OPEN_TIMEOUT_MS,
  RELAY_PENDING_MESSAGES,
  RELAY_PHONE_PATH,
  RELAY_PHONES_PER_HOST,
  RELAY_PING_MS,
  type RelayToHost,
  relayConnSchema,
  relayDataUrl,
  relayHostUrl,
  relayPhoneUrl,
  relayProof,
  relayToHostSchema,
} from "./relay.ts";
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
  remoteRelayStatus,
  remoteUiFile,
  remoteUiManifest,
} from "./routes.ts";
