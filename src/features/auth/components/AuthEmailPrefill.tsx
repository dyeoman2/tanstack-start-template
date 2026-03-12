import { useEffect } from 'react';

interface AuthEmailPrefillProps {
  email?: string;
}

function dispatchReactInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function AuthEmailPrefill({ email }: AuthEmailPrefillProps) {
  useEffect(() => {
    if (!email) {
      return;
    }

    const applyEmail = () => {
      const input = document.querySelector('input[type="email"]');
      if (!(input instanceof HTMLInputElement) || input.value) {
        return false;
      }

      dispatchReactInputValue(input, email);
      return true;
    };

    if (applyEmail()) {
      return;
    }

    const observer = new MutationObserver(() => {
      if (applyEmail()) {
        observer.disconnect();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    const timeoutId = window.setTimeout(() => {
      observer.disconnect();
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [email]);

  return null;
}
