/**
 * Taxonomia da loja — extraida do menu publico do catalogo de origem
 * (departamentos, subcategorias, marcas e filtros por sistema de tiro).
 * E a base da arvore de categorias do Airsoft Americana.
 */

export type TaxonomyNode = {
  name: string;
  slug: string;
  ageRestricted?: boolean;
  children?: TaxonomyNode[];
};

/** Filtros por sistema de tiro — aparecem no topo do menu, nao sao categorias. */
export const shootingSystems = {
  airsoft: [
    { key: "aeg", label: "AEG", description: "Rifle automatico por bateria. O mais usado em campo." },
    { key: "hta", label: "HTA", description: "Rifles HTA de alta performance." },
    { key: "gbbr", label: "GBBR", description: "Gas blowback. Recuo e realismo maximo, ferrolho funcional." },
    { key: "spring", label: "Spring", description: "Acao manual a cada disparo. Ideal para recreacao." },
    { key: "aep", label: "AEP", description: "Pistola eletrica compacta, custo-beneficio." },
    { key: "sniper", label: "Sniper", description: "Bolt-action para precisao a longa distancia." },
  ],
  tiro: [
    { key: "mola", label: "Mola", description: "Acao manual a cada disparo. Robusta e simples." },
    { key: "co2", label: "CO2", description: "Cartuchos de CO2, tiro consistente e pratico." },
    { key: "pcp", label: "PCP", description: "Ar comprimido pre-carregado, alta potencia e precisao." },
    { key: "nitro", label: "Nitro", description: "Pistao a gas ram, menos vibracao que a mola." },
  ],
} as const;

export const departments: TaxonomyNode[] = [
  {
    name: "Airsoft",
    slug: "airsoft",
    ageRestricted: true,
    children: [
      {
        name: "Armas de Airsoft",
        slug: "armas-de-airsoft",
        ageRestricted: true,
        children: [
          { name: "Rifle AEG", slug: "rifles-de-airsoft", ageRestricted: true },
          { name: "Rifle GBBR", slug: "rifles-de-airsoft-gbbr", ageRestricted: true },
          { name: "Rifle HTA", slug: "rifles-de-airsoft-hta", ageRestricted: true },
          { name: "Kit Rifles Airsoft AEG", slug: "kits-rifles-airsoft-aeg", ageRestricted: true },
          { name: "Suporte", slug: "suporte" },
          { name: "Sniper de Airsoft", slug: "snipers-de-airsoft", ageRestricted: true },
          { name: "Shotgun", slug: "shotguns-de-airsoft", ageRestricted: true },
          { name: "Speed Soft", slug: "speed-soft", ageRestricted: true },
          { name: "Armas de Epoca", slug: "armas-de-epoca", ageRestricted: true },
        ],
      },
      {
        name: "Pistolas",
        slug: "pistolas-de-airsoft",
        ageRestricted: true,
        children: [
          { name: "Pistola a Gas (GBB)", slug: "pistolas-a-gas-gbb", ageRestricted: true },
          { name: "Pistola Spring", slug: "pistolas-spring", ageRestricted: true },
          { name: "Pistola Eletrica (AEP)", slug: "pistolas-eletricas-aep", ageRestricted: true },
          { name: "Revolver", slug: "revolveres-de-airsoft", ageRestricted: true },
        ],
      },
      { name: "Brinquedos e Jogos", slug: "brinquedos-e-jogos" },
      { name: "Usados", slug: "bazar-de-usados" },
      {
        name: "Comunicacao",
        slug: "comunicacao",
        children: [
          { name: "Radios", slug: "radios" },
          { name: "PTTS / Fones", slug: "ptts-e-fones" },
        ],
      },
      {
        name: "Miras e Optica",
        slug: "miras-e-optica",
        children: [
          { name: "Lunetas", slug: "lunetas" },
          { name: "Red / Green Dot", slug: "red-green-dot" },
          { name: "Alca e Massa de Mira", slug: "alca-e-massa-de-mira" },
          { name: "Protetores de Mira", slug: "protetores-de-mira" },
          { name: "Colimadores", slug: "colimadores" },
        ],
      },
      {
        name: "Acessorios para Airsoft",
        slug: "acessorios-para-airsoft",
        children: [
          { name: "Speed Loader", slug: "speed-loader" },
          { name: "Baterias e Carregadores", slug: "baterias-e-carregadores" },
          { name: "ANPEQ", slug: "anpeq" },
          { name: "Municoes e Gas", slug: "municoes-e-gas" },
          { name: "Pecas Internas Magazines", slug: "pecas-internas-magazines" },
          { name: "Trilhos e Suportes", slug: "trilhos-e-suportes" },
          { name: "Dispositivos Taticos", slug: "dispositivos-taticos" },
        ],
      },
      {
        name: "Magazines",
        slug: "magazines",
        children: [
          { name: "Low Cap", slug: "magazines-low-cap" },
          { name: "Mid Cap", slug: "magazines-mid-cap" },
          { name: "High Cap", slug: "magazines-high-cap" },
          { name: "Magazine de Sniper", slug: "magazines-de-sniper" },
          { name: "Magazine de Pistola", slug: "magazines-de-pistola" },
          { name: "Acessorios para Magazine", slug: "acessorios-para-magazines" },
        ],
      },
      {
        name: "Equipamentos Taticos",
        slug: "equipamentos-taticos",
        children: [{ name: "Cases e Capas", slug: "cases-e-capas" }],
      },
    ],
  },
  {
    name: "Tiro Esportivo",
    slug: "tiro-esportivo",
    ageRestricted: true,
    children: [
      { name: "Carabinas e Rifles de Pressao", slug: "carabinas-e-rifles-de-pressao", ageRestricted: true },
      { name: "Pistolas de Airgun", slug: "pistolas-de-airgun", ageRestricted: true },
      { name: "Pistola de Pressao Calibre .50", slug: "pistolas-calibre-50", ageRestricted: true },
      { name: "Calibre .68", slug: "calibre-68", ageRestricted: true },
      {
        name: "Municao",
        slug: "municao",
        children: [
          { name: "Municao Calibre .50", slug: "municao-calibre-50" },
          { name: "Esferas de Aco e Chumbinho", slug: "esferas-de-aco-e-chumbinho" },
        ],
      },
      {
        name: "Treino e Pratica",
        slug: "treino-e-pratica",
        children: [
          { name: "Alvos para Tiro Esportivo", slug: "alvos-tiro-esportivo" },
          { name: "Treinamento", slug: "treinamento" },
          { name: "Caixa de Municao", slug: "caixa-de-municao" },
          { name: "Abafadores", slug: "abafadores" },
        ],
      },
      {
        name: "Acessorios para Carabina de Pressao",
        slug: "acessorios-carabina-de-pressao",
        children: [
          { name: "Carregadores", slug: "carregadores" },
          { name: "Magazines de Pistola Airgun", slug: "magazines-de-pistola-airgun" },
          { name: "Porta Carregador", slug: "porta-carregador" },
          { name: "Trilhos para Tiro Esportivo", slug: "trilhos-tiro-esportivo" },
          { name: "Tratamento e Manutencao", slug: "tratamento-e-manutencao" },
          { name: "Pecas Internas de Tiro Esportivo", slug: "pecas-internas-tiro-esportivo" },
        ],
      },
      {
        name: "Optica e Visada",
        slug: "optica-e-visada",
        children: [
          { name: "Mira para Tiro Esportivo", slug: "miras-tiro-esportivo" },
          { name: "Binoculos", slug: "binoculos" },
        ],
      },
      {
        name: "Equipamentos de Defesa Pessoal",
        slug: "equipamentos-de-defesa-pessoal",
        children: [
          { name: "Defesa Pessoal", slug: "defesa-pessoal" },
          { name: "Primeiros Socorros", slug: "primeiros-socorros" },
        ],
      },
      {
        name: "Paintball",
        slug: "paintball",
        children: [{ name: "Pistolas de Paintball", slug: "pistolas-de-paintball" }],
      },
    ],
  },
  {
    name: "Upgrades",
    slug: "upgrades",
    ageRestricted: true,
    children: [
      {
        name: "Airsoft",
        slug: "upgrades-airsoft",
        ageRestricted: true,
        children: [
          { name: "Pecas Internas", slug: "pecas-internas-de-airsoft", ageRestricted: true },
          { name: "Nozzle", slug: "nozzle", ageRestricted: true },
          { name: "Gearbox", slug: "gearbox", ageRestricted: true },
          { name: "Gatilhos", slug: "gatilhos", ageRestricted: true },
          { name: "Bucking", slug: "bucking", ageRestricted: true },
          { name: "Molas", slug: "molas-de-airsoft", ageRestricted: true },
          { name: "Motores", slug: "motores", ageRestricted: true },
          { name: "Canos de Precisao", slug: "canos-de-precisao", ageRestricted: true },
          { name: "Cano Externo", slug: "cano-externo", ageRestricted: true },
          { name: "Pistol Grip", slug: "pistol-grip", ageRestricted: true },
          { name: "Stocks", slug: "stocks", ageRestricted: true },
          { name: "Hand Guards", slug: "hand-guards", ageRestricted: true },
        ],
      },
      {
        name: "Sniper",
        slug: "upgrade-sniper",
        ageRestricted: true,
        children: [
          { name: "Pecas Internas de Sniper", slug: "pecas-internas-de-sniper", ageRestricted: true },
          { name: "Molas de Sniper", slug: "molas-de-sniper", ageRestricted: true },
          { name: "Canos de Precisao para Sniper", slug: "canos-de-precisao-sniper", ageRestricted: true },
        ],
      },
      {
        name: "Pistola",
        slug: "upgrade-pistola",
        ageRestricted: true,
        children: [
          { name: "Pecas Internas de Pistola", slug: "pecas-internas-de-pistola", ageRestricted: true },
          { name: "Canos de Precisao e Cano Externo", slug: "canos-de-precisao-pistola", ageRestricted: true },
          { name: "Empunhaduras", slug: "empunhaduras", ageRestricted: true },
        ],
      },
      { name: "Manutencao", slug: "manutencao" },
      { name: "Pinturas em Rifles", slug: "pinturas-em-rifles" },
    ],
  },
  {
    name: "Loadout",
    slug: "loadout",
    children: [
      {
        name: "Vestuario",
        slug: "vestuario",
        children: [
          { name: "Fardamento Completo", slug: "fardamento-completo" },
          { name: "Combat Shirts e Gandolas", slug: "combat-shirts-e-gandolas" },
          { name: "Calcas Taticas", slug: "calcas-taticas" },
          { name: "Calcas Femininas", slug: "calcas-femininas" },
          { name: "Cintos", slug: "cintos" },
          { name: "Coturnos", slug: "coturnos" },
          { name: "Balaclavas e Bandanas", slug: "balaclavas-e-bandanas" },
          { name: "Chapeus e Gorros", slug: "chapeus-e-gorros" },
          { name: "Shemags e Lencos", slug: "shemags-e-lencos" },
        ],
      },
      {
        name: "Protecao",
        slug: "protecao",
        children: [
          { name: "Capacetes", slug: "capacetes" },
          { name: "Mascaras", slug: "mascaras" },
          { name: "Oculos e Lentes", slug: "oculos-e-lentes" },
          { name: "Luvas Taticas", slug: "luvas-taticas" },
          { name: "Joelheira e Cotoveleira", slug: "joelheira-e-cotoveleira" },
          { name: "Coletes", slug: "coletes" },
        ],
      },
      { name: "Bandoleiras", slug: "bandoleiras" },
      {
        name: "Coldres",
        slug: "coldres",
        children: [{ name: "Acessorios para Coldres", slug: "acessorios-para-coldres" }],
      },
      {
        name: "Bolsos",
        slug: "bolsos",
        children: [
          { name: "Bolso Medico", slug: "bolso-medico" },
          { name: "Bolso de Perna", slug: "bolso-de-perna" },
          { name: "Bolso Horizontal", slug: "bolso-horizontal" },
          { name: "Bolso Vertical", slug: "bolso-vertical" },
          { name: "Porta Acessorios", slug: "porta-acessorios" },
          { name: "Porta Magazine", slug: "porta-magazine" },
        ],
      },
      {
        name: "Hidratacao",
        slug: "hidratacao",
        children: [
          { name: "Camelback e Cantis", slug: "camelback-e-cantis" },
          { name: "Porta Camelback", slug: "porta-camelback" },
        ],
      },
      {
        name: "Patches",
        slug: "patches",
        children: [
          { name: "Animados", slug: "patches-animados" },
          { name: "Sanguineos", slug: "patches-sanguineos" },
          { name: "Militares", slug: "patches-militares" },
          { name: "Bandeiras", slug: "patches-bandeiras" },
          { name: "Adesivos Taticos", slug: "adesivos-taticos" },
        ],
      },
      { name: "Itens de Camuflagem", slug: "itens-de-camuflagem" },
      { name: "Feminino", slug: "feminino" },
    ],
  },
  {
    name: "Life Style",
    slug: "life-style",
    children: [
      { name: "Camisas", slug: "camisas", children: [{ name: "Camisa Polo", slug: "camisa-polo" }] },
      {
        name: "Camisetas",
        slug: "camisetas",
        children: [{ name: "Camisetas Femininas", slug: "camisetas-femininas" }],
      },
      { name: "Calcas Jeans", slug: "calcas-jeans" },
      { name: "Bermudas", slug: "bermudas" },
      { name: "Manguito", slug: "manguito" },
      { name: "Jaquetas e Agasalhos", slug: "jaquetas-e-agasalhos" },
      { name: "Bones e Toucas", slug: "bones-e-toucas" },
      { name: "Mochilas", slug: "mochilas", children: [{ name: "Malas", slug: "malas" }] },
      {
        name: "Acessorios e Utilidades",
        slug: "acessorios-e-utilidades",
        children: [
          { name: "Garrafas", slug: "garrafas" },
          { name: "Relogios", slug: "relogios" },
          { name: "Taco de Baseball", slug: "taco-de-baseball" },
          { name: "Carteiras", slug: "carteiras" },
        ],
      },
      { name: "Linha Infantil", slug: "linha-infantil" },
    ],
  },
  {
    name: "Aventura",
    slug: "aventura",
    children: [
      {
        name: "Cutelaria",
        slug: "cutelaria",
        children: [
          { name: "Canivetes", slug: "canivetes" },
          { name: "Facas", slug: "facas" },
          { name: "Machados", slug: "machados" },
          { name: "Espadas", slug: "espadas" },
        ],
      },
      {
        name: "Camping",
        slug: "camping",
        children: [
          { name: "Barracas e Sacos de Dormir", slug: "barracas-e-sacos-de-dormir" },
          { name: "Itens de Sobrevivencia", slug: "itens-de-sobrevivencia" },
          { name: "Lanternas e Cyalumes", slug: "lanternas-e-cyalumes" },
          { name: "Acessorios", slug: "acessorios-de-camping" },
          { name: "Cameras", slug: "cameras" },
        ],
      },
    ],
  },
];

export const brands: { name: string; slug: string }[] = [
  { name: "5.11 Tactical", slug: "5-11-tactical" },
  { name: "Acetech", slug: "acetech" },
  { name: "Aurok", slug: "aurok" },
  { name: "Airpress", slug: "airpress" },
  { name: "Airstep", slug: "airstep" },
  { name: "APS", slug: "aps" },
  { name: "Ares Amoeba", slug: "ares-amoeba" },
  { name: "Armorer Works", slug: "armorer-works" },
  { name: "Army Armament", slug: "army-armament" },
  { name: "Belica", slug: "belica" },
  { name: "BR Force", slug: "br-force" },
  { name: "Cybergun", slug: "cybergun" },
  { name: "CYMA", slug: "cyma" },
  { name: "Double Bell", slug: "double-bell" },
  { name: "Dacs", slug: "dacs" },
  { name: "Duracell", slug: "duracell" },
  { name: "Edge", slug: "edge" },
  { name: "Emersongear", slug: "emersongear" },
  { name: "EMG", slug: "emg" },
  { name: "Evo", slug: "evo" },
  { name: "Ess Crossbow", slug: "ess-crossbow" },
  { name: "E&C", slug: "ec" },
  { name: "Feline", slug: "feline" },
  { name: "For Honor", slug: "for-honor" },
  { name: "G-Shock", slug: "g-shock" },
  { name: "Holosun", slug: "holosun" },
  { name: "Honeywell", slug: "honeywell" },
  { name: "HTA Airsoft", slug: "hta-airsoft" },
  { name: "Hwasan", slug: "hwasan" },
  { name: "Invictus", slug: "invictus" },
  { name: "King Arms", slug: "king-arms" },
  { name: "KPP Airsoft", slug: "kpp-airsoft" },
  { name: "Krytac", slug: "krytac" },
  { name: "KWA", slug: "kwa" },
  { name: "KWC", slug: "kwc" },
  { name: "LCT", slug: "lct" },
  { name: "Matrix", slug: "matrix" },
  { name: "Magpul", slug: "magpul" },
  { name: "Mechanix", slug: "mechanix" },
  { name: "Nautika", slug: "nautika" },
  { name: "PTS", slug: "pts" },
  { name: "Sea Parts", slug: "sea-parts" },
  { name: "Shotgun", slug: "shotgun" },
  { name: "Specna Arms", slug: "specna-arms" },
  { name: "Silverback", slug: "silverback" },
  { name: "Umarex", slug: "umarex" },
  { name: "Vector Optics", slug: "vector-optics" },
  { name: "Victoptics", slug: "victoptics" },
  { name: "Warfare", slug: "warfare" },
  { name: "WE Airsoft", slug: "we-airsoft" },
  { name: "WTC", slug: "wtc" },
  { name: "Wuben", slug: "wuben" },
];
