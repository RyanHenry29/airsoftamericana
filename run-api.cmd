@echo off
cd /d C:\Users\Henryxin7\Downloads\airsoftamericana\apps\api
set PGLITE_DIR=data-e2e
set API_PORT=4000
set API_HOST=127.0.0.1
set NODE_ENV=test
set LOG_LEVEL=debug
npx tsx src/cli.ts