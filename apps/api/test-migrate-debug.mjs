import { migrate } from './src/db/migrate.js';
import { getDb } from './src/db/index.js';

async function test() {
  console.log('Getting DB...');
  const db = await getDb();
  console.log('Running migrate...');
  try {
    await migrate(db);
    console.log('Migration completed successfully!');
  } catch (e) {
    console.error('Migration failed:', e);
  }
  process.exit(0);
}

test().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});