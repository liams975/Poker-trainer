'use client';

import { AlertCircle } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthFormState } from '@/lib/auth/actions';

type Action = (state: AuthFormState, data: FormData) => Promise<AuthFormState>;

function SubmitButton({ label }: { label: string }) {
  // useFormStatus has to be read from a child of the <form>, not the component
  // that renders it.
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Working…' : label}
    </Button>
  );
}

export function AuthForm({
  action,
  mode,
  next,
  serverError,
}: {
  action: Action;
  mode: 'sign-in' | 'sign-up';
  next: string;
  serverError?: string | undefined;
}) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {
    error: serverError ?? null,
  });

  const isSignUp = mode === 'sign-up';

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      {/*
        The browser's IANA zone, captured at signup because Phase 4's
        handle_new_user() reads it out of raw_user_meta_data to populate
        profiles.timezone. docs/04 makes it load-bearing for streaks and warns
        against silently defaulting to UTC. Resolved at render rather than
        submit so it is present even if JS is slow; a hostile or missing value
        is validated against pg_timezone_names server-side and falls back.
      */}
      {isSignUp ? (
        <input
          type="hidden"
          name="timezone"
          value={Intl.DateTimeFormat().resolvedOptions().timeZone}
        />
      ) : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {isSignUp ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="display_name">Display name</Label>
          <Input
            id="display_name"
            name="display_name"
            autoComplete="nickname"
            maxLength={50}
            placeholder="Optional"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          // Matches minimum_password_length in supabase/config.toml. The server
          // is the authority; this only saves a round-trip.
          minLength={isSignUp ? 8 : undefined}
          required
        />
        {isSignUp ? (
          <p className="text-xs text-ink-muted">At least 8 characters.</p>
        ) : null}
      </div>

      <SubmitButton label={isSignUp ? 'Create account' : 'Sign in'} />
    </form>
  );
}
