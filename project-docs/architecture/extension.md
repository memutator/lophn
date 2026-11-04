# extension

extension은 lophn 본체와 따로 켜는 기능 묶음이다. 대다수에게 필요 없는 기능(첫 사용자: third-party CLI GUI와 harness host)을 여기에 둔다. 사람이 설정에서 켜고 끄고 지운다. 꺼져 있으면 code를 load하지 않고 아무것도 등록하지 않는다. 계약은 `packages/protocol/extensions/`(`extension-api`), registry는 `packages/shell/main/extensions/registry.ts`(`extension-host`), shell main 조립은 `packages/shell/main/desktop/wiring/extensions.ts`다.

## 흐름

```
shell main 기동 ─ core ready(1초마다 상태를 본다) ─▶ registry.sync()
SettingsChanged(keys에 extensions.*) ───────────────▶ registry.sync()
registry.sync()
  ─▶ roots의 <root>/<id>/manifest.json을 읽는다(code는 읽지 않는다)
  ─▶ 판 검사(manifest.version == 제품 판) · 설정 extensions.<id>.enabled 읽기(core settings.list)
  ─▶ 켜졌고 판이 맞으면: 표시 file을 두고 entry를 require → activate(ctx)
  ─▶ 꺼졌으면: 켜져 있던 것만 deactivate()
Settings › System › Extensions ─ IPC shell:extensions(list|install|remove) ─▶ registry
Settings › System › Extensions [Turn on|off] ─ settings 쓰기 extensions.<id>.enabled ─▶ SettingsChanged ─▶ registry.sync()
registry.install(id) ─▶ 표시 file만 둔다(다시 해도 같다)
registry.remove(id) ─▶ 꺼져 있을 때만 표시 file에 적힌 file과 표시 file, 비게 된 폴더를 지운다
앱 끝 ─▶ registry.stop() ─▶ 켜진 것을 모두 deactivate()
```

## 지키는 것

- **extension 하나는 폴더 하나다.** 폴더 이름이 id(`[a-z][a-z0-9-]*`)이고 그 안 `manifest.json`이 `{id, name, description, version, entry, provides}`다(`extensionManifestSchema`). manifest의 `id`가 폴더 이름과 다르거나 꼴이 틀리면 `invalid`로 보이고 켜지 않는다. `entry`는 폴더 안 상대 경로이고 폴더 밖을 가리키지 못한다.
- **판은 제품 판과 같아야 켠다.** 제품 판은 packaged면 `app.getVersion()`, 개발이면 root `package.json`의 `version`이다. 글자가 다르면 `incompatible`이고 load하지 않는다.
- **켜기는 사람이 설정으로만 한다.** 설정 key는 `extensions.<id>.enabled`(boolean, 기본 false, `extensionSettingKey`)다. core는 manifest를 읽지 못하므로 id마다 선언이 `packages/core/config/shell-settings.ts`에 정적으로 한 줄씩 있다(지금 `extensions.harness.enabled` 하나). 선언이 없는 id는 `no_setting`이고 켜지 않는다. `settings/update`는 user 자격만 쓸 수 있어 agent가 켜지 못한다.
- **registry는 manifest가 든 폴더 목록(roots)만 읽는다.** 지금 roots는 본체 안 폴더 하나다: 개발은 shell main 안 `extensions/bundled/`(지금 `harness` 하나), packaged는 설치 root의 `extensions/`. entry는 `packages/shell/main/build.ts`(`buildExtensions`, `npm run dev`와 packaging이 부른다)가 extension마다 `dist/index.cjs`로 따로 묶고, manifest의 `version`이 제품 판과 다르면 build가 멈춘다. `tools/package-linux.ts`(`stageExtensions`)가 manifest와 `dist/`만 설치 root `extensions/`로 옮긴다. 따로 받는 package로 옮길 때 roots에 `<data>/extensions/`를 더하면 된다. 같은 id가 두 root에 있으면 앞 root의 것이다.
- **code는 켜진 것만, shell main bundle 밖에서 load한다.** extension은 esbuild의 shell main bundle에 섞지 않고, 따로 빌드한 CJS file을 `entry` 경로로 `require`한다. 꺼진 extension은 manifest만 읽힌다. entry가 `activate`·`deactivate`를 내지 않거나 `activate`가 throw하면 `failed`이고(throw면 `deactivate`를 한 번 부른다) 다른 extension은 그대로 돈다.
- **extension code는 `ctx`로만 lophn에 닿는다.** `ExtensionContext`는 `{core, settings, spawn, clock, ids, files}`다. `core.call(kind, resource, method, input)`은 core protocol route를 사람 권한으로 부르고, `settings.get(key)`는 선언된 설정 값(기본값 포함)이고, 둘 다 `Result`다. `spawn`은 node type이 아닌 구조 type이고 시작하지 못하면 exit code null로 온다. env는 shell main의 것에 덧붙이고, stdout과 stderr는 따로 오며(줄 단위 JSON이 stderr 글과 엉키지 않게), `end()`가 stdin을 닫는다(stdin 끝을 기다리는 CLI가 있다). `files.write(name, text)`는 `<data>/extensions/<id>/` 안에만 쓴다. shell main 안 `extensions/bundled/<id>/` 아래 code는 protocol, base, 자기 폴더만 import한다. shell main 내부, 다른 extension, `electron`을 import하면 `tools/check-deps.ts`(rule `extension`)가 막는다.
- **지우기는 extension이 쓴 file만 지운다.** `<data>/extensions/<id>/.lophn-extension`(JSON `{files[]}`)이 표시 file이다. 켤 때 먼저 두고, `ctx.files.write`가 쓰기 전에 그 이름을 더한다. `remove(id)`는 켜져 있거나 설정이 켜져 있으면 `conflict`이고, 아니면 적힌 file과 표시 file만 지운 뒤 비게 된 폴더만 치운다(recursive가 아니다). 사람이 그 폴더에 넣은 file과 다른 설정은 남는다.
- **사람은 Settings › System › Extensions에서 다룬다**(`packages/shell/renderer/desktop/settings/extension-packages/`, pane id `extension-packages`). 줄마다 이름, 설명, 판, 상태(설치 안 됨 · 꺼짐 · 켜짐 · 판 다름 · 문제와 이유)다. 설치는 표시 file만 둔다(아직 내려받기는 없다). 켜기 단추는 설치되고 설정이 선언된 것에만 있고, 켜기·끄기는 IPC가 아니라 설정 쓰기다. 지우기는 확인 dialog를 거치고, 켜져 있으면 먼저 끄라고 보인다. IPC(`packages/shell/ipc/extensions.ts`)는 desktop 창 본문만 부르고 `list`는 먼저 `sync`해 방금 바꾼 켜기가 보인다. Settings › General은 `extensions.*` 설정을 보이지 않는다. Settings › Agents의 `tools` pane(문구 "Extensions")은 lophn agent의 skill·MCP라 이것과 다르다.
- **설정을 읽지 못하면 켜진 것을 끄지 않는다.** core가 잠시 불안정해도 extension이 꺼졌다 켜지지 않는다. `sync`와 `remove`는 차례로 돈다.
- **extension이 띄운 process는 extension이 끈다.** registry는 `ctx.spawn`으로 띄운 process를 따라가지 않는다. `deactivate`에서 끈다. 다시 켜면 같은 `require` cache의 module에 `activate`가 다시 불린다.

## 왜 이 모양인가

- **본체 .deb 안에 넣어 두고 켜는 것부터, 뒤에 따로 받는 package로(사람, 2026-11-04).** 그 전환이 구조를 고치지 않게 셋을 지금 지킨다: 따로 빌드한 file을 경로로 load, registry는 폴더 목록만 읽음, `ctx`로만 닿음(check-deps).
- **shell main에 둔다.** 첫 사용자(harness host, third-party CLI GUI)가 사람의 PATH와 실행 파일을 쓴다. core는 그것을 모른다([coding-agent.md](coding-agent.md)). core에는 protocol route로만 붙는다.
- **설정 선언이 id마다 정적이다.** 설정은 core가 선언한 key만 받는다. 동적 key를 열기보다 extension마다 한 줄을 더하는 쪽이 단순하다. 따로 받는 package가 오면 다시 본다.
- **`ctx.files`가 있다.** "extension이 쓴 file만 지운다"를 지키려면 무엇을 썼는지 registry가 알아야 한다. 쓰는 길을 하나로 두어 표시 file에 적는다(공유 skill 사본의 `.lophn-shared`와 같은 꼴, [coding-agent.md](coding-agent.md)).
