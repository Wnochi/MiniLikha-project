import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
    if (user) {
      const adminDoc = await getDoc(doc(db, "admins", user.uid));
      if (!adminDoc.exists()) {
        alert("Access denied. Admins only.");
        window.location.href = "/index.html";
      }
    } else {
      window.location.href = "/login.html";
    }
  });
