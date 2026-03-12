import {
  AuthUIContext,
  DeleteOrganizationCard,
  OrganizationLogoCard,
  OrganizationNameCard,
  type SettingsCardClassNames,
} from '@daveyplate/better-auth-ui';
import { useContext } from 'react';
import { cn } from '~/lib/utils';

interface OrganizationSettingsCardsProps {
  className?: string;
  classNames?: {
    card?: SettingsCardClassNames;
    cards?: string;
  };
  slug?: string;
}

export function OrganizationSettingsCards({
  className,
  classNames,
  slug,
}: OrganizationSettingsCardsProps) {
  const { organization: organizationOptions } = useContext(AuthUIContext);

  return (
    <div className={cn('flex w-full flex-col gap-4 md:gap-6', className, classNames?.cards)}>
      {organizationOptions?.logo && (
        <OrganizationLogoCard classNames={classNames?.card} slug={slug} />
      )}

      <OrganizationNameCard classNames={classNames?.card} slug={slug} />

      <DeleteOrganizationCard classNames={classNames?.card} slug={slug} />
    </div>
  );
}
