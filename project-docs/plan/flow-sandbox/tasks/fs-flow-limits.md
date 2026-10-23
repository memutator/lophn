# fs-flow-limits

flow process의 sandbox에 폴더 밖 symlink의 `--deny-read`와 memory 한도를 더하고, `flow.ts`가 `Deno.stdout`에 바로 써도 통로가 깨지지 않게 한다. `project-docs/issues/workflow.md`의 세 이슈를 고친다.

- 단위: flow (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/main/flow-host/flags.ts`
  - `packages/core/main/flow-host/flags_test.ts`
  - `packages/core/main/flow-host/host.ts`
  - `packages/sdk/flow/entry.ts`
  - `packages/sdk/flow/wire.ts`
  - `packages/sdk/flow/guide.md`
  - `packages/core/agent-roles/skills/guide-workflows/SKILL.md`
  - `project-docs/architecture/workflow.md`
- 읽을 것:
  - 계획: `project-docs/plan/flow-sandbox/README.md`의 "정한 것"
  - 이슈: `project-docs/issues/workflow.md`의 세 항목
  - architecture: `project-docs/architecture/workflow.md` "flow"(sandbox, 통로)
  - 본보기: `packages/core/apps/permissions/flags.ts`(symlink를 훑어 `--deny-read`를 더하는 꼴과 그 주석), 그 test
  - 코드: `flowFlags`·`flowArgv`(`flags.ts`), `launch`(`host.ts`, `flowArgv`를 부르는 곳), `packages/sdk/flow/entry.ts`(console 돌리기), `packages/sdk/flow/wire.ts`(통로가 `Deno.stdout.write`를 쓰는 곳)
- 계약:
  - 쓰는 것: 바뀌지 않는다. protocol과 SDK의 공개 이름은 그대로다.
  - 내놓는 것: 없음.

## 할 일

1. `flags.ts`: `flowFlags`(와 `flowArgv`)가 폴더 밖 symlink의 lexical 경로 목록을 받아 `--deny-read=<경로들>`을 더한다(목록이 비면 flag 없음). 쉼표·제어 문자 검사(`ONE_ITEM`)를 그 경로에도 건다. `--v8-flags=--max-old-space-size=512`를 늘 더한다. 순서는 지금처럼 이 file 한 곳에서 정한다.
2. `host.ts`: `launch`가 `flowArgv`를 부르기 전에 workflow 폴더를 훑어 symlink마다 실제 경로(`Deno.realPath`)를 보고 폴더 밖이면 lexical 경로를 목록에 넣는다. 읽기 실패는 막는 쪽으로 다룬다(그 link를 deny에 넣는다). 훑는 깊이는 폴더 전체다.
3. `packages/sdk/flow/wire.ts`와 `entry.ts`: 지금 `wire.ts`는 줄을 보낼 때마다 `Deno.stdout.write`를 부른다. 그래서 `Deno.stdout.write`를 돌리면 통로도 같이 돌아간다. `wire.ts`가 처음 불릴 때(또는 module을 읽을 때) 원래 `Deno.stdout.write`를 잡아 두고 그것만 쓰게 한다. 그 뒤 `entry.ts`가 `flow.ts`를 import하기 전에 `Deno.stdout.write`와 `writeSync`를 stderr 쪽으로 돌린다(`console`을 돌리는 자리). 잡는 때가 돌리기보다 먼저인지 `entry.ts`의 import 순서로 확인한다.
4. `packages/sdk/flow/guide.md`와 `guide-workflows/SKILL.md`의 flow 절: memory 한도 512 MiB, 폴더 밖 symlink는 읽히지 않는다, `Deno.stdout`에 쓴 것도 stderr로 간다는 것을 한 줄씩.
5. `project-docs/architecture/workflow.md` "flow": sandbox 문장에 symlink의 `--deny-read`, memory 한도, stdout 돌리기를 맞춘다. 훑기 뒤 새로 생긴 link는 막지 못한다는 한계를 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/main/flow-host/flags_test.ts`): "폴더 밖 symlink 경로가 `--deny-read`로 나오고, `--v8-flags=--max-old-space-size=512`가 늘 있고, 쉼표가 든 경로는 거절된다." 순수 함수만 본다. process를 띄우지 않는다.
- 손으로 한 번(test로 남기지 않는다): `deno task dev`에서 `Deno.stdout.write`를 부르는 `flow.ts`가 끝까지 돌고 그 글이 log에 stderr로 남는지 본다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
