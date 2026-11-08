# wmem

workspace memory와 agent memory를 더한다. memory tool로 쓰고, turn prompt의 지시 block 뒤에 data로 싣고, session 시작 때 고정하고, rewind로 되돌린다. 내장 prompt와 skill이 memory를 쓰게 한다.

- 단위: wmem (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/memory.ts`(새로), `packages/core/lophn-agent/tools/memory/`(새로)
  - `packages/core/lophn-agent/tools/{tool-context,ports}.ts`
  - `packages/core/main/agent-tools.ts`
  - `packages/protocol/lophn-agent/{tool-lists,input-tags}.ts`
  - `packages/core/agent-workspaces/{tool-lists,credentials,hooks}.ts`
  - `packages/core/lophn-agent/session/rewind/`
  - `packages/core/main/daemon/workspace-folders-glue.ts`
  - `packages/core/lophn-agent/prompt-assembly/{model,turn-prompt}.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/safety/fence.ts`
  - `packages/core/agent-workspaces/workspace/data-folder.ts`
  - `packages/core/agent-workspaces/prompts/{home,project,app}.md`
  - `packages/core/agent-workspaces/skills/{update-apps,migrate-sdk}/`
  - `packages/sdk/`의 판과 `migrate-sdk` 메모(sdk-note가 요구하면)
  - 위 file 옆의 `*_test.ts`
  - `project-docs/architecture/agent-definition.md`
- 읽을 것:
  - 계획: `project-docs/plan/workspace-layers/README.md`의 정한 것(memory 항목 전부)
  - roadmap: `project-docs/products/roadmap/workspace-layers.md`의 "목표 꼴" 3
  - architecture: `project-docs/architecture/agent-definition.md`(prompt 층, cache 표시, notice, tool 목록, file tool 범위와 rewind)
  - 조사: `harness-lab/_report/memory-architecture/hermes.md`(작은 memory, 상한, 넘치면 정리)
  - skill: `.claude/skills/sdk-note/SKILL.md`
- 계약:
  - 쓰는 것: `homeDataFolder`, `workspaceDataFolder(root, workspace | null)`(`wlayer`), `isLophn`(`wlophn-core`)
  - 내놓는 것: memory 자리 함수 `workspaceMemoryFile(root, workspace | null)`(`<그릇 자리>/memory.md`), `agentMemoryFile(root, agentId)`(`<data>/agent-memory/<agt_id>.md`). memory tool 이름과 입력. `wui`가 이것을 읽고 쓴다.

## 할 일

1. 자리: 위 두 함수를 `data-folder.ts`에 둔다. 파일이 없으면 빈 memory다.
2. memory tool(`defineTool`, 본보기 `tools/bundles/file.ts`의 `file.edit`, `tools/file/write.ts`): 어느 memory에 쓰는지는 부른 agent가 정한다. lophn이면 자기 workspace의 workspace memory, 사람이 만든 agent면 자기 agent memory다. 다른 파일은 고를 수 없다. 꼴은 글 덧붙이기와 바꾸기(옛 글 → 새 글) 정도로 작게 둔다. 쓴 뒤 8 KiB를 넘으면 거절하고 지금 크기를 돌려준다. effect는 `write`다.
3. tool 목록: `protocol/lophn-agent/tool-lists.ts`의 모든 workspace 종류에 더하고 `TOOL_ORDER`, `main/agent-tools.ts`에 등록한다. bare agent는 고를 때만 받는다(지금 규칙).
4. rewind: memory tool의 쓰기를 rewind에 적는다(`hooks.ts`의 `recordBeforeWrite` 길, `credentials.ts`의 `REWIND_WRITE_TOOLS`). memory 파일의 폴더를 그 session의 rewind root 목록(`workspace-folders-glue.ts` `workspaceFoldersOf` → `write-routes.ts` `foldersOf`)에 넣되, file tool 범위(`workspaceScope`)에는 열지 않는다. 둘이 같은 목록이면 나눈다.
5. 주입: system block에 `memory`를 지시 block 뒤에 더한다(`prompt-assembly/model.ts`의 layer 종류, `turn-prompt.ts`의 block 목록과 `CACHED`). `fenced()`(`prompt-assembly/summary.ts:170`)와 같은 꼴로 `~~~data`에 감싸고 출처 줄로 workspace memory와 agent memory를 나눈다. 순서는 workspace memory, agent memory다. lophn은 workspace memory 하나다. `basis`에 넣지 않아 notice가 나지 않는다.
6. session 시작 고정: `prepare.ts`의 `fixedBySession`처럼 session의 첫 turn에 읽은 memory를 고정해 이후 turn에 같은 bytes를 싣는다. daemon 재시작과 Compact 뒤에는 다시 읽는다(지금 고정값과 같다). memory tool 결과는 "다음 session부터 보인다"를 말한다.
7. 내장 글:
   - `prompts/{home,project,app}.md`: memory에 담는 것(사람이 정한 것, 계산할 수 없는 의도, "무엇을 누구에게 물으면 되나" pointer)과 담지 않는 것(정의·할당·명함, 다른 workspace의 내용), 경계를 넘을 때는 call. Home은 workspace들의 지도와 앱마다 사람 결정을 적는다. 모르는 것은 Home의 lophn에게 묻는다(project·앱).
   - `skills/update-apps/SKILL.md` 5~6단계: 묻기 전에 memory의 그 앱 결정을 보고, 이미 정한 앱은 그대로 따르며 그렇다고만 말한다. 사람이 답하면 적는다.
   - `skills/migrate-sdk/SKILL.md` 10~11단계: 같은 규칙.
   - `migrate-sdk`는 앱 agent가 읽는 지침이다. `sdk-note` skill대로 메모와 `## Instruction diff`를 쓰고 판을 정한다.
8. `agent-definition.md`에 memory 절(자리, 주인, 쓰는 길, 주입과 고정, 상한, 이유)을 더한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "사람이 만든 agent는 workspace memory와 다른 agent의 memory를 쓰지 못하고, lophn은 다른 workspace의 memory를 쓰지 못한다"(쓰기 경계)
  - "memory tool의 쓰기를 rewind하면 쓰기 전 내용으로 돌아간다"
  - "session 중 memory를 써도 그 session의 다음 turn system prompt bytes가 같다"(cache)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다.
