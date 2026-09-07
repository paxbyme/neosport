import { listOrders } from "./order-store.mjs";
import { listProducts } from "./product-service.mjs";

const DAY = 24 * 60 * 60 * 1000;

const tashkentDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tashkent",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const countBy = (items, pick) => {
  const counts = new Map();
  for (const item of items) {
    const key = pick(item);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

const buildCatalogStats = (products) => {
  const active = products.filter((product) => product.active);
  const discounted = active.filter((product) => product.discountPercent > 0);
  const catalogValue = active.reduce((sum, product) => sum + product.finalPrice, 0);

  return {
    total: products.length,
    active: active.length,
    inactive: products.length - active.length,
    discounted: discounted.length,
    averageDiscount: discounted.length
      ? Math.round(discounted.reduce((sum, product) => sum + product.discountPercent, 0) / discounted.length)
      : 0,
    catalogValue,
    averagePrice: active.length ? Math.round(catalogValue / active.length) : 0,
    brands: countBy(products, (product) => product.brand),
    categories: countBy(products, (product) => product.category),
  };
};

const summarize = (orders) => ({
  count: orders.length,
  revenue: orders.reduce((sum, order) => sum + order.total, 0),
  items: orders.reduce((sum, order) => sum + order.items.reduce((count, item) => count + item.quantity, 0), 0),
});

const buildTopProducts = (orders, limit = 5) => {
  const totals = new Map();

  for (const order of orders) {
    for (const item of order.items) {
      const key = item.productId || item.name;
      const entry = totals.get(key) || { name: item.name, brand: item.brand || "", quantity: 0, revenue: 0 };
      entry.quantity += item.quantity;
      entry.revenue += item.subtotal;
      totals.set(key, entry);
    }
  }

  return [...totals.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, limit);
};

export const buildStats = async (environment = process.env) => {
  const [products, orders] = await Promise.all([
    listProducts(environment, { includeInactive: true }),
    // Orders are optional: a store that has not sold anything yet still has a
    // catalog worth reporting on, and Supabase may not have the table yet.
    listOrders(environment).catch((error) => {
      console.error("Order history unavailable for stats", error.message);
      return null;
    }),
  ]);

  const catalog = buildCatalogStats(products);
  if (!orders) return { catalog, orders: null, generatedAt: new Date().toISOString() };

  const now = Date.now();
  const today = tashkentDate.format(new Date());
  const withTime = orders.map((order) => ({ ...order, time: Date.parse(order.createdAt) || 0 }));

  return {
    catalog,
    orders: {
      today: summarize(withTime.filter((order) => tashkentDate.format(new Date(order.time)) === today)),
      last7Days: summarize(withTime.filter((order) => now - order.time <= 7 * DAY)),
      last30Days: summarize(withTime.filter((order) => now - order.time <= 30 * DAY)),
      allTime: summarize(withTime),
      topProducts: buildTopProducts(withTime),
      recent: withTime.slice(0, 10).map((order) => ({
        id: order.id,
        createdAt: order.createdAt,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        itemCount: order.items.reduce((count, item) => count + item.quantity, 0),
        total: order.total,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
};
