# extension

닫은 이슈. 열린 것은 `project-docs/issues/extension.md`.

## 설치본에는 본체 안 extension이 들어가지 않는다

```yaml
kind: bug
modules: [packages/shell/main, tools]
closed: fixed
guard: 없음
```

- 지금: packaged에서 registry가 읽는 폴더는 설치 root의 `extensions/`(`packages/shell/main/desktop/wiring/extensions.ts`, `packagedInstall(process.resourcesPath).root`)다. `tools/package-linux.ts`와 `packages/shell/main/electron-builder.yml`은 그 폴더를 만들지도 채우지도 않는다. extension의 `entry`(따로 빌드한 CJS file)를 만드는 build도 없다. 개발은 shell main 안 `extensions/bundled/<id>/`(아직 없다)를 그대로 읽는다.
- 영향: 첫 extension(harness host)을 더하면 `npm run dev`에서는 보이고 .deb 설치본에서는 목록에 없어 사람이 켤 수 없다.
- 고치려면: extension마다 entry를 esbuild로 따로 빌드해 shell main 안 `extensions/bundled/<id>/`의 manifest와 같이 두고, `tools/package-linux.ts`가 그 폴더들을 설치 root `extensions/`로 복사한다(작음). 추천: 첫 extension을 더하는 변경(계획 harness-agent)에서 같이 한다.

닫음: `packages/shell/main/build.ts`의 `buildExtensions`가 본체 안 extension의 entry를 `dist/index.cjs`로 따로 묶고(manifest 판이 제품 판과 다르면 멈춘다), `tools/package-linux.ts`의 `stageExtensions`가 manifest와 `dist/`를 설치 root `extensions/`로 옮긴다. .deb를 만들어 설치해 보지는 않았다.
