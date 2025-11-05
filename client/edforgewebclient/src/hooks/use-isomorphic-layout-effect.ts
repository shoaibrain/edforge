import { useEffect, useLayoutEffect } from 'react';

/**
 * Hook to use useLayoutEffect on the client and useEffect on the server
 * to prevent hydration mismatches
 */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
