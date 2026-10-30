"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "radix-ui/dialog";
import * as Tooltip from "radix-ui/tooltip";
import {
  ChevronRight,
  FolderClosed,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/client-api";
import AccountMenu from "./AccountMenu";
import Brand from "./Brand";
import NewAnalysisDialog from "./NewAnalysisDialog";

const PlatformContext = createContext({
  newAnalysis: () => {},
  openNavigation: () => {},
  sidebarCollapsed: false,
  toggleSidebar: () => {},
});
export function usePlatform() {
  return useContext(PlatformContext);
}

export function NavigationToggle() {
  const { openNavigation } = usePlatform();
  return (
    <button
      className="icon-button mobile-navigation"
      aria-label="Abrir navegação"
      onClick={openNavigation}
    >
      <Menu size={19} />
    </button>
  );
}

function NavigationHint({
  enabled = true,
  label,
  children,
}: {
  enabled?: boolean;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Root open={enabled && open} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="navigation-tooltip"
          side="right"
          sideOffset={10}
          collisionPadding={10}
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.pathname,
      });
      if (result.error)
        throw new Error(
          result.error.message || "Não foi possível iniciar o login.",
        );
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-brand">
        <Brand />
      </div>
      <section className="login-form" aria-labelledby="login-title">
        <h1 id="login-title">Entrar na sua conta</h1>
        <p>Acesse suas análises de imagens de satélite.</p>
        <button
          className="button google-button"
          disabled={busy}
          onClick={() => void signIn()}
        >
          {busy ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.36Z"
              />
              <path
                fill="#34A853"
                d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.58-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#FBBC05"
                d="M6.42 13.91a6 6 0 0 1 0-3.82V7.5H3.07a10 10 0 0 0 0 9l3.35-2.59Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.97c1.47 0 2.8.51 3.84 1.51l2.88-2.88A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.5l3.35 2.59C7.2 7.73 9.4 5.97 12 5.97Z"
              />
            </svg>
          )}
          {busy ? "Conectando…" : "Continuar com Google"}
          <ChevronRight size={16} />
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}

export default function PlatformShell({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  if (isPending && !session)
    return (
      <main className="session-loading" role="status">
        <Brand />
        <LoaderCircle size={20} className="spin" />
        <span>Carregando sua conta…</span>
      </main>
    );
  if (!session?.user) return <Login />;
  return (
    <AuthenticatedPlatform key={session.user.id} user={session.user}>
      {children}
    </AuthenticatedPlatform>
  );
}

type PlatformUser = NonNullable<
  ReturnType<typeof authClient.useSession>["data"]
>["user"];

function AuthenticatedPlatform({
  children,
  user,
}: {
  children: ReactNode;
  user: PlatformUser;
}) {
  const pathname = usePathname();
  const workspace = /^\/analyses\/[^/]+/.test(pathname);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarReady, setSidebarReady] = useState(false);
  useLayoutEffect(() => {
    try {
      setSidebarCollapsed(
        localStorage.getItem("global-watch:sidebar:v1") === "collapsed",
      );
    } catch {
      /* Optional browser preference. */
    }
    // Restore the layout before paint; animate subsequent user gestures only.
    let motionFrame = 0;
    const restoreFrame = requestAnimationFrame(() => {
      motionFrame = requestAnimationFrame(() => setSidebarReady(true));
    });
    return () => {
      cancelAnimationFrame(restoreFrame);
      cancelAnimationFrame(motionFrame);
    };
  }, []);
  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(
          "global-watch:sidebar:v1",
          next ? "collapsed" : "expanded",
        );
      } catch {
        /* Optional browser preference. */
      }
      return next;
    });
  }

  function navigation(compact: boolean, mobile = false) {
    const toggleLabel = compact ? "Expandir navegação" : "Recolher navegação";
    return (
      <>
        <div className="sidebar-heading">
          <Link
            className="brand-link"
            href="/analyses"
            aria-label="Global Watch — Análises"
            aria-hidden={compact || undefined}
            tabIndex={compact ? -1 : undefined}
            onClick={() => setNavigationOpen(false)}
          >
            <Brand />
          </Link>
          {!mobile && (
            <NavigationHint label={toggleLabel}>
              <button
                className="icon-button sidebar-toggle"
                aria-label={toggleLabel}
                aria-expanded={!compact}
                aria-controls="platform-navigation"
                onClick={toggleSidebar}
              >
                {compact ? (
                  <PanelLeftOpen size={18} aria-hidden="true" />
                ) : (
                  <PanelLeftClose size={18} aria-hidden="true" />
                )}
              </button>
            </NavigationHint>
          )}
        </div>
        <nav
          className="primary-navigation"
          id={mobile ? undefined : "platform-navigation"}
          aria-label={mobile ? "Navegação móvel" : "Navegação principal"}
        >
          <NavigationHint enabled={compact} label="Análises">
            <Link
              className="navigation-link is-active"
              aria-label="Análises"
              aria-current={workspace ? undefined : "page"}
              href="/analyses"
              onClick={() => setNavigationOpen(false)}
            >
              <FolderClosed size={18} aria-hidden="true" />
              <span
                className="navigation-label"
                aria-hidden={compact || undefined}
              >
                Análises
              </span>
            </Link>
          </NavigationHint>
        </nav>
        <div className="navigation-account">
          <AccountMenu user={user} compact={compact} />
        </div>
      </>
    );
  }

  return (
    <PlatformContext.Provider
      value={{
        newAnalysis: () => setNewOpen(true),
        openNavigation: () => setNavigationOpen(true),
        sidebarCollapsed,
        toggleSidebar,
      }}
    >
      <Tooltip.Provider delayDuration={300} skipDelayDuration={120}>
        <div
          className={`platform${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
          data-sidebar-ready={sidebarReady || undefined}
        >
          <a className="skip-link" href="#main-content">
            Ir para o conteúdo
          </a>
          <aside
            className={`platform-sidebar${sidebarCollapsed ? " is-rail" : ""}`}
          >
            {navigation(sidebarCollapsed)}
          </aside>
          <div className="platform-content">{children}</div>
          <Dialog.Root open={navigationOpen} onOpenChange={setNavigationOpen}>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content
                className="navigation-sheet"
                aria-describedby={undefined}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  document
                    .querySelector<HTMLButtonElement>(".mobile-navigation")
                    ?.focus();
                }}
              >
                <Dialog.Title className="sr-only">Navegação</Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    className="icon-button navigation-close"
                    aria-label="Fechar navegação"
                  >
                    <X size={18} />
                  </button>
                </Dialog.Close>
                {navigation(false, true)}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <NewAnalysisDialog open={newOpen} onOpenChange={setNewOpen} />
        </div>
      </Tooltip.Provider>
    </PlatformContext.Provider>
  );
}
