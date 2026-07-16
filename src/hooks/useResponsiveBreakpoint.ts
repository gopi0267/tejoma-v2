import { useState, useEffect } from 'react';

export interface ResponsiveBreakpoint {
  isMobile: boolean;       // < 768px
  isTablet: boolean;       // 768px - 1023px
  isDesktop: boolean;      // >= 1024px
  isMobileLandscape: boolean; // short + wide viewport (phone rotated), regardless of width
}

function computeBreakpoint(): ResponsiveBreakpoint {
  const width = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const height = typeof window !== 'undefined' ? window.innerHeight : 768;
  return {
    isMobile: width < 768,
    isTablet: width >= 768 && width < 1024,
    isDesktop: width >= 1024,
    isMobileLandscape: height < 500 && width > height,
  };
}

// Consolidates the isMobile/isTablet/isMobileLandscape resize-listener logic that was
// previously duplicated independently in JobManagement.tsx, RecruiterReview.tsx, and (a richer
// version of) SwipeInterface.tsx.
export function useResponsiveBreakpoint(): ResponsiveBreakpoint {
  const [breakpoint, setBreakpoint] = useState<ResponsiveBreakpoint>(computeBreakpoint);

  useEffect(() => {
    const handleResize = () => setBreakpoint(computeBreakpoint());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return breakpoint;
}
