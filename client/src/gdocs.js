// Open a Word file as a Google Doc: sign in to Google once, upload it to the person's own Drive converted to a Doc,
// and open it. Uses only the drive.file scope, so Brekkie can touch just the files it creates.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let loading;
const loadGsi = () => (loading ||= new Promise((ok, fail) => {
  if (window.google?.accounts?.oauth2) return ok();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = () => ok(); s.onerror = () => fail(new Error('Could not reach Google. Check your connection.'));
  document.head.appendChild(s);
}));

const askToken = (clientId) => new Promise((ok, fail) => {
  const tc = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId, scope: SCOPE,
    callback: (r) => (r.access_token ? ok(r.access_token) : fail(new Error(r.error === 'access_denied' ? 'Google sign in was cancelled' : 'Could not sign in to Google'))),
    error_callback: (e) => fail(new Error(e?.type === 'popup_closed' ? 'Google sign in was cancelled' : 'Could not sign in to Google')),
  });
  tc.requestAccessToken();
});

/** Returns the link of the new Google Doc. */
export async function wordToGoogleDoc(clientId, blob, name) {
  await loadGsi();
  const token = await askToken(clientId);
  const boundary = 'brekkie' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: name.replace(/\.docx$/i, ''), mimeType: 'application/vnd.google-apps.document' });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
    blob, `\r\n--${boundary}--`,
  ]);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` }, body,
  });
  if (!res.ok) throw new Error(res.status === 403 ? 'Google Drive said no. Check that the Drive API is switched on for the project.' : 'Google Drive could not take the file');
  return (await res.json()).webViewLink;
}
