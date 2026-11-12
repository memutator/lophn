# tools-file-write

`file.edit`·`file.write`·`agent.memory`가 사람의 file을 망가뜨리는 길을 막는다: UTF-8이 아닌 file을 고치면 모든 비 UTF-8 byte가 U+FFFD로 바뀌고, CRLF file에서 LF로 준 `old_string`을 못 찾고, 덮어쓰면 BOM·CRLF가 사라지는 것(tools #28), 쓰다 죽으면 반쯤 쓴 file이 남는 것(#29), 크기 상한이 없고 쓰기 실패가 모두 "cannot write this path"인 것(#30).

- 단위: tools (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/file/{write,scope}.ts`
  - `packages/core/lophn-agent/tools/file/scope_test.ts`
  - `packages/core/lophn-agent/tools/file/write_test.ts`(새 file)
  - `packages/core/lophn-agent/tools/memory/edit.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md` "모델 › tool"(file tool 목록), `project-docs/architecture/workspace-session.md` 지키는 것 12(rewind가 file tool이 바꾼 file을 되돌린다), `project-docs/architecture/approval.md`(file tool은 Gate를 거치지 않고 `resolveInWorkspace`가 폴더를 지킨다)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`(boundary `lophn-agent`)
  - 범위 밖: `project-docs/products/roadmap/failure-hardening.md`의 tools #27(읽은 뒤 바뀐 file, 읽지 않은 file 덮어쓰기). 읽기 기록을 두지 않는다
  - 조사(선택): main checkout의 `research_notes/error-handling-verify/tools-session.md` #28 #29 #30(commit하지 않아 worktree에는 없다)
- 계약:
  - 쓰는 것: `FileHooks.aroundWrite`(`packages/core/lophn-agent/tools/ports.ts`, 쓰기 callback 앞에 rewind pre-image를 남긴다. 고치지 않는다), `resolveInWorkspace`(돌려주는 `path`는 이미 realpath다), `ToolContext.ids`(`IdSource.newId(prefix)`, prefix는 소문자 세 글자)
  - 내놓는 것: `fail`, `fsFail`, `resolveInWorkspace`의 signature는 그대로다. 읽기 쪽(`read.ts`, `image.ts`, `pdf.ts`, `search.ts`, `memory/edit.ts`)도 `fsFail`을 쓰므로 바뀐 문장이 거기도 보인다. `tools-grep`이 `search.ts`에서 `fsFail`과 `resolveInWorkspace`를 쓴다
  - 고치지 않는 file: `packages/core/lophn-agent/tools/file/read.ts`, `packages/core/lophn-agent/tools/tool-context.ts`, `packages/core/lophn-agent/run-loop/prepare.ts`

## 할 일

1. **인코딩(#28 a), `write.ts`의 `writeText`.** 지금: 있는 file을 `readFile(path, "utf8")`(실패하지 않는 decode)로 읽어, CP949나 Latin-1 file을 `file.edit`로 한 글자 고치면 file 전체가 다시 쓰이며 비 UTF-8 byte가 모두 U+FFFD가 된다(`file.read`는 같은 file을 거절한다).
   - 있는 file을 byte로 읽는다. `file.edit`은 NUL이 있거나 `new TextDecoder("utf-8", { fatal: true })`가 실패하면 `fail("invalid_input", "not a UTF-8 text file; file.edit only changes UTF-8 text")`로 거절하고 file을 건드리지 않는다.
   - `file.write`는 거절하지 않는다(통째로 바꾸는 것이 뜻이다). decode가 안 되는 옛 file이면 아래 2의 BOM·줄끝 보존을 하지 않는다.
2. **BOM과 줄끝(#28 b).** 지금: CRLF file에 LF만 담긴 `old_string`을 주면 "old_string not found"이고, `file.write`로 덮으면 BOM과 CRLF가 사라진다.
   - BOM: 옛 byte가 `EF BB BF`로 시작하면 BOM이 있다. decode는 BOM을 뺀 글로 하고(TextDecoder 기본), 쓸 때 BOM byte를 다시 앞에 붙인다. `file.write`의 content가 이미 `﻿`로 시작하면 두 번 붙이지 않는다.
   - 줄끝: 옛 글에 `\r\n`이 하나 이상 있고 모든 `\n` 앞에 `\r`가 있으면 "CRLF file"이다. 섞인 file과 LF file은 지금처럼 글자 그대로 다룬다.
   - CRLF file의 `file.edit`: 글, `old_string`, `new_string`의 `\r\n`을 모두 `\n`으로 바꾼 위에서 찾고 바꾼 뒤, 결과의 `\n`을 `\r\n`으로 되돌린다. 순수 CRLF file이라 바꾸지 않은 줄의 byte는 그대로다.
   - CRLF file을 `file.write`로 덮을 때: content에 `\r\n`이 없으면 `\n`을 `\r\n`으로 바꿔 쓴다. 있으면 그대로 쓴다. 새 file은 받은 그대로다.
   - 결과의 `bytes`는 실제로 쓴 byte 수다.
3. **atomic write(#29), `write.ts`와 `memory/edit.ts`.** 지금: `writeFile(target, next)`가 그 자리에 쓰므로 쓰다가 process가 죽거나 disk가 차면 반쯤 쓴 file이 남는다. `agent.memory`(`editMemory`)도 같다.
   - `write.ts`에 helper 하나(예: `replaceFile(path, bytes, ids)`)를 둔다: 같은 폴더에 `.<이름>.<ctx.ids.newId("tmp")>.tmp`를 쓰고, 옛 file이 있으면 그 mode(`stat().mode & 0o7777`)를 temp에 `chmod`하고, `rename`으로 바꾼다. 실패하면 temp를 지우고(`rm` force) 오류를 위로 돌려준다. `aroundWrite`의 `run` callback 안에서 부른다(rewind pre-image는 그대로 앞서 남는다).
   - `target.path`는 `resolveInWorkspace`가 realpath로 푼 것이라 symlink를 거쳐 온 file은 symlink가 아니라 실제 file이 바뀐다(지금과 같은 뜻).
   - `memory/edit.ts`의 `writeFile(file, next)`도 같은 helper로 바꾼다.
4. **크기 상한(#30 a), `write.ts`.** 지금: content 크기 상한이 없고 `file.edit`은 크기를 보지 않고 file 전체를 메모리에 읽는다. 상수 `MAX_WRITE_BYTES = 10 * 1024 * 1024`(읽기 상한 `read.ts`의 `MAX_FILE_BYTES`와 같은 값)를 둔다.
   - 쓸 byte(`file.write`의 content, `file.edit`의 결과)가 넘으면 `fail("invalid_input", "the file would be N bytes, over the 10 MiB limit of file tools")`.
   - 있는 file은 읽기 전에 `stat`으로 크기를 본다. `file.edit`은 넘으면 같은 문장으로 거절하고, `file.write`은 넘는 옛 file을 읽지 않고 BOM·줄끝 보존 없이 쓴다.
5. **오류 문장(#30 b), `scope.ts`의 `fsFail`과 `write.ts`의 쓰기 catch.** 지금: 쓰기 실패는 모두 "cannot write this path", 읽기 실패는 ENOENT 밖에 모두 "cannot access this path"라 model이 disk가 찼는지 권한인지 모른다.
   - `fsFail`이 errno마다 문장을 나눈다. 모두 `invalid_input`이다: `EACCES`·`EPERM` "permission denied", `EISDIR` "the path is a directory", `ENOTDIR` "a parent of the path is not a directory", `ENOSPC`·`EDQUOT` "no space left on the disk", `EROFS` "the file system is read-only", `EBUSY` "the file is in use by another program". ENOENT는 지금처럼 `not_found` "file not found", 그 밖은 지금 문장이다.
   - `write.ts`와 `memory/edit.ts`의 쓰기 catch는 고정 문장 대신 `fsFail(error)`를 돌려준다.
6. test(아래 위험 test)를 `write_test.ts`에 쓴다. `scope_test.ts`처럼 임시 폴더를 만들고, `ToolContext`는 `scope`(`read`·`write`가 그 폴더), `ids`, 그 밖은 쓰지 않는 칸만 채운 가짜로, `FileHooks`는 `run()`을 그대로 부르는 가짜로 둔다. 여러 경우는 표로 돈다.

정한 것:
- `file.write`는 UTF-8이 아닌 옛 file도 덮는다. 통째로 바꾸라는 요청이고, 막으려면 "읽었는가"를 알아야 하는데 그것은 범위 밖 #27이다.
- CRLF 처리는 순수 CRLF file에만 한다. 섞인 file을 한쪽으로 맞추면 고치지 않은 줄의 byte가 바뀐다.
- 오류는 모두 `invalid_input`이다. `executeToolCall`(`packages/core/lophn-agent/tools/work.ts`)은 `invalid_input`일 때만 handler 문장을 model에 보인다. disk full을 `unavailable`로 두면 model은 "tool is unavailable"만 본다.
- Windows에서 열린 file로 `rename`이 `EPERM`·`EBUSY`로 실패하면 그 자리 쓰기로 돌아가지 않고 오류로 돌려준다. 돌아가는 길은 반쯤 쓴 file을 다시 만든다.
- 소유자(uid)는 옮기지 않는다. 사람의 file을 같은 사용자 process가 바꾸므로 같다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "BOM과 CRLF가 있는 file을 LF로 준 old_string으로 file.edit하면 찾아 바꾸고, 바꾼 곳 밖의 byte와 BOM·CRLF는 그대로다"
  - "UTF-8이 아닌 file은 file.edit가 거절하고 file byte가 바뀌지 않는다"
- 남지 않음: `grep -rn "cannot write this path\|cannot write the memory" packages tests`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. **무겁게 짠 것**과 **알려진 미완 동작**을 빠뜨리지 않는다. 새 test file이 있으니 "등록할 것"에 `project-docs/flows/tests/lophn-agent.yaml`에 `packages/core/lophn-agent/tools/file/write_test.ts` 줄(덮는 outcome)을 lead가 더해야 한다고 적는다.
