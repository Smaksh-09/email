import type { ReactNode } from 'react';
import type { EmailStatus } from '@/types/api';
import { formatBadgeTime } from '@/lib/format';
import { Icon } from './Icons';

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-[2px] text-[12px] leading-[18px] ${className}`}
    >
      {children}
    </span>
  );
}

/** Status pill matching the Figma list rows. */
export function StatusBadge({ status, scheduledAt }: { status: EmailStatus; scheduledAt: string }) {
  switch (status) {
    case 'SCHEDULED':
      return (
        <Pill className="border border-[#fdc896] bg-[#fff0e0] text-[#c2410c]">
          <Icon name="clock" size={12} />
          {formatBadgeTime(scheduledAt)}
        </Pill>
      );
    case 'RATE_LIMITED':
      return (
        <Pill className="border border-[#f5c518] bg-[#fff6cc] font-medium text-[#8a5a00]">
          <Icon name="clock" size={12} />
          Rate limited · {formatBadgeTime(scheduledAt)}
        </Pill>
      );
    case 'PROCESSING':
      return (
        <Pill className="border border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]">
          <Icon name="refresh" size={12} />
          Processing
        </Pill>
      );
    case 'SENT':
      return <Pill className="bg-[#eef0f2] text-[#4b5563]">Sent</Pill>;
    case 'FAILED':
      return <Pill className="bg-[#fee2e2] text-[#b91c1c]">Failed</Pill>;
  }
}
