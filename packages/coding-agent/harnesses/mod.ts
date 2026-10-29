// harnesses leaf의 entry다. CLI가 부르는 감지, 설치, 지우기만 내보낸다.
export { detectHarnesses, discover, type ProbeOutput } from "./detect.ts";
export { installGlobal, type InstallPorts } from "./install.ts";
export { uninstallGlobal } from "./uninstall.ts";
export { executableOf, runProbe } from "./system-ports.ts";
