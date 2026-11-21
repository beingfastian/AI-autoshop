// Startup check for environment variables: fail fast with a clear message instead of failing mid-call.
// The rest of the code still reads process.env directly; this only validates it.
const { z } = require('zod');

const numeric = z.string().regex(/^\d+$/, 'must be a whole number');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: numeric.optional(),

  // Database: DB_* with defaults in config/database.js
  DB_HOST: z.string().min(1).optional(),
  DB_PORT: numeric.optional(),
  DB_NAME: z.string().min(1).optional(),
  DB_SSL: z.enum(['true', 'false']).optional(),

  // Interim auth for /api/calls and /api/bookings until real accounts exist
  API_KEY: z.string().min(32, 'must be at least 32 characters (e.g. `openssl rand -hex 32`)'),

  // Vapi sends this with every webhook; without it, webhook auth would compare against "undefined"
  VAPI_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters'),

  // Email
  SENDGRID_API_KEY: z.string().startsWith('SG.', 'must start with "SG."'),
  SENDGRID_FROM_EMAIL: z.email(),

  API_BASE_URL: z.url().optional(),

  RATE_LIMIT_WINDOW_MS: numeric.optional(),
  RATE_LIMIT_MAX_REQUESTS: numeric.optional(),

  // SMS (optional). When enabled, every Twilio setting must be present, or texts would fail silently later.
  ENABLE_SMS: z.enum(['true', 'false']).optional(),
  TWILIO_ACCOUNT_SID: z.string().startsWith('AC', 'must start with "AC"').optional(),
  TWILIO_AUTH_TOKEN: z.string().min(16, 'must be at least 16 characters').optional(),
  TWILIO_PHONE_NUMBER: z.string().regex(/^\+\d{7,15}$/, 'must be in international format, e.g. +15551234567').optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().startsWith('MG', 'must start with "MG"').optional()
}).superRefine((env, ctx) => {
  if (env.ENABLE_SMS !== 'true') return;
  for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']) {
    if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required when ENABLE_SMS=true' });
  }
  if (!env.TWILIO_PHONE_NUMBER && !env.TWILIO_MESSAGING_SERVICE_SID) {
    ctx.addIssue({
      code: 'custom',
      path: ['TWILIO_PHONE_NUMBER'],
      message: 'or TWILIO_MESSAGING_SERVICE_SID is required when ENABLE_SMS=true'
    });
  }
});

// Returns the validated values, or throws one error listing every problem
function validateEnv(env = process.env) {
  // Treat empty strings (e.g. `KEY=` copied from .env.example) as missing
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.');
    const message = issue.code !== 'custom' && cleaned[name] === undefined ? 'is missing' : issue.message;
    return `  - ${name} ${message}`;
  });
  throw new Error(`Invalid environment configuration:\n${problems.join('\n')}\nSee server/.env.example.`);
}

module.exports = { validateEnv };
