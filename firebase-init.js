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
// (set in the Firebase console), not by hiding these objects.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  linkWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  applyActionCode,
  checkActionCode,
  verifyPasswordResetCode,
  confirmPasswordReset,
  reauthenticateWithCredential,
  updatePassword,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

// The live Firebase project -- what inspector-manager.com uses.
const PRODUCTION_CONFIG = {
  apiKey: 'AIzaSyDsvA7xgZlbhmSSGbs0mhW0-bDJ55O7kFg',
  authDomain: 'daily-reports-53c82.firebaseapp.com',
  projectId: 'daily-reports-53c82',
  storageBucket: 'daily-reports-53c82.firebasestorage.app',
  messagingSenderId: '627804105468',
  appId: '1:627804105468:web:4fe6c1c6af22e128170579',
  measurementId: 'G-6MQL7NK3FW',
};

// A separate Firebase project with no real data in it, for trying changes
// (sign-in, security rules) without any risk to the office's data.
const TEST_CONFIG = {
  apiKey: 'AIzaSyATMmurztb0DydJsIAZ4Ci5-P0pGNjsTS8',
  authDomain: 'daily-reports-test.firebaseapp.com',
  projectId: 'daily-reports-test',
  storageBucket: 'daily-reports-test.firebasestorage.app',
  messagingSenderId: '257530702005',
  appId: '1:257530702005:web:4237c2a44d9c01d67136fc',
};

// Only these addresses use the test project. Everything else -- the live
// site and any address not listed here -- uses production, so a mistake
// here can never point the live site at the test project.
const TEST_HOSTS = ['daily-report.john-sonnieriii.workers.dev', 'localhost', '127.0.0.1'];
const firebaseConfig = TEST_HOSTS.includes(location.hostname) ? TEST_CONFIG : PRODUCTION_CONFIG;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Resolves once someone is signed in: whoever this device already has
// (an account, or an earlier anonymous session -- Firebase keeps both
// across reloads and offline), otherwise a new anonymous session. Waits
// for Firebase to finish restoring the saved session first, so it never
// signs in anonymously over the top of a signed-in account. Cached so
// repeated calls don't each start their own sign-in; resetSignIn() clears
// that after signing in or out of an account.
let signedInPromise = null;
function ensureSignedIn() {
  if (!signedInPromise) {
    signedInPromise = auth.authStateReady()
      .then(() => auth.currentUser || signInAnonymously(auth).then((cred) => cred.user))
      .catch((err) => {
        signedInPromise = null;
        throw err;
      });
  }
  return signedInPromise;
}
function resetSignIn() {
  signedInPromise = null;
}

// Account sign-in, for firebase-sync.js's Accounts section (plain scripts
// can't import from the SDK themselves).
const authApi = {
  applyActionCode,
  checkActionCode,
  verifyPasswordResetCode,
  confirmPasswordReset,
  reauthenticateWithCredential,
  updatePassword,
  signInWithEmailAndPassword,
  linkWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
};

// Plain-global bridge for the rest of the app (see file header).
window.FirebaseCore = { app, auth, db, storage, ensureSignedIn, resetSignIn, authApi, projectId: firebaseConfig.projectId };
window.dispatchEvent(new CustomEvent('firebase-core-ready'));
