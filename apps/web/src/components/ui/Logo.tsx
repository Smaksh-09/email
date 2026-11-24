import { Silkscreen } from 'next/font/google';

const pixel = Silkscreen({ weight: '700', subsets: ['latin'] });

export function Logo() {
  return (
    <div
      className={`${pixel.className} select-none text-[28px] leading-none tracking-[0.02em] text-black`}
    >
      Outbox
    </div>
  );
}
