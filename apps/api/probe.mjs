import { getDb, closeDb } from "./src/db/index.js";
const db = await getDb();
const idx = await db.execute("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'related_products'");
console.log(idx.rows);
const dup = await db.execute("SELECT product_id, related_product_id, count(*)::int AS n FROM related_products GROUP BY 1,2 HAVING count(*) > 1 LIMIT 5");
console.log("duplicados:", dup.rows);
await closeDb();
