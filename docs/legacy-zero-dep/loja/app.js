import http from 'node:http';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const PUB=path.join(import.meta.dirname,'public'),MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'};
const PERM={products:['admin','estoque'],categories:['admin'],brands:['admin'],coupons:['admin','marketing'],banners:['admin','marketing'],orders:['admin','atendimento'],stock:['admin','estoque'],audit:['admin'],admins:['admin']};
const hash=(pw,salt=crypto.randomBytes(16).toString('hex'))=>salt+':'+crypto.scryptSync(pw,salt,32).toString('hex');
const check=(pw,h)=>{const[s,x]=h.split(':');return crypto.timingSafeEqual(Buffer.from(hash(pw,s).split(':')[1]),Buffer.from(x))};
const E=(st,m)=>Object.assign(new Error(m),{st});
export function createApp({dbFile='loja.db',adminEmail,adminPassword,secret=process.env.PAY_WEBHOOK_SECRET,fraudLimit=+process.env.FRAUD_LIMIT_CENTS||500000,whatsapp=process.env.WHATSAPP||''}={}){
const db=new DatabaseSync(dbFile);
db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY,parent_id INT,slug TEXT UNIQUE,name TEXT,description TEXT,pos INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS brands(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,name TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,sku TEXT UNIQUE,slug TEXT UNIQUE,name TEXT,description TEXT,specs TEXT DEFAULT '{}',images TEXT DEFAULT '[]',category_id INT,brand_id INT,price_cents INT,compare_cents INT,stock INT DEFAULT 0 CHECK(stock>=0),reserved INT DEFAULT 0 CHECK(reserved>=0),weight_g INT,featured INT DEFAULT 0,active INT DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS stock_moves(id INTEGER PRIMARY KEY,product_id INT,delta INT,kind TEXT,ref TEXT,at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS carts(token TEXT PRIMARY KEY,items TEXT DEFAULT '[]',coupon TEXT);
CREATE TABLE IF NOT EXISTS coupons(id INTEGER PRIMARY KEY,code TEXT UNIQUE,pct INT,min_cents INT DEFAULT 0,active INT DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,email TEXT,address TEXT,items TEXT,subtotal INT,discount INT,shipping INT DEFAULT 0,total INT,order_status TEXT DEFAULT 'novo',pay_status TEXT DEFAULT 'pendente',fraud_status TEXT DEFAULT 'ok',ship_status TEXT DEFAULT 'aguardando',tracking TEXT,expires_at INT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS banners(id INTEGER PRIMARY KEY,title TEXT,image TEXT,link TEXT,pos INT DEFAULT 0,active INT DEFAULT 1);
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,email TEXT UNIQUE,hash TEXT,role TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,admin TEXT,action TEXT,detail TEXT,at TEXT DEFAULT CURRENT_TIMESTAMP);`);
if(adminEmail&&adminPassword&&!db.prepare('SELECT 1 FROM admins').get())db.prepare('INSERT INTO admins(email,hash,role) VALUES(?,?,?)').run(adminEmail,hash(adminPassword),'admin');
const q1=(s,...a)=>db.prepare(s).get(...a),qa=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
const tx=f=>{db.exec('BEGIN IMMEDIATE');try{const x=f();db.exec('COMMIT');return x}catch(e){db.exec('ROLLBACK');throw e}};
const shape=p=>({...p,images:JSON.parse(p.images||'[]'),specs:JSON.parse(p.specs||'{}'),available:p.stock-p.reserved});
const PL='SELECT p.*,b.name brand,c.name category,c.slug category_slug FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1';
function price(items,coupon,strict){let sub=0;const lines=[];for(const{id,qty}of items||[]){const p=q1('SELECT * FROM products WHERE id=? AND active=1',id);if(!p)continue;const av=p.stock-p.reserved;let n=Math.max(parseInt(qty)||0,0);if(strict&&n>av)throw E(409,`Estoque insuficiente: ${p.name}`);n=Math.min(n,av);if(n<1)continue;lines.push({id:p.id,name:p.name,slug:p.slug,qty:n,unit:p.price_cents});sub+=n*p.price_cents}
const c=coupon&&q1('SELECT * FROM coupons WHERE code=? AND active=1',String(coupon).toUpperCase());const discount=c&&sub>=c.min_cents?Math.floor(sub*c.pct/100):0;return{lines,subtotal:sub,discount,total:sub-discount,coupon:discount?c.code:null}}
function release(o,kind='liberacao'){for(const l of JSON.parse(o.items)){run('UPDATE products SET reserved=reserved-? WHERE id=?',l.qty,l.id);run('INSERT INTO stock_moves(product_id,delta,kind,ref) VALUES(?,?,?,?)',l.id,-l.qty,kind,'pedido:'+o.id)}}
function sweep(){tx(()=>{for(const o of qa("SELECT * FROM orders WHERE order_status='novo' AND pay_status='pendente' AND expires_at<?",Date.now())){release(o,'expiracao');run("UPDATE orders SET order_status='cancelado' WHERE id=?",o.id)}})}
setInterval(()=>{try{sweep()}catch{}},60000).unref();
function checkout(b){sweep();if(!/^\S+@\S+\.\S+$/.test(b.email||'')||!b.address)throw E(400,'E-mail e endereço são obrigatórios');
let items=b.items,coupon=b.coupon;if(!items){const c=q1('SELECT * FROM carts WHERE token=?',b.token||'');items=c?JSON.parse(c.items):[];coupon=coupon||c?.coupon}
return tx(()=>{const pr=price(items,coupon,true);if(!pr.lines.length)throw E(400,'Carrinho vazio');
for(const l of pr.lines){if(run('UPDATE products SET reserved=reserved+? WHERE id=? AND stock-reserved>=?',l.qty,l.id,l.qty).changes!==1)throw E(409,`Estoque insuficiente: ${l.name}`)}
const o=run('INSERT INTO orders(email,address,items,subtotal,discount,total,fraud_status,expires_at) VALUES(?,?,?,?,?,?,?,?)',b.email,b.address,JSON.stringify(pr.lines),pr.subtotal,pr.discount,pr.total,pr.total>fraudLimit?'revisar':'ok',Date.now()+30*60000);
for(const l of pr.lines)run('INSERT INTO stock_moves(product_id,delta,kind,ref) VALUES(?,?,?,?)',l.id,l.qty,'reserva','pedido:'+o.lastInsertRowid);
if(b.token)run('DELETE FROM carts WHERE token=?',b.token);return{order_id:Number(o.lastInsertRowid),total:pr.total,pay_status:'pendente',payment:'gateway não configurado: pagamento só é confirmado via webhook assinado'}})}
function webhook(raw,sig){if(!secret)throw E(503,'PAY_WEBHOOK_SECRET não configurado');const exp=crypto.createHmac('sha256',secret).update(raw).digest('hex');
if(!sig||sig.length!==exp.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(exp)))throw E(401,'Assinatura inválida');const e=JSON.parse(raw);
return tx(()=>{if(q1('SELECT 1 FROM webhook_events WHERE id=?',e.event_id))return{duplicate:true};run('INSERT INTO webhook_events(id) VALUES(?)',e.event_id);
const o=q1('SELECT * FROM orders WHERE id=?',e.order_id);if(!o)throw E(404,'Pedido não encontrado');
if(e.status==='paid'&&o.pay_status==='pendente'){if(o.order_status==='cancelado'){run("UPDATE orders SET pay_status='pago',order_status='revisao-manual',fraud_status='revisar' WHERE id=?",o.id)}else{for(const l of JSON.parse(o.items)){run('UPDATE products SET stock=stock-?,reserved=reserved-? WHERE id=?',l.qty,l.qty,l.id);run('INSERT INTO stock_moves(product_id,delta,kind,ref) VALUES(?,?,?,?)',l.id,-l.qty,'venda','pedido:'+o.id)}run("UPDATE orders SET pay_status='pago',order_status='pago' WHERE id=?",o.id)}}
else if(e.status==='failed'&&o.pay_status==='pendente'){if(o.order_status==='novo')release(o);run("UPDATE orders SET pay_status='falhou',order_status='cancelado' WHERE id=?",o.id)}
return{ok:true}})}
const sess=new Map();const audit=(a,act,d)=>run('INSERT INTO audit(admin,action,detail) VALUES(?,?,?)',a.email,act,JSON.stringify(d));
const cols=t=>{const all=qa(`PRAGMA table_info(${t})`).map(c=>c.name);if(t==='orders')return['order_status','fraud_status','ship_status','tracking'];if(t==='products')return all.filter(c=>!['id','reserved','created_at','stock'].includes(c));if(t==='admins')return['email','hash','role'];return all.filter(c=>c!=='id')};
function home(){const L=o=>qa(PL+' '+o).map(shape);const tree=qa('SELECT * FROM categories ORDER BY pos,name');
return{config:{whatsapp},banners:qa('SELECT * FROM banners WHERE active=1 ORDER BY pos'),categories:tree.filter(c=>!c.parent_id).map(c=>({...c,children:tree.filter(x=>x.parent_id===c.id)})),brands:qa('SELECT * FROM brands ORDER BY name'),
novidades:L('ORDER BY p.created_at DESC,p.id DESC LIMIT 8'),destaques:L('AND p.featured=1 LIMIT 8'),promocoes:L('AND p.compare_cents>p.price_cents LIMIT 8'),
maisVendidos:qa(PL+' AND p.id IN (SELECT product_id FROM stock_moves WHERE kind=\'venda\' GROUP BY product_id ORDER BY SUM(-delta) DESC LIMIT 8)').map(shape)}}
function list(u){const g=k=>u.searchParams.get(k),w=[],a=[];if(g('q')){w.push('(p.name LIKE ? OR p.sku LIKE ? OR b.name LIKE ?)');a.push(...Array(3).fill('%'+g('q')+'%'))}
if(g('category')){w.push('(c.slug=? OR c.parent_id=(SELECT id FROM categories WHERE slug=?))');a.push(g('category'),g('category'))}if(g('brand')){w.push('b.slug=?');a.push(g('brand'))}if(g('available')==='1')w.push('p.stock>p.reserved');if(g('compare'))w.push('p.compare_cents>p.price_cents');
const ord={new:'p.created_at DESC,p.id DESC',price_asc:'p.price_cents ASC',price_desc:'p.price_cents DESC',name:'p.name'}[g('sort')]||'p.created_at DESC,p.id DESC',pg=Math.max(+g('page')||1,1),per=24,W=w.length?' AND '+w.join(' AND '):'';
const total=q1(`SELECT COUNT(*) n FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1${W}`,...a).n;
return{items:qa(`${PL}${W} ORDER BY ${ord} LIMIT ${per} OFFSET ${(pg-1)*per}`,...a).map(shape),total,page:pg,pages:Math.max(Math.ceil(total/per),1)}}
async function admin(m,p,b,a){const[,,,t,id]=p.split('/');if(!PERM[t])throw E(404,'Recurso inexistente');if(!PERM[t].includes(a.role))throw E(403,'Sem permissão');
if(t==='stock'&&m==='POST'){const d=parseInt(b.delta);if(!d||!b.product_id)throw E(400,'delta e product_id obrigatórios');return tx(()=>{if(run('UPDATE products SET stock=stock+? WHERE id=? AND stock+?>=reserved',d,b.product_id,d).changes!==1)throw E(409,'Ajuste inválido (estoque ficaria abaixo do reservado)');run('INSERT INTO stock_moves(product_id,delta,kind,ref) VALUES(?,?,?,?)',b.product_id,d,'ajuste',a.email);audit(a,'stock.adjust',b);return{ok:true}})}
if(t==='stock')return qa('SELECT * FROM stock_moves ORDER BY id DESC LIMIT 200');
if(m==='GET')return t==='admins'?qa('SELECT id,email,role FROM admins'):qa(`SELECT * FROM ${t} ORDER BY id DESC LIMIT 500`);
if(t==='audit'||(t==='orders'&&m!=='PUT'))throw E(405,'Operação não permitida');
if(t==='admins'&&b.password){b.hash=hash(b.password)}const ok=cols(t).filter(c=>c in b);
if(m==='POST'){const r=run(`INSERT INTO ${t}(${ok.join(',')}) VALUES(${ok.map(()=>'?').join(',')})`,...ok.map(c=>b[c]));audit(a,t+'.create',{id:r.lastInsertRowid,...b,hash:undefined});return{id:Number(r.lastInsertRowid)}}
if(m==='PUT'){run(`UPDATE ${t} SET ${ok.map(c=>c+'=?').join(',')} WHERE id=?`,...ok.map(c=>b[c]),id);audit(a,t+'.update',{id,...b,hash:undefined});return{ok:true}}
if(m==='DELETE'&&['banners','coupons'].includes(t)){run(`DELETE FROM ${t} WHERE id=?`,id);audit(a,t+'.delete',{id});return{ok:true}}throw E(405,'Operação não permitida')}
const server=http.createServer(async(q,r)=>{const J=(c,o)=>{r.writeHead(c,{'content-type':'application/json'});r.end(JSON.stringify(o))};
try{const u=new URL(q.url,'http://x'),p=u.pathname,m=q.method;
if(!p.startsWith('/api/')){let f=path.join(PUB,p==='/'?'index.html':p==='/admin'?'admin.html':p);if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('404')}r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});return fs.createReadStream(f).pipe(r)}
let raw='';if(m!=='GET')for await(const c of q)raw+=c;let b={};try{b=JSON.parse(raw||'{}')}catch{}
if(p==='/api/home')return J(200,home());if(p==='/api/products')return J(200,list(u));
if(p.startsWith('/api/products/')){const x=q1(PL+' AND p.slug=?',decodeURIComponent(p.slice(14)));return x?J(200,shape(x)):J(404,{error:'Produto não encontrado'})}
if(p==='/api/shipping')return J(501,{error:'Cálculo de frete depende de contrato/credenciais (Correios/JadLog) ainda não configurados'});
if(p.startsWith('/api/cart/')){const t=p.slice(10);if(m==='PUT')run('INSERT INTO carts(token,items,coupon) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET items=excluded.items,coupon=excluded.coupon',t,JSON.stringify(b.items||[]),b.coupon||null);const c=q1('SELECT * FROM carts WHERE token=?',t);return J(200,{items:c?JSON.parse(c.items):[],...price(c?JSON.parse(c.items):[],c?.coupon)})}
if(p==='/api/checkout'&&m==='POST')return J(201,checkout(b));
if(p==='/api/webhooks/payment'&&m==='POST')return J(200,webhook(raw,q.headers['x-signature']));
if(p==='/api/admin/login'&&m==='POST'){const a=q1('SELECT * FROM admins WHERE email=?',b.email||'');if(!a||!check(b.password||'',a.hash))throw E(401,'Credenciais inválidas');const t=crypto.randomUUID();sess.set(t,{email:a.email,role:a.role,at:Date.now()});return J(200,{token:t,role:a.role})}
if(p.startsWith('/api/admin/')){const s=sess.get((q.headers.authorization||'').slice(7));if(!s||Date.now()-s.at>8*3600e3)throw E(401,'Não autenticado');return J(200,await admin(m,p,b,s))}
J(404,{error:'Rota inexistente'})}catch(e){J(e.st||500,{error:e.st?e.message:'Erro interno'});if(!e.st)console.error(e)}});
return{server,db,hash,sweep}}
