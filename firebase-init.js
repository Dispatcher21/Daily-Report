// Firebase connection for company-room sync (projects/reports/photos shared
// across devices via a single company code). ES module loaded with
// <script type="module">, since the Firebase v10+ SDK is only shipped as ES
// modules on their CDN -- unlike every other script in this app, which is a
// plain global <script src>. window.FirebaseCore below is the bridge: it
// exposes just enough of this module's exports as plain globals so the rest
// of the app (plain scripts) can call into it without a bundler.
//
// apiKey etc. below are the public, client-side Firebase config -- not
// secrets. Access to data is controlled by Firestore/Storage security rules
// (still deny-all at this point), not by hiding this object.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDsvA7xgZlbhmSSGbs0mhW0-bDJ55O7kFg',
  authDomain: 'daily-reports-53c82.firebaseapp.com',
  projectId: 'daily-reports-53c82',
  storageBucket: 'daily-reports-53c82.firebasestorage.app',
  messagingSenderId: '627804105468',
  appId: '1:627804105468:web:4fe6c1c6af22e128170579',
  measurementId: 'G-6MQL7NK3FW',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Resolves once a signed-in (anonymous) user exists, signing in if needed.
// Cached so repeated calls (from multiple pages/components) don't each kick
// off their own sign-in race.
let signedInPromise = null;
function ensureSignedIn() {
  if (!signedInPromise) {
    signedInPromise = new Promise((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          if (user) {
            unsubscribe();
            resolve(user);
          }
        },
        (err) => {
          unsubscribe();
          reject(err);
        }
      );
      signInAnonymously(auth).catch((err) => {
        unsubscribe();
        reject(err);
      });
    });
  }
  return signedInPromise;
}

// Plain-global bridge for the rest of the app (see file header).
window.FirebaseCore = { app, auth, db, storage, ensureSignedIn };
window.dispatchEvent(new CustomEvent('firebase-core-ready'));
