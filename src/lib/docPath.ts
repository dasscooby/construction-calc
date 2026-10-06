// Files the app keeps in its documents folder (plan pages, job photos, the logo) are saved by their full
// address. On an iPhone that address has the app's folder id in it, and the id changes when the phone is
// restored or moved to a new phone, so the saved address points nowhere. liveUri finds the same file
// under the documents folder as it is now.

type FS = typeof import('expo-file-system');

export function liveUri(uri: string): string {
  if (!uri || uri.startsWith('data:')) return uri;
  const at = uri.lastIndexOf('/Documents/');
  if (at < 0) return uri;
  try {
    const { File, Paths } = require('expo-file-system') as FS;
    if (new File(uri).exists) return uri;
    const moved = new File(Paths.document, ...uri.slice(at + '/Documents/'.length).split('/').filter(Boolean));
    return moved.exists ? moved.uri : uri;
  } catch {
    return uri; // web, or an app build without the file system
  }
}
