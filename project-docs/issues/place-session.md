# place-session

agent가 놓이는 place와 session의 열림·끝남·fork·rewind의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/place-session.md`.

## PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/core/main, packages/core/projects]
```

지금: file tool이 닿는 폴더(`scope`)는 turn을 시작할 때 `run-loop/prepare.ts`가 `deps.placeData`(`agent-roles/place/place-data.ts`)로 한 번 채운다. 열린 초안 폴더는 `openDraftFolders`가 그때 읽는다. Project Manager가 `context.draft`(`agent-roles/tools/context/draft.ts`의 `openDraft`)로 폴더를 새로 열어도 `ctx.scope`에는 더하지 않아, 같은 turn의 `file.write`가 scope 밖으로 거절된다. 다음 turn부터 된다. 두 번째 문제는 rewind 쪽이다. `main/daemon/rewind-glue.ts`의 `placeFoldersOf`가 따로 폴더 목록을 만드는데 Project Manager의 project 폴더와 App Engineer의 source만 있고 초안 폴더가 없다. `StageRewindFile`/`RecordRewindWrite`가 `the folder is not open to this session`으로 거절하고, `recordBeforeWrite`는 그래도 쓰기를 하되 `recorded=false`를 낸다. 초안 폴더 쓰기는 다음 turn부터도 rewind로 되돌릴 수 없다.

영향: PM이 폴더를 열고 바로 계약을 쓰지 못해 turn 하나를 헛돈다(token). 초안 파일 쓰기는 "쓴 뒤 되돌리기"가 안 되어 rewind 약속(파일 쓰기는 되돌릴 수 있다)이 이 경로에서만 깨진다.

고치려면:
- A. `openDraft`가 성공하면 `ctx.scope`의 read·write에 `folder`를 더한다(타입은 readonly지만 실체는 `prepare.ts`의 가변 배열). 한 줄이고 비용 작다.
- B. scope를 만드는 곳을 하나로 합친다. `placeFoldersOf`가 `agent-roles/place/place-data.ts`와 같은 규칙을 쓰게 해(초안 폴더와 project Operator 포함) 같은 모양의 복사본 둘을 없앤다. 비용 중간.
- 추천: A를 지금, B를 같이 한다. 폴더 목록이 둘이라 한쪽만 고치면 이번처럼 어긋난다.

## agent runtime process의 Deno 권한에 place 폴더가 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles]
```

지금: file tool과 shell은 agent runtime process(`main/agent-runtime`) 안에서 돈다. 그 process의 권한은 `tools/runtime-permissions.ts`의 `agentRuntimePermissions`가 `placeFolders.read`·`write`를 `allow_read`·`allow_write`에 얹어 만들고, `supervision/security/launch-spec.ts`의 `launchArgv`가 `--no-prompt`와 `--allow-read`·`--allow-write` flag로 바꾼다. 그런데 `run-loop/runtime.ts`의 `specFor`는 늘 `placeFolders: { read: [], write: [] }`를 넘기고 다른 곳에서 채우지 않는다. turn의 `scope`(`agent-roles/place/place-data.ts`)가 폴더를 열어도 Deno 권한은 data root, skill root, socket뿐이라 `tools/file/read.ts`의 `Deno.readFile` 같은 호출은 `NotCapable`이다(같은 flag 조합으로 허락 밖 경로를 읽어 확인했다). 실제 turn을 돌려 보지는 않았다.

영향: place 폴더가 data root 밖이면 PM, project Operator, App Engineer, 앱 Operator 모두 file tool과 shell로 그 폴더를 못 읽고 못 쓴다. agent가 project 일을 하지 못한다.

고치려면: 열린 project·앱 source 폴더 목록으로 `placeFolders`를 채우고, 목록이 바뀌면 runtime을 다시 띄운다(hosts·MCP가 바뀔 때와 같은 길, 중간). 폴더 목록 만드는 곳이 `rewind-glue.ts`의 `placeFoldersOf`와 `agent-roles/place/place-data.ts`로 둘이니 같은 규칙으로 합친다(위 "PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다"와 같은 정리).
