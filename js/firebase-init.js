// Firebase SDK init (modular, CDN).
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { firebaseConfig, configIsPlaceholder } from "./config.js";

export function initFirebase() {
  if (configIsPlaceholder()) {
    throw new Error("Firebase config not filled in yet (js/config.js).");
  }
  const app = initializeApp(firebaseConfig);
  return {
    auth: getAuth(app),
    store: getFirestore(app),
  };
}
