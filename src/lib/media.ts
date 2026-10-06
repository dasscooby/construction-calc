// Pictures for documents: your company logo, and photos added to a job.
// Phone app: picked from Photos and kept in the app's documents folder (logo/, jobs/<job id>/).
// Web: the logo is shrunk and kept as a data URI in settings; job photos are phone-app only.

import { Platform } from 'react-native';

import { liveUri } from './docPath';

type FS = typeof import('expo-file-system');
type IP = typeof import('expo-image-picker');

const picker = (): IP => {
  try {
    return require('expo-image-picker');
  } catch {
    throw new Error('Picking a photo needs the newest app version from TestFlight.');
  }
};

/** Photos can be picked in this app version (phone app build 8+, or the web for the logo). */
export const photosAvailable = (): boolean => {
  if (Platform.OS === 'web') return true;
  try {
    require('expo-image-picker');
    return true;
  } catch {
    return false;
  }
};

async function keep(srcUri: string, ...dirParts: string[]): Promise<string> {
  const { Directory, File, Paths } = require('expo-file-system') as FS;
  const dir = new Directory(Paths.document, ...dirParts);
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`);
  await new File(srcUri).copy(dest);
  return dest.uri;
}

export function deleteFile(uri: string): void {
  if (!uri || uri.startsWith('data:')) return;
  try {
    const { File } = require('expo-file-system') as FS;
    const f = new File(liveUri(uri));
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

/** Web: pick a picture and shrink it to fit `max` px, as a JPEG data URI. */
function pickWebImage(max: number): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const g = c.getContext('2d')!;
        g.fillStyle = '#ffffff'; // logos with see-through backgrounds print on white
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    };
    input.click();
  });
}

/** Your logo: a file on the phone, or a data URI on the web. Null if you back out. */
export async function pickLogo(): Promise<string | null> {
  if (Platform.OS === 'web') return pickWebImage(600);
  const r = await picker().launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, allowsEditing: true });
  if (r.canceled || !r.assets?.length) return null;
  return keep(r.assets[0].uri, 'logo');
}

/** Photos for a job (phone app). */
export async function pickJobPhotos(jobId: string): Promise<string[]> {
  const r = await picker().launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, allowsMultipleSelection: true, selectionLimit: 10 });
  if (r.canceled || !r.assets?.length) return [];
  const out: string[] = [];
  for (const a of r.assets) out.push(await keep(a.uri, 'jobs', jobId));
  return out;
}

/** Pictures as data URIs for a document. Missing files are skipped. */
export async function asDataUris(uris: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const uri of uris) {
    if (!uri) continue;
    if (uri.startsWith('data:')) {
      out.push(uri);
      continue;
    }
    try {
      const { File } = require('expo-file-system') as FS;
      const f = new File(liveUri(uri));
      if (f.exists) out.push(`data:image/jpeg;base64,${await f.base64()}`);
    } catch {
      // gone or unreadable
    }
  }
  return out;
}
