import "./globals.css";
import Image from "next/image";
import Link from "next/link";
import { AdminNav } from "./AdminNav";

export const metadata = {
  title: "Airsoft Americana - Painel Administrativo",
  description: "Painel administrativo da loja Airsoft Americana",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-br">
      <body className="bg-[#000] text-white font-sans antialiased">
        <div className="admin-shell">
          <aside className="admin-side" id="admin-side">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <Image
                src="/logo.png"
                alt="Airsoft Americana"
                width={40}
                height={40}
                className="h-10 w-10 object-contain"
              />
              <span className="admin-brand">
                AIRSOFT <span className="text-[#8bcf16]">AMERICANA</span>
              </span>
            </Link>
            <AdminNav />
          </aside>
          <div className="admin-main">{children}</div>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const toggle = document.querySelector('.admin-menu-toggle');
                const side = document.getElementById('admin-side');
                const overlay = document.getElementById('admin-overlay');
                if (toggle && side && overlay) {
                  toggle.addEventListener('click', function() {
                    side.classList.toggle('is-open');
                    overlay.classList.toggle('is-open');
                  });
                  overlay.addEventListener('click', function() {
                    side.classList.remove('is-open');
                    overlay.classList.remove('is-open');
                  });
                }
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}