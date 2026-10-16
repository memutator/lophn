# @lophn/cap-fs

## 목적

허락된 경로의 파일 read·write·watch를 얇은 typed client로 묶는다.
이 package를 import해도 grant가 생기지 않는다. 실제 접근 범위는 앱 프로세스의
Deno flag이고, 그 flag는 blueprint가 선언하고 사람이 grant한
`fs.read`·`fs.write` 경로의 교집합이다.

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

- `readFile(path)`, `readTextFile(path)` — `fs.read` 경로 안의 파일을 읽는다.
- `writeFile(path, bytes, { append?, createNew? })`,
  `writeTextFile(path, text, options)` — `fs.write` 경로 안에 쓴다. `fs.write`는
  `fs.read`를 포함하지 않는다.
- `watch(paths, handler, { recursive? })` — `fs.read` 경로의 변경을 받는다.
  `{ close(), done }`를 돌려준다.
- 거절은 `CapabilityError`다. `code === "forbidden"`이면 `permission`(`fs.read`
  또는 `fs.write`)과 `scope`(`{ path, recursive }`)가 있다. 그 이름과 경로를
  blueprint `permissions`에 선언하고 사람에게 grant를 요청한다.
- `checkDeclaration(blueprint)` — 이 package를 쓰는 선언이 `fs.read` 또는
  `fs.write`를 빠뜨렸는지 검사한다.
- type: `FsEvent`, `FsWatcher`, `WatchOptions`, `WriteOptions`,
  `CapabilityError`, `DeclarationCheck`

## 요구 permission

`fs.read`, `fs.write` 중 쓰는 쪽. 경로는 정확한 절대 경로이고 descendant만
포함한다. 운영 bundle은 읽기만 되고 source·다른 앱 DB·플랫폼 credential·log는
어느 grant로도 열리지 않는다.

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
