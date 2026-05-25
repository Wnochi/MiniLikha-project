// Firebase configuration and exports for Firestore and Auth.
// Replace the values in `firebaseConfig` with your project's settings.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAIO0CIPpquFaPVC9abijjfPQArU4Uzwxc",
    authDomain: "minilikha-store.firebaseapp.com",
    projectId: "minilikha-store",
    storageBucket: "minilikha-store.firebasestorage.app",
    messagingSenderId: "399863105914",
    appId: "1:399863105914:web:de15e5ff41e72136452"
};

// Avoid re-initializing if the module is loaded more than once.
const app = (getApps && getApps().length) ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);


// Attach to `window` so older/non-importing scripts can access them after deploy.
try {
    window.firebaseApp = app;
    window.auth = auth;
    window.db = db;
} catch (e) {
    // ignore in non-window environments
}
