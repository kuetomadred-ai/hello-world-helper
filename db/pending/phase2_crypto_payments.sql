-- Phase 2 (NOT APPLIED — needs approval). Payment = PAID flag only; request stays PENDING for ADMIN/FINANCE.
CREATE TABLE public.pf_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  funding_request_id uuid NOT NULL REFERENCES public.pf_funding_requests(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'nowpayments',
  provider_invoice_id text UNIQUE,
  provider_payment_id text,
  amount_usd numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  pay_currency text,
  status text NOT NULL DEFAULT 'waiting',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pf_payments TO authenticated;
GRANT ALL ON public.pf_payments TO service_role;
ALTER TABLE public.pf_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY pf_payments_read ON public.pf_payments FOR SELECT TO authenticated
USING (user_id = auth.uid() OR coalesce(auth.jwt()->'app_metadata'->>'role','') IN ('ADMIN','FINANCE'));
CREATE INDEX pf_payments_request_idx ON public.pf_payments(funding_request_id);
