import assert from "node:assert/strict";
import test from "node:test";
import authHandler from "../api/auth.mjs";
import webhook from "../api/telegram/webhook.mjs";
import { createSessionCookie, parseCookies, readSession } from "../auth-session.mjs";
import { attachChatToToken, consumeVerifiedToken, createLoginToken, createTelegramCookie, isTelegramAuthConfigured, LOGIN_TOKEN_MAX_AGE_MS, markTokenVerified, readTelegramToken } from "../telegram-auth.mjs";
import { resetRateLimits } from "../rate-limit.mjs";

const environment = {
  TELEGRAM_BOT_TOKEN: "123456:fixture_auth_only", TELEGRAM_WEBHOOK_SECRET: "fixture-webhook-secret-12345",
  SESSION_SECRET: "fixture-session-secret-at-least-32-characters", SUPABASE_URL: "https://auth-fixture.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", SITE_URL: "https://neosport.example", ADMIN_PHONES: "998900000000",
};
const cookieHeader = value => (Array.isArray(value) ? value : [value]).map(cookie=>cookie.split(";")[0]).join("; ");
const reply = () => ({ statusCode:200, headers:{}, setHeader(name,value){this.headers[name.toLowerCase()]=value;}, end(body=""){this.body=body;} });

async function fixture(run) {
  const previousFetch=globalThis.fetch, previous=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]]));
  Object.assign(process.env,environment); resetRateLimits();
  const state={tokens:[],users:[],messages:[],requests:[],failDatabase:false};
  const matches=(row,url)=> {
    for(const [key,filter] of url.searchParams){
      if(["select","order","limit"].includes(key))continue;
      if(key==="or") { if(row.chat_id!==null && row.chat_id!==undefined && filter!==`(chat_id.is.null,chat_id.eq.${row.chat_id})`)return false; continue; }
      if(filter.startsWith("eq.")&&String(row[key])!==filter.slice(3))return false;
      if(filter.startsWith("gt.")&&!(Date.parse(row[key])>Date.parse(filter.slice(3))))return false;
      if(filter.startsWith("lt.")&&!(Date.parse(row[key])<Date.parse(filter.slice(3))))return false;
      if(filter.startsWith("in.(")&&!filter.slice(4,-1).split(",").includes(row[key]))return false;
    }
    return true;
  };
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(String(input)),method=options.method||"GET",body=options.body?JSON.parse(options.body):null;
    state.requests.push({host:url.host,path:url.pathname,method,body,query:url.search});
    const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
    if(url.host==="api.telegram.org"){
      assert.ok(url.pathname.startsWith(`/bot${environment.TELEGRAM_BOT_TOKEN}/`));
      if(url.pathname.endsWith("/getMe"))return json({ok:true,result:{id:123456,username:"NeoSportFixtureBot"}});
      assert.ok(url.pathname.endsWith("/sendMessage"),"Only intercepted bot replies are allowed");
      state.messages.push(body);return json({ok:true,result:{message_id:state.messages.length}});
    }
    assert.equal(url.host,"auth-fixture.invalid","Every network call must use the isolated fixture");
    if(state.failDatabase)return json({message:"fixture unavailable"},503);
    const key=url.pathname==="/rest/v1/login_tokens"?"tokens":url.pathname==="/rest/v1/users"?"users":null;
    assert.ok(key,"Unexpected database table");
    if(method==="POST"){
      if(key==="tokens")state.tokens.push({created_at:new Date().toISOString(),chat_id:null,...body});
      else {const known=state.users.find(row=>row.id===body.id);if(known)Object.assign(known,body);else state.users.push(body);}
      return new Response(null,{status:201});
    }
    const rows=state[key].filter(row=>matches(row,url));
    if(method==="GET") {
      if(url.searchParams.has("order"))rows.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
      return json(structuredClone(rows.slice(0,Number(url.searchParams.get("limit"))||rows.length)));
    }
    if(method==="PATCH") {rows.forEach(row=>Object.assign(row,body));return json(structuredClone(rows));}
    assert.equal(method,"DELETE");state[key]=state[key].filter(row=>!rows.includes(row));return new Response(null,{status:204});
  };
  const auth=async(path,{cookie="",method="GET",headers={}}={})=>{
    const response=reply();await authHandler({url:`/api/auth/${path}`,method,headers:{host:"neosport.example",accept:"application/json",cookie,...headers},socket:{remoteAddress:"203.0.113.55"}},response);return response;
  };
  const update=async(message,secret=environment.TELEGRAM_WEBHOOK_SECRET)=>{
    const response=reply();await webhook({method:"POST",headers:{"x-telegram-bot-api-secret-token":secret},body:{message}},response);return response;
  };
  try {await run({state,auth,update});}
  finally{globalThis.fetch=previousFetch;for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
const privateMessage = extra => ({chat:{id:551,type:"private"},from:{id:551,is_bot:false},...extra});

test("Telegram readiness requires the bot, database, webhook and signing secret",()=>{
  assert.equal(isTelegramAuthConfigured(environment),true);
  for(const key of ["TELEGRAM_BOT_TOKEN","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","TELEGRAM_WEBHOOK_SECRET","SESSION_SECRET"])assert.equal(isTelegramAuthConfigured({...environment,[key]:""}),false,key);
  assert.equal(isTelegramAuthConfigured({...environment,TELEGRAM_BOT_TOKEN:"[SENSITIVE]"}),false);
});

test("the deep link cannot be reused as a browser proof and malformed cookies are ignored",()=>{
  const token="a".repeat(32),cookie=createTelegramCookie(token,{environment});
  assert.match(cookie,/HttpOnly; SameSite=Lax/);
  assert.equal(readTelegramToken({headers:{cookie:cookieHeader(cookie)}},environment),token);
  assert.equal(readTelegramToken({headers:{cookie:`ns_tg=${token}`}},environment),null);
  assert.equal(readTelegramToken({headers:{cookie:cookieHeader(cookie)+"x"}},environment),null);
  assert.deepEqual(parseCookies("broken=%E0%A4%A; valid=yes"),{valid:"yes"});
});

test("start → own contact → signed session → account/admin identity, with every service intercepted",()=>fixture(async({state,auth,update})=>{
  const start=await auth("telegram/start?next=%2Fadmin%23stats");
  assert.equal(start.statusCode,200);
  const data=JSON.parse(start.body),token=new URL(data.url).searchParams.get("start");
  assert.match(data.url,/^https:\/\/t\.me\/NeoSportFixtureBot\?start=/);
  assert.equal(data.expiresIn,600);assert.equal(token.length,32);
  const cookie=cookieHeader(start.headers["set-cookie"]);
  let status=JSON.parse((await auth("telegram/status",{cookie})).body);
  assert.equal(status.waiting,true);assert.equal(status.state,"pending");
  await update(privateMessage({text:`/start ${token}`}));
  assert.equal(state.tokens[0].chat_id,"551");
  assert.equal(state.messages[0].reply_markup.keyboard[0][0].request_contact,true);
  await update(privateMessage({contact:{user_id:551,phone_number:"+998 90 000 00 00",first_name:"<Sinov & test>"}}));
  assert.equal(state.users.length,1);assert.equal(state.users[0].id,"tg:551");
  assert.match(state.messages.at(-1).text,/&lt;Sinov &amp; test&gt;/);
  const completed=await auth("telegram/status",{cookie});
  assert.equal(JSON.parse(completed.body).next,"/admin#stats");
  assert.equal(JSON.parse(completed.body).ready,true);
  const sessionCookie=completed.headers["set-cookie"].find(value=>value.startsWith("ns_session="));
  const session=readSession({headers:{cookie:cookieHeader(sessionCookie)}},environment);
  assert.equal(session.phone,"998900000000");assert.equal(session.role,"admin");assert.equal(session.id,"tg:551");
  assert.equal(readSession({headers:{cookie:cookieHeader(sessionCookie)}},{...environment,ADMIN_PHONES:""}).role,"customer");
  assert.equal(state.tokens[0].status,"used");
  const replay=await auth("telegram/status",{cookie});
  assert.equal(JSON.parse(replay.body).ready,false);assert.equal(JSON.parse(replay.body).waiting,false);
  assert.doesNotMatch(cookieHeader(replay.headers["set-cookie"]),/ns_session/);
}));

test("a token is bound once, cannot verify another chat, and is consumed atomically",()=>fixture(async()=>{
  const token=await createLoginToken("/shop",environment);
  assert.equal(await attachChatToToken(token,551,environment),true);
  assert.equal(await attachChatToToken(token,552,environment),false);
  assert.equal(await markTokenVerified(token,{chatId:552,phone:"998900000000",name:"Other"},environment),false);
  assert.equal(await markTokenVerified(token,{chatId:551,phone:"",name:"Empty"},environment),false);
  assert.equal(await markTokenVerified(token,{chatId:551,phone:"998900000000",name:"Sinov"},environment),true);
  const results=await Promise.all([consumeVerifiedToken(token,environment),consumeVerifiedToken(token,environment)]);
  assert.equal(results.filter(Boolean).length,1);
}));

test("expired and malformed attempts stop waiting and cannot be verified",()=>fixture(async({state,auth})=>{
  const token=await createLoginToken("/",environment);
  const cookie=cookieHeader(createTelegramCookie(token,{environment}));
  state.tokens[0].created_at=new Date(Date.now()-LOGIN_TOKEN_MAX_AGE_MS-1000).toISOString();
  assert.equal(await attachChatToToken(token,551,environment),false);
  const expired=await auth("telegram/status",{cookie});
  assert.equal(JSON.parse(expired.body).state,"expired");assert.equal(JSON.parse(expired.body).waiting,false);
  assert.match(expired.headers["set-cookie"],/Max-Age=0/);
  const forged=await auth("telegram/status",{cookie:`ns_tg=${token}`});
  assert.equal(JSON.parse(forged.body).state,"expired");
  const noCookie=await auth("telegram/status");assert.equal(JSON.parse(noCookie.body).state,"idle");
}));

test("webhook rejects forged senders, groups, foreign contacts and an invalid secret",()=>fixture(async({state,update})=>{
  const token=await createLoginToken("/",environment);
  assert.equal((await update(privateMessage({text:`/start ${token}`}),"wrong")).statusCode,401);
  await update({chat:{id:-100,type:"group"},from:{id:551},text:`/start ${token}`});
  await update({chat:{id:551,type:"private"},from:{id:552},text:`/start ${token}`});
  assert.equal(state.tokens[0].chat_id,null);assert.equal(state.messages.length,0);
  await update(privateMessage({text:`/start ${token}`}));
  await update(privateMessage({contact:{user_id:552,phone_number:"998900000000"}}));
  assert.equal(state.tokens[0].status,"pending");assert.equal(state.users.length,0);
  await update(privateMessage({contact:{phone_number:"998900000000"}}));
  assert.equal(state.tokens[0].status,"pending");
}));

test("retry replaces the old attempt; cancellation and logout invalidate pending logins",()=>fixture(async({state,auth})=>{
  let start=await auth("telegram/start?next=//evil.example");
  assert.equal(state.tokens[0].next_path,"/");
  const oldToken=state.tokens[0].token;
  start=await auth("telegram/start?next=/shop",{cookie:cookieHeader(start.headers["set-cookie"])});
  assert.equal(state.tokens.some(row=>row.token===oldToken),false);
  let cookie=cookieHeader(start.headers["set-cookie"]);
  const denied=await auth("telegram/cancel",{cookie,method:"POST"});assert.equal(denied.statusCode,403);
  const cancelled=await auth("telegram/cancel",{cookie,method:"POST",headers:{"content-type":"application/json"}});
  assert.equal(cancelled.statusCode,200);assert.equal(state.tokens.length,0);
  start=await auth("telegram/start?next=/shop");cookie=cookieHeader(start.headers["set-cookie"]);
  const session=createSessionCookie({id:"tg:551",phone:"998900000000"},{environment});
  const logout=await auth("logout?next=/shop",{cookie:`${cookie}; ${cookieHeader(session)}`});
  assert.equal(state.tokens.length,0);assert.equal(logout.headers.location,"/shop");
  assert.ok(logout.headers["set-cookie"].every(cookie=>cookie.includes("Max-Age=0")));
}));

test("legacy redirect, HTTP methods, readiness, rate limit and transient webhook failures",()=>fixture(async({state,auth,update})=>{
  const legacy=await auth("telegram/start?next=/shop",{headers:{accept:"text/html"}});
  assert.equal(legacy.statusCode,302);assert.match(legacy.headers.location,/https:\/\/t.me\//);
  assert.equal((await auth("telegram/status",{method:"POST"})).statusCode,405);
  assert.equal((await auth("telegram/cancel")).statusCode,405);
  for(let i=0;i<9;i++)await auth("telegram/start");
  assert.equal((await auth("telegram/start")).statusCode,429);
  process.env.SESSION_SECRET="";
  assert.equal((await auth("telegram/start")).statusCode,503);
  process.env.SESSION_SECRET=environment.SESSION_SECRET;
  state.failDatabase=true;
  const failed=await update(privateMessage({text:`/start ${"a".repeat(32)}`}));
  assert.equal(failed.statusCode,503,"Telegram can retry a transient persistence failure");
}));
