import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { interceptAdmin } from "./fixtures/admin.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}) });
const base=process.env.STOREFRONT_URL||"http://localhost:4173";
const output=new URL("../docs/ui-review/",import.meta.url).pathname;
mkdirSync(output,{recursive:true});
const results=[];
const widths=[360,390,768,1024,1440];
const routes={stats:"/admin",categories:"/admin/categories",products:"/admin/products",editor:"/admin/product",customers:"/admin/customers"};
const resources={stats:["stats"],categories:["categories","products"],products:["products"],editor:["categories"],customers:["customers"]};
const states=new WeakMap();
const watch=(page,state)=>{
  states.set(page,state);
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{
    // HTTP error responses are deliberate in the unavailable-state scenarios.
    if(message.type()==="error"&&!message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });
  return errors;
};
const ready=async(page,view)=>{
  await page.waitForURL(url=>url.pathname===routes[view]);
  await page.waitForLoadState("domcontentloaded");
  await page.locator('#admin-panel[aria-busy="false"]').waitFor();
  assert.equal(await page.locator("body").getAttribute("data-admin-page"),view);
  assert.equal(await page.locator('#admin-nav [aria-current="page"]').count(),1);
  assert.equal(await page.locator(`#admin-nav [data-view="${view}"]`).getAttribute("aria-current"),"page");
  assert.equal(await page.locator("#login-layer").isVisible(),false);
};
const requested=(state,start)=>state.requests.slice(start).filter(r=>r.path.startsWith("/api/admin/")).map(r=>r.path.split("/").at(-1)).sort();
const overflow = async page => {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"No horizontal page overflow");
  assert.equal(await page.locator("button button,button a,a button").count(),0);
  const inaccessible=await page.evaluate(()=>[...document.querySelectorAll("button,a[href],input,select,textarea")].filter(el=>el.getClientRects().length&&!el.closest("[inert]")&&!el.disabled).flatMap(el=>{
    const box=(el.matches('input[type="checkbox"],input[type="file"]')?el.closest("label"):el).getBoundingClientRect();
    const named=el.getAttribute("aria-label")||el.textContent.trim()||el.labels?.length;
    return box.width<44||box.height<44||!named ? [{element:el.outerHTML.slice(0,150),width:box.width,height:box.height,named:Boolean(named)}] : [];
  }));
  assert.deepEqual(inaccessible,[],"Named controls and 44px targets");
};
const capture=async(page,name)=>{
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(async()=>{ await Promise.all([...document.images].filter(img=>img.getClientRects().length).map(img=>img.decode().catch(()=>{}))); });
  await page.screenshot({path:`${output}${name}.png`,fullPage:true});
};
const navigate=async(page,view)=>{
  const state=states.get(page), start=state.requests.length;
  await page.evaluate(()=>{window.previousAdminDocument=true;});
  if (page.viewportSize().width<768) await page.locator("#admin-menu-toggle").click();
  await Promise.all([
    page.waitForURL(url=>url.pathname===routes[view]&&!url.search),
    page.locator(`[data-view="${view}"]`).click(),
  ]);
  await ready(page,view);
  assert.equal(await page.evaluate(()=>window.previousAdminDocument),undefined,"Navigation loads a fresh document");
  assert.deepEqual(requested(state,start),resources[view],`${view} requests only its dependencies`);
  assert.equal(state.requests.slice(start).filter(r=>r.path==="/api/auth/me").length,1,"Fixture interception survives navigation");
};
const status=async(page,selector,pattern)=>{
  await page.waitForFunction(({selector,pattern})=>new RegExp(pattern).test(document.querySelector(selector).textContent),{selector,pattern});
};
const dialog=async(page,accept,action)=>{
  const got=page.waitForEvent("dialog");
  const clicked=action();
  const prompt=await got;
  if(prompt.type()!=="beforeunload") assert.match(prompt.message(),/o‘chirasizmi|Saqlanmagan/);
  await (accept?prompt.accept():prompt.dismiss());
  await clicked;
};
try {
  // Public GET only. Management data and every write are intercepted below.
  const publicContext=await browser.newContext();
  const response=await publicContext.request.get(`${base}/api/products`);
  const {products:catalog}=await response.json();
  assert.ok(catalog.length>=2);
  await publicContext.close();
  for (const width of widths) {
    const context=await browser.newContext({viewport:{width,height:width<768?844:1000},reducedMotion:"reduce"});
    const state=await interceptAdmin(context,catalog);
    const page=await context.newPage(), errors=watch(page,state);
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await page.locator(".stat-tile").first().waitFor();
    await page.locator(".admin-label").evaluate(el=>el.textContent="SINOV MA’LUMOTLARI");
    await overflow(page);
    assert.equal(await page.locator(".stat-tile").count(),8);
    await capture(page,`admin-fixture-stats-${width}`);
    if(width<768){
      await page.locator("#admin-menu-toggle").click();
      assert.equal(await page.locator("#admin-nav").getAttribute("aria-modal"),"true");
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.locator("#admin-nav").evaluate(el=>el.contains(document.activeElement)),true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#admin-menu-toggle").evaluate(el=>el===document.activeElement),true);
    }
    await navigate(page,"products");
    await overflow(page);
    await capture(page,`admin-fixture-products-${width}`);
    await page.locator("#admin-search").fill("topilmaydigan-sinov");
    assert.equal(await page.locator(".admin-product").count(),0);
    await page.locator("#admin-reset-filters").click();
    await page.locator("#admin-search").fill(catalog[0].brand);
    assert.ok(await page.locator(".admin-product").count()>0);
    await page.locator("#admin-reset-filters").click();
    await page.locator("#admin-category-filter").selectOption(catalog[0].category);
    assert.equal(await page.locator(".admin-product").count(),catalog.filter(p=>p.category===catalog[0].category).length);
    await page.locator("#admin-reset-filters").click();
    const first=page.locator(`.admin-product[data-product-id="${catalog[0].id}"]`);
    state.errors["products:PATCH"]=503;
    await first.locator("[data-toggle-product]").click();
    await status(page,"#product-list-status","Sinov: server");
    assert.equal(await first.locator("[data-toggle-product]").isEnabled(),true);
    delete state.errors["products:PATCH"];
    await first.locator("[data-toggle-product]").click();
    await status(page,"#product-list-status","nofaol qilindi");
    assert.equal(await first.locator("[data-toggle-product]").getAttribute("aria-checked"),"false");
    await page.locator("#admin-status-filter").selectOption("inactive");
    assert.equal(await page.locator(".admin-product").count(),1);
    await page.locator("#admin-reset-filters").click();
    await first.locator("[data-toggle-product]").click();
    await status(page,"#product-list-status",": faol qilindi");
    await first.locator("[data-edit-product]").click();
    await ready(page,"editor");
    assert.equal(new URL(page.url()).searchParams.get("id"),catalog[0].id);
    assert.equal(await page.locator('#product-admin-form [name="name"]').inputValue(),catalog[0].name);
    await capture(page,`admin-fixture-editor-${width}`);
    await overflow(page);
    const form=page.locator("#product-admin-form");
    const initialName=catalog[0].name;
    await form.locator('[name="name"]').fill(`${initialName} — sinov`);
    if(width<768) await page.locator("#admin-menu-toggle").click();
    await dialog(page,false,()=>page.locator('[data-view="products"]').click());
    if(width<768) await page.keyboard.press("Escape");
    assert.equal(await form.isVisible(),true);
    await form.locator('[name="discountPercent"]').fill("15");
    await status(page,"#price-preview","Chegirmali narx");
    await form.locator("#save-product-button").click();
    await status(page,"#admin-form-status","Mahsulot yangilandi");
    const saved=state.requests.filter(r=>r.path==="/api/admin/products"&&r.method==="PATCH"&&r.body.name).at(-1);
    assert.equal(saved.body.name,`${initialName} — sinov`);
    assert.equal(saved.body.discountPercent,15);
    assert.deepEqual(saved.body.images,catalog[0].images);
    await navigate(page,"categories");
    await overflow(page);
    await capture(page,`admin-fixture-categories-${width}`);
    const used=page.locator(`.admin-category[data-category-id="fixture-category-0"]`);
    assert.equal(await used.locator("[data-delete-category]").isDisabled(),true);
    await used.locator("[data-edit-category]").click();
    await page.locator('#category-form [name="name"]').fill("Sinov yangilangan kategoriya");
    await page.locator("#save-category-button").click();
    await status(page,"#category-status","Kategoriya yangilandi");
    assert.equal(state.products[0].category,"Sinov yangilangan kategoriya");
    await page.locator('#category-form [name="name"]').fill("Sinov yangi yo‘nalish");
    await page.locator('#category-form [name="sizeType"]').selectOption("shoes");
    await page.locator("#save-category-button").click();
    await status(page,"#category-status","Kategoriya qo‘shildi");
    const created=state.categories.find(c=>c.name==="Sinov yangi yo‘nalish");
    const category=page.locator(`.admin-category[data-category-id="${created.id}"]`);
    await category.locator('[data-move-category="up"]').click();
    await status(page,"#category-status","O‘zgarish saqlandi");
    assert.equal(state.categories.at(-2).id,created.id);
    await category.locator("[data-toggle-category]").click();
    await page.waitForFunction(id=>document.querySelector(`[data-category-id="${id}"] [role="switch"]`).getAttribute("aria-checked")==="false",created.id);
    await dialog(page,false,()=>category.locator("[data-delete-category]").click());
    assert.ok(state.categories.some(c=>c.id===created.id));
    await dialog(page,true,()=>category.locator("[data-delete-category]").click());
    await page.waitForFunction(id=>!document.querySelector(`[data-category-id="${id}"]`),created.id);
    await navigate(page,"editor");
    await form.locator('[name="name"]').fill("Sinov mahsuloti");
    await form.locator('[name="brand"]').fill("Sinov brendi");
    await form.locator('[name="category"]').selectOption(state.categories.find(c=>c.sizeType==="shoes").name);
    assert.equal(await form.locator('[name="sizes"][value="36"]').count(),1);
    assert.equal(await form.locator('[name="sizes"][value="XL"]').count(),0);
    await form.locator('[name="price"]').fill("100000");
    await form.locator('[name="description"]').fill("Faqat brauzer sinovi uchun mahsulot tavsifi.");
    await form.locator('[name="color-label"]').fill("Qora");
    await page.locator("#save-product-button").click();
    await status(page,"#admin-form-status","Kamida bitta o‘lcham");
    await form.locator('[name="sizes"][value="36"]').check();
    await page.locator("#save-product-button").click();
    await status(page,"#admin-form-status","Kamida bitta mahsulot rasmini");
    await form.locator('[name="image-url"]').fill(catalog[0].images[0]);
    await page.locator("#add-image-url").click();
    await form.locator('[name="image-url"]').fill(catalog[1].images[0]);
    await page.locator("#add-image-url").click();
    await page.locator('[data-make-main="1"]').click();
    assert.equal(await page.locator(".image-tile img").first().getAttribute("src"),catalog[1].images[0]);
    await page.locator('[data-remove-image="1"]').click();
    assert.equal(await page.locator(".image-tile").count(),1);
    state.errors["products:POST"]=503;
    await page.locator("#save-product-button").click();
    await status(page,"#admin-form-status","Sinov: server");
    assert.equal(await form.locator('[name="name"]').inputValue(),"Sinov mahsuloti");
    delete state.errors["products:POST"];
    await page.locator("#save-product-button").click();
    await status(page,"#admin-form-status","Mahsulot katalogga qo‘shildi");
    assert.equal(state.products[0].name,"Sinov mahsuloti");
    await navigate(page,"products");
    const added=page.locator(`.admin-product[data-product-id="${state.products[0].id}"]`);
    await dialog(page,true,()=>added.locator("[data-delete-product]").click());
    await status(page,"#product-list-status","Mahsulot o‘chirildi");
    // The customer list is fetched only when the section is first opened.
    assert.equal(state.requests.some(r=>r.path==="/api/admin/customers"),false);
    await navigate(page,"customers");
    await page.locator(".admin-customer").first().waitFor();
    assert.equal(await page.locator(".admin-customer").count(),3);
    assert.equal(await page.locator("#customer-count").textContent(),"3 / 3 ta mijoz");
    assert.match(await page.locator('[data-customer-id="tg:5003"]').innerText(),/Ismi ko‘rsatilmagan[\s\S]*Buyurtma yo‘q/);
    assert.equal(await page.locator('[data-customer-id="tg:5001"] a').getAttribute("href"),"tel:+998935556677");
    await overflow(page);
    await capture(page,`admin-fixture-customers-${width}`);
    // Any spelling of the number finds its customer.
    await page.locator("#customer-search").fill("90 111 22 33");
    await page.waitForFunction(()=>document.querySelectorAll(".admin-customer").length===1);
    assert.equal(await page.locator(".admin-customer").getAttribute("data-customer-id"),"tg:5002");
    await page.locator("#customer-reset-filters").click();
    await page.waitForFunction(()=>document.querySelectorAll(".admin-customer").length===3);
    await page.locator("#customer-sort").selectOption("spent");
    await page.waitForFunction(()=>document.querySelector(".admin-customer").dataset.customerId==="tg:5001");
    // A new document refreshes the customer list on every visit.
    await navigate(page,"stats");
    await navigate(page,"customers");
    assert.equal(state.requests.filter(r=>r.path==="/api/admin/customers").length,2);
    await overflow(page);
    assert.deepEqual(errors,[]);
    results.push({width,status:"passed",interceptedWrites:state.requests.filter(r=>r.method!=="GET").length,checks:"views, drawer, keyboard, tables, filters, edit, discounts, categories CRUD/order/status/rename, product CRUD/status, customer list/search/order, variants, gallery, validation, error recovery, unsaved edits"});
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  // Upload limits, drafts and session expiry are exercised without server writes.
  {
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});
    const state=await interceptAdmin(context,catalog),page=await context.newPage();
    const errors=watch(page,state);
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await page.locator(".stat-tile").first().waitFor();
    await navigate(page,"editor");
    const file=page.locator('[name="image-file"]');
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64");
    await file.setInputFiles({name:"oversize.png",mimeType:"image/png",buffer:Buffer.alloc(6*1024*1024+1)});
    await status(page,"#admin-form-status","6 MB");
    assert.equal(await page.locator(".image-tile").count(),0);
    await file.setInputFiles({name:"invalid.txt",mimeType:"text/plain",buffer:Buffer.from("fixture")});
    await status(page,"#admin-form-status","Faqat JPG");
    await file.setInputFiles(Array.from({length:11},(_,i)=>({name:`fixture-${i}.png`,mimeType:"image/png",buffer:png})));
    await page.waitForFunction(()=>document.querySelectorAll(".image-tile").length===10);
    await status(page,"#admin-form-status","Ko‘pi bilan 10");
    assert.equal(await page.locator("#image-count").textContent(),"10/10");
    await page.locator('[data-make-main="9"]').click();
    await page.locator('[data-remove-image="9"]').click();
    assert.equal(await page.locator(".image-tile").count(),9);
    await page.locator('[name="image-url"]').fill("http://example.test/fixture.png");
    await page.locator("#add-image-url").click();
    await status(page,"#admin-form-status","https://");
    await overflow(page);
    await dialog(page,false,()=>page.locator("#cancel-edit-button").click());
    assert.equal(await page.locator(".image-tile").count(),9);
    await dialog(page,true,()=>page.locator("#cancel-edit-button").click());
    await ready(page,"products");
    await navigate(page,"categories");
    await page.locator('#category-form [name="name"]').fill("Saqlanmagan kategoriya");
    await page.locator("#admin-menu-toggle").click();
    await dialog(page,false,()=>page.locator('[data-view="stats"]').click());
    await page.keyboard.press("Escape");
    assert.equal(await page.locator('#category-form [name="name"]').inputValue(),"Saqlanmagan kategoriya");
    await page.locator("#admin-menu-toggle").click();
    await dialog(page,true,()=>page.locator('[data-view="stats"]').click());
    await ready(page,"stats");
    state.authorized=false;
    await page.locator("#stats-refresh").click();
    await page.locator("#login-layer").waitFor();
    assert.equal(await page.locator("#admin-shell").isVisible(),false);
    results.push({scenario:"upload-boundaries-drafts-session-expiry",status:"passed"});
    await context.close();
  }
  // Authentication and unavailable states use entirely isolated contexts.
  for(const width of widths) for(const scenario of ["visitor","customer","password","catalog-error","empty","stats-error","stats-unavailable","category-error","customer-error"]){
    const context=await browser.newContext({viewport:{width,height:width<768?844:1000},reducedMotion:"reduce"});
    const state=await interceptAdmin(context,catalog),page=await context.newPage();
    const errors=watch(page,state);
    if(scenario==="visitor"||scenario==="customer"||scenario==="password"){
      state.auth.user=scenario==="customer"?{role:"customer",email:"fixture@example.test"}:null;
      state.authorized=scenario==="password";
      if(scenario==="password") {state.auth.googleEnabled=false;state.auth.telegramEnabled=false;}
    }
    if(scenario==="catalog-error")state.errors["products:GET"]=503;
    if(scenario==="category-error")state.errors["categories:GET"]=503;
    if(scenario==="stats-error")state.errors["stats:GET"]=503;
    if(scenario==="stats-unavailable")state.statsUnavailable=true;
    if(scenario==="empty"){state.products=[];state.categories=[];state.emptyOrders=true;}
    if(scenario==="customer-error")state.errors["customers:GET"]=503;
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    if(["visitor","customer","password"].includes(scenario)){
      await page.waitForFunction(()=>!document.querySelector("#login-status").textContent.includes("Tekshirilmoqda"));
      assert.equal(await page.locator("#admin-shell").isVisible(),false);
      assert.equal(state.requests.some(r=>r.path.startsWith("/api/admin/")),false);
      if(scenario!=="password"){
        assert.equal(new URL(await page.locator("#google-signin").getAttribute("href"),base).searchParams.get("next"),"/admin");
        assert.equal(new URL(await page.locator("#telegram-signin").getAttribute("href"),base).searchParams.get("next"),"/admin");
        await page.keyboard.press("Shift+Tab");
        assert.equal(await page.locator("#login-form").evaluate(el=>el.contains(document.activeElement)),true);
        await capture(page,`admin-login-${scenario}-${width}`);
      }else{
        await page.locator('[name="password"]').fill("fixture-only-password");
        await page.locator("#login-password button").click();
        await page.locator(".stat-tile").first().waitFor();
        assert.equal(state.requests.find(r=>r.path==="/api/admin/stats").authorization,"Bearer fixture-only-password");
        for(const view of ["categories","products","editor","customers","stats"]) await navigate(page,view);
        assert.ok(state.requests.filter(r=>r.path.startsWith("/api/admin/")).every(r=>r.authorization==="Bearer fixture-only-password"));
        await page.locator("#logout-button").click();
        await page.waitForURL("**/api/auth/logout?next=/admin");
      }
    }else{
      await page.locator("#admin-shell").waitFor();
      await page.waitForFunction(()=>document.querySelector("#stats-refresh").disabled===false);
      if(scenario==="catalog-error"){
        await navigate(page,"products"); await status(page,"#product-list-status","Sinov: server");
        assert.equal(await page.locator("#admin-search").isDisabled(),true);
        await navigate(page,"categories");
        assert.match(await page.locator("#category-list").innerText(),/Mahsulotlar yuklanmagan/);
        assert.equal(await page.locator("[data-delete-category]:enabled").count(),0);
        await navigate(page,"products");
        delete state.errors["products:GET"]; await page.locator("#products-retry").click(); await page.locator(".admin-product").first().waitFor();
      }
      if(scenario==="category-error"){
        await navigate(page,"categories"); await status(page,"#category-status","Kategoriyalarni yuklab bo‘lmadi");
        delete state.errors["categories:GET"]; await page.locator("#categories-retry").click(); await page.locator(".admin-category").first().waitFor();
      }
      if(scenario==="stats-error"){
        await status(page,"#stats-body","Statistikani yuklab bo‘lmadi"); delete state.errors["stats:GET"]; await page.locator("#stats-refresh").click(); await page.locator(".stat-tile").first().waitFor();
      }
      if(scenario==="stats-unavailable") await status(page,"#stats-body","Buyurtmalar tarixi hozircha mavjud emas");
      if(scenario==="empty"){
        assert.equal(await page.locator(".stat-table-empty").count(),2);
        await navigate(page,"products"); assert.match(await page.locator("#admin-product-list").textContent(),/Katalog bo‘sh/);
        await navigate(page,"editor"); assert.equal(await page.locator("#product-category option").count(),1);
        state.customers=[];
        await navigate(page,"customers"); assert.match(await page.locator("#admin-customer-list").textContent(),/Hozircha mijoz yo‘q/);
      }
      if(scenario==="customer-error"){
        await navigate(page,"customers"); await status(page,"#customer-status","Sinov: server");
        assert.equal(await page.locator("#customer-search").isDisabled(),true);
        delete state.errors["customers:GET"]; await page.locator("#customers-retry").click(); await page.locator(".admin-customer").first().waitFor();
      }
      await overflow(page);
    }
    assert.deepEqual(errors,[]);
    results.push({width,scenario,status:"passed"});
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  writeFileSync(`${output}admin-results.json`,JSON.stringify({generatedAt:new Date().toISOString(),productionWrites:0,results},null,2));
  console.log("All admin browser checks passed. All management requests were intercepted.");
} finally { await browser.close(); }
