with open(r'C:\Users\Henryxin7\Downloads\airsoftamericana\apps\store\src\app\page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_hero = '''           {/* Placa industrial de especificacao */}
           <Reveal delay={3}>
             <div className="hero-plate">
               <svg className="crosshair" width="180" height="180" viewBox="0 0 180 180" fill="none" aria-hidden="true">
                 <circle cx="90" cy="90" r="88" stroke="#8BCF16" strokeWidth="1.5" opacity="0.8" />
                 <circle cx="90" cy="90" r="58" stroke="#8BCF16" strokeWidth="1.2" opacity="0.6" />
                 <circle cx="90" cy="90" r="28" stroke="#8BCF16" strokeWidth="1" opacity="0.9" />
                 <path d="M90 0v180M0 90h180" stroke="#8BCF16" strokeWidth="1.2" opacity="0.8" />
               </svg>
               <div className="plate-top">
                 <span><span className="plate-led" />LOJA FISICA · CAMPINAS SP</span>
                 <b>UM/AA-001</b>
               </div>
               <div className="plate-logo">
                 <Image
                   src="/logo.png"
                   alt="Airsoft Americana"
                   width={300}
                   height={300}
                   priority
                 />
               </div>
               <div className="plate-bottom">
                 <div>
                   <b>Origem</b>
                   <span>Americana</span>
                 </div>
                 <div>
                   <b>Entrega</b>
                   <span>Correios BR</span>
                 </div>
                 <div>
                   <b>Pagamento</b>
                   <span className="on">PIX −5%</span>
                 </div>
               </div>
             </div>
           </Reveal>'''

new_hero = '''           {/* Placa industrial de especificacao - Produto em destaque */}
           <Reveal delay={3}>
             <div className="hero-plate">
               <svg className="crosshair" width="180" height="180" viewBox="0 0 180 180" fill="none" aria-hidden="true">
                 <circle cx="90" cy="90" r="88" stroke="#8BCF16" strokeWidth="1.5" opacity="0.8" />
                 <circle cx="90" cy="90" r="58" stroke="#8BCF16" strokeWidth="1.2" opacity="0.6" />
                 <circle cx="90" cy="90" r="28" stroke="#8BCF16" strokeWidth="1" opacity="0.9" />
                 <path d="M90 0v180M0 90h180" stroke="#8BCF16" strokeWidth="1.2" opacity="0.8" />
               </svg>
               <div className="plate-top">
                 <span><span className="plate-led" />PRODUTO EM DESTAQUE</span>
                 <b>UM/AA-001</b>
               </div>
               <div className="plate-product">
                 <div className="product-showcase-img">
                   <span className="product-initials">AA</span>
                 </div>
                 <p className="product-showcase-name">Rifle de Precisao G&G CM16</p>
                 <p className="product-showcase-price">R$ 1.299,00</p>
                 <p className="product-showcase-note">PIX com 5% de desconto · 3x sem juros</p>
                 <div className="mt-4">
                   <Link href="/catalogo" className="btn-primary btn-lg">Ver produto</Link>
                 </div>
               </div>
               <div className="relative flex items-center justify-between font-mono-t text-[0.7rem] uppercase tracking-[0.14em] text-[#929890]">
                 <span>EST. Americana</span>
                 <span className="text-[var(--primary)]">TATICAL /// PREMIUM</span>
               </div>
             </div>
           </Reveal>'''

if old_hero in content:
    content = content.replace(old_hero, new_hero)
    print('Hero replaced')
else:
    print('Hero not found - trying alternative')
    # Try to find the hero-plate section
    import re
    match = re.search(r'\{/\* Placa industrial de especificacao \*/\}.*?</Reveal>', content, re.DOTALL)
    if match:
        print('Found hero section')
        content = content.replace(match.group(0), new_hero)
        print('Replaced via regex')

with open(r'C:\Users\Henryxin7\Downloads\airsoftamericana\apps\store\src\app\page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')