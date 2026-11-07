export default function UsersPage() {
  return (
    <main className="px-6 py-24">
      <header className="mb-12 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
          Gestão de Usuários
        </h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
          Usuários administradores e clientes
        </p>
      </header>

      <div className="border border-[#111] bg-[#0a0a0a] p-12 text-center">
        <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#8bcf16] mb-6 inline-block">
          —
        </div>
        <h2 className="font-display font-black text-3xl uppercase leading-none tracking-tighter text-white mb-4">
          Sem endpoint de admin dedicado
        </h2>
        <p className="text-[#666] font-mono text-xs max-w-md mx-auto mb-8">
          O backend não expõe rotas de CRUD de usuários no painel admin. A autenticação de operadores é feita via /api/auth/admin-login e o seed cria o usuário admin padrão.
        </p>
      </div>
    </main>
  );
}
