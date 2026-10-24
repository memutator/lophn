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

## agent runtime child의 Deno 권한 좁히기가 경계가 아닌데 깨지고 무겁다

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/core/main, packages/core/supervision]
```

지금:
- `packages/core/lophn-agent/tools/runtime-permissions.ts`의 `agentRuntimePermissions`가 agent runtime child(`main/agent-runtime`)의 권한을 좁힌다. `allow_read`는 data root, 내장·등록 skill 폴더, 앱 socket, place 폴더이고 `allow_write`는 `<data>/derived/lophn-agent`, socket, place 쓰기 폴더다. `allow_run`은 MCP stdio 실행 파일과 `/bin/sh`이고 net은 `net_any`다. `register.ts`의 `agentRuntimeLaunchSpec`이 이 결과를 launch spec에 싣고 `supervision/security/launch-spec.ts`의 `launchArgv`가 `--allow-read=...` 같은 flag로 바꾼다. launch spec은 dev와 packaged가 같은 경로다(`launchArgv`를 쓰는 곳은 `supervision/responsiveness/run.ts` 하나이고 dev 분기는 없다). core 자신은 dev와 packaged 모두 `--allow-all`이다(`shell/main/desktop/core/supervise.ts`, 2026-10-24부터).
- place 폴더 목록은 `lophn-agent/run-loop/runtime.ts`의 `readPlaceFolders`가 받고, 조립 `main/daemon/wiring/lophn-agent-runtime.ts`가 `main/daemon/place-folders-glue.ts`의 `runtimeFoldersOf`로 채운다(active project 폴더, active 앱 source, active domain 폴더, active project의 workflows 폴더). 같은 파일의 1초 polling이 provider host, skill 폴더, MCP, place 폴더 중 하나라도 바뀌면 `io.updateSpec`으로 child를 다시 띄운다. 도는 turn이 있으면(`inbox.anyRunning()`) 다시 띄우지 않고 다음 주기에 다시 본다. 그래서 turn이 이어지는 동안은 새 폴더가 Deno 권한에 들어오지 않는다.
- 이 좁힘은 경계가 아니다. `packages/core/lophn-agent/tools/shell/run.ts`의 `runShell`은 `/bin/sh`를 사용자 uid로 띄우고(env만 `clearEnv`로 거른다) 파일 시스템 sandbox가 없다. Deno 권한 flag는 자식 process에 걸리지 않으므로 file tool에 막힌 경로도 shell로 닿는다. file tool의 폴더 범위는 이미 코드가 지킨다(`packages/core/lophn-agent/tools/file/scope.ts`의 `resolveInPlace`, 오류 "path is outside the place").
- 한 번 깨졌다. `archived/place-session.md`의 "agent runtime process의 Deno 권한에 place 폴더가 없다"는 `placeFolders`가 빈 채라 data root 밖 place 폴더를 file tool이 `NotCapable`로 못 읽었다. `readPlaceFolders`를 더해 닫았고, 그때도 실제 turn으로는 확인하지 못했다.
- 같은 종류의 좁힘이 packaged core에도 있었다(`packagedPermissionFlags`). 설치된 .deb에서 project 등록이 `projects/registry/record.ts`의 `existsSync`가 `NotCapable`을 던져 실패했고, launcher는 "wasn't registered, so nothing was saved"를 보였다. 사람이 2026-10-24에 packaged core도 dev처럼 `--allow-all`로 돌리기로 정했고 같은 날 고쳤다. dev와 test가 `--allow-all`이라 이 종류의 실패는 설치본에서만 드러난다.

영향: 사용자 데이터나 권한을 지키는 효과는 없고(shell로 우회) 깨지면 사람이 보는 동작이 막힌다. 폴더를 더하거나 바꾸는 쪽(project·앱 등록, domain 만들기, 폴더 종류 추가)마다 `placeScope`와 `runtimeFolders` 두 곳을 같이 고쳐야 하고(`architecture/place-session.md`), 한쪽만 고치면 file tool은 열렸는데 child가 `NotCapable`로 거절한다. turn이 이어지는 동안은 새 폴더가 늦게 열린다. 실제 turn으로만 드러나는 실패라 개발 비용이 크다. 이 좁힘이 막는 것은 AGENTS.md "속도"의 agent 실수가 아니라(그 실수는 file tool scope와 approval이 막는다) 우회되는 가짜 경계다.

고치려면:
- child를 `--allow-all`로 돌리고(`--no-prompt`, `--cached-only`, `--frozen`은 유지) `agentRuntimePermissions`, `readPlaceFolders`, `runtimeFoldersOf`, `runtimeFolders`와 폴더 목록이 바뀌면 다시 띄우는 polling을 지운다. 중간. `launch-spec.ts`의 `FORBIDDEN_FLAGS`가 `--allow-all`을 거절하므로 launch spec에 이 kind만 켜는 칸을 둔다(`net_any`와 같은 모양). provider host, skill 폴더, MCP net·run 목록도 권한 때문에만 다시 띄우던 것이라 같이 사라지는지 구현에서 확인한다. 고친 뒤 `architecture/place-session.md`, `artifact.md`, `kinds.md`, `domain.md`, `agent-definition.md`, `layers.md`의 child 권한 문장을 같이 고친다. 잃는 것: file tool 코드의 버그가 폴더 밖을 건드려도 Deno가 막지 못한다(shell로 이미 열려 있다).
- 좁힘을 두고 폴더 목록 버그만 고친다. 작음. 같은 종류의 실패가 폴더 종류를 더할 때마다 다시 생긴다.
- 추천: 첫째. sandbox는 AI가 쓴 코드를 돌리는 process에만 둔다: 앱 process(`apps/runtime/processes/spawn.ts`), flow process(`main/flow-host/flags.ts`), release prepare 자식(`apps/releases/prepare/from-source.ts`). `projects/kinds/host/process.ts`의 kinds worker도 같은 이유로 둔다.

정한 것(사람, 2026-10-24): agent runtime child는 `--allow-all`로 돌리고 file tool의 폴더 범위는 코드에 둔다. 구현은 아직 하지 않았다.
