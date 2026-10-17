# نشر خادم Plutus مجاناً (Render)

1. **قاعدة البيانات (مرة واحدة):** افتح SQL Editor في لوحة قاعدة البيانات، الصق محتوى
   `supabase/migrations/20261016090000_server_side_paper_engine.sql` ونفّذه (يفضّل تجربته على نسخة اختبار أولاً).
2. **Render:** New → Blueprint → اختر مستودع GitHub. سيقرأ `render.yaml` تلقائياً.
   أدخل القيم السرية عند الطلب: `SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY` (مفتاح جديد بعد التدوير).
3. **الربط:** بعد النشر انسخ الرابط (مثل `https://plutus-engine.onrender.com`) وضعه في
   `public/plotos/engine-config.js` → `window.PLUTUS_ENGINE_API_URL`.
4. **تحقق:** افتح `<الرابط>/health` يجب أن يرد بنجاح.

ملاحظة: الخطة المجانية في Render تنام بعد 15 دقيقة بلا طلبات؛ استخدم مراقِباً مجانياً (مثل UptimeRobot) يطلب `/health` كل 5 دقائق لإبقائه يعمل.
