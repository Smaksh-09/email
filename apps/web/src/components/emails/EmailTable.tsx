'use client';

import { useState } from 'react';
import type { EmailJob, EmailTab } from '@/types/api';
import { formatFull, stripHtml } from '@/lib/format';
import { StatusBadge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Icon } from '@/components/ui/Icons';

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex h-[46px] items-center gap-6 border-b border-line px-5">
          <Skeleton className="h-4 w-[140px]" />
          <Skeleton className="h-5 w-[110px] rounded-full" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </>
  );
}

export function EmailTable({
  emails,
  loading,
  tab,
  query,
  onOpen,
}: {
  emails: EmailJob[];
  loading: boolean;
  tab: EmailTab;
  query: string;
  onOpen: (id: string) => void;
}) {
  const [starred, setStarred] = useState<Set<string>>(new Set());

  function toggleStar(id: string) {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) return <SkeletonRows />;

  if (emails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-soft text-muted">
          <Icon name={query ? 'search' : tab === 'SCHEDULED' ? 'clock' : 'send'} size={20} />
        </span>
        <p className="text-[14px] text-ink">
          {query
            ? `No emails match “${query}”`
            : tab === 'SCHEDULED'
              ? 'No scheduled emails'
              : 'No sent emails yet'}
        </p>
        <p className="mt-1 text-[12px] text-muted">
          {query
            ? 'Try a different recipient, subject, or keyword.'
            : tab === 'SCHEDULED'
              ? 'Click Compose to schedule your first campaign.'
              : 'Emails will appear here once they are delivered.'}
        </p>
      </div>
    );
  }

  return (
    <ul>
      {emails.map((email) => {
        const preview = stripHtml(email.body).slice(0, 160);
        const isStarred = starred.has(email.id);
        return (
          <li
            key={email.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(email.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(email.id)}
            className="group flex h-[46px] cursor-pointer items-center border-b border-line pl-5 pr-3 text-[13px] hover:bg-[#fafbfa]"
            title={`${tab === 'SENT' ? 'Sent' : 'Scheduled'}: ${formatFull(tab === 'SENT' ? email.sentAt : email.scheduledAt)}`}
          >
            <span className="w-[171px] shrink-0 truncate pr-3 text-ink">To: {email.recipientEmail}</span>
            <StatusBadge status={email.status} scheduledAt={email.scheduledAt} />
            <span className="ml-2 min-w-0 flex-1 truncate">
              <span className="font-medium text-ink">{email.subject}</span>
              {preview && <span className="text-[#9ca3af]"> - {preview}</span>}
            </span>

            {tab === 'SENT' && (
              <span className="ml-3 flex shrink-0 items-center gap-3 text-[11px] text-[#6b7280]">
                {email.sentAt && <span>{formatFull(email.sentAt)}</span>}
                {email.previewUrl && (
                  <a
                    href={email.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 text-brand hover:underline"
                  >
                    View on Ethereal <Icon name="external" size={11} />
                  </a>
                )}
              </span>
            )}

            <button
              aria-label={isStarred ? 'Unstar' : 'Star'}
              onClick={(e) => {
                e.stopPropagation();
                toggleStar(email.id);
              }}
              className={`ml-3 shrink-0 p-1 ${isStarred ? 'text-[#f5b301]' : 'text-[#c0c4c8] hover:text-[#8a8f94]'}`}
            >
              <Icon name="star" size={15} className={isStarred ? 'fill-current' : ''} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
