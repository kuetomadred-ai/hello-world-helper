# نشر خادم PLUTUS Paper Engine

## الحالة الحالية

ملفا migration مطبّقان على قاعدة Supabase الحية: `20261021120244_server_side_paper_engine` و`20261021120308_paper_trade_history`. الجداول والسياسات موجودة، لكنها فارغة؛ لم تُنقل أرصدة أو صفقات `pf_users_data.blob` لأنها بيانات عميل غير موثوقة. لا يوجد خادم منشور حتى الآن، ورابط API في `public/plotos/engine-config.js` فارغ، لذلك التداول متوقف بأمان.

## النشر

1. أنشئ خدمة Render من Blueprint هذا المستودع؛ سيستخدم `render.yaml` وDockerfile المبني على Bun 1.4.3.
2. أضف `SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY` كمتغيرات سرية في Render. لا تنسخ مفتاح الخدمة إلى الويب أو الهاتف.
3. بعد النشر، اختبر `https://<service>/health`. يجب أن يظهر `workerStatus: connected` و`brokerConnected: true` قبل إتاحة التداول.
4. ضع origin الخادم في `window.PLUTUS_ENGINE_API_URL` داخل `public/plotos/engine-config.js`، ثم أضف origin الواجهة المحدد إلى `CORS_ORIGINS` في Render.
5. أنشئ حسابات التداول عبر مسار ADMIN الخادمي؛ لا تُستورد الأرصدة القديمة من JSON تلقائياً.

## الاستمرارية

الخدمة المعرّفة حالياً تستخدم خطة Render المجانية. هذه الخطة لا تضمن تشغيل عامل الأسعار دون انقطاع؛ لذلك لا تعتبرها مراقبة 24/7. كما أن الخادم لم يُنشر بعد. لا تفعّل التداول قبل التحقق من حالة العامل والأسعار والحسابات في البيئة المنشورة.
