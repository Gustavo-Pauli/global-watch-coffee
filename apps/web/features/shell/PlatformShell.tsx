"use client";
import { cn } from "@/lib/utils";
import { actionButtonVariants, textButtonClass } from "@/components/ui/action";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { createContext, useContext, useLayoutEffect, useState, type ReactNode, } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@/components/ui/dialog";
import * as Tooltip from "radix-ui/tooltip";
import { ChevronRight, FolderClosed, LoaderCircle, Menu, PanelLeftClose, PanelLeftOpen, X, } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/client-api";
import AccountMenu from "./AccountMenu";
import Brand from "./Brand";
import NewAnalysisDialog from "@/features/analyses/NewAnalysisDialog";
const PlatformContext = createContext({
    newAnalysis: () => { },
    openNavigation: () => { },
    sidebarCollapsed: false,
    toggleSidebar: () => { },
});
export function usePlatform() {
    return useContext(PlatformContext);
}
export function NavigationToggle() {
    const { openNavigation } = usePlatform();
    return (<IconButton className={"hidden max-[760px]:inline-flex"} aria-label="Abrir navegação" onClick={openNavigation} hitArea="navigation">
      <Menu size={19}/>
    </IconButton>);
}
function NavigationHint({ enabled = true, label, children, }: {
    enabled?: boolean;
    label: string;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    return (<Tooltip.Root open={enabled && open} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={"z-[3600] max-w-[240px] rounded-[5px] border border-solid border-border bg-[#242426] px-[10px] py-[7px] text-[12px] leading-[1.4] text-foreground shadow-[0_3px_12px_#0003]"} side="right" sideOffset={10} collisionPadding={10}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>);
}
function Login() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function signIn() {
        if (busy)
            return;
        setError("");
        setBusy(true);
        try {
            const result = await authClient.signIn.social({
                provider: "google",
                callbackURL: window.location.pathname,
            });
            if (result.error)
                throw new Error(result.error.message || "Não foi possível iniciar o login.");
        }
        catch (caught) {
            setError(errorMessage(caught));
            setBusy(false);
        }
    }
    return (<main className={"flex min-h-dvh flex-col items-center justify-center bg-[#171718] p-[32px]"}>
      <div className={"mb-[45px]"}>
        <Brand />
      </div>
      <section className={"w-[min(344px,100%)] text-center"} aria-labelledby="login-title">
        <h1 id="login-title" className={"text-[22px] font-medium tracking-[-0.65px]"}>Entrar na sua conta</h1>
        <p className={"mt-[12px] mb-[29px] text-[13px] leading-[1.7] text-muted-foreground"}>Acesse suas análises de imagens de satélite.</p>
        <Button className={cn(actionButtonVariants({ appearance: "primary" }), "min-h-[42px] w-full border-[#e9e9eb] bg-[#e9e9eb] text-[#222225]")} disabled={busy} onClick={() => void signIn()} variant="native">
          {busy ? (<LoaderCircle size={18} className={"animate-spin"}/>) : (<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.36Z"/>
              <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.58-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/>
              <path fill="#FBBC05" d="M6.42 13.91a6 6 0 0 1 0-3.82V7.5H3.07a10 10 0 0 0 0 9l3.35-2.59Z"/>
              <path fill="#EA4335" d="M12 5.97c1.47 0 2.8.51 3.84 1.51l2.88-2.88A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.5l3.35 2.59C7.2 7.73 9.4 5.97 12 5.97Z"/>
            </svg>)}
          {busy ? "Conectando…" : "Continuar com Google"}
          <ChevronRight size={16}/>
        </Button>
        {error && (<p className={cn("mt-[10px] text-[12px] leading-[1.6] text-[var(--error)]", "mt-[12px] mb-[29px] text-[13px] leading-[1.7] text-muted-foreground")} role="alert">
            {error}
          </p>)}
      </section>
    </main>);
}
export default function PlatformShell({ children }: {
    children: ReactNode;
}) {
    const { data: session, isPending } = authClient.useSession();
    if (isPending && !session)
        return (<main className={"flex h-dvh flex-col items-center justify-center gap-[15px] text-[13px] text-muted-foreground"} role="status">
        <Brand />
        <LoaderCircle size={20} className={"animate-spin"}/>
        <span>Carregando sua conta…</span>
      </main>);
    if (!session?.user)
        return <Login />;
    return (<AuthenticatedPlatform key={session.user.id} user={session.user}>
      {children}
    </AuthenticatedPlatform>);
}
type PlatformUser = NonNullable<ReturnType<typeof authClient.useSession>["data"]>["user"];
function AuthenticatedPlatform({ children, user, }: {
    children: ReactNode;
    user: PlatformUser;
}) {
    const pathname = usePathname();
    const workspace = /^\/analyses\/[^/]+/.test(pathname);
    const [navigationOpen, setNavigationOpen] = useState(false);
    const [newOpen, setNewOpen] = useState(false);
    const [collectionCollapsed, setCollectionCollapsed] = useState(false);
    const [workspaceSidebar, setWorkspaceSidebar] = useState({
        pathname,
        collapsed: true,
    });
    const sidebarCollapsed = workspace
        ? workspaceSidebar.pathname !== pathname || workspaceSidebar.collapsed
        : collectionCollapsed;
    const [sidebarReady, setSidebarReady] = useState(false);
    useLayoutEffect(() => {
        try {
            setCollectionCollapsed(localStorage.getItem("global-watch:sidebar:v1") === "collapsed");
        }
        catch {
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
    useLayoutEffect(() => {
        // A manual expansion belongs to this visit, not the next analysis.
        setWorkspaceSidebar((current) => current.pathname === pathname ? current : { pathname, collapsed: true });
    }, [pathname]);
    function toggleSidebar() {
        if (workspace) {
            setWorkspaceSidebar({ pathname, collapsed: !sidebarCollapsed });
            return;
        }
        const next = !collectionCollapsed;
        setCollectionCollapsed(next);
        try {
            localStorage.setItem("global-watch:sidebar:v1", next ? "collapsed" : "expanded");
        }
        catch {
            /* Optional browser preference. */
        }
    }
    function navigation(compact: boolean, mobile = false) {
        const toggleLabel = compact ? "Expandir navegação" : "Recolher navegação";
        return (<>
        <div className={cn("relative shrink-0", mobile ? "h-[56px] min-h-[56px]" : "h-[48px] min-h-[48px]")}>
          <Link className={cn("absolute inset-y-0 left-[14px] right-[51px] flex items-center overflow-hidden whitespace-nowrap border-0 p-0 transition-[opacity,translate,visibility] duration-200 motion-reduce:transition-none", compact && "invisible -translate-x-[8px] opacity-0")} href="/analyses" aria-label="Global Watch — Análises" aria-hidden={compact || undefined} tabIndex={compact ? -1 : undefined} onClick={() => setNavigationOpen(false)}>
            <Brand />
          </Link>
          {!mobile && (<NavigationHint label={toggleLabel}>
              <IconButton className={cn("absolute top-[8px] right-[10px] transition-[right] duration-200 motion-reduce:transition-none pointer-coarse:top-[2px]", compact ? "right-[15px] pointer-coarse:right-[9px]" : "pointer-coarse:right-[4px]")} aria-label={toggleLabel} aria-expanded={!compact} aria-controls="platform-navigation" onClick={toggleSidebar} hitArea="sidebar">
                {compact ? (<PanelLeftOpen size={18} aria-hidden="true"/>) : (<PanelLeftClose size={18} aria-hidden="true"/>)}
              </IconButton>
            </NavigationHint>)}
        </div>
        <nav className={cn("flex flex-col gap-[7px]", mobile ? "px-[12px] pb-[9px] pt-[14px]" : "px-[10px] py-[14px]")} id={mobile ? undefined : "platform-navigation"} aria-label={mobile ? "Navegação móvel" : "Navegação principal"}>
          <NavigationHint enabled={compact} label="Análises">
            <Link className={cn("items-center rounded-[5px] border-0 bg-[#262628] text-[13px] font-medium text-foreground hover:bg-[#252527]", mobile ? "flex min-h-[37px] px-[11px] py-[10px] pointer-coarse:min-h-[42px]" : "grid h-[38px] min-h-[38px] grid-cols-[18px_minmax(0,1fr)] justify-start overflow-hidden px-[13px] py-[9px] transition-[gap] duration-200 pointer-coarse:h-[44px] pointer-coarse:min-h-[44px] motion-reduce:transition-none", compact ? "gap-0" : "gap-[10px]")} aria-label="Análises" aria-current={workspace ? undefined : "page"} href="/analyses" onClick={() => setNavigationOpen(false)}>
              <FolderClosed size={18} aria-hidden="true"/>
              <span className={cn("overflow-hidden whitespace-nowrap transition-[opacity,translate] duration-200 motion-reduce:transition-none", compact && "-translate-x-[6px] opacity-0")} aria-hidden={compact || undefined}>
                Análises
              </span>
            </Link>
          </NavigationHint>
        </nav>
        <div className={cn("mt-auto", mobile ? "p-[10px]" : compact ? "px-[9px] py-[8px]" : "p-[8px]")}>
          <AccountMenu user={user} compact={compact}/>
        </div>
      </>);
    }
    return (<PlatformContext.Provider value={{
            newAnalysis: () => setNewOpen(true),
            openNavigation: () => setNavigationOpen(true),
            sidebarCollapsed,
            toggleSidebar,
        }}>
      <Tooltip.Provider delayDuration={300} skipDelayDuration={120}>
        <div className={cn("grid h-dvh overflow-hidden transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none max-[760px]:grid-cols-[minmax(0,1fr)] max-[760px]:transition-none", sidebarCollapsed ? "min-[761px]:grid-cols-[64px_minmax(0,1fr)]" : "min-[761px]:grid-cols-[224px_minmax(0,1fr)]", !sidebarReady && "!transition-none [&_*]:!transition-none")} data-sidebar-ready={sidebarReady || undefined} data-testid="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
          <a className={"fixed -top-[100px] left-[12px] z-[5000] rounded-[5px] bg-foreground p-[12px] text-background focus:top-[12px]"} href="#main-content">
            Ir para o conteúdo
          </a>
          <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-solid border-[var(--line-soft)] bg-[#141415] max-[760px]:hidden" data-testid="app-sidebar">
            {navigation(sidebarCollapsed)}
          </aside>
          <div className={"flex min-h-0 min-w-0 flex-col"} data-testid="app-main">{children}</div>
          <Dialog.Root open={navigationOpen} onOpenChange={setNavigationOpen}>
            <Dialog.Portal>
              <Dialog.Overlay />
              <Dialog.Content  aria-describedby={undefined} onCloseAutoFocus={(event) => {
            event.preventDefault();
            document
                .querySelector<HTMLButtonElement>('[aria-label="Abrir navegação"]')
                ?.focus();
        }} appearance="sheet">
                <Dialog.Title className={"sr-only"}>Navegação</Dialog.Title>
                <Dialog.Close asChild>
                  <IconButton className={"absolute top-[13px] right-[10px]"} aria-label="Fechar navegação">
                    <X size={18}/>
                  </IconButton>
                </Dialog.Close>
                {navigation(false, true)}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <NewAnalysisDialog open={newOpen} onOpenChange={setNewOpen}/>
        </div>
      </Tooltip.Provider>
    </PlatformContext.Provider>);
}
