# tooling-checks

역량 표면(`modules`)을 건드린 새 change-log 항목에 `platform_note` 칸을 필수로 검사하고, `/update`의 `platform-notes.json`과 메모 header 규약을 검사하게 만든다.

- 단위: tooling (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/records.ts`
  - `tools/check-sdk-notes.ts`
  - `tools/records_test.ts`
  - `project-docs/flows/tests/libs-tooling.yaml`
- 읽을 것:
  - roadmap decision: `project-docs/products/roadmap/platform-update.md`
  - `packages/core/agent-workspaces/skills/migrate-sdk/` (existing `Breaking:` header convention)
- 계약:
  - 쓰는 것: `package.json` `"0.23.155"` cutoff rule (`compareVersion(version, "0.23.155") > 0 || (version === "0.23.155" && id !== "workflow-p4-host-sdk")`)
  - 내놓는 것: `records.ts check` validates `platform_note: <slug> | none`; `check-sdk-notes.ts` validates `packages/core/agent-workspaces/skills/update/platform-notes.json` & `notes/<slug>.md` when present

## 할 일

1. `tools/records.ts`: add optional `platform_note?: string` to change-log YAML validation (`"none"` or kebab-case slug `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`). Define `CAPABILITY_SURFACE_MODULES = ["packages/protocol", "packages/cli", "packages/sdk", "packages/core/agent-workspaces", "packages/core/workflows", "packages/core/lophn-agent"]`. For entries after cutoff (`version > "0.23.155"` or `version === "0.23.155" && id !== "workflow-p4-host-sdk"`) whose `modules` match any prefix in `CAPABILITY_SURFACE_MODULES`, require `platform_note`. When `platform_note !== "none"` and `packages/core/agent-workspaces/skills/update/platform-notes.json` exists, verify the slug is listed there and `notes/<slug>.md` exists.
2. `tools/check-sdk-notes.ts`: keep all existing SDK note checks intact, and when `packages/core/agent-workspaces/skills/update/platform-notes.json` exists, verify it is a JSON array of unique kebab-case note IDs, each `notes/<id>.md` exists with valid `Breaking: yes | no` and `Areas: ...` headers, and no orphaned `.md` files exist in `notes/`.
3. Add concise unit tests in `tools/records_test.ts` covering: capability module change-log entry missing `platform_note` fails, internal module without `platform_note` passes, legacy `<= 0.23.155` (`workflow-p4-host-sdk`) exempt, invalid `platform_note` slug rejected. Register `tools/records_test.ts` in `project-docs/flows/tests/libs-tooling.yaml`.

## 끝남

- `node --experimental-strip-types --test tools/records_test.ts` passes
- `node tools/records.ts check && node tools/check-sdk-notes.ts && node tools/flows.ts check` passes
- `npx tsc --noEmit -p tsconfig.node.json` passes

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
