'use client';

import { useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/ui/Icons';

interface Props {
  onChange: (html: string, text: string) => void;
}

const ALIGNS = ['justifyLeft', 'justifyCenter', 'justifyRight'] as const;
const ALIGN_ICONS: IconName[] = ['alignLeft', 'alignCenter', 'alignRight'];

export function RichTextEditor({ onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(true);
  const [alignIdx, setAlignIdx] = useState(1);
  const [large, setLarge] = useState(false);

  function emit() {
    const el = ref.current;
    if (!el) return;
    const text = el.innerText.trim();
    setEmpty(text.length === 0 && !el.querySelector('img'));
    onChange(el.innerHTML, text);
  }

  function exec(cmd: string, value?: string) {
    ref.current?.focus();
    document.execCommand(cmd, false, value);
    emit();
  }

  const btn = (icon: IconName, label: string, onClick: () => void) => (
    <button
      type="button"
      key={label}
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md text-[#374151] hover:bg-soft"
    >
      <Icon name={icon} size={16} />
    </button>
  );

  const divider = (k: string) => <span key={k} className="mx-1 h-5 w-px bg-[#e5e7eb]" />;

  return (
    <div className="rounded-xl bg-[#fafafa] px-3.5 pb-4 pt-3">
      <p className="px-0.5 pb-2 text-[13px] text-[#9ca3af]">Type Your Reply...</p>
      <div className="flex flex-wrap items-center rounded-full bg-white px-3 py-1.5">
        {btn('undo', 'Undo', () => exec('undo'))}
        {btn('redo', 'Redo', () => exec('redo'))}
        {divider('d1')}
        <button
          type="button"
          aria-label="Text size"
          title="Text size"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            exec('formatBlock', large ? 'p' : 'h2');
            setLarge(!large);
          }}
          className="flex h-8 items-center gap-0.5 rounded-md px-2 text-[#374151] hover:bg-soft"
        >
          <span className="text-[15px] leading-none">T</span>
          <span className="text-[10px] leading-none">T</span>
          <Icon name="chevronsUpDown" size={10} className="ml-1 text-muted" />
        </button>
        {divider('d2')}
        {btn('bold', 'Bold', () => exec('bold'))}
        {btn('italic', 'Italic', () => exec('italic'))}
        {btn('underline', 'Underline', () => exec('underline'))}
        {divider('d3')}
        {btn(ALIGN_ICONS[alignIdx], 'Align', () => {
          const next = (alignIdx + 1) % ALIGNS.length;
          setAlignIdx(next);
          exec(ALIGNS[next]);
        })}
        {btn('chevronsUpDown', 'Cycle alignment', () => {
          const next = (alignIdx + 1) % ALIGNS.length;
          setAlignIdx(next);
          exec(ALIGNS[next]);
        })}
        {divider('d4')}
        {btn('listOrdered', 'Numbered list', () => exec('insertOrderedList'))}
        {btn('list', 'Bulleted list', () => exec('insertUnorderedList'))}
        {btn('indent', 'Indent', () => exec('indent'))}
        {btn('outdent', 'Outdent', () => exec('outdent'))}
        {btn('quote', 'Quote', () => exec('formatBlock', 'blockquote'))}
        {btn('alignLeft', 'Align left', () => {
          setAlignIdx(0);
          exec('justifyLeft');
        })}
        {divider('d5')}
        {btn('strike', 'Strikethrough', () => exec('strikeThrough'))}
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Email body"
        data-empty={empty}
        onInput={emit}
        onBlur={emit}
        className="rte mt-3 min-h-[280px] px-1 text-[14px] leading-relaxed text-ink outline-none"
      />
    </div>
  );
}
