# Node runtime: Deno 떠나기

상태: 로드맵. 2026-10-27 사람이 Deno가 불편하고 얻는 것이 없다며 떠나기로 했다. 같은 날 agent runtime child를 `--allow-all`로 돌렸다(changelog `0.9.0` "agent runtime child가 `--allow-all`로 떠서…"). 이 문서는 core, lophn의 자식 process, 사용자 앱, flow, 도구를 Node 하나로 옮기는 길이다. 사실은 2026-10-27 저장소와 이 기계(Node 24.20.0, Electron 44.5.1의 Node 24.21.0, Deno 2.9.7)에서 세고 돌려 본 것이다.
배경 문서: `project-docs/architecture/layers.md`, `project-docs/architecture/app-call.md`, `project-docs/architecture/workflow.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/approval.md`, `project-docs/products/roadmap/approval.md` "하지 않는 것".

## 왜

- Deno를 고른 까닭은 권한 flag로 AI가 쓴 코드를 가두는 것이었다. 실제로는:
  - agent가 가장 많이 움직이는 `shell.run`은 `/bin/sh`를 사람 uid로 띄워 flag가 닿지 않는다. agent runtime의 좁힌 권한은 막는 것 없이 깨지기만 해서 지웠다(`project-docs/issues/archived/place-session.md`).
  - flow·앱 process의 `--allow-read`는 폴더 밖 file의 static import와 경로를 글자 그대로 적은 dynamic import를 막지 못한다. 그 file에 `--deny-read`를 걸어도 읽힌다. `<data root>/secrets.json` 모양의 file로 확인했다. `flow.ts` 한 줄로 secret 전부가 읽힌다.
  - 설치본만 권한을 좁혀 project 등록이 `NotCapable`로 실패했다(2026-10-24).
- 얻는 것 없이 runtime이 둘이다. shell은 Electron(Node)과 npm이고 core는 Deno라 lock, toolchain, 설치 binary가 두 벌이다.
- Node `--permission`은 위 import 구멍을 막는다(아래 "Node에서 잰 것"). 앱과 flow를 가두는 일은 Node로도 지금보다 낫다.
- 옮기는 비용은 남을 이유가 아니다. 대부분 기계적인 바꾸기라 module마다 worker를 나눠 돌린다.

## 지금 코드 (2026-10-27)

Deno에 기대는 곳
- `Deno.*` 참조 1,780개, file 414개. production은 632개, file 123개다. `Deno.test` 390개(file 215개), `@std/assert`를 import하는 file 217개(모두 test).
- 1:1 `node:*`가 없는 것: `Deno.serve` 5곳(`packages/core/server/server.ts`의 loopback v4·v6, unix socket인 `packages/core/apps/runtime/entrypoint/http.ts`와 `packages/core/apps/permissions/broker/server.ts`, OAuth callback인 `packages/core/lophn-agent/extensions/mcp-auth-control.ts`), WebSocket upgrade(`packages/core/server/socket.ts`), unix socket 위의 `fetch`(`Deno.createHttpClient`, `packages/core/apps/runtime/client/unix-http.ts`, `packages/core/main/app-supervisor/control-http.ts`), `Deno.watchFs` 3곳, `Deno.addSignalListener` main 3개, `Deno.execPath()`로 자기를 다시 띄우는 곳 11 file.
- Worker는 core에 둘(`packages/core/storage/ledger/reader-pool.ts`, `packages/core/main/daemon/runtime.ts`)이고 web worker 모양이다(boot 설정이 `self.name`에 실린다).
- SQLite는 이미 `node:sqlite`다(`packages/core/storage/ledger/sqlite.ts`). 옮길 것이 없다.
- module 해석: `deno.json` 19개 가운데 8개의 `imports`(npm 61, jsr 8)와 workspace가 bare specifier 1,636개를 푼다. jsr은 `@std/assert`(test), `@std/yaml`(9 file), `@std/toml`(2), `@luca/esbuild-deno-loader`(3)다. source에 `npm:`·`jsr:`를 직접 쓴 곳은 없다.
- TypeScript: `enum`·`namespace`·decorator 0개. constructor parameter property 14개(7 file, production은 esbuild로 묶는 UI 두 file). 상대 import 9,185개가 `.ts`를 적었고 확장자가 없는 것은 1개(`tests/eval/checks/app/reuse.ts:12`)다. `verbatimModuleSyntax`는 어디에도 없지만 core·base·protocol production에 `tsc --verbatimModuleSyntax`를 걸면 TS1484·TS1485가 0개다.
- 자식 process는 모두 `deno run`이다. `launchArgv`(`packages/core/supervision/security/launch-spec.ts`)나 따로 짠 flag로 띄운다. AI가 쓴 코드를 돌리는 것은 앱 process와 preview(`packages/core/apps/permissions/flags.ts`), flow(`packages/core/main/flow-host/flags.ts`), 선언 검사·추출(`packages/core/apps/declaration/check.ts`, `extract.ts`), release 준비의 선언 eval(`packages/core/apps/releases/prepare/from-source.ts`)이다. 나머지(I/O child, 정비 자식, data job, kinds worker, apps supervisor, agent runtime, CLI)는 lophn 코드다.
- 앱과 flow의 SDK는 `lophn-sdk:<이름>@<판>/<경로>`를 import map으로 `<data>/sdk/<이름>/<판>`에 푼다(`packages/core/apps/packages/template/import-map.ts`, `<data>/flows/import-map.json`). release는 `deno cache`로 외부 의존을 받아 `vendor/`·`node_modules/`를 묶는다(`packages/core/apps/releases/bundle/`). `workflow.check`는 `deno check`다.
- 앱 template은 Deno project다(`packages/core/apps/packages/template/app/deno.json.tmpl`의 task `build`·`check`·`test`·`wording`, `Deno.test`). App Engineer prompt는 `deno task check`와 `deno task test`를 시킨다(`packages/core/agent-roles/roles/app-engineer/prompt.md:49`).
- 설치본은 `/opt/lophn/deno` binary, `platform/`(source, `deno.json`, `deno.lock`, vendor), `DENO_DIR=~/.cache/lophn/deno`, Deno를 `--cached-only --frozen`으로 띄우는 `/usr/bin/lophn` launcher다(`packages/base/install/linux-install.ts`, `tools/package-linux.ts`).
- 도구: `tools/check.ts`가 `deno fmt`, `deno lint`, `deno check`, `deno test`를 부른다. 루트 `deno.json`에 task가 17개다.
- shell(`packages/shell/main`)은 이미 Node다. production에 `Deno.*`가 없고 test 22개가 `node:test`다. Electron binary를 `ELECTRON_RUN_AS_NODE`로 Node처럼 띄우는 곳이 이미 있다(`packages/shell/main/terminal/supervisor.ts:270`, `packages/shell/main/browser-bridge/shim.ts:129`).

Node에서 잰 것 (Node 24.20.0과, Electron 44.5.1을 `ELECTRON_RUN_AS_NODE=1`로 띄운 Node 24.21.0. 모든 항목에서 둘이 같았다)
- type stripping은 flag 없이 돈다. 안 되는 것: `enum`, `namespace`, parameter property, `import type` 없이 type만 가져오는 import(실행 때 "export가 없다" 오류), 확장자 없는 import, `.tsx`. `node_modules` 안의 `.ts`는 거절한다(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). `node_modules`의 package가 밖의 폴더를 가리키는 symlink면 realpath가 밖이라 돈다.
- `--permission`의 허락 flag는 `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi`, `--allow-inspector`뿐이다. deny flag는 없다.
  - 막는다: 폴더 밖 `fs` 읽기·쓰기, 폴더 밖 static import(json, ts, mjs), dynamic import(글자 그대로든 계산한 경로든), `createRequire`, 자식 process, Worker, `process.binding`, native addon. module loader가 realpath를 열기 때문에 `node_modules` symlink로도 허락 밖 폴더를 import하지 못한다.
  - 못 막는다: network(`--allow-net`이 없다. 권한 모드에서 `fetch("http://example.com")`이 200을 받았다), 환경 변수(전부 읽힌다), 허락 폴더 안의 symlink를 따라 밖을 읽고 쓰는 `fs`(Deno도 같다).
  - 경로 목록을 쉼표로 이으면(`--allow-fs-read=a,b`) 경고만 내고 둘 다 막는다. 경로마다 flag를 되풀이해야 한다.
  - `--max-old-space-size=512`가 같이 걸린다(넘으면 exit 134).
  - loader hook(`module.register`)은 Worker에서 돌아 `--allow-worker`가 필요하고, Node가 "permission model을 무효로 할 수 있다"고 경고한다.
- `node:sqlite`는 flag와 경고 없이 WAL로 돈다(권한 모드에서도). `node --test`는 `*_test.ts`를 기본으로 찾는다(폴더 인자는 받지 않는다).
- Deno 2.9.7은 `node:fs`, `node:child_process`의 `spawnSync`, `node:sqlite`, `node:worker_threads`, `node:test`(`deno test`로)를 돌린다. `execSync`는 `--allow-run`을 좁히면 실패한다. 그래서 runtime을 뒤집기 전에 Deno 위에서 Node API로 먼저 옮길 수 있다.

## 정한 것

- **Deno를 떠나 Node 하나로 간다.** 사람(2026-10-27): "deno runtime 왜 써야하는 지 모르겠고, 너무 불편함". 옮기는 비용보다 틀린 길을 계속 가는 부채가 크다.
- **OS sandbox는 두지 않는다.** `shell.run`, 앱, flow 모두 마찬가지다(`project-docs/products/roadmap/approval.md` "하지 않는 것"). 2026-10-27 다시 조사했다: 기본으로 켜는 harness는 Codex와 Cursor뿐이고, Claude Code와 Gemini CLI는 켜야 하고, OpenCode·Hermes·omp는 없다. 남는 위험: `shell.run`은 폴더 범위와 rewind 밖이고, unattended turn에서는 `ask` 규칙도 묻지 않고 돈다.
- **Node binary는 Electron 것 하나다.** core, lophn 자식 process, 앱, flow, CLI를 `ELECTRON_RUN_AS_NODE=1`인 Electron binary로 띄운다. 설치본에 runtime binary를 따로 싣지 않는다. 개발과 test도 같은 binary로 돌려 판이 갈리지 않게 한다. shell이 이미 이렇게 띄운다. (agent)
- **lophn 자신의 process는 권한 flag 없이 돈다.** AI가 쓴 코드를 돌리지 않는 process를 좁히면 막는 것 없이 깨지기만 한다(2026-10-24 설치본 core, 2026-10-27 agent runtime). (agent)
- **module 해석은 Node 기본(`package.json`과 `node_modules`)만 쓴다.** loader hook과 experimental package map은 쓰지 않는다. hook을 쓰면 sandbox process에 `--allow-worker`를 줘야 한다. package마다 `package.json`(판을 정확히 고정)을 두고 루트를 npm workspaces로 묶는다. shell이 이미 npm이다. jsr은 npm으로 바꾼다: `@std/yaml` → `yaml`, `@std/toml` → `smol-toml`, `@std/assert` → `node:assert/strict`. `@luca/esbuild-deno-loader`는 지운다(esbuild가 `node_modules`를 푼다). (agent)
- **TypeScript는 strip만으로 도는 문법으로 쓴다.** tsconfig에 `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`를 켜고, `tsc --noEmit`이 `deno check`를 대신한다. parameter property 14개를 풀어 쓴다. `.tsx`는 지금처럼 esbuild가 묶는 UI에만 둔다. (agent)
- **도구.** test는 `node:test`와 `node:assert/strict`다(`Deno.test` → `test`, `t.step` → `t.test`). `.tsx`나 CSS를 import하는 UI test는 esbuild loader hook으로 돌린다(test process는 권한 모드가 아니다). fmt와 lint는 Biome 하나가 `deno fmt`·`deno lint`를 대신한다. 끝내기 전에 돌리는 명령은 `npm run check`다. (agent)
- **앱·flow·선언 검사 process는 `--permission`으로 가둔다.** 읽기·쓰기 허락은 지금 Deno flag와 같은 경로를 flag 되풀이로 준다. child process, Worker, addon은 주지 않는다. memory는 `--max-old-space-size`다. 환경 변수는 spawn의 `env`를 통째로 정해 넘긴다. flag를 만드는 곳은 지금처럼 한 곳이고 쉼표 목록을 만들지 않는다. (agent)
- **폴더 밖을 가리키는 symlink는 따로 막지 않는다.** Node에는 deny flag가 없어 지금의 `--deny-read=<link>`를 옮길 수 없다. 그런 link는 사람이 만들었거나 `shell.run`이 만든 것이고, `shell.run`은 이미 갇혀 있지 않다. `linksIn` 훑기와 `permissions.limit.symlink-changes` 한계 문장을 지운다. (agent)
- **SDK는 bare `@lophn/<이름>`으로 import한다.** `lophn-sdk:` scheme과 import map을 지운다. lophn이 앱 폴더의 `node_modules/@lophn/<이름>`을 `<data>/sdk/<이름>/<판>`을 가리키는 symlink로 만든다(scaffold, release 준비). realpath가 `node_modules` 밖이라 `.ts` SDK가 strip되고, 권한 모드에서는 SDK root를 읽기 허락에 넣는다. flow도 같다. (agent)
- **옛 앱과 개발 데이터는 옮기지 않는다.** 뒤집은 판에서 지우고 새로 만든다(AGENTS.md "호환성"). (agent)

## 정할 것

- **앱과 flow도 Node로 옮기나.** 추천: 옮긴다. 남기면 앱 때문에만 설치본에 Deno binary, import map, `deno cache`가 남고 runtime이 둘인 채다. 옮기면 앱 template(`deno.json.tmpl` → `package.json`, `Deno.test` → `node:test`), App Engineer prompt와 앱 `AGENTS.md`, release 준비(`deno cache` → `npm install`), `workflow.check`(`deno check` → `tsc`)가 같이 바뀐다. 사람이 쓰는 앱 작성 방식이 바뀌는 제품 결정이라 묻는다.
- **앱·flow의 network를 무엇으로 막나.** 지금 `project-docs/architecture/app-call.md`는 "앱 process의 Deno 권한에는 외부 net이 없다"고 보장한다. Node는 network를 권한으로 막지 못한다.
  - 실수만 막는다(추천): 앱·flow code가 `fetch`, `WebSocket`, `node:net`·`http`·`https`·`http2`·`tls`·`dgram`·`dns`를 쓰면 release 준비와 `workflow.check`가 그 import와 전역 사용을 거절한다. process를 시작할 때 preload가 그 전역을 지운다. AI가 cap-net 대신 `fetch`를 쓴 실수를 잡는다. 일부러 우회하는 코드(`globalThis["fe"+"tch"]`)는 못 막는다. AGENTS.md는 사용자 앱을 공격자로 보지 않고, 같은 agent가 `shell.run`을 쥐고 있어 경계를 세워도 얻는 것이 없다.
  - OS network namespace: 앱·flow process만 net이 없는 namespace에서 띄운다. 이것은 경계다. Linux 전용이고, Ubuntu는 unprivileged user namespace를 AppArmor로 막아 설치 조건이 생긴다. 위 "OS sandbox는 두지 않는다"와 어긋난다.
  - 막지 않는다: `app-call.md`의 보장을 지운다.

## 단계

runtime은 마지막에 한 번 뒤집는다. 그 전까지는 Deno 위에서 Node API와 Node 도구로 옮겨 `deno task check`가 늘 통과한다. 단계마다 module 단위로 worker를 나눠 돌린다.

1. **Node API로.** `Deno.*`를 `node:*`로 바꾼다(fs, child_process는 `spawn`, path, os, `process.env`·`argv`·`exit`). `Deno.test`와 `@std/assert`를 `node:test`와 `node:assert/strict`로 바꾼다. jsr 의존을 npm으로 바꾼다. Deno에서 node 모양으로 못 도는 것(unix socket `Deno.serve`, WebSocket upgrade, unix socket `fetch`, `watchFs`, signal, Worker, `execPath`로 다시 띄우기)은 3단계로 미루고 module 하나에 모은다.
2. **package와 도구.** package마다 `package.json`을 두고 루트를 npm workspaces로 묶고 `deno.json`의 `imports`를 지운다. Deno가 workspace `package.json`과 `node_modules`로 푸는지는 이 단계를 시작할 때 확인한다. `tools/check.ts`를 `tsc --noEmit`, Biome, `node --test`로 바꾼다. parameter property를 풀고 `verbatimModuleSyntax`를 켠다.
3. **lophn process 뒤집기.** core와 lophn 자식 process를 Electron의 Node로 띄운다(`process.execPath`, `ELECTRON_RUN_AS_NODE`). 1단계에서 모은 것을 `node:http`(unix socket listen), `ws`(WebSocket server), `node:http`의 `socketPath`(unix socket 요청), recursive `fs.watch`, `process.on` signal, `worker_threads`(`workerData`)로 바꾼다. process group 끄기는 `process.kill(-pid)`로 돌아오고 `/usr/bin/kill`을 지운다. 이 단계 동안 앱과 flow는 Deno로 남는다.
4. **앱과 flow 뒤집기**(정할 것 첫째가 "옮긴다"일 때). `--permission` flag 만들기, SDK symlink, 앱 template과 prompt, release 준비와 bundle 꼴, `workflow.check`, network 막기(정할 것 둘째).
5. **Deno 지우기.** `deno.json`·`deno.lock`, `packages/shell/main/desktop/core/deno-binary.ts`, 설치본의 `deno` binary와 `DENO_DIR`, launcher의 Deno 줄을 지운다. Deno를 말하는 architecture 문서, AGENTS.md(`deno task check` → `npm run check`), skill을 고친다.

## 끝남 기준

- tracked source에 `Deno.` 참조와 `deno.json`·`deno.lock`이 없다. 설치본(.deb)에 `deno` binary가 없다.
- `npm run check`와 e2e가 Node에서 통과한다.
- 설치본에서 project 등록, 앱 만들기와 켜기, flow 실행, `lophn` CLI가 돈다. 설치본에서만 드러난 실패가 두 번 있었다.
- 위험 test(sandbox 경계): 앱·flow process가 허락 밖 file을 `fs`로도 static import로도 읽지 못하고, 쓰지 못하고, 자식 process를 띄우지 못하고, 넘기지 않은 환경 변수를 보지 못한다. flag builder가 쉼표 목록을 만들지 않는다.

## 하지 않는 것

- **Deno에서 import 구멍만 고치기.** 앱과 flow를 쓰는 PM·App Engineer가 `shell.run`으로 같은 file을 읽을 수 있어 고쳐도 줄어드는 노출이 없다. 4단계에서 `--permission`이 막는다.
- **Bun이나 다른 runtime.** Electron이 이미 Node를 싣는다. binary를 하나 더 싣는 것은 이 일과 반대 방향이다.
- **`--experimental-transform-types`, loader hook, package map.** 실험 기능이거나 sandbox를 약하게 한다.
- **OS sandbox.** 위 "정한 것"을 본다.
