# MedShelf Production Payments

This package is designed to make MedShelf accept real Razorpay payments for UPI and cards, with server-side amount calculation, database order storage, payment signature verification, and signed webhook processing.

## One-time setup (not code)

1. Deploy this project to Vercel.
2. Create a Supabase project and run `supabase_schema.sql` once.
3. In Vercel environment variables add:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FRONTEND_ORIGIN=https://hardikdilhor.github.io`
   - Optional email: `RESEND_API_KEY`, `EMAIL_FROM`
4. In Razorpay Dashboard, configure a webhook:
   `https://YOUR-VERCEL-DOMAIN/api/webhook`
   Use the same webhook secret stored in `RAZORPAY_WEBHOOK_SECRET`.
   Enable payment capture according to your Razorpay account configuration.
5. Replace the placeholder `MEDSHELF_PAYMENT_API` in `index.html` with the deployed Vercel API origin, or deploy the frontend itself on Vercel and set the value to the same origin.
6. Test in Razorpay Test Mode first. Only after your Razorpay account is activated should you replace test credentials with live credentials.

## Secrets

Never put `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, or `SUPABASE_SERVICE_ROLE_KEY` in GitHub or `index.html`.

## What is automated

- Trusted server-side catalogue pricing
- Unique order number
- Idempotent checkout creation via checkout attempt ID
- Razorpay order creation
- Server-side signature verification
- Amount/currency/order mapping checks
- Database order and item snapshot
- Signed webhook verification
- Webhook duplicate protection
- Marking captured payments as paid/confirmed
- Optional confirmation email via Resend

Card and UPI are both handled by Razorpay Checkout. MedShelf never receives raw card details.

Real-money processing still requires Razorpay merchant onboarding/activation and live credentials; those are intentionally not embedded in source code.
