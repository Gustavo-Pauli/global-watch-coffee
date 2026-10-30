"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import * as Avatar from "radix-ui/avatar";
import * as Dialog from "radix-ui/dialog";
import * as DropdownMenu from "radix-ui/dropdown-menu";
import * as Tooltip from "radix-ui/tooltip";
import {
  ChevronsUpDown,
  LoaderCircle,
  LogOut,
  UserRound,
  X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";

type AccountUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

type AccountMenuProps = { user: AccountUser; compact?: boolean };

function UserAvatar({ user }: { user: AccountUser }) {
  const initials = (user.name.trim() || user.email)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toLocaleUpperCase("pt-BR");

  return (
    <Avatar.Root className="avatar" aria-hidden="true">
      <Avatar.Image
        className="avatar-image"
        src={user.image || undefined}
        alt=""
      />
      <Avatar.Fallback className="avatar-fallback">{initials}</Avatar.Fallback>
    </Avatar.Root>
  );
}

export default function AccountMenu({
  user,
  compact = false,
}: AccountMenuProps) {
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
    if (saving) return;
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
        setProfileError(
          result.error.status === 401
            ? "Sua sessão expirou. Entre novamente para salvar as alterações."
            : "Não foi possível salvar o nome. Tente novamente.",
        );
        return;
      }
      await refetch();
      setProfileOpen(false);
    } catch {
      setProfileError(
        "Não foi possível salvar o nome. Verifique sua conexão e tente novamente.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    if (signingOut) return;
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
    } catch {
      setSignOutError(
        "Não foi possível sair da conta. Verifique sua conexão e tente novamente.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip.Root
          open={compact && !menuOpen && hintOpen}
          onOpenChange={setHintOpen}
        >
          <Tooltip.Trigger asChild>
            <DropdownMenu.Trigger asChild>
              <button
                ref={triggerRef}
                type="button"
                className={`account-trigger${compact ? " is-compact" : ""}`}
                aria-label="Menu da conta"
                data-testid="account-menu-trigger"
              >
                <UserAvatar user={currentUser} />
                <span className="account-copy" aria-hidden={compact || undefined}>
                  <strong>{currentUser.name || currentUser.email}</strong>
                  <span>{currentUser.email}</span>
                </span>
                <ChevronsUpDown
                  className="account-chevron"
                  size={15}
                  aria-hidden="true"
                />
              </button>
            </DropdownMenu.Trigger>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="navigation-tooltip"
              side="right"
              sideOffset={10}
              collisionPadding={10}
            >
              Menu da conta
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="menu-content"
            side={compact ? "right" : "top"}
            align="start"
            sideOffset={8}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              if (openingProfile.current) {
                event.preventDefault();
                openingProfile.current = false;
              }
            }}
          >
            <DropdownMenu.Label className="menu-label">
              {currentUser.email}
            </DropdownMenu.Label>
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item
              className="menu-item"
              onSelect={openProfile}
              disabled={signingOut}
            >
              <UserRound size={16} aria-hidden="true" /> Meu perfil
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="menu-item"
              disabled={signingOut}
              onSelect={(event) => {
                event.preventDefault();
                void signOut();
              }}
            >
              {signingOut ? (
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
              ) : (
                <LogOut size={16} aria-hidden="true" />
              )}
              {signingOut ? "Saindo…" : "Sair da conta"}
            </DropdownMenu.Item>
            {signOutError && (
              <DropdownMenu.Label className="form-error" role="alert">
                {signOutError}
              </DropdownMenu.Label>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog.Root
        open={profileOpen}
        onOpenChange={(open) => {
          if (!saving) setProfileOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content profile-dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              nameRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            <div className="dialog-header">
              <Dialog.Title className="dialog-title">Meu perfil</Dialog.Title>
              <Dialog.Description className="dialog-description">
                Conta conectada com Google
              </Dialog.Description>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="icon-button dialog-close"
                  aria-label="Fechar perfil"
                  disabled={saving}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <form onSubmit={saveProfile} aria-busy={saving}>
              <div className="field">
                <label className="field-label" htmlFor={nameId}>
                  Nome
                </label>
                <input
                  ref={nameRef}
                  id={nameId}
                  className="text-input"
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setProfileError("");
                  }}
                  required
                  maxLength={100}
                  disabled={saving}
                  aria-describedby={profileError ? errorId : undefined}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={emailId}>
                  Email
                </label>
                <input
                  id={emailId}
                  className="text-input"
                  type="email"
                  value={currentUser.email}
                  readOnly
                />
              </div>
              {profileError && (
                <p id={errorId} className="form-error" role="alert">
                  {profileError}
                </p>
              )}
              <div className="dialog-footer">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={saving || name.trim() === currentUser.name.trim()}
                >
                  {saving && (
                    <LoaderCircle
                      size={16}
                      className="spin"
                      aria-hidden="true"
                    />
                  )}
                  {saving ? "Salvando…" : "Salvar alterações"}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
