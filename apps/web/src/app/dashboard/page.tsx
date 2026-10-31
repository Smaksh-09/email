'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, tokenStore } from '@/lib/api';
import type { EmailJob, EmailStatus, EmailTab, UserProfile } from '@/types/api';
import { Sidebar } from '@/components/layout/Sidebar';
import { EmailTable } from '@/components/emails/EmailTable';
import { ComposeModal } from '@/components/emails/ComposeModal';
import { EmailDetailModal } from '@/components/emails/EmailDetailModal';
import { SenderModal } from '@/components/senders/SenderModal';
import { Icon } from '@/components/ui/Icons';
import { useToast } from '@/components/ui/Toast';

const POLL_MS = 5000;

const FILTERS: Record<EmailTab, { label: string; value: EmailStatus | 'ALL' }[]> = {
  SCHEDULED: [
    { label: 'All', value: 'ALL' },
    { label: 'Scheduled', value: 'SCHEDULED' },
    { label: 'Processing', value: 'PROCESSING' },
    { label: 'Rate limited', value: 'RATE_LIMITED' },
  ],
  SENT: [
    { label: 'All', value: 'ALL' },
    { label: 'Sent', value: 'SENT' },
    { label: 'Failed', value: 'FAILED' },
  ],
};

export default function DashboardPage() {
  const router = useRouter();
  const toast = useToast();

  const [user, setUser] = useState<UserProfile | null>(null);
  const [tab, setTab] = useState<EmailTab>('SCHEDULED');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [counts, setCounts] = useState<Record<EmailTab, number | null>>({ SCHEDULED: null, SENT: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<EmailStatus | 'ALL'>('ALL');
  const [filterOpen, setFilterOpen] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);
  const [senderOpen, setSenderOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const requestId = useRef(0);
  const filterRef = useRef<HTMLDivElement>(null);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        tokenStore.clear();
        router.replace('/login');
        return true;
      }
      return false;
    },
    [router],
  );

  // 1. Capture ?token=, handle ?slack=, then load the profile.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const slack = params.get('slack');

    if (token) tokenStore.set(token);
    if (token || slack) router.replace('/dashboard');
    if (slack === 'connected') toast('Slack connected successfully', 'success');
    if (slack === 'error') toast('Slack connection failed. Please try again.', 'error');

    api
      .me()
      .then(setUser)
      .catch((err) => {
        if (!handleAuthError(err)) toast(err.message, 'error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Debounce the search box (300ms).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // 3. Fetch the active list (+ sidebar counts).
  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const id = ++requestId.current;
      if (!opts.silent) setLoading(true);
      try {
        const q = debounced.trim();
        if (q) {
          const list = await api.listEmails(tab, q);
          if (id !== requestId.current) return;
          setEmails(list);
          // Keep counts fresh without applying the search to them.
          const [s, d] = await Promise.all([api.listEmails('SCHEDULED'), api.listEmails('SENT')]);
          if (id === requestId.current) setCounts({ SCHEDULED: s.length, SENT: d.length });
        } else {
          const [s, d] = await Promise.all([api.listEmails('SCHEDULED'), api.listEmails('SENT')]);
          if (id !== requestId.current) return;
          setCounts({ SCHEDULED: s.length, SENT: d.length });
          setEmails(tab === 'SCHEDULED' ? s : d);
        }
      } catch (err) {
        if (id !== requestId.current) return;
        if (!handleAuthError(err) && !opts.silent) {
          toast(err instanceof Error ? err.message : 'Failed to load emails', 'error');
          setEmails([]);
        }
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, debounced, handleAuthError],
  );

  useEffect(() => {
    if (!user) return;
    load();
    const timer = setInterval(() => load({ silent: true }), POLL_MS);
    return () => clearInterval(timer);
  }, [user, load]);

  useEffect(() => setStatusFilter('ALL'), [tab]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filterOpen]);

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* cookie/token are cleared locally regardless */
    }
    tokenStore.clear();
    router.replace('/login');
  }

  async function disconnectSlack() {
    try {
      await api.slackDisconnect();
      setUser((u) => (u ? { ...u, slackConnected: false, slackTeamName: null } : u));
      toast('Slack disconnected', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to disconnect Slack', 'error');
    }
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  const visible = statusFilter === 'ALL' ? emails : emails.filter((e) => e.status === statusFilter);

  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar
        user={user}
        tab={tab}
        counts={counts}
        onTab={(t) => {
          setTab(t);
          setLoading(true);
        }}
        onCompose={() => setComposeOpen(true)}
        onLogout={logout}
        onNewSender={() => setSenderOpen(true)}
        onSlackDisconnect={disconnectSlack}
      />

      <main className="min-w-0 flex-1 pr-6 pt-6">
        <div className="flex items-center gap-3 pl-1">
          <label className="flex h-[34px] flex-1 items-center gap-2 rounded-full bg-soft px-3.5 text-muted">
            <Icon name="search" size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label="Search emails"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-[#9ca3af]"
            />
            {search && (
              <button aria-label="Clear search" onClick={() => setSearch('')}>
                <Icon name="x" size={13} />
              </button>
            )}
          </label>

          <div ref={filterRef} className="relative">
            <button
              aria-label="Filter by status"
              onClick={() => setFilterOpen((v) => !v)}
              className={`rounded p-1.5 hover:bg-soft ${statusFilter !== 'ALL' ? 'text-brand' : 'text-[#6b7280]'}`}
            >
              <Icon name="filter" size={16} />
            </button>
            {filterOpen && (
              <ul className="absolute right-0 top-9 z-20 w-40 rounded-xl border border-line bg-white p-1 shadow-lg">
                {FILTERS[tab].map((f) => (
                  <li key={f.value}>
                    <button
                      onClick={() => {
                        setStatusFilter(f.value);
                        setFilterOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[13px] hover:bg-soft ${statusFilter === f.value ? 'bg-mint' : ''}`}
                    >
                      {f.label}
                      {statusFilter === f.value && <Icon name="check" size={13} className="text-brand" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            aria-label="Refresh"
            onClick={() => {
              setRefreshing(true);
              load({ silent: true });
            }}
            className="rounded p-1.5 text-[#6b7280] hover:bg-soft"
          >
            <Icon name="refresh" size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="mt-4 pl-1">
          <EmailTable
            emails={visible}
            loading={loading}
            tab={tab}
            query={debounced.trim()}
            onOpen={setDetailId}
          />
        </div>
      </main>

      <ComposeModal
        open={composeOpen}
        senders={user.senders}
        onClose={() => setComposeOpen(false)}
        onScheduled={() => {
          setSearch('');
          setDebounced('');
          setTab('SCHEDULED');
          load();
        }}
      />

      <EmailDetailModal emailId={detailId} user={user} onClose={() => setDetailId(null)} />

      <SenderModal
        open={senderOpen}
        onClose={() => setSenderOpen(false)}
        onCreated={(sender) => setUser((u) => (u ? { ...u, senders: [...u.senders, sender] } : u))}
      />
    </div>
  );
}
