// usage: node ready.js [extra-done-ids,comma,separated]
// docs/plan/<concern>.md의 task 중 선행이 모두 완료이고 자신은 완료가 아닌 것을 보인다.
const fs = require("fs");
const dir = "/home/pyosechang/projects/lophn/docs/plan";
const extra = new Set((process.argv[2] || "").split(",").filter(Boolean));
const tasks = new Map();
for (
  const f of fs.readdirSync(dir).filter((f) =>
    f.endsWith(".md") && f !== "README.md"
  )
) {
  const concern = f.replace(/\.md$/, "");
  const text = fs.readFileSync(`${dir}/${f}`, "utf8");
  const parts = text.split(/^### /m).slice(1);
  for (const part of parts) {
    const m = /^(T\d+)\s+(.*)/.exec(part);
    if (!m) continue;
    const id = `${concern}#${m[1]}`;
    const status = (/^- 상태:\s*(.*)$/m.exec(part) || [, ""])[1];
    const pre = (/^- 선행:\s*(.*)$/m.exec(part) || [, ""])[1];
    const deps = [];
    for (const tok of pre.replace(/\([^)]*\)/g, " ").split(/[,，、\s]+/)) {
      const t = tok.replace(/[()`]/g, "");
      let d = /^([a-z-]+)#(T\d+)$/.exec(t);
      if (d) deps.push(`${d[1]}#${d[2]}`);
      else if ((d = /^(T\d+)$/.exec(t))) deps.push(`${concern}#${d[1]}`);
    }
    const early = /^- 선행 풀기\(사람 결정/m.test(part);
    tasks.set(id, { id, title: m[2].trim(), status, deps, early });
  }
}
const done = (id) => extra.has(id) || /^완료/.test(tasks.get(id)?.status || "");
for (const t of tasks.values()) {
  if (done(t.id) || /^미룸/.test(t.status)) continue;
  if (t.early || t.deps.every(done)) {
    console.log(`READY ${t.id} | ${t.title} | ${t.status.slice(0, 80)}`);
  }
}
