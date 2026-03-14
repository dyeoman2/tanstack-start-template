import type { ReactNode } from 'react';
import { PageHeader } from '~/components/PageHeader';

interface OrganizationWorkspaceNavProps {
  description: string;
  title: string;
  actions?: ReactNode;
}

export function OrganizationWorkspaceNav({
  description,
  title,
  actions,
}: OrganizationWorkspaceNavProps) {
  return (
    <PageHeader title={title} description={description} actions={actions} />
  );
}
