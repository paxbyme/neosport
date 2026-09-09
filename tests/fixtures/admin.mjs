// These responses exist only inside Playwright interception. They never reach
// the application server and are excluded from the explicit production build.
export async function interceptAdmin(context, catalog) {
  const state = {
    auth: { user: { role: "admin", name: "Sinov administratori" }, googleEnabled: true, telegramEnabled: true },
    authorized: true, products: structuredClone(catalog), categories: [], requests: [],
    errors: {}, statsUnavailable: false, emptyOrders: false, delayStats: 0, customersUnavailable: false,
  };
  state.categories = [...new Set(catalog.map(p => p.category))].map((name, index) => ({
    id: `fixture-category-${index}`, name, active: true, sortOrder: index,
    sizeType: catalog.find(p => p.category === name).sizes.some(s => /^\d+$/.test(s)) ? "shoes" : "clothing",
  }));
  state.categories.push({ id: "fixture-unused", name: "Sinov kategoriyasi", sizeType: "clothing", active: true, sortOrder: state.categories.length });
  // One customer of each shape the panel has to draw: a returning buyer, a
  // one-off purchase, and somebody who signed in without ordering yet.
  state.customers = [
    { id: "tg:5001", name: "Dilnoza Rahimova", phone: "998935556677", chatId: "5001", createdAt: "2026-05-02T18:05:00Z", lastLoginAt: "2026-09-07T08:00:00Z", orders: { count: 3, total: 1568000, lastAt: "2026-09-07T12:30:00Z" } },
    { id: "tg:5002", name: "Sardor Yo‘ldoshev", phone: "998901112233", chatId: "5002", createdAt: "2026-08-22T10:00:00Z", lastLoginAt: "2026-08-22T10:30:00Z", orders: { count: 1, total: 349000, lastAt: "2026-08-22T11:00:00Z" } },
    { id: "tg:5003", name: "", phone: "998944445566", chatId: "5003", createdAt: "2026-09-01T10:10:00Z", lastLoginAt: "2026-09-01T10:10:00Z", orders: { count: 0, total: 0, lastAt: null } },
  ];
  const stats = () => {
    const active = state.products.filter(p => p.active);
    const discounted = active.filter(p => p.discountPercent > 0);
    const sum = active.reduce((n,p) => n + p.finalPrice,0);
    const p = state.products[0];
    const aggregate = { count: state.emptyOrders || !p ? 0 : 1, revenue: state.emptyOrders || !p ? 0 : p.finalPrice, items: state.emptyOrders || !p ? 0 : 1 };
    return {
      generatedAt: "2026-09-08T09:00:00Z",
      catalog: { total: state.products.length, active: active.length, inactive: state.products.length-active.length, discounted: discounted.length, averageDiscount: discounted.length ? Math.round(discounted.reduce((n,p) => n+p.discountPercent,0)/discounted.length) : 0, catalogValue: sum, averagePrice: active.length ? Math.round(sum/active.length) : 0, brands: [...new Set(state.products.map(p=>p.brand))].map(name=>({name,count:state.products.filter(p=>p.brand===name).length})), categories: state.categories },
      orders: state.statsUnavailable ? null : { today: aggregate, last7Days: aggregate, last30Days: aggregate, allTime: aggregate,
        topProducts: aggregate.count ? [{ name:p.name, brand:p.brand, quantity:1, revenue:p.finalPrice }] : [],
        recent: aggregate.count ? [{ id:"UI-SINOV-0001", createdAt:"2026-09-08T09:00:00Z", customerName:"Sinov mijozi", customerPhone:"+998 90 000 00 00", itemCount:1, total:p.finalPrice }] : [],
      },
    };
  };
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const body = request.postData() ? request.postDataJSON() : null;
    state.requests.push({ path, method, body, authorization: request.headers().authorization });
    const respond = (json, status=200) => route.fulfill({ status, json });
    if (path === "/api/order") return respond({ message: "Sinov buyurtmasi bloklandi." }, 400);
    if (path === "/api/auth/me") return respond(state.auth);
    if (path === "/api/auth/telegram/status") return respond({ waiting:false });
    if (path === "/api/auth/logout") return route.fulfill({ contentType:"text/html", body:"<p>Sinov: chiqildi</p>" });
    if (!path.startsWith("/api/admin/")) return respond({ message:"Sinovda ruxsat etilmagan so‘rov." },400);
    if (!state.authorized) return respond({ message:"Admin huquqi kerak." },401);
    const resource = path.split("/").at(-1);
    if (state.errors[`${resource}:${method}`]) return respond({ message: "Sinov: server vaqtincha ishlamayapti." }, state.errors[`${resource}:${method}`]);
    if (resource === "stats") {
      if (state.delayStats) await new Promise(resolve=>setTimeout(resolve,state.delayStats));
      return respond({ stats:stats() });
    }
    if (resource === "customers") {
      return respond({ customers: state.customersUnavailable ? [] : state.customers, source: "users", ordersAvailable: !state.customersUnavailable });
    }
    if (!["products","categories"].includes(resource)) return respond({},404);
    const singular = resource === "products" ? "product" : "category";
    if (method === "GET") return respond({ [resource]:state[resource] });
    const id = url.searchParams.get("id"), item = state[resource].find(item=>item.id===id);
    if (method === "DELETE") {
      if (resource === "categories" && state.products.some(p=>p.category===item?.name)) return respond({message:"Kategoriya mahsulotlarda ishlatilgan."},409);
      state[resource] = state[resource].filter(item=>item.id!==id);
      return respond({ok:true});
    }
    if (method === "PATCH" && resource === "categories" && body.move) {
      const index=state.categories.indexOf(item), next=index+(body.move==="up"?-1:1);
      if (next>=0 && next<state.categories.length) [state.categories[index],state.categories[next]]=[state.categories[next],state.categories[index]];
      return respond({categories:state.categories});
    }
    const updated={ ...(item||{id:`fixture-${resource}-${state.requests.length}`,active:true}), ...body };
    if (resource === "products") {
      updated.finalPrice=Math.max(1000,Math.round(updated.price*(100-(updated.discountPercent||0))/100/1000)*1000);
      updated.imageUrl=updated.images?.[0] || item?.imageUrl;
    } else if (item && body.name) {
      state.products.forEach(p=>{if(p.category===item.name)p.category=body.name;});
    }
    if (method === "POST") { if (resource === "categories") state.categories.push(updated); else state.products.unshift(updated); }
    else state[resource]=state[resource].map(item=>item.id===id?updated:item);
    return respond({ [singular]:updated },method==="POST"?201:200);
  });
  await context.route("**/_vercel/insights/**",route=>route.fulfill({body:"",contentType:"text/javascript"}));
  return state;
}
