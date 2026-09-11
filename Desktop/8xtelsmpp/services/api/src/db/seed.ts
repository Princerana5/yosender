import bcrypt from 'bcryptjs';
import { getPool } from '@8xtel/core';

// Bootstrap: roles, super-admin, demo countries, route groups. Idempotent.
async function main(): Promise<void> {
  const pool = getPool();

  const roles: Array<[string, string]> = [
    ['super_admin', 'Everything'],
    ['admin', 'Most management functions'],
    ['operations', 'Traffic, routes, connections and logs'],
    ['finance', 'Billing, rates and reports'],
    ['support', 'Clients, tickets and logs'],
    ['read_only', 'Dashboard and reports only'],
  ];
  for (const [name, desc] of roles) {
    await pool.query(
      'INSERT INTO roles (name, description) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING',
      [name, desc],
    );
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@8xtelsmpp.com';
  const pass = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'Admin@12345';
  const { rows: r } = await pool.query('SELECT id FROM roles WHERE name=$1', ['super_admin']);
  const hash = await bcrypt.hash(pass, 12);
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role_id)
     VALUES ($1,$2,'Super Admin',$3)
     ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
    [email.toLowerCase(), hash, r[0].id],
  );

  const countries: Array<[string, string, string]> = [
    ['India', 'IN', '91'],
    ['Turkey', 'TR', '90'],
    ['United States', 'US', '1'],
    ['United Kingdom', 'GB', '44'],
    ['United Arab Emirates', 'AE', '971'],
    ['Saudi Arabia', 'SA', '966'],
  ];
  for (const [name, iso, cc] of countries) {
    await pool.query(
      'INSERT INTO countries (name, iso_code, calling_code) VALUES ($1,$2,$3) ON CONFLICT (iso_code) DO NOTHING',
      [name, iso, cc],
    );
  }

  for (const g of ['India Premium Route', 'India Economy Route', 'Turkey Premium Route', 'International Route']) {
    await pool.query('INSERT INTO route_groups (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [g]);
  }

  console.log(`seed complete — admin: ${email}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
