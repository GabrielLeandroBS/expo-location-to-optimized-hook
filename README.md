# 📍 useCustomLocation Hook

An optimized React hook for location retrieval in React Native/Expo with intelligent caching, memory leak protection, and performance optimizations.

## 🎯 Key Features

### ⚡ Performance and Speed
- **Shared global cache** (Singleton Pattern) - multiple hook instances share the same cache
- **Promise.race** - parallel fetch between last known position and new position (returns the fastest)
- **Progressive accuracy** - initial fetch with low accuracy (fast) and background refinement
- **Reverse geocoding cache** - prevents duplicate calls for the same coordinates

### 🛡️ Robustness and Security
- **Memory leak protection** - AbortController cancels all async operations on unmount
- **Race condition prevention** - Global mutex coordinates multiple hook instances
- **Timestamp validation** - ignores old updates that could overwrite new data
- **Safe state updates** - checks if component is mounted before updating state

### 🎨 User Experience
- **Instant response** - shows cache immediately (even if expired) while fetching fresh data
- **Non-blocking operations** - geocoding and refinement happen in background
- **Optional persistence** - saves location to AsyncStorage to load in next session
- **User-friendly error messages** - robust error handling without breaking the app

## 🚀 Basic Usage

```tsx
import { useLocation } from './hooks/useCustomLocation';

function MyComponent() {
  const { coords, address, loading, error, refresh } = useLocation();

  if (loading) return <Text>Loading location...</Text>;
  if (error) return <Text>Error: {error}</Text>;

  return (
    <View>
      <Text>Latitude: {coords?.latitude}</Text>
      <Text>Longitude: {coords?.longitude}</Text>
      <Text>Address: {address?.street}</Text>
      <Button onPress={refresh} title="Refresh" />
    </View>
  );
}
```

## ⚙️ Configuration Options

```tsx
const { coords, address, loading, error, refresh } = useLocation({
  // Cache time-to-live (default: 5 minutes)
  cacheTTL: 5 * 60 * 1000,
  
  // Maximum age for last known position (default: 1 minute)
  lastKnownPositionMaxAge: 60 * 1000,
  
  // Initial accuracy for fast response (default: Low)
  initialAccuracy: Location.LocationAccuracy.Low,
  
  // Refined accuracy for background update (default: Balanced)
  refinedAccuracy: Location.LocationAccuracy.Balanced,
  
  // Enable background refinement (default: true)
  enableRefinement: true,
  
  // Significant change threshold in degrees (default: 0.0001 ≈ 11m)
  significantChangeThreshold: 0.0001,
  
  // Automatically fetch on mount (default: true)
  autoFetch: true,
});
```

## 🏗️ Internal Architecture

### Singleton Pattern - Shared Resources

The hook uses **4 singleton instances** shared across all hook instances:

1. **`cachedLocation`** - Global location cache
   - Shared across all hook instances
   - Configurable TTL per instance (default: 5 minutes)
   - Persisted to AsyncStorage (if available)

2. **`reverseGeocodeCache`** - Reverse geocoding cache
   - Global Map with key: coordinates (4 decimal places ≈ 11m)
   - TTL: 10 minutes
   - Prevents duplicate calls for same coordinates

3. **`pendingReverseGeocodeRequests`** - Pending requests
   - Global Map of in-progress Promises
   - Reuses Promise if same coordinate is already being processed
   - Prevents simultaneous duplicate requests

4. **`fetchMutex`** - Mutex for coordination
   - Single instance of FetchMutex class
   - Prevents multiple hook instances from fetching simultaneously
   - FIFO queue system to manage concurrent requests

### Optimized Fetch Flow

```
1. Check in-memory cache → If valid, return instantly
2. Check AsyncStorage → Load if available (persistence)
3. Acquire Mutex → Prevent concurrent requests
4. Wait for ongoing fetches → Polling (200ms) if necessary
5. Promise.race (parallel execution):
   ├── getLastKnownPositionAsync() → Usually instant
   └── getCurrentPositionAsync(Low) → Fast, low accuracy
6. Update cache and state (Write-Through)
7. Reverse geocoding in background (non-blocking)
8. Optional refinement in background (Progressive Enhancement)
```

### Cache Strategy

```
Global Cache (Singleton)
├── cachedLocation: CachedLocation | null
│   ├── coords: LocationObjectCoords
│   ├── address: LocationGeocodedAddress | null
│   ├── timestamp: number
│   └── cacheTTL: number (per instance)
│
Geocoding Cache (Singleton - Map)
├── reverseGeocodeCache: Map<string, { address, timestamp }>
├── Key: "lat,lng" (4 decimal places)
└── TTL: 10 minutes
│
Pending Requests (Singleton - Map)
├── pendingReverseGeocodeRequests: Map<string, Promise<Address>>
└── Reuses Promise for identical coordinates
```

## 🔑 Key Implementation Points

### 1. Memory Leak Protection

- **AbortController** in all async operations
- **safeSetState** checks if component is mounted before updating
- **Complete cleanup** in useEffect (cancels operations, cleans refs)
- **AbortSignal** propagated throughout async chain

### 2. Race Condition Prevention

- **FetchMutex** coordinates global access
- **Timestamp validation** ignores updates older than current cache
- **Polling** waits for concurrent fetches before starting new one
- **isFetchingRef** prevents multiple simultaneous calls in same instance

### 3. Performance Optimizations

- **Promise.race** between last known position and new position
- **Cache-first** - always checks cache before fetching
- **Significant change detection** - only updates if change > 11m (configurable)
- **Debounced cache cleanup** - cleanup only when cache exceeds 50 entries
- **Promise memoization** - reuses Promise for identical requests

### 4. Optimized UX

- **Shows cache immediately** - even if expired, for instant feedback
- **Fetches fresh data in background** - doesn't block UI
- **Progressive accuracy** - fast response with low accuracy, refinement later
- **Non-blocking operations** - geocoding and refinement in background

## 📊 Comparison: Optimized Hook vs. Basic Implementation

| Aspect | Basic Implementation | useCustomLocation |
|--------|---------------------|-------------------|
| **Cache** | ❌ No cache | ✅ Shared global cache (Singleton) |
| **Speed** | ⚠️ Always fetches new position | ✅ Promise.race + cache + last known position |
| **Memory Leaks** | ⚠️ May occur | ✅ Complete protection with AbortController |
| **Race Conditions** | ⚠️ Possible | ✅ Mutex + timestamp validation |
| **Duplicate Requests** | ⚠️ May occur | ✅ Promise memoization + cache |
| **UX** | ⚠️ Loading until data obtained | ✅ Shows cache immediately |
| **Accuracy** | ⚠️ Fixed | ✅ Progressive (Low → Balanced) |
| **Persistence** | ❌ No | ✅ AsyncStorage (optional) |

## 🔧 Technologies

- **Expo** - React Native framework
- **expo-location** - Location API
- **@react-native-async-storage/async-storage** - Persistence (optional, graceful degradation)
- **TypeScript** - Type safety
- **React Hooks** - State management

## 📝 Technical Notes

- ✅ Compatible with React 19 (automatic batched updates)
- ✅ All operations are cancellable via AbortController
- ✅ Supports multiple hook instances simultaneously (share singleton resources)
- ✅ Graceful degradation if AsyncStorage is not available
- ✅ Cache shared globally, but with configurable TTL per instance
- ✅ Validates persisted data before using

## 🎓 Design Patterns Used

### Core Patterns
- **Singleton Pattern** - 4 singleton instances for shared resources
- **Cache-Aside Pattern** - Checks cache before fetching
- **Write-Through Cache** - Updates cache on fetch
- **Mutex Pattern** - Concurrent access coordination
- **Promise Memoization** - Promise reuse
- **Progressive Enhancement** - Progressive accuracy (Low → Balanced)

### React Patterns
- **Custom Hook Pattern** - Reusable logic encapsulation
- **Ref Pattern** - Mutable values without re-renders
- **Memoization Pattern** - useCallback for stable references
- **Guard Pattern** - State checks before operations

### Concurrency Patterns
- **Promise Racing** - Returns fastest result
- **Polling Pattern** - Waits for concurrent operations
- **Lock Pattern** - Mutex for synchronization
- **Queue Pattern** - FIFO request management

## 📄 License

This is an educational project demonstrating advanced optimization techniques in React Native.
