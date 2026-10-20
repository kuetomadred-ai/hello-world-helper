# خادم ومحرك التداول المحاكى

محرك PLUTUS يعمل على الخادم باستخدام Fastify وSupabase وBiquote SignalR. التداول **محاكاة فقط**؛ لا توجد واجهة لإرسال أوامر إلى وسيط. لا تضع `SUPABASE_SERVICE_ROLE_KEY` في تطبيق الهاتف أو الويب.

## المتطلبات

- Bun 1.4.3 وNode.js 22+.
- `SUPABASE_URL` و`SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY` (الأخير للخادم فقط).
- اتصال صادر إلى Biquote SignalR.
- ملف migration للمحرك موجود في `supabase/migrations/20261016090000_server_side_paper_engine.sql`. **لم يُطبّق هذا التحديث أي تغيير على قاعدة Supabase السحابية.** راجع المخطط واختبر migration على staging بعد موافقة منفصلة قبل تطبيقها على أي قاعدة.

## التشغيل المحلي

```sh
cd backend
bun install --frozen-lockfile
cp .env.example .env
bun run typecheck
bun run test
bun run start
```

`start` يشغّل REST API وعامل Biquote في عملية واحدة ويغلقهما معًا عند الإيقاف. للتطوير المنفصل فقط يمكن تشغيل `bun run api` و`bun run worker`. المتغيرات موثقة في `.env.example`. `CORS_ORIGINS` قائمة أصول الواجهة مفصولة بفواصل، و`ENGINE_SYMBOLS` قائمة الأدوات المسموح بها.

## Hardening على فرع الميزة

تضيف API الحالية request IDs ورؤوس HTTP أمنية ومحدد معدل ثابتاً بحد 300 طلب لكل IP في الدقيقة، مع استثناء `/health`. المحدد داخل الذاكرة ويغطي نسخة عملية واحدة فقط؛ أي نشر متعدد النسخ يحتاج مخزناً مشتركاً مثل Redis/Key Value، ولا يُعد ضماناً إنتاجياً كاملاً. وحدة `src/risk.ts` أساس حسابي خالص، وليست موصولة بعد بالـRPC أو العامل. أضيفت migration `20261019000000_security_hardening.sql` للمراجعة فقط؛ لم تُطبق على Supabase. لا تعتبر المقاييس أو حدود Prop Firm فعالة قبل تكامل RPC/worker واختبار migration في بيئة معزولة.

## API

- `GET /health`
- `GET /v1/accounts` و`GET /v1/accounts/:id/state` — حسابات المستخدم الموثق فقط؛ تتضمن الحالة سجل الصفقات المغلقة والجزئية.
- `POST /v1/admin/accounts` — يتطلب مستخدم ADMIN موثقًا.
- `POST /v1/orders` — يتطلب رمز Supabase صالحًا و`accountId`, `requestId`, `symbol`, `side`, `type`, `lots`؛ `requestId` مفتاح idempotency.
- `POST /v1/positions/:id/close` و`/close-partial`، و`POST /v1/positions/:id/protection`.
- `POST /v1/orders/:id/modify` و`/cancel` — لأوامر المستخدم المعلقة فقط.

يتحقق الخادم من جلسة المستخدم وينفذ عمليات قاعدة البيانات عبر RPC بصلاحيات الخادم؛ لا يقبل سعر تنفيذ من العميل. يتابع العامل أسعار Biquote ويعالج SL/TP والأوامر المعلقة. سجل الإغلاق يحفظه جدول `pf_engine_trades_history` عند تطبيق migration.

## Render

`render.yaml` و`Dockerfile` يجهزان خدمة ويب للاختبار. أدخل مفاتيح Supabase في لوحة الاستضافة فقط. خدمة Render المجانية تنام بعد 15 دقيقة بلا طلبات واردة، لذلك لا توفر مراقبة أسعار موثوقة على مدار 24/7؛ لا تستخدم طلبات ping للتحايل على ذلك.

## ربط الواجهة والحدود

اضبط `window.PLUTUS_ENGINE_API_URL` في `public/plotos/engine-config.js` إلى أصل المحرك بعد نشره، ثم أضف أصل الواجهة إلى `CORS_ORIGINS`. قيمة الإعداد فارغة حاليًا، لذا لا تُرسل الواجهة أوامر تداول حتى يُنشر الخادم ويُربط. إذا غاب الخادم أو تعذر الاتصال به، يفشل التنفيذ مغلقًا ولا يعود إلى محرك محلي.

طلبات NOWPayments تظل ضمن خادم تطبيق الواجهة في `src/routes/api/public/payments/`، وليست ضمن هذا المحرك. لا تُدرج أسرار الدفع أو مفاتيح الخدمة في ملفات الواجهة أو Git.
