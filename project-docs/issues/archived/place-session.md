# place-session (닫음)

## pre-image를 core가 읽어 두는 memory route 둘과 root별 기록

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/core/main]
closed: kept
guard: 없음
```

지금: file tool이 쓰기 전에 `StageRewindFile`로 core에게 쓰기 직전 파일 내용을 읽어 두게 하고, 쓴 뒤 `RecordRewindWrite`로 결과를 기록한다(`session/rewind/write-routes.ts`, `record.ts`의 `recordBeforeWrite`). 둘 다 memory route고 허용 폴더를 root로 기록한다. 한 단위에 허용 폴더가 둘 이상이거나 앞 기록의 after와 뒤 기록의 before가 다르면 `judge.ts`가 `chain_broken`으로 건너뛴다.

영향: route 둘, root별 기록, 판정 규칙(`chain_broken` 등 skip 사유 아홉 개)이 무겁다. 대신 agent runtime이 보낸 내용을 믿지 않고 core가 직접 읽으므로 파일 되돌리기가 틀린 내용으로 덮어쓰는 일(사용자 파일 손상)을 막는다.

고치려면: 추천: 남긴다(kept). 데이터 보호 장치라 단순화 이득이 작다. 이유를 `write-routes.ts` 머리 주석에 한 문단으로 둔다.

닫음: 남긴다. 되돌릴 때 틀린 내용으로 사람 파일을 덮지 않게 한다.

## session 되살리기(unarchive) route에 handler가 없다

```yaml
kind: defect
modules: [packages/protocol, packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: `protocol/lophn-agent/sessions.ts`에 `unarchiveSession` command가 정의되고 `registry.ts`에 등록돼 있지만 `lophn-agent/session/commands.ts`에는 archive·delete·rename만 있고 handler가 없다. UI(`agent-tab-core-source-sessions.ts`)도 부르지 않는다. architecture 문서가 이미 "archive를 풀어 다시 여는 것(되살리기)은 지금 없다. 되살리면 session 허락과 대기 request가 돌아오지 않는 규칙을 따로 정해야 한다"고 적었다. 그러니 기능 누락이 아니라 정의만 남은 죽은 route다.

영향: 계약은 있는데 동작이 없어, 쓸 수 있는 기능으로 오해하게 한다.

고치려면:
- A. route와 schema를 지운다. 비용 작다. 문서와 일치한다.
- B. 지금 짓는다. archive가 call을 닫고 허락을 버리는 것(`endSession`)을 되돌릴 수 없어, 되살린 session이 받는 것과 못 받는 것의 규칙을 먼저 정해야 한다. 비용 중간~큼.
- 추천: A. 닫힌 session은 새 session으로 이어 가는 게 지금 설계다.

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

닫음: `unarchiveSession` command와 input·compare schema, registry의 거르는 줄을 지웠다.

## 앱 place의 Operator는 file 범위가 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/main]
closed: fixed
guard: place-data_test.ts
```

지금: `run-loop/place-data.ts`의 `readPlaceData`는 project place면 role과 상관없이 project 폴더를 read·write에 넣고(Operator도 받는다), app place는 `role === "app_engineer"`일 때만 앱 `source_path`를 넣는다. 앱 place의 Operator는 scope가 비어 file tool을 쓸 폴더가 없다. `rewind-glue.ts`의 `placeFoldersOf`도 같은 이유로 `[]`를 준다. architecture 문서는 project의 Operator만 폴더를 적고 앱 place의 Operator는 말이 없다.

영향: 앱에 놓인 Operator는 grant받은 tool과 context는 쓰지만 앱 폴더 file은 읽고 쓰지 못한다. 앱 폴더 일을 맡길 수 없다.

고치려면: `place-data.ts`의 app 분기에서 `role === "app_engineer"` 조건에 operator를 더하고(`placeFoldersOf`도 같이), architecture의 file tool 줄에 앱 Operator를 적는다. 비용 작다. 다만 쓰기를 Operator에게 여는 것은 권한 결정이다.

정한 것: 앱 Operator에게 앱 source 폴더 읽기를 준다. 쓰기는 주지 않는다.

닫음: `place-data.ts`의 `appSourceScope`가 앱 place의 Operator에게 앱 source 폴더 읽기만 준다(쓰기는 App Engineer만). `rewind-glue.ts`의 `placeFoldersOf`는 쓰기 기록용이라 Operator에게 폴더를 주지 않는다.

## 숨김 구간을 `reverts.result_seq`로 잡는 규칙

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: rewind가 숨기는 구간은 `boundary_seq`부터 결과를 확정한 때의 session 마지막 메시지 순번 `result_seq`까지다(`session/rewind/hidden.ts`의 `hiddenRangesOf`, `summary-read.ts`도 같은 칸을 읽는다). 그 뒤에 접수한 메시지는 숨기지 않는다. 이유(숨김에 끝이 없으면 rewind 뒤의 대화가 모두 사라진다)는 `hidden.ts` 머리 주석에 이미 있다.

영향: 숨김 끝이 messages가 아니라 reverts 행의 `result_seq`에서 나오는 숨은 규칙이다. 이유 설명은 코드에 있어 남는 비용은 작다.

고치려면: 추천: 남긴다(kept). 주석이 이미 이유를 적었으니 별도 작업 없이 닫는다.

닫음: 숨김 끝이 reverts 행의 `result_seq`에서 나오는 규칙이지만 이유(끝이 없으면 rewind 뒤의 대화가 모두 사라진다)는 `hidden.ts` 머리 주석에 있다.

## PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/core/main, packages/core/projects]
closed: fixed
guard: packages/core/agent-roles/place/place-folders_test.ts
```

지금: file tool이 닿는 폴더(`scope`)는 turn을 시작할 때 `run-loop/prepare.ts`가 `deps.placeData`(`agent-roles/place/place-data.ts`)로 한 번 채운다. 열린 초안 폴더는 `openDraftFolders`가 그때 읽는다. Project Manager가 `context.draft`(`agent-roles/tools/context/draft.ts`의 `openDraft`)로 폴더를 새로 열어도 `ctx.scope`에는 더하지 않아, 같은 turn의 `file.write`가 scope 밖으로 거절된다. 다음 turn부터 된다. 두 번째 문제는 rewind 쪽이다. `main/daemon/rewind-glue.ts`의 `placeFoldersOf`가 따로 폴더 목록을 만드는데 Project Manager의 project 폴더와 App Engineer의 source만 있고 초안 폴더가 없다. `StageRewindFile`/`RecordRewindWrite`가 `the folder is not open to this session`으로 거절하고, `recordBeforeWrite`는 그래도 쓰기를 하되 `recorded=false`를 낸다. 초안 폴더 쓰기는 다음 turn부터도 rewind로 되돌릴 수 없다.

영향: PM이 폴더를 열고 바로 계약을 쓰지 못해 turn 하나를 헛돈다(token). 초안 파일 쓰기는 "쓴 뒤 되돌리기"가 안 되어 rewind 약속(파일 쓰기는 되돌릴 수 있다)이 이 경로에서만 깨진다.

고치려면:
- A. `openDraft`가 성공하면 `ctx.scope`의 read·write에 `folder`를 더한다(타입은 readonly지만 실체는 `prepare.ts`의 가변 배열). 한 줄이고 비용 작다.
- B. scope를 만드는 곳을 하나로 합친다. `placeFoldersOf`가 `agent-roles/place/place-data.ts`와 같은 규칙을 쓰게 해(초안 폴더와 project Operator 포함) 같은 모양의 복사본 둘을 없앤다. 비용 중간.
- 추천: A를 지금, B를 같이 한다. 폴더 목록이 둘이라 한쪽만 고치면 이번처럼 어긋난다.

닫음: `PlaceScope`에 `open(folder)`를 두고 `openDraft`가 초안 폴더를 연 뒤 부른다(`run-loop/prepare.ts`가 그 turn의 read·write에 더한다). 폴더 목록 규칙은 `agent-roles/place/place-folders.ts`의 `placeScope` 하나이고, turn scope(`place-data.ts`)와 rewind의 쓰기 폴더(`main/daemon/place-folders-glue.ts`의 `placeFoldersOf`)가 같은 것을 쓴다. rewind는 이제 PM의 열린 초안 폴더와 project Operator의 폴더를 기록한다. `rewind-glue.ts`의 사본과 직접 SQL은 지웠다(조회는 projects·apps의 `lookups.ts`).

## agent runtime process의 Deno 권한에 place 폴더가 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles]
closed: fixed
guard: packages/core/agent-roles/place/place-folders_test.ts
```

지금: file tool과 shell은 agent runtime process(`main/agent-runtime`) 안에서 돈다. 그 process의 권한은 `tools/runtime-permissions.ts`의 `agentRuntimePermissions`가 `placeFolders.read`·`write`를 `allow_read`·`allow_write`에 얹어 만들고, `supervision/security/launch-spec.ts`의 `launchArgv`가 `--no-prompt`와 `--allow-read`·`--allow-write` flag로 바꾼다. 그런데 `run-loop/runtime.ts`의 `specFor`는 늘 `placeFolders: { read: [], write: [] }`를 넘기고 다른 곳에서 채우지 않는다. turn의 `scope`(`agent-roles/place/place-data.ts`)가 폴더를 열어도 Deno 권한은 data root, skill root, socket뿐이라 `tools/file/read.ts`의 `Deno.readFile` 같은 호출은 `NotCapable`이다(같은 flag 조합으로 허락 밖 경로를 읽어 확인했다). 실제 turn을 돌려 보지는 않았다.

영향: place 폴더가 data root 밖이면 PM, project Operator, App Engineer, 앱 Operator 모두 file tool과 shell로 그 폴더를 못 읽고 못 쓴다. agent가 project 일을 하지 못한다.

고치려면: 열린 project·앱 source 폴더 목록으로 `placeFolders`를 채우고, 목록이 바뀌면 runtime을 다시 띄운다(hosts·MCP가 바뀔 때와 같은 길, 중간). 폴더 목록 만드는 곳이 `rewind-glue.ts`의 `placeFoldersOf`와 `agent-roles/place/place-data.ts`로 둘이니 같은 규칙으로 합친다(위 "PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다"와 같은 정리).

닫음: `run-loop/runtime.ts`가 `readPlaceFolders`로 Deno 권한의 place 폴더를 받는다. 조립(`wiring/lophn-agent-runtime.ts`)이 `runtimeFoldersOf`로 active project 폴더와 active 앱 source 전체의 합을 넘기고, 초안 폴더는 turn 중에 열리므로 `<data root>/projects` 상위째 쓰기를 연다. 목록이 바뀌면 hosts·MCP와 같은 1초 polling에서 child를 다시 띄운다(돌던 turn은 끊긴다). session마다의 범위는 file tool scope가 지킨다. 실제 turn으로는 확인하지 않았다(process를 건너는 확인은 E2E 몫).
