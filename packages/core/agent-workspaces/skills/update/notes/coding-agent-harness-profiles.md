# Coding agent harness_config profiles and custom agent maintenance

Breaking: no
Areas: agent, project, home

Coding agent definitions now support per-agent `harness_config` profiles (model
and option axes) across supported harness runtimes, and `runtime: custom` agent
instructions can be maintained consistently across Home, projects, and apps.

## What is newly possible

- **Per-agent `harness_config` profiles**: custom harness agent definitions
  (`claude-code`, `codex`, `opencode`, `omp`, `antigravity`) can pin a specific
  `harness_config` (`{ model?, options? }`) launch profile instead of sharing a
  single CLI default. `AgentCard` exposes the configured `model` and `options`
  so coordinators can pick between fast and deep profiles on the same harness.
- **Scoped maintenance of `runtime: custom` agents**: custom agents do not load
  built-in lophn prompts—they rely on their definition body. Home lophn updates
  global custom agent definitions with `agent.update`, while project and app
  lophn agents maintain definitions scoped to their own workspace.
- **Unified follow-ups**: workspace updates and deletion/contract cascades track
  unfinished items in `lophn follow-up list` and close them with
  `lophn follow-up report`.

## When to adopt

Only propose profile or instruction updates when the workspace already has
existing custom agents (`custom_agents > 0`) or coding agent definitions
(`harness_agents > 0`) that would benefit from a dedicated model/effort profile
or refreshed instructions. Otherwise do not ask—mention it in the one-line
summary at the end of `/update`.

## Instruction diff

Check existing `runtime: custom` agent definitions, `memory.md`, and generated
skills for obsolete instructions (such as referencing the old app-only update
skill, `lophn app sdk-feature`, or pre-activation public-command consensus, or
assuming all harness agents share one fixed model/effort):

- Update global custom agents from Home with `agent.update`, and hand
  project/app-scoped custom agents to their workspace's lophn.
- Edit agent-owned `memory.md` (`agent.memory`) and generated skills directly
  and report what changed.
- For person-owned `LOPHN.md`, propose edits only; never edit it directly.
