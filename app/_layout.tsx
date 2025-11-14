import { Stack } from "expo-router";
import "react-native-reanimated";

export const unstable_settings = {
  anchor: "index",
};

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ title: "Home", headerShown: false }}
      />
    </Stack>
  );
}
