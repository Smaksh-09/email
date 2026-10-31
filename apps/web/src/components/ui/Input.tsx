import type { InputHTMLAttributes } from 'react';

/** Filled input used on the login card and small modals. */
export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`h-[54px] w-full rounded-xl bg-soft px-5 text-[14px] text-ink outline-none transition-shadow placeholder:text-[#6b7280] focus:ring-2 focus:ring-brand/30 ${className}`}
    />
  );
}
