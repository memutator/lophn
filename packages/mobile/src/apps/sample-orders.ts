// The sample computer's Orders app on the phone (dev builds only): its phone screens as built plain JS (the shape core's
// screen build gives: the host modules through `require`, the evaluation inside try/catch), their manifests, and fake
// answers for the screen list, the screen files and the view routes. Ten seconds after Orders first opens, Release 8
// goes live (it adds the Last 7 days filter), so the update line can be seen. Two more screens open from the menu and
// are refused (one needs a newer phone app, one was built with an old kit), and one breaks while it draws.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { PhoneManifest } from "../../../protocol/apps/phone-screen.ts";
import type { BusEvent } from "../../../protocol/events/mod.ts";
import { guestHostInfo } from "./guest/host-info.ts";

const orders = (release: 7 | 8) => `try{(function(){
var React=require("react"),RN=require("react-native"),K=require("@lophn/ui-native"),A=require("@lophn/app-ui-native"),L=require("lucide-react-native");
var h=React.createElement;
function Orders(){
  var list=A.useOperation({name:"orders.list"});
  var ship=A.useOperation({name:"orders.mark_shipped"});
  var got=React.useState(null),data=got[0],setData=got[1];
  var on=React.useState(1),filter=on[0],setFilter=on[1];
  var load=function(){list.run({}).then(function(r){if(r&&r.ok)setData(r.value)})};
  React.useEffect(load,[]);
  A.useEvent("orders","changed",load);
  if(data===null)return null;
  var rows=data.orders.filter(function(o){return ${release === 8 ? "filter!==2||o.state===\"Open\"" : "true"}});
  var theme=K.useTheme();
  return h(RN.ScrollView,{style:{flex:1,backgroundColor:theme.color.surface.floor}},
    h(RN.View,{style:{paddingTop:12,paddingHorizontal:16,paddingBottom:32,gap:16}},
      h(RN.View,{style:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}},
        h(K.Text,{variant:"h1",weight:"semibold"},"Orders"),
        h(K.Button,{variant:"primary",icon:L.Plus},"New order")),
      h(RN.View,{style:{flexDirection:"row",flexWrap:"wrap",rowGap:14}},
        h(RN.View,{style:{width:"50%"}},h(K.Stat,{label:"Open",value:String(data.open)})),
        h(RN.View,{style:{width:"50%"}},h(K.Stat,{label:"Shipped today",value:String(data.shipped)})),
        h(RN.View,{style:{width:"100%"}},h(K.Stat,{label:"Revenue today",value:data.revenue,unit:"USD"}))),
      ${release === 8 ? 'h(K.FilterChips,{items:["All","Last 7 days","Open"],on:filter,onChange:setFilter}),' : ""}
      h(K.ListCard,null,rows.map(function(o,at){
        return h(React.Fragment,{key:o.id},at>0?h(K.Divider,null):null,
          h(K.Row,{title:o.id+" · "+o.who,sub:o.state+" · "+o.total,
            end:o.state==="Open"?h(K.Button,{size:"sm",onPress:function(){ship.run({id:o.id})}},"Mark shipped"):undefined}));
      }))));
}
globalThis.__lophnMount(Orders)})()}catch(e){globalThis.__lophnFatal(e)}`;

const BROKEN = `try{(function(){
var React=require("react");
function Customers(){throw new Error("customers is not defined")}
globalThis.__lophnMount(Customers)})()}catch(e){globalThis.__lophnFatal(e)}`;

const ORDERS = [
  { id: "#1043", who: "Hana Park", state: "Open", total: "$18.50" },
  { id: "#1042", who: "Dae Kim", state: "Open", total: "$41.99" },
  { id: "#1041", who: "Jun Seo", state: "Shipped", total: "$73.00" },
  { id: "#1040", who: "Ari Choi", state: "Shipped", total: "$9.20" },
];

const MODULES = ["react", "react-native", "@lophn/ui-native", "@lophn/app-ui-native", "lucide-react-native"];

function manifestOf(js: string, kit?: Partial<PhoneManifest["kit"]>): PhoneManifest {
  const bytes = new TextEncoder().encode(js);
  const host = guestHostInfo();
  return {
    format: 1,
    entry: "phone.js",
    size: bytes.byteLength,
    sha256: bytesToHex(sha256(bytes)),
    base: host.base,
    kit: { "@lophn/ui-native": host.kit, "@lophn/app-ui-native": host.app_ui_native, ...kit },
    modules: MODULES,
  };
}

function base64Of(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type Answer = (body: Record<string, unknown>) => unknown;

/** The routes the sample computer answers for Orders on the phone. `releases` are the ids of Release 7 and 8. */
export function sampleOrdersRoutes(options: {
  app: string;
  releases: readonly [string, string];
  emit: (event: BusEvent) => void;
}): Record<string, Answer> {
  const { app } = options;
  let release: 7 | 8 = 7;
  let updating = false;
  let liveAt = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
  const shipped = new Set<string>();
  const views = new Set<string>();
  const files = () => ({
    orders: orders(release),
    inventory: orders(release),
    reports: orders(release),
    customers: BROKEN,
  });
  const screen = (key: keyof ReturnType<typeof files>, label: string, kit?: Partial<PhoneManifest["kit"]>) => ({
    app,
    app_name: "Orders",
    icon: null,
    screen: key,
    label,
    release: options.releases[release - 7],
    bundle_hash: bytesToHex(sha256(new TextEncoder().encode(`orders release ${release}`))),
    manifest: manifestOf(files()[key], kit),
    running: true,
  });
  const at = () => new Date().toISOString();
  const changed = (names: string[]) =>
    options.emit({
      type: "StateChanged",
      subject: null,
      at: at(),
      payload: { changes: names.map((name) => ({ name, id: null })) },
    } as BusEvent);
  const golive = () => {
    release = 8;
    liveAt = at();
    changed(["releases", "app_runtime"]);
    for (const view of views) {
      const now = screen("orders", "Orders");
      options.emit({
        type: "AppViewEvent",
        subject: app,
        at: at(),
        payload: {
          owner: "sample",
          view,
          kind: "rebound",
          release: now.release,
          bundle_hash: now.bundle_hash,
          process_nonce: "sample-8",
        },
      } as BusEvent);
    }
  };
  const list = () => {
    const rows = ORDERS.map((one) => (shipped.has(one.id) ? { ...one, state: "Shipped" } : one));
    const open = rows.filter((one) => one.state === "Open").length;
    return { orders: rows, open: 10 + open, shipped: 31 + shipped.size, revenue: "4,210" };
  };
  return {
    "apps/phone_screens": () => ({
      as_of_seq: "0",
      next_cursor: null,
      screens: [
        screen("orders", "Orders"),
        screen("inventory", "Inventory", { "@lophn/ui-native": "99.0.0" }),
        screen("reports", "Reports", { "@lophn/app-ui-native": "0.9.0" }),
        screen("customers", "Customers"),
      ],
      previews: [],
    }),
    "apps/screen_file": (body) => {
      const key = body.screen as keyof ReturnType<typeof files>;
      const js = files()[key];
      return js === undefined ? undefined : { content_type: "text/javascript", base64: base64Of(js) };
    },
    "app_views/open": (body) => {
      const view = body.view as string;
      views.add(view);
      if (release === 7 && !updating && body.screen === "orders") {
        updating = true;
        setTimeout(golive, 10_000);
      }
      const now = screen("orders", "Orders");
      return { view, release: now.release, bundle_hash: now.bundle_hash, process_nonce: `sample-${release}`, params: null };
    },
    "app_views/call": (body) => {
      if (body.operation === "orders.mark_shipped") {
        shipped.add((body.input as { id: string }).id);
        for (const view of views) {
          options.emit({
            type: "AppViewEvent",
            subject: app,
            at: at(),
            payload: { owner: "sample", view, kind: "event", source: "orders", event: "changed", payload: null },
          } as BusEvent);
        }
        return { outcome: { ok: true, value: null } };
      }
      if (body.operation === "orders.list") return { outcome: { ok: true, value: list() } };
      return { outcome: { ok: false, error: { code: "forbidden", message: "operation is not available" } } };
    },
    "app_views/close": (body) => ({ closed: views.delete(body.view as string) }),
    "releases/list_records": () => ({
      as_of_seq: "0",
      next_cursor: null,
      releases: [{ number: release, activated_at: liveAt, created_at: liveAt }],
    }),
  };
}
