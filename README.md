# NeoSport onlayn do‘koni

NeoSport erkaklar sport kiyimlari uchun Uzbekcha katalog, savatcha, Telegram buyurtma oqimi va mahsulot boshqaruv paneli.

## Local development

```bash
npm install
npm run dev
```

The local server runs at `http://localhost:4173` by default.

Onlayn do‘kon: `http://localhost:4173/shop`

Admin panel: `http://localhost:4173/admin`

## Environment variables

`.env.example` faylidan `.env` yarating va kerakli qiymatlarni kiriting; deploymentda shu qiymatlarni hosting environment sozlamalariga qo‘ying:

- `ADMIN_PASSWORD` — admin panel uchun uzun, noyob parol.
- `TELEGRAM_BOT_TOKEN` — BotFather bergan token.
- `TELEGRAM_CHAT_ID` — buyurtmalar keladigan Telegram chat yoki guruh IDsi.
- `TELEGRAM_MESSAGE_THREAD_ID` — ixtiyoriy, forum guruhidagi topic IDsi.
- `TELEGRAM_WEBHOOK_SECRET` — Telegram kirish webhook'ini himoyalaydi; kamida 16 belgi. Sozlanmagan bo‘lsa webhook har qanday so‘rovni rad etadi.
- `ADMIN_PHONES` — Telegram orqali kirganda admin huquqi beriladigan raqamlar (vergul bilan). Har qanday yozilishi mumkin: `+998901234567`, `998901234567`, `901234567`.
- `SITE_URL` — bot xabaridagi va webhook manzilidagi absolyut sayt manzili.
- `SUPABASE_URL` va `SUPABASE_SERVICE_ROLE_KEY` — production mahsulotlar bazasi.
- `SUPABASE_STORAGE_BUCKET` — mahsulot rasmlari uchun public bucket; standart qiymat `product-images`.

Lokal rejimda Supabase qiymatlari bo‘lmasa mahsulotlar `data/products.json` va rasmlar `assets/uploads/` ichida saqlanadi. Vercel Functions fayl tizimi doimiy saqlash uchun mo‘ljallanmagani sabab production’da Supabase majburiy. `supabase-schema.sql` faylini Supabase SQL editorida ishga tushiring va `product-images` nomli public Storage bucket yarating. Service-role key faqat server environment’ida saqlanadi va clientga yuborilmaydi.

## Katalog

Katalog bo‘sh holatdan boshlanadi — saytda birorta ham hardcoded mahsulot yo‘q. Har bir mahsulot admin panel (`/admin`) orqali qo‘shiladi va `/api/products` orqali do‘kon sahifasiga chiqadi. Katalog bo‘sh bo‘lsa, do‘kon sahifasi va admin ro‘yxati o‘zining bo‘sh holat matnini ko‘rsatadi. Mahsulot rasmlari repoda saqlanmaydi: production’da Supabase Storage’ga, lokalda `assets/uploads/` ichiga yuklanadi.

Admin panelda mahsulot qo‘shish, tahrirlash, faol/nofaol qilish va chegirma e’lon qilish mumkin. Har bir mahsulotga **10 tagacha rasm** yuklash mumkin; birinchisi asosiy hisoblanadi va katalog kartochkasida ko‘rinadi, qolganlari mahsulot oynasida kichik rasmlar sifatida chiqadi. Adminda rasmlarni o‘chirish va istalganini asosiy qilish mumkin. Yuklangan rasm serverda qayta kodlanadi: eni 1280px gacha kichraytiriladi va WebP’ga o‘giriladi (odatda 80%+ hajm kamayadi), shuning uchun katta fotosurat yuklashdan tortinmang. Mahsulot o‘chirilganda yoki galereyadan olib tashlanganda fayl Storage’dan ham o‘chadi. Chegirma foizda kiritiladi (0–90%); yakuniy narx eng yaqin 1000 so‘mga yaxlitlanadi va butun zanjir — do‘kon, savatcha, `/api/order`, Telegram xabari — shu narxdan foydalanadi.

### Kategoriyalar

Kategoriyalar admin panelning alohida bo‘limida (`02 KATEGORIYALAR`) boshqariladi va `categories` jadvalida saqlanadi (lokal rejimda `data/categories.json`). Bo‘lim birinchi ochilganda ro‘yxat o‘zi to‘ldiriladi: ilgari formaga qattiq yozilgan nomlar hamda katalogdagi mahsulotlarda uchraydigan har qanday boshqa kategoriya kiritiladi.

Har bir kategoriyaning **o‘lcham turi** bor — «Kiyim» (S–4XL) yoki «Oyoq kiyim» (36–45). Mahsulot formasidagi o‘lchamlar ro‘yxati shu turdan kelib chiqadi, ya’ni yangi qo‘shilgan kategoriya ham darrov to‘g‘ri o‘lchamlarni taklif qiladi. Bo‘limda kategoriyani qo‘shish, nomini va turini tahrirlash, tartibini ↑↓ bilan o‘zgartirish, nofaol qilish va o‘chirish mumkin:

- **Nomini o‘zgartirish** — o‘sha kategoriyadagi barcha mahsulotlar avtomatik yangi nomga o‘tadi (mahsulotda kategoriya matn sifatida saqlanadi).
- **Nofaol qilish** — kategoriya yangi mahsulot formasida ko‘rinmaydi, lekin mavjud mahsulotlar o‘z nomini saqlab qoladi.
- **O‘chirish** — faqat kategoriyada mahsulot qolmagan bo‘lsa ishlaydi; aks holda nechta mahsulot borligi aytiladi.

API: `GET/POST/PATCH/DELETE /api/admin/categories` (admin huquqi talab qilinadi).

## Kirish (Google va Telegram)

Saytda ham mijozlar, ham admin **Google hisobi** bilan kiradi. Oqim serverda kechadi: `/api/auth/login` PKCE bilan Supabase Auth'ga yo‘naltiradi, `/api/auth/callback` kodni almashtiradi va imzolangan **HttpOnly** cookie o‘rnatadi. Token brauzer JavaScript'iga hech qachon tushmaydi.

- **Mijozlar uchun login ixtiyoriy.** Kirmasdan ham, hozirgidek ism + telefon bilan buyurtma berish mumkin. Kirgan mijoz `/shop` sahifasida «Buyurtmalarim» bo‘limini ko‘radi va ismi avtomatik to‘ladi.
- **Admin huquqi** `ADMIN_EMAILS` ro‘yxatidagi email'larga beriladi. Rol cookie ichida saqlanmaydi — har bir so‘rovda ro‘yxatdan qayta hisoblanadi, shuning uchun email'ni ro‘yxatdan olib tashlash huquqni darhol bekor qiladi.
- **Admin API'da rate limit bor:** bitta IP uchun 15 daqiqada 10 ta muvaffaqiyatsiz urinish. Google sessiyasi bu tekshiruvdan oldin ishlaydi, ya'ni qulflanish sizni panelga kirishdan to‘smaydi.
- `ADMIN_PASSWORD` — eski parol yo‘li, faqat Google sozlanmaguncha. Uni sozlamasangiz, bu yo‘l butunlay o‘chiq bo‘ladi.

### Supabase dashboard sozlamalari

1. Authentication → Providers → **Google** ni yoqing va Google Cloud Console'dan olingan Client ID / Secret'ni kiriting.
2. Google Cloud Console'da **Authorized redirect URI** sifatida Supabase bergan `https://<loyiha>.supabase.co/auth/v1/callback` manzilini qo‘shing.
3. Supabase → Authentication → URL Configuration → **Redirect URLs** ga saytingizning callback manzilini qo‘shing: `https://<domen>/api/auth/callback` (va lokal ish uchun `http://localhost:4173/api/auth/callback`).

### Telegram orqali ro‘yxatdan o‘tish

Email'i yo‘q mijoz uchun ikkinchi yo‘l: **telefon raqamini Telegram bot orqali tasdiqlash**. Bu yerda ro‘yxatdan o‘tish va kirish bitta harakat — kontaktni ulashish.

1. Mijoz «Telegram» tugmasini bosadi. `/api/auth/telegram/start` bir martalik token yaratadi (`login_tokens`), uni **HttpOnly** cookie'ga yozadi va `t.me/<bot>?start=<token>` ga yo‘naltiradi.
2. Botdagi `/start <token>` webhook'ga keladi. Token qaysi chat ochganini yozib qo‘yadi — kontakt keyin **alohida** webhook chaqiruvida, boshqa instance'da kelishi mumkin.
3. Mijoz «📱 Telefon raqamni ulashish» tugmasini bosadi. Server kontakt egasi yuboruvchining o‘zi ekanini tekshiradi (birovning kontakt kartasi bilan kirib bo‘lmaydi), tokenni tasdiqlangan deb belgilaydi va mijozni `users` jadvaliga yozadi. Birinchi marta — ro‘yxatdan o‘tish, keyingilarida faqat `last_login_at` yangilanadi.
4. Ortda qolgan sahifa `/api/auth/telegram/status` ni so‘rab turadi. Token bir marta sarflanadi va sessiya cookie'si o‘rnatiladi.

Token 10 daqiqa yashaydi, eskirganlari keyingi kirishda tozalanadi. Sessiyada email o‘rniga tasdiqlangan raqam turadi: u savatchadagi telefon maydonini to‘ldiradi, buyurtmaga `user_phone` bo‘lib yoziladi va operatorga ketadigan xabarda «Tasdiqlangan hisob» qatorida ko‘rinadi. `ADMIN_PHONES` dagi raqam bilan kirgan odam admin bo‘ladi.

Webhook'ni ro‘yxatdan o‘tkazish (bot tokeni bo‘lgan muhitda bir marta, keyin domen yoki sir o‘zgarganda):

```bash
npm run telegram:setup
```

Bu `setWebhook` ni `<SITE_URL>/api/telegram/webhook` manziliga chaqiradi va `getWebhookInfo` natijasini ko‘rsatadi. `vercel env pull` production sirlarini `[SENSITIVE]` qilib beradi, shuning uchun buyruqni ishlatish uchun `TELEGRAM_BOT_TOKEN` va `TELEGRAM_WEBHOOK_SECRET` ni Development muhitiga ham qo‘shing.

## Statistika

`/admin` sahifasining birinchi bloki `GET /api/admin/stats` dan ma’lumot oladi: bugun / 7 kun / 30 kun / jami kesimida buyurtmalar soni va summasi, eng ko‘p sotilgan mahsulotlar, oxirgi buyurtmalar, hamda katalog kesimi (faol/nofaol, chegirmadagilar, katalog qiymati, brend va kategoriyalar).

Buyurtmalar `orders` jadvalida (lokalda `data/orders.json` da) saqlanadi. Bu fayl mijoz ismi va telefon raqamini saqlagani uchun `.gitignore` da. Jadval hali yaratilmagan bo‘lsa statistika katalog qismini ko‘rsatishda davom etadi.

Keyingi bosqichlar uchun reja: [docs/admin-panel-reja.md](docs/admin-panel-reja.md).

## Buyurtma oqimi

Client rang va o‘lchamni tanlaydi, savatchaga qo‘shadi, keyin ism va telefon raqamini kiritadi. `/api/order` mahsulot va narxlarni serverdagi katalog bilan qayta tekshiradi va buyurtmani Telegram Bot API orqali operatorga yuboradi. Bot tokeni hech qachon browser JavaScript’iga kiritilmaydi.

## Build and test

```bash
npm run build
npm test
```

The build regenerates WebP derivatives, verifies at least a 60% byte reduction against the displayed PNG fallbacks, and writes the storefront and admin assets to `dist/`. The smoke tests check the storefront, cart, admin panel, order validation, links, metadata, image fallbacks, and production artifacts.

## Analytics contract

Vercel Web Analytics is loaded through the static HTML script. Conversion links emit `outbound_click` when the Vercel event function is available, with two non-personal string properties:

- `location`: `hero`, `product`, `category`, `mobile`, `store`, or `footer`
- `destination`: `instagram` or `maps`

`add_to_cart` and `order_submitted` events contain no customer name or phone number.

If custom events are unavailable for the deployment plan, links continue normally and page-view analytics can still load.
