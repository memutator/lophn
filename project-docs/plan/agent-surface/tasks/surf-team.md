# surf-team

session에 `spawned_by`를 남기고 `team spawn|read|end` 명령, 규칙 세 줄, 상한, `team_changed` notice를 더한다. 같은 workspace의 자식은 부모 옆 group에 열린다.

- 단위: surf (wave 2)
- 선행: surf-queue
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/team.ts`(새 file), `packages/protocol/lophn-agent/{agent-sessions,input-tags}.ts`
  - `packages/cli/commands/team.ts`(새 file)
  - `packages/core/lophn-agent/session/{model.ts,team-commands.ts,commands.ts}`(`team-commands.ts`는 새 file)
  - `packages/core/storage/migration/schema-steps.lock.json`(끝에 한 줄)
  - `packages/core/lophn-agent/workspaces/{lifecycle,directory}.ts`, `packages/core/lophn-agent/workspaces/workspaces_test.ts`
  - `packages/core/router/{ports,model,router,commands,reads}.ts`, `packages/core/router/{router_test,commands_test}.ts`
  - `packages/core/lophn-agent/prompt-assembly/{basis,turn-prompt}.ts`
  - `packages/core/agent-workspaces/workspace/workspace-data.ts`
  - `packages/core/config/setting-declarations.ts`
  - `packages/core/main/daemon/wiring/router.ts`
  - `packages/coding-agent/skills/lophn-agent.ts`
- 읽을 것:
  - `project-docs/plan/agent-surface/README.md`, `project-docs/products/roadmap/agent-surface.md`("팀 = spawn tree", "규칙 세 줄", "연락처와 소통", 정한 것 1·2·6·7·8·9)
  - architecture: `project-docs/architecture/{agent-call,agent-definition,workspace-session}.md`
  - boundary: `project-docs/boundary-catalog.yaml`의 `router`
  - 본보기(불변 칸 + trigger): `packages/core/lophn-agent/session/model.ts`의 step `lophn-agent.sessions.called-from`과 `AgentSessionRow`·`SESSION_COLUMNS`·`sessionRowOf`
  - step 등록: `packages/core/storage/migration/migrations.ts`(id·hash 대조), `packages/core/main/daemon/schema-steps_test.ts`(hash 찍는 법)
  - 끝내기: `packages/core/lophn-agent/workspaces/lifecycle.ts`의 `endSession`, `packages/core/lophn-agent/session/commands.ts`의 archive handler
  - Router: `packages/core/router/router.ts`의 `route()`, `policyRefusal`, `refusal()`, `Router.open`; `packages/core/router/reads.ts`의 `sendableRead`
  - notice: `packages/core/lophn-agent/prompt-assembly/{basis,turn-prompt}.ts`(`SeenBasis`, `diffBasis`, `noticesOf`), `packages/protocol/lophn-agent/input-tags.ts`(`NOTICE_KINDS`)
  - 설정: `packages/protocol/lophn-agent/call-policy.ts`, `packages/core/config/setting-declarations.ts`, `packages/core/main/daemon/wiring/router-registration.ts`(writer Worker가 call마다 읽는 법), `packages/core/lophn-agent/run-loop/limits.ts`
  - surf-queue가 내놓은 `HostQueue` port(`packages/core/host-queue/`)
- 계약:
  - 쓰는 것: surf-queue의 `HostQueue.openTab`, `tab_open` 요청의 `place: "group"`과 `source`.
  - 내놓는 것:
    - ledger step `lophn-agent.sessions.spawned-by`: `sessions.spawned_by`(nullable, session id, 바꾸지 못하게 trigger). 이미 낸 step의 SQL은 고치지 않는다.
    - session 출력(`workspaceSessionObject`)에 `spawned_by`.
    - 명령: `lophn team spawn <agent> [--workspace <ws>] --body <text> [--reply none|result|conversation] [--image <path>]` → `{session, call}`. `lophn team read` → `{parent, siblings[], children[]}`(각 `{session, agent, name, description, runtime, state}`). `lophn team end <ses>` → `{ended: Id<"ses">[]}`.
    - 설정 `lophn-agent.team`: `{max_members: 16, max_depth: 3}`(기본값). 넘으면 `conflict`.
    - notice kind `team_changed`, 고정 글 "Your team changed. Run `lophn team read` to see it."

## 할 일

1. **ledger.** `conversationSchemaSteps` 끝에 step `lophn-agent.sessions.spawned-by`를 더한다(`called_from` step과 같은 꼴: nullable 칸 + `before update of spawned_by` trigger). lock file 끝에 `{id, sha256}`를 더한다. row·칸 목록·출력에 `spawned_by`를 더한다. 옛 session은 null(팀 밖)이라 data를 옮길 일이 없다.
2. **spawn.** `RouteInput`에 `spawn: true`를 더하고, `Router.open`이 그때 `directory.open`에 `spawnedBy: from.session`을 넘긴다(`startSession` 입력과 `SessionDirectory.open` port에 칸 추가). `team spawn` 명령은 `sendCallCommand`처럼 `route`를 `to: {agent, workspace}`, `spawn: true`로 부른다. 받는 곳 풀기, workspace call policy(`policyRefusal`), 명함 검사(`refusal`)는 그대로 거친다. 부모는 입력으로 받지 않고 자격의 session이다(규칙 1이 구조로 선다). 지금 `call.send`의 `to: {agent, workspace}` 새 session은 `spawned_by`가 없다(정한 것 6). `wiring/router.ts`의 본문 준비(redact·blob) 목록에 `team spawn`을 더한다.
3. **상한.** core는 desk를 모른다(layout은 renderer만). 그래서 "desk당 팀원 수"는 "root(조상 중 `spawned_by`가 null인 session) 아래 열린 자손 수"로 센다. 새 자식의 깊이(root 0)가 `max_depth`를 넘거나 자손 수가 `max_members`에 닿으면 `conflict`. recursive CTE 한 번이다. 설정은 `call_policy`처럼 선언하고 handler가 data root 설정 file에서 읽는다. 키가 없으면 기본값이라 data step은 없다. desk는 root가 있는 자리라 같은 뜻이다(사람 확인, 2026-11-08).
4. **규칙 2(Router).** `TargetSession`에 `spawned_by`를 더하고, `route()`에서 `policyRefusal` 뒤에 `teamRefusal`을 둔다. 보낸 session S에 `spawned_by`가 없으면 통과. 있으면 받는 T가 S의 부모, 형제(같은 `spawned_by`), S의 자손일 때만 통과하고 아니면 `forbidden`. member가 `to: {agent, workspace}`로 새 session을 여는 call도 그 session이 팀 밖이라 막힌다. `team spawn`은 자식을 여는 것이라 이 검사 대상이 아니다. 사람 메시지·program 입력·`reply`·`cancel`은 지금 그대로다. `sendableRead`(`session list`)도 member에게는 같은 집합만 보인다.
5. **규칙 3(`team end`).** 새 agent 명령. 대상이 caller의 엄격한 자손이 아니면 `forbidden`. 대상과 그 밑을 잎부터 archive처럼 닫는다(`lifecycle='archived'` + `endSession`). `ArchiveSession`(사람만)은 그대로 둔다. `wiring/router.ts`의 `receiver_ended` 글 준비 목록에 이 명령을 더한다.
6. **`team read`.** caller의 부모, 형제, 자식(열린 것)의 handle·이름·description·runtime·상태. 팀 밖 session은 빈 목록이다.
7. **`team_changed`.** 연락처는 system prompt에 싣지 않는다. `SeenBasis`에 `team`(부모·형제·자식의 `ses_id handle` 줄. 상태는 넣지 않아 깜빡이지 않는다)을 더하고 `noticesOf`가 바뀌면 고정 글 하나를 붙인다. queue에 입력으로 넣지 않는다(입력 하나가 turn 하나라 쉬던 형제를 깨운다). 그래서 그 session의 다음 turn에 닿는다. bare runtime은 `agents`처럼 빈 목록이다.
8. **자식 탭.** spawn이 commit된 뒤, 자식이 부모와 같은 workspace면 `HostQueue.openTab({opener: 부모, workspace, target: {session: 자식}, place: "group", source: 부모})`. 다른 workspace면 열지 않는다(agent 탭은 자기 workspace 창에만 그려진다).
9. **skill.** `packages/coding-agent/skills/lophn-agent.ts`에 `team spawn|read|end` 절을 짧게 더하고 CLI help와 같은 말로 맞춘다. 이 skill은 harness agent용이고 앱 agent 지침이 아니라 `sdk-note`(migrate-sdk 메모)는 해당하지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`router_test.ts`, `workspaces_test.ts`): "member가 팀 밖 session에 call하면 `forbidden`이다", "형제의 자식을 끝내면 `forbidden`이다", "`max_members`·`max_depth`를 넘는 spawn은 `conflict`이고 session이 남지 않는다", "`call.send`의 새 session에는 `spawned_by`가 없다". 이것으로 충분하다.
- 남지 않음: `grep -rn "spawned_by" packages`에 schema·row·Router·read 말고 쓰이지 않는 정의가 없다.

## 보고

brief-template의 보고 꼴. 등록할 것(`packages/protocol/lophn-agent/{mod,registry}.ts`, `packages/cli/commands/mod.ts`, `packages/core/lophn-agent/register.ts`의 command 목록, `packages/core/main/daemon/wiring/setting-declarations.ts`)을 적는다. 사람이 부모를 archive할 때 자식이 남는 것은 지금 그대로 두고(cascade 없음) 보고한다.
