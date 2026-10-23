# flow-sandbox: flow process의 sandbox 틈 셋을 막는다

- **목표:** 계획 `flow`가 알고 넘긴 틈 셋을 막는다(`project-docs/issues/workflow.md`의 세 이슈).
  - workflow 폴더 안 symlink를 따라 폴더 밖을 읽는 것
  - memory 한도가 없는 것
  - `flow.ts`가 `Deno.stdout`에 바로 써 통로를 깨는 것
- **재료:**
  - 이슈 `project-docs/issues/workflow.md`(세 항목의 "지금", "고치려면"의 추천안)
  - architecture `project-docs/architecture/workflow.md` "flow"
  - 본보기 `packages/core/apps/permissions/flags.ts`(`appFlags`의 symlink `--deny-read`)
- **범위 밖:**
  - CPU와 시간 한도. CPU는 OS 한도(`prlimit`)가 필요한데 core에 그 실행 허락이 없다. 앱의 한도를 정할 때 같이 정한다. 시간 한도는 계획 `flow`가 두지 않기로 했다(오래 도는 flow가 정상이다).
  - PM의 `shell.run`을 빼거나 sandbox에 넣기(`project-docs/issues/place-session.md`, 사람이 2026-10-19 "일단 그대로").
  - `Deno.stdout.writable` stream. 실수로 부를 만한 길은 `write`와 `writeSync`다.
- **돌리는 방식:** worker(`sonnet-high`) 하나. task id는 `fs-`로 시작한다.
- **시작 조건:** 없다. 다른 열린 계획과 소유가 겹치지 않는다(`packages/core/main/flow-host`, `packages/sdk/flow`).

## 정한 것

이슈의 추천안을 따른다(agent, planner).
- **symlink:** launch 때 workflow 폴더를 훑어 실제 경로가 폴더 밖인 symlink마다 `--deny-read=<그 lexical 경로>`를 더한다. `appFlags`와 같은 꼴이고 훑기는 host가, flag 만들기는 순수 함수가 한다. 훑기와 launch 사이에 새로 생긴 link는 막지 못한다(앱과 같은 한계).
- **memory:** `--v8-flags=--max-old-space-size=512`. flow는 agent와 앱 tool을 부르는 순서를 짜는 code라 512 MiB면 넉넉하다. 넘으면 process가 죽고 `program_exited` 줄에 끝 code와 stderr가 남는다. PM skill `guide-workflows`와 SDK `guide.md`에 한도를 적는다.
- **stdout:** `entry.ts`가 SDK 통로가 쓸 `Deno.stdout.write`를 먼저 잡아 둔 뒤, `flow.ts`를 import하기 전에 `Deno.stdout`의 `write`와 `writeSync`를 stderr로 돌린다. `console`을 돌리는 자리와 같다.

## 위험 test

- `flags_test.ts`에 줄을 더한다: 폴더 밖을 가리키는 symlink가 `--deny-read`로 나오고, memory flag가 늘 있다. 순수 함수만 본다. process를 띄우지 않는다.

## lead가 할 일

- merge 뒤 세 이슈를 `issue` skill대로 archived로 닫는다.
- 다 끝나면 `project-docs/architecture/workflow.md` "flow"의 sandbox 문장, changelog 열린 판 `project-docs/products/change-log/0.8.0.md`의 항목, 계획 폴더 지우기.
- 사람에게 묻는 것: AGENTS.md "사람에게 묻는 것" 전부, subprocess·Worker·서버·브라우저를 띄우는 새 test. 그 밖은 planner에게 묻는다.
