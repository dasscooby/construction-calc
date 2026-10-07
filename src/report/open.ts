// Opens a job report:
//   web (Safari): a new page with a "Save as PDF / Print" button
//   iPhone/Android app: a real PDF in the share menu (Files, Notes, Mail, Messages, Print)
//   app versions from before PDFs were added: the report as text in the share menu

import { Platform, Share } from 'react-native';

/** PDF page size, inches (as it comes out of the printer: width across, height down). */
export interface PageSize {
  wIn: number;
  hIn: number;
}

export const LETTER: PageSize = { wIn: 8.5, hIn: 11 };

/** What the PDF maker is told: the page in points (72 to the inch) and no margins (the pages have their own). */
export const printOptions = (html: string, page: PageSize = LETTER) => ({
  html,
  width: Math.round(page.wIn * 72),
  height: Math.round(page.hIn * 72),
  margins: { left: 0, top: 0, right: 0, bottom: 0 },
});

/** Call straight from a button press (Safari only opens new pages from a tap). */
export function openReport(html: string, text: string, title: string, page: PageSize = LETTER): void {
  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      return;
    }
    // Pop-up blocked: open it in this tab instead.
    window.location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    return;
  }
  void sharePdf(html, title, page).catch(() => Share.share({ title, message: text }).catch(() => {}));
}

async function sharePdf(html: string, title: string, page: PageSize): Promise<void> {
  // Loaded only when needed: app builds from before 1.1 don't have the PDF parts, and this throws there.
  const Print = require('expo-print') as typeof import('expo-print');
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  const { uri } = await Print.printToFileAsync(printOptions(html, page));
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
}
