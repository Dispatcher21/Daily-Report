// The one file that needs real values before OneDrive sync can work at all.
// Fill these in after registering the app in Azure AD (Entra ID) -- app
// registrations -> new registration -> single-page application, redirect
// URI pointing back at wherever this app is served from, API permission
// Files.ReadWrite.AppFolder (delegated). See the project notes for the
// full walkthrough.
const ONEDRIVE_CONFIG = {
  clientId: 'REPLACE_WITH_AZURE_APP_CLIENT_ID',
  // 'common' accepts any Microsoft account (personal or work/school) and is
  // fine for testing. If your organization's Azure AD blocks users from
  // consenting to apps outside their own tenant, narrow this to
  // 'https://login.microsoftonline.com/<your-tenant-id>' instead.
  authority: 'https://login.microsoftonline.com/common',
};
