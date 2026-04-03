import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Firebase Configuration provided by USER
const firebaseConfig = {
  apiKey: "AIzaSyDDqB8GUVKd5eCBErI2BXMJLU1ls_RwDak",
  authDomain: "chatin-f3419.firebaseapp.com",
  projectId: "chatin-f3419",
  storageBucket: "chatin-f3419.firebasestorage.app",
  messagingSenderId: "609174716770",
  appId: "1:609174716770:web:42deb4a44b27aad31bec3b",
  measurementId: "G-07BLMP1KV6",
  databaseURL: "https://chatin-f3419-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// const analytics = getAnalytics(app); // Analytics disabled to avoid ERR_NAME_NOT_RESOLVED

// Export Services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const rtdb = getDatabase(app);
export const googleProvider = new GoogleAuthProvider();

console.log("🔥 Chatin - Firebase initialized with live configuration!");
