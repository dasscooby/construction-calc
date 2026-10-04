// Opens a job report:
//   web (Safari): a new page with a "Save as PDF / Print" button
//   iPhone/Android app: a real PDF in the share menu (Files, Notes, Mail, Messages, Print)
//   app versions from before PDFs were added: the report as text in the share menu

import { Platform, Share } from 'react-native';

/** Call straight from a button press (Safari only opens new pages from a tap). */
export function openReport(html: string, text: string, title: string): void {
  if (Platform.OS === 'web') {
    const page = window.open('', '_blank');
    if (page) {
      page.document.open();
      page.document.write(html);
      page.document.close();
      return;
    }
    // Pop-up blocked: open it in this tab instead.
    window.location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    return;
  }
  void sharePdf(html, title).catch(() => Share.share({ title, message: text }).catch(() => {}));
}

async function sharePdf(html: string, title: string): Promise<void> {
  // Loaded only when needed: app builds from before 1.1 don't have the PDF parts, and this throws there.
  const Print = require('expo-print') as typeof import('expo-print');
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
}
