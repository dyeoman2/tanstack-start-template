import { Spinner } from '~/components/ui/spinner';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { ACTIVE_CONTROL_REGISTER } from '~/lib/shared/compliance/control-register';

export type ControlSummary = {
  bySupport: {
    missing: number;
    partial: number;
    complete: number;
  };
  byResponsibility: {
    customer: number;
    platform: number;
    sharedResponsibility: number;
  };
  totalControls: number;
};

export function renderCardStatValue(value: number | undefined) {
  if (value === undefined) {
    return (
      <>
        <Spinner className="size-5" />
        <span className="sr-only">Loading</span>
      </>
    );
  }

  return value;
}

export function SecurityControlSummaryGrid(props: { controlSummary: ControlSummary | undefined }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AdminSecuritySummaryCard
        title="Active Controls"
        description="Controls currently tracked in the active register."
        value={renderCardStatValue(props.controlSummary?.totalControls)}
        footer={
          props.controlSummary
            ? `Generated ${new Date(ACTIVE_CONTROL_REGISTER.generatedAt).toLocaleDateString()}`
            : undefined
        }
      />
      <AdminSecuritySummaryCard
        title="Complete Support"
        description="Controls where every checklist item is fully supported by current evidence."
        value={renderCardStatValue(props.controlSummary?.bySupport.complete)}
        footer={
          props.controlSummary
            ? `${props.controlSummary.bySupport.partial} partial controls`
            : undefined
        }
      />
      <AdminSecuritySummaryCard
        title="Shared responsibility"
        description="Controls where customer governance or procedures are still required."
        value={renderCardStatValue(props.controlSummary?.byResponsibility.sharedResponsibility)}
        footer={
          props.controlSummary
            ? `${props.controlSummary.byResponsibility.platform} platform controls`
            : undefined
        }
      />
      <AdminSecuritySummaryCard
        title="Customer"
        description="Controls primarily fulfilled through customer-side governance or procedure."
        value={renderCardStatValue(props.controlSummary?.byResponsibility.customer)}
        footer={
          props.controlSummary
            ? `${props.controlSummary.bySupport.missing} missing support controls`
            : undefined
        }
      />
    </div>
  );
}
