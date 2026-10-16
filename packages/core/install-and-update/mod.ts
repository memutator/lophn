export { type DataRoot, resolveDataRoot } from "./data-root.ts";
export {
  acquireInstanceLock,
  INSTANCE_LOCK_NAME,
  type InstanceLock,
} from "../../base/install/instance-lock.ts";
export { removeRunMetadata, writeRunMetadata } from "./run-metadata.ts";
export { cliLauncher, debControl, desktopEntry, LINUX_LAUNCHERS, linuxInstallLayout, postinstScript } from "../../base/install/linux-install.ts";
