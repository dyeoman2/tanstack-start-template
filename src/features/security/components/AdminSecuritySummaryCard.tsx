import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

export function AdminSecuritySummaryCard(props: {
  description: string;
  footer?: string;
  title: ReactNode;
  value: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex min-h-8 items-center text-2xl font-semibold">{props.value}</div>
        {props.footer ? <p className="text-sm text-muted-foreground">{props.footer}</p> : null}
      </CardContent>
    </Card>
  );
}
