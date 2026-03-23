import Papa from 'papaparse';
import {
  formatControlResponsibility,
  formatEvidenceLifecycleStatus,
  formatSupportStatus,
  formatEvidenceReviewStatus,
  formatHipaaMapping,
  getEvidenceProgress,
} from '~/features/security/formatters';
import type { SecurityControlWorkspaceExport } from '~/features/security/types';

export function exportSecurityControlsCsv(controls: SecurityControlWorkspaceExport[]) {
  const csv = Papa.unparse(
    controls.map((control) => ({
      supportStatus: formatSupportStatus(control.support),
      evidenceProgress: getEvidenceProgress(control).label,
      controlId: control.nist80053Id,
      title: control.title,
      responsibility: formatControlResponsibility(control.responsibility),
      implementationSummary: control.implementationSummary,
      controlStatement: control.controlStatement,
      familyId: control.familyId,
      familyTitle: control.familyTitle,
      owner: control.owner,
      priority: control.priority,
      reviewedEvidenceCount: control.platformChecklist.reduce((count, item) => {
        return (
          count +
          item.evidence.filter(
            (evidence) =>
              evidence.lifecycleStatus === 'active' && evidence.reviewStatus === 'reviewed',
          ).length
        );
      }, 0),
      evidenceReviewStatuses: control.platformChecklist
        .flatMap((item) =>
          item.evidence
            .filter((evidence) => evidence.lifecycleStatus === 'active')
            .map(
              (evidence) =>
                `${item.label}: ${evidence.title} · ${formatEvidenceReviewStatus(evidence.reviewStatus)}${evidence.reviewedAt ? ` · ${new Date(evidence.reviewedAt).toISOString()}` : ''}${evidence.reviewedByDisplay ? ` · ${evidence.reviewedByDisplay}` : ''}`,
            ),
        )
        .join('; '),
      evidenceHistoryStatuses: control.platformChecklist
        .flatMap((item) =>
          item.evidence
            .filter((evidence) => evidence.lifecycleStatus !== 'active')
            .map(
              (evidence) =>
                `${item.label}: ${evidence.title} · ${formatEvidenceLifecycleStatus(evidence.lifecycleStatus)}${evidence.archivedAt ? ` · ${new Date(evidence.archivedAt).toISOString()}` : ''}${evidence.archivedByDisplay ? ` · ${evidence.archivedByDisplay}` : ''}`,
            ),
        )
        .join('; '),
      checklistCompletion: `${control.platformChecklist.filter((item) => item.support === 'complete').length}/${control.platformChecklist.length}`,
      evidenceCount: control.platformChecklist.reduce((count, item) => {
        return (
          count + item.evidence.filter((evidence) => evidence.lifecycleStatus === 'active').length
        );
      }, 0),
      archivedEvidenceCount: control.platformChecklist.reduce((count, item) => {
        return (
          count + item.evidence.filter((evidence) => evidence.lifecycleStatus !== 'active').length
        );
      }, 0),
      lastReviewedAt: control.lastReviewedAt ? new Date(control.lastReviewedAt).toISOString() : '',
      customerResponsibilityNotes: control.customerResponsibilityNotes ?? '',
      hipaaMappings: control.mappings.hipaa
        .map((mapping) => formatHipaaMapping(mapping))
        .join('; '),
      hipaaMappingsJson: JSON.stringify(control.mappings.hipaa),
      csfMappings: control.mappings.csf20
        .map((mapping) => `${mapping.subcategoryId}${mapping.label ? ` · ${mapping.label}` : ''}`)
        .join('; '),
      csfMappingsJson: JSON.stringify(control.mappings.csf20),
      nist80066Mappings: control.mappings.nist80066
        .map(
          (mapping) =>
            `${mapping.referenceId}${mapping.label ? ` · ${mapping.label}` : ''}${mapping.mappingType ? ` · ${mapping.mappingType}` : ''}`,
        )
        .join('; '),
      nist80066MappingsJson: JSON.stringify(control.mappings.nist80066),
      soc2Mappings: control.mappings.soc2
        .map(
          (mapping) =>
            `${mapping.criterionId}${mapping.label ? ` · ${mapping.label}` : ''}${mapping.group ? ` · ${mapping.group}` : ''}${mapping.trustServiceCategory ? ` · ${mapping.trustServiceCategory}` : ''}`,
        )
        .join('; '),
      soc2MappingsJson: JSON.stringify(control.mappings.soc2),
      checklistJson: JSON.stringify(control.platformChecklist),
      fullControlJson: JSON.stringify(control),
    })),
  );
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `security-control-register-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}
