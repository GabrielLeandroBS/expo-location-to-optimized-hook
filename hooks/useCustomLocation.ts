import * as Location from "expo-location";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

// Optional AsyncStorage for persistence (gracefully handles if not available)
type AsyncStorageType = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

let AsyncStorage: AsyncStorageType | null = null;
try {
  // Dynamic import to avoid breaking if AsyncStorage is not installed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const storage = require("@react-native-async-storage/async-storage");
  AsyncStorage = storage.default || storage;
} catch {
  // AsyncStorage not available, persistence will be disabled
}

/**
 * Cached location data structure
 */
type CachedLocation = {
  coords: Location.LocationObjectCoords;
  address: Location.LocationGeocodedAddress | null;
  timestamp: number;
  cacheTTL: number; // Store TTL with cache to support different TTLs per instance
};

/**
 * Configuration constants for location caching and accuracy
 */
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache validity
const LAST_KNOWN_POSITION_MAX_AGE = 60 * 1000; // 1 minute - considers last known position valid if recent
const REQUIRED_ACCURACY_THRESHOLD = 100; // Accepts up to 100m accuracy for fast response
const SIGNIFICANT_CHANGE_THRESHOLD = 0.0001; // ~11 meters - minimum change to trigger update
const REVERSE_GEOCODE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const CACHE_CLEANUP_THRESHOLD = 50; // Clean cache when it exceeds this size
const POLLING_INTERVAL = 200; // Interval for waiting on concurrent fetches
const CACHE_CLEANUP_DEBOUNCE = 5000; // 5 seconds debounce for cache cleanup
const ASYNC_STORAGE_KEY = "cached_location"; // Key for persisted location cache

/**
 * Global cache to share location data across hook instances
 * Uses the most recent cache regardless of TTL for instant UX
 */
let cachedLocation: CachedLocation | null = null;

/**
 * Cache for reverse geocoding to avoid duplicate calls for same coordinates
 */
const reverseGeocodeCache = new Map<
  string,
  {
    address: Location.LocationGeocodedAddress | null;
    timestamp: number;
  }
>();

/**
 * Pending reverse geocode requests to prevent duplicate concurrent calls
 */
const pendingReverseGeocodeRequests = new Map<
  string,
  Promise<Location.LocationGeocodedAddress | null>
>();

/**
 * Mutex for protecting global fetch operations
 * Prevents race conditions when multiple hook instances mount simultaneously
 */
class FetchMutex {
  private isLocked = false;
  private waiters: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (!this.isLocked) {
      this.isLocked = true;
      return () => {
        this.isLocked = false;
        const next = this.waiters.shift();
        if (next) {
          this.isLocked = true;
          next();
        }
      };
    }

    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => {
        this.isLocked = true;
        resolve(() => {
          this.isLocked = false;
          const next = this.waiters.shift();
          if (next) {
            this.isLocked = true;
            next();
          }
        });
      });
    });
  }
}

const fetchMutex = new FetchMutex();

/**
 * Options for customizing location fetching behavior
 */
export type UseLocationOptions = {
  /**
   * Cache time-to-live in milliseconds
   * @default 5 * 60 * 1000 (5 minutes)
   */
  cacheTTL?: number;
  /**
   * Maximum age for last known position in milliseconds
   * @default 60 * 1000 (1 minute)
   */
  lastKnownPositionMaxAge?: number;
  /**
   * Initial accuracy level for fast response
   * @default Location.LocationAccuracy.Low
   */
  initialAccuracy?: Location.LocationAccuracy;
  /**
   * Refined accuracy level for background update
   * @default Location.LocationAccuracy.Balanced
   */
  refinedAccuracy?: Location.LocationAccuracy;
  /**
   * Whether to enable background refinement
   * @default true
   */
  enableRefinement?: boolean;
  /**
   * Minimum distance change in degrees to trigger update
   * @default 0.0001 (~11 meters)
   */
  significantChangeThreshold?: number;
  /**
   * Whether to automatically fetch location on mount
   * @default true
   */
  autoFetch?: boolean;
};

/**
 * Return type for the useLocation hook
 */
export type UseLocationResult = {
  /** Current coordinates or null if not available */
  coords: Location.LocationObjectCoords | null;
  /** Reverse geocoded address or null if not available */
  address: Location.LocationGeocodedAddress | null;
  /** Whether location is currently being fetched */
  loading: boolean;
  /** Error message if location fetch failed, null otherwise */
  error: string | null;
  /** Function to manually refresh location */
  refresh: () => Promise<void>;
};

/**
 * Creates a cache key from coordinates (optimized)
 * Uses 4 decimal places precision (~11m accuracy)
 */
const createCacheKey = (coords: Location.LocationObjectCoords): string => {
  const lat = Math.round(coords.latitude * 10000) / 10000;
  const lng = Math.round(coords.longitude * 10000) / 10000;
  return `${lat},${lng}`;
};

/**
 * Cleans expired entries from reverse geocode cache
 * Only cleans when cache exceeds threshold to avoid unnecessary iterations
 */
const cleanReverseGeocodeCache = (): void => {
  if (reverseGeocodeCache.size <= CACHE_CLEANUP_THRESHOLD) return;

  const now = Date.now();
  const keysToDelete: string[] = [];

  for (const [key, value] of reverseGeocodeCache.entries()) {
    if (now - value.timestamp > REVERSE_GEOCODE_CACHE_TTL) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach((key) => reverseGeocodeCache.delete(key));
};

/**
 * Debounced cache cleanup to avoid excessive cleanup operations
 */
let cleanupScheduled = false;
let cleanupTimeoutId: ReturnType<typeof setTimeout> | null = null;

const scheduleCacheCleanup = (): void => {
  if (cleanupScheduled) return;

  cleanupScheduled = true;
  if (cleanupTimeoutId) {
    clearTimeout(cleanupTimeoutId);
  }

  cleanupTimeoutId = setTimeout(() => {
    cleanReverseGeocodeCache();
    cleanupScheduled = false;
    cleanupTimeoutId = null;
  }, CACHE_CLEANUP_DEBOUNCE);
};

/**
 * Loads cached location from AsyncStorage if available
 */
const loadPersistedLocation = async (): Promise<CachedLocation | null> => {
  if (!AsyncStorage) return null;

  try {
    const stored = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as CachedLocation;
    // Validate structure
    if (
      parsed &&
      parsed.coords &&
      typeof parsed.coords.latitude === "number" &&
      typeof parsed.coords.longitude === "number" &&
      typeof parsed.timestamp === "number"
    ) {
      return parsed;
    }
  } catch {
    // Ignore errors - corrupted or invalid data
  }

  return null;
};

/**
 * Persists cached location to AsyncStorage
 */
const persistLocation = async (
  location: CachedLocation | null
): Promise<void> => {
  if (!AsyncStorage) return;

  try {
    if (location) {
      await AsyncStorage.setItem(ASYNC_STORAGE_KEY, JSON.stringify(location));
    } else {
      await AsyncStorage.removeItem(ASYNC_STORAGE_KEY);
    }
  } catch {
    // Ignore errors - persistence is optional
  }
};

/**
 * Helper function to perform reverse geocoding asynchronously with caching
 * Prevents duplicate calls for the same coordinates (both cached and concurrent)
 * @param coords - Coordinates to reverse geocode
 * @param signal - AbortSignal to cancel the request
 * @returns Geocoded address or null if failed
 */
const reverseGeocodeAsync = async (
  coords: Location.LocationObjectCoords,
  signal?: AbortSignal
): Promise<Location.LocationGeocodedAddress | null> => {
  if (signal?.aborted) return null;

  const cacheKey = createCacheKey(coords);
  const cached = reverseGeocodeCache.get(cacheKey);
  const now = Date.now();

  // Return cached result if valid
  if (cached && now - cached.timestamp < REVERSE_GEOCODE_CACHE_TTL) {
    return cached.address;
  }

  // Return existing pending request if any (prevents duplicate concurrent calls)
  const pendingRequest = pendingReverseGeocodeRequests.get(cacheKey);
  if (pendingRequest) {
    // Check if signal was aborted before returning pending request
    if (signal?.aborted) return null;
    return pendingRequest;
  }

  // Create new request
  const requestPromise = (async () => {
    try {
      if (signal?.aborted) return null;

      const [address] = await Location.reverseGeocodeAsync({
        latitude: coords.latitude,
        longitude: coords.longitude,
      });

      if (signal?.aborted) return null;

      // Calculate timestamp right before saving to ensure accuracy
      const saveTimestamp = Date.now();
      const result = address ?? null;
      reverseGeocodeCache.set(cacheKey, {
        address: result,
        timestamp: saveTimestamp,
      });

      // Schedule debounced cache cleanup
      if (reverseGeocodeCache.size > CACHE_CLEANUP_THRESHOLD) {
        scheduleCacheCleanup();
      }

      return result;
    } catch (error) {
      if (signal?.aborted) return null;
      // Log error for debugging but don't throw
      if (__DEV__) {
        console.warn("Reverse geocoding failed:", error);
      }
      return null;
    } finally {
      // Remove from pending requests
      pendingReverseGeocodeRequests.delete(cacheKey);
    }
  })();

  // Store pending request after creation to ensure it's fully initialized
  pendingReverseGeocodeRequests.set(cacheKey, requestPromise);

  return requestPromise;
};

/**
 * Custom React hook for fetching and managing device location
 *
 * Features:
 * - Fast response using cached location and last known position
 * - Progressive accuracy (low → balanced)
 * - Automatic reverse geocoding
 * - Memory leak protection with AbortController
 * - Race condition prevention with mutex
 * - Optimized cache management
 *
 * @param options - Optional configuration for location fetching
 * @returns Location data, loading state, error, and refresh function
 *
 * @example
 * ```tsx
 * const { coords, address, loading, error, refresh } = useLocation();
 *
 * if (loading) return <Text>Loading location...</Text>;
 * if (error) return <Text>Error: {error}</Text>;
 *
 * return <Text>Lat: {coords?.latitude}, Lng: {coords?.longitude}</Text>;
 * ```
 */
const useLocation = (options: UseLocationOptions = {}): UseLocationResult => {
  const {
    cacheTTL = CACHE_TTL,
    lastKnownPositionMaxAge = LAST_KNOWN_POSITION_MAX_AGE,
    initialAccuracy = Location.LocationAccuracy.Low,
    refinedAccuracy = Location.LocationAccuracy.Balanced,
    enableRefinement = true,
    significantChangeThreshold = SIGNIFICANT_CHANGE_THRESHOLD,
    autoFetch = true,
  } = options;

  const [coords, setCoords] = useState<Location.LocationObjectCoords | null>(
    null
  );
  const [address, setAddress] =
    useState<Location.LocationGeocodedAddress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const isFetchingRef = useRef(false);
  const hasInitialFetchRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Safely updates state only if component is still mounted
   */
  const safeSetState = useCallback(
    <T>(
      setter: Dispatch<SetStateAction<T>>,
      value: SetStateAction<T>
    ): void => {
      if (isMountedRef.current) {
        setter(value);
      }
    },
    []
  );

  /**
   * Helper to check if operation should continue (mounted and not aborted)
   */
  const shouldContinue = useCallback((signal?: AbortSignal): boolean => {
    return isMountedRef.current && !signal?.aborted;
  }, []);

  /**
   * Checks if location changed significantly
   */
  const hasSignificantChange = useCallback(
    (
      oldCoords: Location.LocationObjectCoords,
      newCoords: Location.LocationObjectCoords
    ): boolean => {
      return (
        Math.abs(newCoords.latitude - oldCoords.latitude) >
          significantChangeThreshold ||
        Math.abs(newCoords.longitude - oldCoords.longitude) >
          significantChangeThreshold
      );
    },
    [significantChangeThreshold]
  );

  /**
   * Updates location state and cache
   * Only updates cache if component is still mounted
   * Prevents race conditions by ignoring outdated updates
   */
  const updateLocation = useCallback(
    (
      location: Location.LocationObject,
      geocodedAddress: Location.LocationGeocodedAddress | null
    ): void => {
      if (!isMountedRef.current) return;

      const timestamp = Date.now();

      // Ignore updates that are older than current cache (prevents race conditions)
      if (cachedLocation && timestamp < cachedLocation.timestamp) {
        return;
      }

      // React 19 automatically batches state updates
      setCoords(location.coords);
      setAddress(geocodedAddress);

      // Update cache only if component is mounted
      const newCachedLocation: CachedLocation = {
        coords: location.coords,
        address: geocodedAddress,
        timestamp,
        cacheTTL,
      };
      cachedLocation = newCachedLocation;

      // Persist to AsyncStorage asynchronously (non-blocking)
      void persistLocation(newCachedLocation);
    },
    [cacheTTL]
  );

  /**
   * Fetches location using true Promise.race for fastest response
   * Optimized to prefer last known position (instant) over new fetch
   */
  const fetchLocationWithRace = useCallback(
    async (signal: AbortSignal): Promise<Location.LocationObject | null> => {
      // Try last known position first (usually instant)
      const lastKnownPromise = Location.getLastKnownPositionAsync({
        maxAge: lastKnownPositionMaxAge,
        requiredAccuracy: REQUIRED_ACCURACY_THRESHOLD,
      })
        .catch(() => null)
        .then((result) => {
          if (signal.aborted) return null;
          return result;
        });

      // Start new position fetch in parallel
      const newPositionPromise = Location.getCurrentPositionAsync({
        accuracy: initialAccuracy,
      })
        .catch(() => null)
        .then((result) => {
          if (signal.aborted) return null;
          return result;
        });

      // True Promise.race - get whichever resolves first
      // Last known is usually faster, so this optimizes for common case
      const raceResult = await Promise.race([
        lastKnownPromise,
        newPositionPromise,
      ]);

      if (signal.aborted) return null;
      if (raceResult) return raceResult;

      // Fallback: wait for both and get first valid result
      // Use Promise.allSettled for better error handling
      const [lastKnown, newPosition] = await Promise.allSettled([
        lastKnownPromise,
        newPositionPromise,
      ]);

      if (signal.aborted) return null;

      // Prefer lastKnown if available (it's usually more recent)
      if (lastKnown.status === "fulfilled" && lastKnown.value) {
        return lastKnown.value;
      }

      if (newPosition.status === "fulfilled" && newPosition.value) {
        return newPosition.value;
      }

      return null;
    },
    [lastKnownPositionMaxAge, initialAccuracy]
  );

  /**
   * Fetches the current location using optimized strategy:
   * 1. Checks cache (fastest)
   * 2. Uses last known position (very fast)
   * 3. Fetches new location with low accuracy (fast)
   * 4. Refines with higher accuracy in background (optional)
   */
  const fetchLocation = useCallback(async () => {
    // Prevent concurrent fetches - use mutex-like check with early return
    // Note: This is not perfectly atomic, but combined with isFetchingRef check
    // in the caller and mutex protection during initialization, it's safe enough
    if (isFetchingRef.current) return;

    // Cancel any previous fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this fetch
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;

    isFetchingRef.current = true;
    safeSetState(setLoading, true as SetStateAction<boolean>);
    safeSetState(setError, null as SetStateAction<string | null>);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (signal.aborted) return;
      if (status !== "granted") {
        throw new Error(
          "Unable to access your location. Check your device settings."
        );
      }

      const location = await fetchLocationWithRace(signal);
      if (signal.aborted) return;
      if (!location) {
        throw new Error("Unable to get location. Please try again.");
      }

      if (!isMountedRef.current) {
        return;
      }

      // React 19 automatically batches state updates
      setCoords(location.coords);
      setLoading(false);

      // Fetch address asynchronously (non-blocking)
      void reverseGeocodeAsync(location.coords, signal).then(
        (geocodedAddress) => {
          if (shouldContinue(signal)) {
            updateLocation(location, geocodedAddress);
          }
        }
      );

      // Optionally refine location in background (non-blocking)
      if (enableRefinement && shouldContinue(signal)) {
        void Location.getCurrentPositionAsync({ accuracy: refinedAccuracy })
          .then((refinedLocation) => {
            if (
              shouldContinue(signal) &&
              hasSignificantChange(location.coords, refinedLocation.coords)
            ) {
              // Update location with refined coordinates and address
              void reverseGeocodeAsync(refinedLocation.coords, signal).then(
                (geocodedAddress) => {
                  if (shouldContinue(signal)) {
                    updateLocation(refinedLocation, geocodedAddress);
                  }
                }
              );
            }
          })
          .catch(() => {
            // Silently ignore - we already have a valid location
          });
      }
    } catch (fetchError) {
      if (signal.aborted) return;
      if (isMountedRef.current) {
        safeSetState(
          setError,
          (fetchError instanceof Error
            ? fetchError.message
            : "Unable to access your location. Check your device settings.") as SetStateAction<
            string | null
          >
        );
        safeSetState(
          setCoords,
          null as SetStateAction<Location.LocationObjectCoords | null>
        );
        safeSetState(
          setAddress,
          null as SetStateAction<Location.LocationGeocodedAddress | null>
        );
        safeSetState(setLoading, false as SetStateAction<boolean>);
      }
    } finally {
      // Always reset fetching flag, even on early returns or errors
      isFetchingRef.current = false;
    }
  }, [
    safeSetState,
    fetchLocationWithRace,
    enableRefinement,
    refinedAccuracy,
    hasSignificantChange,
    updateLocation,
    shouldContinue,
  ]);

  /**
   * Checks if cache is valid for this instance's TTL
   */
  const isCacheValid = useCallback((): boolean => {
    if (!cachedLocation) return false;
    const now = Date.now();
    // Use the instance's cacheTTL, but fallback to cached TTL if available
    const effectiveTTL = cachedLocation.cacheTTL || cacheTTL;
    return now - cachedLocation.timestamp < effectiveTTL;
  }, [cacheTTL]);

  /**
   * Applies cached location to state
   */
  const applyCachedLocation = useCallback((): void => {
    if (!cachedLocation || !isMountedRef.current) return;

    // React 19 automatically batches state updates
    setCoords(cachedLocation.coords);
    setAddress(cachedLocation.address);
    setError(null);
    setLoading(false);
    hasInitialFetchRef.current = true;
  }, []);

  // Reset mounted ref when component mounts
  useEffect(() => {
    isMountedRef.current = true;
    hasInitialFetchRef.current = false;
    return () => {
      isMountedRef.current = false;
      hasInitialFetchRef.current = false;
      // Cancel any pending operations
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      isFetchingRef.current = false;
    };
  }, []);

  // Initialize location on mount - prevent duplicate calls on first render
  useEffect(() => {
    if (!autoFetch || hasInitialFetchRef.current) return;

    // Try to load persisted location first
    void loadPersistedLocation().then((persisted) => {
      if (persisted && !cachedLocation) {
        cachedLocation = persisted;
      }
    });

    // Show cached location immediately (even if expired) for instant UX
    // Then fetch fresh data in background if cache is invalid
    if (cachedLocation) {
      applyCachedLocation(); // Show something on screen immediately
      if (isCacheValid()) {
        // Cache is still valid, no need to refetch
        hasInitialFetchRef.current = true;
        return;
      }
      // Cache expired, will fetch fresh data below
    }

    // Use mutex to prevent multiple hook instances from fetching simultaneously
    let releaseMutex: (() => void) | null = null;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Helper to check and apply valid cache (defined inside useEffect for closure access)
    const checkAndApplyCache = (): boolean => {
      if (cachedLocation && isCacheValid()) {
        applyCachedLocation();
        hasInitialFetchRef.current = true;
        return true;
      }
      return false;
    };

    const initializeLocation = async () => {
      try {
        // Acquire mutex lock with cancellation support to prevent deadlocks
        const mutexPromise = fetchMutex.acquire();
        const cancellationPromise = new Promise<(() => void) | null>(
          (resolve) => {
            const checkCancelled = () => {
              if (cancelled || !isMountedRef.current) {
                resolve(null);
              } else {
                setTimeout(checkCancelled, 100);
              }
            };
            checkCancelled();
          }
        );

        releaseMutex = await Promise.race([mutexPromise, cancellationPromise]);
        if (!releaseMutex || cancelled || !isMountedRef.current) {
          return;
        }

        // Re-check cache after acquiring lock (another instance might have updated it)
        if (checkAndApplyCache()) {
          releaseMutex?.();
          return;
        }

        // Wait for any ongoing fetch with polling
        while (isFetchingRef.current && !cancelled && isMountedRef.current) {
          await new Promise<void>((resolve) => {
            timeoutId = setTimeout(resolve, POLLING_INTERVAL);
          });
        }

        // Clean up timeout after loop
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (cancelled || !isMountedRef.current) {
          releaseMutex?.();
          return;
        }

        // Re-check cache one more time after waiting
        if (checkAndApplyCache()) {
          releaseMutex?.();
          return;
        }

        // Mark as initialized before fetching to prevent duplicate calls
        hasInitialFetchRef.current = true;

        // Fetch location
        await fetchLocation();
      } catch (error) {
        if (__DEV__ && !cancelled) {
          console.warn("Error initializing location:", error);
        }
      } finally {
        releaseMutex?.();
      }
    };

    initializeLocation();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      releaseMutex?.();
    };
    // Only run once on mount - dependencies are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    coords,
    address,
    loading,
    error,
    refresh: fetchLocation,
  };
};

export default useLocation;
export { useLocation };

