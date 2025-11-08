import { api } from '@convex/_generated/api';
import { useAction } from 'convex/react';
import { useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { CREDIT_PACKAGES } from '~/features/ai/constants';

interface CreditPurchaseProps {
  onPurchaseSuccess?: () => void;
  compact?: boolean;
}

export function CreditPurchase({ onPurchaseSuccess, compact = false }: CreditPurchaseProps) {
  const checkoutAction = useAction(api.autumn.checkoutAutumn);
  const [isLoading, setIsLoading] = useState(false);

  const handlePurchase = async (productId: string) => {
    try {
      setIsLoading(true);
      // Redirect back to the AI playground page after successful payment with status query param
      const successUrl = `${window.location.origin}/app/ai-playground?payment=success`;
      const result = await checkoutAction({ productId, successUrl });

      if (result.error) {
        console.error('Checkout failed:', result.error);
        alert(`Purchase failed: ${result.error.message}`);
        return;
      }

      if (result.data?.url) {
        // Open Stripe checkout in a new tab
        window.open(result.data.url, '_blank');
      } else {
        // Success - credits added
        onPurchaseSuccess?.();
      }
    } catch (error) {
      console.error('Purchase failed:', error);
      alert('Failed to initiate checkout. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Compact mode: just a button
  if (compact) {
    return (
      <Button
        onClick={() => handlePurchase(CREDIT_PACKAGES[0].productId)}
        disabled={isLoading}
        size="sm"
      >
        Buy Credits
      </Button>
    );
  }

  // Full card mode
  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchase AI Credits</CardTitle>
        <CardDescription>
          You've used your 10 free messages. Purchase credits to continue using AI features.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4">
          {CREDIT_PACKAGES.map((pkg) => (
            <Card key={pkg.productId} className="relative w-full max-w-sm">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{pkg.credits} Credits</CardTitle>
                    <CardDescription className="text-sm">
                      ${((pkg.price / pkg.credits) * 100).toFixed(0)}¢ per message
                    </CardDescription>
                  </div>
                  <Badge variant="default">${pkg.price}</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Button
                  onClick={() => handlePurchase(pkg.productId)}
                  disabled={isLoading}
                  className="w-full"
                  size="sm"
                >
                  Buy Credits
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-6 text-sm text-muted-foreground text-center">
          <p>• $0.10 per credit (1 credit = 1 message)</p>
          <p>• Credits never expire and can be used anytime</p>
        </div>
      </CardContent>
    </Card>
  );
}
