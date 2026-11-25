// Product name shown across the dashboard. NEXT_PUBLIC_BRAND_NAME can override it (e.g. a white-label
// build); it is read at build time.
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'Wrenchline';
export const BRAND_TAGLINE = 'AI receptionist for auto repair shops';

// The public demo login (a staff account on the sample shop). Set both at build time to show
// "Try the live demo" on the landing page; it is meant to be public, so it lives in the bundle.
const demoEmail = process.env.NEXT_PUBLIC_DEMO_EMAIL;
const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
export const DEMO_LOGIN = demoEmail && demoPassword ? { email: demoEmail, password: demoPassword } : null;
