import { useMemo } from 'react';
import type { TableFilterOption } from '~/components/data-table';
import { ACTIVE_CONTROL_REGISTER } from '~/lib/shared/compliance/control-register';
import type { SecurityControlWorkspaceSummary } from '~/features/security/types';

export function useSecurityControlTable(args: {
  controls: SecurityControlWorkspaceSummary[];
  evidenceReadinessFilter: 'all' | SecurityControlWorkspaceSummary['evidenceReadiness'];
  familyFilter: string;
  page: number;
  pageSize: number;
  responsibilityFilter: 'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>;
  searchTerm: string;
  sortBy: 'control' | 'evidence' | 'responsibility' | 'family';
  sortOrder: 'asc' | 'desc';
}) {
  const familyOptions = useMemo<TableFilterOption<string>[]>(
    () => [
      { label: 'All families', value: 'all' },
      ...Array.from(
        new Map(
          (args.controls.length > 0 ? args.controls : ACTIVE_CONTROL_REGISTER.controls).map(
            (control) => [control.familyId, control.familyTitle],
          ),
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
    [args.controls],
  );

  const responsibilityOptions = useMemo<
    TableFilterOption<'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>>[]
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
    TableFilterOption<'all' | SecurityControlWorkspaceSummary['evidenceReadiness']>[]
  >(
    () => [
      { label: 'All evidence', value: 'all' },
      { label: 'Complete', value: 'ready' },
      { label: 'Partial', value: 'partial' },
      { label: 'Missing', value: 'missing' },
    ],
    [],
  );

  const normalizedControlSearchTerm = args.searchTerm.trim().toLowerCase();
  const filteredControls = useMemo(
    () =>
      args.controls.filter((control) => {
        if (
          args.responsibilityFilter !== 'all' &&
          control.responsibility !== args.responsibilityFilter
        ) {
          return false;
        }

        if (
          args.evidenceReadinessFilter !== 'all' &&
          control.evidenceReadiness !== args.evidenceReadinessFilter
        ) {
          return false;
        }

        if (args.familyFilter !== 'all' && control.familyId !== args.familyFilter) {
          return false;
        }

        if (normalizedControlSearchTerm.length === 0) {
          return true;
        }

        return control.searchableText.includes(normalizedControlSearchTerm);
      }),
    [
      args.controls,
      args.evidenceReadinessFilter,
      args.familyFilter,
      normalizedControlSearchTerm,
      args.responsibilityFilter,
    ],
  );

  const sortedControls = useMemo(() => {
    const sorted = [...filteredControls];
    sorted.sort((left, right) => {
      const direction = args.sortOrder === 'asc' ? 1 : -1;
      let comparison = 0;

      switch (args.sortBy) {
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

      return left.internalControlId.localeCompare(right.internalControlId) * direction;
    });

    return sorted;
  }, [args.sortBy, args.sortOrder, filteredControls]);

  const totalControlPages = Math.max(1, Math.ceil(sortedControls.length / args.pageSize));
  const currentControlPage = Math.min(args.page, totalControlPages);

  const paginatedControls = useMemo(() => {
    const startIndex = (currentControlPage - 1) * args.pageSize;
    return sortedControls.slice(startIndex, startIndex + args.pageSize);
  }, [currentControlPage, args.pageSize, sortedControls]);

  const controlPagination = useMemo(
    () => ({
      page: currentControlPage,
      pageSize: args.pageSize,
      total: sortedControls.length,
      totalPages: totalControlPages,
    }),
    [currentControlPage, args.pageSize, sortedControls.length, totalControlPages],
  );

  const controlSearchParams = useMemo(
    () => ({
      page: currentControlPage,
      pageSize: args.pageSize,
      sortBy: args.sortBy,
      sortOrder: args.sortOrder,
    }),
    [currentControlPage, args.pageSize, args.sortBy, args.sortOrder],
  );

  return {
    controlPagination,
    controlSearchParams,
    currentControlPage,
    evidenceReadinessOptions,
    familyOptions,
    paginatedControls,
    responsibilityOptions,
    sortedControls,
  };
}
