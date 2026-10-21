# code-health

여러 module에 걸친 코드 건강 이슈다(죽은 이름, 긴 파일, test 준비 코드). 짝이 되는 architecture 문서는 없다.

## test runner를 지운 뒤 test 자식의 갈래가 남았다

```yaml
kind: defect
modules: [packages/protocol, packages/core/apps, packages/sdk, packages/core/server, packages/core/supervision, packages/shell/main, packages/core/storage, packages/core/main]
```

지금: test runner(옛 `problems` module)를 지웠는데 그것만 쓰던 갈래가 남았다. 켜는 곳은 없다.
- 앱 runtime mode `"test"`: `packages/protocol/apps/channel-values.ts`의 `runtimeModeSchema`, `packages/core/apps/runtime/entrypoint/`(`start-input.ts`, `wire.ts`, `state.ts`, `cap-host.ts`, `broker-client.ts`), `packages/sdk/cap-net/host.ts`, `packages/sdk/cap-secret/host.ts`
- data job kind `"test"`: `packages/protocol/apps/activation/data-job.ts`
- identity의 `test_runner_only`(`packages/core/server/identity/model.ts`)와 `test_runner`(`packages/core/server/identity/registry.ts`)
- 메모리 상한 `applyMemoryLimit`(`packages/core/supervision/security/memory-limit.ts`, `mod.ts`의 export만 남음)와 shell main이 core에 주는 `--allow-env`의 `DBUS_SESSION_BUS_ADDRESS`(`packages/shell/main/desktop/core/supervise.ts`)
- team 등록의 `workers` 칸(`packages/core/storage/ledger/team-module.ts`)과 그것을 늘 빈 Map으로 모으는 `packages/core/main/daemon/core.ts`

영향: 읽는 사람과 agent가 test 자식이 아직 있는 줄 안다. 권한 판정(`test_runner_only`)과 runtime mode의 갈래가 늘 죽은 채 검토와 고칠 일에 끼고, core가 쓰지 않는 env를 받는다.

정한 것: 지운다(잃는 기능이 없는 죽은 코드다. AGENTS.md "속도"). 크기는 작음. runtime mode는 `"live" | "preview"`만 남고, `DBUS_SESSION_BUS_ADDRESS`를 빼도 `XDG_RUNTIME_DIR`은 앱 socket 폴더가 쓰므로 둔다.

