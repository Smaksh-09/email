'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { extractEmails, isValidEmail } from '@/lib/leads';
import { toLocalInputValue } from '@/lib/format';
import type { Sender } from '@/types/api';
import { Icon } from '@/components/ui/Icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { RichTextEditor } from './RichTextEditor';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const VISIBLE_CHIPS = 3;

interface Attachment {
  name: string;
  dataUrl: string;
}

function tomorrowAt(hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return toLocalInputValue(d);
}

function readAs(file: File, mode: 'text' | 'dataUrl'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    if (mode === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

const smallInput =
  'h-[42px] w-[57px] rounded-lg bg-soft px-3 text-center text-[13px] outline-none placeholder:text-[#b4b8bc] focus:ring-2 focus:ring-brand/30';

export function ComposeModal({
  open,
  senders,
  onClose,
  onScheduled,
}: {
  open: boolean;
  senders: Sender[];
  onClose: () => void;
  onScheduled: (count: number) => void;
}) {
  const toast = useToast();

  const [senderId, setSenderId] = useState('');
  const [senderMenu, setSenderMenu] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState('');
  const [delay, setDelay] = useState('');
  const [hourly, setHourly] = useState('');
  const [html, setHtml] = useState('');
  const [text, setText] = useState('');
  const [startTime, setStartTime] = useState('');
  const [laterOpen, setLaterOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const leadInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const sender = senders.find((s) => s.id === senderId) ?? senders[0];

  // Reset the form each time the composer opens.
  useEffect(() => {
    if (!open) return;
    setSenderId(senders[0]?.id ?? '');
    setSenderMenu(false);
    setRecipients([]);
    setDraft('');
    setExpanded(false);
    setSubject('');
    setDelay('');
    setHourly('');
    setHtml('');
    setText('');
    setStartTime('');
    setLaterOpen(false);
    setAttachments([]);
    setEditorKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !submitting && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting]);

  if (!open) return null;

  function addRecipients(list: string[]) {
    if (list.length === 0) return;
    setRecipients((prev) => Array.from(new Set([...prev, ...list])));
  }

  function commitDraft() {
    const value = draft.trim();
    if (!value) return;
    const found = extractEmails(value);
    if (found.length === 0 || (found.length === 1 && !isValidEmail(value) && !value.includes(' '))) {
      toast(`“${value}” is not a valid email address`, 'error');
      return;
    }
    addRecipients(found);
    setDraft('');
  }

  async function onLeadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast('Please upload a .csv or .txt file', 'error');
      return;
    }
    const found = extractEmails(await readAs(file, 'text'));
    if (found.length === 0) {
      toast('No valid email addresses found in that file', 'error');
      return;
    }
    addRecipients(found);
    toast(`${found.length} valid email address${found.length === 1 ? '' : 'es'} found in ${file.name}`, 'success');
  }

  async function onImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const next: Attachment[] = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) {
        toast(`${f.name} is not an image`, 'error');
      } else if (f.size > MAX_IMAGE_BYTES) {
        toast(`${f.name} is larger than 2 MB`, 'error');
      } else {
        next.push({ name: f.name, dataUrl: await readAs(f, 'dataUrl') });
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
  }

  async function submit() {
    // Include anything typed in the To field but not yet committed.
    const all = Array.from(new Set([...recipients, ...extractEmails(draft)]));
    if (all.length === 0) return toast('Add at least one valid recipient', 'error');
    if (!subject.trim()) return toast('Subject is required', 'error');
    if (!text && attachments.length === 0) return toast('Email body is required', 'error');

    const delayBetweenSec = delay.trim() ? Number(delay) : (sender?.minDelaySeconds ?? 2);
    const hourlyLimit = hourly.trim() ? Number(hourly) : (sender?.hourlyLimit ?? 50);
    if (!Number.isFinite(delayBetweenSec) || delayBetweenSec < 1)
      return toast('Delay between emails must be at least 1 second', 'error');
    if (!Number.isFinite(hourlyLimit) || hourlyLimit < 1)
      return toast('Hourly limit must be at least 1', 'error');

    const body =
      html +
      attachments
        .map((a) => `<p><img src="${a.dataUrl}" alt="${a.name.replace(/"/g, '')}" style="max-width:360px;border-radius:8px"></p>`)
        .join('');

    setSubmitting(true);
    try {
      const res = await api.schedule({
        senderId: sender?.id,
        subject: subject.trim(),
        body,
        recipients: all,
        startTime: startTime ? new Date(startTime).toISOString() : undefined,
        delayBetweenSec,
        hourlyLimit,
      });
      toast(`Scheduled ${res.totalScheduled} email${res.totalScheduled === 1 ? '' : 's'}`, 'success');
      onScheduled(res.totalScheduled);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to schedule emails', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const shown = expanded ? recipients : recipients.slice(0, VISIBLE_CHIPS);
  const hidden = recipients.length - VISIBLE_CHIPS;
  const total = new Set([...recipients, ...extractEmails(draft)]).size;

  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-white">
      {/* Top bar */}
      <div className="relative flex items-center px-6 py-5">
        <button onClick={onClose} aria-label="Back" className="mr-3 rounded p-1 text-ink hover:bg-soft">
          <Icon name="arrowLeft" size={20} />
        </button>
        <h1 className="flex-1 text-[20px] font-normal text-ink">Compose New Email</h1>

        <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={onImages} />
        <button
          onClick={() => imageInput.current?.click()}
          aria-label="Attach image"
          title="Attach image (embedded in the email body)"
          className="relative mr-4 text-brand"
        >
          <Icon name="paperclip" size={20} />
          {attachments.length > 0 && (
            <span className="absolute -bottom-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#e5e7eb] text-[8px] text-[#4b5563]">
              {attachments.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setLaterOpen((v) => !v)}
          aria-label="Send later"
          title="Send later"
          className="mr-4 text-brand"
        >
          <Icon name="clock" size={20} />
        </button>
        <Button
          variant="outline"
          loading={submitting}
          onClick={submit}
          className="h-7 min-w-[82px] rounded-full px-4 text-[13px]"
        >
          {startTime ? 'Send Later' : 'Send'}
        </Button>

        {laterOpen && (
          <div className="absolute right-6 top-[62px] z-10 w-[264px] rounded-xl border border-line bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
            <p className="text-[13px] font-medium text-ink">Send Later</p>
            <label className="mt-3 flex items-center border-b border-line pb-1.5 text-[12px] text-muted">
              <input
                type="datetime-local"
                aria-label="Pick date and time"
                value={startTime}
                min={toLocalInputValue(new Date())}
                onChange={(e) => setStartTime(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none"
              />
              <Icon name="calendar" size={14} />
            </label>
            <ul className="mt-3 space-y-0.5 text-[12px] text-ink">
              {[
                ['Tomorrow', 9],
                ['Tomorrow, 10:00 AM', 10],
                ['Tomorrow, 11:00 AM', 11],
                ['Tomorrow, 3:00 PM', 15],
              ].map(([label, hour]) => (
                <li key={label}>
                  <button
                    onClick={() => setStartTime(tomorrowAt(hour as number))}
                    className="w-full rounded px-0.5 py-1.5 text-left hover:bg-soft"
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex items-center justify-end gap-5">
              <button
                onClick={() => {
                  setStartTime('');
                  setLaterOpen(false);
                }}
                className="text-[12px] text-ink"
              >
                Cancel
              </button>
              <Button
                variant="outline"
                onClick={() => setLaterOpen(false)}
                className="h-7 rounded-full px-4 text-[12px]"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Form */}
      <div className="mx-auto max-w-[870px] px-6 pb-16 pt-1">
        {/* From */}
        <div className="flex items-center py-2">
          <span className="w-[46px] text-[12px] text-ink">From</span>
          <div className="relative">
            <button
              onClick={() => setSenderMenu((v) => !v)}
              className="flex h-8 items-center gap-2 rounded-lg bg-soft px-3 text-[13px] text-ink"
              aria-haspopup="listbox"
            >
              {sender ? sender.email : 'No sender'}
              <Icon name="chevronDown" size={13} className="text-muted" />
            </button>
            {senderMenu && (
              <ul
                role="listbox"
                className="absolute left-0 top-9 z-20 max-h-60 min-w-[280px] overflow-auto rounded-xl border border-line bg-white p-1 shadow-lg"
              >
                {senders.map((s) => (
                  <li key={s.id}>
                    <button
                      role="option"
                      aria-selected={s.id === sender?.id}
                      onClick={() => {
                        setSenderId(s.id);
                        setSenderMenu(false);
                      }}
                      className={`w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-soft ${s.id === sender?.id ? 'bg-mint' : ''}`}
                    >
                      {s.name} <span className="text-muted">&lt;{s.email}&gt;</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* To */}
        <div className="flex items-start border-b border-line py-2.5">
          <span className="mt-1.5 w-[46px] shrink-0 text-[12px] text-ink">To</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {shown.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1 rounded-full border border-[#8fd6a8] bg-mint px-2 py-[1px] text-[12px] leading-5 text-ink"
              >
                {email}
                {expanded && (
                  <button
                    aria-label={`Remove ${email}`}
                    onClick={() => setRecipients((prev) => prev.filter((e) => e !== email))}
                    className="text-[#4b5563] hover:text-black"
                  >
                    <Icon name="x" size={11} />
                  </button>
                )}
              </span>
            ))}
            {hidden > 0 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="rounded-full border border-[#8fd6a8] bg-mint px-2 py-[1px] text-[12px] font-medium leading-5 text-ink"
              >
                {expanded ? 'Show less' : `+${hidden}`}
              </button>
            )}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                  e.preventDefault();
                  commitDraft();
                } else if (e.key === 'Backspace' && !draft && recipients.length) {
                  setRecipients((prev) => prev.slice(0, -1));
                }
              }}
              onPaste={(e) => {
                const pasted = extractEmails(e.clipboardData.getData('text'));
                if (pasted.length > 1) {
                  e.preventDefault();
                  addRecipients(pasted);
                }
              }}
              onBlur={commitDraft}
              placeholder={recipients.length ? '' : 'recipient@example.com'}
              aria-label="Recipients"
              className="min-w-[160px] flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-[#b4b8bc]"
            />
          </div>
          <input ref={leadInput} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={onLeadFile} />
          <button
            onClick={() => leadInput.current?.click()}
            className="mt-1 flex shrink-0 items-center gap-1.5 text-[13px] text-brand"
          >
            <Icon name="upload" size={14} /> Upload List
          </button>
        </div>
        {total > 0 && (
          <p className="ml-[46px] mt-1.5 text-[12px] text-brand" aria-live="polite">
            {total} valid email address{total === 1 ? '' : 'es'} detected
          </p>
        )}

        {/* Subject */}
        <div className="flex items-center border-b border-line py-2.5">
          <span className="w-[46px] shrink-0 text-[12px] text-ink">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            aria-label="Subject"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#b4b8bc]"
          />
        </div>

        {/* Rate controls */}
        <div className="flex items-center gap-8 py-3.5">
          <label className="flex items-center gap-3 text-[12px] text-ink">
            Delay between 2 emails
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="00"
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
              className={smallInput}
            />
          </label>
          <label className="flex items-center gap-3 text-[12px] text-ink">
            Hourly Limit
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="00"
              value={hourly}
              onChange={(e) => setHourly(e.target.value)}
              className={smallInput}
            />
          </label>
          {sender && !delay && !hourly && (
            <span className="text-[11px] text-muted">
              Defaults: {sender.minDelaySeconds}s delay, {sender.hourlyLimit}/hr
            </span>
          )}
        </div>

        <RichTextEditor
          key={editorKey}
          onChange={(h, t) => {
            setHtml(h);
            setText(t);
          }}
        />

        {attachments.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-3">
            {attachments.map((a, i) => (
              <div key={a.dataUrl} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.dataUrl} alt={a.name} className="h-[92px] w-[173px] rounded-lg object-cover" />
                <button
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute right-1.5 top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex"
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
