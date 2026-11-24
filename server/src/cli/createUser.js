// Creates a dashboard login for a shop, or resets the password of an existing one.
//
//   npm --prefix server run user:create -- --shop joe@joeauto.com --email owner@joeauto.com --name "Joe Smith"
//
// Options: --role owner|staff (default owner). The password comes from the NEW_USER_PASSWORD
// environment variable; without it a random one is generated and shown once.
require('dotenv').config();
const crypto = require('crypto');
const { pool, query } = require('../config/database');
const { upsertUser, AuthError } = require('../services/auth');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const shopEmail = arg('shop');
  const email = arg('email');
  const fullName = arg('name');
  const role = arg('role') || 'owner';
  if (!shopEmail || !email || !fullName) {
    throw new Error('Usage: user:create -- --shop <shop email> --email <login email> --name "<full name>" [--role owner|staff]');
  }
  if (!['owner', 'staff'].includes(role)) throw new Error('--role must be owner or staff');

  const { rows } = await query('SELECT id, name FROM workshops WHERE lower(email) = lower($1)', [shopEmail]);
  if (!rows[0]) throw new Error(`No shop with email ${shopEmail}`);

  const generated = !process.env.NEW_USER_PASSWORD;
  const password = process.env.NEW_USER_PASSWORD || crypto.randomBytes(12).toString('base64url');
  const user = await upsertUser({ workshopId: rows[0].id, email, password, fullName, role });

  console.log(`✅ ${user.email} (${user.role}) can now sign in to ${rows[0].name}.`);
  if (generated) console.log(`   Password (shown once, store it safely): ${password}`);
}

main()
  .catch((error) => {
    console.error(`❌ ${error instanceof AuthError ? error.message : error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
