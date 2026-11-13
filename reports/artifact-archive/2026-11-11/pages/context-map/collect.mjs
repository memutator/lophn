// 역할별 맥락 지도의 data를 모은다. 저장소는 읽기만 한다.
// 실행: node collect.mjs  → data/latest.json
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "/home/pyosechang/projects/lophn";
const LOPHN_SKILLS = "/home/pyosechang/.lophn/projects/prj_01m664qk6c68vbvb5br15dr7dt/skills";
const HERE = dirname(fileURLToPath(import.meta.url));

const YAML = createRequire(join(REPO, "package.json"))("yaml");
const registry = YAML.parse(readFileSync(join(REPO, "project-docs/context-component-registry.yaml"), "utf8"));

const git = (...args) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
const read = (p) => (existsSync(join(REPO, p)) ? readFileSync(join(REPO, p), "utf8") : "");

const agentsMd = read("AGENTS.md");
const workerPrompt = read("project-docs/plan/tools/lead/prompt.py");
const allPaths = registry.components.map((c) => c.path);

// 폴더 크기: git이 아는 file(추적 + 무시되지 않은 새 file)만 더한다.
// 다른 조각이 더 좁은 path로 가진 file은 그 조각의 것이라 빼서 두 번 세지 않는다.
// plan과 task-brief는 path가 같다. brief는 `<계획>/tasks/` 아래 file이라 그것만 task-brief로 센다.
const isBrief = (f) => /^project-docs\/plan\/[^/]+\/tasks\//.test(f);

function measure(path, id) {
  const abs = join(REPO, path);
  if (!existsSync(abs)) return { bytes: 0, files: 0, missing: true };
  if (!path.endsWith("/")) return { bytes: statSync(abs).size, files: 1 };
  const narrower = allPaths.filter((p) => p !== path && p.startsWith(path));
  const list = git("ls-files", "-co", "--exclude-standard", "-z", "--", path).split("\0").filter(Boolean);
  let bytes = 0;
  let files = 0;
  for (const f of list) {
    if (narrower.some((n) => (n.endsWith("/") ? f.startsWith(n) : f === n))) continue;
    if (path === "project-docs/plan/" && (id === "task-brief") !== isBrief(f)) continue;
    if (!existsSync(join(REPO, f))) continue;
    bytes += statSync(join(REPO, f)).size;
    files += 1;
  }
  return { bytes, files };
}

// 이 조각이 agent에게 닿는 길.
function delivery(c) {
  if (c.path === "AGENTS.md") return "auto-all"; // 세 harness 모두 root에서 자동으로 읽는다
  if (c.id === "worker-prompt") return "handed"; // lead가 찍어 worker에게 그대로 넘긴다
  if (c.path.startsWith(".claude/skills/")) return "claude-only"; // Claude Code만 skill로 불러온다
  return "path"; // 누가 경로를 알면 읽는다
}

const skillName = (c) => c.path.replace(/^\.claude\/skills\//, "").replace(/\/$/, "");

const components = registry.components.map((c) => {
  const size = measure(c.path, c.id);
  const isSkill = c.path.startsWith(".claude/skills/");
  return {
    id: c.id,
    kind: c.kind,
    roles: c.roles,
    description: c.description,
    path: c.path,
    folder: c.path.endsWith("/"),
    ...size,
    entry_bytes: isSkill && existsSync(join(REPO, c.path, "SKILL.md")) ? statSync(join(REPO, c.path, "SKILL.md")).size : null,
    delivery: delivery(c),
    // AGENTS.md가 경로를 적거나(문서 표) skill 이름을 부르는가: 다른 harness가 이 조각을 찾을 실마리.
    agents_md: c.path === "AGENTS.md" ? null : isSkill ? (agentsMd.includes(`\`${skillName(c)}\``) ? "name" : null) : agentsMd.includes(c.path.replace(/\/$/, "")) ? "path" : null,
    worker_prompt: c.id === "worker-prompt" ? null : workerPrompt.includes(c.path.replace(/\/$/, "")) || (c.id === "task-brief" && workerPrompt.includes("tasks/")),
  };
});

// 등록되지 않은 Claude Code skill 폴더도 드러낸다.
const claudeSkillDirs = readdirSync(join(REPO, ".claude/skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const registeredSkills = components.filter((c) => c.path.startsWith(".claude/skills/")).map(skillName);

const out = {
  collected_at: new Date().toISOString(),
  commit: git("log", "-1", "--format=%h %cI").trim(),
  roles: registry.roles,
  components,
  facts: {
    claude_md: existsSync(join(REPO, "CLAUDE.md")),
    agents_skills_dir: existsSync(join(REPO, ".agents/skills")),
    opencode_skills_dir: existsSync(join(REPO, ".opencode/skills")),
    lophn_project_skills: existsSync(LOPHN_SKILLS) ? readdirSync(LOPHN_SKILLS).length : 0,
    unregistered_claude_skills: claudeSkillDirs.filter((s) => !registeredSkills.includes(s)),
  },
};

mkdirSync(join(HERE, "data"), { recursive: true });
writeFileSync(join(HERE, "data/latest.json"), JSON.stringify(out, null, 1));
console.log(`components ${components.length}, at ${out.collected_at}`);
