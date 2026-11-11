// 봉인된 bundle 사본의 file을 내용 hash로 store 한 곳(`<data>/bundle-files/<sha256>`)과 hardlink로 나눠 쓴다.
// release마다 `node_modules`를 통째로 담아 같은 byte가 release 수만큼 쌓이기 때문이다. 봉인된 file은 0444라 고쳐지지
// 않으니 inode를 같이 써도 한 사본이 다른 사본을 바꾸지 못한다.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// 실패한 file은 사본에 그대로 둔다. 나눠 쓰기는 공간만 아끼고, 못 해도 사본은 맞다(다른 fs, link 수 한도 등).
async function shareFile(path: string, store: string): Promise<void> {
  const info = await lstat(path);
  // 이미 store와 이어진 file(다시 돈 data step)과, 아껴도 블록이 없는 빈 file은 건너뛴다.
  if (info.nlink > 1 || info.size === 0) return;
  const stored = `${store}/${await hashFile(path)}`;
  try {
    await link(path, stored);
    return;
  } catch {
    // store에 이미 있다. 아래에서 사본 쪽을 store의 file로 바꾼다.
  }
  const temp = `${path}.lophn-share`;
  try {
    await rm(temp, { force: true });
    await link(stored, temp);
    // rename은 원자적이라 도중에 꺼져도 file은 옛 byte나 같은 byte의 link 중 하나다.
    await rename(temp, path);
  } catch {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

// 사본의 폴더는 아직 쓸 수 있어야 한다(봉인 전이거나, data step이 잠시 연 상태). symlink는 따라가지 않는다.
// file 하나씩 돌면 `node_modules`의 작은 file 수천 개에서 syscall 대기가 쌓여, 몇 개를 같이 돈다. 같은 내용이 동시에
// 와도 store에 먼저 link한 쪽이 정본이 되고 나머지는 그것으로 바뀐다.
export async function shareCopyFiles(
  copyPath: string,
  store: string,
): Promise<void> {
  await mkdir(store, { recursive: true });
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await walk(copyPath);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < files.length) {
      const path = files[next++] as string;
      await shareFile(path, store).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: 16 }, lane));
}

// 어느 사본도 쓰지 않는(link가 store 하나뿐인) file을 지운다. 앱을 지운 뒤 부른다.
export async function sweepBundleFiles(store: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(store);
  } catch {
    return;
  }
  for (const name of names) {
    const path = `${store}/${name}`;
    const info = await lstat(path).catch(() => null);
    if (info?.isFile() && info.nlink === 1) {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }
}
