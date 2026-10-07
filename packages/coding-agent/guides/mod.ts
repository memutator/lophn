// coding-agent/guides의 public entry다(code-map). 배포 skill의 검사·manifest·발견·설치를 내보낸다.
export {
  type CheckedSkill,
  checkSkill,
  relativeLinksOf,
  SKILL_ENTRY,
  SKILL_LIMITS,
  SKILL_NAME_PATTERN,
  type SkillCheck,
  type SkillFileInput,
  type SkillIssue,
  type SkillIssueRule,
} from "./skill-check.ts";
export {
  checkManifest,
  type ManifestIssue,
  SKILL_RELEASES,
  type SkillRelease,
  skillContentHash,
} from "./manifest.ts";
export {
  DISTRIBUTED_SKILLS_DIR,
  type DistributedSkill,
  type Distribution,
  loadDistribution,
  type RejectedSkill,
  selectSkill,
  startupDiscovery,
} from "./distribution.ts";
export {
  installSkills,
  type SkillFileResult,
  type SkillInstallResult,
  type SkillsInstallInput,
  type SkillsInstallOutcome,
} from "./install.ts";
