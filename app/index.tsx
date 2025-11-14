import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import useLocation from "../hooks/useCustomLocation";

export default function App() {
  // Flag to switch between standard method and hook
  const [useHook, setUseHook] = useState(false);

  // Track if any request has been made
  const [hasRequested, setHasRequested] = useState(false);

  // Time measurement
  const [timeStandard, setTimeStandard] = useState<number | null>(null);
  const [timeHook, setTimeHook] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Custom hook
  const {
    coords: hookCoords,
    address: hookAddress,
    loading: hookLoading,
    error: hookError,
    refresh: hookRefresh,
  } = useLocation({ autoFetch: false });
  // Track if a manual request was initiated
  const [isManualRequest, setIsManualRequest] = useState(false);

  // Standard method
  const [location, setLocation] = useState<Location.LocationObject | null>(
    null
  );
  const [address, setAddress] =
    useState<Location.LocationGeocodedAddress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Use data from hook or standard method
  // Normalize hookCoords to LocationObject when using hook
  const currentLocation: Location.LocationObject | null = useHook
    ? hookCoords
      ? {
          coords: hookCoords,
          timestamp: Date.now(),
        }
      : null
    : location;
  const currentAddress = useHook ? hookAddress : address;
  // Only show loading if it's a manual request
  const currentLoading = useHook ? isManualRequest && hookLoading : loading;
  const currentError = useHook ? hookError : errorMsg;


  // Function to fetch location with standard method
  const fetchLocationStandard = async () => {
    if (useHook) return;

    startTimeRef.current = Date.now();
    setLoading(true);
    setErrorMsg(null);

    console.log("🔐 Requesting location permission");
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      console.log("❌ Permission denied");
      setErrorMsg("Location permission denied");
      setLoading(false);
      return;
    }

    console.log("✅ Permission granted");
    try {
      console.log("📍 Fetching location (force refresh - no cache)");
      // Force new GPS reading without using cache - high accuracy
      let locationData = await Location.getCurrentPositionAsync({
        accuracy: Location.LocationAccuracy.Highest,
      });
      console.log("✅ Location obtained");

      console.log("🏠 Fetching address");
      let addressData = await Location.reverseGeocodeAsync({
        latitude: locationData.coords.latitude,
        longitude: locationData.coords.longitude,
      });
      console.log("✅ Address obtained");

      setLocation(locationData);
      setAddress(addressData[0] || null);

      // Measure time
      if (startTimeRef.current) {
        const elapsed = Date.now() - startTimeRef.current;
        setTimeStandard(elapsed);
        console.log(`⏱️ Standard method: ${elapsed}ms`);
      }
    } catch (error) {
      console.log("❌ Error getting location:", error);
      setErrorMsg("Error getting location");
    } finally {
      setLoading(false);
    }
  };

  // Track if hook is being measured
  const hookMeasuringRef = useRef(false);

  // Function to fetch location with hook
  const fetchLocationHook = async () => {
    if (!useHook) return;

    setIsManualRequest(true);
    startTimeRef.current = Date.now();
    hookMeasuringRef.current = true;
    // Force refresh without cache
    await hookRefresh(true);
  };

  // Hook measurement - measures from fetch start until data is available
  useEffect(() => {
    if (!useHook || !hookMeasuringRef.current) return;

    // When hook finishes loading, measure time
    if (!hookLoading && hookCoords && startTimeRef.current) {
      const elapsed = Date.now() - startTimeRef.current;
      setTimeHook(elapsed);
      console.log(`⏱️ Custom hook: ${elapsed}ms`);
      startTimeRef.current = null;
      hookMeasuringRef.current = false;
      setIsManualRequest(false);
    }
  }, [useHook, hookLoading, hookCoords]);

  // Reset only flags when switching methods (without making requests)
  useEffect(() => {
    hookMeasuringRef.current = false;
    setIsManualRequest(false);
    // DON'T reset times when switching - keep both for comparison
    // DON'T reset startTimeRef here - only when clicking refresh
  }, [useHook]);

  // Unified refresh function
  const handleRefresh = async () => {
    // Mark that a request was initiated
    setHasRequested(true);

    if (useHook) {
      await fetchLocationHook();
    } else {
      await fetchLocationStandard();
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Location</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={[
                styles.refreshButton,
                currentLoading && styles.refreshButtonDisabled,
              ]}
              onPress={handleRefresh}
              disabled={currentLoading}
            >
              {currentLoading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.refreshButtonText}>↻</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.switchContainer}>
          <TouchableOpacity
            style={[styles.switchButton, !useHook && styles.switchButtonActive]}
            onPress={() => setUseHook(false)}
          >
            <Text
              style={[styles.switchText, !useHook && styles.switchTextActive]}
            >
              Standard Method
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.switchButton, useHook && styles.switchButtonActive]}
            onPress={() => setUseHook(true)}
          >
            <Text
              style={[styles.switchText, useHook && styles.switchTextActive]}
            >
              Custom Hook
            </Text>
          </TouchableOpacity>
        </View>


        {(timeStandard !== null || timeHook !== null) && (
          <View style={styles.timeContainer}>
            <View style={styles.timeHeader}>
              <Text style={styles.timeTitle}>⏱️ Execution Times</Text>
            </View>

            <View style={styles.timeRow}>
              {timeStandard !== null && (
                <View
                  style={[
                    styles.timeItem,
                    timeHook !== null && { marginRight: 6 },
                  ]}
                >
                  <Text style={styles.timeMethodLabel}>Standard Method</Text>
                  <View style={styles.timeValueContainer}>
                    <Text style={styles.timeValue}>{timeStandard}</Text>
                    <Text style={[styles.timeUnit, { marginLeft: 4 }]}>ms</Text>
                  </View>
                </View>
              )}

              {timeHook !== null && (
                <View
                  style={[
                    styles.timeItem,
                    timeStandard !== null && { marginLeft: 6, marginRight: 0 },
                  ]}
                >
                  <Text style={styles.timeMethodLabel}>Custom Hook</Text>
                  <View style={styles.timeValueContainer}>
                    <Text style={styles.timeValue}>{timeHook}</Text>
                    <Text style={[styles.timeUnit, { marginLeft: 4 }]}>ms</Text>
                  </View>
                </View>
              )}
            </View>

            {timeStandard !== null && timeHook !== null && (
              <View style={styles.winnerContainer}>
                <Text style={styles.winnerText}>
                  {timeStandard < timeHook
                    ? "🏆 Standard Method is faster!"
                    : timeHook < timeStandard
                    ? "🏆 Custom Hook is faster!"
                    : "⚖️ Tie!"}
                </Text>
                <Text style={styles.winnerDifference}>
                  Difference: {Math.abs(timeStandard - timeHook)}ms
                </Text>
              </View>
            )}
          </View>
        )}

        {!hasRequested ? (
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>ℹ️ Request not started</Text>
            <Text style={styles.infoSubtext}>
              Click the refresh button to fetch location
            </Text>
          </View>
        ) : currentError ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{currentError}</Text>
          </View>
        ) : currentLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator
              size="small"
              color="#999"
              style={styles.loader}
            />
            <Text style={styles.loadingText}>Fetching location</Text>
          </View>
        ) : currentLocation ? (
          <>
            {currentAddress && (
              <View style={styles.content}>
                {currentAddress.street && (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.label}>Street</Text>
                      <Text style={styles.value}>
                        {currentAddress.street}
                        {currentAddress.streetNumber
                          ? `, ${currentAddress.streetNumber}`
                          : ""}
                      </Text>
                    </View>
                    <View style={styles.divider} />
                  </>
                )}
                {currentAddress.district && (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.label}>District</Text>
                      <Text style={styles.value}>
                        {currentAddress.district}
                      </Text>
                    </View>
                    <View style={styles.divider} />
                  </>
                )}
                {currentAddress.subregion && (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.label}>Sub-region</Text>
                      <Text style={styles.value}>
                        {currentAddress.subregion}
                      </Text>
                    </View>
                    <View style={styles.divider} />
                  </>
                )}
                {currentAddress.city && (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.label}>City</Text>
                      <Text style={styles.value}>{currentAddress.city}</Text>
                    </View>
                    <View style={styles.divider} />
                  </>
                )}
                {currentAddress.region && (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.label}>Region</Text>
                      <Text style={styles.value}>{currentAddress.region}</Text>
                    </View>
                    <View style={styles.divider} />
                  </>
                )}
                {currentAddress.postalCode && (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.label}>Postal Code</Text>
                      <Text style={styles.value}>
                        {currentAddress.postalCode}
                      </Text>
                    </View>
                    <View style={styles.divider} />
                  </>
                )}
                {currentAddress.country && (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.label}>Country</Text>
                      <Text style={styles.value}>{currentAddress.country}</Text>
                    </View>
                    <View style={styles.divider} />
                  </>
                )}
                {currentAddress.name && (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.label}>Name</Text>
                      <Text style={styles.value}>{currentAddress.name}</Text>
                    </View>
                    <View style={styles.divider} />
                  </>
                )}
                {currentAddress.isoCountryCode && (
                  <View style={styles.section}>
                    <Text style={styles.label}>Country Code</Text>
                    <Text style={styles.value}>
                      {currentAddress.isoCountryCode}
                    </Text>
                  </View>
                )}
              </View>
            )}

            <View style={styles.content}>
              <View style={styles.section}>
                <Text style={styles.label}>Latitude</Text>
                <Text style={styles.value}>
                  {currentLocation.coords.latitude.toFixed(6)}°
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.section}>
                <Text style={styles.label}>Longitude</Text>
                <Text style={styles.value}>
                  {currentLocation.coords.longitude.toFixed(6)}°
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.section}>
                <Text style={styles.label}>Accuracy</Text>
                <Text style={styles.value}>
                  {currentLocation.coords.accuracy?.toFixed(2)}m
                </Text>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fafafa",
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 60,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "300",
    color: "#1a1a1a",
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
  },
  refreshButtonDisabled: {
    opacity: 0.5,
  },
  refreshButtonText: {
    fontSize: 20,
    color: "#ffffff",
    fontWeight: "300",
  },
  content: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    marginBottom: 32,
  },
  section: {
    paddingVertical: 16,
  },
  label: {
    fontSize: 12,
    color: "#999",
    marginBottom: 8,
    fontWeight: "400",
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 24,
    color: "#1a1a1a",
    fontWeight: "300",
    letterSpacing: -0.5,
  },
  divider: {
    height: 1,
    backgroundColor: "#f0f0f0",
  },
  loadingContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  loader: {
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 15,
    color: "#999",
    fontWeight: "300",
    letterSpacing: 0.3,
  },
  infoContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 32,
    marginBottom: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  infoText: {
    fontSize: 16,
    color: "#1a1a1a",
    fontWeight: "500",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  infoSubtext: {
    fontSize: 14,
    color: "#999",
    fontWeight: "300",
    textAlign: "center",
    lineHeight: 20,
  },
  errorContainer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    marginBottom: 32,
  },
  errorText: {
    fontSize: 15,
    color: "#d32f2f",
    fontWeight: "400",
    lineHeight: 22,
  },
  switchContainer: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  switchButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  switchButtonActive: {
    backgroundColor: "#1a1a1a",
  },
  switchText: {
    fontSize: 14,
    color: "#999",
    fontWeight: "400",
  },
  switchTextActive: {
    color: "#ffffff",
    fontWeight: "500",
  },
  timeContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#f0f0f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  timeHeader: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  timeTitle: {
    fontSize: 16,
    color: "#1a1a1a",
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  timeRow: {
    flexDirection: "row",
    marginBottom: 16,
  },
  timeItem: {
    flex: 1,
    backgroundColor: "#fafafa",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    marginRight: 6,
  },
  timeMethodLabel: {
    fontSize: 11,
    color: "#999",
    marginBottom: 8,
    fontWeight: "500",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  timeValueContainer: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  timeValue: {
    fontSize: 24,
    color: "#1a1a1a",
    fontWeight: "600",
    letterSpacing: -0.5,
  },
  timeUnit: {
    fontSize: 12,
    color: "#999",
    fontWeight: "400",
  },
  winnerContainer: {
    marginTop: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    alignItems: "center",
  },
  winnerText: {
    fontSize: 16,
    color: "#1a1a1a",
    marginBottom: 4,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  winnerDifference: {
    fontSize: 12,
    color: "#999",
    fontWeight: "400",
  },
});
