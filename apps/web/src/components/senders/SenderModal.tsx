'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { Sender } from '@/types/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

const field =
  'h-11 w-full rounded-lg bg-soft px-4 text-[14px] outline-none placeholder:text-[#6b7280] focus:ring-2 focus:ring-brand/30';

export function SenderModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (sender: Sender) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState('50');
  const [minDelay, setMinDelay] = useState('2');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const sender = await api.createSender({
        name: name.trim() || 'Outreach Sender',
        hourlyLimit: Number(hourlyLimit) || 50,
        minDelaySeconds: Number(minDelay) || 2,
      });
      toast(`Sender ${sender.email} created`, 'success');
      setName('');
      onCreated(sender);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create sender', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Ethereal sender">
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-[13px] text-[#4b5563]">
          Sender name
          <input
            className={`${field} mt-1`}
            placeholder="e.g. Sales Outreach"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[13px] text-[#4b5563]">
            Hourly limit
            <input
              type="number"
              min={1}
              className={`${field} mt-1`}
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
            />
          </label>
          <label className="block text-[13px] text-[#4b5563]">
            Min delay (sec)
            <input
              type="number"
              min={1}
              className={`${field} mt-1`}
              value={minDelay}
              onChange={(e) => setMinDelay(e.target.value)}
            />
          </label>
        </div>
        <p className="text-[12px] text-muted">
          A fresh Ethereal SMTP inbox is provisioned automatically for this sender.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="h-9 rounded-full px-4" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading} className="h-9 rounded-full px-5">
            Create sender
          </Button>
        </div>
      </form>
    </Modal>
  );
}
