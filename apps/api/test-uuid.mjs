import { PGlite } from '@electric-sql/pglite';

async function test() {
  const pg = new PGlite();
  await pg.waitReady;
  
  try {
    await pg.exec('CREATE TABLE test (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text)');
    console.log('gen_random_uuid() works');
  } catch (e) {
    console.log('gen_random_uuid() failed:', e.message);
  }
  
  try {
    await pg.exec('CREATE TABLE test2 (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), name text)');
    console.log('uuid_generate_v4() works');
  } catch (e) {
    console.log('uuid_generate_v4() failed:', e.message);
  }
  
  try {
    await pg.exec('CREATE TABLE test3 (id uuid PRIMARY KEY, name text)');
    await pg.exec("INSERT INTO test3 (id, name) VALUES (gen_random_uuid(), 'test')");
    console.log('gen_random_uuid() in INSERT works');
  } catch (e) {
    console.log('gen_random_uuid() in INSERT failed:', e.message);
  }
  
  try {
    await pg.exec('CREATE TABLE test4 (id uuid PRIMARY KEY, name text)');
    await pg.exec("INSERT INTO test4 (id, name) VALUES (uuid_generate_v4(), 'test')");
    console.log('uuid_generate_v4() in INSERT works');
  } catch (e) {
    console.log('uuid_generate_v4() in INSERT failed:', e.message);
  }
  
  await pg.close();
}

test().catch(console.error);