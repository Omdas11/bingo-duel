// Firebase config for Bingo Duel. Uses the shared project with missile.io.
// Filled in after `firebase_get_sdk_config` + RTDB instance check.
export const firebaseConfig = {
  apiKey: "AIzaSyAKkVod_ddUbgaNmD9mVX3YrgLdAwgtYCM",
  authDomain: "studio-5006354319-33e06.firebaseapp.com",
  databaseURL: "FIREBASE_DATABASE_URL",
  projectId: "studio-5006354319-33e06",
  appId: "1:573713967819:web:f2fd272155ff573cb9094e",
};

export function configIsPlaceholder() {
  return firebaseConfig.apiKey === "FIREBASE_API_KEY";
}
