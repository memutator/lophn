const {execSync}=require("child_process");
const at=process.argv[2];
const c=execSync(`git rev-list -1 --before="${at}" origin/main`).toString().trim();
if(!c){console.log(at,"-");process.exit(0)}
const files=execSync(`git ls-tree --name-only ${c} docs/plan/`).toString().trim().split("\n").filter(f=>f.endsWith(".md")&&!f.endsWith("README.md"));
let d=0,n=0;for(const f of files){const s=execSync(`git show ${c}:${f}`).toString();for(const b of s.split(/\n### /).slice(1)){if(!/^T\d+/.test(b))continue;n++;const st=(b.match(/\n- 상태: (\S+)/)||[])[1]||"";if(st.startsWith("완료"))d++}}
console.log(at, d+"/"+n);
