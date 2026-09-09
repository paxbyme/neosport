// Applies supabase-schema.sql to the database behind POSTGRES_URL_NON_POOLING.
// The pooled URL cannot run DDL reliably, so the direct connection is used.
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

for (const filename of [".env.local", ".env"]) {
  if (!existsSync(filename)) continue;
  for (const line of readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    // `vercel env pull` writes this for production secrets it may not reveal;
    // treating it as a value would hide the real one in a later file.
    if (value === "[SENSITIVE]") continue;
    process.env[match[1]] = value;
  }
}

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("POSTGRES_URL_NON_POOLING topilmadi. Avval `vercel env pull .env.local` bajaring.");
  process.exit(1);
}

// node-postgres reads sslmode from the URL and then ignores the client-level
// ssl option, so the parameter is stripped and TLS configured explicitly.
// Supabase's pooler presents a chain Node does not ship a root for.
const client = new pg.Client({
  connectionString: connectionString.replace(/[?&]sslmode=[^&]*/g, ""),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const schema = readFileSync("supabase-schema.sql", "utf8");
// Read out of the schema rather than listed here: a hardcoded list silently
// stops covering whatever is added to the file next, and then the migration
// reports success for tables it never checked.
const expected = [...schema.matchAll(/create table if not exists public\.(\w+)/g)].map((match) => match[1]).sort();

try {
  // The schema is written to be re-runnable, so one transaction is safe.
  await client.query("begin");
  await client.query(schema);
  await client.query("commit");
  console.log("Sxema qo‘llandi.");

  const { rows } = await client.query(`
    select table_name, (select count(*) from information_schema.columns c
       where c.table_schema = t.table_schema and c.table_name = t.table_name) as columns
    from information_schema.tables t
    where table_schema = 'public' and table_name = any($1)
    order by table_name`, [expected]);
  for (const row of rows) console.log(`  ${row.table_name}: ${row.columns} ta ustun`);

  // Every table the schema defines has to be there afterwards, or the panel
  // finds out at runtime with a PGRST205 instead of here.
  const missing = expected.filter((table) => !rows.some((row) => row.table_name === table));
  if (missing.length) {
    console.error(`\nJadval yaratilmadi: ${missing.join(", ")}`);
    process.exitCode = 1;
  }
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error("Migratsiya bajarilmadi:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
