import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Separator } from '~/components/ui/separator';
import { formatSupportStatus, getSupportBadgeVariant } from '~/features/security/formatters';
import type { SecurityPolicyDetail } from '~/features/security/types';

function groupPolicyControlsBySupport(policy: SecurityPolicyDetail) {
  return {
    complete: policy.mappedControls.filter((control) => control.support === 'complete'),
    partial: policy.mappedControls.filter((control) => control.support === 'partial'),
    missing: policy.mappedControls.filter((control) => control.support === 'missing'),
  };
}

export function AdminSecurityPolicyDetail(props: {
  onOpenControl: (internalControlId: string) => void;
  policy: SecurityPolicyDetail;
}) {
  const groupedControls = groupPolicyControlsBySupport(props.policy);

  return (
    <div className="space-y-6 p-1">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{props.policy.policyId}</p>
            <h2 className="text-2xl font-semibold">{props.policy.title}</h2>
            <p className="text-sm text-muted-foreground">{props.policy.summary}</p>
          </div>
          <Badge variant={getSupportBadgeVariant(props.policy.support)}>
            {formatSupportStatus(props.policy.support)}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span>Owner: {props.policy.owner}</span>
          <span>
            Last reviewed:{' '}
            {props.policy.lastReviewedAt
              ? new Date(props.policy.lastReviewedAt).toLocaleDateString()
              : 'Not yet'}
          </span>
          <span>
            Next review:{' '}
            {props.policy.nextReviewAt
              ? new Date(props.policy.nextReviewAt).toLocaleDateString()
              : 'Unscheduled'}
          </span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source and Summaries</CardTitle>
          <CardDescription>
            Repo-backed markdown remains the canonical policy prose.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-1">
            <p className="font-medium">Markdown source</p>
            <p className="text-muted-foreground">{props.policy.sourcePath}</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Customer summary</p>
            <p className="text-muted-foreground">
              {props.policy.customerSummary ?? 'No customer summary recorded yet.'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Internal notes</p>
            <p className="text-muted-foreground">
              {props.policy.internalNotes ?? 'No internal notes recorded.'}
            </p>
          </div>
          {props.policy.linkedAnnualReviewTask ? (
            <div className="space-y-1">
              <p className="font-medium">Current annual review task</p>
              <p className="text-muted-foreground">
                {props.policy.linkedAnnualReviewTask.title} ·{' '}
                {props.policy.linkedAnnualReviewTask.status.replaceAll('_', ' ')}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mapped Controls</CardTitle>
          <CardDescription>
            Policy support is derived only from these mapped control support states.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {(['complete', 'partial', 'missing'] as const).map((support, index) => {
            const controls = groupedControls[support];
            return (
              <div key={support} className="space-y-3">
                {index > 0 ? <Separator /> : null}
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{formatSupportStatus(support)}</p>
                  <Badge variant={getSupportBadgeVariant(support)}>{controls.length}</Badge>
                </div>
                {controls.length > 0 ? (
                  <div className="space-y-2">
                    {controls.map((control) => (
                      <div
                        key={`${props.policy.policyId}:${control.internalControlId}`}
                        className="rounded-md border p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="font-medium">
                              {control.nist80053Id} · {control.title}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {control.familyId} · {control.familyTitle}
                              {control.isPrimary ? ' · Primary mapping' : ''}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {control.implementationSummary}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              props.onOpenControl(control.internalControlId);
                            }}
                          >
                            Open control
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No mapped controls are currently in this support bucket.
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
