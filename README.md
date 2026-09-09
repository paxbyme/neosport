# NeoSport onlayn do‘koni

NeoSport erkaklar sport kiyimlari uchun Uzbekcha katalog, savatcha, Telegram buyurtma oqimi va mahsulot boshqaruv paneli.

## Local development

```bash
npm install
npm run dev
```

The local server runs at `http://localhost:4173` by default.

Onlayn do‘kon: `http://localhost:4173/shop`

Mahsulot sahifasi: `http://localhost:4173/products/<id>`

Admin panel: `http://localhost:4173/admin`

### Do‘kon sahifalari

| Manzil | Hujjat | Vazifa | So‘rovlari |
| --- | --- | --- | --- |
| `/` | `index.html` · `script.js` | Bosh sahifa va qisqa katalog | `/api/products`, `/api/auth/me` |
| `/shop` | `shop.html` · `script.js` | To‘liq katalog, savatcha, buyurtmalarim | `+ /api/orders` |
| `/products/<id>` | `product.html` · `api/product-page.mjs` · `script.js` | Bitta mahsulot sahifasi | `/api/products?id=<id>` |

Boshqa sahifalardan farqli o‘laroq, mahsulot sahifasini **funksiya** qaytaradi: `api/product-page.mjs` `product.html` ni o‘qiydi, `<head>` ichidagi sarlavha, tavsif, rasm va manzilni shu mahsulotniki bilan almashtiradi va shu hujjatni yuboradi. Brauzer keyin mahsulotni odatdagidek o‘zi yuklaydi. Sabab: **Telegram va Instagram havola ko‘rinishini tayyorlaganda skriptni ishga tushirmaydi** — metama’lumot serverda to‘ldirilmasa, ulashilgan har bir mahsulot bir xil umumiy ko‘rinishda chiqadi. Do‘konning asosiy kanali shu ikkisi bo‘lgani uchun bu muhim.

Shu sababli marshrut uchta joyda qayd etiladi: `server.mjs` (`PRODUCT_PATH` → `productPageHandler`), `vercel.json` dagi `rewrites` (`/products/(...)` → `/api/product-page?id=$1`) va `build.mjs` dagi `files`. `vercel.json` dagi `functions.includeFiles` `product.html` ni funksiya bilan birga joylaydi, aks holda u runtime’da topilmaydi. `preview-static.mjs` ga qo‘shish shart emas — bu manzil statik fayl darvozasiga umuman yetib bormaydi.

Bitta hujjat barcha mahsulotlarga xizmat qiladi; qaysi mahsulot ekanini faqat manzildagi `id` hal qiladi. Mavjud bo‘lmagan yoki nofaol mahsulot **404** qaytaradi (sahifaning o‘zi baribir ko‘rsatiladi), katalog ishlamay qolsa esa sahifa **200** bilan keladi va skript qayta urinadi. `og:image` va `og:url` uchun to‘liq manzil kerak: u `SITE_URL` dan, u yo‘q bo‘lsa so‘rov host’idan olinadi.

> Vercel Hobby rejasida 12 tagacha Serverless Function bo‘lishi mumkin. `api/` hozir 11 tasini ishlatadi.

### Admin sahifalari

Har bir boshqaruv vazifasi o‘z manzili va o‘z hujjatiga ega. Sahifa yuklanganda faqat o‘sha vazifaga kerakli so‘rov yuboriladi.

| Manzil | Hujjat / skript | Vazifa | So‘rovlari |
| --- | --- | --- | --- |
| `/admin` | `admin.html` · `admin-stats.js` | Statistika | `/api/admin/stats` |
| `/admin/categories` | `admin-categories.html` · `admin-categories.js` | Kategoriyalar | `/api/admin/categories`, `/api/admin/products` |
| `/admin/products` | `admin-products.html` · `admin-products.js` | Katalog ro‘yxati | `/api/admin/products` |
| `/admin/product` | `admin-product.html` · `admin-product.js` | Mahsulot qo‘shish | `/api/admin/categories` |
| `/admin/product?id=<id>` | yuqoridagi | Mahsulotni tahrirlash | `+ /api/admin/products` |
| `/admin/customers` | `admin-customers.html` · `admin-customers.js` | Mijozlar | `/api/admin/customers` |
| `/admin/admins` | `admin-admins.html` · `admin-admins.js` | Adminlar | `/api/admin/admins` |

Umumiy qism — sarlavha, menyu, kirish darvozasi, `apiRequest()` va formatlash yordamchilari — `admin-shell.js` da; sahifa skriptlari uni ES modul sifatida import qiladi. Kategoriyalar sahifasi mahsulotlarni ham yuklaydi, chunki ishlatilayotgan kategoriyani o‘chirishdan himoya shunga tayanadi; mahsulot formasi kategoriyalarga tayanadi, chunki o‘lcham to‘plami kategoriya turidan kelib chiqadi.

Eski `#stats`, `#categories`, `#products`, `#editor`, `#customers` xatcho‘plari `/admin` da tegishli sahifaga o‘zi yo‘naltiriladi.

Yangi admin sahifasi qo‘shilsa, u **to‘rt joyda** ham qayd etilishi shart: `server.mjs` dagi `pageFile`, `vercel.json` dagi `rewrites`, `preview-static.mjs` dagi `publicPaths` va `build.mjs` dagi `files`. Bittasi unutilsa xatolik faqat ishga tushirishda ko‘rinadi, shuning uchun buni test tekshiradi.

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

Har bir mahsulotning o‘z doimiy manzili bor: `/products/<id>`. Kartochkadagi rasm, nom va «Tanlash» tugmasi — oddiy havolalar, shuning uchun mahsulotni yangi tabda ochish, havolasini ulashish va xatcho‘pga qo‘yish mumkin. Sahifa faqat manzildagi `id` asosida `GET /api/products?id=<id>` so‘rovi bilan yuklanadi: katalogdan o‘tish shart emas, sahifani yangilash yoki havolani boshqa brauzerda ochish ham xuddi shunday ishlaydi. Yuklanayotgan, topilmagan va xatolik holatlarining har biri o‘z ko‘rinishiga ega; nofaol mahsulot mijoz uchun mavjud emas kabi ko‘rinadi. Rang, o‘lcham, soni va savatchaga qo‘shish — hammasi shu sahifada.

Admin panelda mahsulot qo‘shish, tahrirlash, faol/nofaol qilish va chegirma e’lon qilish mumkin. Har bir mahsulotga **10 tagacha rasm** yuklash mumkin; birinchisi asosiy hisoblanadi va katalog kartochkasida ko‘rinadi, qolganlari mahsulot oynasida kichik rasmlar sifatida chiqadi. Adminda rasmlarni o‘chirish va istalganini asosiy qilish mumkin. Yuklangan rasm serverda qayta kodlanadi: eni 1280px gacha kichraytiriladi va WebP’ga o‘giriladi (odatda 80%+ hajm kamayadi), shuning uchun katta fotosurat yuklashdan tortinmang. Mahsulot o‘chirilganda yoki galereyadan olib tashlanganda fayl Storage’dan ham o‘chadi. Chegirma foizda kiritiladi (0–90%); yakuniy narx eng yaqin 1000 so‘mga yaxlitlanadi va butun zanjir — do‘kon, savatcha, `/api/order`, Telegram xabari — shu narxdan foydalanadi.

### Kategoriyalar

Kategoriyalar `/admin/categories` sahifasida boshqariladi va `categories` jadvalida saqlanadi (lokal rejimda `data/categories.json`). Sahifa birinchi ochilganda ro‘yxat o‘zi to‘ldiriladi: ilgari formaga qattiq yozilgan nomlar hamda katalogdagi mahsulotlarda uchraydigan har qanday boshqa kategoriya kiritiladi.

Har bir kategoriyaning **o‘lcham turi** bor — «Kiyim» (S–4XL) yoki «Oyoq kiyim» (36–45). Mahsulot formasidagi o‘lchamlar ro‘yxati shu turdan kelib chiqadi, ya’ni yangi qo‘shilgan kategoriya ham darrov to‘g‘ri o‘lchamlarni taklif qiladi. Sahifada kategoriyani qo‘shish, nomini va turini tahrirlash, tartibini ↑↓ bilan o‘zgartirish, nofaol qilish va o‘chirish mumkin:

- **Nomini o‘zgartirish** — o‘sha kategoriyadagi barcha mahsulotlar avtomatik yangi nomga o‘tadi (mahsulotda kategoriya matn sifatida saqlanadi).
- **Nofaol qilish** — kategoriya yangi mahsulot formasida ko‘rinmaydi, lekin mavjud mahsulotlar o‘z nomini saqlab qoladi.
- **O‘chirish** — faqat kategoriyada mahsulot qolmagan bo‘lsa ishlaydi; aks holda nechta mahsulot borligi aytiladi.

API: `GET/POST/PATCH/DELETE /api/admin/categories` (admin huquqi talab qilinadi).

## Kirish (Google va Telegram)

Saytda ham mijozlar, ham admin **Google hisobi** bilan kiradi. Oqim serverda kechadi: `/api/auth/login` PKCE bilan Supabase Auth'ga yo‘naltiradi, `/api/auth/callback` kodni almashtiradi va imzolangan **HttpOnly** cookie o‘rnatadi. Token brauzer JavaScript'iga hech qachon tushmaydi.

- **Mijozlar uchun login ixtiyoriy.** Kirmasdan ham, hozirgidek ism + telefon bilan buyurtma berish mumkin. Kirgan mijoz `/shop` sahifasida «Buyurtmalarim» bo‘limini ko‘radi va ismi avtomatik to‘ladi.
- **Admin huquqi** ikki manbadan keladi: `ADMIN_EMAILS` / `ADMIN_PHONES` ro‘yxatlari va `/admin/admins` sahifasi orqali qo‘shilgan hisoblar. Rol cookie ichida saqlanmaydi — har bir so‘rovda qayta hisoblanadi, shuning uchun ro‘yxatdan olib tashlash huquqni darhol bekor qiladi.
- **Admin API'da rate limit bor:** bitta IP uchun 15 daqiqada 10 ta muvaffaqiyatsiz urinish. Google sessiyasi bu tekshiruvdan oldin ishlaydi, ya'ni qulflanish sizni panelga kirishdan to‘smaydi.
- `ADMIN_PASSWORD` — eski parol yo‘li, faqat Google sozlanmaguncha. Uni sozlamasangiz, bu yo‘l butunlay o‘chiq bo‘ladi.

### Supabase dashboard sozlamalari

1. Authentication → Providers → **Google** ni yoqing va Google Cloud Console'dan olingan Client ID / Secret'ni kiriting.
2. Google Cloud Console'da **Authorized redirect URI** sifatida Supabase bergan `https://<loyiha>.supabase.co/auth/v1/callback` manzilini qo‘shing.
3. Supabase → Authentication → URL Configuration → **Redirect URLs** ga saytingizning callback manzilini qo‘shing: `https://<domen>/api/auth/callback` (va lokal ish uchun `http://localhost:4173/api/auth/callback`).

### Telegram orqali ro‘yxatdan o‘tish

Email'i yo‘q mijoz uchun ikkinchi yo‘l: **telefon raqamini Telegram bot orqali tasdiqlash**. Bu yerda ro‘yxatdan o‘tish va kirish bitta harakat — kontaktni ulashish.

1. Mijoz «Telegram» tugmasini bosadi. Bosh sahifa, `/shop` va `/admin` bitta `telegram-login.js` dialogidan foydalanadi. `/api/auth/telegram/start` bir martalik 10 daqiqalik token yaratadi (`login_tokens`), imzolangan brauzer dalilini **HttpOnly** `ns_tg` cookie’siga yozadi va JSON orqali bot havolasini qaytaradi. Oddiy havola orqali kirish uchun avvalgi 302 yo‘naltirish ham ishlaydi.
2. Botdagi `/start <token>` webhook’ga keladi. Faqat shaxsiy chat qabul qilinadi. Token uni birinchi ochgan Telegram hisobiga atomar bog‘lanadi; boshqa hisobga almashtirib bo‘lmaydi.
3. Mijoz «📱 Telefon raqamni ulashish» tugmasini bosadi. Server kontakt egasi yuboruvchining o‘zi ekanini, telefon raqamini va token muddatini tekshiradi. Tasdiqlangan mijoz avvalgi `users` jadvaliga yoziladi.
4. Mijoz **kirishni boshlagan brauzer sahifasiga qaytadi**. Dialog `/api/auth/telegram/status` orqali kutadi, vaqtinchalik ulanish xatosidan keyin avtomatik qayta tekshiradi va ilovadan qaytilganda davom etadi. Token faqat bir marta sarflanadi, imzolangan `ns_session` cookie’si o‘rnatiladi va mijoz boshlang‘ich sahifasiga qaytadi.

Popup bloklansa, «Telegramni ochish» havolasi qoladi. Dialog holati sahifa yangilanganda tiklanadi; brauzer xotirasida token yoki sir saqlanmaydi. Havola eskirsa qaytadan boshlash mumkin. Escape yoki yopish tugmasi `POST /api/auth/telegram/cancel` orqali kutilayotgan kirishni bekor qiladi. Chiqish kutilayotgan kirishni ham tozalaydi.

Tasdiqlangan ism va telefon savatchada avtomatik to‘ldiriladi. Avvalgi buyurtma tarixi, `tg:<chatId>` mijoz identifikatori va Telegram buyurtma xabarlari saqlangan. `ADMIN_PHONES` dagi raqamlar admin huquqini oladi; bu ro‘yxat har bir sessiya tekshiruvida qayta qo‘llanadi. Mijozlarga admin navigatsiyasi ko‘rsatilmaydi.

Sozlash uchun server muhitida `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (16–256 ta harf, raqam, `_` yoki `-`), `SESSION_SECRET` (kamida 32 belgi), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` va aniq HTTPS `SITE_URL` bo‘lishi kerak. `supabase-schema.sql` dagi `login_tokens` va `users` jadvallari talab qilinadi. Bot tokeni va servis kaliti hech qachon brauzerga berilmaydi. Telegram tugmasi faqat zarur kirish sozlamalari mavjud bo‘lganda ko‘rinadi.

```bash
# Faqat o‘qish: konfiguratsiya, bot, jadval/ustunlar va webhook manzilini tekshiradi.
# Mijoz ma’lumotlarini yuklamaydi, webhook yoki katalogni o‘zgartirmaydi.
npm run telegram:check

# Webhook’ni SITE_URL uchun ro‘yxatdan o‘tkazadi; kutilayotgan xabarlarni saqlaydi.
# Bot tokeni bo‘lgan muhitda, dastlab va domen/webhook siri o‘zgarganda ishlating.
npm run telegram:setup
```

`--check` Telegram saqlagan webhook sirini tekshira olmaydi, chunki API uni qaytarmaydi. Yakuniy tekshiruv: sayt orqali kirishni boshlang, botda o‘z raqamingizni ulashing va boshlang‘ich brauzer tabiga qayting. Localhost’ga Telegram webhook yubora olmaydi; haqiqiy sinov HTTPS muhitida bajariladi. `vercel env pull` dan kelgan `[SENSITIVE]` qiymatlar sir o‘rnini bosa olmaydi — haqiqiy qiymatlarni server muhitiga yoki mahalliy `.env.local` fayliga xavfsiz kiriting.

Yangilanish avval boshlangan, imzosiz `ns_tg` urinishlarini bekor qiladi; ular qaytadan boshlanadi. Mavjud `ns_session` sessiyalari va saqlangan savatchalar o‘zgarmaydi. Yangi jadval yoki ma’lumotlar migratsiyasi qo‘shilmadi. Kirish urinishlariga mavjud xotira asosidagi cheklov qo‘llanadi (instance va manzil uchun 10 daqiqada 10 urinish).

### Admin qo‘shish

Yangi adminni `/admin/admins` sahifasidan qo‘shish mumkin — server sozlamalarini o‘zgartirib, qaytadan deploy qilish shart emas. Google hisobi uchun **email**, Telegram hisobi uchun **telefon raqami** kiritiladi; sessiya shu ikkitasidan bittasini olib yuradi, shuning uchun formada ham faqat bittasi to‘ldiriladi. Qo‘shilgan hisoblar `admins` jadvalida (lokalda `data/admins.json`) saqlanadi va kim qo‘shgani yozib boriladi.

Ikki manba ataylab bir xil ishlamaydi:

- `ADMIN_EMAILS` va `ADMIN_PHONES` — **zaxira yo‘l**. Ular bazaga umuman murojaat qilmaydi, har so‘rovda qaytadan hisoblanadi va **panel orqali o‘chirilmaydi**. Shuning uchun baza ishlamay qolsa ham, panelda noto‘g‘ri satr o‘chirilsa ham, do‘konga kirish yo‘li yopilib qolmaydi.
- `admins` jadvali — panel boshqaradigan ro‘yxat. U faqat environment «yo‘q» degandan keyin tekshiriladi, ya’ni oddiy mijoz so‘rovi bu qidiruvni umuman to‘lamaydi.

Qo‘shimcha qoidalar: admin **o‘zini** ro‘yxatdan chiqara olmaydi (aks holda o‘zi ocholmaydigan panelga qarab qoladi), adminlar ro‘yxatini faqat admin ko‘ra va o‘zgartira oladi, va ro‘yxatni o‘qib bo‘lmasa so‘rov **503** bilan rad etiladi — ishlamayotgan baza hech kimni jimgina huquqdan mahrum qilmaydi.

`admins` jadvali `supabase-schema.sql` ichida; mavjud o‘rnatmalarda faylni qayta ishga tushirish yetarli (`create table if not exists`).

> Vercel Hobby rejasida 12 tagacha Serverless Function bo‘lishi mumkin. `api/` hozir 11 tasini ishlatadi.

## Statistika

`/admin` — panelning bosh sahifasi; u `GET /api/admin/stats` dan ma’lumot oladi: bugun / 7 kun / 30 kun / jami kesimida buyurtmalar soni va summasi, eng ko‘p sotilgan mahsulotlar, oxirgi buyurtmalar, hamda katalog kesimi (faol/nofaol, chegirmadagilar, katalog qiymati, brend va kategoriyalar).

### Buyurtmalar mijozlarga bo‘linadi

Har bir buyurtmaning noyob raqami (`NS-…`) bor va u buyurtma bergan hisobga `user_id` orqali bog‘lanadi. Mijoz **faqat o‘z** buyurtmalarini ko‘radi:

- `GET /api/orders` — ro‘yxat. Faqat sessiya cookie’sidagi hisob bo‘yicha filtrlanadi; brauzer yuborgan hech qanday parametr bunga ta’sir qilmaydi.
- `GET /api/orders/<id>` (Vercel’da `/api/orders?id=<id>` ga rewrite qilinadi) — bitta buyurtma. Server buyurtmani topib, uni sessiyadagi hisob bilan solishtiradi. Boshqa mijozning raqamini kiritish **404** beradi — mavjud bo‘lmagan raqam bilan bir xil javob, ya’ni endpoint orqali raqamlarni topib bo‘lmaydi. Kirmasdan berilgan buyurtma hech kimga tegishli emas va hech kimga ochilmaydi.
- Admin huquqi saqlanadi: rol har so‘rovda `ADMIN_EMAILS` / `ADMIN_PHONES` dan qayta hisoblanadi, cookie’dan olinmaydi.

Javoblar `Cache-Control: no-store` va `Vary: Cookie` bilan qaytadi. Sahifa tomonida ham hisob almashsa yoki chiqib ketilsa, oldingi mijozning buyurtmalari darhol tozalanadi — sahifa orqaga qaytishdan tiklansa ham (`pageshow`) sessiya qaytadan o‘qiladi.

Buyurtmalar `orders` jadvalida (lokalda `data/orders.json` da) saqlanadi. Bu fayl mijoz ismi va telefon raqamini saqlagani uchun `.gitignore` da. Jadval hali yaratilmagan bo‘lsa statistika katalog qismini ko‘rsatishda davom etadi.

Keyingi bosqichlar uchun reja: [docs/admin-panel-reja.md](docs/admin-panel-reja.md).

## Mijozlar

`/admin/customers` sahifasi `GET /api/admin/customers` dan ro‘yxatni oladi: ism, telefon (bosilsa qo‘ng‘iroq qilinadi), ro‘yxatdan o‘tgan va oxirgi kirgan sanasi, buyurtmalar soni, jami xarid summasi va oxirgi buyurtma sanasi. Ism yoki telefon bo‘yicha qidirish, oxirgi harakat / xarid summasi / buyurtmalar soni / ro‘yxatdan o‘tgan sana bo‘yicha tartiblash mumkin. Sahifa faqat o‘qiydi — panel orqali mijoz qo‘shilmaydi, o‘zgartirilmaydi va o‘chirilmaydi.

Ro‘yxat `users` jadvalidan olinadi, buyurtmalar esa ikki yo‘l bilan mijozga bog‘lanadi: kirgan holda berilgan buyurtma `user_id` bilan, kirishdan oldin berilgani telefon raqami bilan. Shuning uchun bitta buyurtma ikki marta hisoblanmaydi. Bitta raqamda ikkita Telegram hisobi bo‘lsa, kirishdan oldingi buyurtmalar eskiroq hisobga yoziladi.

Mijozni qo‘shish paneldan emas: xaridor Telegram orqali o‘zi ro‘yxatdan o‘tadi. Admin huquqi esa `ADMIN_EMAILS` va `ADMIN_PHONES` orqali beriladi.

Ma’lumotlar bazasi ulanmagan bo‘lsa (lokal ish), ro‘yxat `data/orders.json` dagi buyurtmalardan tuziladi va panel buni alohida yozib qo‘yadi. `orders` jadvali mavjud bo‘lmasa mijozlar baribir ko‘rinadi, faqat xarid summalari bo‘sh qoladi.

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
