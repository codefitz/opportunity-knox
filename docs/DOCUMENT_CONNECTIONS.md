# Document connections

Open **Career Library** or **Settings → Document connections**.

## Existing career folders

Enter a label and an absolute folder path on the computer hosting the board. Add the folder, then choose **Apply mounts & restart**. The launcher mounts it read-only; no Docker configuration is needed. Browse folders, select individual supported files and save the selection. Up to 20 roots and 10,000 selections per root are supported, with paged browsing. Hidden paths and symbolic links are excluded. Application state/managed-document roots cannot overlap these mounts.

Selected files become available to Buddy’s automatic evidence/template selection. Connecting does not read every file’s contents, prepare text, index vectors or send documents to AI. Preparation/indexing and Buddy requests remain separate actions. Cached text/vectors are removed when files are deselected or roots detached. Detaching leaves originals untouched; apply mounts/restart to remove the old container bind. Unavailable sources are omitted until accessible again. Folder contents are not copied into full backups; reconnect accessible roots when restoring to another host.

## Google Docs: one-time setup

1. Create/select a Google Cloud project and enable the **Google Drive API**.
2. Configure the OAuth consent screen. For a personal testing app, add your Google account as a test user. Wider use may require Google verification.
3. Create an OAuth client of type **Web application**.
4. Copy the exact **Authorized redirect URI** shown in Opportunity Knox into that client. Use the same browser address for setup and the return from Google. Loopback HTTP works locally; hosted access requires HTTPS and the registered public address.
5. Enter the client ID and client secret in the board and save. Do not share the secret in chat or commit it.
6. Click **Connect Google Docs** and complete Google’s consent yourself. Testing-mode grants may expire and require reconnection.

The requested `drive.readonly` permission grants read access to Drive; the board uses it to search native Google Docs and export selected documents. Review the scope before granting it. Opportunity Knox’s connection is separate from Google connections in Codex.

Search, choose Reference/CV/JD and click **Import snapshot**. This creates a local draft DOCX copy with original document ID/version/link metadata. Importing the same unchanged version/kind reuses the existing copy. A changed version can be imported separately. There is no background sync, native Google editing or automatic preparation/indexing. Imported CV/reference copies participate in the normal career library workflow; prepare them before relying on text retrieval.

Client secrets/tokens remain in private server configuration and are excluded from record JSON exports. Private full backups include them and must be protected. Disconnect removes account tokens locally and attempts Google revocation; imported copies remain. An OAuth app/client is not supplied by this project. Live account authorization needs your configured client and consent; automated tests use simulated Google responses.

Official references: [Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive authorization scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [list files](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [export files](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export).
