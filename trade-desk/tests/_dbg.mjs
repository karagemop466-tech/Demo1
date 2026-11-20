import fs from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
const html = fs.readFileSync("/home/user/Demo1/trade-desk/resolutions.html","utf8");
const calls=[];
const dom = new JSDOM(html,{url:"https://x.github.io/Demo1/trade-desk/resolutions.html",runScripts:"dangerously",virtualConsole:new VirtualConsole(),
beforeParse(w){ w.fetch=async(i)=>{const u=typeof i==="string"?i:i.url;calls.push(u);
  if(u.includes("series-map")){const m={total:5,map:{KXAAAGASW:["gas","Economics","US gas price up","Oil and energy"],KXPGAWIN:["golf","Sports","PGA Tournament Winner","Golf"]}};return {ok:true,status:200,json:async()=>m,text:async()=>JSON.stringify(m)};}
  const p=new URL(u).pathname.replace("/trade-api/v2","");
  if(p==="/markets"){const q=new URL(u).searchParams;
    if(q.get("status")==="settled") return {ok:true,status:200,json:async()=>({markets:[
      {ticker:"KXAAAGASW-26NOV16-3.5",event_ticker:"KXAAAGASW-26NOV16",title:"gas",status:"finalized",result:"yes",settlement_value_dollars:"1.0000",settlement_ts:new Date().toISOString()},
      {ticker:"KXPGAWIN-THRC26-SSCH",event_ticker:"KXPGAWIN-THRC26",title:"golf",status:"finalized",result:"no",settlement_value_dollars:"0.0000",settlement_ts:new Date().toISOString()}],cursor:""}),text:async()=>""};
    return {ok:true,status:200,json:async()=>({markets:[],cursor:""}),text:async()=>""};}
  const ev=/^\/events\/([^/]+)$/.exec(p);
  if(ev) return {ok:true,status:200,json:async()=>({event:{event_ticker:ev[1],series_ticker:ev[1].split("-")[0],settlement_sources:[]}}),text:async()=>""};
  return {ok:true,status:200,json:async()=>({}),text:async()=>""};};w.alert=()=>{};}});
const w=dom.window;
for(const f of ["assets/util.js","assets/api.js","assets/resolutions.js"]) w.eval(fs.readFileSync("/home/user/Demo1/trade-desk/"+f,"utf8"));
w.document.dispatchEvent(new w.Event("DOMContentLoaded",{bubbles:true}));
await new Promise(r=>setTimeout(r,900));
console.log("settled rows:", w.__resolutions.state.settled.length);
console.log(w.__resolutions.state.settled.map(s=>s.ticker+" topic="+s.topic));
console.log("calls:", calls.slice(0,6));
console.log("rows in DOM:", w.document.querySelectorAll("#resolution-table tbody tr").length);
