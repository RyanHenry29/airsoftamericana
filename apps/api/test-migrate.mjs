import { migrate } from './src/db/migrate.js';
import { getDb } from './src/db/index.js';

async function test() {
  console.log('Getting DB...');
  const db = await getDb();
  console.log('Running migrate...');
  await migrate(db);
  console.log('Migration completed successfully!');
  await db.close();
}

test().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});