import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';

export function HelpTip(props: { term: string }) {
  const definition = GLOSSARY[props.term];
  if (!definition) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="ml-1 inline-flex align-middle text-muted-foreground/60 hover:text-muted-foreground"
          >
            <HelpCircle className="size-3.5" />
            <span className="sr-only">What is {props.term}?</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-sm">
          <p>{definition}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const GLOSSARY: Record<string, string> = {
  BAA: 'Business Associate Agreement — a contract required by HIPAA when sharing protected health information with a vendor.',
  DPA: 'Data Processing Agreement — a contract governing how a vendor processes personal data under privacy regulations.',
  'CSF 2.0':
    'NIST Cybersecurity Framework 2.0 — a voluntary framework for managing cybersecurity risk.',
  'NIST 800-53':
    'A catalog of security and privacy controls published by the National Institute of Standards and Technology.',
  'NIST 800-66': 'NIST guidance specifically for implementing HIPAA security requirements.',
  'SOC 2':
    'Service Organization Control 2 — an auditing standard for service providers that store customer data.',
  HIPAA:
    'Health Insurance Portability and Accountability Act — US law protecting sensitive patient health information.',
  disposition:
    'The decision made about a finding: accepted risk, false positive, investigating, or resolved.',
  sufficiency:
    'Whether collected evidence fully satisfies a control requirement (missing, partial, or sufficient).',
  attestation:
    'A formal declaration by a reviewer that a control or evidence item has been verified.',
  'evidence lifecycle':
    'The stages evidence passes through: active, then archived or superseded, with periodic review.',
  'control responsibility': 'Who is accountable: platform (provider), shared (both), or customer.',
  'review cadence':
    'How often a vendor or control must be re-reviewed (typically every 12 months).',
  'immutable export':
    'An audit record exported to tamper-proof storage that cannot be modified after creation.',
  'hash chain':
    'A sequence of records where each entry includes a hash of the previous, making tampering detectable.',
  'step-up window':
    'A short period after re-authentication during which sensitive actions are allowed without prompting again.',
};
