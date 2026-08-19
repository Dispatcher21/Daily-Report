// Sign-in and token handling for OneDrive sync, via Microsoft's own MSAL.js
// library against the app registered in Azure AD (see onedrive-config.js --
// nothing here works until that file has a real client ID in it).
//
// Redirect, not popup: a popup can get silently blocked -- this app has
// already hit exactly that wall with window.open on some browsers -- and
// it's worse on an iPad running as an installed/standalone PWA, where popup
// behavior is even less predictable. A full-page redirect back to this same
// page and a page reload always works the same way everywhere.

const ONEDRIVE_SCOPES = ['Files.ReadWrite.AppFolder'];

let msalApp = null;

function getMsalApp() {
  if (!msalApp) {
    msalApp = new msal.PublicClientApplication({
      auth: {
        clientId: ONEDRIVE_CONFIG.clientId,
        authority: ONEDRIVE_CONFIG.authority,
        redirectUri: window.location.origin + window.location.pathname,
      },
      cache: {
        // localStorage, not MSAL's default sessionStorage -- signing in
        // again every time the app is relaunched from the home screen
        // would be the opposite of the seamless sync this is for.
        cacheLocation: 'localStorage',
      },
    });
  }
  return msalApp;
}

// Call once on page load, before anything else touches OneDrive sign-in
// state. This is what actually completes a sign-in on the page Microsoft
// redirects back to; the rest of the time it just picks up whatever
// account was already signed in from a previous visit.
async function initOneDriveAuth() {
  const app = getMsalApp();
  await app.initialize();
  const result = await app.handleRedirectPromise();
  if (result && result.account) {
    app.setActiveAccount(result.account);
  } else if (!app.getActiveAccount()) {
    const accounts = app.getAllAccounts();
    if (accounts.length > 0) app.setActiveAccount(accounts[0]);
  }
  return getOneDriveAccount();
}

function getOneDriveAccount() {
  return getMsalApp().getActiveAccount();
}

function isOneDriveConnected() {
  return !!getOneDriveAccount();
}

// Sends the browser to Microsoft's sign-in page. The page navigates away
// and reloads on the way back -- initOneDriveAuth() picks the result up
// from there, so nothing after this call is expected to run.
async function connectOneDrive() {
  await getMsalApp().loginRedirect({ scopes: ONEDRIVE_SCOPES });
}

// Forgets the account on this device only -- does not touch the
// inspector's actual Microsoft session, so it doesn't sign them out of
// anything else using the same account.
function disconnectOneDrive() {
  getMsalApp().setActiveAccount(null);
}

// Returns a valid Graph API access token, refreshing silently against the
// cached session first. Falls back to a full sign-in redirect only when
// that's not possible -- normally because the cached session has expired
// or access was revoked -- in which case the page navigates away and this
// call never resolves; whatever's happening after it just doesn't run.
async function getOneDriveAccessToken() {
  const app = getMsalApp();
  const account = app.getActiveAccount();
  if (!account) throw new Error('OneDrive is not connected.');
  try {
    const result = await app.acquireTokenSilent({ scopes: ONEDRIVE_SCOPES, account });
    return result.accessToken;
  } catch (err) {
    await app.acquireTokenRedirect({ scopes: ONEDRIVE_SCOPES, account });
    return null;
  }
}
