const $=s=>document.querySelector(s),api=(u,o)=>fetch('/api'+u,{headers:{'content-type':'application/json'},...o,body:o?.body&&JSON.stringify(o.body)}).then(async r=>({ok:r.ok,j:await r.json()}));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),R=c=>'R$ '+(c/100).toLocaleString('pt-BR',{minimumFractionDigits:2});
const tok=localStorage.cart||(localStorage.cart=crypto.randomUUID());let H;
const card=p=>`<a class="card" href="#/p/${esc(p.slug)}"><div class="im">${p.images[0]?`<img loading="lazy" src="${esc(p.images[0])}" alt="${esc(p.name)}">`:'Sem foto'}${p.compare_cents>p.price_cents?`<span class="bd">-${Math.round(100-p.price_cents/p.compare_cents*100)}%</span>`:''}${p.available<1?'<span class="bd x">Esgotado</span>':''}</div><div class="t"><small>${esc(p.brand||'')}</small><div>${esc(p.name)}</div><div>${p.compare_cents>p.price_cents?`<span class="old">${R(p.compare_cents)}</span>`:''}<span class="pr">${R(p.price_cents)}</span></div></div></a>`;
const sec=(t,l,more)=>l.length?`<h2>${t}${more?` <a class="ok" style="font-size:13px" href="${more}">ver tudo</a>`:''}</h2><div class="grid">${l.map(card).join('')}</div>`:'';
async function cart(){const{j}=await api('/cart/'+tok);$('#cb').textContent='Carrinho ('+j.items.reduce((a,i)=>a+i.qty,0)+')';return j}
async function put(items,coupon){await api('/cart/'+tok,{method:'PUT',body:{items,coupon}});return cart()}
async function add(id){const c=await cart();const it=c.items.find(i=>i.id===id);it?it.qty++:c.items.push({id,qty:1});await put(c.items,c.coupon);location.hash='#/carrinho'}
async function boot(){const{j}=await api('/home');H=j;$('#mm').innerHTML=j.categories.map(c=>`<div class="nav"><a href="#/c/${esc(c.slug)}">${esc(c.name)}</a>${c.children.length||c.description?`<div class="drop">${c.description?`<small>${esc(c.description)}</small>`:''}${c.children.map(x=>`<a href="#/c/${esc(x.slug)}">${esc(x.name)}</a>`).join('')}</div>`:''}</div>`).join('')+'<div class="nav"><a href="#/c/promocoes">Promoções</a></div>';
if(j.config.whatsapp)$('#wa').innerHTML=`<a class="wa" href="https://wa.me/${esc(j.config.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>`;cart();route()}
function home(){let i=0;const b=H.banners;setTimeout(()=>{const a=[...document.querySelectorAll('.ban a')];if(a.length>1)window.bt=setInterval(()=>{a[i].classList.remove('on');i=(i+1)%a.length;a[i].classList.add('on')},5000)});
return `${b.length?`<div class="ban">${b.map((x,k)=>`<a class="${k?'':'on'}" href="${esc(x.link||'#/')}"><img src="${esc(x.image)}" alt=""><b>${esc(x.title)}</b></a>`).join('')}</div>`:'<div style="height:24px"></div>'}
<div class="ben"><div><b>Troca em 7 dias</b>Direito de arrependimento</div><div><b>Loja física</b>Campinas, SP</div><div><b>Entrega nacional</b>Frete calculado por CEP</div><div><b>Compra segura</b>Preço e estoque validados</div></div>
${H.categories.length?`<h2>Departamentos</h2><div class="cats">${H.categories.map(c=>`<a href="#/c/${esc(c.slug)}">${esc(c.name)}</a>`).join('')}</div>`:''}
${sec('Novidades',H.novidades,'#/lista')}${sec('Destaques',H.destaques)}${sec('Mais vendidos',H.maisVendidos)}${sec('Promoções',H.promocoes,'#/c/promocoes')}
${H.brands.length?`<h2>Marcas</h2><div class="brands">${H.brands.map(x=>`<a href="#/lista?brand=${esc(x.slug)}">${esc(x.name)}</a>`).join('')}</div>`:''}
${!H.novidades.length?'<div class="empty">O catálogo ainda está vazio. Cadastre produtos em <a class="ok" href="/admin">/admin</a>.</div>':''}`}
async function lista(qs,title){const p=new URLSearchParams(qs);const{j}=await api('/products?'+p);const nav=(k,v)=>{const n=new URLSearchParams(p);n.set(k,v);if(k!=='page')n.delete('page');return location.hash.split('?')[0]+'?'+n};
return `<h2>${esc(title)} <small>(${j.total})</small></h2><div style="display:flex;gap:12px;margin-bottom:16px"><select onchange="location.hash='${nav('sort','')}'.replace('sort=','sort='+this.value)" style="width:auto"><option value="new">Mais recentes</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option><option value="name">Nome</option></select><label><input type="checkbox" style="width:auto" ${p.get('available')?'checked':''} onchange="location.hash='${nav('available','1')}'.replace('available=1','available='+(this.checked?1:0))"> Só disponíveis</label></div>
${j.items.length?`<div class="grid">${j.items.map(card).join('')}</div><p style="margin-top:24px">${Array.from({length:j.pages},(_,i)=>`<a class="btn ${j.page===i+1?'':'o'}" href="${nav('page',i+1)}">${i+1}</a> `).join('')}</p>`:'<div class="empty">Nenhum produto encontrado.</div>'}`}
async function prod(slug){const{ok,j:p}=await api('/products/'+slug);if(!ok)return '<div class="empty">Produto não encontrado.</div>';
return `<div class="pd"><div class="card"><div class="im" style="aspect-ratio:1">${p.images[0]?`<img src="${esc(p.images[0])}" alt="${esc(p.name)}">`:'Sem foto'}</div></div><div><small>${esc(p.brand||'')} · SKU ${esc(p.sku)}</small><h1 style="font-size:30px;margin:8px 0">${esc(p.name)}</h1>${p.compare_cents>p.price_cents?`<span class="old">${R(p.compare_cents)}</span>`:''}<div class="pr" style="font-size:32px">${R(p.price_cents)}</div><p class="${p.available>0?'ok':'err'}" style="margin:12px 0">${p.available>0?(p.available<=3?`Últimas ${p.available} unidades`:'Em estoque'):'Esgotado'}</p><button class="btn" ${p.available<1?'disabled':''} onclick="add(${p.id})">Adicionar ao carrinho</button>
<h3 style="margin-top:24px">Frete</h3><input id="cep" placeholder="CEP" maxlength="9" style="width:160px;display:inline-block"> <button class="btn o" onclick="frete()">Calcular</button><div id="fr"></div>
<h3 style="margin-top:24px">Descrição</h3><p>${esc(p.description)}</p>${Object.keys(p.specs).length?`<h3 style="margin-top:24px">Especificações</h3><table>${Object.entries(p.specs).map(([k,v])=>`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`:''}</div></div>`}
async function frete(){const{j}=await api('/shipping');$('#fr').innerHTML=`<p class="err">${esc(j.error)}</p>`}
async function carrinho(){const c=await cart();if(!c.lines.length)return '<h2>Carrinho</h2><div class="empty">Seu carrinho está vazio.</div>';
return `<h2>Carrinho</h2><table>${c.lines.map(l=>`<tr><td><a href="#/p/${esc(l.slug)}">${esc(l.name)}</a></td><td><input type="number" min="0" value="${l.qty}" style="width:70px" onchange="qty(${l.id},this.value)"></td><td>${R(l.unit*l.qty)}</td></tr>`).join('')}</table>
<p style="margin:16px 0">Cupom: <input id="cp" value="${esc(c.coupon||'')}" style="width:160px;display:inline-block"> <button class="btn o" onclick="cupom()">Aplicar</button></p><p>Subtotal ${R(c.subtotal)} ${c.discount?`· Desconto ${R(c.discount)}`:''}</p><p class="pr" style="font-size:26px">Total ${R(c.total)}</p><a class="btn" href="#/checkout">Finalizar compra</a>`}
async function qty(id,n){const c=await cart();await put(c.lines.map(l=>({id:l.id,qty:l.id===id?+n:l.qty})),c.coupon);route()}
async function cupom(){const c=await cart();await put(c.lines.map(l=>({id:l.id,qty:l.qty})),$('#cp').value);route()}
async function checkout(){const c=await cart();if(!c.lines.length)return '<div class="empty">Carrinho vazio.</div>';
return `<h2>Finalizar compra</h2><div style="max-width:560px"><label>E-mail<input id="em" type="email"></label><label>Endereço completo de entrega<textarea id="ad" rows="3"></textarea></label><label><input type="checkbox" id="mj" style="width:auto"> Declaro ter 18 anos ou mais</label><p class="pr">Total ${R(c.total)}</p><button class="btn" onclick="fin()">Confirmar pedido</button><p id="msg"></p></div>`}
async function fin(){if(!$('#mj').checked)return $('#msg').innerHTML='<span class="err">Confirme a maioridade.</span>';const{ok,j}=await api('/checkout',{method:'POST',body:{token:tok,email:$('#em').value,address:$('#ad').value}});
$('#msg').innerHTML=ok?`<span class="ok">Pedido #${j.order_id} criado. Estoque reservado por 30 min. ${esc(j.payment)}</span>`:`<span class="err">${esc(j.error)}</span>`;if(ok)cart()}
async function route(){clearInterval(window.bt);const[h,qs]=location.hash.slice(1).split('?'),[,a,b]=h.split('/');let html;
if(!a)html=home();else if(a==='c'&&b==='promocoes')html=await lista('compare=1','Promoções');else if(a==='c')html=await lista((qs?qs+'&':'')+'category='+b,(H.categories.flatMap(c=>[c,...c.children]).find(c=>c.slug===b)||{name:b}).name);
else if(a==='lista')html=await lista(qs,'Produtos');else if(a==='q')html=await lista('q='+b,'Busca: '+decodeURIComponent(b));else if(a==='p')html=await prod(b);else if(a==='carrinho')html=await carrinho();else if(a==='checkout')html=await checkout();else html='<div class="empty">Rastreamento disponível após integração de expedição.</div>';
$('#app').innerHTML=html;scrollTo(0,0)}
$('#sf').onsubmit=e=>{e.preventDefault();location.hash='#/q/'+encodeURIComponent($('#q').value)};addEventListener('hashchange',()=>H&&route());boot();

/* ===== Camada de interação e animações ===== */
(()=>{
const $$=s=>document.querySelectorAll(s),hd=document.querySelector('header'),mm=document.querySelector('nav.mm');
const up=Object.assign(document.createElement('button'),{className:'up',textContent:'↑',ariaLabel:'Voltar ao topo',onclick:()=>scrollTo({top:0,behavior:'smooth'})});
const T=Object.assign(document.createElement('div'),{className:'toast'});T.setAttribute('role','status');
const D=document.createElement('aside');D.className='dr';D.innerHTML='<div class="dh"><b>Seu carrinho</b><button aria-label="Fechar">×</button></div><div class="db"></div><div class="df"></div>';
const O=Object.assign(document.createElement('div'),{className:'ov'});document.body.append(up,T,O,D);
addEventListener('scroll',()=>{hd.classList.toggle('sm',scrollY>40);up.classList.toggle('show',scrollY>600)},{passive:true});
// Topbar: mensagens rotativas
const tp=document.querySelector('.top .w span'),msgs=['Entrega para todo o Brasil','Troca em até 7 dias corridos','Loja física em Campinas, SP'];let mi=0;
setInterval(()=>{tp.classList.add('out');setTimeout(()=>{mi=(mi+1)%msgs.length;tp.textContent=msgs[mi];tp.classList.remove('out')},350)},4000);
// Menu mobile + mega menu com "hover intent"
const hb=Object.assign(document.createElement('button'),{className:'hb',textContent:'☰',ariaLabel:'Abrir menu'});hd.querySelector('.w').prepend(hb);
const menu=o=>{mm.classList.toggle('open',o);document.body.classList.toggle('dopen',o)};hb.onclick=()=>menu(!mm.classList.contains('open'));
let ht;mm.addEventListener('mouseover',e=>{const n=e.target.closest('.nav');if(!n||matchMedia('(max-width:800px)').matches)return;clearTimeout(ht);ht=setTimeout(()=>{$$('.nav.open').forEach(x=>x!==n&&x.classList.remove('open'));n.classList.add('open')},110)});
mm.addEventListener('mouseleave',()=>{clearTimeout(ht);ht=setTimeout(()=>$$('.nav.open').forEach(x=>x.classList.remove('open')),220)});
mm.addEventListener('click',e=>{const a=e.target.closest('.nav>a'),n=a?.parentElement;if(matchMedia('(max-width:800px)').matches&&n?.querySelector('.drop')&&!n.classList.contains('open')){e.preventDefault();n.classList.add('open')}else if(e.target.closest('a'))menu(false)});
// Carrinho lateral + aviso "Adicionado ao carrinho!"
const toast=m=>{T.textContent=m;T.classList.add('on');clearTimeout(T.t);T.t=setTimeout(()=>T.classList.remove('on'),2600)};
async function drawer(open){const c=await cart();D.querySelector('.db').innerHTML=c.lines.length?c.lines.map(l=>`<div class="dl"><a href="#/p/${esc(l.slug)}">${esc(l.name)}</a><span>${l.qty} × ${R(l.unit)}</span></div>`).join(''):'<div class="empty">Carrinho vazio.</div>';D.querySelector('.df').innerHTML=c.lines.length?`<p style="margin-bottom:12px">Subtotal ${R(c.subtotal)}</p><a class="btn" href="#/checkout">Finalizar compra</a> <a class="btn o" href="#/carrinho">Ver carrinho</a>`:'';document.body.classList.toggle('dopen',open)}
document.getElementById('cb').addEventListener('click',e=>{e.preventDefault();drawer(true)});
O.onclick=()=>{menu(false);document.body.classList.remove('dopen')};D.querySelector('.dh button').onclick=O.onclick;D.addEventListener('click',e=>e.target.closest('a')&&O.onclick());
addEventListener('keydown',e=>e.key==='Escape'&&O.onclick());
window.add=async id=>{const c=await cart();const it=c.items.find(i=>i.id===id);it?it.qty++:c.items.push({id,qty:1});await put(c.items,c.coupon);const b=document.getElementById('cb');b.classList.remove('bump');void b.offsetWidth;b.classList.add('bump');toast('Adicionado ao carrinho!');drawer(true)};
// Carrossel de banners: setas, bolinhas, progresso, pausa no hover e swipe
function car(){const b=document.querySelector('.ban');if(!b||b.dataset.i)return;b.dataset.i=1;clearInterval(window.bt);const s=[...b.querySelectorAll('a')];if(s.length<2)return;let i=0,t,x0=0;
const bar=document.createElement('i');bar.className='bar';const dots=document.createElement('div');dots.className='dots';
s.forEach((_,k)=>{const d=document.createElement('button');d.ariaLabel='Slide '+(k+1);d.onclick=()=>{go(k);play()};dots.append(d)});dots.children[0].classList.add('on');
const ar=(c,t,f)=>Object.assign(document.createElement('button'),{className:'ar '+c,textContent:t,ariaLabel:c=='pv'?'Anterior':'Próximo',onclick:()=>{f();play()}});
b.append(bar,dots,ar('pv','‹',()=>go(i-1)),ar('nx','›',()=>go(i+1)));
const go=k=>{s[i].classList.remove('on');dots.children[i].classList.remove('on');i=(k+s.length)%s.length;s[i].classList.add('on');dots.children[i].classList.add('on');bar.style.animation='none';void bar.offsetWidth;bar.style.animation=''};
const play=()=>{clearInterval(t);t=setInterval(()=>b.isConnected?go(i+1):clearInterval(t),5000)};play();
b.addEventListener('mouseenter',()=>clearInterval(t));b.addEventListener('mouseleave',play);
b.addEventListener('touchstart',e=>x0=e.touches[0].clientX,{passive:true});b.addEventListener('touchend',e=>{const d=e.changedTouches[0].clientX-x0;if(Math.abs(d)>40){go(d<0?i+1:i-1);play()}})}
// Revelar ao rolar + imagens com blur-up
const rv=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');rv.unobserve(e.target)}}),{rootMargin:'0px 0px -40px'});
function enhance(){car();$$('#app :is(.card,h2,.cats a,.ben div,.brands a):not(.rv)').forEach((e,i)=>{e.classList.add('rv');e.style.setProperty('--d',(i%8)*50+'ms');rv.observe(e)});
$$('#app img[loading=lazy]:not(.bu),#app .card img:not(.bu)').forEach(im=>{im.classList.add('bu');im.complete?im.classList.add('ok'):im.addEventListener('load',()=>im.classList.add('ok'),{once:true})})}
new MutationObserver(enhance).observe(document.getElementById('app'),{childList:true});enhance();
})();
