# Admin panel — holat va reja

Katalog 2026-09-07 da bo‘shatildi: saytda hardcoded mahsulot yo‘q, hamma narsa admin panel orqali qo‘shiladi.

## Bajarildi

| Imkoniyat | Qayerda |
| --- | --- |
| Parol bilan kirish | `admin-auth.mjs`, `admin-shell.js` |
| Mahsulot qo‘shish | `POST /api/admin/products` |
| **Mahsulotni tahrirlash** | `PATCH /api/admin/products?id=` → `updateProduct()` |
| **Faol / nofaol qilish** | `PATCH` bilan `{ "active": false }` → `setProductActive()` |
| Mahsulotni o‘chirish | `DELETE /api/admin/products?id=` |
| **Chegirma e’lon qilish** | `discountPercent` (0–90%), yakuniy narx `effectivePrice()` da hisoblanadi |
| **Statistika** | `GET /api/admin/stats` → `stats-service.mjs` |
| **Buyurtmalar tarixi** | `order-store.mjs` → Supabase `orders` jadvali yoki `data/orders.json` |
| **Google bilan kirish** | `auth-service.mjs` (PKCE) + `auth-session.mjs` (HttpOnly cookie) |
| **Admin huquqi email bo‘yicha** | `ADMIN_EMAILS` → rol har so‘rovda qayta hisoblanadi |
| **Admin API'da rate limit** | `rate-limit.mjs` → 15 daqiqada 10 urinish |
| **Mijoz buyurtmalar tarixi** | `GET /api/orders` → faqat o‘z buyurtmalari |
| **Mijozlar ro‘yxati** | `GET /api/admin/customers` → `customer-service.mjs` (faqat o‘qish) |
| **Har bir vazifa — alohida sahifa** | `/admin`, `/admin/categories`, `/admin/products`, `/admin/product`, `/admin/customers`; umumiy qism `admin-shell.js` da |
| **Rasm yuklash va optimizatsiya** | `sharp` → 1280px, WebP; Supabase Storage `product-images` |
| **Galereya (10 tagacha rasm)** | `images` jsonb; asosiy rasmni tanlash, tartibni o‘zgartirish |
| **Rasm hayot sikli** | o‘chirilgan/almashtirilgan rasm Storage’dan ham o‘chadi |

### Chegirma qanday ishlaydi

Admin foizni kiritadi (0–90). Yakuniy narx `price × (100 − foiz) / 100` bo‘lib, eng yaqin **1000 so‘mga yaxlitlanadi** — 422 500 emas, 423 000 ko‘rinadi. Bu bitta joyda, `product-service.mjs` dagi `effectivePrice()` da hisoblanadi; `admin-shell.js` faqat formada oldindan ko‘rsatish uchun shu formulani takrorlaydi, haqiqiy narxni doim server beradi.

Chegirma butun zanjir bo‘ylab o‘tadi: do‘kon kartochkasi va mahsulot oynasida chegirmali narx, ustidan chizilgan eski narx va `−N%` belgisi ko‘rinadi; savatcha jami chegirmali narx bo‘yicha hisoblanadi; `/api/order` mijoz yuborgan narxga emas, serverdagi `finalPrice` ga ishonadi; Telegram xabarida chegirma alohida qatorda yoziladi.

### Statistika nimani ko‘rsatadi

**Buyurtmalar:** bugun / 7 kun / 30 kun / jami kesimida soni va summasi, eng ko‘p sotilgan 5 mahsulot, oxirgi 10 buyurtma (raqam, sana, mijoz, telefon, summa). Kun chegarasi Asia/Tashkent vaqti bo‘yicha.

**Katalog:** jami / faol / nofaol mahsulotlar, chegirmadagilar soni va o‘rtacha foizi, katalog qiymati va o‘rtacha narx, brend va kategoriyalar taqsimoti.

Buyurtmalar jadvali hali yaratilmagan bo‘lsa, statistika yiqilmaydi — katalog qismini ko‘rsatib, `orders` jadvalini yaratish kerakligini aytadi.

## Qoldi

### Mahsulot boshqaruvi

3. **Rasmni Storage’dan ham o‘chirish.** `deleteProduct` bazadagi qatorni o‘chiradi, rasm Supabase Storage’da qolib ketadi.
4. **Serverda rasm optimizatsiyasi.** Yuklangan rasmni `sharp` bilan WebP’ga o‘girish va enini ~1280px gacha kichraytirish. Hozir 3 MB lik rasm o‘sha holicha saqlanadi va mijozga o‘shancha yuklanadi.
5. **Bir nechta rasm.** `imageUrl` (bitta matn) o‘rniga `images` massivi; eski qiymat birinchi element sifatida ko‘chiriladi.
6. **Rang → rasm bog‘lanishi.** `script.js` dagi modal `color.image` ni qo‘llab-quvvatlaydi, lekin admin panel uni to‘ldirmaydi.
7. **Ombor qoldig‘i.** O‘lcham × rang kesimida son; sotuvda yo‘q o‘lchamni modalda o‘chirib qo‘yish va `/api/order` da tekshirish.
8. **Chegirma muddati.** Hozir chegirma qo‘lda qo‘yiladi va qo‘lda olib tashlanadi. Aksiya sanasi qo‘shilsa, muddati tugagach avtomatik bekor bo‘ladi.

### Katalog o‘sganda

9. **Qidiruv va filtr** — nom bo‘yicha qidiruv, brend/kategoriya filtri, narx va sana bo‘yicha saralash.
10. **Sahifalash** — `/api/admin/products` hozir hammasini bir javobda qaytaradi.
11. **Kategoriya ro‘yxati** — hozir `admin.html` ichida `<select>` da qattiq yozilgan.
12. **Bosh sahifa uchun tanlov** — `index.html` dagi «Yangi kelganlar» bloki bo‘sh holat ko‘rsatadi; uni oxirgi mahsulotlar bilan to‘ldirish yoki adminda «bosh sahifada ko‘rsatish» belgisini qo‘shish.

### Buyurtmalar

13. **Buyurtma holati.** Hozir buyurtmalar faqat saqlanadi va statistikada ko‘rinadi. Holat (yangi → qabul qilindi → yetkazildi → bekor) va alohida buyurtmalar sahifasi qo‘shilsa, panel to‘liq boshqaruvga aylanadi.

### Sifat

14. **Audit log** — kim, qachon, qaysi mahsulotni o‘zgartirgani. Bir nechta odam ishlaydigan bo‘lsa zarur.
15. **Xatolik holatlari** — tarmoq uzilganda yoki 503 qaytganda admin panel nima ko‘rsatishi aniq bo‘lsin.

## Deploy oldidan

Supabase ishlatilayotgan bo‘lsa, `supabase-schema.sql` ni SQL editorda qayta ishga tushiring: u `products` jadvaliga `discount_percent` va `updated_at` ustunlarini qo‘shadi va `orders` jadvalini yaratadi. `alter table ... add column if not exists` ishlatilgani uchun mavjud ma’lumotlarga zarar yetmaydi.
