# remove-documents-sdk

앱이 문서를 저장하던 SDK 두 package(`cap-save`, `format-document`)와, 그것을 받아 주던 core 쪽 어댑터를 지운다. 문서 판이 없어져서 대체 없이 없어진다.

- 단위: remove-documents (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/sdk/cap-save/`
  - `packages/sdk/format-document/`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다.):
  - 지울 file: `packages/core/apps/permissions/adapters/documents-save.ts`, `packages/core/apps/permissions/broker/documents.ts`, `packages/core/apps/preview/adapters/documents.ts`
  - 고칠 file: `packages/core/apps/permissions/mod.ts`, `packages/core/apps/permissions/broker/server.ts`(`documentsSave` 경로), `packages/core/apps/preview/adapters/mod.ts`(`documents` 서비스), `packages/core/apps/releases/sdk-permissions.ts`(`@lophn/cap-save` 줄), `packages/core/apps/runtime/entrypoint/cap-host.ts`·`startup.ts`와 `packages/sdk/cap-net/host.ts`·`cap-secret/host.ts`·`cap-store/host.ts`(cap-save를 말하는 주석)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I1.12#2`
  - spec: S2 9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - 삭제 목록: `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장("앱 문서", "place 없는 문서")
  - inventory: `I1.5#13`, `I1.5#14` (`../assignment.md`에서 이 task가 맡은 줄 전부)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만 한다)

## 할 일

1. `packages/sdk/cap-save/`(declaration, errors, guide.md, host, mod, save)와 `packages/sdk/format-document/`(deno.json, guide.md, mod.ts)를 통째로 지운다. (I1.5#13, I1.5#14)
2. 추가 소유가 승인됐으면 core 쪽을 지운다. (I1.5#13)
   - `permissions/adapters/documents-save.ts`, `permissions/broker/documents.ts`, `preview/adapters/documents.ts`를 지우고, 그것을 export·조립하던 `permissions/mod.ts`, `broker/server.ts`의 `documentsSave` 경로와 처리 분기, `preview/adapters/mod.ts`의 `documents` 서비스를 걷는다.
   - `releases/sdk-permissions.ts`의 `"@lophn/cap-save": [["document.save"]]` 줄을 지운다.
   - `cap-host.ts`·`startup.ts`와 SDK host.ts 주석에서 cap-save 언급을 지운다.
3. grant kind `document.save`, blueprint `documents`·`DocumentDeclaration`·`FormatRef`, `protocol/apps/broker.ts`의 `brokerDocumentSave*`, `channel-values.ts`의 `documentsSave` 경로는 계약 단위(contract-approvals, contract-app-calls)가 지운다. 이 task는 건드리지 않는다. 이것들을 쓰던 core 쪽이 사라져서 안 쓰게 된 export는 보고에 적는다.
4. `grep -rn "cap-save\|format-document\|documentsSave\|documents-save" packages tools`를 돌려 남은 언급을 찾는다. `deno.lock` 안의 언급은 lead 몫이다.
5. `deno task check`를 돈다.
6. (lead가 맞추며 더함 (`I1.12#2`)) SDK UI의 `DocumentAddress`(문서 주소 표시와 복사). `DocumentAddress`를 지울 때 그 key를 쓰는 곳도 걷는다. key 지우기는 cleanup-dead가 한다

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "cap-save\|format-document" packages tools --include=*.ts --include=*.tsx --include=*.md --include=*.tmpl`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `deno.lock`과 root `deno.json` workspace에 두 package가 남아 있는지 확인해 적는다(`./packages/sdk/*` 글롭이면 필요 없다)
- 안 쓰게 된 export: `protocol/apps/broker.ts`의 `brokerDocumentSaveInputSchema`·`brokerDocumentSaveOutputSchema`, `channel-values.ts`의 `documentsSave`, grant kind `document.save`(`permissions.ts`, `grants.ts`, `core/apps/permissions/{model,schema,flags,effective,access,display}.ts`), blueprint `documents` 칸과 `DocumentDeclaration`·`FormatRef` — contract-approvals, contract-app-calls, approvals, app-calls가 지운다
- 정한 것: 없으면 "없음"
- 계약 바꾸기 요청: 없음
