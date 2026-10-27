# @lophn/cap-fs

## 목적

파일 read·write·watch를 얇은 typed client로 묶는다. 앱 process는 권한을 막지
않으므로 OS가 허락하는 파일은 어디든 읽고 쓸 수 있다. 선언의 `fs.read`·`fs.write`는
앱이 무엇에 닿는지 보이는 값이고, 이 package의 `checkDeclaration`이 그 선언을
검사한다.

## 공개 API와 type

```ts
import {
  readFile,
  readTextFile,
  watch,
  writeFile,
  writeTextFile,
} from "@lophn/cap-fs";
```

- `readFile(path)`, `readTextFile(path)` — 파일을 읽는다.
- `writeFile(path, bytes, { append?, createNew? })`,
  `writeTextFile(path, text, options)` — 파일에 쓴다. `append`는 뒤에 잇고
  `createNew`는 이미 있으면 실패한다.
- `watch(paths, handler, { recursive? })` — 경로의 변경을 받는다.
  `{ close(), done }`를 돌려준다.
- 거절은 `CapabilityError`다. 없는 경로는 `not_found`, 이미 있는 경로는
  `conflict`, 그 밖의 실패는 `unavailable`이다.
- `checkDeclaration(declaration)` — 이 package를 쓰는 선언이 `fs.read` 또는
  `fs.write`를 빠뜨렸는지 검사한다.
- type: `FsEvent`, `FsWatcher`, `WatchOptions`, `WriteOptions`,
  `CapabilityError`, `DeclarationCheck`

## 요구 permission

없다. 앱은 권한 제한 없이 돈다. 선언의 `fs.read`·`fs.write`(경로·recursive)는
앱이 무엇에 닿는지 보이는 값이고 `checkDeclaration`이 그것을 요구한다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { readTextFile, writeTextFile } from "@lophn/cap-fs";

const text = await readTextFile("/home/me/notes/todo.md");
await writeTextFile("/home/me/notes/todo.md", `${text}\n- 새 할 일`);
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
