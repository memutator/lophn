export { type DataRoot, resolveDataRoot } from "./data-root.ts";
export {
  readUpdatePackage,
  type UpdateNotice,
  updateNotice,
  type UpdatePackage,
} from "./update.ts";
export {
  acquireInstanceLock,
  INSTANCE_LOCK_NAME,
  type InstanceLock,
} from "../../base/install/instance-lock.ts";
export { removeRunMetadata, writeRunMetadata } from "./run-metadata.ts";
export {
  type CredentialSocket,
  serveCredentialSocket,
  unixProtectedChannel,
} from "./credential-channel.ts";
export {
  CREDENTIAL_SOCKET_NAME,
  credentialSocketPath,
  relayCredential,
} from "./credential-helper.ts";
export {
  checkRunningSandbox,
  checkSandboxFile,
  linuxProcReader,
} from "./sandbox-check.ts";
export {
  cliLauncher,
  credentialLoaderIdentity,
  debControl,
  denoCacheDir,
  desktopEntry,
  LINUX_INSTALL_ROOT,
  LINUX_LAUNCHERS,
  linuxInstallLayout,
  mcpLauncher,
  postinstScript,
} from "../../base/install/linux-install.ts";
