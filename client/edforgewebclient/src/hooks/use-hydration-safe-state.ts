import { useState, useEffect } from 'react';

/**
 * Hook to safely manage state that might differ between server and client
 * to prevent hydration mismatches
 */
export function useHydrationSafeState<T>(initialValue: T, clientValue: T) {
	const [value, setValue] = useState(initialValue);
	const [isClient, setIsClient] = useState(false);

	useEffect(() => {
		setIsClient(true);
		setValue(clientValue);
	}, [clientValue]);

	return isClient ? value : initialValue;
}
