'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { formatFull, formatShort, initials } from '@/lib/format';
import type { EmailJob, UserProfile } from '@/types/api';
import { Icon } from '@/components/ui/Icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/layout/Header';

/** Renders the HTML body in a script-less sandboxed iframe that auto-sizes to its content. */
function EmailBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;overflow-wrap:anywhere}
    blockquote{border-left:3px solid #facc15;background:#fffbe6;margin:12px 0;padding:10px 14px}
    img{max-width:100%;border-radius:8px} a{color:#00a843}
  </style></head><body>${html}</body></html>`;

  return (
    <iframe
      ref={ref}
      title="Email body"
      sandbox="allow-same-origin allow-popups"
      srcDoc={doc}
      style={{ height }}
      className="w-full border-0"
      onLoad={() => {
        const h = ref.current?.contentDocument?.documentElement?.scrollHeight;
        if (h) setHeight(h + 8);
      }}
    />
  );
}

export function EmailDetailModal({
  emailId,
  user,
  onClose,
}: {
  emailId: string | null;
  user: UserProfile;
  onClose: () => void;
}) {
  const [email, setEmail] = useState<EmailJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    if (!emailId) return;
    let cancelled = false;
    setEmail(null);
    setError(null);
    setShowMeta(false);
    api
      .getEmail(emailId)
      .then((e) => !cancelled && setEmail(e))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, [emailId]);

  useEffect(() => {
    if (!emailId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emailId, onClose]);

  if (!emailId) return null;

  const senderName = email?.sender?.name ?? user.name;
  const senderEmail = email?.sender?.email ?? user.email;

  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-white">
      <div className="flex items-center gap-3 px-6 py-5">
        <button onClick={onClose} aria-label="Back" className="rounded p-1 text-ink hover:bg-soft">
          <Icon name="arrowLeft" size={20} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[20px] font-normal text-ink">
          {email ? email.subject : <Skeleton className="h-6 w-72" />}
        </h1>
        <Icon name="star" size={18} className="text-[#9ca3af]" />
        <span className="mx-2 h-6 w-px bg-line" />
        <Avatar user={user} size={28} />
      </div>

      <div className="mx-auto max-w-[860px] px-6 pb-16 pt-4">
        {error && (
          <p className="rounded-lg bg-[#fdecec] px-4 py-3 text-[13px] text-[#b91c1c]">{error}</p>
        )}

        {!email && !error && (
          <div className="space-y-3">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {email && (
          <>
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00c853] text-[15px] text-white">
                {initials(senderName).slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px]">
                  <span className="font-semibold">{senderName}</span>{' '}
                  <span className="text-[#6b7280]">&lt;{senderEmail}&gt;</span>
                </p>
                <button
                  onClick={() => setShowMeta((v) => !v)}
                  className="mt-0.5 flex items-center gap-1 text-[12px] text-[#6b7280]"
                >
                  to {email.recipientEmail}
                  <Icon name="chevronDown" size={12} className={showMeta ? 'rotate-180' : ''} />
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[12px] text-[#6b7280]">
                <StatusBadge status={email.status} scheduledAt={email.scheduledAt} />
                {formatShort(email.sentAt ?? email.scheduledAt)}
              </div>
            </div>

            {showMeta && (
              <dl className="ml-14 mt-3 grid grid-cols-[110px_1fr] gap-y-1 rounded-lg bg-soft px-4 py-3 text-[12px]">
                <dt className="text-muted">Status</dt>
                <dd>{email.status.replace('_', ' ')}</dd>
                <dt className="text-muted">Scheduled</dt>
                <dd>{formatFull(email.scheduledAt)}</dd>
                <dt className="text-muted">Sent</dt>
                <dd>{formatFull(email.sentAt)}</dd>
                <dt className="text-muted">Attempts</dt>
                <dd>{email.attempts}</dd>
                <dt className="text-muted">Message-ID</dt>
                <dd className="break-all">{email.messageId ?? '-'}</dd>
              </dl>
            )}

            <div className="ml-14 mt-6">
              {email.errorMessage && (
                <p className="mb-4 rounded-lg bg-[#fdecec] px-4 py-3 text-[13px] text-[#b91c1c]">
                  <span className="font-medium">Delivery error:</span> {email.errorMessage}
                </p>
              )}

              <EmailBody html={email.body} />

              {email.previewUrl && (
                <a
                  href={email.previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-flex h-9 items-center gap-1.5 rounded-full border border-brand px-4 text-[13px] text-brand hover:bg-mint"
                >
                  View on Ethereal <Icon name="external" size={13} />
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
