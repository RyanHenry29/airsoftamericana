// language: TSX, file: apps/store/src/app/components/AuthScreen.tsx, target: Next.js App Router
// Tela única de acesso da loja: abas Entrar / Criar conta com indicador
// deslizante, formulários validados no blur com check verde e lista de
// requisitos de senha. Layout centralizado, sem painel lateral de marca.
// Movimento respeita prefers-reduced-motion (MotionConfig + globals.css).
"use client";

import { useId, useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useAnimationControls,
} from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User,
} from "lucide-react";
import { API_URL } from "../lib/store";
import { AUTH_MESSAGES, maskCpf, maskPhone } from "../lib/authValidation";
import { safeNext, useAuthActions, type AuthResult } from "./useAuthActions";

/* ───────── tipos ───────── */
type Mode = "login" | "register";
type Props = {
  initialMode?: Mode;
  onLogin?: (d: { email: string; password: string; remember: boolean }) => Promise<AuthResult>;
  onRegister?: (d: { name: string; email: string; phone: string; cpf: string; password: string }) => Promise<AuthResult>;
  onGoogle?: () => Promise<void>;
};

/* ───────── utilidades ───────── */
const emailOk = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());

function useTouched() {
  const [t, setT] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  return {
    show: (k: string) => submitted || !!t[k],
    blur: (k: string) => () => setT((s) => ({ ...s, [k]: true })),
    submit: () => setSubmitted(true),
  };
}

function useSubmit() {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [formError, setFormError] = useState<string>();
  const controls = useAnimationControls();
  const run = async (fn: () => Promise<AuthResult> | undefined) => {
    setStatus("loading");
    setFormError(undefined);
    let r: AuthResult;
    try {
      r = (await fn()) ?? { ok: true };
    } catch {
      r = { ok: false, error: "Não foi possível conectar. Verifique sua internet e tente de novo." };
    }
    if (r.ok) setStatus("done");
    else {
      setStatus("idle");
      setFormError(r.error ?? "Não foi possível concluir. Tente novamente.");
      controls.start({ x: [0, -8, 8, -5, 5, 0], transition: { duration: 0.35 } });
    }
  };
  return { status, formError, controls, run };
}

/* ───────── campo ───────── */
type InputProps = { id: string; "aria-invalid": boolean; "aria-describedby"?: string };

const inputCls =
  "h-12 w-full rounded-[var(--radius)] border border-border bg-base pl-10 pr-10 text-[15px] text-foreground " +
  "placeholder:text-muted-foreground/60 outline-none transition duration-200 hover:border-[var(--border-strong)] " +
  "focus:border-primary focus:ring-4 focus:ring-primary/15 " +
  "aria-[invalid=true]:border-[#f87171] aria-[invalid=true]:focus:ring-[#f87171]/15";

function Field({ label, icon, optional, error, hint, valid, children }: {
  label: string; icon: ReactNode; optional?: boolean; error?: string; hint?: string; valid?: boolean;
  children: (p: InputProps) => ReactNode;
}) {
  const id = useId();
  const msg = error ?? hint;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-medium text-foreground/85">{label}</label>
        {optional && <span className="text-xs text-muted-foreground/70">Opcional</span>}
      </div>
      <div className="group relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 transition-colors group-focus-within:text-primary">{icon}</span>
        {children({ id, "aria-invalid": !!error, "aria-describedby": msg ? `${id}-msg` : undefined })}
        <AnimatePresence>
          {valid && !error && (
            <motion.span initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-primary">
              <Check size={16} strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false}>
        {msg && (
          <motion.p id={`${id}-msg`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className={`flex items-center gap-1.5 overflow-hidden pt-1.5 text-[13px] ${error ? "text-[#f87171]" : "text-muted-foreground"}`}>
            {error && <AlertCircle size={13} />}{msg}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function PasswordInput({ value, onChange, onBlur, placeholder, autoComplete, p }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder: string; autoComplete: string; p: InputProps;
}) {
  const [show, setShow] = useState(false);
  return (
    <>
      <input {...p} type={show ? "text" : "password"} value={value} placeholder={placeholder} autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur} className={`${inputCls} pr-11`} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </>
  );
}

/* ───────── botões ───────── */
function SubmitButton({ status, label }: { status: "idle" | "loading" | "done"; label: string }) {
  return (
    <motion.button type="submit" disabled={status !== "idle"} whileTap={{ scale: 0.985 }}
      className="group flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-primary text-[15px] font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }} className="flex items-center gap-2">
          {status === "loading" && <><Loader2 size={18} className="animate-spin" /> Aguarde…</>}
          {status === "done" && <><Check size={18} strokeWidth={3} /> Tudo certo</>}
          {status === "idle" && <>{label}<ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" /></>}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function Banner({ children }: { children?: string }) {
  return (
    <AnimatePresence>
      {children && (
        <motion.div role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div className="flex items-start gap-2.5 rounded-[var(--radius)] border border-[#f87171]/35 bg-[#f87171]/10 px-3.5 py-3 text-sm text-[#f87171]">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />{children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const linkCls = "font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/* ───────── formulário: entrar ───────── */
function LoginForm({ onLogin }: { onLogin: NonNullable<Props["onLogin"]> }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [remember, setRemember] = useState(true);
  const v = useTouched(); const s = useSubmit();
  const err = { email: emailOk(email) ? undefined : "Digite um e-mail válido.", password: password ? undefined : "Digite sua senha." };
  return (
    <motion.form noValidate animate={s.controls} className="space-y-5"
      onSubmit={(e) => { e.preventDefault(); v.submit(); if (err.email || err.password) return; s.run(() => onLogin({ email: email.trim(), password, remember })); }}>
      <Field label="E-mail" icon={<Mail size={16} />} error={v.show("email") ? err.email : undefined} valid={emailOk(email)}>
        {(p) => <input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={v.blur("email")} placeholder="voce@email.com" autoComplete="email" className={inputCls} />}
      </Field>
      <Field label="Senha" icon={<Lock size={16} />} error={v.show("password") ? err.password : undefined}>
        {(p) => <PasswordInput p={p} value={password} onChange={setPassword} onBlur={v.blur("password")} placeholder="Sua senha" autoComplete="current-password" />}
      </Field>
      <div className="flex items-center justify-between text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-foreground/75">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded-[var(--radius)] accent-primary" /> Manter conectado
        </label>
        <Link href="/esqueci-a-senha" className={linkCls}>Esqueci a senha</Link>
      </div>
      <Banner>{s.formError}</Banner>
      <SubmitButton status={s.status} label="Entrar" />
    </motion.form>
  );
}

/* ───────── formulário: criar conta ───────── */
function Req({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-2 text-[13px] transition-colors ${ok ? "text-[var(--primary-dark)]" : "text-muted-foreground"}`}>
      <span className={`grid h-4 w-4 place-items-center rounded-full transition-colors ${ok ? "bg-primary text-primary-foreground" : "bg-muted text-transparent"}`}>
        <Check size={10} strokeWidth={3.5} />
      </span>{children}
    </li>
  );
}

function RegisterForm({ onRegister }: { onRegister: NonNullable<Props["onRegister"]> }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", cpf: "", password: "", confirm: "" });
  const [terms, setTerms] = useState(false);
  const v = useTouched(); const s = useSubmit();
  const set = (k: keyof typeof f, fmtM?: (x: string) => string) => (x: string) => setF((o) => ({ ...o, [k]: fmtM ? fmtM(x) : x }));
  const has = useMemo(() => ({ len: f.password.length >= 8, mix: /[a-z]/i.test(f.password) && /\d/.test(f.password) }), [f.password]);
  const cpfDigits = f.cpf.replace(/\D/g, "");
  const err = {
    name: f.name.trim().split(/\s+/).length < 2 ? "Digite nome e sobrenome." : undefined,
    email: emailOk(f.email) ? undefined : "Digite um e-mail válido.",
    cpf: cpfDigits.length > 0 && cpfDigits.length !== 11 ? AUTH_MESSAGES.cpfInvalid : undefined,
    password: has.len && has.mix ? undefined : "A senha precisa cumprir os requisitos abaixo.",
    confirm: f.confirm === f.password && f.confirm ? undefined : "As senhas não são iguais.",
    terms: terms ? undefined : "Aceite os termos para criar a conta.",
  };
  const show = (k: keyof typeof err) => (v.show(k) ? err[k] : undefined);
  return (
    <motion.form noValidate animate={s.controls} className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault(); v.submit();
        if (Object.values(err).some(Boolean)) return;
        s.run(() => onRegister({ name: f.name.trim(), email: f.email.trim(), phone: f.phone, cpf: f.cpf, password: f.password }));
      }}>
      <Field label="Nome completo" icon={<User size={16} />} error={show("name")} valid={!err.name}>
        {(p) => <input {...p} value={f.name} onChange={(e) => set("name")(e.target.value)} onBlur={v.blur("name")} placeholder="Como no documento" autoComplete="name" className={inputCls} />}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="E-mail" icon={<Mail size={16} />} error={show("email")} valid={!err.email}>
          {(p) => <input {...p} type="email" value={f.email} onChange={(e) => set("email")(e.target.value)} onBlur={v.blur("email")} placeholder="voce@email.com" autoComplete="email" className={inputCls} />}
        </Field>
        <Field label="WhatsApp" icon={<Phone size={16} />} optional>
          {(p) => <input {...p} inputMode="tel" value={f.phone} onChange={(e) => set("phone", maskPhone)(e.target.value)} onBlur={v.blur("phone")} placeholder="(19) 99999-9999" autoComplete="tel" className={inputCls} />}
        </Field>
      </div>
      <Field label="CPF" icon={<FileText size={16} />} optional error={show("cpf")} hint="Usado na nota fiscal. Pode preencher depois, no checkout.">
        {(p) => <input {...p} inputMode="numeric" value={f.cpf} onChange={(e) => set("cpf", maskCpf)(e.target.value)} onBlur={v.blur("cpf")} placeholder="000.000.000-00" className={inputCls} />}
      </Field>

      <div className="space-y-3">
        <Field label="Senha" icon={<Lock size={16} />} error={show("password")}>
          {(p) => <PasswordInput p={p} value={f.password} onChange={set("password")} onBlur={v.blur("password")} placeholder="Crie uma senha" autoComplete="new-password" />}
        </Field>
        <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Requisitos da senha">
          <Req ok={has.len}>Mínimo de 8 caracteres</Req>
          <Req ok={has.mix}>Letras e números</Req>
        </ul>
      </div>
      <Field label="Confirmar senha" icon={<Lock size={16} />} error={show("confirm")}>
        {(p) => <PasswordInput p={p} value={f.confirm} onChange={set("confirm")} onBlur={v.blur("confirm")} placeholder="Repita a senha" autoComplete="new-password" />}
      </Field>

      <div>
        <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-foreground/75">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded-[var(--radius)] accent-primary" />
          <span>Li e aceito os <Link href="/termos" className={linkCls}>Termos de compra</Link> e a <Link href="/privacidade" className={linkCls}>Política de privacidade</Link>.</span>
        </label>
        <AnimatePresence initial={false}>
          {show("terms") && <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden pt-1.5 text-[13px] text-[#f87171]">{err.terms}</motion.p>}
        </AnimatePresence>
      </div>
      <Banner>{s.formError}</Banner>
      <SubmitButton status={s.status} label="Criar conta" />
    </motion.form>
  );
}

/* ───────── ícone Google ───────── */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

/* ───────── marca compacta no topo ───────── */
function BrandCompact() {
  return (
    <Link href="/" className="flex w-fit items-center gap-2.5" aria-label="Airsoft Americana - Início">
      <Image src="/emblema.png" alt="" width={44} height={44} className="h-8 w-8 object-contain" />
      {/* sem classe `block`: a casa usa .block como seção (padding de seção colava aqui) */}
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-bold tracking-wide text-foreground">AIRSOFT AMERICANA</span>
        <span className="text-[11px] text-muted-foreground">Equipamentos e acessórios</span>
      </span>
    </Link>
  );
}

/* ───────── tela ───────── */
const TABS: { id: Mode; label: string }[] = [{ id: "login", label: "Entrar" }, { id: "register", label: "Criar conta" }];

/* stagger container para campos do formulário */
const formContainerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.1 },
  },
  exit: {
    opacity: 0,
    transition: { staggerChildren: 0.03, staggerDirection: -1 },
  },
};

const fieldVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

export function AuthScreen({ initialMode = "login", onLogin, onRegister, onGoogle }: Props) {
  const router = useRouter();
  const actions = useAuthActions();
  const login = onLogin ?? actions.login;
  const register = onRegister ?? actions.register;
  const google = onGoogle ?? actions.google;
  const [mode, setMode] = useState<Mode>(initialMode);
  const [prevMode, setPrevMode] = useState<Mode>(initialMode);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string>();

  // track direction for slide animation
  const direction = useMemo(() => {
    const order: Mode[] = ["login", "register"];
    return order.indexOf(mode) - order.indexOf(prevMode);
  }, [mode, prevMode]);

  const handleModeChange = (next: Mode) => {
    setPrevMode(mode);
    setMode(next);
  };

  // Já tem sessão? Vai direto pra conta — só na rota de entrar.
  useEffect(() => {
    if (initialMode !== "login") return;
    let alive = true;
    fetch(`${API_URL}/api/auth/me`, { credentials: "include" })
      .then((r) => {
        if (alive && r.ok) router.replace(safeNext());
      })
      .catch(() => {
        /* sem sessão — deixa o formulário à vista */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-[440px]">
          {/* Brand compacta + voltar pra loja */}
          <div className="mb-8 flex items-center justify-between">
            <BrandCompact />
            <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft size={15} /> Voltar para a loja
            </Link>
          </div>

          {/* Abas de modo */}
          <LayoutGroup>
            <div role="tablist" aria-label="Acesso à conta" className="relative mb-8 grid grid-cols-2 rounded-[var(--radius)] border border-border bg-base p-1">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={mode === t.id} onClick={() => handleModeChange(t.id)}
                  className={`relative h-10 rounded-[var(--radius)] text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${mode === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {mode === t.id && <motion.span layoutId="tab-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} className="absolute inset-0 rounded-[var(--radius)] bg-secondary ring-1 ring-border" />}
                  <span className="relative">{t.label}</span>
                </button>
              ))}
            </div>
          </LayoutGroup>

          {/* Painel do formulário */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              role="tabpanel"
              initial={{ opacity: 0, x: -direction * 40 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } }}
              exit={{ opacity: 0, x: direction * 40, transition: { duration: 0.25, ease: [0.55, 0.06, 0.68, 0.19] as const } }}
              className="space-y-5"
            >
              <motion.div variants={formContainerVariants} initial="hidden" animate="show" exit="exit">
                <motion.h1
                  className="font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight"
                  variants={fieldVariants}
                >
                  {mode === "login" ? "Entrar na sua conta" : "Criar sua conta"}
                </motion.h1>
                <motion.p
                  className="mb-6 mt-1.5 text-[15px] text-muted-foreground"
                  variants={fieldVariants}
                >
                  {mode === "login" ? "Use seu e-mail e senha." : "Preencha seus dados para começar."}
                </motion.p>

                {/* Botão Google */}
                <motion.button
                  type="button"
                  disabled={googleLoading}
                  onClick={async () => {
                    setGoogleLoading(true);
                    setGoogleError(undefined);
                    try {
                      await google();
                    } catch {
                      setGoogleError("Não foi possível abrir o acesso com Google. Tente de novo.");
                    } finally {
                      setGoogleLoading(false);
                    }
                  }}
                  className="flex h-12 w-full items-center justify-center gap-3 rounded-[var(--radius)] border border-border bg-secondary text-sm font-semibold transition-colors hover:border-[var(--border-strong)] hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-70"
                  variants={fieldVariants}
                  whileTap={{ scale: 0.99 }}
                >
                  {googleLoading ? <Loader2 size={18} className="animate-spin" /> : <GoogleIcon />} Continuar com Google
                </motion.button>
                <Banner>{googleError}</Banner>

                {/* Divider */}
                <motion.div
                  className="my-6 flex items-center gap-4 text-xs text-muted-foreground/70"
                  variants={fieldVariants}
                >
                  <span className="h-px flex-1 bg-border" />ou use seu e-mail<span className="h-px flex-1 bg-border" />
                </motion.div>

                {/* Formulários */}
                {mode === "login" ? (
                  <motion.div variants={fieldVariants}><LoginForm onLogin={login} /></motion.div>
                ) : (
                  <motion.div variants={fieldVariants}><RegisterForm onRegister={register} /></motion.div>
                )}
              </motion.div>
            </motion.div>
          </AnimatePresence>

          {/* Rodapé LGPD */}
          <p className="mt-8 flex items-center justify-center gap-1.5 border-t border-border pt-6 text-xs text-muted-foreground/70">
            <ShieldCheck size={14} /> Dados protegidos conforme a LGPD
          </p>
        </div>
      </main>
    </MotionConfig>
  );
}