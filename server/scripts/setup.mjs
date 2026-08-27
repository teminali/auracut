/*
 * One command to stand the store up on Cloudflare.
 *
 *     npx wrangler login          # once, needs a browser — only you can do this
 *     cp .secrets/production.env.example .secrets/production.env
 *     # fill it in, then:
 *     npm run setup
 *
 * Idempotent. Re-running it after a failed step picks up where it left
 * off: the D1 database and R2 bucket are created only if absent, the
 * schema is `CREATE TABLE IF NOT EXISTS` throughout, and secrets are
 * overwritten with whatever the env file currently says.
 *
 * Secrets are read from a 0600 file and piped straight into
 * `wrangler secret put` — never passed as an argument, because argv is
 * visible to every process on the machine via `ps`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

const ENV_FILE = '.secrets/production.env';
const KEY_FILE = '.secrets/licence-signing.jwk';

const say = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const die = (m) => { console.error(`\n\x1b[31m✘ ${m}\x1b[0m\n`); process.exit(1); };

const wrangler = (args, opts = {}) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

/* ── 0. Logged in? ─────────────────────────────────────────────── */
say('Cloudflare account');
try {
  const who = wrangler(['whoami']);
  const email = who.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  ok(`logged in${email ? ` as ${email}` : ''}`);
} catch {
  die('Not logged in to Cloudflare.\n  Run:  npx wrangler login\n'
    + '  That opens a browser and is the one step this script cannot do for you.');
}

/* ── 1. Secrets file ───────────────────────────────────────────── */
say('Secrets');
if (!existsSync(ENV_FILE)) {
  die(`${ENV_FILE} is missing.\n`
    + `  Run:  cp .secrets/production.env.example ${ENV_FILE}\n`
    + '  then fill it in. It is gitignored.');
}
const envVars = Object.fromEntries(
  readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

if (existsSync(KEY_FILE)) {
  envVars.LICENCE_SIGNING_JWK = readFileSync(KEY_FILE, 'utf8').trim();
  ok('licence signing key read from .secrets/licence-signing.jwk');
} else {
  warn('no licence signing key — run `node scripts/keygen.mjs` first');
}

/*
  Deliberately incremental. Standing this up is gated on things only a
  human with a browser can do — two OAuth apps and a payments tenant —
  and they arrive at different times. Refusing to deploy until all six
  exist would mean nothing works until everything does; instead each
  secret is uploaded as it appears, and the routes that need a missing
  one return a plain "not configured" rather than failing mid-charge.
*/
const ALL = [
  'LIPIA_PUBLIC_KEY', 'LIPIA_SECRET', 'LIPIA_WEBHOOK_SECRET',
  'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_SECRET', 'LICENCE_SIGNING_JWK',
];
const present = ALL.filter((k) => envVars[k]);
const missing = ALL.filter((k) => !envVars[k]);

if (!envVars.LICENCE_SIGNING_JWK) {
  die('LICENCE_SIGNING_JWK is missing and nothing works without it.\n'
    + '  Run:  node scripts/keygen.mjs');
}
ok(`${present.length}/${ALL.length} secrets present`);
if (missing.length) {
  warn(`not set yet: ${missing.join(', ')}`);
  warn('the routes that need them return 503 "not configured" until they are');
}

/* ── 2. D1 ─────────────────────────────────────────────────────── */
say('D1 database');
let dbId = null;
try {
  const list = JSON.parse(wrangler(['d1', 'list', '--json']));
  dbId = list.find((d) => d.name === 'kerf-store')?.uuid ?? null;
} catch { /* no databases yet */ }

if (dbId) {
  ok(`kerf-store exists (${dbId})`);
} else {
  const created = wrangler(['d1', 'create', 'kerf-store']);
  dbId = created.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1]
      ?? created.match(/database_id = "([^"]+)"/)?.[1];
  if (!dbId) die(`Created kerf-store but could not read its id back:\n${created}`);
  ok(`created kerf-store (${dbId})`);
}

const cfg = readFileSync('wrangler.jsonc', 'utf8');
if (cfg.includes('REPLACE_WITH_D1_ID')) {
  writeFileSync('wrangler.jsonc', cfg.replace('REPLACE_WITH_D1_ID', dbId));
  ok('wrangler.jsonc updated with the database id');
} else if (!cfg.includes(dbId)) {
  warn(`wrangler.jsonc names a DIFFERENT database id than ${dbId} — leaving it alone`);
}

/* ── 3. R2 ─────────────────────────────────────────────────────── */
say('R2 bucket');
try {
  const buckets = wrangler(['r2', 'bucket', 'list']);
  if (buckets.includes('kerf-skills')) ok('kerf-skills exists');
  else { wrangler(['r2', 'bucket', 'create', 'kerf-skills']); ok('created kerf-skills'); }
} catch (err) {
  // Not fatal. R2 needs a one-time dashboard toggle, and everything
  // except package download works without it.
  warn('R2 is not available on this account (enable it in the dashboard, then');
  warn('  npx wrangler r2 bucket create kerf-skills — and uncomment r2_buckets)');
}

/* ── 4. Schema ─────────────────────────────────────────────────── */
say('Schema');
wrangler(['d1', 'execute', 'kerf-store', '--remote', '--file=./schema.sql', '-y']);
ok('schema.sql applied to the remote database');

/* ── 5. Secrets in ─────────────────────────────────────────────── */
say('Uploading secrets');
for (const key of present) {
  // Piped on stdin, never argv: `ps` shows every argument to every user.
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', key], {
    input: envVars[key], encoding: 'utf8',
  });
  if (r.status !== 0) die(`Failed to set ${key}:\n${r.stderr}`);
  ok(key);
}

/* ── 6. Deploy ─────────────────────────────────────────────────── */
say('Deploying');
const out = wrangler(['deploy']);
const url = out.match(/https:\/\/[^\s]+workers\.dev/)?.[0];
console.log(out.split('\n').filter((l) => l.includes('http') || l.includes('Uploaded')).join('\n'));

say('Done');
if (url) {
  ok(`store is at ${url}`);
  console.log(`
Two things left, and both need a browser:

  1. Lipia — create the Kerf tenant and set its callback URL to
       ${url}/webhooks/lipia
     Its webhook secret must match LIPIA_WEBHOOK_SECRET in ${ENV_FILE}.

  2. Point Kerf at it — the default in electron/storeSession.ts, or
       KERF_STORE_URL=${url} npx electron .

Check it is alive:   curl ${url}/health
`);
} else {
  warn('deployed, but could not read the URL back from wrangler output');
}
