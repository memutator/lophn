import { assertEquals } from "@std/assert";
import { checkFetchTarget } from "./target.ts";

Deno.test("web.fetch는 loopback과 사설 주소로 나가지 않는다", () => {
  const cases: [string, boolean][] = [
    ["https://example.com/a?b=1", true],
    ["http://93.184.216.34/", true],
    ["http://172.32.0.1/", true],
    ["http://[2606:4700::1111]/", true],
    ["ftp://example.com/", false],
    ["file:///etc/passwd", false],
    ["http://localhost:8080/", false],
    ["http://foo.localhost/", false],
    ["http://127.0.0.1/", false],
    ["http://127.9.9.9:3000/", false],
    ["http://2130706433/", false],
    ["http://0x7f.1/", false],
    ["http://[::1]/", false],
    ["http://[::ffff:127.0.0.1]/", false],
    ["http://10.0.0.5/", false],
    ["http://172.16.0.1/", false],
    ["http://172.31.255.255/", false],
    ["http://192.168.1.1/", false],
    ["http://169.254.169.254/latest/meta-data/", false],
    ["http://[fe80::1]/", false],
    ["http://[fd00::1]/", false],
    ["not a url", false],
  ];
  for (const [url, allowed] of cases) {
    assertEquals(checkFetchTarget(url).ok, allowed, url);
  }
});
