import re

with open(r'C:\Users\Henryxin7\Downloads\airsoftamericana\apps\store\src\app\page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix CTAs - differentiate them
old_cta = '''                  <div className="mt-10 flex flex-wrap gap-3">
                    <Link href="/catalogo" className="btn-primary btn-lg">
                      Explorar catalogo
                    </Link>
                    <Link href="/catalogo" className="btn-secondary btn-lg">
                      Conhecer equipamentos
                    </Link>
                  </div>'''

new_cta = '''                  <div className="mt-10 flex flex-wrap gap-3">
                    <Link href="/catalogo" className="btn-primary btn-lg">
                      Ver Lancamentos
                    </Link>
                    <Link href="/catalogo?categoria=Loadout" className="btn-secondary btn-lg">
                      Montar meu loadout
                    </Link>
                  </div>'''

content = content.replace(old_cta, new_cta)

# 2. Fix ticker - remove duplicate items
old_ticker = '''      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span key={i}>· {item}</span>
          ))}
        </div>
      </div>'''

new_ticker = '''      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {TICKER_ITEMS.map((item, i) => (
            <span key={i}>· {item}</span>
          ))}
        </div>
      </div>'''

content = content.replace(old_ticker, new_ticker)

# 3. Fix WhatsApp button position
old_wpp = '''      <a
        className="wpp-float"
        href="https://wa.me/5519999999999?text=Oi!%20Vim%20pelo%20site%20da%20Airsoft%20Americana"
        target="_blank"
        rel="noreferrer"
      >
        Chamar no zap
      </a>'''

new_wpp = '''      <a
        className="wpp-float"
        href="https://wa.me/5519999999999?text=Oi!%20Vim%20pelo%20site%20da%20Airsoft%20Americana"
        target="_blank"
        rel="noreferrer"
        style={{ bottom: '3rem' }}
      >
        WhatsApp
      </a>'''

content = content.replace(old_wpp, new_wpp)

with open(r'C:\Users\Henryxin7\Downloads\airsoftamericana\apps\store\src\app\page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')