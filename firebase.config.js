import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Firebase Configuration provided by USER
const firebaseConfig = {
  apiKey: "AIzaSyBJzU5PW0VgvHPRhcfDXZBWPFPV2Xak3W8",
  authDomain: "chatin-3c6a5.firebaseapp.com",
  projectId: "chatin-3c6a5",
  storageBucket: "chatin-3c6a5.firebasestorage.app",
  messagingSenderId: "130139862155",
  appId: "1:130139862155:web:8966aaeba6ad443041108e"
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
