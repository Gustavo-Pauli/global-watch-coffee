"use client";
import { cn } from "@/lib/utils";
import { actionButtonVariants, textButtonClass } from "@/components/ui/action";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import * as Avatar from "radix-ui/avatar";
import * as Dialog from "@/components/ui/dialog";
import * as DropdownMenu from "@/components/ui/dropdown-menu";
import * as Tooltip from "radix-ui/tooltip";
import { ChevronsUpDown, LoaderCircle, LogOut, UserRound, X, } from "lucide-react";
import { authClient } from "@/lib/auth-client";
type AccountUser = {
    id: string;
    name: string;
    email: string;
    image?: string | null;
};
type AccountMenuProps = {
    user: AccountUser;
    compact?: boolean;
};
function UserAvatar({ user }: {
    user: AccountUser;
}) {
    const initials = (user.name.trim() || user.email)
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => Array.from(part)[0])
        .join("")
        .toLocaleUpperCase("pt-BR");
    return (<Avatar.Root className={"inline-flex size-[31px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[#2e2e31]"} aria-hidden="true" data-testid="account-avatar">
      <Avatar.Image className={"size-full object-cover"} src={user.image || undefined} alt=""/>
      <Avatar.Fallback className={"text-[12px] font-medium text-[#dddde0]"}>{initials}</Avatar.Fallback>
    </Avatar.Root>);
}
export default function AccountMenu({ user, compact = false, }: AccountMenuProps) {
    const router = useRouter();
    const { data: session, refetch } = authClient.useSession();
    const currentUser = session?.user.id === user.id ? session.user : user;
    const [menuOpen, setMenuOpen] = useState(false);
    const [hintOpen, setHintOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [name, setName] = useState(user.name);
    const [saving, setSaving] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const [profileError, setProfileError] = useState("");
    const [signOutError, setSignOutError] = useState("");
    const triggerRef = useRef<HTMLButtonElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const openingProfile = useRef(false);
    const nameId = useId();
    const emailId = useId();
    const errorId = useId();
    function openProfile() {
        setName(currentUser.name);
        setProfileError("");
        openingProfile.current = true;
        setMenuOpen(false);
        setProfileOpen(true);
    }
    async function saveProfile(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (saving)
            return;
        const updatedName = name.trim();
        if (!updatedName || updatedName.length > 100) {
            setProfileError("Informe um nome de até 100 caracteres.");
            nameRef.current?.focus();
            return;
        }
        setSaving(true);
        setProfileError("");
        try {
            const result = await authClient.updateUser({ name: updatedName });
            if (result.error) {
                setProfileError(result.error.status === 401
                    ? "Sua sessão expirou. Entre novamente para salvar as alterações."
                    : "Não foi possível salvar o nome. Tente novamente.");
                return;
            }
            await refetch();
            setProfileOpen(false);
        }
        catch {
            setProfileError("Não foi possível salvar o nome. Verifique sua conexão e tente novamente.");
        }
        finally {
            setSaving(false);
        }
    }
    async function signOut() {
        if (signingOut)
            return;
        setSigningOut(true);
        setSignOutError("");
        try {
            const result = await authClient.signOut();
            if (result.error) {
                setSignOutError("Não foi possível sair da conta. Tente novamente.");
                return;
            }
            setMenuOpen(false);
            router.replace("/analyses");
            router.refresh();
        }
        catch {
            setSignOutError("Não foi possível sair da conta. Verifique sua conexão e tente novamente.");
        }
        finally {
            setSigningOut(false);
        }
    }
    return (<>
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip.Root open={compact && !menuOpen && hintOpen} onOpenChange={setHintOpen}>
          <Tooltip.Trigger asChild>
            <DropdownMenu.Trigger asChild>
              <Button variant="native" ref={triggerRef} type="button" className={cn("grid w-full items-center justify-start overflow-hidden rounded-[6px] border-0 bg-transparent text-left hover:bg-accent transition-[grid-template-columns,gap,height] duration-200 motion-reduce:transition-none", compact ? "size-[44px] min-h-[44px] grid-cols-[31px_minmax(0,0fr)_0px] grid-rows-[minmax(0,1fr)] justify-center gap-0 p-[5.5px]" : "h-[52px] min-h-[52px] grid-cols-[31px_minmax(0,1fr)_15px] gap-[10px] p-[7px]")} aria-label="Menu da conta" data-testid="account-menu-trigger">
                <UserAvatar user={currentUser}/>
                <span className={cn("flex min-w-0 flex-1 flex-col self-center justify-center gap-[2px] leading-[16px]", "transition-[opacity,translate] duration-200 motion-reduce:transition-none", compact && "-translate-x-[6px] opacity-0")} aria-hidden={compact || undefined} data-testid="account-copy">
                  <strong className={"truncate text-[12px] font-medium leading-[16px]"}>{currentUser.name || currentUser.email}</strong>
                  <span className={"truncate text-[12px] leading-[16px] text-[var(--subtle)]"}>{currentUser.email}</span>
                </span>
                <ChevronsUpDown className={cn("text-[var(--subtle)]", "transition-[opacity,translate] duration-200 motion-reduce:transition-none", compact && "-translate-x-[6px] opacity-0")} size={15} aria-hidden="true"/>
              </Button>
            </DropdownMenu.Trigger>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className={"z-[3600] max-w-[240px] rounded-[5px] border border-solid border-border bg-[#242426] px-[10px] py-[7px] text-[12px] leading-[1.4] text-foreground shadow-[0_3px_12px_#0003]"} side="right" sideOffset={10} collisionPadding={10}>
              Menu da conta
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <DropdownMenu.Portal>
          <DropdownMenu.Content  side={compact ? "right" : "top"} align="start" sideOffset={8} collisionPadding={12} onCloseAutoFocus={(event) => {
            if (openingProfile.current) {
                event.preventDefault();
                openingProfile.current = false;
            }
        }}>
            <DropdownMenu.Label >
              {currentUser.email}
            </DropdownMenu.Label>
            <DropdownMenu.Separator />
            <DropdownMenu.Item  onSelect={openProfile} disabled={signingOut}>
              <UserRound size={16} aria-hidden="true"/> Meu perfil
            </DropdownMenu.Item>
            <DropdownMenu.Item  disabled={signingOut} onSelect={(event) => {
            event.preventDefault();
            void signOut();
        }}>
              {signingOut ? (<LoaderCircle size={16} className={"animate-spin"} aria-hidden="true"/>) : (<LogOut size={16} aria-hidden="true"/>)}
              {signingOut ? "Saindo…" : "Sair da conta"}
            </DropdownMenu.Item>
            {signOutError && (<DropdownMenu.Label className={"mt-[10px] text-[12px] leading-[1.6] text-[var(--error)]"} role="alert">
                {signOutError}
              </DropdownMenu.Label>)}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog.Root open={profileOpen} onOpenChange={(open) => {
            if (!saving)
                setProfileOpen(open);
        }}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content className={"w-[min(440px,calc(100vw-32px))]"} onOpenAutoFocus={(event) => {
            event.preventDefault();
            nameRef.current?.focus();
        }} onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
        }}>
            <div className={"relative mb-[24px] pr-[26px]"}>
              <Dialog.Title >Meu perfil</Dialog.Title>
              <Dialog.Description >
                Conta conectada com Google
              </Dialog.Description>
              <Dialog.Close asChild>
                <IconButton  type="button" className={"absolute -top-[6px] -right-[9px]"} aria-label="Fechar perfil" disabled={saving}>
                  <X size={18} aria-hidden="true"/>
                </IconButton>
              </Dialog.Close>
            </div>
            <form onSubmit={saveProfile} aria-busy={saving}>
              <div className={"mb-[19px] min-w-0"}>
                <label className={"mb-[9px] block text-[13px] font-medium"} htmlFor={nameId}>
                  Nome
                </label>
                <Input ref={nameRef} id={nameId} className={"min-h-[38px] w-full rounded-[5px] border border-solid border-[#3b3b3e] bg-[#19191b] px-[10px] py-[9px] text-[13px] read-only:text-muted-foreground pointer-coarse:text-[16px] file:mr-[9px] file:cursor-pointer file:rounded-[3px] file:border-0 file:border-r file:border-solid file:border-border file:bg-secondary file:px-[8px] file:py-[5px] file:text-[12px] file:text-foreground"} name="name" autoComplete="name" value={name} onChange={(event) => {
            setName(event.target.value);
            setProfileError("");
        }} required maxLength={100} disabled={saving} aria-describedby={profileError ? errorId : undefined}/>
              </div>
              <div className={"mb-[19px] min-w-0"}>
                <label className={"mb-[9px] block text-[13px] font-medium"} htmlFor={emailId}>
                  Email
                </label>
                <Input id={emailId} className={"min-h-[38px] w-full rounded-[5px] border border-solid border-[#3b3b3e] bg-[#19191b] px-[10px] py-[9px] text-[13px] read-only:text-muted-foreground pointer-coarse:text-[16px] file:mr-[9px] file:cursor-pointer file:rounded-[3px] file:border-0 file:border-r file:border-solid file:border-border file:bg-secondary file:px-[8px] file:py-[5px] file:text-[12px] file:text-foreground"} type="email" value={currentUser.email} readOnly/>
              </div>
              {profileError && (<p id={errorId} className={"mt-[10px] text-[12px] leading-[1.6] text-[var(--error)]"} role="alert">
                  {profileError}
                </p>)}
              <div className={"mt-[28px] flex items-center justify-end gap-[8px] max-[760px]:gap-[7px]"}>
                <Dialog.Close asChild>
                  <Button variant="outline" type="button" className={actionButtonVariants({ appearance: "secondary" })} disabled={saving}>
                    Cancelar
                  </Button>
                </Dialog.Close>
                <Button variant="default" type="submit" className={actionButtonVariants({ appearance: "primary" })} disabled={saving || name.trim() === currentUser.name.trim()}>
                  {saving && (<LoaderCircle size={16} className={"animate-spin"} aria-hidden="true"/>)}
                  {saving ? "Salvando…" : "Salvar alterações"}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>);
}
