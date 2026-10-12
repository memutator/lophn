// flow install-lophn의 Linux 단계(platform#T48): 설치된 .deb 묶음을 임시 HOME·LOPHN_HOME으로
// 시작해 본다. 설치 묶음은 `/opt/lophn`(또는 LOPHN_INSTALL_ROOT)에 실제로 설치돼 있어야 하고
// chrome-sandbox가 root 소유 4755여야 한다. 설치 전이면 이 시험은 통과가 아니라 건너뛴다:
// 풀어 놓은 묶음이나 sandbox를 끈 실행은 배포 시험 통과로 세지 않는다(install-and-update#R1).
//   1. sudo dpkg -i build/linux/lophn_<version>_amd64.deb (사람 또는 CI가 한다)
//   2. deno task e2e install-lophn
//
// flow install-lophn 1단계(docs/flows/install-lophn.md): 아래 두 번째 test는 root 설치 없이 .deb를
// 만들어 풀어 놓은 임시 폴더에서 패키지와 검증 여부를 본다. 실제 설치(dpkg -i·root 소유 4755·실제
// sandbox)는 이 환경에서 하지 않고 ignore step으로 둔다. 2단계 이후는 보지 않는다.
// 이미 만든 .deb를 쓰려면 `LOPHN_E2E_DEB=<파일>`을 준다(없으면 tools/package-linux.ts로 임시 폴더에 만든다).
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { checkSandboxFile } from "../../packages/core/install-and-update/mod.ts";
import { displayAvailable } from "../harness.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const root = Deno.env.get("LOPHN_INSTALL_ROOT") ?? "/opt/lophn";

function installed(): boolean {
  if (Deno.env.get("LOPHN_E2E") !== "1" || !displayAvailable()) return false;
  try {
    const stat = Deno.statSync(`${root}/chrome-sandbox`);
    return checkSandboxFile({
      uid: stat.uid ?? -1,
      gid: stat.gid ?? -1,
      mode: stat.mode ?? 0,
    }).ok;
  } catch {
    return false;
  }
}

Deno.test({
  name:
    "platform/install-and-update#R1: 설치된 Linux 묶음이 배치·Deno·cached-only 시작·cache 삭제·실제 sandbox 확인을 모두 통과한다",
  ignore: !installed(),
  async fn() {
    const verified = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        `${repoRoot}/tools/verify-linux-install.ts`,
        "--root",
        root,
      ],
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    // 0은 모든 항목 통과, 1은 실패, 2는 미확인이 남음이다.
    assertEquals(verified.code, 0);
  },
});

const NOT_INSTALLABLE_HERE = "이 환경에서 root 설치 불가, T48 미검증";

async function runText(
  command: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): Promise<{ code: number; stdout: string }> {
  const out = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (!out.success && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed (${out.code})`);
  }
  return { code: out.code, stdout: new TextDecoder().decode(out.stdout) };
}

// 안전: root로 풀면 root 소유 4755가 되어 검증 도구가 실제 desktop을 띄운다. 이 test는 일반 사용자
// 권한으로 풀어 놓은 폴더만 본다.
function unpackable(): boolean {
  return Deno.env.get("LOPHN_E2E") === "1" && Deno.build.os === "linux" &&
    Deno.uid() !== 0;
}

Deno.test({
  name:
    "platform/install-and-update#R1 platform/install-and-update#R2 platform/install-and-update#R3 flow install-lophn 1: Linux는 .deb 패키지를 만들고 풀어 놓은 묶음의 검증 여부를 미검증으로 알린다",
  ignore: !unpackable(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const work = await Deno.makeTempDir({ prefix: "lophn-e2e-install-" });
    const reused = Deno.env.get("LOPHN_E2E_DEB");
    try {
      let deb = reused;
      let outDir: string | undefined;
      if (deb === undefined) {
        outDir = `${work}/out`;
        const built = await new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--allow-all",
            `${repoRoot}/tools/package-linux.ts`,
            "--out",
            outDir,
          ],
          stdout: "null",
          stderr: "inherit",
        }).output();
        assert(built.success, "tools/package-linux.ts가 .deb를 만들지 못했다");
        const names: string[] = [];
        for await (const entry of Deno.readDir(outDir)) names.push(entry.name);
        const debs = names.filter((name) => name.endsWith(".deb"));
        assertEquals(debs.length, 1, names.join(", "));
        deb = `${outDir}/${debs[0]}`;
        // AppImage는 sandbox를 확인한 환경에서만 대안으로 안내하므로 기본 산출물에 없다.
        assertEquals(names.filter((name) => /appimage/i.test(name)), []);
      }

      await t.step("권장 설치는 .deb이고 패키지 이름·구조가 맞다", async () => {
        assert(deb!.endsWith("_amd64.deb"), deb);
        const field = async (name: string) =>
          (await runText("dpkg-deb", ["--field", deb!, name])).stdout.trim();
        assertEquals(await field("Package"), "lophn");
        assertEquals(await field("Architecture"), "amd64");
        const listing = (await runText("dpkg-deb", ["-c", deb!])).stdout
          .split("\n");
        const entry = (path: string) =>
          listing.find((line) => line.endsWith(` ${path}`));
        // chrome-sandbox는 root 소유 setuid 4755다(sandbox를 끄는 일반 해결책은 없다).
        const sandbox = entry("./opt/lophn/chrome-sandbox");
        assert(sandbox !== undefined, "chrome-sandbox가 묶음에 없다");
        assert(
          /^-rwsr-xr-x root\/root /.test(sandbox),
          `chrome-sandbox가 root 소유 4755가 아니다: ${sandbox}`,
        );
        for (
          const path of [
            "./opt/lophn/deno",
            "./opt/lophn/lophn-credential",
            "./opt/lophn/lophn-desktop",
            "./opt/lophn/platform/deno.json",
            "./opt/lophn/platform/deno.lock",
            "./usr/bin/lophn",
            "./usr/bin/lophn-mcp",
            "./usr/share/applications/lophn.desktop",
          ]
        ) {
          assert(entry(path) !== undefined, `${path}가 묶음에 없다`);
        }
        assert(
          listing.some((line) => / \.\/usr\/bin\/lophn-desktop -> /.test(line)),
          "lophn-desktop 실행 이름이 묶음에 없다",
        );
      });

      const unpacked = `${work}/unpacked`;
      const control = `${work}/control`;
      await runText("dpkg-deb", ["-x", deb, unpacked]);
      await runText("dpkg-deb", ["-e", deb, control]);

      await t.step("sandbox를 끄는 옵션이 설치 파일에 없다", async () => {
        const files = [
          `${unpacked}/usr/bin/lophn`,
          `${unpacked}/usr/bin/lophn-mcp`,
          `${unpacked}/usr/share/applications/lophn.desktop`,
          `${control}/postinst`,
        ];
        for (const file of files) {
          const text = await Deno.readTextFile(file);
          assert(
            !/no-sandbox|disable-setuid-sandbox/.test(text),
            `${file}에 sandbox 해제가 있다`,
          );
        }
      });

      await t.step(
        "풀어 놓은 묶음의 검증은 sandbox 두 항목을 미검증으로 남기고 사용 가능이라 하지 않는다",
        async () => {
          const verified = await runText(
            Deno.execPath(),
            [
              "run",
              "--allow-all",
              `${repoRoot}/tools/verify-linux-install.ts`,
              "--root",
              `${unpacked}/opt/lophn`,
              "--bin",
              `${unpacked}/usr/bin`,
            ],
            { allowFailure: true },
          );
          // 0은 모두 통과, 1은 실패, 2는 미확인이 남음이다.
          assertEquals(verified.code, 2, verified.stdout);
          const lines = verified.stdout.split("\n");
          assertEquals(
            lines.filter((line) => line.startsWith("FAIL")),
            [],
          );
          const unverified = lines.filter((line) =>
            line.startsWith("UNVERIFIED")
          );
          assertEquals(unverified.length, 2, verified.stdout);
          assertStringIncludes(
            unverified[0],
            "R3 chrome-sandbox root 소유 4755",
          );
          assertStringIncludes(unverified[1], "실제 sandbox 활성");
          assertStringIncludes(
            verified.stdout,
            "Linux 배포를 사용 가능으로 표시하지 않는다",
          );
          assert(!verified.stdout.includes("모든 항목 통과"));
        },
      );

      await t.step({
        name:
          `실제 설치(dpkg -i, root 소유 4755)와 실제 sandbox 활성: ${NOT_INSTALLABLE_HERE}`,
        ignore: true,
        fn() {},
      });
    } finally {
      await Deno.remove(work, { recursive: true }).catch(() => undefined);
    }
  },
});
