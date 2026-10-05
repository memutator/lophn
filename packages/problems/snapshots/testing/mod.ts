// snapshots leaf의 테스트 전용 fixture(code-map.md 의존 규칙: 제품 코드와
// mod.ts는 import하지 않는다). 임시 준비 폴더와 실제 SHA-256 준비 경계를 만든다.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { err, ok } from "../../../base/mod.ts";
import type { SnapshotBlobPrepare } from "../mod.ts";

// 임시 준비 폴더. `apps/<app ID>/bundles/<bundle hash>/`에 고정 이름 파일을
// 0444로 봉한다(releases/bundle/seal.ts와 같은 모양). 요구 번호로 시작하는
// 테스트만 import한다.
export function preparedFolder(): {
  root: string;
  seal: (app: string, bundleHash: string, files: {
    path: string;
    content: string;
  }[]) => Promise<string>;
  symlink: (
    app: string,
    bundleHash: string,
    name: string,
    to: string,
  ) => Promise<string>;
  close: () => void;
} {
  const root = fileURLToPath(new URL("./", import.meta.url));
  const directory = Deno.makeTempDirSync({
    dir: root,
    prefix: "snapshot-prepare-",
  });
  return {
    root: directory,
    async seal(app, bundleHash, files) {
      const copy = `${directory}/apps/${app}/bundles/${bundleHash}`;
      // Deno의 recursive mkdir은 mode를 중간 dir에도 적용하므로 기본 mode로
      // 만들고 뒤에 chmod한다.
      await Deno.mkdir(copy, { recursive: true });
      for (const file of files) {
        const target = `${copy}/${file.path}`;
        await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
          recursive: true,
        });
        await Deno.writeTextFile(target, file.content, { mode: 0o444 });
      }
      for (const dir of walkDirs(copy)) {
        Deno.chmodSync(dir, 0o555);
      }
      Deno.chmodSync(copy, 0o555);
      return copy;
    },
    async symlink(app, bundleHash, name, to) {
      const copy = `${directory}/apps/${app}/bundles/${bundleHash}`;
      // seal()이 이미 봉인한 dir에 새 entry를 만들 수 없으므로(seal 후
      // chmod한 모양 그대로) 쓰기 권한을 되돌렸다가 만들고 다시 봉인한다.
      try {
        Deno.chmodSync(copy, 0o700);
      } catch { /* 아직 없는 dir */ }
      await Deno.mkdir(copy, { recursive: true });
      const target = `${copy}/${name}`;
      await Deno.symlink(to, target);
      Deno.chmodSync(copy, 0o555);
      return target;
    },
    close() {
      // 봉인 폴더를 비우기 위해 mode를 되돌린다.
      try {
        for (const entry of walkDirs(directory)) {
          Deno.chmodSync(entry, 0o700);
        }
        for (const file of walkFiles(directory)) {
          Deno.chmodSync(file, 0o600);
        }
      } catch { /* 이미 정리된 폴더 */ }
      Deno.removeSync(directory, { recursive: true });
    },
  };
}

function walkDirs(root: string): string[] {
  const dirs: string[] = [];
  const visit = (path: string) => {
    for (const entry of Deno.readDirSync(path)) {
      const full = `${path}/${entry.name}`;
      if (entry.isDirectory) {
        dirs.push(full);
        visit(full);
      }
    }
  };
  visit(root);
  return dirs;
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    for (const entry of Deno.readDirSync(path)) {
      const full = `${path}/${entry.name}`;
      if (entry.isDirectory) visit(full);
      else files.push(full);
    }
  };
  visit(root);
  return files;
}

// 실제 SHA-256으로 bytes를 hash하는 준비 경계(snapshots#R5). 등록 메모리는
// 없다: 조립이 hash를 받는 것만 본다.
export function realPrepare(): {
  prepare: SnapshotBlobPrepare["prepare"];
  calls: { principal: string; purpose: string; size_bytes: number }[];
  fail: (message: string) => void;
} {
  const calls: { principal: string; purpose: string; size_bytes: number }[] =
    [];
  let failure: string | null = null;
  const prepare: SnapshotBlobPrepare["prepare"] = async (input, bytes) => {
    calls.push({
      principal: input.principal,
      purpose: input.purpose,
      size_bytes: -1,
    });
    if (failure !== null) {
      return err({ code: "unavailable", message: failure });
    }
    const chunks: Uint8Array[] = [];
    await bytes.pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(chunk);
        },
      }),
    );
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    calls[calls.length - 1]!.size_bytes = total;
    return ok({
      preparation: `prep_${calls.length}`,
      principal: input.principal,
      purpose: input.purpose,
      hash: createHash("sha256").update(data).digest("hex"),
      size_bytes: total,
    });
  };
  return {
    prepare,
    calls,
    fail: (message) => {
      failure = message;
    },
  };
}
