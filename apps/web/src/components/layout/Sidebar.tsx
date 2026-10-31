'use client';

import type { EmailTab, UserProfile } from '@/types/api';
import { Icon } from '@/components/ui/Icons';
import { Logo } from '@/components/ui/Logo';
import { Header } from './Header';

function NavItem({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: 'clock' | 'send';
  label: string;
  count: number | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-[34px] w-full items-center gap-3 rounded-lg px-3 text-[13px] ${
        active ? 'bg-mint font-medium text-ink' : 'text-[#374151] hover:bg-soft'
      }`}
    >
      <Icon name={icon} size={15} />
      <span className="flex-1 text-left">{label}</span>
      <span className="text-[11px] font-normal text-[#6b7280]">{count ?? ''}</span>
    </button>
  );
}

export function Sidebar({
  user,
  tab,
  counts,
  onTab,
  onCompose,
  onLogout,
  onNewSender,
  onSlackDisconnect,
}: {
  user: UserProfile;
  tab: EmailTab;
  counts: Record<EmailTab, number | null>;
  onTab: (t: EmailTab) => void;
  onCompose: () => void;
  onLogout: () => void;
  onNewSender: () => void;
  onSlackDisconnect: () => void;
}) {
  return (
    <aside className="flex w-[240px] shrink-0 flex-col px-[23px] pt-7">
      <Logo />
      <div className="mt-3">
        <Header
          user={user}
          onLogout={onLogout}
          onNewSender={onNewSender}
          onSlackDisconnect={onSlackDisconnect}
        />
      </div>

      <button
        onClick={onCompose}
        className="mt-4 h-8 w-full rounded-full border border-brand bg-white text-[13px] text-brand transition-colors hover:bg-mint"
      >
        Compose
      </button>

      <p className="mb-2 mt-6 px-1 text-[10px] uppercase tracking-wider text-[#6b7280]">Core</p>
      <nav className="space-y-1">
        <NavItem
          active={tab === 'SCHEDULED'}
          icon="clock"
          label="Scheduled"
          count={counts.SCHEDULED}
          onClick={() => onTab('SCHEDULED')}
        />
        <NavItem
          active={tab === 'SENT'}
          icon="send"
          label="Sent"
          count={counts.SENT}
          onClick={() => onTab('SENT')}
        />
      </nav>
    </aside>
  );
}
