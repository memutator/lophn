# place-session

agent가 놓이는 place와 session의 열림·끝남·fork·rewind의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/place-session.md`.

## `shell.run`이 file 범위와 rewind를 거치지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles]
```

지금: lophn을 뺀 세 role(PM, App Engineer, Operator)의 role tool에 `shell.run`이 있다(`packages/core/agent-roles/tool-lists.ts`의 `WORK_TOOLS`). `packages/core/lophn-agent/tools/shell/run.ts`의 `runShell`은 범위의 base 폴더에서 `/bin/sh`를 띄운다. 자식 process에는 agent runtime의 Deno 권한이 걸리지 않는다. OS sandbox는 없다. 판정은 shell 규칙(제품 floor·ask, Settings의 전역·project 층, `architecture/approval.md`)이 하고 effect는 `external`이다. 규칙에 걸리지 않는 명령은 묻지 않고 돈다. rewind 기록은 `file.write`·`file.edit`만 남긴다(`packages/core/agent-roles/hooks.ts`의 `FILE_HOOKS`).

영향: agent가 shell로 file 범위 밖 파일을 읽고 쓰거나 지워도 막는 것이 없다. 그렇게 바꾼 사람의 파일은 session rewind로 되돌아오지 않는다. AGENTS.md "속도"가 막으라는 agent 실수(데이터 잃기, 폴더 밖 쓰기)다. domain agent의 file 범위(PM은 project 폴더와 domain 폴더, App Engineer는 앱 source와 domain 폴더, Operator는 그릇 폴더와 고른 domain의 `artifacts/`)도 shell로는 지켜지지 않는다.

고치려면:
- 세 role의 role tool에서 `shell.run`을 뺀다. 작음. 계산이나 변환이 필요한 일은 내장 tool(`kind.list` 집계)과 domain tool로 한다.
- `shell.run`을 OS sandbox(bubblewrap 등)로 범위 폴더만 보이게 띄우고, 쓰기는 rewind 기록을 위해 막는다(읽기 전용). 중간~큼. 플랫폼마다 다르다.

추천: 첫째. 코딩은 coding agent의 일이고, domain agent에게 shell이 필요한 경우를 아직 보지 못했다.

정한 것(사람, 2026-10-19): 일단 그대로 둔다.
