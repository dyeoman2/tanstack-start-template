const AUTUMN_50_CREDITS_PRODUCT_ID =
  import.meta.env.VITE_AUTUMN_50_CREDITS_ID && import.meta.env.VITE_AUTUMN_50_CREDITS_ID.length > 0
    ? import.meta.env.VITE_AUTUMN_50_CREDITS_ID
    : 'prod_50_credits';

export const CREDIT_PACKAGES = [
  { credits: 50, price: 5.0, productId: AUTUMN_50_CREDITS_PRODUCT_ID },
] as const;
