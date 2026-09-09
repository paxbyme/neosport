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

Kategoriyalar `/admin/categories` sahifasida boshqariladi va `categories` jadvalida saqlanadi (lokal rejimda `data/categories.json`). Sahifa birinchi ochilganda ro‘yxat o‘zi to‘ldiriladi: ilgari formaga qattiq yozilgan nomlar hamda katalogdagi mahsulotlarda uchraydigan har qanday boshqa kategoriya kiritiladi.

Har bir kategoriyaning **o‘lcham turi** bor — «Kiyim» (S–4XL) yoki «Oyoq kiyim» (36–45). Mahsulot formasidagi o‘lchamlar ro‘yxati shu turdan kelib chiqadi, ya’ni yangi qo‘shilgan kategoriya ham darrov to‘g‘ri o‘lchamlarni taklif qiladi. Sahifada kategoriyani qo‘shish, nomini va turini tahrirlash, tartibini ↑↓ bilan o‘zgartirish, nofaol qilish va o‘chirish mumkin:

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

## Statistika

`/admin` sahifasining birinchi bloki `GET /api/admin/stats` dan ma’lumot oladi: bugun / 7 kun / 30 kun / jami kesimida buyurtmalar soni va summasi, eng ko‘p sotilgan mahsulotlar, oxirgi buyurtmalar, hamda katalog kesimi (faol/nofaol, chegirmadagilar, katalog qiymati, brend va kategoriyalar).

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
