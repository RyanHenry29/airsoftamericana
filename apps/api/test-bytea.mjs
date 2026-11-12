import { PGlite } from '@electric-sql/pglite';

async function test() {
  const pg = new PGlite();
  await pg.waitReady;
  
  try {
    await pg.exec('CREATE TABLE test_bytea (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data bytea)');
    console.log('bytea column works');
  } catch (e) {
    console.log('bytea column failed:', e.message);
  }
  
  try {
    await pg.exec('CREATE TABLE test_blob (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data blob)');
    console.log('blob column works');
  } catch (e) {
    console.log('blob column failed:', e.message);
  }
  
  try {
    await pg.exec('CREATE TABLE test_bytea_insert (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data bytea)');
    await pg.exec("INSERT INTO test_bytea_insert (data) VALUES (decode('deadbeef', 'hex'))");
    console.log('bytea INSERT works');
  } catch (e) {
    console.log('bytea INSERT failed:', e.message);
  }
  
  try {
    await pg.exec('CREATE TABLE test_enum (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text CHECK (status IN (\'a\', \'b\', \'c\')))');
    console.log('CHECK constraint as enum alternative works');
  } catch (e) {
    console.log('CHECK constraint failed:', e.message);
  }
  
  try {
    await pg.exec('CREATE TABLE test_do (id uuid PRIMARY KEY DEFAULT gen_random_uuid())');
    await pg.exec(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'test_type') THEN CREATE TYPE "test_type" AS ENUM ('a', 'b', 'c'); END IF; END $$;`);
    console.log('DO $$ CREATE TYPE works');
  } catch (e) {
    console.log('DO $$ CREATE TYPE failed:', e.message);
  }
  
  await pg.close();
}

test().catch(console.error);