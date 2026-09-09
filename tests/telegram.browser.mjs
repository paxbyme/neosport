import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { interceptAdmin } from "./fixtures/admin.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
const base=process.env.STOREFRONT_URL||"http://localhost:4173";
const output=new URL("../docs/ui-review/",import.meta.url).pathname;
mkdirSync(output,{recursive:true});
const results=[];
const fixture=async (width,catalog,{popupBlocked=true,height=width<768?844:1000}={})=>{
  const context=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});
  if(popupBlocked) await context.addInitScript(()=>{window.open=()=>null;});
  // Catch all management and order requests before any page loads.
  const admin=await interceptAdmin(context,catalog);
  admin.authorized=false;
  const state={phase:"idle",user:null,role:"customer",next:"/",starts:0,cancels:0,statusErrors:0,startError:0,cancelError:0,delayStart:0,delayStatus:0,requests:[],external:0};
  await context.route("https://t.me/**",route=>{state.external++;return route.fulfill({contentType:"text/html",body:"<p>Ajratilgan Telegram sinovi. Tashqi botga ulanilmadi.</p>"});});
  await context.route("**/api/products",route=>route.fulfill({json:{products:catalog}}));
  await context.route("**/api/orders",route=>route.fulfill({json:{orders:[]}}));
  await context.route("**/api/auth/**",async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    state.requests.push(path);
    const send=(json,status=200)=>route.fulfill({status,json});
    if(path==="/api/auth/me")return send({ok:true,googleEnabled:true,telegramEnabled:true,user:state.user});
    if(path==="/api/auth/telegram/start"){
      assert.match(route.request().headers().accept,/application\/json/);
      state.starts++;
      if(state.delayStart)await new Promise(resolve=>setTimeout(resolve,state.delayStart));
      if(state.startError)return send({message:"Sinov: Telegram vaqtincha ishlamayapti."},state.startError);
      state.next=url.searchParams.get("next");state.phase="pending";
      return send({ok:true,url:`https://t.me/NeoSportFixtureBot?start=${"x".repeat(32)}`,expiresIn:600});
    }
    if(path==="/api/auth/telegram/status"){
      if(state.delayStatus)await new Promise(resolve=>setTimeout(resolve,state.delayStatus));
      if(state.statusErrors){state.statusErrors--;return send({message:"Sinov: ulanish vaqtincha uzildi."},503);}
      if(state.phase==="ready"){
        state.user={name:"Sinov mijozi",phone:"998900000000",email:"",role:state.role};
        admin.authorized=state.role==="admin";admin.auth.user=state.user;
        state.phase="used";
        return send({ok:true,ready:true,state:"ready",next:state.next});
      }
      return send({ok:true,ready:false,waiting:state.phase==="pending",state:state.phase,expiresAt:Date.now()+600000});
    }
    if(path==="/api/auth/telegram/cancel"){
      assert.equal(route.request().method(),"POST");
      state.cancels++;
      if(state.cancelError)return send({message:"Sinov: ulanish uzildi."},state.cancelError);
      state.phase="idle";return send({ok:true,state:"cancelled"});
    }
    if(path==="/api/auth/logout"){state.user=null;state.phase="idle";return route.fulfill({status:302,headers:{location:url.searchParams.get("next")||"/"},body:""});}
    return send({message:"Sinovda ruxsat etilmagan so‘rov."},400);
  });
  const page=await context.newPage(),errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  return {context,page,state,admin,errors};
};
const triggerFor=page=>page.locator("[data-telegram-signin],#telegram-signin");
const phase=async(page,name)=>page.locator(`#telegram-auth-dialog[open][data-state="${name}"]`).waitFor();
const capture=async(page,name)=>{
  await page.evaluate(()=>document.fonts.ready);
  await page.locator(".tg-mark").evaluate(img=>img.decode());
  await page.screenshot({path:`${output}${name}.png`});
};
const accessible=async page=>{
  const geometry=await page.locator("#telegram-auth-dialog").evaluate(el=>{
    const box=el.getBoundingClientRect();return {fits:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,controls:[...el.querySelectorAll("button,a[href]")].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&Boolean(e.getAttribute("aria-label")||e.textContent.trim());})};
  });
  assert.deepEqual(geometry,{fits:true,overflow:false,controls:true});
  for(let i=0;i<7;i++){
    await page.keyboard.press(i<4?"Tab":"Shift+Tab");
    assert.equal(await page.locator("#telegram-auth-dialog").evaluate(el=>el.contains(document.activeElement)),true,"Native dialog keeps focus inside");
  }
  assert.equal(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle!=="none"),true,"Keyboard focus is visible");
};
try{
  const publicContext=await browser.newContext();
  const response=await publicContext.request.get(`${base}/api/products`),{products:catalog}=await response.json();
  assert.ok(catalog.length);await publicContext.close();
  for(const width of [360,390,768,1024,1440]){
    for(const path of ["/","/shop","/admin"]){
      const {context,page,state,admin,errors}=await fixture(width,catalog);
      await page.goto(`${base}${path}`,{waitUntil:"domcontentloaded"});
      const trigger=triggerFor(page);await trigger.waitFor();
      assert.equal(await page.locator('[data-admin-link]').count(),0,"No customer admin navigation");
      await trigger.click();await phase(page,"waiting");
      assert.equal(state.next,path);
      assert.equal(await page.locator(".tg-open").getAttribute("rel"),"noopener noreferrer");
      await accessible(page);
      await capture(page,`telegram-fixture-${path==="/"?"home":path.slice(1)}-${width}`);
      await page.keyboard.press("Escape");
      await page.locator("#telegram-auth-dialog").waitFor({state:"hidden"});
      assert.equal(state.cancels,1);
      assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,"Focus returns to sign-in");
      assert.equal(await page.evaluate(()=>document.body.classList.contains("telegram-auth-open")),false);
      await trigger.click();await phase(page,"waiting");
      state.statusErrors=1;
      await page.locator(".tg-check").click();await phase(page,"error");
      await phase(page,"waiting"); // Automatic recovery, no extra click required.
      state.phase="expired";await page.locator(".tg-check").click();await phase(page,"expired");
      assert.equal(await page.locator(".tg-open").isVisible(),false);
      await page.locator(".tg-retry").click();await phase(page,"waiting");
      state.role=path==="/admin"?"admin":"customer";state.phase="ready";
      await page.locator(".tg-check").click();
      if(path==="/admin"){
        await page.locator(".stat-tile").first().waitFor();
        assert.equal(await page.locator("#login-layer").isVisible(),false);
      }else{
        await page.locator(".account-name").waitFor({state:"attached"});
        assert.equal(await page.locator('[name="name"]').inputValue(),"Sinov mijozi");
        assert.equal((await page.locator('[name="phone"]').inputValue()).replace(/\D/g,""),"998900000000");
        assert.equal(await page.locator('[data-admin-link]').count(),0);
      }
      assert.equal(await page.evaluate(()=>sessionStorage.getItem("neosport-telegram-attempt")),null);
      assert.equal(admin.requests.filter(r=>r.method!=="GET").length,0);
      assert.deepEqual(errors,[]);
      results.push({width,path,status:"passed",checks:"popup-blocked fallback, keyboard/focus/44px targets, Escape cancellation, automatic network retry, expiry/restart, successful return, account prefill/admin authorization",interceptedStarts:state.starts});
      console.log(JSON.stringify(results.at(-1)));await context.close();
    }
  }
  // App switching/reloading, a real browser popup (intercepted), short viewport,
  // failed start/cancel, cancellation while start is in flight, and customer denial.
  {
    const {context,page,state,errors}=await fixture(390,catalog,{popupBlocked:false,height:600});
    await page.goto(`${base}/shop`,{waitUntil:"domcontentloaded"});
    await triggerFor(page).waitFor();
    state.startError=503;
    await triggerFor(page).click();await phase(page,"error");
    state.startError=0;
    const popupEvent=context.waitForEvent("page");
    await page.locator(".tg-retry").click();
    const popup=await popupEvent;
    await popup.waitForURL("https://t.me/**");
    assert.equal(await popup.evaluate(()=>window.opener),null);
    await popup.close();await page.bringToFront();await phase(page,"waiting");
    await accessible(page);
    await page.reload({waitUntil:"domcontentloaded"});await phase(page,"waiting");
    assert.equal(await page.locator(".tg-open").isVisible(),false,"Sensitive link is not stored in browser storage");
    assert.equal(await page.locator(".tg-retry").isVisible(),true);
    state.cancelError=503;
    await page.keyboard.press("Escape");await phase(page,"error");
    assert.equal(await page.locator("#telegram-auth-dialog").isVisible(),true);
    state.cancelError=0;await page.keyboard.press("Escape");
    await page.locator("#telegram-auth-dialog").waitFor({state:"hidden"});
    state.delayStart=800;
    await triggerFor(page).click();await phase(page,"preparing");
    await page.keyboard.press("Escape");
    await page.locator("#telegram-auth-dialog").waitFor({state:"hidden"});
    assert.equal(state.phase,"idle","Cancel waits for the server to install its start cookie");
    assert.deepEqual(errors,[]);await context.close();
  }
  {
    const {context,page,state}=await fixture(390,catalog);
    await page.goto(`${base}/shop`,{waitUntil:"domcontentloaded"});
    await triggerFor(page).click();await phase(page,"waiting");
    state.phase="ready";state.delayStatus=700;
    await page.locator(".tg-check").click();
    await page.keyboard.press("Escape");
    await page.locator(".account-name").waitFor({state:"attached"});
    assert.equal(state.cancels,0,"An already committed session is reflected in the page");
    await context.close();
  }
  {
    const {context,page,state,admin}=await fixture(390,catalog);
    await page.goto(`${base}/admin`,{waitUntil:"domcontentloaded"});
    await triggerFor(page).click();await phase(page,"waiting");
    state.phase="ready";await page.locator(".tg-check").click();
    await page.waitForFunction(()=>document.querySelector("#login-status").textContent.includes("admin huquqi yo‘q"));
    assert.equal(await page.locator("#admin-shell").isVisible(),false);
    assert.equal(admin.requests.filter(r=>r.path.startsWith("/api/admin/")).length,0);
    await context.close();
  }
  results.push({status:"passed",checks:"intercepted popup, short viewport, reload/resume, failed start and cancel recovery, cancellation/start and committed-session races, customer denied admin access"});
  writeFileSync(`${output}telegram-results.json`,JSON.stringify({generatedAt:new Date().toISOString(),fixtureOnly:true,results},null,2));
  console.log(JSON.stringify(results.at(-1)));
}finally{await browser.close();}
