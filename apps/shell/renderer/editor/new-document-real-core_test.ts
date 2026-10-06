// 실제 core 위의 series 새 멤버 쓰기와 version 충돌의 최신 판 비교(shell#T17). temp LOPHN_HOME core에
// temp 폴더 프로젝트와 series를 등록하고, renderer의 lophn 통로(가족 draft)·main의 첫 판 통로·
// 파일 adapter·저장 흐름을 그대로 잇는다. Electron IPC와 main의 contract client는 빠진다.
// 사람 데이터 root(~/.lophn)와 실제 사람 폴더는 열지 않는다.
// - flow write-series 2·5: draft(key·예정 문서) → 첫 판 저장이 같은 transaction에서 멤버 가입과
//   draft 비움을 한다. 첫 판 뒤의 고침은 그 문서의 working copy로 파일 통로를 탄다.
// - shell/editor#R15: 고치는 사이 다른 쪽이 판을 만들면 판 확정이 충돌로 멈추고, 해결 화면은 최신 판
//   본문(worker documents/read)을 읽어 비교한다. 사람이 고르면 그 판을 새 기준으로 확정한다.
import { assert, assertEquals } from "@std/assert";

import { coreCreatePort, coreFilesPort } from "../../main/editor/core-port.ts";
import { createDocumentCreator } from "../../main/editor/create.ts";
import { createFileAdapter, sha256 } from "../../main/editor/file-adapter.ts";
import { coreLauncherSource } from "../desktop/launcher/core-source.ts";
import { shortNameOf } from "../desktop/launcher/model.ts";
import { coreLophnSource } from "../desktop/lophn-space/core-source.ts";
import { newId } from "../desktop/lophn-space/model.ts";
import { startRealCore } from "../testdata/real-core.ts";
import { coreEditorSource } from "./core-source.ts";
import { NewDocumentSession } from "./new-document.ts";
import { type SaveClock, SaveSession } from "./save-state.ts";
import type { BodyState } from "./source.ts";

const encoder = new TextEncoder();

// 입력 멈춤 timer는 쓰지 않는다. test가 flush로 경계를 직접 연다.
const still: SaveClock = {
  set: () => 0,
  clear: () => {},
  now: () => Date.now(),
};

async function until<T>(
  label: string,
  read: () => Promise<T | undefined>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await read();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`기다림 초과: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

Deno.test({
  name:
    "documents/series#R11 shell/editor#R1 shell/editor#R2 shell/editor#R15: 실제 core에서 draft로 시작한 새 멤버는 편집 종료의 첫 판으로 가입하고, 뒤의 고침은 working copy로 쓰며, version 충돌은 최신 판 본문과 비교한 뒤 그 판을 기준으로 확정한다",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-editor-member-" }),
    );
    const core = await startRealCore();
    try {
      const project = newId("prj");
      const launcher = coreLauncherSource(core.source, undefined);
      const registered = await launcher.register({
        id: project,
        name: shortNameOf("Reports", []),
        title: "Reports",
        purpose: "",
        folders: [{ path: folder, description: "Reports" }],
      });
      assert(registered.ok, JSON.stringify(registered));
      const place = { kind: "project" as const, id: project };
      const lophn = coreLophnSource(core.source);
      const created = await lophn.createSeries({
        place,
        name: "weekly",
        title: "Weekly report",
        format: "document",
        direction: "ascending",
        nextRule: "P{n+1:03}",
      });
      assert(created.ok, JSON.stringify(created));

      // 이 key로 쓰기: 가족 draft만 선다. 예정 문서는 아직 읽을 수 없다(R11).
      const drafted = await lophn.startDraft(created.value, "P001");
      assert(drafted.ok, JSON.stringify(drafted));
      const draft = drafted.value.draft;
      assert(draft !== null);
      assertEquals(draft.key, "P001");
      assertEquals(await lophn.latestVersion(draft.document), {
        ok: true,
        value: null,
      });

      // 편집 종료가 main의 첫 판 통로로 저장한다.
      const creator = createDocumentCreator({
        port: () => coreCreatePort(core.mainCalls),
      });
      const writer = new NewDocumentSession({
        text: "# P001\n\n",
        port: {
          create: (input) =>
            creator.create({
              document: draft.document,
              request_key: input.request_key,
              title: "P001",
              place,
              name: "p001",
              bytes: input.bytes,
            }),
          async lookup() {
            const found = await lophn.latestVersion(draft.document);
            return found.ok ? found.value : undefined;
          },
        },
      });
      writer.edit("# P001\n\nfirst week\n");
      assert(await writer.flush(false));
      assertEquals(writer.facts.state, "draft");
      assert(await writer.flush(true));
      assertEquals(writer.facts.state, "saved");
      const v1 = writer.facts.version!;
      // 같은 저장이 멤버 가입과 draft 비움을 했다.
      const family = await lophn.series(created.value.id);
      assert(family.ok, JSON.stringify(family));
      assertEquals(family.value.series.draft, null);
      assertEquals(
        family.value.members.map((member) => [member.key, member.document]),
        [["P001", draft.document]],
      );
      assertEquals(family.value.members[0]!.version, v1);

      // 첫 판 뒤의 고침은 그 문서의 working copy로 쓴다.
      const adapter = createFileAdapter({
        port: () => coreFilesPort(core.mainCalls),
        log: () => {},
      });
      const opened = await adapter.open(1, draft.document);
      assert(opened.ok, JSON.stringify(opened));
      assertEquals(opened.value.target, "working_copy");
      assertEquals(opened.value.text, "# P001\n\nfirst week\n");
      const handle = opened.value.session;
      const save = new SaveSession({
        port: {
          write: (input) => adapter.write(1, { session: handle, ...input }),
          lookup: (key) =>
            adapter.lookup(1, { session: handle, request_key: key }),
        },
        baseHash: opened.value.base_hash,
        text: opened.value.text,
        clock: still,
      });
      save.edit("# P001\n\nfirst week, mine\n");
      assert(await save.flush(false));
      assertEquals(save.facts.disk.state, "saved");
      assertEquals(save.facts.version.state, "waiting");

      // 그 사이 다른 쪽이 새 판을 저장한다.
      const theirs = encoder.encode("# P001\n\nfirst week, theirs\n");
      const hash = sha256(theirs);
      const uploaded = await core.mainCalls.upload("documents", "upload", {
        blob_hash: hash,
        bytes: theirs.byteLength,
      }, theirs);
      assert(uploaded.ok, JSON.stringify(uploaded));
      const prepared = await core.mainCalls.internal(
        "worker",
        "documents",
        "prepare",
        {
          document: draft.document,
          base_version: v1,
          files: [{
            path: "p001.md",
            blob_hash: hash,
            bytes: theirs.byteLength,
            media_type: "text/markdown",
            primary: true,
            content: { kind: "prepared", blob: uploaded.value },
          }],
          source: null,
          idempotency_key: "theirs-prepare-0001",
        },
      );
      assert(prepared.ok, JSON.stringify(prepared));
      const ref = (prepared.value as { preparation_ref: string })
        .preparation_ref;
      const saved = await core.mainCalls.internal(
        "command",
        "documents",
        "save",
        {
          input: prepared.value,
          idempotency_key: "theirs-prepare-0001",
          compare: { base_version: v1 },
          prepared: [ref],
        },
      );
      assert(saved.ok, JSON.stringify(saved));
      const v2 = (saved.value as { version: string }).version;

      // 편집 종료: 파일은 썼지만 판 확정은 새 최신 판과 충돌로 멈춘다.
      assert(await save.flush(true));
      assertEquals(save.facts.disk.state, "saved");
      assertEquals(save.facts.version.state, "conflict");
      assertEquals(save.facts.version.latest, v2);

      // 해결 화면은 최신 판 본문을 읽어 비교한다(제품 core의 worker documents/read).
      const source = coreEditorSource(core.source);
      const latest = await until("최신 판 본문", async () => {
        const body: BodyState = await source.body(
          draft.document,
          v2,
          () => {},
        );
        return body.kind === "text" && body.complete ? body.text : undefined;
      });
      assertEquals(latest.trimEnd(), "# P001\n\nfirst week, theirs");

      // 내 글을 고르면 최신 판을 새 기준으로 판을 확정한다.
      await save.keepMineAsVersion(v2);
      assertEquals(save.facts.version.state, "confirmed");
      const after = await lophn.latestVersion(draft.document);
      assert(after.ok && after.value !== null && after.value !== v2);
      // 가족은 같은 멤버 하나다. 멤버 수정은 새 판일 뿐 새 멤버가 아니다.
      const again = await lophn.series(created.value.id);
      assert(again.ok);
      assertEquals(again.value.members.length, 1);
    } catch (error) {
      throw new Error(
        `${(error as Error).message}\n--- core ---\n${core.log()}`,
      );
    } finally {
      await core.stop();
      await Deno.remove(folder, { recursive: true });
    }
  },
});
