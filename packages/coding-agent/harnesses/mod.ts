// harnesses leaf의 entry다. CLI가 부르는 감지와 설치만 내보낸다.
export {
  detectHarnesses,
  type DetectInput,
  type DetectPorts,
  discover,
  FALLBACK_DIRS as DETECTION_FALLBACK_DIRS,
  type ProbeOutput,
} from "./detect.ts";
export {
  installIntoFolder,
  type InstallPorts,
  type InstallResult,
  type SkillSource,
} from "./install.ts";
export { executableOf, runProbe } from "./system-ports.ts";
