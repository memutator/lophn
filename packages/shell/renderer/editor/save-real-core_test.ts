// 실제 core 위의 편집기 저장 흐름(shell#T17). fake core는 파일 통로의 응답 모양을 잘못 흉내 내도
// 통과하므로 temp LOPHN_HOME core에 temp 폴더 프로젝트를 등록하고, main의 파일 adapter·core
// port와 renderer의 저장 흐름을 그대로 이어 실제 파일이 바뀌는지 본다. Electron IPC와 main의
// contract client는 빠진다(client의 byte route는 desktop/core/byte-routes_test.ts가 본다).
// 사람 데이터 root(~/.lophn)와 실제 사람 폴더는 열지 않는다.
import { assert, assertEquals } from "@std/assert";

import { coreFilesPort } from "../../main/editor/core-port.ts";
import { createFileAdapter, sha256 } from "../../main/editor/file-adapter.ts";
import { coreLauncherSource } from "../desktop/launcher/core-source.ts";
import { shortNameOf } from "../desktop/launcher/model.ts";
import { newId } from "../desktop/lophn-space/model.ts";
import { startRealCore } from "../testdata/real-core.ts";
import { coreTrackingSource } from "../workspace/tracking/core-source.ts";
import { type SaveClock, SaveSession } from "./save-state.ts";

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
    "shell/editor#R1 shell/editor#R2 shell/editor#R12 shell/editor#R15: 실제 core에서 고침은 main 파일 adapter로 원자 교체되고, 판 확정은 따로 보이며, 바깥 변경은 충돌로 멈춘 뒤 사람이 고른 글만 쓴다",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-editor-save-" }),
    );
    const file = `${folder}/plan.md`;
    await Deno.writeTextFile(file, "# Plan\n\nfirst\n");
    const core = await startRealCore();
    try {
      // 프로젝트를 등록하고 추적을 켠다. 첫 관측이 문서 하나를 만든다.
      const id = newId("prj");
      const launcher = coreLauncherSource(core.source, undefined);
      const registered = await launcher.register({
        id,
        name: shortNameOf("Plans", []),
        title: "Plans",
        purpose: "",
        folders: [{ path: folder, description: "Plans" }],
      });
      assert(registered.ok, JSON.stringify(registered));
      const tracking = coreTrackingSource(core.source);
      const project = await tracking.project(id);
      assert(project.ok, JSON.stringify(project));
      const preview = await tracking.preview(
        project.value,
        project.value.proposal,
      );
      assert(preview.ok, JSON.stringify(preview));
      const applied = await tracking.apply(project.value, preview.value);
      assert(applied.ok, JSON.stringify(applied));
      // 추적으로 생긴 문서는 아직 자리(place)가 없다. 전체 목록에서 그 파일의 문서를 찾는다.
      const document = await until("문서", async () => {
        const listed = await core.source.call({
          kind: "read",
          resource: "documents",
          method: "list",
          body: {},
        });
        if (!listed.ok) return undefined;
        const rows = (listed.value as {
          documents: { document: { id: string } }[];
        }).documents;
        return rows.length === 1 ? rows[0]!.document : undefined;
      });

      // main의 파일 adapter. renderer는 handle만 받고 경로를 받지 않는다.
      const adapter = createFileAdapter({
        port: () => coreFilesPort(core.mainCalls),
        log: () => {},
      });
      const opened = await adapter.open(1, document.id);
      assert(opened.ok, JSON.stringify(opened));
      assertEquals(opened.value.text, "# Plan\n\nfirst\n");
      assertEquals(
        opened.value.base_hash,
        sha256(encoder.encode("# Plan\n\nfirst\n")),
      );
      assertEquals(opened.value.target, "project_file");
      assertEquals(
        Object.values(opened.value).some((value) =>
          typeof value === "string" && value.includes(folder)
        ),
        false,
      );
      const handle = opened.value.session;
      // 다른 창(webContents)은 이 handle을 쓰지 못한다.
      assertEquals(
        await adapter.write(2, {
          session: handle,
          request_key: "other-window-write-1",
          base_hash: opened.value.base_hash,
          bytes: encoder.encode("nope"),
          end: false,
        }),
        { ok: false, code: "unknown_session" },
      );

      const writes: boolean[] = [];
      const save = new SaveSession({
        port: {
          write: (input) => {
            writes.push(input.end);
            return adapter.write(1, { session: handle, ...input });
          },
          lookup: (key) =>
            adapter.lookup(1, { session: handle, request_key: key }),
        },
        baseHash: opened.value.base_hash,
        text: opened.value.text,
        clock: still,
      });

      // 자동 저장: 파일만 쓴다. version은 편집 종료를 기다린다.
      save.edit("# Plan\n\nsecond\n");
      assert(await save.flush(false));
      assertEquals(await Deno.readTextFile(file), "# Plan\n\nsecond\n");
      assertEquals(save.facts.disk.state, "saved");
      assertEquals(save.facts.record.state, "recorded");
      assertEquals(save.facts.version.state, "waiting");
      assertEquals(writes, [false]);

      // 편집 종료(CommandOrControl+S·탭 닫기와 같은 경계): 지금 바이트로 종료를 한 번 보낸다.
      assert(await save.flush(true));
      assertEquals(writes, [false, true]);
      assertEquals(save.facts.disk.state, "saved");
      assertEquals(save.facts.version.state, "preparing");
      assertEquals(save.facts.format.state, "passed");
      // 고침이 없으면 종료를 다시 보내지 않는다.
      assert(await save.flush(true));
      assertEquals(writes, [false, true]);

      // 판 확정은 documents의 관측 결과(files.watch)로만 안다. shell timer는 없다.
      let cursor: string | undefined;
      await until("판 확정", async () => {
        const watched = await adapter.watch(1, { session: handle, cursor });
        if (!watched.ok) return undefined;
        cursor = watched.value.cursor;
        save.applyStatus(watched.value);
        return save.facts.version.state === "confirmed" ? true : undefined;
      });

      // 바깥에서 고치면 다음 쓰기는 충돌로 멈추고 파일은 그대로다. 초안은 남는다.
      await Deno.writeTextFile(file, "# Plan\n\noutside\n");
      save.edit("# Plan\n\nmine\n");
      assertEquals(await save.flush(false), false);
      assertEquals(save.facts.disk.state, "conflict");
      assertEquals(save.text, "# Plan\n\nmine\n");
      assertEquals(await Deno.readTextFile(file), "# Plan\n\noutside\n");
      // 충돌 중 고침은 쓰지 않는다.
      save.edit("# Plan\n\nmine, more\n");
      assertEquals(await save.flush(false), false);
      assertEquals(await Deno.readTextFile(file), "# Plan\n\noutside\n");

      // 해결 화면은 지금 파일과 비교한다. 사람이 내 글을 고르면 지금 파일 위에 쓴다.
      const current = await adapter.current(1, { session: handle });
      assert(current.ok, JSON.stringify(current));
      assertEquals(current.value.text, "# Plan\n\noutside\n");
      await save.keepMine(current.value.hash);
      assertEquals(save.facts.disk.state, "saved");
      assertEquals(await Deno.readTextFile(file), "# Plan\n\nmine, more\n");
      // 폴더에 임시 파일이 남지 않는다.
      const names: string[] = [];
      for await (const entry of Deno.readDir(folder)) names.push(entry.name);
      assertEquals(names, ["plan.md"]);
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
