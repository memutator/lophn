# fix-context-pm

screens-contexts-views(`cf4304ca`)가 남긴 셋을 고친다.

1. Violations의 [Send to Project Manager]·[Send all to Project Manager]가 지금은 둘 다 그 project의 PM 탭만 연다. 위반 근거를 chip으로 실어 연다.
2. glossary의 `set_by`가 아직 `user`·`agent`다. 용어를 고치는 agent는 Project Manager뿐이니 `user`·`project_manager`로 바꾼다.
3. 복원한 Search 탭 이름이 빈다.

- 단위: screens-contexts (wave 3 고침)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/host.ts`의 `askProjectManager`, `workspace.tsx`의 그 구현(441행 근처), `kinds/context.tsx`의 `onSendViolations` 줄, `workspace/contexts/`에서 단추가 넘기는 위반 값, `workspace/reactions/project-manager.ts`의 `violationChips`(공유로 빼면)
  - `packages/shell/renderer/workspace/kinds/search.tsx`의 `SearchTab` `onTitle` 한 줄
  - 계약 `packages/protocol/projects/context-api.ts`의 `GLOSSARY_SET_BY`(lead 승인), `packages/core/projects/contexts/api/commands-glossary-rules.ts`, `contexts/ledger/schema.ts`의 `set_by` CHECK, shell wording이나 화면이 `agent` 값을 보는 줄
- 읽을 것: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`, `git show cf4304ca --stat`, `packages/shell/renderer/workspace/reactions/project-manager.ts`

## 할 일

1. `askProjectManager(chips?)`로 넓히고 `workspace.tsx`가 `openRole` 뒤 `openAgent({chips})`로 연다. 위반 chip 모양은 `violationChips`를 다시 쓴다. 줄 단추는 그 위반 하나, 전체 단추는 보이는 위반 모두.
2. `GLOSSARY_SET_BY = ["user", "project_manager"]`. core는 actor가 사람이 아니면 `project_manager`로 적고, schema CHECK를 맞춘다(개발 데이터는 지우고 새로 만든다. migration 없음).
3. `kinds/search.tsx`에 `onTitle={(title) => host.patchTab(tab.key, (c) => c.title === title ? {} : { title })}`.
4. 확인: `deno task check:full`, core 기동(같은 data root로 두 번).

## 끝남

- `deno task check:full` 통과, `grep -rn '"agent"' packages/core/projects/contexts/api/commands-glossary*.ts`가 0줄.
