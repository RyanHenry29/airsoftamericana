"use client";

import { useEffect, useState, useMemo } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ShoppingCart,
  DollarSign,
  Users,
  Package,
  AlertTriangle,
  CreditCard,
  BarChart2,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type Period = "today" | "7d" | "30d" | "month" | "custom";

interface DateRange {
  from: string;
  to: string;
}

interface Metrics {
  ordersTotal: number;
  ordersApproved: number;
  ordersToday: number;
  ordersYesterday: number;
  productsPublished: number;
  lowStock: number;
  chargebacks: number;
  chargebackAmountCents: number;
  revenueCents: number;
  revenueTodayCents: number;
  ticketCents: number;
  conversionRate: number;
  prevOrders: number;
  prevRevenue: number;
  prevTicket: number;
  prevConversion: number;
}

interface DailySales {
  day: string;
  orders: number;
  revenue: number;
}

interface PaymentMethodStats {
  method: string;
  count: number;
  amount: number;
}

interface StatusStats {
  status: string;
  count: number;
}

interface TopProduct {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  revenue: number;
}

interface RecentOrder {
  id: string;
  number: string;
  customerName: string;
  customerEmail: string;
  totalCents: number;
  status: string;
  paymentMethod: string;
  createdAt: string;
}

interface ActionItem {
  label: string;
  href: string;
  count: number;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  color: string;
}

const PERIODS: { value: Period; label: string; days?: number }[] = [
  { value: "today", label: "Hoje", days: 0 },
  { value: "7d", label: "7 dias", days: 7 },
  { value: "30d", label: "30 dias", days: 30 },
  { value: "month", label: "Mês atual" },
];

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getPeriodRange(period: Period, custom?: DateRange): { from: string; to: string } {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const to = formatDate(now);

  let from: Date;
  if (period === "custom" && custom) {
    from = new Date(custom.from);
  } else if (period === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === "today") {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else {
    const daysMap = { "7d": 7, "30d": 30 } as const;
    const days = daysMap[period as "7d" | "30d"];
    from = new Date(now.getTime() - (days ?? 7) * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);
  }
  return { from: formatDate(from), to };
}

function getPrevPeriodRange(period: Period, currentFrom: string, currentTo: string): { from: string; to: string } {
  const from = new Date(currentFrom);
  const to = new Date(currentTo);
  const diff = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - diff);
  return { from: formatDate(prevFrom), to: formatDate(prevTo) };
}

function pctChange(current: number, previous: number): { pct: number; trend: "up" | "down" | "neutral" } {
  if (previous === 0) return { pct: current > 0 ? 100 : 0, trend: current > 0 ? "up" : "neutral" };
  const pct = ((current - previous) / previous) * 100;
  return { pct: Math.abs(pct), trend: pct > 0 ? "up" : pct < 0 ? "down" : "neutral" };
}

function TrendIndicator({ current, previous, unit = "" }: { current: number; previous: number; unit?: string }) {
  const { pct, trend } = pctChange(current, previous);
  if (trend === "neutral") return <span className="trend-neutral">{unit ? brl(current) : current}{unit}</span>;
  const Icon = trend === "up" ? TrendingUp : TrendingDown;
  return (
    <span className={`trend ${trend}`}>
      <Icon size={12} strokeWidth={2} />
      <span>{pct.toFixed(1)}%</span>
      <span className="trend-value">{unit ? brl(current) : current}{unit}</span>
    </span>
  );
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const [customRange, setCustomRange] = useState<DateRange>({ from: "", to: "" });
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [dailySales, setDailySales] = useState<DailySales[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodStats[]>([]);
  const [statusStats, setStatusStats] = useState<StatusStats[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  useGateRedirect(failure);

  const range = useMemo(() => getPeriodRange(period, period === "custom" ? customRange : undefined), [period, customRange]);
  const prevRange = useMemo(() => getPrevPeriodRange(period, range.from, range.to), [range]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [metricsRes, dailyRes, paymentRes, statusRes, topRes, recentRes, actionsRes] = await Promise.allSettled([
        adminJson<Metrics>(`/api/admin/metrics?from=${range.from}&to=${range.to}&prevFrom=${prevRange.from}&prevTo=${prevRange.to}`),
        adminJson<DailySales[]>(`/api/admin/sales/daily?from=${range.from}&to=${range.to}`),
        adminJson<PaymentMethodStats[]>(`/api/admin/sales/by-method?from=${range.from}&to=${range.to}`),
        adminJson<StatusStats[]>(`/api/admin/sales/by-status?from=${range.from}&to=${range.to}`),
        adminJson<TopProduct[]>(`/api/admin/products/top?from=${range.from}&to=${range.to}&limit=5`),
        adminJson<RecentOrder[]>(`/api/admin/orders/recent?limit=10`),
        adminJson<ActionItem[]>(`/api/admin/actions/pending`),
      ]);

      if (metricsRes.status === "fulfilled") setMetrics(metricsRes.value);
      if (dailyRes.status === "fulfilled") setDailySales(dailyRes.value);
      if (paymentRes.status === "fulfilled") setPaymentMethods(paymentRes.value);
      if (statusRes.status === "fulfilled") setStatusStats(statusRes.value);
      if (topRes.status === "fulfilled") setTopProducts(topRes.value);
      if (recentRes.status === "fulfilled") setRecentOrders(recentRes.value);
      if (actionsRes.status === "fulfilled") setActionItems(actionsRes.value);

      setFailure(null);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar dashboard."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [period, customRange]);

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <div className="admin-section-head skel-title" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="skel skel-card" />
          <div className="skel skel-card" />
          <div className="skel skel-card" />
          <div className="skel skel-card" />
        </div>
        <div className="skel skel-card mt-6" style={{ height: 300 }} />
      </main>
    );
  }

  if (error || !metrics) {
    return (
      <main className="px-6 py-24 text-center">
        <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#dc2626] mb-6">ERR</div>
        <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white mb-6">Erro ao carregar</h1>
        <p className="text-[#666] font-mono text-xs mb-10 max-w-md mx-auto">{error}</p>
        <button className="btn-primary px-8 py-3" onClick={load}>TENTAR NOVAMENTE</button>
      </main>
    );
  }

  // Empty state helper
  const hasData = metrics.ordersTotal > 0 || metrics.revenueCents > 0;

  return (
    <main className="px-6 pb-24">
      {/* Header + Period Filter */}
      <div className="admin-section-head flex-wrap">
        <div>
          <span className="admin-section-head__kicker">Painel</span>
          <h1 className="admin-section-head__title">Dashboard</h1>
          <p className="admin-section-head__subtitle">
            {period === "custom"
              ? `Período: ${new Date(range.from).toLocaleDateString("pt-BR")} a ${new Date(range.to).toLocaleDateString("pt-BR")}`
              : `Período: ${PERIODS.find(p => p.value === period)?.label}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-[#0a0c0a] border border-[#111] p-1 rounded" role="group" aria-label="Filtro de período">
            {PERIODS.map(p => (
              <button
                key={p.value}
                type="button"
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider rounded transition-colors ${
                  period === p.value ? "bg-[#8bcf16] text-black" : "text-[#666] hover:text-white hover:bg-[#111]"
                }`}
                onClick={() => { setPeriod(p.value); setCustomRange({ from: "", to: "" }); }}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider rounded transition-colors ${
                period === "custom" ? "bg-[#8bcf16] text-black" : "text-[#666] hover:text-white hover:bg-[#111]"
              }`}
              onClick={() => setPeriod("custom")}
            >
              Personalizado
            </button>
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-2 text-[#666] font-mono text-xs">
              <input
                type="date"
                value={customRange.from}
                onChange={e => setCustomRange({ ...customRange, from: e.target.value })}
                className="input w-auto"
                aria-label="Data inicial"
              />
              <span>até</span>
              <input
                type="date"
                value={customRange.to}
                onChange={e => setCustomRange({ ...customRange, to: e.target.value })}
                className="input w-auto"
                aria-label="Data final"
              />
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards with Comparison */}
      <div className="admin-grid">
        <MetricCard
          label="Pedidos"
          value={metrics.ordersTotal}
          prevValue={metrics.prevOrders}
          icon={ShoppingCart}
          color="var(--primary)"
          trendUp={true}
        />
        <MetricCard
          label="Receita"
          value={metrics.revenueCents}
          prevValue={metrics.prevRevenue}
          icon={DollarSign}
          color="var(--primary)"
          isCurrency
          trendUp={true}
        />
        <MetricCard
          label="Ticket médio"
          value={metrics.ticketCents}
          prevValue={metrics.prevTicket}
          icon={Users}
          color="var(--primary)"
          isCurrency
          trendUp={true}
        />
        <MetricCard
          label="Conversão pagamento"
          value={metrics.conversionRate}
          prevValue={metrics.prevConversion}
          icon={CheckCircle}
          color="var(--primary)"
          suffix="%"
          trendUp={true}
        />
      </div>

      {/* Sales Chart + Precisa de Ação */}
      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        <section className="lg:col-span-2 admin-card-wrapper">
          <header className="card-header">
            <h2 className="card-title">Vendas por dia</h2>
          </header>
          <div className="chart-wrapper" style={{ height: 320 }}>
            <SalesChart data={dailySales} />
          </div>
        </section>

        <section className="admin-card-wrapper">
          <header className="card-header">
            <h2 className="card-title">Precisa de ação</h2>
          </header>
          <ActionBlock items={actionItems} />
        </section>
      </div>

      {/* Top Products + Recent Orders */}
      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <section className="admin-card-wrapper">
          <header className="card-header">
            <h2 className="card-title">Top 5 produtos</h2>
            <a href="/products" className="card-link">Ver todos</a>
          </header>
          <TopProductsTable products={topProducts} />
        </section>

        <section className="admin-card-wrapper">
          <header className="card-header">
            <h2 className="card-title">Pedidos recentes</h2>
            <a href="/orders" className="card-link">Ver todos</a>
          </header>
          <RecentOrdersTable orders={recentOrders} />
        </section>
      </div>

      {/* Payment Methods + Status */}
      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <section className="admin-card-wrapper">
          <header className="card-header">
            <h2 className="card-title">Por forma de pagamento</h2>
          </header>
          <PaymentMethodChart data={paymentMethods} />
        </section>

        <section className="admin-card-wrapper">
          <header className="card-header">
            <h2 className="card-title">Por status</h2>
          </header>
          <StatusChart data={statusStats} />
        </section>
      </div>

      {/* Empty State */}
      {!hasData && (
        <section className="admin-card-wrapper mt-6">
          <div className="empty-state">
            <div className="empty-icon">
              <Package size={48} strokeWidth={1.5} />
            </div>
            <h3 className="empty-title">Nenhum dado ainda</h3>
            <p className="empty-text">O dashboard mostra métricas reais. Comece configurando a loja:</p>
            <div className="empty-steps">
              <StepItem step={1} label="Cadastrar produtos" href="/products/new" icon={Plus} />
              <StepItem step={2} label="Configurar pagamento" href="/gateways" icon={CreditCard} />
              <StepItem step={3} label="Ativar frete" href="/settings" icon={Package} />
              <StepItem step={4} label="Publicar banner" href="/banners" icon={ArrowUpRight} />
            </div>
            <div className="empty-shortcuts">
              <a href="/products/new" className="btn-primary"><Plus size={16} strokeWidth={2} /> NOVO PRODUTO</a>
              <a href="/banners" className="btn-outline"><ArrowUpRight size={16} strokeWidth={2} /> NOVO BANNER</a>
              <a href="/orders" className="btn-outline"><ShoppingCart size={16} strokeWidth={2} /> VER PEDIDOS</a>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

/* --- Sub-components --- */

function MetricCard({
  label,
  value,
  prevValue,
  icon: Icon,
  color,
  isCurrency = false,
  suffix = "",
  trendUp = true,
}: {
  label: string;
  value: number;
  prevValue: number;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  color: string;
  isCurrency?: boolean;
  suffix?: string;
  trendUp?: boolean;
}) {
  const { pct, trend } = pctChange(value, prevValue);
  const displayValue = isCurrency ? brl(value) : `${value}${suffix}`;

  return (
    <div className="admin-card">
      <div className="card-icon" style={{ background: `${color}15`, color }}>
        <Icon size={20} strokeWidth={2} />
      </div>
      <div className="card-content">
        <span className="card-label">{label}</span>
        <div className="card-value">{displayValue}</div>
        <div className="card-comparison">
          <span className="card-prev">{isCurrency ? brl(prevValue) : `${prevValue}${suffix}`} no período anterior</span>
          {trend !== "neutral" && (
            <span className={`card-trend ${trend}`}>
              {trend === "up" ? <TrendingUp size={12} strokeWidth={2} /> : <TrendingDown size={12} strokeWidth={2} />}
              <span>{pct.toFixed(1)}%</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionBlock({ items }: { items: ActionItem[] }) {
  if (!items.length) {
    return <p className="card-empty">Tudo em dia ✓</p>;
  }
  return (
    <ul className="action-list">
      {items.map((item, i) => (
        <li key={item.href} className="action-item">
          <a href={item.href} className="action-link">
            <span className="action-icon" style={{ background: `${item.color}15`, color: item.color }}>
              <item.icon size={18} strokeWidth={2} />
            </span>
            <div className="action-content">
              <span className="action-label">{item.label}</span>
              <span className="action-count">{item.count} pendente{item.count !== 1 ? "s" : ""}</span>
            </div>
            <ArrowRight size={14} strokeWidth={2} className="action-arrow" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function SalesChart({ data }: { data: DailySales[] }) {
  if (!data.length) return <p className="chart-empty">Sem dados de vendas no período</p>;

  const maxRevenue = Math.max(...data.map(d => d.revenue));
  const maxOrders = Math.max(...data.map(d => d.orders));

  return (
    <svg viewBox="0 0 100% 100%" preserveAspectRatio="none" className="chart-svg" role="img" aria-label="Gráfico de vendas por dia">
      <defs>
        <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ordersGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="transparent" />
      {/* Grid lines */}
      <g className="chart-grid" stroke="#111" strokeWidth="0.5">
        {[0, 25, 50, 75, 100].map(p => (
          <line key={p} x1="0%" y1={`${p}%`} x2="100%" y2={`${p}%`} />
        ))}
      </g>
      {/* Revenue area */}
      <path
        d={(() => {
          const path = data.map((d, i) => {
            const x = (i / (data.length - 1)) * 100 || 50;
            const y = 100 - (d.revenue / (maxRevenue || 1)) * 90;
            return `${i === 0 ? "M" : "L"}${x}% ${y}%`;
          }).join(" ");
          return `${path} L100% 100% L0% 100% Z`;
        })()}
        fill="url(#revenueGrad)"
      />
      {/* Revenue line */}
      <path
        d={(() => data.map((d, i) => {
          const x = (i / (data.length - 1)) * 100 || 50;
          const y = 100 - (d.revenue / (maxRevenue || 1)) * 90;
          return `${i === 0 ? "M" : "L"}${x}% ${y}%`;
        }).join(" "))()}
        stroke="var(--primary)"
        strokeWidth="2"
        fill="none"
      />
      {/* Orders line */}
      <path
        d={(() => data.map((d, i) => {
          const x = (i / (data.length - 1)) * 100 || 50;
          const y = 100 - (d.orders / (maxOrders || 1)) * 90;
          return `${i === 0 ? "M" : "L"}${x}% ${y}%`;
        }).join(" "))()}
        stroke="#3b82f6"
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="6 4"
      />
      {/* X-axis labels */}
      <g className="chart-labels" fontFamily="var(--font-body)" fontSize="8" fill="#666">
        {data.map((d, i) => (
          <text key={d.day} x={`${(i / (data.length - 1)) * 100 || 50}%`} y="105%" textAnchor="middle">
            {new Date(d.day).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
          </text>
        ))}
      </g>
      {/* Legend */}
      <g className="chart-legend" fontFamily="var(--font-body)" fontSize="8">
        <g transform="translate(10, 10)">
          <rect x="0" y="0" width="12" height="2" fill="var(--primary)" />
          <text x="16" y="10" fill="#9aa09a">Receita</text>
        </g>
        <g transform="translate(10, 24)">
          <line x1="0" y1="1" x2="12" y2="1" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4 2" />
          <text x="16" y="10" fill="#9aa09a">Pedidos</text>
        </g>
      </g>
    </svg>
  );
}

function TopProductsTable({ products }: { products: TopProduct[] }) {
  if (!products.length) return <p className="card-empty">Nenhum produto vendido no período</p>;
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Produto</th>
          <th>SKU</th>
          <th className="text-right">Qtd</th>
          <th className="text-right">Receita</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p, i) => (
          <tr key={p.id}>
            <td>
              <span className="font-display font-black text-sm text-white">{p.name}</span>
              <span className="font-mono text-[0.55rem] uppercase text-[#666] block mt-0.5">#{i + 1}</span>
            </td>
            <td className="font-mono text-sm font-bold text-white">{p.sku}</td>
            <td className="text-right font-bold text-white">{p.quantity}</td>
            <td className="text-right font-bold text-[#8bcf16]">{brl(p.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecentOrdersTable({ orders }: { orders: RecentOrder[] }) {
  if (!orders.length) return <p className="card-empty">Nenhum pedido recente</p>;
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Pedido</th>
          <th>Cliente</th>
          <th className="text-right">Valor</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.id}>
            <td>
              <span className="font-mono text-sm font-bold text-white">{o.number}</span>
              <span className="font-mono text-[0.55rem] uppercase text-[#666] block mt-0.5">{new Date(o.createdAt).toLocaleDateString("pt-BR")}</span>
            </td>
            <td>
              <span className="text-white">{o.customerName}</span>
              <span className="font-mono text-[0.55rem] uppercase text-[#666] block mt-0.5">{o.customerEmail}</span>
            </td>
            <td className="text-right font-bold text-[#8bcf16]">{brl(o.totalCents)}</td>
            <td>
              <span className={`admin-badge ${getStatusBadgeClass(o.status)}`}>
                {getStatusLabel(o.status)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function getStatusBadgeClass(status: string) {
  const map: Record<string, string> = {
    pagamento_aprovado: "admin-badge--ok",
    aguardando_pagamento: "admin-badge--warn",
    aguardando_revisao_manual: "admin-badge--warn",
    em_analise_antifraude: "admin-badge--warn",
    cancelado: "admin-badge--err",
    reembolsado: "admin-badge--err",
    enviado: "admin-badge--ok",
    entregue: "admin-badge--ok",
    em_disputa: "admin-badge--err",
    chargeback_recebido: "admin-badge--err",
  };
  return map[status] ?? "admin-badge--ok";
}

function getStatusLabel(status: string) {
  const map: Record<string, string> = {
    pagamento_aprovado: "Aprovado",
    aguardando_pagamento: "Aguardando pgto",
    aguardando_revisao_manual: "Revisão manual",
    em_analise_antifraude: "Análise antifraude",
    cancelado: "Cancelado",
    reembolsado: "Reembolsado",
    enviado: "Enviado",
    entregue: "Entregue",
    em_disputa: "Em disputa",
    chargeback_recebido: "Chargeback",
  };
  return map[status] ?? status;
}

function PaymentMethodChart({ data }: { data: PaymentMethodStats[] }) {
  if (!data.length) return <p className="card-empty">Sem dados de pagamento</p>;
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="payment-chart">
      {data.map(d => (
        <div key={d.method} className="payment-row">
          <div className="payment-info">
            <span className="payment-method">{d.method.toUpperCase()}</span>
            <span className="payment-count">{d.count} pedidos</span>
          </div>
          <div className="payment-bar-wrapper">
            <div className="payment-bar" style={{ width: `${(d.amount / (total || 1)) * 100}%` }} />
          </div>
          <div className="payment-value">{brl(d.amount)}</div>
        </div>
      ))}
    </div>
  );
}

function StatusChart({ data }: { data: StatusStats[] }) {
  if (!data.length) return <p className="card-empty">Sem dados de status</p>;
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="status-chart">
      {data.map(d => (
        <div key={d.status} className="status-row">
          <span className={`status-badge ${getStatusBadgeClass(d.status)}`}>{getStatusLabel(d.status)}</span>
          <div className="status-bar-wrapper">
            <div className="status-bar" style={{ width: `${(d.count / (total || 1)) * 100}%` }} />
          </div>
          <span className="status-count">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

/* Helper components */
function StepItem({ step, label, href, icon: Icon }: { step: number; label: string; href: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }) {
  return (
    <a href={href} className="step-item">
      <span className="step-number">{step}</span>
      <span className="step-icon"><Icon size={18} strokeWidth={2} /></span>
      <span className="step-label">{label}</span>
      <span className="step-arrow"><ExternalLink size={14} strokeWidth={2} /></span>
    </a>
  );
}

/* --- Styles (inline for now, will move to globals.css) --- */
const styles = `
  .admin-card-wrapper { border: 1px solid var(--border); border-radius: 2px; background: #0a0c0a; overflow: hidden; }
  .card-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); }
  .card-title { margin: 0; font-family: var(--font-display); font-weight: 700; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--foreground); }
  .card-link { font-family: var(--font-body); font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--primary); text-decoration: none; }
  .card-link:hover { text-decoration: underline; }

  .chart-wrapper { padding: 1rem 1.25rem; }
  .chart-svg { width: 100%; height: 100%; }
  .chart-grid line { stroke: var(--border); }
  .chart-labels text { font-family: var(--font-mono); }
  .chart-legend text { font-family: var(--font-body); }
  .chart-empty { text-align: center; color: #666; padding: 2rem; font-family: var(--font-body); font-size: 0.8rem; }

  .action-list { list-style: none; margin: 0; padding: 0; }
  .action-item { border-bottom: 1px solid var(--border); }
  .action-item:last-child { border-bottom: none; }
  .action-link { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1.25rem; text-decoration: none; color: inherit; transition: background 0.2s; }
  .action-link:hover { background: #141714; }
  .action-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 2px; flex-shrink: 0; }
  .action-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.125rem; }
  .action-label { font-family: var(--font-display); font-weight: 700; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--foreground); }
  .action-count { font-family: var(--font-body); font-size: 0.62rem; color: #666; text-transform: uppercase; letter-spacing: 0.1em; }
  .action-arrow { flex-shrink: 0; color: #666; transition: transform 0.2s; }
  .action-link:hover .action-arrow { transform: translateX(4px); color: var(--primary); }
  .card-empty { text-align: center; color: #4ade80; padding: 1.5rem; font-family: var(--font-body); font-size: 0.8rem; font-weight: 600; }

  .admin-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
  .admin-table th { text-align: left; padding: 0.5rem 0.75rem; font-family: var(--font-body); font-size: 0.55rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: #666; border-bottom: 1px solid var(--border); }
  .admin-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); font-family: var(--font-body); color: var(--foreground); }
  .admin-table tbody tr:last-child td { border-bottom: none; }
  .admin-table .text-right { text-align: right; }
  .card-empty { text-align: center; color: #666; padding: 1.5rem; font-family: var(--font-body); font-size: 0.8rem; }

  .payment-chart { padding: 0.5rem 1.25rem 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .payment-row { display: flex; align-items: center; gap: 0.75rem; }
  .payment-info { display: flex; flex-direction: column; gap: 0.125rem; min-width: 80px; }
  .payment-method { font-family: var(--font-body); font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--foreground); }
  .payment-count { font-family: var(--font-body); font-size: 0.55rem; color: #666; text-transform: uppercase; letter-spacing: 0.1em; }
  .payment-bar-wrapper { flex: 1; height: 6px; background: #111; border-radius: 3px; overflow: hidden; }
  .payment-bar { height: 100%; background: var(--primary); border-radius: 3px; transition: width 0.5s ease; }
  .payment-value { font-family: var(--font-display); font-weight: 700; font-size: 0.75rem; color: var(--primary); white-space: nowrap; min-width: 80px; text-align: right; }

  .status-chart { padding: 0.5rem 1.25rem 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
  .status-row { display: flex; align-items: center; gap: 0.75rem; }
  .status-badge { min-width: 100px; text-align: center; font-size: 0.6rem; padding: 0.25rem 0.5rem; }
  .status-bar-wrapper { flex: 1; height: 6px; background: #111; border-radius: 3px; overflow: hidden; }
  .status-bar { height: 100%; background: var(--primary); border-radius: 3px; transition: width 0.5s ease; }
  .status-count { font-family: var(--font-display); font-weight: 700; font-size: 0.75rem; color: var(--foreground); min-width: 35px; text-align: right; }

  .empty-state { padding: 3rem 1.5rem; text-align: center; }
  .empty-icon { width: 80px; height: 80px; margin: 0 auto 1.5rem; display: grid; place-items: center; background: var(--base); color: var(--primary); border-radius: 2px; }
  .empty-title { font-family: var(--font-display); font-weight: 800; font-size: clamp(1.5rem, 4vw, 2rem); line-height: 1.2; color: var(--foreground); margin: 0 0 0.75rem; text-transform: uppercase; }
  .empty-text { font-family: var(--font-body); font-size: 0.85rem; color: #666; margin: 0 0 2rem; line-height: 1.6; max-width: 42rem; margin-inline: auto; }
  .empty-steps { display: flex; flex-wrap: wrap; justify-content: center; gap: 1rem; margin-bottom: 2rem; }
  .step-item { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; border: 1px solid var(--border); border-radius: 2px; background: #0a0c0a; color: var(--foreground); text-decoration: none; font-family: var(--font-body); font-size: 0.75rem; transition: border-color 0.2s, color 0.2s; }
  .step-item:hover { border-color: var(--primary); color: var(--primary); }
  .step-number { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--primary); color: #000; font-family: var(--font-display); font-weight: 800; font-size: 0.75rem; }
  .step-icon { color: var(--primary); }
  .step-label { font-weight: 600; }
  .step-arrow { color: #666; }
  .empty-shortcuts { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.75rem; }
  .empty-shortcuts .btn-primary { display: inline-flex; align-items: center; gap: 0.5rem; }
  .empty-shortcuts .btn-outline { display: inline-flex; align-items: center; gap: 0.5rem; }

  /* MetricCard */
  .admin-card { display: flex; gap: 1rem; padding: 1.25rem; border: 1px solid var(--border); border-radius: 2px; background: #0a0c0a; }
  .card-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 2px; flex-shrink: 0; }
  .card-content { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 0.25rem; }
  .card-label { font-family: var(--font-body); font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: var(--primary); }
  .card-value { font-family: var(--font-display); font-weight: 800; font-size: clamp(1.5rem, 4vw, 2rem); line-height: 1; color: var(--foreground); }
  .card-comparison { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .card-prev { font-family: var(--font-body); font-size: 0.62rem; color: #666; }
  .card-trend { display: inline-flex; align-items: center; gap: 0.25rem; font-family: var(--font-body); font-size: 0.62rem; font-weight: 600; }
  .card-trend.up { color: #4ade80; }
  .card-trend.down { color: #dc2626; }
  .trend-neutral { font-family: var(--font-body); font-size: 0.62rem; color: #666; }

  .trend { display: inline-flex; align-items: center; gap: 0.25rem; font-family: var(--font-body); font-size: 0.62rem; font-weight: 600; }
  .trend.up { color: #4ade80; }
  .trend.down { color: #dc2626; }
  .trend-value { font-weight: 400; color: #9aa09a; }

  @media (max-width: 640px) {
    .admin-grid { grid-template-columns: 1fr; }
  }
`;

// Inject styles once
if (typeof window !== "undefined" && !document.getElementById("dashboard-styles")) {
  const styleEl = document.createElement("style");
  styleEl.id = "dashboard-styles";
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);
}