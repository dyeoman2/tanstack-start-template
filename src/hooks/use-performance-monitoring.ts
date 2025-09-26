import * as React from 'react';

const isDevMode = import.meta.env.DEV;
const debugFlag = String(import.meta.env.VITE_DEBUG ?? '').toLowerCase();
const isPerformanceDebugEnabled = debugFlag === 'true' || debugFlag === '1';
/**
 * Dedicated performance monitoring hook for development
 *
 * This hook provides performance monitoring capabilities that only run in development mode.
 * It measures route load times, paint metrics, and other performance indicators.
 * In production, this hook is a no-op to avoid any performance impact.
 */

export function usePerformanceMonitoring(routeName: string) {
  // Always call useEffect, but only run performance monitoring in development
  React.useEffect(() => {
    if (!isDevMode || !isPerformanceDebugEnabled) {
      return;
    }

    if (typeof window === 'undefined' || !('performance' in window)) {
      return;
    }

    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

    if (!navigation) return;

    const loadTime = navigation.loadEventEnd - navigation.fetchStart;
    console.log(`🚀 [Performance] ${routeName} route load time: ${loadTime.toFixed(2)}ms`);

    // Log additional performance metrics
    const domContentLoaded = navigation.domContentLoadedEventEnd - navigation.fetchStart;
    const firstPaint = performance.getEntriesByName('first-paint')[0] as PerformanceEntry;
    const firstContentfulPaint = performance.getEntriesByName(
      'first-contentful-paint',
    )[0] as PerformanceEntry;

    console.log(`📊 [Performance] DOM Content Loaded: ${domContentLoaded.toFixed(2)}ms`);

    if (firstPaint) {
      console.log(`🎨 [Performance] First Paint: ${firstPaint.startTime.toFixed(2)}ms`);
    }

    if (firstContentfulPaint) {
      console.log(
        `📝 [Performance] First Contentful Paint: ${firstContentfulPaint.startTime.toFixed(2)}ms`,
      );
    }

    // Optional: Measure Largest Contentful Paint
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1] as PerformanceEntry;

      if (lastEntry) {
        console.log(
          `🏆 [Performance] Largest Contentful Paint: ${lastEntry.startTime.toFixed(2)}ms`,
        );
      }
    });

    try {
      observer.observe({ entryTypes: ['largest-contentful-paint'] });

      // Cleanup observer on unmount
      return () => observer.disconnect();
    } catch {
      // LCP might not be supported in all browsers
      console.warn('[Performance] LCP not supported in this browser');
    }
  }, [routeName]);
}
