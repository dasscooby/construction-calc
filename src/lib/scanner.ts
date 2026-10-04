// Scanning plans into a job with Apple's document scanner (VisionKit on iPhone, ML Kit on Android).
// Pages are saved as JPEGs in the app's documents folder: Documents/jobs/<job id>/.
// Phone app 1.1+ only; the web app hides the button.

import { Platform } from 'react-native';

type FS = typeof import('expo-file-system');

export const scannerAvailable = (): boolean => {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  try {
    require('react-native-document-scanner-plugin');
    require('expo-file-system');
    return true;
  } catch {
    return false; // an older app build without the scanner
  }
};

const fileUri = (p: string) => (p.startsWith('file://') ? p : `file://${p}`);

/** Opens the scanner; returns the saved page files (empty if cancelled). */
export async function scanPages(jobId: string): Promise<string[]> {
  const Scanner = require('react-native-document-scanner-plugin').default as typeof import('react-native-document-scanner-plugin').default;
  const { Directory, File, Paths } = require('expo-file-system') as FS;
  // 70% JPEG keeps plan lines sharp at about a quarter of the size of full quality.
  const res = await Scanner.scanDocument({ croppedImageQuality: 70 });
  const pages = res.scannedImages ?? [];
  if (!pages.length) return [];
  const dir = new Directory(Paths.document, 'jobs', jobId);
  dir.create({ intermediates: true, idempotent: true });
  const saved: string[] = [];
  for (const [i, page] of pages.entries()) {
    const dest = new File(dir, `plan-${Date.now()}-${i + 1}.jpg`);
    await new File(fileUri(page)).copy(dest);
    saved.push(dest.uri);
  }
  return saved;
}

export function deleteScanFile(uri: string): void {
  try {
    const { File } = require('expo-file-system') as FS;
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

/** Deletes every saved page for a job (when the job is deleted). */
export function deleteJobScans(jobId: string): void {
  try {
    const { Directory, Paths } = require('expo-file-system') as FS;
    const dir = new Directory(Paths.document, 'jobs', jobId);
    if (dir.exists) dir.delete();
  } catch {
    // nothing saved
  }
}

/** Pages as data URIs, for putting them in the PDF. Missing files are skipped. */
export async function scansForReport(uris: string[]): Promise<string[]> {
  if (!uris.length) return [];
  try {
    const { File } = require('expo-file-system') as FS;
    const out: string[] = [];
    for (const uri of uris) {
      const f = new File(uri);
      if (f.exists) out.push(`data:image/jpeg;base64,${await f.base64()}`);
    }
    return out;
  } catch {
    return [];
  }
}
