// Auth: Google (popup-first) + Email/Password (sign in / sign up).
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

export function watchUser(auth, cb) {
  return onAuthStateChanged(auth, cb);
}

export async function signInGoogle(auth) {
  const provider = new GoogleAuthProvider();
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    // Popup blocked/closed on some mobile browsers -> fall back to redirect.
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/popup-closed-by-user")) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw e;
  }
}

export async function signUpEmail(auth, name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const displayName = (name || email.split("@")[0]).trim().slice(0, 24) || "Player";
  await updateProfile(cred.user, { displayName });
  return cred;
}

export async function signInEmail(auth, email, password) {
  return await signInWithEmailAndPassword(auth, email, password);
}

export function signOutUser(auth) {
  return signOut(auth);
}

export function friendlyAuthError(e) {
  const code = (e && e.code) || "";
  const map = {
    "auth/email-already-in-use": "That email already has an account. Try signing in.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/weak-password": "Password needs at least 6 characters.",
    "auth/user-not-found": "No account with that email. Try signing up.",
    "auth/wrong-password": "Wrong password. Try again.",
    "auth/invalid-credential": "Wrong email or password.",
    "auth/too-many-requests": "Too many tries. Wait a bit and retry.",
    "auth/operation-not-allowed":
      "Email sign-in isn't enabled on the backend yet. Use Google for now.",
    "auth/network-request-failed": "Network hiccup. Check connection and retry.",
  };
  return map[code] || "Sign-in failed. Please try again.";
}
