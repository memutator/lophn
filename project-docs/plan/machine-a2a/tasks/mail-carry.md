# mail-carry

outbox를 늦게 가는 길에 싣는다: 아직 닿지 않은 mail을 `computers` 폴더의 자기 하위 폴더에 file로 쓰고 서명한 manifest의 새 선택 칸 `mail`에 실어, 연결·폰·같이 보는 폴더(folder-sync의 길)로 다른 컴퓨터에 가게 한다. 받는 기계는 자기에게 온 mail file을 link와 같은 입구(`mailInbox.apply`)로 적용한다. 같은 mail이 두 길로 와도 받는 쪽이 id로 한 번만 돈다(roadmap 정한 것 8).

- 단위: mail (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/remote/{carry.ts,carry_test.ts}`
  - `packages/core/folder/export/{manifest.ts,mail.ts}` (`mail.ts`는 새 file)
  - `packages/core/folder/import/mail.ts` (새 file)
  - `packages/core/folder/mail_test.ts` (새 file)
  - `packages/core/main/daemon/wiring/folder.ts`
- flows(줄만 고친다): `project-docs/flows/areas/core-platform.yaml`(나르기의 `system:` flow에 mail file), mail을 읽는 `system:` flow 하나(`projects` 또는 `core-platform` area 가운데 folder 읽기를 가진 곳), `project-docs/flows/tests/core-rest.yaml`, `project-docs/flows/tests/libs-tooling.yaml`
- 읽을 것:
  - 계획 README "정한 것"(outbox, 받는 쪽 입구), roadmap `a2a-multi-device.md` "mail"과 정한 것 6·8·9
  - `project-docs/plan/machine-a2a/tasks/mail-router.md` "계약"(`mailSchema`, `pendingMails`, `mailSeen`, `MAIL_QUEUED_TOPIC`)과 `mail-link.md`의 `mailInbox`
  - architecture: `project-docs/architecture/folder-sync.md` "내 컴퓨터들(`computers`)과 옮기는 길", "목록의 사슬", "manifest 쓰기"; `project-docs/architecture/event.md`의 `across_machines`(file 하나, 7일, 한 번만 낸다)
  - 본보기: `packages/core/folder/export/events.ts`·`import/events.ts`(event file), `export/manifest.ts`의 선택 칸 `packages`(옛 판 호환: 모르는 칸을 버리고 원본 canonical body로 서명을 검증한다), `protocol/remote/carry.ts`의 `parseCarryPath`·`manifestBodySchema`·`manifestEntries`
- 계약:
  - 쓰는 것: `mailSchema`(`packages/protocol/lophn-agent/mail.ts`), `pendingMails(sql)`·`mailSeen(sql, origin, id)`·`MAIL_QUEUED_TOPIC`(`packages/core/router/mod.ts`), `ctx.peek.mailInbox`, `ctx.peek.computerSigningKey`, `ctx.peek.manifestSign`
  - 내놓는 것(`carry.ts`): `MAIL_FILE_MAX_BYTES = 128 * 1024`, `mailDir(machine) = machines/<mch>/mail`, `mailFilePath(machine, id) = machines/<mch>/mail/<mal id>.json`. `parseCarryPath`가 이 path를 manifest가 직접 싣는 file(`coveredBy: null`)로 읽는다. `manifestBodySchema`에 선택 칸 `mail: z.array(fileEntrySchema).optional()`: mail path는 `files`에 오지 않고 `mail`에만 온다. `manifestEntries`가 `mail`도 낸다. wave 3(`handoff-note`)이 같은 꼴로 `notes` 칸을 더한다.

## 할 일

1. `carry.ts`: 위 "내놓는 것". `packages` 칸과 같은 refine(그 기계의 path, 겹치지 않음). 옛 판(이 칸을 모르는 판)이 그 manifest를 읽어도 서명 검증이 되는지 `carry_test.ts`로 본다.
2. 내보내기(`export/mail.ts`, `wiring/folder.ts`의 `carryOut`에서 `publishManifest` 앞): `computers` 폴더 `mailDir(me)`를 `pendingMails(sql)`에 맞춘다. 없는 mail은 `createFolderWriter`로 쓰고(temp와 rename, 다시 쓰지 않는다), outbox에 없는 file(ack받았거나 만료된 것)은 지운다. file bytes는 mail 하나를 `encodeRecord(mailSchema, mail)`로 쓴 것이다.
3. `export/manifest.ts`: `packages`처럼 `mailDir(me)`를 읽어 선택 칸 `mail`을 싣는다(비면 뺀다). 목록이 같으면 다시 쓰지 않는 비교에 `mail`도 넣는다.
4. 계기: `wiring/folder.ts`가 writer를 `withAfterCommit`로 감싸 `MAIL_QUEUED_TOPIC`이 오면 `scheduleCarry()`(지금 있는 kick 규칙과 debounce를 쓴다). 지워진 줄은 다음 `carryOut`(5분 timer 포함)에서 빠진다.
5. 받기(`import/mail.ts`, `wiring/folder.ts`의 scan에서 `readEvents` 옆): `computers` 폴더(받는 자리가 서명을 확인한 file만 놓는다)의 다른 기계 `mailDir(origin)`을 읽는다. 각 file은 `MAIL_FILE_MAX_BYTES` 안에서 `mailSchema`로 읽고, `mail.to_machine === me`, `mail.from.machine === origin`, `ctx.peek.computerSigningKey(origin) !== null`(지금 명단의 컴퓨터)이 모두 맞을 때만, `mailSeen`이 false인 것을 origin마다 `seq` 순으로 `ctx.peek.mailInbox.apply({mail, origin, via: "folder"})`에 넘긴다. 틀린 file은 log 한 줄로 넘긴다(목록 전체를 실패시키지 않는다). `mailInbox`가 아직 없으면 읽지 않는다.
6. 받는 쪽은 사람의 폴더(`folder.shared`)를 바로 읽지 않는다(거울이 받는 자리로 들인다. 지금 규칙 그대로).
7. 폰이 `carry.ts`를 같이 읽으므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`를 돌린다.

## 끝남

- `npm run check`가 통과하고 폰의 typecheck와 test가 통과한다.
- 위험 test:
  - "폴더로 온 mail은 지금 명단의 컴퓨터 폴더에 있고 from.machine이 그 폴더의 기계이며 이 기계로 온 것만 적용되고, 같은 mail file을 두 번 읽어도 한 번만 넘긴다"(`packages/core/folder/mail_test.ts`, 임시 폴더와 가짜 `mailInbox`의 적용 결과로 판정)
  - "outbox의 mail은 file과 manifest의 `mail` 칸에 실리고, 줄이 지워지면 file과 칸에서 빠진다"(같은 file)
  - "`mail` 칸이 있는 manifest를 그 칸을 모르는 schema로 읽어도 서명이 검증된다"(`carry_test.ts`)
- 남지 않음: `grep -rn "mail/" packages/core/folder/import/events.ts`가 0줄이다(event 길에 mail을 얹지 않았다).

## 보고

- 바꾼 file
- 통과한 check(폰 포함)
- 등록할 것: 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
