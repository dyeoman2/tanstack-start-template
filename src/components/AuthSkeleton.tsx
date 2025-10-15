export function AuthSkeleton() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header skeleton */}
        <div className="text-center">
          <div className="h-8 bg-muted rounded w-3/4 mx-auto animate-pulse"></div>
          <div className="mt-2 h-4 bg-muted rounded w-1/2 mx-auto animate-pulse"></div>
        </div>

        {/* Form skeleton */}
        <div className="mt-8 space-y-6">
          <div className="space-y-4">
            {/* Name field (for register) */}
            <div className="h-10 bg-muted rounded animate-pulse"></div>
            {/* Email field */}
            <div className="h-10 bg-muted rounded animate-pulse"></div>
            {/* Password field */}
            <div className="h-10 bg-muted rounded animate-pulse"></div>
            {/* Confirm password field (for register/reset) */}
            <div className="h-10 bg-muted rounded animate-pulse"></div>
            {/* Submit button */}
            <div className="h-10 bg-muted rounded animate-pulse"></div>
          </div>

          {/* Links skeleton */}
          <div className="text-center space-y-2">
            <div className="h-4 bg-muted rounded w-1/2 mx-auto animate-pulse"></div>
            <div className="h-4 bg-muted rounded w-1/3 mx-auto animate-pulse"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
