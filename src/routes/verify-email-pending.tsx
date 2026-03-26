import { createFileRoute, Navigate } from '@tanstack/react-router';
import { z } from 'zod';

export const Route = createFileRoute('/verify-email-pending')({
  staticData: true,
  component: VerifyEmailPendingShim,
  errorComponent: () => <div>Something went wrong</div>,
  validateSearch: z.object({
    email: z.string().email().optional(),
    redirectTo: z
      .string()
      .regex(/^\/[a-zA-Z]/)
      .optional(),
  }),
});

function VerifyEmailPendingShim() {
  const { email, redirectTo } = Route.useSearch();

  return (
    <Navigate
      to="/account-setup"
      search={{
        ...(email ? { email } : {}),
        ...(redirectTo ? { redirectTo } : {}),
      }}
      replace
    />
  );
}
