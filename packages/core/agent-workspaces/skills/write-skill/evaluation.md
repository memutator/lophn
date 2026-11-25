# Skill Evaluation & Fault Diagnosis

Use this reference when diagnosing why a skill failed, repairing a skill without accumulating sediment, or running blind behavioral tests.

## 1. Six-layer fault taxonomy (Repair / Update)

Before editing a broken skill, classify the observed failure into exactly one layer and fix **only the owning layer**:

| Layer | Symptom | Owning fix |
|---|---|---|
| `Selection` | Skill failed to trigger on an implicit request, or triggered on an unrelated task | Edit `description` (or an adjacent skill's `Not for ...` boundary). Do **not** add trigger text to the body. |
| `Instruction` | Skill loaded, but took wrong order, missed a decision, or lacked completion criteria | Edit `SKILL.md` or the relevant flat `.md` companion. |
| `Resource` | Skipped at discovery, > 24 KiB, wrong `path`, missing companion, or symlink error | Split files under 24 KiB, flatten companions, fix `skill.read` paths, remove symlinks; confirm with `lophn skill check`. |
| `Integration` | Missing app assignment, unconfigured MCP server, renamed app command, or wrong tool name | Ask the person for the assignment/secret or update to the actual current command/tool. |
| `Harness` | Evaluation prompt was ambiguous, leaked hints, or lacked fixture context | Fix the evaluation scenario, not the skill. |
| `Capability` | Task requires deterministic code, persistent storage, UI, or cross-agent orchestration | Propose moving to a Local Tool, App, or Workflow instead of stretching a skill. |

### No sediment
- Replace or delete obsolete rules directly. Never stack `UPDATE:` notes, contradictory exceptions, or changelog entries below old wording.
- Always preserve existing safety boundaries, approval checkpoints, and recovery steps unless the person explicitly asks to change them.

## 2. When to run behavioral evaluation

Skip behavioral testing for simple one-step procedures or minor copy fixes. Run it when:
1. Trigger keywords overlap with an existing skill or general tool.
2. The skill has multiple modes, branches, or companion `.md` routing.
3. A wrong execution has high side-effect or rework cost.

## 3. Build a 2–5 scenario set

Keep the set small and realistic:
1. **Explicit positive** (1): a clear request matching the skill's core job.
2. **Implicit positive** (1–2): a realistic user request that **never mentions the skill name** (never write `"use <skill>"` or `"load <skill>"`).
3. **Edge / failure case** (1): missing precondition, boundary condition, or recovery branch.
4. **Near-miss negative** (1): similar keywords, but another skill or normal tool should handle it instead.

## 4. Blind forward-testing with `lophn team spawn`

Run each scenario in a clean independent session so the spawned agent discovers the newly saved skill automatically:

```text
lophn team spawn lophn --reply result --body "<realistic request>"
```

Rules:
- **No hints**: never include the skill name, expected answer, suspected bug, or fix in the test prompt (except for an explicit-invocation check).
- **Safety boundaries**:
  - Limit evaluation scenarios to read-only tasks or a temporary directory outside the skill folder.
  - Before running any scenario that writes user files, sends external calls, deletes data, or incurs cost, ask the person for approval.
  - Keep any evaluation notes or outputs **outside** the skill folder and clean them up when done.

## 5. Grading and regression check

- Grade by **observable outcomes**, not phrasing:
  - Did the agent load the skill on positives and skip it on near-miss negatives?
  - Did it load the right companion `.md` only when that branch applied?
  - Did it satisfy the completion criteria and respect side-effect/approval boundaries?
- For Repair / Update: run the failing scenario plus at least one passing regression scenario **before and after** the edit to verify the fix without breaking existing behavior.
- Make the smallest targeted edit justified by an observed failure, re-run `lophn skill check <skill-dir>`, and stop once scenarios pass.
