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
  skillContentHash,
  type SkillRelease,
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
// 세션 시작 summary와 Claude Code hook이다(coding-agent#T35).
export {
  assembleSessionSummary,
  CLAIM_LIMIT,
  CLAIM_RULE,
  PROBLEM_PAGE,
  REMAINING_LIMIT,
  type SessionSummaryResult,
  type SummaryReadClient,
  TICKET_PAGE,
} from "./summary.ts";
export {
  HOOK_LIMITS,
  type HookFacts,
  type HookLimits,
  type HookRead,
  renderHook,
  runSummaryHook,
  runSummaryHookBounded,
} from "./hook.ts";
