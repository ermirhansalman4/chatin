import { 
    auth, 
    db, 
    rtdb, 
    googleProvider 
} from './firebase.config.js';

import { 
    signInWithPopup, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

import { 
    doc, 
    setDoc, 
    serverTimestamp, 
    updateDoc 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

import { 
    ref, 
    onValue, 
    set, 
    onDisconnect 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// --- AUTH FUNCTIONS ---

export const loginWithGoogle = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        await syncUserToFirestore(user);
        return user;
    } catch (error) {
        console.error("Google Auth Error:", error);
        throw error;
    }
};

export const logout = async () => {
    try {
        const user = auth.currentUser;
        if (user) {
            // Firestore status update
            await updateDoc(doc(db, 'users', user.uid), { status: 'offline' });
        }
        await signOut(auth);
    } catch (error) {
        console.error("Logout Error:", error);
    }
};

// --- FIRESTORE USER SYNC ---

const syncUserToFirestore = async (user) => {
    const userRef = doc(db, 'users', user.uid);
    const userData = {
        uid: user.uid,
        username: user.displayName || user.email.split('@')[0],
        email: user.email,
        photoURL: user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName || 'User'}&background=random`,
        status: 'online',
        createdAt: serverTimestamp()
    };
    
    // Merge true: If user exists, update; if not, create.
    await setDoc(userRef, userData, { merge: true });
};

// --- REALTIME PRESENCE SYSTEM ---

export const setupPresence = (uid) => {
    // RTDB Presence Reference
    const userStatusRef = ref(rtdb, '/status/' + uid);
    
    // Check connection state
    const connectedRef = ref(rtdb, '.info/connected');
    
    onValue(connectedRef, (snap) => {
        if (snap.val() === false) return;

        // When user disconnects (tab closed, internet lost), set status to offline in RTDB
        onDisconnect(userStatusRef).set({
            state: 'offline',
            last_changed: serverTimestamp()
        }).then(() => {
            // When user is currently connected, set status to online in RTDB
            set(userStatusRef, {
                state: 'online',
                last_changed: serverTimestamp()
            }).catch(err => console.error("Presence status set error:", err));
            
            // Also sync online status to Firestore for general querying
            updateDoc(doc(db, 'users', uid), { 
                status: 'online',
                lastSeen: serverTimestamp() 
            }).catch(err => console.error("Firestore status update error:", err));
        }).catch(err => console.error("Presence onDisconnect error:", err));
    });
};

// --- AUTH STATE LISTENER ---

onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("Logged In:", user.displayName);
        setupPresence(user.uid);
        // Dispatch custom event for UI updates
        window.dispatchEvent(new CustomEvent('auth-success', { detail: user }));
    } else {
        console.log("Logged Out");
        window.dispatchEvent(new CustomEvent('auth-logout'));
    }
});
