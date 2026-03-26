import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { SECURITY_TAB_PATHS, SECURITY_TABS } from '~/features/security/constants';
import type { SecurityTab } from '~/features/security/search';
import type { ReviewRunSummary, VendorWorkspace } from '~/features/security/types';

export function isSecurityTab(value: string): value is SecurityTab {
  return SECURITY_TABS.includes(value as SecurityTab);
}

export function getSecurityPath(tab: SecurityTab) {
  return SECURITY_TAB_PATHS[tab];
}

export function useSecurityNavigation() {
  const navigate = useNavigate();

  const navigateToControl = useCallback(
    (internalControlId: string) => {
      void navigate({
        to: getSecurityPath('controls'),
        search: {
          selectedControl: internalControlId,
        },
      });
    },
    [navigate],
  );

  const navigateToPolicy = useCallback(
    (policyId: string) => {
      void navigate({
        to: getSecurityPath('policies'),
        search: {
          selectedPolicy: policyId,
        },
      });
    },
    [navigate],
  );

  const navigateToFinding = useCallback(
    (findingKey: string) => {
      void navigate({
        to: getSecurityPath('findings'),
        search: {
          selectedFinding: findingKey,
        },
      });
    },
    [navigate],
  );

  const navigateToReport = useCallback(
    (reportId: string) => {
      void navigate({
        to: getSecurityPath('reviews'),
        search: {
          selectedReport: reportId,
        },
      });
    },
    [navigate],
  );

  const navigateToVendor = useCallback(
    (vendorKey: VendorWorkspace['vendor']) => {
      void navigate({
        to: getSecurityPath('vendors'),
        search: {
          selectedVendor: vendorKey,
        },
      });
    },
    [navigate],
  );

  const navigateToReviews = useCallback(
    (selectedReviewRun?: ReviewRunSummary['id']) => {
      void navigate({
        to: getSecurityPath('reviews'),
        search: selectedReviewRun
          ? {
              selectedReviewRun,
            }
          : {},
      });
    },
    [navigate],
  );

  return {
    navigateToControl,
    navigateToFinding,
    navigateToPolicy,
    navigateToReport,
    navigateToReviews,
    navigateToVendor,
  };
}
