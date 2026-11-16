# always-mark

**opus high.**

core에 "Keep lophn running on this computer" 표시를 둔다: `<root>/always-on.json`에 이 기계 id와 같이 적고, `always_on/status`·`always_on/set` route와 `ctx.alwaysOn`으로 내고, 기동 때 OS 등록을 표시에 맞추고(빠지면 다시 쓰고, 꺼져 있으면 지운다), 표시가 켜진 core는 idle-exit하지 않는다. OS를 실제로 만지는 것은 `startCore`의 새 칸 `alwaysOn`으로 받는 port이고 이 task는 fake로만 돈다(구현은 `always-os`, 잇기는 `always-boot`).

- 단위: always-mark (wave 1)
- 선행: 없음. 계획을 열기 전에 `machine-identity`가 main에 있어야 한다(README "열기 전에").
- 소유(이 task만 고친다):
  - `packages/protocol/always-on`(새 폴더 전체)
  - `packages/core/always-on/{mod,ports,state}.ts`(새 file. 같은 폴더의 `os/`는 `always-os`의 것이다)
  - `packages/core/always-on/always-on_test.ts`(새 file)
  - `packages/core/main/daemon/wiring/always-on.ts`(새 file)
  - `packages/core/main/daemon/wiring/idle.ts`
  - `packages/core/main/daemon/core.ts`
  - 한 줄씩 허락(공유 file이라 소유 목록에 넣지 않는다. 한 줄만 더하고 "넘길 줄"에 적는다): packages/core/main/daemon/wiring/context.ts의 Late 칸 `alwaysOn`과 `LATE_KEYS`, packages/core/main/daemon/assembly.ts의 import와 `WIRINGS`(`idleWiring` 바로 앞), packages/protocol/registry.ts의 `ROUTES`, project-docs의 module-catalog.yaml(path packages/core/always-on과 packages/protocol/always-on 항목)과 boundary-catalog.yaml(`always-on`), project-docs/flows의 이 task 줄
- 읽을 것:
  - 계획: `project-docs/plan/always-on/README.md`의 "정한 것"과 "다른 계획이 기대는 계약" 1·2·3
  - architecture: `project-docs/architecture/platform.md`의 "core 수명"(idle-exit, 끝나는 길, 지키는 것 8·9·14), `project-docs/architecture/settings.md`(locked 설정이 사람만 바꾸는 이유)
  - 기계 신분: `project-docs/plan/machine-identity/README.md` "다른 계획이 기대는 계약" 1(`ctx.machine.id`, 기계에 묶인 상태는 그 기계 id를 같이 적는다)
  - 본보기: `packages/core/main/daemon/wiring/idle.ts`(`remoteEnabledSetting`이면 늘 일), `packages/core/main/daemon/wiring/diagnostics.ts`의 `memory` handler와 `packages/protocol/diagnostics/diagnostics.ts`의 `DIAGNOSTIC_STATUS_ROUTES`(memory route를 `registry.ts`의 `ROUTES`에 올리는 길), machine-identity가 만든 `packages/protocol/machine/mod.ts`·`packages/core/machine/mod.ts`(root file을 temp에 쓰고 rename, 못 읽는 file 다루기), `CoreOptions.launchShell`과 그것을 `ctx.options`로 읽는 `wiring/host-queue.ts`(core 입구가 주는 칸을 wiring이 읽는 길)
  - 조사: `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md` H
- 계약:
  - 쓰는 것: `ctx.machine.id`(machine-identity), `packages/base`의 `Result`·`Clock`·오류 code 일곱
  - 내놓는 것(다른 task가 기댄다. 모양을 바꾸지 않는다):
    - `packages/core/always-on/ports.ts`(`always-os`가 같은 모양을 자기 file에 따로 적어 구현하고, `always-boot`가 이어 type으로 맞는지 본다):
      ```ts
      export type ServiceEnv = { PATH: string; TMPDIR?: string };
      export type Registration =
        | { state: "registered" }                 // OS가 답했다: 항목이 있고, 지금 쓸 내용과 같고, 켜져 있다
        | { state: "absent" }                     // 이 data root의 항목이 없다
        | { state: "stale" }                      // 항목은 있으나 지금 쓸 내용(실행 경로, entry, data root, env)과 다르다
        | { state: "off_in_system" }              // 항목은 있으나 OS나 사람이 OS 설정에서 껐다
        | { state: "unavailable"; reason: "no_service_manager" | "unverified_path" | "os_failed" };
      export type Registrar = {
        mechanism: "systemd" | "launchd" | "windows_run";
        read(env: ServiceEnv): Promise<Registration>;
        register(env: ServiceEnv): Promise<Registration>;   // 쓰고 켠다(OS 설정에서 꺼진 것도 다시 켠다). 끝에 read한 값
        unregister(): Promise<Registration>;                  // 지운다. 도는 core를 멈추지 않는다. 끝에 read한 값
      };
      export type KeepAwake = {
        hold(): Promise<{ state: "held" } | { state: "unavailable"; reason: "no_inhibitor" | "os_failed" }>;
        release(): void;
        // 쥔 child가 스스로 끝났을 때 한 번 부른다(OS가 거절, 명령 없음).
        onLost(listener: (reason: "no_inhibitor" | "os_failed") => void): void;
      };
      export type AlwaysOnOs = { registrar: Registrar; keepAwake: KeepAwake; captureEnv(): ServiceEnv };
      export type AlwaysOnHost = (dataRoot: string) => AlwaysOnOs;
      ```
    - `CoreOptions.alwaysOn?: AlwaysOnHost`(`core.ts`). 없으면 개발·test core다: 표시를 켤 수 없고 OS를 부르지 않는다.
    - `packages/protocol/always-on/mod.ts`: `alwaysOnStatusSchema`(strict, 아래 칸), `type AlwaysOnStatus`, route `alwaysOnStatus`(`defineMemory`, resource `always_on`, method `status`, name `always_on.status`, input `{}`, actors `["user"]`, errors `invalid_input`·`forbidden`)와 `alwaysOnSet`(method `set`, name `always_on.set`, input `z.strictObject({ keep_running: z.boolean().optional(), keep_awake: z.boolean().optional() })`에 둘 중 하나는 있어야 한다, 출력 `alwaysOnStatusSchema`, actors `["user"]`, errors `invalid_input`·`forbidden`·`unavailable`), `ALWAYS_ON_ROUTES`.
      ```ts
      { keep_running: boolean; keep_awake: boolean;
        start_at_login: "registered" | "not_registered" | "off_in_system" | "unavailable";
        login_reason: "development_build" | "no_service_manager" | "unverified_path" | "os_failed" | null;  // unavailable일 때만
        awake: "held" | "released" | "unavailable";
        awake_reason: "no_inhibitor" | "os_failed" | null;
        mechanism: "systemd" | "launchd" | "windows_run" | null }   // 개발 core는 null
      ```
      `start_at_login`은 표시와 상관없이 OS의 사실이다(`absent`·`stale`은 `not_registered`). 화면이 표시와 짝지어 읽는다(표시 꺼짐 + `registered`는 "아직 남아 있다").
    - Late `alwaysOn: AlwaysOn`: `{ status(): AlwaysOnStatus; refresh(): Promise<AlwaysOnStatus>; set(input: { keep_running?: boolean; keep_awake?: boolean }): Promise<Result<AlwaysOnStatus>> }`. `status()`는 마지막으로 안 값(동기), `refresh()`는 OS에 다시 묻는다.

## 할 일

1. `packages/protocol/always-on/`: 위 schema와 route 둘. `packages/protocol/registry.ts`의 `ROUTES`에 `...ALWAYS_ON_ROUTES` 한 줄. route 설명(영어)은 "lophn starts at this computer's login and keeps running without its window"의 뜻을 짧게.
2. `state.ts`: `<root>/always-on.json` 읽기·쓰기(위 README 계약 1의 모양, zod strict). 쓰기는 0600 temp에 쓰고 rename. file이 없거나 깨졌으면 "꺼짐"으로 읽고 log 한 줄(깨진 file은 덮지 않고, 사람이 다시 켜면 그때 새로 쓴다). `machine`이 `ctx.machine.id`와 다르면 꺼짐으로 읽고 `foreign: true`를 같이 돌려준다(기동 맞추기가 쓴다).
3. `mod.ts`의 `createAlwaysOn({ root, machine, os?: AlwaysOnOs, clock, logger })`: 한 번에 하나만 돈다(set과 맞추기를 줄 세운다).
   - `set`: `os`가 없으면 `keep_running: true`나 `keep_awake: true`는 `unavailable`("Keeping lophn running needs an installed lophn. This is a development build.")이고 아무것도 쓰지 않는다. `keep_awake: true`인데 결과의 `keep_running`이 false면 `invalid_input`. `keep_running: false`는 `keep_awake`도 끈다. 켤 때(`keep_running: true`가 들어올 때마다, 이미 켜져 있어도) `os.captureEnv()`로 `service_env`를 다시 잡아 file에 쓰고 `registrar.register(env)`를 부른다. 같은 값을 다시 보내는 것이 화면의 [Try again]이다. 끌 때 `registrar.unregister()`. 등록이 실패해도 표시는 남는다(사람의 선언이다). 결과는 `status`에 사실로 보인다. file 쓰기가 실패하면 `unavailable`이고 OS를 부르지 않는다.
   - keep-awake: 표시와 keep-awake가 둘 다 켜져 있으면 `hold()`, 아니면 `release()`. `onLost`면 `awake: "unavailable"`과 이유.
   - 기동 맞추기 `reconcile()`(wiring의 `afterReady`): `os`가 없으면 아무것도 안 한다. `always-on.json`이 없으면 OS를 부르지 않는다(한 번도 켠 적 없는 data root. 설치 확인 도구의 빈 root도 여기다). 표시가 켜져 있으면 `read(service_env)`가 `absent`·`stale`일 때만 `register`(OS 설정에서 꺼진 것은 다시 켜지 않는다), keep-awake면 `hold`. 꺼져 있거나 다른 기계의 file이면 `read`가 항목을 보일 때(`registered`·`stale`·`off_in_system`) `unregister`.
   - `closeWork`에서 `release()`.
4. `wiring/always-on.ts`: `ctx.options.alwaysOn?.(ctx.root.path)`로 OS port를 얻고, `createAlwaysOn`을 build에서 만들어 `ctx.provide("alwaysOn", …)`, `memory:`에 route 둘(`status`는 `refresh()`), `afterReady`에 `reconcile()`, `closeWork`에 release. `assembly.ts`에 `idleWiring` 바로 앞 한 줄.
5. `wiring/idle.ts`의 `busy()`: `ctx.alwaysOn.status().keep_running`이면 `ok(true)`(`remote.enabled` 줄 옆. 주석은 "사람이 이 기계에서 늘 켜 두라고 했다. 끄는 것은 `Stop lophn`이다").
6. `core.ts`의 `CoreOptions`에 `alwaysOn?: AlwaysOnHost`와 주석 한 줄("설치 layout으로 뜬 core만 core 입구가 준다. 없으면 OS 등록을 하지 않는다").
7. catalog: `module-catalog.yaml`에 `packages/core/always-on`(boundary `always-on`, notes: "OS 등록과 keep-awake는 port다. `os/`가 구현하고 core 입구가 설치 layout일 때만 꽂는다")와 `packages/protocol/always-on`, `boundary-catalog.yaml`에 `always-on`(component, 한 문장).
8. `app-folder-sync`에 이 기계의 값 넘기기(이 task가 `ctx.alwaysOn` wiring을 가지므로 여기서 한다): `project-docs/plan/app-folder-sync/README.md`의 "다른 계획이 기대는 계약"을 읽는다. 그 계획이 main에 land되어 있으면 그 계약이 이름 붙인 확장 자리에 `wiring/always-on.ts`에서 함수를 등록한다: 읽기 명령(`machine/environment`)의 선택 section `always_on: { keep_running, starts_at_login, keep_awake }`(= `{ status.keep_running, status.start_at_login === "registered", status.keep_awake && status.awake === "held" }`)과 기계 기록의 `alwaysOn(): boolean | null`(= `keep_running && start_at_login === "registered"`). land되어 있지 않으면 아무것도 하지 않고 보고에 "lead에게 남김"으로 적는다. 그 계획의 file은 등록 한 줄 말고 고치지 않는다(넘길 줄).
9. flows: `always_on/status`·`always_on/set`의 flow(area `core-platform`, outcome은 handler가 실제로 내는 것만: `unavailable`은 개발 core와 file 쓰기 실패), `core-idle-exit` flow의 조건에 표시, 기동 맞추기는 `system:` flow, 새 test file은 tests group에. `node tools/flows.ts check`.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`always-on_test.ts`, fake `AlwaysOnOs`가 부른 것을 센다. 임시 폴더의 root):
  - "개발·test core(`os` 없음)는 `keep_running: true`를 `unavailable`로 거절하고 file을 쓰지 않으며, 맞추기를 포함해 OS port를 한 번도 부르지 않는다"
  - "다른 기계 id의 `always-on.json`(복제)은 꺼짐으로 읽혀 `register`·`hold`를 부르지 않고 idle-exit를 막지 않으며, 이 기계 OS에 그 data root의 항목이 있을 때만 `unregister`한다. `always-on.json`이 없는 root는 OS를 부르지 않는다"
  - "`start_at_login`이 `registered`인 것은 port가 `registered`를 답했을 때뿐이다(`register`가 실패를 돌려주거나 `stale`·`off_in_system`이면 아니다). 맞추기는 `off_in_system`을 다시 켜지 않는다"
- subprocess, 서버를 띄우는 test는 만들지 않는다.
- 남지 않음: 없음(지우는 것이 없다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: route 둘의 입력·출력 예 하나씩, 기동 맞추기 표(표시 × OS 답 → 부른 것), lead가 고칠 목록(`architecture/platform.md`의 idle-exit와 지키는 것 9·14).
