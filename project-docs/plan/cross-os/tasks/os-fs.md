# os-fs

core의 file 규칙을 세 OS에서 맞게 한다(README 정한 것 5, 6). Windows에서는 지금 core가 data root 검사에서 기동을 거절하고, 봉인 판정이 mode bit라 끝난 앱 사본을 매번 지우고 다시 쓴다.

- 단위: os (wave 2)
- 선행: os-base. wave 1이 merge된 plan branch에서 시작한다.
- 소유(이 task만 고친다):
  - `packages/core/install-and-update/`
  - `packages/core/secrets/file-store.ts`
  - `packages/core/config/store.ts`, `packages/core/config/store_test.ts`
  - `packages/core/diagnostics/files.ts`
  - `packages/core/lophn-agent/extensions/skill-folders.ts`
  - `packages/core/apps/releases/bundle/`
  - `packages/core/apps/releases/prepare/{flow.ts,from-source.ts}`
  - `packages/core/apps/releases/ui-build/app-build.ts`
  - `packages/core/apps/packages/{install.ts,install_test.ts,sdk-sync.ts}`
  - `packages/core/storage/blobs/`
  - `packages/core/main/flow-host/sdk-link.ts`, `packages/core/main/flow-host/sdk-link_test.ts`
  - `packages/core/apps/permissions/{model.ts,adapters/realpath.ts}`
  - `packages/core/apps/data/worker/paths.ts`
  - `packages/core/main/daemon/wiring/sealed-marker.ts`(새로: data step. wiring 목록에 넣는 줄은 lead가 넣는다)
- 소유 밖: process·IPC·child env·shell tool은 `os-process`의 것이다.
- 읽을 것:
  - `packages/base/os/`(wave 1의 `homeOf`)
  - `packages/core/install-and-update/data-root.ts`(머리 주석 "다른 OS의 동등 ACL 검사는 아직 실측이 없다")
  - `packages/core/apps/releases/bundle/seal.ts`(`FILE_MODE 0o444`, `DIRECTORY_MODE 0o555`, `:144` 봉인 판정), `packages/core/apps/releases/prepare/flow.ts:239-246`(`existing = (mode & 0o222) === 0`, 아니면 `removePartial`)
  - `packages/core/main/daemon/wiring/artifact-move.ts`, `assignment-file.ts`(`dataSteps` 꼴), `packages/core/main/daemon/wiring/context.ts:5`(migration → dataSteps 순서)
  - AGENTS.md "호환성"(ledger 밖 data root file의 모양이 바뀌면 소유 wiring의 `dataSteps`에 step을 더한다)
- 계약:
  - 쓰는 것: `packages/base/os/`
  - 내놓는 것: 봉인 표지 file `<사본 directory>.sealed`(사본 옆, 빈 file). 봉인의 마지막 단계에 쓰고, 봉인 판정은 표지가 있는가 하나다.

## 할 일

1. data root(정한 것 5): `install-and-update/data-root.ts`(`:27-37,49,67,87`)
   - `requested.startsWith("/")`는 `isAbsolute`.
   - `process.getuid()`가 없으면 거절하는 것, `stat.uid === uid`, `(mode & 0o077) === 0`은 POSIX만 본다. win32는 소유자·mode 검사를 건너뛴다(profile ACL을 믿는다). platform은 인자로 받는다.
   - 기본 위치는 `homeOf(env, platform)` 아래 `.lophn`(Windows는 `%USERPROFILE%\.lophn`).
   - `run-metadata.ts:38,66`(user-token, location.json 0600)과 `instance-lock.ts:37`은 그대로 두고 win32에서 mode가 no-op임을 주석 한 줄로 남기지 않는다(코드가 이미 맞다). 깨지는 것만 고친다.
2. `secrets/file-store.ts:107-115,152`: 0600 검사(`mode & 0o177`)는 POSIX만 한다(Windows stat mode는 늘 0666이라 매번 chmod한다). tmp 쓰기 뒤 rename이 Windows에서 EPERM·EBUSY로 잠깐 실패하면 몇 번(100ms 간격 5번) 다시 한다. 지금 실패 길(옛 file을 두고 `unavailable`)은 그대로.
3. log root: `diagnostics/files.ts:13,47-54,108-111`의 `root.startsWith("/")`(아니면 "invalid log root"로 던져 platform/io가 안 뜬다)를 `isAbsolute`로. `O_NOFOLLOW`가 win32에서 `undefined`인 것은 그대로 두되 ino·dev·nlink 검사가 Windows에서 거짓 실패를 내는지 보고, 내면 win32에서 그 검사를 건너뛴다.
4. 봉인(정한 것 6):
   - `bundle/seal.ts`가 봉인 끝(mode를 다 바꾼 뒤)에 `<copy>.sealed`를 쓴다. `:144` 판정과 `prepare/flow.ts:245`의 `existing`은 표지가 있는가로 바꾼다. `removePartial`은 표지도 같이 지운다(표지 먼저).
   - 같은 판정을 쓰는 곳을 grep한다: `apps/packages/install.ts:257,313-338`, `apps/packages/sdk-sync.ts:49`, `prepare/from-source.ts:171-179`(`makeWritable`), `storage/blobs/model.ts:13`(blob 0400은 판정이 아니면 그대로).
   - data step `packages/core/main/daemon/wiring/sealed-marker.ts`: data root의 봉인 사본(사본 위치는 `bundleCopyPath`가 정한다) 가운데 top directory mode에 쓰기 bit가 없고 표지가 없는 것마다 표지를 쓴다. 두 번 돌아도 같다. step id는 기존 꼴을 따른다.
   - `prepare/from-source.ts:113`의 `child.kill("SIGKILL")`은 `signalTree`(`os-process`의 할 일 2와 같은 규칙).
5. symlink:
   - `bundle/links.ts:90`(`createLinks`의 `symlink(target, path)`, node_modules 연결)은 directory를 가리키면 `"junction"`, file이면 지금처럼(Windows에서 file symlink는 권한이 필요하다. 실패하면 copy로 대신하는지 보고 정해 보고한다).
   - `main/flow-host/sdk-link.ts:39` `symlink(target, path, "dir")`은 win32에서 `"junction"`. `readlink(path) === target` 비교는 junction의 절대 경로를 맞춰 비교한다.
   - `bundle/modules.ts:12,25`: Windows npm은 `.bin`에 symlink 대신 `.cmd` shim을 둔다. bundle hash가 OS마다 달라지는지 보고, 달라져도 같은 기계 안에서만 쓰면 그대로 두고 보고한다.
6. 권한 path 비교: `apps/permissions/model.ts:12` `isSameOrInside`(`${root}/`와 `===`)를 `node:path` `relative`로(`..`로 시작하지 않고 절대 경로가 아니면 안). win32와 darwin은 대소문자를 가리지 않고 비교한다(`packages/core/projects/registry/model.ts:57-66` `equalPart`를 본보기로). `apps/permissions/adapters/realpath.ts:42-46`의 `~` 풀기·`startsWith("/")`·`${directory}/${entry.name}`은 `homeOf`·`isAbsolute`·`join`. `apps/data/worker/paths.ts:11-14`는 앱 안 상대 path(`/` 꼴)라 그대로 두고 부르는 곳(`job.ts:49-57`)에서 OS path로 바꾸는지만 본다.
7. `lophn-agent/extensions/skill-folders.ts:59-63,273-280` `dataRootOfEnv()`의 `startsWith("/")`·`/` 자르기·`/.lophn`·`/.config/lophn` 꼬리는 `isAbsolute`와 `join`으로.
8. `apps/releases/ui-build/app-build.ts:22` esbuild `onLoad` guard `args.path.startsWith("/")`는 `isAbsolute`(Windows에서 고정 의존 guard가 조용히 빠진다).
9. test가 실제 fs mode를 assert하는 곳(`config/store_test.ts:57`, `install-and-update/run-metadata_test.ts:18-24`, `apps/packages/install_test.ts:30-44`, `apps/releases/bundle/modules_test.ts:83-91`)은 win32에서 mode assert를 건너뛴다(`{ skip: process.platform === "win32" }`이나 그 assert만). 봉인을 보는 test는 표지로 바꾼다.

## 끝남

- `npm run check:full`이 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- Linux 사람의 data root가 이어진다: 이 변경 전 core로 앱 하나를 준비한 data root를 새 core로 띄우면 data step이 표지를 쓰고, 다음 준비가 그 사본을 지우지 않는다. lead가 merge 전에 손으로 한 번 해 볼 수 있게 방법을 보고에 적는다.
- 위험 test 둘:
  - "봉인 표지가 있는 사본은 prepare가 지우지 않고, 표지 없는 사본은 끊긴 것으로 지운다. data step은 쓰기 bit 없는 옛 봉인 사본에 표지를 쓰고 두 번 돌아도 같다."
  - "POSIX에서 group·other 권한이 있는 data root는 여전히 거절한다. win32(platform 인자)는 mode·uid를 보지 않는다."
- 남지 않음: `grep -rn "0o222) === 0" packages/core`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 등록할 것에 data step을 넣을 wiring 목록 file과 줄을 적는다.
