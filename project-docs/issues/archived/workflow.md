# workflow (닫음)

## flow process가 workflow 폴더 안 symlink를 따라 폴더 밖을 읽는다

```yaml
kind: bug
modules: [packages/core/main]
closed: fixed
guard: packages/core/main/flow-host/flags_test.ts의 test "flow flags deny reading outside symlinks and always cap memory"
```

지금: `packages/core/main/flow-host/flags.ts`의 `flowFlags`는 `--allow-read=<workflow 폴더>,<data>/sdk` 하나만 준다. 앱의 `appFlags`(`packages/core/apps/permissions/flags.ts`)처럼 폴더 안 symlink마다 `--deny-read=<그 lexical 경로>`를 더하지 않는다. Deno는 허락한 폴더 안의 symlink를 따라가므로 폴더 밖을 가리키는 link가 있으면 flow가 그 대상을 읽는다. link를 만드는 길은 PM의 `shell.run`이다(`packages/core/agent-roles/tool-lists.ts`의 `WORK_TOOLS`, OS sandbox 없음, `project-docs/issues/place-session.md`). flow process 자신은 쓰기 허락이 없어 link를 만들지 못한다.

영향: PM이 workflow 폴더에 밖을 가리키는 link를 두면, AI가 짠 `flow.ts`가 그 대상(사람의 파일, data root의 다른 project)을 읽어 `agent`·`tool` 입력이나 report 글로 내보낼 수 있다. 쓰기와 네트워크는 여전히 막혀 있다. PM이 `shell.run`으로 직접 읽는 것과 범위는 같다.

고치려면:
- launch 때 workflow 폴더를 훑어 실제 경로가 폴더 밖인 symlink마다 `--deny-read=<lexical 경로>`를 더한다. `appFlags`와 같은 꼴이다. 작음. 훑기와 launch 사이에 새로 생긴 link는 막지 못한다(앱의 `permissions.limit.symlink-changes`와 같은 한계).
- `shell.run`을 빼거나 sandbox에 넣는 일(`place-session.md`)이 정해지면 link를 만드는 길이 닫힌다. 큼.

추천: 첫째. flags 순수 함수와 그 위험 test(`flags_test.ts`)에 줄 하나를 더하는 크기다.

닫음: `packages/core/main/flow-host/host.ts`의 `launch`가 `flowArgv` 전에 workflow 폴더 전체를 훑어(`packages/core/apps/permissions/mod.ts`의 `realPathResolver`의 `linksIn`, 앱과 같은 것) 실제 경로가 폴더 밖이거나 풀리지 않는 link를 모으고, `packages/core/main/flow-host/flags.ts`의 `flowFlags`가 그 lexical 경로들로 `--deny-read`를 더한다(쉼표·제어 문자는 `ONE_ITEM`으로 거절). 훑기와 launch 사이에 새로 생긴 link는 막지 못한다(앱과 같은 한계, `project-docs/architecture/workflow.md` "flow").

## flow process에 CPU·memory·시간 한도가 없다

```yaml
kind: bug
modules: [packages/core/main]
closed: fixed
guard: packages/core/main/flow-host/flags_test.ts의 test "flow flags deny reading outside symlinks and always cap memory"
```

지금: `packages/core/main/flow-host/host.ts`의 `launch`는 `spawnProcess`로 `deno run`을 띄울 뿐 `--v8-flags=--max-old-space-size`나 시간 한도를 두지 않는다. 시간 한도는 brief가 일부러 두지 않았다(오래 도는 flow가 정상이다). 멈추는 길은 사람의 `StopWorkflow`뿐이다. 앱 process도 CPU·RSS 한도가 없고 화면에 그 한계를 알린다(`packages/core/apps/permissions/flags.ts`의 `permissions.limit.cpu`, `permissions.limit.rss`). flow에는 그런 안내도 없다.

영향: AI가 짠 `flow.ts`가 끝없는 loop에 빠지거나 memory를 계속 늘리면, 사람이 화면에서 멈출 때까지 사람의 기계에서 CPU 하나와 memory를 잡는다. job이 밤에 시작한 flow면 아무도 보지 않는 동안 그렇다.

고치려면:
- `flowFlags`에 `--v8-flags=--max-old-space-size=<MiB>`를 더한다. 넘으면 process가 죽고 `program_exited` 줄에 끝 code와 stderr가 남는다. 작음.
- CPU 시간은 OS 한도(`prlimit`)가 필요하고 core는 그 실행 허락이 없다. 큼. 앱과 같이 다룬다.

추천: memory 한도만 먼저 둔다. CPU와 시간은 앱의 한도를 정할 때 같이 정한다.

닫음: `flowFlags`가 `--v8-flags=--max-old-space-size=512`를 늘 더한다. 넘으면 process가 죽고 `program_exited` 줄에 끝 code와 stderr 끝이 남는다. 시간 한도는 두지 않는다(오래 도는 flow가 정상이고 멈추는 길은 `StopWorkflow`다). CPU 한도는 남은 문제라 열린 이슈 "flow process에 CPU 한도가 없다"로 옮겼다.

## flow code가 `Deno.stdout`에 바로 쓰면 process가 죽는다

```yaml
kind: bug
modules: [packages/sdk, packages/core/main]
closed: fixed
guard: 없음
```

지금: flow process의 stdout은 core와의 JSON 줄 통로다. `packages/sdk/flow/entry.ts`는 `console.log` 등만 stderr로 돌리고 `Deno.stdout`은 그대로 둔다. `flow.ts`나 그것이 import한 file이 `Deno.stdout.write`·`Deno.stdout.writable`로 쓰면 그 줄이 JSON이 아니어서 `packages/core/main/flow-host/channel.ts`의 `readRequests`가 `bad("line is not JSON")`을 부르고, host가 process를 끝낸다. 끝 stderr 줄에 `[lophn] channel closed: line is not JSON`이 남는다. SDK의 `guide.md`와 PM의 `guide-workflows` skill에는 쓰지 말라는 줄만 있다.

영향: flow가 중간에 끝나 앞서 한 앱 tool 호출만 남고 뒤 step은 돌지 않는다. PM은 끝 줄을 읽어야 이유를 안다.

고치려면:
- `entry.ts`가 SDK 통로가 쓸 `Deno.stdout.write`를 먼저 잡아 둔 뒤, `flow.ts`를 import하기 전에 `Deno.stdout`의 `write`·`writeSync`를 stderr로 돌린다(`console`과 같은 자리). 작음. `Deno.stdout.writable` stream까지 돌리려면 조금 더 든다.
- 그대로 두고 문서로만 알린다. 지금 상태다.

추천: 첫째의 `write`·`writeSync`만. 실수로 부를 만한 길은 그 둘이다.

닫음: `packages/sdk/flow/wire.ts`가 module을 읽을 때 원래 `Deno.stdout.write`를 잡아 두고 통로는 그것만 쓴다. `packages/sdk/flow/entry.ts`는 `wire.ts`를 먼저 import한 뒤, `flow.ts`를 import하기 전에 `Deno.stdout.write`·`writeSync`를 stderr로 돌린다(`console`과 같은 자리). `Deno.stdout.writable` stream은 돌리지 않는다(실수로 부를 만한 길이 아니다). 진짜 flow process를 띄우는 test는 두지 않았다.
