import { initAdmin, apiRequest, isAuthError, numberFormat, formatMoney, formatCompactMoney, formatDateTime, escapeHtml } from "./admin-shell.js";

const statsBody = document.querySelector("#stats-body");
const statsRefresh = document.querySelector("#stats-refresh");

const statTile = ({ label, value, sub }) => `
  <div class="stat-tile">
    <span class="stat-label">${escapeHtml(label)}</span>
    <strong class="stat-value">${escapeHtml(value)}</strong>
    <span class="stat-sub">${escapeHtml(sub)}</span>
  </div>`;

const statTable = (title, headers, rows, emptyMessage) => `
  <div class="stat-table">
    <h3>${escapeHtml(title)}</h3>
    ${
      rows.length === 0
        ? `<p class="stat-table-empty">${escapeHtml(emptyMessage)}</p>`
        : `<div class="stat-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(title)}"><table>
      <thead><tr>${headers.map((head) => `<th scope="col">${escapeHtml(head)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`
    }
  </div>`;

const renderStats = (stats) => {
  const { catalog, orders } = stats;

  const catalogTiles = [
    {
      label: "Jami mahsulot",
      value: numberFormat.format(catalog.total),
      sub: `${catalog.active} faol · ${catalog.inactive} nofaol`,
    },
    {
      label: "Chegirmadagi mahsulot",
      value: numberFormat.format(catalog.discounted),
      sub: catalog.discounted > 0 ? `o‘rtacha ${catalog.averageDiscount}% chegirma` : "chegirma e’lon qilinmagan",
    },
    {
      label: "Katalog qiymati",
      value: `${formatCompactMoney(catalog.catalogValue)} so‘m`,
      sub: catalog.active > 0 ? `o‘rtacha ${formatMoney(catalog.averagePrice)}` : "faol mahsulot yo‘q",
    },
    {
      label: "Brend / kategoriya",
      value: `${catalog.brands.length} / ${catalog.categories.length}`,
      sub: catalog.brands.length ? `eng ko‘pi: ${catalog.brands[0].name} (${catalog.brands[0].count})` : "ma’lumot yo‘q",
    },
  ];

  const orderTiles = orders
    ? [
        { label: "Bugun", value: numberFormat.format(orders.today.count), sub: formatMoney(orders.today.revenue) },
        { label: "So‘nggi 7 kun", value: numberFormat.format(orders.last7Days.count), sub: formatMoney(orders.last7Days.revenue) },
        { label: "So‘nggi 30 kun", value: numberFormat.format(orders.last30Days.count), sub: formatMoney(orders.last30Days.revenue) },
        {
          label: "Jami buyurtma",
          value: numberFormat.format(orders.allTime.count),
          sub: `${numberFormat.format(orders.allTime.items)} dona · ${formatCompactMoney(orders.allTime.revenue)} so‘m`,
        },
      ]
    : [];

  const tables = orders
    ? [
        statTable(
          "Eng ko‘p sotilgan mahsulotlar",
          ["Mahsulot", "Soni", "Summa"],
          orders.topProducts.map((product) => [
            product.brand ? `${product.name} · ${product.brand}` : product.name,
            numberFormat.format(product.quantity),
            formatMoney(product.revenue),
          ]),
          "Hali sotuv bo‘lmadi.",
        ),
        statTable(
          "Oxirgi buyurtmalar",
          ["Raqam", "Sana", "Mijoz", "Telefon", "Soni", "Summa"],
          orders.recent.map((order) => [
            order.id,
            formatDateTime(order.createdAt),
            order.customerName,
            order.customerPhone,
            numberFormat.format(order.itemCount),
            formatMoney(order.total),
          ]),
          "Hali buyurtma qabul qilinmadi.",
        ),
      ]
    : [];

  statsBody.innerHTML = `
    <div class="stats-group">
      <h3 class="stats-group-title">Buyurtmalar</h3>
      ${
        orders
          ? `<div class="stats-grid">${orderTiles.map(statTile).join("")}</div>`
          : '<p class="admin-empty">Buyurtmalar tarixi hozircha mavjud emas. Keyinroq yangilab ko‘ring.</p>'
      }
    </div>
    <div class="stats-group">
      <h3 class="stats-group-title">Katalog</h3>
      <div class="stats-grid">${catalogTiles.map(statTile).join("")}</div>
    </div>
    ${tables.join("")}
    <p class="stats-generated">Yangilandi: ${escapeHtml(formatDateTime(stats.generatedAt))}</p>`;
};

const loadStats = async () => {
  if (!statsBody) return;
  statsRefresh.disabled = true;
  statsBody.setAttribute("aria-busy", "true");
  statsRefresh.textContent = "Yuklanmoqda...";
  try {
    const result = await apiRequest("/api/admin/stats");
    renderStats(result.stats);
  } catch (error) {
    if (isAuthError(error)) return;
    statsBody.innerHTML = `<p class="admin-empty">Statistikani yuklab bo‘lmadi: ${escapeHtml(error.message)}</p>`;
  } finally {
    statsRefresh.disabled = false;
    statsRefresh.textContent = "Yangilash";
    statsBody.setAttribute("aria-busy", "false");
  }
};

statsRefresh?.addEventListener("click", () => {
  loadStats();
});

initAdmin(loadStats);
