import {createApp} from './app.js';
const {server}=createApp({adminEmail:process.env.ADMIN_EMAIL,adminPassword:process.env.ADMIN_PASSWORD,dbFile:process.env.DB_FILE||'loja.db'});
server.listen(process.env.PORT||3000,()=>console.log('Loja em http://localhost:'+(process.env.PORT||3000)));
