'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, api, tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GoogleLogo } from '@/components/ui/Icons';
import { useToast } from '@/components/ui/Toast';

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error')) {
      toast('Google sign-in failed. Please try again.', 'error');
    }
    // Already signed in? Go straight to the dashboard.
    if (tokenStore.get()) {
      api
        .me()
        .then(() => router.replace('/dashboard'))
        .catch(() => tokenStore.clear());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-[488px] rounded-[10px] border border-[#e8e8e8] bg-white px-14 pb-12 pt-12">
        <h1 className="text-center text-[36px] font-bold leading-[44px] text-[#1a1a1a]">Login</h1>

        <a
          href={`${API_URL}/api/auth/google`}
          className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-mint text-[15px] text-ink transition-colors hover:bg-[#d5eedd]"
        >
          <GoogleLogo />
          Login with Google
        </a>

        <div className="my-6 flex items-center gap-4">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[12px] tracking-[0.04em] text-muted">or sign up through email</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            toast('Email/password login is not available yet. Please use Login with Google.', 'info');
          }}
        >
          <Input
            type="email"
            placeholder="Email ID"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <Button type="submit" className="mt-3 h-12 w-full rounded-xl text-[15px]">
            Login
          </Button>
        </form>
      </div>
    </main>
  );
}
