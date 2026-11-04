# extension

본체와 따로 켜는 기능 묶음(manifest, registry, 켜기·끄기·지우기)이다. `project-docs/architecture/extension.md`.

## 설치본에는 본체 안 extension이 들어가지 않는다

```yaml
kind: bug
modules: [packages/shell/main, tools]
```

- 지금: packaged에서 registry가 읽는 폴더는 설치 root의 `extensions/`(`packages/shell/main/desktop/wiring/extensions.ts`, `packagedInstall(process.resourcesPath).root`)다. `tools/package-linux.ts`와 `packages/shell/main/electron-builder.yml`은 그 폴더를 만들지도 채우지도 않는다. extension의 `entry`(따로 빌드한 CJS file)를 만드는 build도 없다. 개발은 shell main 안 `extensions/bundled/<id>/`(아직 없다)를 그대로 읽는다.
- 영향: 첫 extension(harness host)을 더하면 `npm run dev`에서는 보이고 .deb 설치본에서는 목록에 없어 사람이 켤 수 없다.
- 고치려면: extension마다 entry를 esbuild로 따로 빌드해 shell main 안 `extensions/bundled/<id>/`의 manifest와 같이 두고, `tools/package-linux.ts`가 그 폴더들을 설치 root `extensions/`로 복사한다(작음). 추천: 첫 extension을 더하는 변경(계획 harness-agent)에서 같이 한다.
