# wlophn-migrate

사람의 data root가 새 판으로 이어지게 한다. 전역 `agents/lophn.md`와 `lophn` id로 저장된 것을 workspace마다의 lophn(`lophn_home`, `lophn_<prj|app id>`)으로 옮기는 data step과 ledger step을 더한다.

- 단위: wlophn (wave 1)
- 선행: wlophn-core. id 꼴과 `lophnIdOf`를 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/lophn-split.ts`(새로)
  - `packages/core/main/daemon/wiring/lophn-split_test.ts`(새로)
  - `packages/core/main/daemon/assembly.ts`
  - `packages/core/storage/migration/schema-steps.lock.json`
- 읽을 것:
  - 계획: `project-docs/plan/workspace-layers/README.md`의 정한 것(옮기는 규칙)
  - AGENTS.md "호환성"(ledger는 새 step id, 낸 step의 SQL은 고치지 않는다. data root 파일은 wiring의 `dataSteps`)
  - 본보기: `packages/core/main/daemon/wiring/workspace-data-move.ts`(`lophn.db`를 열어 workspace를 훑고 그릇 자리에 쓰는 step), `assignment-file.ts`(`openConnection`, `OLD_TABLE_STEPS`), `agent-handle.ts`
  - step 꼴: `packages/core/storage/migration/data-steps.ts`(`DataStep {id, run(root)}`, 새 root는 건너뛰고 적용으로 적는다), `main/daemon/wiring/context.ts:159`, 순서 주석 `assembly.ts:148`
- 계약:
  - 쓰는 것: `lophnIdOf`, `isLophn`(`protocol/lophn-agent/workspaces.ts`), `projectIds`(`core/projects/lookups.ts`), `appIds`(`core/apps/lookups.ts`)
  - 내놓는 것: 없음

## 할 일

1. 옮길 것을 먼저 다 찾는다: ledger에서 agent id를 담는 칸(`sessions.agent`, jobs `creator_agent`, runs, `share_requests.agents` JSON, 그 밖에 grep으로 찾은 것), `settings.json`의 call policy 규칙(`agents` 규칙의 `from`·`to`), `secrets.json`의 `mcp.lophn.*`, `mcp-oauth.lophn.*` 이름. 보고에 표로 적는다.
2. ledger step(새 step id, wiring의 `schemaSteps`로 낸다. 본보기는 `grep -rn schemaSteps packages/core`로 찾고, lock은 `schema-steps.lock.json`): workspace가 함께 적힌 행은 그 workspace의 lophn id로 바꾼다(`workspace`가 null이면 `lophn_home`). 여럿에 걸리는 값(`share_requests.agents`)은 `lophn`을 모든 lophn id로 늘린다.
3. data step(wiring `lophn-split`의 `dataSteps`): 전역 `agents/lophn.md`가 있으면 Home과 모든 project·앱(archived 포함)의 `agents/<lophn id>.md`로 복사하고 전역 file을 지운다. call policy 규칙과 secret·OAuth token 이름도 모든 lophn id로 복사한다. 이미 있는 대상 file은 덮지 않는다. 같은 root에 두 번 돌아도 결과가 같다.
4. `assembly.ts`에서 이 wiring을 기존 `agents.*`·`approvals.*` step 뒤에 둔다(그 step들이 아직 전역 lophn.md를 본다). 순서 이유를 주석에 쓴다.
5. ledger step과 data step의 순서가 맞물리는지 확인한다(data step은 schema migration 뒤에 돈다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "옛 꼴 root(전역 lophn.md에 `mcp_servers`·`apps`·본문이 있고, `lophn` session·share request·call policy 규칙·`mcp-oauth.lophn.*` token이 있는 것)를 옮기면 모든 workspace의 lophn이 같은 값을 갖고, 옛 `lophn` id가 어디에도 남지 않으며, 두 번 돌려도 같다"
- 사람의 `~/.lophn`에 돌리지 않는다. `.dev-data/` 사본으로만 돌려 본다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다. 1번의 옮길 것 표를 넣는다.
