# place-session

agent가 놓이는 place와 session의 열림·끝남·fork·rewind의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/place-session.md`.

## `shell.run`이 file 범위와 rewind를 거치지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles]
```

지금: PM과 Operator의 role tool에 `shell.run`이 있다(`packages/core/agent-roles/tool-lists.ts`의 `WORK_TOOLS`). `packages/core/lophn-agent/tools/shell/run.ts`의 `runShell`은 범위의 base 폴더에서 `/bin/sh`를 띄운다. 자식 process에는 agent runtime의 Deno 권한이 걸리지 않는다. `bundles/shell.ts` 주석대로 "OS sandbox도 묻기도 없다(Gate를 거치지 않는다)". effect는 `read`로 선언되어 있다. rewind 기록은 `file.write`·`file.edit`만 남긴다(`packages/core/agent-roles/hooks.ts`의 `FILE_HOOKS`).

영향: agent가 shell로 file 범위 밖 파일을 읽고 쓰거나 지워도 막는 것이 없다. 그렇게 바꾼 사람의 파일은 session rewind로 되돌아오지 않는다. AGENTS.md "속도"가 막으라는 agent 실수(데이터 잃기, 폴더 밖 쓰기)다. project와 domain을 나누면(계획 `domain-split`) domain agent가 연결된 project의 폴더만 쓴다는 규칙도 shell로는 지켜지지 않는다.

고치려면:
- domain agent(PM, Operator)의 role tool에서 `shell.run`을 뺀다. 작음. 계산이나 변환이 필요한 일은 내장 tool(`kind.list` 집계)과 domain tool로 한다.
- `shell.run`을 OS sandbox(bubblewrap 등)로 범위 폴더만 보이게 띄우고, 쓰기는 rewind 기록을 위해 막는다(읽기 전용). 중간~큼. 플랫폼마다 다르다.
- effect를 `external`로 바꿔 Gate가 묻게 한다. 작음. 그러나 묻기로 실수를 막지 않는다는 PRODUCT 4절과 어긋난다.

추천: 첫째. 코딩은 coding agent의 일이고, domain agent에게 shell이 필요한 경우를 아직 보지 못했다.

정한 것(사람, 2026-10-19): 일단 그대로 둔다.
