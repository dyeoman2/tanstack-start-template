import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { authClient, signIn } from '~/features/auth/auth-client';
import { useAuth } from '~/features/auth/hooks/useAuth';

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    token: z.string().min(1, 'Reset token is required'),
  }),
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const { user, isAuthenticated } = useAuth();
  const session = useMemo(() => ({ user: isAuthenticated ? user : null }), [user, isAuthenticated]);
  const router = useRouter();
  const [email] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState({
    password: '',
    confirmPassword: '',
  });
  const newPasswordId = useId();
  const confirmPasswordId = useId();

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing reset token. Please request a new password reset.');
      return;
    }
    // Token validation is handled by Better Auth internally
  }, [token]);

  // Check if user is already logged in after password reset
  useEffect(() => {
    if (session?.user && success) {
      console.log('✅ User is now logged in after password reset, redirecting to dashboard');
      setTimeout(() => {
        router.navigate({ to: '/' });
      }, 1000);
    }
  }, [session, success, router]);

  const validatePassword = (password: string) => {
    if (!password) return 'Password is required';
    if (password.length < 8) return 'Password must be at least 8 characters long';
    if (password.length > 128) return 'Password must be less than 128 characters';
    if (!/(?=.*[a-z])/.test(password)) return 'Password must contain at least one lowercase letter';
    if (!/(?=.*[A-Z])/.test(password)) return 'Password must contain at least one uppercase letter';
    if (!/(?=.*\d)/.test(password)) return 'Password must contain at least one number';
    if (!/(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/.test(password))
      return 'Password must contain at least one symbol';
    return '';
  };

  const validateConfirmPassword = (confirmPassword: string, password: string) => {
    if (!confirmPassword) return 'Please confirm your password';
    if (confirmPassword !== password) return 'Passwords do not match';
    return '';
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    setValidationErrors((prev) => ({
      ...prev,
      password: validatePassword(value),
      confirmPassword: confirmPassword ? validateConfirmPassword(confirmPassword, value) : '',
    }));
  };

  const handleConfirmPasswordChange = (value: string) => {
    setConfirmPassword(value);
    setValidationErrors((prev) => ({
      ...prev,
      confirmPassword: validateConfirmPassword(value, password),
    }));
  };

  const isFormValid = () => {
    const passwordError = validatePassword(password);
    const confirmPasswordError = validateConfirmPassword(confirmPassword, password);

    setValidationErrors({
      password: passwordError,
      confirmPassword: confirmPasswordError,
    });

    return !passwordError && !confirmPasswordError && token;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isFormValid()) {
      return;
    }

    setIsLoading(true);

    try {
      // Reset the password using Better Auth
      await authClient.resetPassword({
        token,
        newPassword: password,
      });

      setSuccess(true);

      // Attempt auto-login with the provided email
      try {
        await signIn.email({
          email: email,
          password: password,
        });

        setTimeout(() => {
          router.navigate({ to: '/' });
        }, 1000);
        return;
      } catch (loginError) {
        console.error('❌ Auto-login failed:', loginError);
        // Fall back to manual login
      }

      // Fallback: redirect to login with success message
      setTimeout(() => {
        router.navigate({ to: '/login', search: { reset: 'success' } });
      }, 1500);
    } catch (error: unknown) {
      console.error('Password reset error:', error);
      setIsLoading(false);

      if (
        (error instanceof Error && error.message?.includes('Invalid token')) ||
        (error instanceof Error && error.message?.includes('expired'))
      ) {
        setError(
          'This password reset link has expired or is invalid. Please request a new password reset.',
        );
      } else if (error instanceof Error && error.message?.includes('Password')) {
        setError('Password does not meet the requirements. Please check the password criteria.');
      } else {
        setError('Password reset failed. Please try again or request a new reset link.');
      }
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
              <svg
                className="h-6 w-6 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <title>Password reset successful</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              Password Reset Successful
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              Your password has been successfully updated. Redirecting to login...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Reset your password
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">Enter your new password below</p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* Hidden email field - pre-filled but not visible to user */}
          <input type="hidden" name="email" value={email} />

          <div>
            <label htmlFor={newPasswordId} className="sr-only">
              New Password
            </label>
            <input
              id={newPasswordId}
              name="password"
              type="password"
              required
              autoComplete="new-password"
              className={`relative block w-full px-3 py-2 bg-white border placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:z-10 sm:text-sm ${
                validationErrors.password
                  ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                  : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
              }`}
              placeholder="New password"
              value={password}
              onChange={(e) => handlePasswordChange(e.target.value)}
            />
            {validationErrors.password && (
              <p className="mt-1 text-sm text-red-600">{validationErrors.password}</p>
            )}
            {!validationErrors.password && password && (
              <div className="mt-1 text-xs text-gray-500">
                Password must contain: 8+ characters, uppercase, lowercase, and number
              </div>
            )}
          </div>

          <div>
            <label htmlFor={confirmPasswordId} className="sr-only">
              Confirm New Password
            </label>
            <input
              id={confirmPasswordId}
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              className={`relative block w-full px-3 py-2 bg-white border placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:z-10 sm:text-sm ${
                validationErrors.confirmPassword
                  ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                  : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
              }`}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => handleConfirmPasswordChange(e.target.value)}
            />
            {validationErrors.confirmPassword && (
              <p className="mt-1 text-sm text-red-600">{validationErrors.confirmPassword}</p>
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={
                isLoading ||
                !password ||
                !confirmPassword ||
                !!validationErrors.password ||
                !!validationErrors.confirmPassword ||
                !token
              }
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Resetting password...' : 'Reset password'}
            </button>
          </div>

          <div className="text-center">
            <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
              Back to sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
