Set-Location C:\Users\Henryxin7\Downloads\airsoftamericana\apps\api
$env:PGLITE_DIR="data-e2e"
$env:API_PORT="4000"
$env:API_HOST="127.0.0.1"
$env:NODE_ENV="test"
$env:LOG_LEVEL="debug"
npx tsx src/cli.ts 2>&1