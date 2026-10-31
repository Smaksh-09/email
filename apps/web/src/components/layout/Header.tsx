'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/api';
import { initials } from '@/lib/format';
import type { UserProfile } from '@/types/api';
import { Icon } from '@/components/ui/Icons';

function Avatar({ user, size = 28 }: { user: UserProfile; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (user.avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt={user.name}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-medium text-white"
    >
      {initials(user.name)}
    </span>
  );
}

export { Avatar };

/** User card in the sidebar; opens the account menu (senders, Slack, queue monitor, logout). */
export function Header({
  user,
  onLogout,
  onNewSender,
  onSlackDisconnect,
}: {
  user: UserProfile;
  onLogout: () => void;
  onNewSender: () => void;
  onSlackDisconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const itemClass =
    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-soft';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl bg-soft px-3 py-[10px] text-left"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar user={user} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-4 text-ink">{user.name}</span>
          <span className="block truncate text-[10px] leading-4 text-[#6b7280]">{user.email}</span>
        </span>
        <Icon name="chevronDown" size={14} className="text-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 w-[280px] rounded-xl border border-line bg-white p-2 shadow-xl"
        >
          <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted">Senders</p>
          <ul className="max-h-40 overflow-auto">
            {user.senders.map((s) => (
              <li key={s.id} className="px-3 py-1.5">
                <p className="truncate text-[13px] text-ink">{s.name}</p>
                <p className="truncate text-[11px] text-muted">
                  {s.email} · {s.hourlyLimit}/hr
                </p>
              </li>
            ))}
          </ul>
          <button className={`${itemClass} text-brand`} onClick={() => { setOpen(false); onNewSender(); }}>
            <Icon name="plus" size={14} /> New Sender
          </button>

          <div className="my-2 h-px bg-line" />

          {user.slackConnected ? (
            <div className="px-3 py-1">
              <p className="flex items-center gap-2 text-[13px]">
                <span className="h-2 w-2 rounded-full bg-brand" />
                Connected: {user.slackTeamName ?? 'Slack'}
              </p>
              <button
                onClick={() => { setOpen(false); onSlackDisconnect(); }}
                className="mt-1 text-[12px] text-[#b91c1c] hover:underline"
              >
                Disconnect Slack
              </button>
            </div>
          ) : (
            <a className={itemClass} href={`${API_URL}/api/auth/slack`}>
              <Icon name="hash" size={14} /> Connect Slack
            </a>
          )}

          <a className={itemClass} href={`${API_URL}/admin/queues`} target="_blank" rel="noopener noreferrer">
            <Icon name="layers" size={14} /> Queue Monitor
            <Icon name="external" size={12} className="ml-auto text-muted" />
          </a>

          <div className="my-2 h-px bg-line" />

          <button className={itemClass} onClick={onLogout}>
            <Icon name="logout" size={14} /> Logout
          </button>
        </div>
      )}
    </div>
  );
}
