import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useAction, useMutation, useQuery } from 'convex/react';
import { Archive, Check, History, MoreHorizontal, RefreshCw } from 'lucide-react';
import Papa from 'papaparse';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  createSortableHeader,
  DataTable,
  TableFilter,
  type TableFilterOption,
  TableSearch,
} from '~/components/data-table';
import { PageHeader } from '~/components/PageHeader';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { ExportButton } from '~/components/ui/export-button';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Textarea } from '~/components/ui/textarea';
import { useToast } from '~/components/ui/toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';
import {
  ACTIVE_CONTROL_REGISTER,
  type ActiveControlRecord,
  type ControlChecklistEvidenceType,
  type ControlResponsibility,
  getControlResponsibilityDisplayLabel,
} from '~/lib/shared/compliance/control-register';

const SECURITY_TABS = ['overview', 'controls', 'evidence', 'vendors'] as const;
const CONTROL_TABLE_SORT_FIELDS = ['control', 'evidence', 'responsibility', 'family'] as const;
const CONTROL_RESPONSIBILITY_FILTER_VALUES = [
  'all',
  'platform',
  'shared-responsibility',
  'customer',
] as const;
const CONTROL_EVIDENCE_FILTER_VALUES = ['all', 'ready', 'partial', 'missing'] as const;
const CONTROL_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const EVIDENCE_REVIEW_DUE_OPTIONS = [3, 6, 12] as const;
const EVIDENCE_SOURCE_OPTIONS = [
  'manual_upload',
  'internal_review',
  'automated_system_check',
  'external_report',
  'vendor_attestation',
] as const;

type EvidenceReviewDueIntervalMonths = (typeof EVIDENCE_REVIEW_DUE_OPTIONS)[number];
type EvidenceSource = (typeof EVIDENCE_SOURCE_OPTIONS)[number];
type EvidenceExpiryStatus = 'current' | 'expiring_soon' | 'none';

type SecurityChecklistEvidence = {
  archivedAt: number | null;
  archivedByDisplay: string | null;
  createdAt: number;
  description: string | null;
  evidenceDate: number | null;
  evidenceType: 'file' | 'link' | 'note' | 'system_snapshot';
  expiryStatus: EvidenceExpiryStatus;
  fileName: string | null;
  id: string;
  lifecycleStatus: 'active' | 'archived' | 'superseded';
  mimeType: string | null;
  renewedFromEvidenceId: string | null;
  replacedByEvidenceId: string | null;
  reviewDueAt: number | null;
  reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths | null;
  reviewStatus: 'pending' | 'reviewed';
  reviewedAt: number | null;
  reviewedByDisplay: string | null;
  sizeBytes: number | null;
  source: EvidenceSource | null;
  storageId: string | null;
  sufficiency: 'missing' | 'partial' | 'sufficient';
  title: string;
  uploadedByDisplay: string | null;
  url: string | null;
};

type SecurityChecklistEvidenceActivity = {
  actorDisplay: string | null;
  createdAt: number;
  evidenceId: string;
  evidenceTitle: string;
  eventType:
    | 'security_control_evidence_created'
    | 'security_control_evidence_reviewed'
    | 'security_control_evidence_archived'
    | 'security_control_evidence_renewed';
  id: string;
  internalControlId: string;
  itemId: string;
  lifecycleStatus: 'active' | 'archived' | 'superseded' | null;
  renewedFromEvidenceId: string | null;
  replacedByEvidenceId: string | null;
  reviewStatus: 'pending' | 'reviewed' | null;
};

type SecurityChecklistItem = {
  completedAt: number | null;
  description: string;
  evidence: SecurityChecklistEvidence[];
  evidenceSufficiency: 'missing' | 'partial' | 'sufficient';
  hasExpiringSoonEvidence: boolean;
  itemId: string;
  label: string;
  lastReviewedAt: number | null;
  notes: string | null;
  owner: string | null;
  required: boolean;
  status: 'done' | 'in_progress' | 'not_applicable' | 'not_started';
  suggestedEvidenceTypes: ControlChecklistEvidenceType[];
  verificationMethod: string;
};

type SecurityControlWorkspace = Omit<
  ActiveControlRecord,
  | 'coverage'
  | 'evidence'
  | 'lastReviewedAt'
  | 'mappings'
  | 'platformChecklistItems'
  | 'reviewStatus'
  | 'seedReview'
> & {
  evidenceReadiness: 'missing' | 'partial' | 'ready';
  hasExpiringSoonEvidence: boolean;
  lastReviewedAt: number | null;
  mappings: {
    csf20: Array<{
      label: string | null;
      subcategoryId: string;
    }>;
    hipaa: Array<{
      citation: string;
      implementationSpecification: 'addressable' | 'required' | null;
      text: string | null;
      title: string | null;
      type: 'implementation_specification' | 'section' | 'standard' | 'subsection' | null;
    }>;
    nist80066: Array<{
      label: string | null;
      mappingType: 'key-activity' | 'relationship' | 'sample-question' | null;
      referenceId: string;
    }>;
    soc2: Array<{
      criterionId: string;
      group:
        | 'availability'
        | 'common-criteria'
        | 'confidentiality'
        | 'privacy'
        | 'processing-integrity';
      label: string | null;
      trustServiceCategory:
        | 'availability'
        | 'confidentiality'
        | 'privacy'
        | 'processing-integrity'
        | 'security';
    }>;
  };
  platformChecklist: SecurityChecklistItem[];
};

async function uploadFileWithTarget(
  file: File,
  target: {
    uploadMethod: 'POST' | 'PUT';
    uploadUrl: string;
    uploadHeaders?: Record<string, string>;
    uploadFields?: Record<string, string>;
  },
) {
  if (target.uploadMethod === 'PUT') {
    const response = await fetch(target.uploadUrl, {
      body: file,
      headers: target.uploadHeaders,
      method: 'PUT',
    });

    if (!response.ok) {
      throw new Error(`Failed to upload ${file.name}.`);
    }

    return null;
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(target.uploadFields ?? {})) {
    formData.append(key, value);
  }
  formData.append('file', file);

  const response = await fetch(target.uploadUrl, {
    body: formData,
    headers: target.uploadHeaders,
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to upload ${file.name}.`);
  }

  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('storageId' in payload) ||
    typeof payload.storageId !== 'string'
  ) {
    throw new Error('Upload did not return a storage identifier.');
  }

  return payload.storageId;
}

const securitySearchSchema = z.object({
  tab: z.enum(SECURITY_TABS).default('overview'),
  page: z.number().default(1),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(10),
  sortBy: z.enum(CONTROL_TABLE_SORT_FIELDS).default('control'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().default(''),
  responsibility: z.enum(CONTROL_RESPONSIBILITY_FILTER_VALUES).default('all'),
  evidenceReadiness: z.enum(CONTROL_EVIDENCE_FILTER_VALUES).default('all'),
  family: z.string().default('all'),
  selectedControl: z.string().optional(),
});

export const Route = createFileRoute('/app/admin/security')({
  validateSearch: securitySearchSchema,
  component: AdminSecurityRoute,
});

function isSecurityTab(value: string): value is (typeof SECURITY_TABS)[number] {
  return SECURITY_TABS.includes(value as (typeof SECURITY_TABS)[number]);
}

function AdminSecurityRoute() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const {
    tab: activeTab,
    page,
    pageSize,
    sortBy,
    sortOrder,
    search: controlSearchTerm,
    responsibility: responsibilityFilter,
    evidenceReadiness: evidenceReadinessFilter,
    family: familyFilter,
    selectedControl: selectedControlId,
  } = search;
  const { showToast } = useToast();
  const summary = useQuery(api.security.getSecurityPostureSummary, {});
  const controlWorkspaces = useQuery(api.security.listSecurityControlWorkspaces, {});
  const evidenceReports = useQuery(api.security.listEvidenceReports, { limit: 10 });
  const generateEvidenceReport = useAction(api.security.generateEvidenceReport);
  const exportEvidenceReport = useAction(api.security.exportEvidenceReport);
  const reviewEvidenceReport = useMutation(api.security.reviewEvidenceReport);
  const reviewControlEvidence = useMutation(api.security.reviewSecurityControlEvidence);
  const addEvidenceLink = useMutation(api.security.addSecurityControlEvidenceLink);
  const addEvidenceNote = useMutation(api.security.addSecurityControlEvidenceNote);
  const archiveControlEvidence = useMutation(api.security.archiveSecurityControlEvidence);
  const createEvidenceUploadTarget = useAction(
    api.security.createSecurityControlEvidenceUploadTarget,
  );
  const finalizeEvidenceUpload = useAction(api.security.finalizeSecurityControlEvidenceUpload);
  const renewControlEvidence = useMutation(api.security.renewSecurityControlEvidence);
  const createSignedServeUrl = useAction(api.fileServing.createSignedServeUrl);
  const [report, setReport] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<Id<'evidenceReports'> | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [busyReportAction, setBusyReportAction] = useState<string | null>(null);
  const [isExportingControls, setIsExportingControls] = useState(false);
  const [busyControlAction, setBusyControlAction] = useState<string | null>(null);
  const controls = controlWorkspaces ?? [];
  const controlSummary = useMemo(() => {
    return controls.reduce(
      (summaryAccumulator, control) => {
        summaryAccumulator.totalControls += 1;
        if (control.responsibility) {
          summaryAccumulator.byResponsibility[control.responsibility] += 1;
        }
        summaryAccumulator.byEvidence[control.evidenceReadiness] += 1;
        return summaryAccumulator;
      },
      {
        totalControls: 0,
        byResponsibility: {
          platform: 0,
          'shared-responsibility': 0,
          customer: 0,
        },
        byEvidence: {
          ready: 0,
          partial: 0,
          missing: 0,
        },
      },
    );
  }, [controls]);
  const familyOptions = useMemo<TableFilterOption<string>[]>(
    () => [
      { label: 'All families', value: 'all' },
      ...Array.from(
        new Map(
          (controls.length > 0 ? controls : ACTIVE_CONTROL_REGISTER.controls).map((control) => [
            control.familyId,
            control.familyTitle,
          ]),
        ).entries(),
      )
        .sort(([leftId, leftTitle], [rightId, rightTitle]) => {
          return leftId.localeCompare(rightId) || leftTitle.localeCompare(rightTitle);
        })
        .map(([familyId, familyTitle]) => ({
          label: `${familyId} · ${familyTitle}`,
          value: familyId,
        })),
    ],
    [controls],
  );
  const responsibilityOptions = useMemo<
    TableFilterOption<'all' | NonNullable<SecurityControlWorkspace['responsibility']>>[]
  >(
    () => [
      { label: 'All responsibilities', value: 'all' },
      { label: 'Platform', value: 'platform' },
      { label: 'Shared responsibility', value: 'shared-responsibility' },
      { label: 'Customer', value: 'customer' },
    ],
    [],
  );
  const evidenceReadinessOptions = useMemo<
    TableFilterOption<'all' | SecurityControlWorkspace['evidenceReadiness']>[]
  >(
    () => [
      { label: 'All evidence', value: 'all' },
      { label: 'Complete', value: 'ready' },
      { label: 'Partial', value: 'partial' },
      { label: 'Missing', value: 'missing' },
    ],
    [],
  );
  const normalizedControlSearchTerm = controlSearchTerm.trim().toLowerCase();
  const filteredControls = useMemo(
    () =>
      controls.filter((control) => {
        if (responsibilityFilter !== 'all' && control.responsibility !== responsibilityFilter) {
          return false;
        }

        if (
          evidenceReadinessFilter !== 'all' &&
          control.evidenceReadiness !== evidenceReadinessFilter
        ) {
          return false;
        }

        if (familyFilter !== 'all' && control.familyId !== familyFilter) {
          return false;
        }

        if (normalizedControlSearchTerm.length === 0) {
          return true;
        }

        const searchableText = [
          control.nist80053Id,
          control.title,
          control.implementationSummary,
          control.familyId,
          control.familyTitle,
          control.owner,
          control.responsibility ?? '',
          control.evidenceReadiness,
          control.customerResponsibilityNotes ?? '',
          control.platformChecklist.map((item) => item.label).join(' '),
          control.platformChecklist.map((item) => item.notes ?? '').join(' '),
          control.mappings.hipaa.map((mapping) => mapping.citation).join(' '),
          control.mappings.csf20.map((mapping) => mapping.subcategoryId).join(' '),
          control.mappings.nist80066.map((mapping) => mapping.referenceId).join(' '),
          control.mappings.soc2.map((mapping) => mapping.criterionId).join(' '),
        ]
          .join(' ')
          .toLowerCase();

        return searchableText.includes(normalizedControlSearchTerm);
      }),
    [
      controls,
      evidenceReadinessFilter,
      familyFilter,
      normalizedControlSearchTerm,
      responsibilityFilter,
    ],
  );
  const sortedControls = useMemo(() => {
    const sorted = [...filteredControls];
    sorted.sort((left, right) => {
      const direction = sortOrder === 'asc' ? 1 : -1;
      let comparison = 0;

      switch (sortBy) {
        case 'evidence':
          comparison = left.evidenceReadiness.localeCompare(right.evidenceReadiness);
          break;
        case 'responsibility':
          comparison = (left.responsibility ?? '').localeCompare(right.responsibility ?? '');
          break;
        case 'family':
          comparison =
            left.familyId.localeCompare(right.familyId) ||
            left.familyTitle.localeCompare(right.familyTitle);
          break;
        default:
          comparison =
            left.nist80053Id.localeCompare(right.nist80053Id) ||
            left.title.localeCompare(right.title);
          break;
      }

      if (comparison !== 0) {
        return comparison * direction;
      }

      return (
        left.internalControlId.localeCompare(right.internalControlId) *
        (sortOrder === 'asc' ? 1 : -1)
      );
    });

    return sorted;
  }, [filteredControls, sortBy, sortOrder]);
  const totalControlPages = Math.max(1, Math.ceil(sortedControls.length / pageSize));
  const currentControlPage = Math.min(page, totalControlPages);
  const paginatedControls = useMemo(() => {
    const startIndex = (currentControlPage - 1) * pageSize;
    return sortedControls.slice(startIndex, startIndex + pageSize);
  }, [currentControlPage, pageSize, sortedControls]);
  const selectedControl = useMemo(
    () =>
      selectedControlId
        ? (controls.find((control) => control.internalControlId === selectedControlId) ?? null)
        : null,
    [controls, selectedControlId],
  );
  const controlPagination = useMemo(
    () => ({
      page: currentControlPage,
      pageSize,
      total: sortedControls.length,
      totalPages: totalControlPages,
    }),
    [currentControlPage, pageSize, sortedControls.length, totalControlPages],
  );
  const controlSearchParams = useMemo(
    () => ({
      page: currentControlPage,
      pageSize,
      sortBy,
      sortOrder,
    }),
    [currentControlPage, pageSize, sortBy, sortOrder],
  );
  const updateControlSearch = useCallback(
    (
      updates: Partial<{
        page: number;
        pageSize: (typeof CONTROL_PAGE_SIZE_OPTIONS)[number];
        sortBy: (typeof CONTROL_TABLE_SORT_FIELDS)[number];
        sortOrder: 'asc' | 'desc';
        search: string;
        responsibility: 'all' | NonNullable<SecurityControlWorkspace['responsibility']>;
        evidenceReadiness: 'all' | SecurityControlWorkspace['evidenceReadiness'];
        family: string;
        selectedControl: string | undefined;
      }>,
    ) => {
      void navigate({
        to: '/app/admin/security',
        search: {
          ...search,
          ...updates,
        },
      });
    },
    [navigate, search],
  );
  const handleControlSorting = useCallback(
    (columnId: (typeof CONTROL_TABLE_SORT_FIELDS)[number]) => {
      updateControlSearch({
        sortBy: columnId,
        sortOrder: sortBy === columnId && sortOrder === 'asc' ? 'desc' : 'asc',
        page: 1,
      });
    },
    [sortBy, sortOrder, updateControlSearch],
  );
  const handleControlPageChange = useCallback(
    (nextPage: number) => {
      updateControlSearch({ page: nextPage });
    },
    [updateControlSearch],
  );
  const handleControlPageSizeChange = useCallback(
    (nextPageSize: number) => {
      updateControlSearch({
        page: 1,
        pageSize: CONTROL_PAGE_SIZE_OPTIONS.includes(
          nextPageSize as (typeof CONTROL_PAGE_SIZE_OPTIONS)[number],
        )
          ? (nextPageSize as (typeof CONTROL_PAGE_SIZE_OPTIONS)[number])
          : 10,
      });
    },
    [updateControlSearch],
  );
  const controlColumns = useMemo<ColumnDef<SecurityControlWorkspace, unknown>[]>(
    () => [
      {
        accessorKey: 'control',
        header: createSortableHeader(
          'Control',
          'control',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <ControlCell control={row.original} />,
      },
      {
        accessorKey: 'responsibility',
        header: createSortableHeader(
          'Responsibility',
          'responsibility',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <ResponsibilityCell control={row.original} />,
      },
      {
        accessorKey: 'evidence',
        header: createSortableHeader(
          'Evidence',
          'evidence',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <EvidenceReadinessCell control={row.original} />,
      },
      {
        accessorKey: 'family',
        header: createSortableHeader(
          'Frameworks',
          'family',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <FrameworkSummaryCell control={row.original} />,
      },
    ],
    [controlSearchParams, handleControlSorting],
  );
  const handleExportControls = useCallback(async () => {
    setIsExportingControls(true);

    try {
      const csv = Papa.unparse(
        sortedControls.map((control) => ({
          evidenceStatus: formatEvidenceReadiness(control.evidenceReadiness),
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
          checklistCompletion: `${control.platformChecklist.filter((item) => item.status === 'done').length}/${control.platformChecklist.length}`,
          evidenceCount: control.platformChecklist.reduce((count, item) => {
            return (
              count +
              item.evidence.filter((evidence) => evidence.lifecycleStatus === 'active').length
            );
          }, 0),
          archivedEvidenceCount: control.platformChecklist.reduce((count, item) => {
            return (
              count +
              item.evidence.filter((evidence) => evidence.lifecycleStatus !== 'active').length
            );
          }, 0),
          lastReviewedAt: control.lastReviewedAt
            ? new Date(control.lastReviewedAt).toISOString()
            : '',
          customerResponsibilityNotes: control.customerResponsibilityNotes ?? '',
          hipaaMappings: control.mappings.hipaa
            .map((mapping) => formatHipaaMapping(mapping))
            .join('; '),
          hipaaMappingsJson: JSON.stringify(control.mappings.hipaa),
          csfMappings: control.mappings.csf20
            .map(
              (mapping) => `${mapping.subcategoryId}${mapping.label ? ` · ${mapping.label}` : ''}`,
            )
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
      showToast('Control register exported.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to export control register',
        'error',
      );
    } finally {
      setIsExportingControls(false);
    }
  }, [showToast, sortedControls]);

  const handleAddEvidenceLink = useCallback(
    async (args: {
      description?: string;
      evidenceDate: number;
      internalControlId: string;
      itemId: string;
      reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
      source: EvidenceSource;
      sufficiency: SecurityChecklistEvidence['sufficiency'];
      title: string;
      url: string;
    }) => {
      setBusyControlAction(`${args.internalControlId}:${args.itemId}:link`);
      try {
        await addEvidenceLink(args);
        showToast('Evidence link attached.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to attach evidence link',
          'error',
        );
      } finally {
        setBusyControlAction(null);
      }
    },
    [addEvidenceLink, showToast],
  );

  const handleAddEvidenceNote = useCallback(
    async (args: {
      description: string;
      evidenceDate: number;
      internalControlId: string;
      itemId: string;
      reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
      source: EvidenceSource;
      sufficiency: SecurityChecklistEvidence['sufficiency'];
      title: string;
    }) => {
      setBusyControlAction(`${args.internalControlId}:${args.itemId}:note`);
      try {
        await addEvidenceNote(args);
        showToast('Evidence note attached.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to attach evidence note',
          'error',
        );
      } finally {
        setBusyControlAction(null);
      }
    },
    [addEvidenceNote, showToast],
  );

  const handleUploadEvidenceFile = useCallback(
    async (args: {
      description?: string;
      evidenceDate: number;
      file: File;
      internalControlId: string;
      itemId: string;
      reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
      source: EvidenceSource;
      sufficiency: SecurityChecklistEvidence['sufficiency'];
      title: string;
    }) => {
      setBusyControlAction(`${args.internalControlId}:${args.itemId}:file`);
      try {
        const target = await createEvidenceUploadTarget({
          contentType: args.file.type || 'application/octet-stream',
          fileName: args.file.name,
          fileSize: args.file.size,
          internalControlId: args.internalControlId,
          itemId: args.itemId,
        });
        const uploadedStorageId = await uploadFileWithTarget(args.file, target);
        await finalizeEvidenceUpload({
          backendMode: target.backendMode,
          description: args.description,
          evidenceDate: args.evidenceDate,
          fileName: args.file.name,
          fileSize: args.file.size,
          internalControlId: args.internalControlId,
          itemId: args.itemId,
          mimeType: args.file.type || 'application/octet-stream',
          reviewDueIntervalMonths: args.reviewDueIntervalMonths,
          storageId: uploadedStorageId ?? target.storageId,
          source: args.source,
          sufficiency: args.sufficiency,
          title: args.title,
        });
        showToast('Evidence file uploaded.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to upload evidence file',
          'error',
        );
      } finally {
        setBusyControlAction(null);
      }
    },
    [createEvidenceUploadTarget, finalizeEvidenceUpload, showToast],
  );

  const handleOpenEvidence = useCallback(
    async (evidence: SecurityChecklistEvidence) => {
      if (evidence.evidenceType === 'link' && evidence.url) {
        window.open(evidence.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (evidence.storageId) {
        try {
          const resolved = await createSignedServeUrl({ storageId: evidence.storageId });
          window.open(resolved.url, '_blank', 'noopener,noreferrer');
        } catch (error) {
          showToast(
            error instanceof Error ? error.message : 'Failed to open evidence file',
            'error',
          );
        }
      }
    },
    [createSignedServeUrl, showToast],
  );

  const handleArchiveEvidence = useCallback(
    async (args: { evidenceId: string; internalControlId: string; itemId: string }) => {
      setBusyControlAction(`${args.evidenceId}:archive`);
      try {
        await archiveControlEvidence(args);
        showToast('Evidence archived.', 'success');
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to archive evidence', 'error');
      } finally {
        setBusyControlAction(null);
      }
    },
    [archiveControlEvidence, showToast],
  );

  const handleRenewEvidence = useCallback(
    async (args: { evidenceId: string; internalControlId: string; itemId: string }) => {
      setBusyControlAction(`${args.evidenceId}:renew`);
      try {
        await renewControlEvidence(args);
        showToast(
          'Evidence renewed. Review the new copy before it counts toward completion.',
          'success',
        );
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to renew evidence', 'error');
      } finally {
        setBusyControlAction(null);
      }
    },
    [renewControlEvidence, showToast],
  );

  const handleReviewEvidence = useCallback(
    async (args: { evidenceId: string }) => {
      setBusyControlAction(`${args.evidenceId}:review`);
      try {
        await reviewControlEvidence({
          evidenceId: args.evidenceId as Id<'securityControlEvidence'>,
          reviewStatus: 'reviewed',
        });
        showToast('Evidence marked as reviewed.', 'success');
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to review evidence', 'error');
      } finally {
        setBusyControlAction(null);
      }
    },
    [reviewControlEvidence, showToast],
  );

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    try {
      const generated = await generateEvidenceReport({});
      setReport(generated.report);
      setSelectedReportId(generated.id);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReviewReport = async (
    id: Id<'evidenceReports'>,
    reviewStatus: 'needs_follow_up' | 'reviewed',
  ) => {
    setBusyReportAction(`${id}:${reviewStatus}`);
    try {
      await reviewEvidenceReport({
        id,
        reviewNotes: reviewNotes[id]?.trim() || undefined,
        reviewStatus,
      });
    } finally {
      setBusyReportAction(null);
    }
  };

  const handleExportReport = async (id: Id<'evidenceReports'>) => {
    setBusyReportAction(`${id}:export`);
    try {
      const exported = await exportEvidenceReport({ id });
      setReport(exported.report);
      setSelectedReportId(id);
    } finally {
      setBusyReportAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Posture"
        description="Review control implementation, evidence posture, vendor boundaries, and security oversight workflows."
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (!isSecurityTab(value) || value === activeTab) {
            return;
          }

          void navigate({
            to: '/app/admin/security',
            search: {
              ...search,
              tab: value,
              selectedControl: value === 'controls' ? search.selectedControl : undefined,
            },
          });
        }}
      >
        <TabsList className="w-full justify-start overflow-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              title="MFA Coverage"
              description="Phishing-resistant MFA coverage across Better Auth users, including passkeys."
              value={
                summary
                  ? `${summary.auth.mfaCoveragePercent}% (${summary.auth.mfaEnabledUsers}/${summary.auth.totalUsers})`
                  : 'Loading…'
              }
              footer={
                summary
                  ? `${summary.auth.passkeyEnabledUsers} users have passkeys; verified email is always required`
                  : undefined
              }
            />
            <SummaryCard
              title="File Inspection"
              description="Attachment and document inspection outcomes from the built-in inspection pipeline."
              value={
                summary
                  ? `${summary.scanner.totalScans} inspected, ${summary.scanner.quarantinedCount} quarantined, ${summary.scanner.rejectedCount} rejected`
                  : 'Loading…'
              }
              footer={
                summary?.scanner.lastScanAt
                  ? `Last inspection ${new Date(summary.scanner.lastScanAt).toLocaleString()}`
                  : 'No inspection events recorded yet'
              }
            />
            <SummaryCard
              title="Audit Integrity"
              description="Hash-chain failure signal from the audit subsystem."
              value={summary ? `${summary.audit.integrityFailures} integrity failures` : 'Loading…'}
              footer={
                summary?.audit.lastEventAt
                  ? `Last audit event ${new Date(summary.audit.lastEventAt).toLocaleString()}`
                  : 'No audit activity yet'
              }
            />
            <SummaryCard
              title="Retention Jobs"
              description="Latest retention or cleanup execution status."
              value={
                summary?.retention.lastJobStatus
                  ? summary.retention.lastJobStatus
                  : 'No retention job recorded'
              }
              footer={
                summary?.retention.lastJobAt
                  ? `Last run ${new Date(summary.retention.lastJobAt).toLocaleString()}`
                  : undefined
              }
            />
            <SummaryCard
              title="Telemetry"
              description="External telemetry posture for the regulated baseline."
              value={
                summary
                  ? summary.telemetry.sentryApproved
                    ? 'Sentry approved'
                    : 'Sentry blocked by default'
                  : 'Loading…'
              }
              footer={
                summary
                  ? summary.telemetry.sentryEnabled
                    ? 'Telemetry sink configured with explicit approval'
                    : 'No approved telemetry sink active'
                  : undefined
              }
            />
            <SummaryCard
              title="Session Policy"
              description="Short-lived verification posture applied across the app."
              value={
                summary
                  ? `${summary.sessions.freshWindowMinutes} minute step-up window`
                  : 'Loading…'
              }
              footer={
                summary
                  ? `${summary.sessions.sessionExpiryHours}h sessions, ${summary.sessions.temporaryLinkTtlMinutes} minute temporary links`
                  : undefined
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Active Controls"
              description="Controls currently tracked in the active register."
              value={`${controlSummary.totalControls}`}
              footer={`Generated ${new Date(ACTIVE_CONTROL_REGISTER.generatedAt).toLocaleDateString()}`}
            />
            <SummaryCard
              title="Complete Evidence"
              description="Controls where every required checklist item has attached evidence."
              value={`${controlSummary.byEvidence.ready}`}
              footer={`${controlSummary.byEvidence.partial} partial controls`}
            />
            <SummaryCard
              title="Shared responsibility"
              description="Controls where customer governance or procedures are still required."
              value={`${controlSummary.byResponsibility['shared-responsibility']}`}
              footer={`${controlSummary.byResponsibility.platform} platform controls`}
            />
            <SummaryCard
              title="Customer"
              description="Controls primarily fulfilled through customer-side governance or procedure."
              value={`${controlSummary.byResponsibility.customer}`}
              footer={`${controlSummary.byEvidence.missing} missing evidence controls`}
            />
          </div>
        </TabsContent>

        <TabsContent value="controls" className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Control Register</h2>
            <p className="text-sm text-muted-foreground">
              Active control register with evidence, responsibility, and framework mapping detail.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Active Controls"
              description="Controls currently tracked in the active register."
              value={`${controlSummary.totalControls}`}
              footer={`Generated ${new Date(ACTIVE_CONTROL_REGISTER.generatedAt).toLocaleDateString()}`}
            />
            <SummaryCard
              title="Complete Evidence"
              description="Controls where every required checklist item has attached evidence."
              value={`${controlSummary.byEvidence.ready}`}
              footer={`${controlSummary.byEvidence.partial} partial controls`}
            />
            <SummaryCard
              title="Shared responsibility"
              description="Controls where customer governance or procedures are still required."
              value={`${controlSummary.byResponsibility['shared-responsibility']}`}
              footer={`${controlSummary.byResponsibility.platform} platform controls`}
            />
            <SummaryCard
              title="Customer"
              description="Controls primarily fulfilled through customer-side governance or procedure."
              value={`${controlSummary.byResponsibility.customer}`}
              footer={`${controlSummary.byEvidence.missing} missing evidence controls`}
            />
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="inline-flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-2">
              <p className="text-sm text-muted-foreground whitespace-nowrap">
                {controlPagination.total} matches
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <TableFilter<string>
                  value={familyFilter}
                  options={familyOptions}
                  onValueChange={(value) => {
                    updateControlSearch({ family: value, page: 1 });
                  }}
                  className="shrink-0"
                  ariaLabel="Filter controls by family"
                />
                <TableFilter<'all' | NonNullable<SecurityControlWorkspace['responsibility']>>
                  value={responsibilityFilter}
                  options={responsibilityOptions}
                  onValueChange={(value) => {
                    updateControlSearch({ responsibility: value, page: 1 });
                  }}
                  className="shrink-0"
                  ariaLabel="Filter controls by responsibility"
                />
                <TableFilter<'all' | SecurityControlWorkspace['evidenceReadiness']>
                  value={evidenceReadinessFilter}
                  options={evidenceReadinessOptions}
                  onValueChange={(value) => {
                    updateControlSearch({ evidenceReadiness: value, page: 1 });
                  }}
                  className="shrink-0"
                  ariaLabel="Filter controls by evidence readiness"
                />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end xl:justify-end xl:flex-1">
              <TableSearch
                initialValue={controlSearchTerm}
                onSearch={(value) => {
                  updateControlSearch({ search: value, page: 1 });
                }}
                placeholder="Search by control, checklist item, owner, responsibility, or framework"
                isSearching={false}
                className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
                ariaLabel="Search controls"
              />
              <ExportButton
                onExport={handleExportControls}
                isLoading={isExportingControls}
                disabled={sortedControls.length === 0}
                label="Export controls to Excel"
              />
            </div>
          </div>

          <DataTable<SecurityControlWorkspace, (typeof controlColumns)[number]>
            data={paginatedControls}
            columns={controlColumns}
            pagination={controlPagination}
            searchParams={controlSearchParams}
            isLoading={false}
            onPageChange={handleControlPageChange}
            onPageSizeChange={handleControlPageSizeChange}
            onRowClick={(control) => {
              updateControlSearch({ selectedControl: control.internalControlId });
            }}
            emptyMessage="No controls matched the current filters."
          />
        </TabsContent>

        <TabsContent value="evidence" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Evidence Report</CardTitle>
              <CardDescription>
                Generate a JSON evidence snapshot suitable for internal review and export.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={handleGenerateReport} disabled={isGenerating}>
                {isGenerating ? 'Generating…' : 'Generate evidence report'}
              </Button>
              {report ? (
                <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
                  {report}
                </pre>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Evidence Review Queue</CardTitle>
              <CardDescription>
                Review generated evidence, capture notes, and export integrity-linked bundles.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {evidenceReports?.length ? (
                evidenceReports.map((item) => (
                  <div
                    key={item.id}
                    className="space-y-3 rounded-lg border p-4"
                    data-selected={selectedReportId === item.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {item.reportKind} · {new Date(item.createdAt).toLocaleString()}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Review: {item.reviewStatus} · Content hash: {item.contentHash}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {item.exportHash
                            ? `Last export hash: ${item.exportHash}`
                            : 'Not exported yet'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busyReportAction !== null}
                          onClick={() => {
                            void handleReviewReport(item.id, 'reviewed');
                          }}
                        >
                          {busyReportAction === `${item.id}:reviewed` ? 'Saving…' : 'Mark reviewed'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busyReportAction !== null}
                          onClick={() => {
                            void handleReviewReport(item.id, 'needs_follow_up');
                          }}
                        >
                          {busyReportAction === `${item.id}:needs_follow_up`
                            ? 'Saving…'
                            : 'Needs follow-up'}
                        </Button>
                        <Button
                          type="button"
                          disabled={busyReportAction !== null}
                          onClick={() => {
                            void handleExportReport(item.id);
                          }}
                        >
                          {busyReportAction === `${item.id}:export`
                            ? 'Exporting…'
                            : 'Export bundle'}
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      value={reviewNotes[item.id] ?? item.reviewNotes ?? ''}
                      onChange={(event) => {
                        setReviewNotes((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }));
                      }}
                      placeholder="Reviewer notes"
                    />
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No evidence reports generated yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vendors">
          <Card>
            <CardHeader>
              <CardTitle>Vendor Boundary</CardTitle>
              <CardDescription>
                Approved outbound integrations, allowed data classes, and environment boundaries.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary?.vendors.map((vendor) => (
                <div key={vendor.vendor} className="rounded-md border px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="font-medium">{vendor.displayName}</p>
                      <p className="text-sm text-muted-foreground">
                        Data classes: {vendor.allowedDataClasses.join(', ')}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Environments: {vendor.allowedEnvironments.join(', ')}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {vendor.approved
                        ? vendor.approvedByDefault
                          ? 'Approved by default'
                          : `Approved via ${vendor.approvalEnvVar}`
                        : `Blocked until ${vendor.approvalEnvVar ?? 'approved'}`}
                    </p>
                  </div>
                </div>
              )) ?? <p className="text-sm text-muted-foreground">Loading vendor posture…</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Sheet
        open={selectedControl !== null}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          updateControlSearch({ selectedControl: undefined });
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedControl ? (
            <ControlDetailSheet
              busyAction={busyControlAction}
              control={selectedControl}
              onAddEvidenceLink={handleAddEvidenceLink}
              onAddEvidenceNote={handleAddEvidenceNote}
              onArchiveEvidence={handleArchiveEvidence}
              onOpenEvidence={handleOpenEvidence}
              onReviewEvidence={handleReviewEvidence}
              onRenewEvidence={handleRenewEvidence}
              onUploadEvidenceFile={handleUploadEvidenceFile}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ControlCell({ control }: { control: SecurityControlWorkspace }) {
  return (
    <div className="min-w-0 py-1">
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-left">
              <p className="font-medium text-foreground">
                {control.nist80053Id} {control.title}
              </p>
              {control.hasExpiringSoonEvidence ? (
                <div className="mt-2">
                  <Badge variant="secondary">Expiring soon</Badge>
                </div>
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-md">
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                  Ownership
                </p>
                <p className="text-sm font-medium">{control.owner}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                  Control summary
                </p>
                <p className="text-xs leading-relaxed">{control.implementationSummary}</p>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function ResponsibilityCell({ control }: { control: SecurityControlWorkspace }) {
  if (!control.responsibility) {
    return <div className="py-1 text-sm text-muted-foreground">—</div>;
  }

  const badge = (
    <Badge variant={getResponsibilityBadgeVariant(control.responsibility)}>
      {formatControlResponsibility(control.responsibility)}
    </Badge>
  );

  return (
    <div className="space-y-2 py-1">
      {control.customerResponsibilityNotes ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>{badge}</TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-sm">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                  Customer responsibilities
                </p>
                <p className="text-xs leading-relaxed">{control.customerResponsibilityNotes}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        badge
      )}
    </div>
  );
}

function EvidenceReadinessCell({ control }: { control: SecurityControlWorkspace }) {
  const progress = getEvidenceProgress(control);

  return (
    <div className="space-y-2 py-1">
      <Badge variant={getEvidenceReadinessBadgeVariant(control.evidenceReadiness)}>
        {formatEvidenceReadiness(control.evidenceReadiness)} {progress.label}
      </Badge>
      {control.hasExpiringSoonEvidence ? <Badge variant="secondary">Expiring soon</Badge> : null}
    </div>
  );
}

function FrameworkSummaryCell({ control }: { control: SecurityControlWorkspace }) {
  const frameworkSummaries = [
    {
      label: 'HIPAA',
      count: control.mappings.hipaa.length,
      values: control.mappings.hipaa.map((mapping) => formatHipaaMapping(mapping)),
    },
    {
      label: 'CSF',
      count: control.mappings.csf20.length,
      values: control.mappings.csf20.map(
        (mapping) => `${mapping.subcategoryId}${mapping.label ? ` · ${mapping.label}` : ''}`,
      ),
    },
    {
      label: 'NIST 800-66r2',
      count: control.mappings.nist80066.length,
      values: control.mappings.nist80066.map((mapping) => mapping.referenceId),
    },
    {
      label: 'SOC 2',
      count: control.mappings.soc2.length,
      values: control.mappings.soc2.map(
        (mapping) => `${mapping.criterionId}${mapping.label ? ` · ${mapping.label}` : ''}`,
      ),
    },
  ].filter((item) => item.count > 0);

  return (
    <div className="py-1 text-sm text-muted-foreground">
      <div className="flex flex-wrap gap-2">
        {frameworkSummaries.map((item) => (
          <TooltipProvider key={item.label} delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded-full border px-2 py-1 text-xs font-medium text-foreground"
                >
                  {item.label} ({item.count})
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-md">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                    {item.label} mappings
                  </p>
                  <ul className="list-disc space-y-1 pl-4 text-left text-xs leading-relaxed">
                    {item.values.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>
    </div>
  );
}

function ControlDetailSheet(props: {
  busyAction: string | null;
  control: SecurityControlWorkspace;
  onAddEvidenceLink: (args: {
    description?: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
    url: string;
  }) => Promise<void>;
  onAddEvidenceNote: (args: {
    description: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
  onArchiveEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onOpenEvidence: (evidence: SecurityChecklistEvidence) => Promise<void>;
  onReviewEvidence: (args: { evidenceId: string }) => Promise<void>;
  onRenewEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onUploadEvidenceFile: (args: {
    description?: string;
    evidenceDate: number;
    file: File;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
}) {
  const { control } = props;

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {control.nist80053Id} {control.title}
        </SheetTitle>
        <SheetDescription>{control.familyTitle}</SheetDescription>
        {control.hasExpiringSoonEvidence ? <Badge variant="secondary">Expiring soon</Badge> : null}
      </SheetHeader>

      <div className="space-y-6 p-4">
        <DetailSection title="Overview">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
            <DetailItem
              label="Responsibility"
              value={formatControlResponsibility(control.responsibility)}
            />
            <DetailItem label="Control owner" value={control.owner} />
            <DetailItem
              label="Control last reviewed"
              value={
                control.lastReviewedAt
                  ? formatEvidenceTimestamp(control.lastReviewedAt)
                  : 'No completed review recorded'
              }
            />
          </dl>
        </DetailSection>

        <DetailSection title="Description">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {control.implementationSummary}
          </p>
        </DetailSection>

        <DetailSection title="Checklist">
          <PlatformChecklistSection
            busyAction={props.busyAction}
            control={control}
            onAddEvidenceLink={props.onAddEvidenceLink}
            onAddEvidenceNote={props.onAddEvidenceNote}
            onArchiveEvidence={props.onArchiveEvidence}
            onOpenEvidence={props.onOpenEvidence}
            onReviewEvidence={props.onReviewEvidence}
            onRenewEvidence={props.onRenewEvidence}
            onUploadEvidenceFile={props.onUploadEvidenceFile}
          />
        </DetailSection>

        <DetailSection title="Customer responsibilities">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {control.customerResponsibilityNotes ??
              'No additional customer responsibilities recorded.'}
          </p>
        </DetailSection>

        <DetailSection title="Framework mappings">
          <Accordion type="multiple" className="rounded-md border">
            <FrameworkAccordionItem
              title="HIPAA"
              value="hipaa"
              values={control.mappings.hipaa.map((mapping) => formatHipaaMapping(mapping))}
            />
            <FrameworkAccordionItem
              title="CSF 2.0"
              value="csf"
              values={control.mappings.csf20.map(
                (mapping) =>
                  `${mapping.subcategoryId}${mapping.label ? ` · ${mapping.label}` : ''}`,
              )}
            />
            <FrameworkAccordionItem
              title="NIST 800-66r2"
              value="nist-800-66r2"
              values={control.mappings.nist80066.map(
                (mapping) => `${mapping.referenceId}${mapping.label ? ` · ${mapping.label}` : ''}`,
              )}
            />
            <FrameworkAccordionItem
              title="SOC 2"
              value="soc2"
              values={control.mappings.soc2.map(
                (mapping) => `${mapping.criterionId}${mapping.label ? ` · ${mapping.label}` : ''}`,
              )}
            />
          </Accordion>
        </DetailSection>
      </div>
    </>
  );
}

function PlatformChecklistSection(props: {
  busyAction: string | null;
  control: SecurityControlWorkspace;
  onAddEvidenceLink: (args: {
    description?: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
    url: string;
  }) => Promise<void>;
  onAddEvidenceNote: (args: {
    description: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
  onArchiveEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onOpenEvidence: (evidence: SecurityChecklistEvidence) => Promise<void>;
  onReviewEvidence: (args: { evidenceId: string }) => Promise<void>;
  onRenewEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onUploadEvidenceFile: (args: {
    description?: string;
    evidenceDate: number;
    file: File;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
}) {
  return (
    <Accordion type="multiple" className="rounded-md border">
      {props.control.platformChecklist.map((item) => (
        <ChecklistAccordionItem
          key={item.itemId}
          busyAction={props.busyAction}
          control={props.control}
          item={item}
          onAddEvidenceLink={props.onAddEvidenceLink}
          onAddEvidenceNote={props.onAddEvidenceNote}
          onArchiveEvidence={props.onArchiveEvidence}
          onOpenEvidence={props.onOpenEvidence}
          onReviewEvidence={props.onReviewEvidence}
          onRenewEvidence={props.onRenewEvidence}
          onUploadEvidenceFile={props.onUploadEvidenceFile}
        />
      ))}
    </Accordion>
  );
}

function ChecklistAccordionItem(props: {
  busyAction: string | null;
  control: SecurityControlWorkspace;
  item: SecurityChecklistItem;
  onAddEvidenceLink: (args: {
    description?: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
    url: string;
  }) => Promise<void>;
  onAddEvidenceNote: (args: {
    description: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
  onArchiveEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onOpenEvidence: (evidence: SecurityChecklistEvidence) => Promise<void>;
  onReviewEvidence: (args: { evidenceId: string }) => Promise<void>;
  onRenewEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onUploadEvidenceFile: (args: {
    description?: string;
    evidenceDate: number;
    file: File;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
}) {
  const { control, item } = props;
  const [isAddingProof, setIsAddingProof] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [pendingArchiveEvidence, setPendingArchiveEvidence] =
    useState<SecurityChecklistEvidence | null>(null);
  const [pendingRenewEvidence, setPendingRenewEvidence] =
    useState<SecurityChecklistEvidence | null>(null);
  const [proofComposerTab, setProofComposerTab] = useState<'link' | 'note' | 'file'>('link');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkDescription, setLinkDescription] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteDescription, setNoteDescription] = useState('');
  const [evidenceDateInput, setEvidenceDateInput] = useState(() => getTodayDateInputValue());
  const [reviewDueIntervalMonths, setReviewDueIntervalMonths] =
    useState<EvidenceReviewDueIntervalMonths>(12);
  const [source, setSource] = useState<EvidenceSource | ''>('');
  const linkKey = `${control.internalControlId}:${item.itemId}:link`;
  const noteKey = `${control.internalControlId}:${item.itemId}:note`;
  const fileKey = `${control.internalControlId}:${item.itemId}:file`;
  const activeEvidence = item.evidence.filter((evidence) => evidence.lifecycleStatus === 'active');
  const historyEvidence = item.evidence.filter((evidence) => evidence.lifecycleStatus !== 'active');
  const evidenceActivity = useQuery(
    api.security.listSecurityControlEvidenceActivity,
    isHistoryOpen
      ? {
          internalControlId: control.internalControlId,
          itemId: item.itemId,
        }
      : 'skip',
  );
  const metadataIsComplete = evidenceDateInput.length > 0 && source !== '';

  const resetEvidenceComposer = useCallback(() => {
    setLinkTitle('');
    setLinkUrl('');
    setLinkDescription('');
    setNoteTitle('');
    setNoteDescription('');
    setEvidenceDateInput(getTodayDateInputValue());
    setReviewDueIntervalMonths(12);
    setSource('');
    setProofComposerTab('link');
  }, []);

  return (
    <AccordionItem value={item.itemId} className="border-b last:border-b-0">
      <AccordionTrigger className="px-5 py-4 text-left focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-border/70 data-[state=open]:bg-muted/20">
        <div className="flex flex-1 items-center justify-between gap-4 pr-4">
          <span className="text-sm font-medium">{item.label}</span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!item.required ? <Badge variant="outline">Optional</Badge> : null}
            {item.hasExpiringSoonEvidence ? <Badge variant="secondary">Expiring soon</Badge> : null}
            <Badge variant={getChecklistStatusBadgeVariant(item.status)}>
              {formatChecklistStatus(item.status)}
            </Badge>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-4 px-4 pb-4">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{item.description}</p>
          <p className="text-sm font-medium">Evidence</p>
        </div>

        {activeEvidence.length ? (
          <div className="space-y-3">
            {activeEvidence.map((evidence) => (
              <div key={evidence.id} className="space-y-3 rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 flex-1 text-sm font-medium">{evidence.title}</p>
                  <div className="flex items-center gap-2">
                    {evidence.expiryStatus === 'expiring_soon' ? (
                      <Badge variant="secondary">Expiring soon</Badge>
                    ) : null}
                    <Badge variant={getEvidenceReviewBadgeVariant(evidence.reviewStatus)}>
                      {formatEvidenceReviewStatus(evidence.reviewStatus)}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Evidence actions for ${evidence.title}`}
                          title="Evidence actions"
                          disabled={
                            props.busyAction === `${evidence.id}:archive` ||
                            props.busyAction === `${evidence.id}:renew`
                          }
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!evidence.id.includes(':seed:') && evidence.reviewStatus === 'pending' ? (
                          <DropdownMenuItem
                            disabled={props.busyAction === `${evidence.id}:review`}
                            onSelect={() => {
                              void props.onReviewEvidence({
                                evidenceId: evidence.id,
                              });
                            }}
                          >
                            <Check className="size-4" />
                            Approve
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => setPendingArchiveEvidence(evidence)}>
                          <Archive className="size-4" />
                          Archive
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPendingRenewEvidence(evidence)}>
                          <RefreshCw className="size-4" />
                          Renew
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {evidence.description ?? 'No additional description provided.'}
                  </p>
                  {evidence.url ? (
                    <p className="truncate text-xs text-muted-foreground">{evidence.url}</p>
                  ) : null}
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {evidence.source ? (
                      <p>
                        <span className="font-medium text-foreground">Source:</span>{' '}
                        {formatEvidenceSource(evidence.source)}
                      </p>
                    ) : null}
                    {evidence.evidenceDate ? (
                      <p>
                        <span className="font-medium text-foreground">Evidence date:</span>{' '}
                        {formatEvidenceDate(evidence.evidenceDate)}
                      </p>
                    ) : null}
                    {evidence.reviewDueAt ? (
                      <p>
                        <span className="font-medium text-foreground">Review due:</span>{' '}
                        {formatEvidenceDate(evidence.reviewDueAt)}
                      </p>
                    ) : null}
                    <p>
                      <span className="font-medium text-foreground">Added:</span>{' '}
                      {`${evidence.uploadedByDisplay ?? 'Unknown'} · ${formatEvidenceTimestamp(evidence.createdAt)}`}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">Reviewed:</span>{' '}
                      {evidence.reviewedAt
                        ? `${evidence.reviewedByDisplay ?? 'Not recorded'} · ${formatEvidenceTimestamp(evidence.reviewedAt)}`
                        : 'Not reviewed'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {evidence.evidenceType !== 'note' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void props.onOpenEvidence(evidence)}
                    >
                      Open
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap justify-start gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddingProof(true)}
              >
                Add evidence
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsHistoryOpen(true)}
              >
                <History className="size-4" />
                Evidence history
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-start gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsAddingProof(true)}
            >
              Add evidence
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsHistoryOpen(true)}
            >
              <History className="size-4" />
              Evidence history
            </Button>
          </div>
        )}
      </AccordionContent>

      <Dialog
        open={isAddingProof}
        onOpenChange={(open) => {
          setIsAddingProof(open);
          if (!open) {
            resetEvidenceComposer();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add evidence</DialogTitle>
            <DialogDescription>
              {item.label}. Suggested evidence: {item.suggestedEvidenceTypes.join(', ')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${item.itemId}-evidence-date`}>
                  Evidence date
                </label>
                <Input
                  id={`${item.itemId}-evidence-date`}
                  type="date"
                  value={evidenceDateInput}
                  onChange={(event) => setEvidenceDateInput(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${item.itemId}-review-due`}>
                  Review due
                </label>
                <Select
                  value={String(reviewDueIntervalMonths)}
                  onValueChange={(value) =>
                    setReviewDueIntervalMonths(Number(value) as EvidenceReviewDueIntervalMonths)
                  }
                >
                  <SelectTrigger id={`${item.itemId}-review-due`} className="w-full">
                    <SelectValue placeholder="Select interval" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_REVIEW_DUE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {formatEvidenceReviewDueInterval(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${item.itemId}-source`}>
                  Source
                </label>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as EvidenceSource)}
                >
                  <SelectTrigger id={`${item.itemId}-source`} className="w-full">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_SOURCE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {formatEvidenceSource(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Tabs
              value={proofComposerTab}
              onValueChange={(value) => setProofComposerTab(value as 'link' | 'note' | 'file')}
              className="space-y-3"
            >
              <TabsList className="w-full justify-start overflow-auto">
                <TabsTrigger value="link">Link</TabsTrigger>
                <TabsTrigger value="note">Note</TabsTrigger>
                <TabsTrigger value="file">File</TabsTrigger>
              </TabsList>

              <TabsContent value="link" className="space-y-2">
                <Input
                  value={linkTitle}
                  onChange={(event) => setLinkTitle(event.target.value)}
                  placeholder="Link title"
                />
                <Input
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://…"
                />
                <Textarea
                  value={linkDescription}
                  onChange={(event) => setLinkDescription(event.target.value)}
                  placeholder="What this evidence shows"
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddingProof(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      props.busyAction === linkKey ||
                      !metadataIsComplete ||
                      linkTitle.trim().length === 0 ||
                      linkUrl.trim().length === 0
                    }
                    onClick={() => {
                      const evidenceDate = parseEvidenceDateInput(evidenceDateInput);
                      if (evidenceDate === null || source === '') {
                        return;
                      }
                      void props
                        .onAddEvidenceLink({
                          evidenceDate,
                          internalControlId: control.internalControlId,
                          itemId: item.itemId,
                          reviewDueIntervalMonths,
                          source,
                          title: linkTitle,
                          url: linkUrl,
                          description: linkDescription,
                          sufficiency: 'sufficient',
                        })
                        .then(() => {
                          setIsAddingProof(false);
                          resetEvidenceComposer();
                        });
                    }}
                  >
                    {props.busyAction === linkKey ? 'Attaching…' : 'Attach link'}
                  </Button>
                </DialogFooter>
              </TabsContent>

              <TabsContent value="note" className="space-y-2">
                <Input
                  value={noteTitle}
                  onChange={(event) => setNoteTitle(event.target.value)}
                  placeholder="Note title"
                />
                <Textarea
                  value={noteDescription}
                  onChange={(event) => setNoteDescription(event.target.value)}
                  placeholder="Paste reviewer note or summary"
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddingProof(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      props.busyAction === noteKey ||
                      !metadataIsComplete ||
                      noteTitle.trim().length === 0 ||
                      noteDescription.trim().length === 0
                    }
                    onClick={() => {
                      const evidenceDate = parseEvidenceDateInput(evidenceDateInput);
                      if (evidenceDate === null || source === '') {
                        return;
                      }
                      void props
                        .onAddEvidenceNote({
                          evidenceDate,
                          internalControlId: control.internalControlId,
                          itemId: item.itemId,
                          reviewDueIntervalMonths,
                          source,
                          title: noteTitle,
                          description: noteDescription,
                          sufficiency: 'sufficient',
                        })
                        .then(() => {
                          setIsAddingProof(false);
                          resetEvidenceComposer();
                        });
                    }}
                  >
                    {props.busyAction === noteKey ? 'Saving…' : 'Attach note'}
                  </Button>
                </DialogFooter>
              </TabsContent>

              <TabsContent value="file" className="space-y-2">
                <Input
                  type="file"
                  disabled={!metadataIsComplete}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      return;
                    }
                    const evidenceDate = parseEvidenceDateInput(evidenceDateInput);
                    if (evidenceDate === null || source === '') {
                      event.target.value = '';
                      return;
                    }
                    void props
                      .onUploadEvidenceFile({
                        evidenceDate,
                        file,
                        internalControlId: control.internalControlId,
                        itemId: item.itemId,
                        reviewDueIntervalMonths,
                        source,
                        title: file.name,
                        sufficiency: 'sufficient',
                      })
                      .finally(() => {
                        event.target.value = '';
                        setIsAddingProof(false);
                        resetEvidenceComposer();
                      });
                  }}
                />
                {props.busyAction === fileKey ? (
                  <p className="text-xs text-muted-foreground">Uploading evidence file…</p>
                ) : null}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddingProof(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Evidence history</DialogTitle>
            <DialogDescription>{item.label}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {historyEvidence.length ? (
              <>
                <p className="text-sm font-medium">Archived evidence</p>
                {historyEvidence.map((evidence) => (
                  <div key={evidence.id} className="space-y-2 rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 flex-1 text-sm font-medium">{evidence.title}</p>
                      <div className="flex items-center gap-2">
                        {evidence.expiryStatus === 'expiring_soon' ? (
                          <Badge variant="secondary">Expiring soon</Badge>
                        ) : null}
                        <Badge variant={getEvidenceLifecycleBadgeVariant(evidence.lifecycleStatus)}>
                          {formatEvidenceLifecycleStatus(evidence.lifecycleStatus)}
                        </Badge>
                        <Badge variant={getEvidenceReviewBadgeVariant(evidence.reviewStatus)}>
                          {formatEvidenceReviewStatus(evidence.reviewStatus)}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {evidence.description ?? 'No additional description provided.'}
                    </p>
                    {evidence.url ? (
                      <p className="truncate text-xs text-muted-foreground">{evidence.url}</p>
                    ) : null}
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {evidence.source ? (
                        <p>
                          <span className="font-medium text-foreground">Source:</span>{' '}
                          {formatEvidenceSource(evidence.source)}
                        </p>
                      ) : null}
                      {evidence.evidenceDate ? (
                        <p>
                          <span className="font-medium text-foreground">Evidence date:</span>{' '}
                          {formatEvidenceDate(evidence.evidenceDate)}
                        </p>
                      ) : null}
                      {evidence.reviewDueAt ? (
                        <p>
                          <span className="font-medium text-foreground">Review due:</span>{' '}
                          {formatEvidenceDate(evidence.reviewDueAt)}
                        </p>
                      ) : null}
                      <p>
                        <span className="font-medium text-foreground">Added:</span>{' '}
                        {`${evidence.uploadedByDisplay ?? 'Unknown'} · ${formatEvidenceTimestamp(evidence.createdAt)}`}
                      </p>
                      <p>
                        <span className="font-medium text-foreground">Reviewed:</span>{' '}
                        {evidence.reviewedAt
                          ? `${evidence.reviewedByDisplay ?? 'Not recorded'} · ${formatEvidenceTimestamp(evidence.reviewedAt)}`
                          : 'Not reviewed'}
                      </p>
                      <p>
                        <span className="font-medium text-foreground">
                          {evidence.lifecycleStatus === 'superseded' ? 'Superseded:' : 'Archived:'}
                        </span>{' '}
                        {evidence.archivedAt
                          ? `${evidence.archivedByDisplay ?? 'Not recorded'} · ${formatEvidenceTimestamp(evidence.archivedAt)}`
                          : 'Not recorded'}
                      </p>
                    </div>
                    {evidence.evidenceType !== 'note' ? (
                      <div className="flex justify-start">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void props.onOpenEvidence(evidence)}
                        >
                          Open
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No archived evidence yet.</p>
            )}
            <div className="space-y-3">
              <p className="text-sm font-medium">Activity</p>
              {evidenceActivity === undefined ? (
                <p className="text-sm text-muted-foreground">Loading activity…</p>
              ) : evidenceActivity.length > 0 ? (
                <div className="space-y-2">
                  {evidenceActivity.map((event: SecurityChecklistEvidenceActivity) => (
                    <div key={event.id} className="space-y-1 rounded-md border px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">
                          {formatEvidenceActivityEvent(event.eventType)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatEvidenceTimestamp(event.createdAt)}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {event.actorDisplay ?? 'Unknown'} · {event.evidenceTitle}
                      </p>
                      {event.eventType === 'security_control_evidence_renewed' &&
                      event.renewedFromEvidenceId ? (
                        <p className="text-xs text-muted-foreground">
                          Renewed from {event.renewedFromEvidenceId}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={pendingArchiveEvidence !== null}
        onClose={() => setPendingArchiveEvidence(null)}
        title="Archive evidence?"
        description={
          pendingArchiveEvidence
            ? `${pendingArchiveEvidence.title} will be removed from the active checklist and kept in evidence history.`
            : 'This will archive the selected evidence item and preserve it in history.'
        }
        deleteText="Archive evidence"
        isDeleting={
          pendingArchiveEvidence
            ? props.busyAction === `${pendingArchiveEvidence.id}:archive`
            : false
        }
        pendingText="Archiving..."
        onConfirm={() => {
          if (!pendingArchiveEvidence) {
            return;
          }
          void props
            .onArchiveEvidence({
              evidenceId: pendingArchiveEvidence.id,
              internalControlId: control.internalControlId,
              itemId: item.itemId,
            })
            .then(() => {
              setPendingArchiveEvidence(null);
            });
        }}
      />

      <DeleteConfirmationDialog
        open={pendingRenewEvidence !== null}
        onClose={() => setPendingRenewEvidence(null)}
        title="Renew evidence?"
        description={
          pendingRenewEvidence
            ? `${pendingRenewEvidence.title} will be duplicated with a new added timestamp for now, its review metadata will be cleared, and the current evidence will move to history.`
            : 'This will create a renewed copy and archive the current evidence.'
        }
        deleteText="Renew evidence"
        isDeleting={
          pendingRenewEvidence ? props.busyAction === `${pendingRenewEvidence.id}:renew` : false
        }
        pendingText="Renewing..."
        onConfirm={() => {
          if (!pendingRenewEvidence) {
            return;
          }
          void props
            .onRenewEvidence({
              evidenceId: pendingRenewEvidence.id,
              internalControlId: control.internalControlId,
              itemId: item.itemId,
            })
            .then(() => {
              setPendingRenewEvidence(null);
            });
        }}
      />
    </AccordionItem>
  );
}

function DetailSection(props: { children: ReactNode; title: string }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      {props.children}
    </section>
  );
}

function DetailItem(props: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </dt>
      <dd className="text-sm text-foreground">{props.value}</dd>
    </div>
  );
}

function FrameworkAccordionItem(props: { title: string; value: string; values: string[] }) {
  return (
    <AccordionItem value={props.value} className="border-b last:border-b-0">
      <AccordionTrigger className="px-4 py-3 text-sm">{props.title}</AccordionTrigger>
      <AccordionContent className="px-4">
        {props.values.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {props.values.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No mappings available.</p>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function formatHipaaMapping(mapping: SecurityControlWorkspace['mappings']['hipaa'][number]) {
  const description = mapping.text ?? mapping.title;
  return `${mapping.citation}${description ? ` · ${description}` : ''}`;
}

function formatControlResponsibility(responsibility: ControlResponsibility | null) {
  return getControlResponsibilityDisplayLabel(responsibility);
}

function getResponsibilityBadgeVariant(
  responsibility: ControlResponsibility | null,
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (responsibility) {
    case 'platform':
      return 'default';
    case 'shared-responsibility':
      return 'secondary';
    case 'customer':
      return 'destructive';
    case null:
      return 'outline';
  }
}

function getEvidenceReadinessBadgeVariant(
  readiness: SecurityControlWorkspace['evidenceReadiness'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (readiness) {
    case 'ready':
      return 'default';
    case 'partial':
      return 'outline';
    case 'missing':
      return 'destructive';
  }
}

function getChecklistStatusBadgeVariant(
  status: SecurityChecklistItem['status'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (status) {
    case 'done':
      return 'default';
    case 'in_progress':
      return 'secondary';
    case 'not_started':
      return 'secondary';
    case 'not_applicable':
      return 'destructive';
  }
}

function formatEvidenceReadiness(readiness: SecurityControlWorkspace['evidenceReadiness']) {
  switch (readiness) {
    case 'ready':
      return 'Complete';
    case 'partial':
      return 'Partial';
    case 'missing':
      return 'Missing';
  }
}

function getEvidenceProgress(control: SecurityControlWorkspace) {
  const checklistItems = control.platformChecklist;
  const completeItems = checklistItems.filter((item) => item.status === 'done');

  return {
    completeCount: completeItems.length,
    label: `${completeItems.length}/${checklistItems.length}`,
    requiredCount: checklistItems.length,
  };
}

function formatChecklistStatus(status: SecurityChecklistItem['status']) {
  switch (status) {
    case 'done':
      return 'Completed';
    case 'in_progress':
      return 'Incomplete';
    case 'not_started':
      return 'Incomplete';
    case 'not_applicable':
      return 'Incomplete';
  }
}

function getEvidenceReviewBadgeVariant(
  reviewStatus: SecurityChecklistEvidence['reviewStatus'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (reviewStatus) {
    case 'reviewed':
      return 'default';
    case 'pending':
      return 'outline';
  }
}

function getEvidenceLifecycleBadgeVariant(
  lifecycleStatus: SecurityChecklistEvidence['lifecycleStatus'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (lifecycleStatus) {
    case 'active':
      return 'outline';
    case 'archived':
      return 'secondary';
    case 'superseded':
      return 'outline';
  }
}

function formatEvidenceReviewStatus(reviewStatus: SecurityChecklistEvidence['reviewStatus']) {
  switch (reviewStatus) {
    case 'reviewed':
      return 'Reviewed';
    case 'pending':
      return 'Pending review';
  }
}

function formatEvidenceActivityEvent(eventType: SecurityChecklistEvidenceActivity['eventType']) {
  switch (eventType) {
    case 'security_control_evidence_created':
      return 'Added';
    case 'security_control_evidence_reviewed':
      return 'Approved';
    case 'security_control_evidence_archived':
      return 'Archived';
    case 'security_control_evidence_renewed':
      return 'Renewed';
  }
}

function formatEvidenceLifecycleStatus(
  lifecycleStatus: SecurityChecklistEvidence['lifecycleStatus'],
) {
  switch (lifecycleStatus) {
    case 'active':
      return 'Active';
    case 'archived':
      return 'Archived';
    case 'superseded':
      return 'Superseded';
  }
}

function getTodayDateInputValue() {
  const date = new Date();
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function parseEvidenceDateInput(value: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function formatEvidenceDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString();
}

function formatEvidenceReviewDueInterval(interval: EvidenceReviewDueIntervalMonths) {
  switch (interval) {
    case 3:
      return '3 months';
    case 6:
      return '6 months';
    case 12:
      return '1 year';
  }
}

function formatEvidenceSource(source: EvidenceSource) {
  switch (source) {
    case 'manual_upload':
      return 'Manual upload';
    case 'internal_review':
      return 'Internal review';
    case 'automated_system_check':
      return 'Automated system check';
    case 'external_report':
      return 'External report';
    case 'vendor_attestation':
      return 'Vendor attestation';
  }
}

function formatEvidenceTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function SummaryCard(props: {
  description: string;
  footer?: string;
  title: string;
  value: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-semibold">{props.value}</div>
        {props.footer ? <p className="text-sm text-muted-foreground">{props.footer}</p> : null}
      </CardContent>
    </Card>
  );
}
