import { api } from '@convex/_generated/api';
import { useAction } from 'convex/react';
import { useState } from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { CreditPurchase } from '~/features/ai/components/CreditPurchase';
import { CREDIT_PACKAGES } from '~/features/ai/constants';

interface UsageAlertProps {
  usageDetails: {
    freeLimit: number;
    freeMessagesRemaining: number;
  } | null;
  subscriptionDetails: {
    status: string;
    isUnlimited: boolean;
    creditBalance: number | null;
  } | null;
  isInitialSubscriptionLoad: boolean;
  onRefreshUsage: () => Promise<void>;
}

export function UsageAlert({
  usageDetails,
  subscriptionDetails,
  isInitialSubscriptionLoad,
  onRefreshUsage,
}: UsageAlertProps) {
  const checkoutAction = useAction(api.autumn.checkoutAutumn);
  const [isLoading, setIsLoading] = useState(false);

  if (!usageDetails || isInitialSubscriptionLoad) {
    return null;
  }

  const freeLimit = usageDetails.freeLimit ?? 10;
  const freeRemaining = usageDetails.freeMessagesRemaining ?? freeLimit;
  const isSubscribed = subscriptionDetails?.status === 'subscribed';
  const isUnlimited = subscriptionDetails?.isUnlimited ?? false;
  const creditBalance = subscriptionDetails?.creditBalance ?? null;
  const hasPaidCreditsWithFreeRemaining =
    isSubscribed && creditBalance !== null && freeRemaining > 0;
  const generationBlocked = !isSubscribed && freeRemaining <= 0;

  const handlePurchase = async (productId: string) => {
    try {
      setIsLoading(true);
      const successUrl = `${window.location.origin}/app/ai-playground?payment=success`;
      const result = await checkoutAction({ productId, successUrl });

      if (result.error) {
        console.error('Checkout failed:', result.error);
        alert(`Purchase failed: ${result.error.message}`);
        return;
      }

      if (result.data?.url) {
        window.open(result.data.url, '_blank');
      } else {
        onRefreshUsage();
      }
    } catch (error) {
      console.error('Purchase failed:', error);
      alert('Failed to initiate checkout. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Alert variant={isSubscribed ? 'default' : generationBlocked ? 'destructive' : 'warning'}>
      <AlertDescription>
        <div className="space-y-3 w-full">
          <div className="flex items-center justify-between gap-4">
            <span>
              {isSubscribed && isUnlimited
                ? 'Your Autumn subscription provides unlimited messages.'
                : hasPaidCreditsWithFreeRemaining
                  ? `You have ${freeRemaining} free message${freeRemaining === 1 ? '' : 's'} remaining. After that, you have ${creditBalance} paid credit${creditBalance === 1 ? '' : 's'} available.`
                  : isSubscribed && creditBalance !== null
                    ? `You have ${creditBalance} message${creditBalance === 1 ? '' : 's'} remaining.`
                    : generationBlocked
                      ? 'You have no messages remaining. Purchase more credits to continue.'
                      : `You have ${freeRemaining} free message${freeRemaining === 1 ? '' : 's'} remaining.`}
            </span>
            {!isSubscribed && <CreditPurchase onPurchaseSuccess={onRefreshUsage} compact />}
          </div>
          {!isSubscribed && !generationBlocked && freeRemaining <= 2 && (
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Running low on free messages? Purchase credits to continue:
              </p>
              <div className="flex gap-2">
                {CREDIT_PACKAGES.map((pkg) => (
                  <Button
                    key={pkg.productId}
                    variant="outline"
                    size="sm"
                    onClick={() => handlePurchase(pkg.productId)}
                    disabled={isLoading}
                    className="text-xs"
                  >
                    ${pkg.price} ({pkg.credits} credits)
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
