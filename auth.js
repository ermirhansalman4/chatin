import { 
    auth, 
    db, 
    rtdb, 
    googleProvider 
} from './firebase.config.js';

import { 
    signInWithPopup, 
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
        console.error("Google Auth Popup Error:", error);
        throw error;
    }
};

export const logout = async () => {
    try {
        const user = auth.currentUser;
        if (user) {
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
    
    await setDoc(userRef, userData, { merge: true });
};

// --- REALTIME PRESENCE SYSTEM ---

export const setupPresence = (uid) => {
    const userStatusRef = ref(rtdb, '/status/' + uid);
    const connectedRef = ref(rtdb, '.info/connected');
    
    onValue(connectedRef, (snap) => {
        if (snap.val() === false) return;

        onDisconnect(userStatusRef).set({
            state: 'offline',
            last_changed: serverTimestamp()
        }).then(() => {
            set(userStatusRef, {
                state: 'online',
                last_changed: serverTimestamp()
            }).catch(err => console.error("Presence status set error:", err));
            
            updateDoc(doc(db, 'users', uid), { 
                status: 'online',
                lastSeen: serverTimestamp() 
            }).catch(err => console.error("Firestore status update error:", err));
        });
    });
};

// --- AUTH STATE LISTENER ---

onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("Logged In:", user.displayName);
        setupPresence(user.uid);
        window.dispatchEvent(new CustomEvent('auth-success', { detail: user }));
    } else {
        console.log("Logged Out");
        window.dispatchEvent(new CustomEvent('auth-logout'));
    }
});
