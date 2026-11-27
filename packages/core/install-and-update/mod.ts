export { type DataRoot, resolveDataRoot } from "./data-root.ts";
export {
  acquireInstanceLock,
  INSTANCE_LOCK_NAME,
  type InstanceLock,
} from "./instance-lock.ts";
export {
  cliLauncher,
  debControl,
  desktopEntry,
  LINUX_LAUNCHERS,
  linuxInstallLayout,
  postinstScript,
} from "../../base/install/linux-install.ts";
export {
  platformEntry,
  platformEntryUrl,
  platformPath,
  platformRootFrom,
  platformUrl,
} from "./platform-paths.ts";
