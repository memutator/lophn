# fix-app-build

releases-problems-template(`0abc69e6`)이 앱 template의 `scripts/build-ui.ts.tmpl`에 세 가지를 더했다: source map(`sourcemap: "external"`, `sourcesContent: true`), `.svg` import의 `text` loader, SDK component 사용 지점에 `data-lophn-at="<file>:<line>:<column>"`을 싣는 jsx plugin. 그런데 release 준비는 앱의 build script를 돌리지 않고 `core/apps/releases/ui-build/app-build.ts`가 같은 build를 한다. 그래서 release bundle에는 셋 다 없고, design의 `vendor-icon`이 svg를 import하므로 **그 component를 쓰는 앱의 release build가 실패한다.** 맞춘다. 같이 coding guide의 옛 command 낱말을 고친다.

- 단위: releases-problems (wave 3 고침)
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/ui-build/` (전부)
  - `packages/core/apps/packages/template/app/scripts/build-ui.ts.tmpl`의 plugin을 공유 file로 빼는 줄(빼면 `template/pin.ts`의 `TEMPLATE_HASH`를 다시 계산한다)
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`의 command 낱말과 `guides/manifest.ts`의 그 skill hash·version
- 읽을 것: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`, `git show 0abc69e6 -- packages/core/apps/packages/template/app/scripts/build-ui.ts.tmpl`, `packages/core/apps/releases/ui-build/app-build.ts`
- 계약: 고치지 않는다.

## 할 일

1. `app-build.ts`에 template과 같은 세 가지를 넣는다. plugin 코드는 한 곳에 두고 두 build가 같이 쓰면 좋다. template은 앱 폴더에 복사되는 file이라 core를 import할 수 없으니, 공유가 어렵다면 복사로 둔다(가장 단순하게).
2. bundle manifest가 `app.js.map`을 담는지 본다(`bundle/read.ts`의 `releaseSourceMaps`가 그것을 읽는다). 지금 map의 `sourcesContent`가 원래 TSX를 담게 한다.
3. `lophn-build-app/SKILL.md`에서 "command"를 지금 이름(app api, blueprint `app_api`, `src/app-api.ts`, `lophnApp.call(api, input)`)으로 맞춘다. manifest의 hash를 다시 계산하고 version을 올린다.
4. 확인: `deno task check:full`, core 기동(같은 data root로 두 번). svg를 import하는 작은 앱 source로 `app-build.ts`를 직접 한 번 돌려 build가 되는지 본다(임시 폴더, commit하지 않는다).

## 끝남

- `deno task check:full` 통과, svg import가 있는 source가 release build를 통과, map에 원래 source가 들어감.
