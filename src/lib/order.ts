// The concrete order, as a text to the supplier: yards, PSI, how it's placed, when, and where.

import { Linking, Platform, Share } from 'react-native';

import type { ConcreteOrder, Job } from './jobs';
import type { Settings } from './settings';

export const PLACE_TEXT: Record<ConcreteOrder['place'], string> = { chute: 'Off the chute', pump: 'Pump truck', buggy: 'Buggies / wheelbarrows' };

export function orderText(job: Job, s: Settings, yd: number, o: ConcreteOrder): string {
  const c = s.company;
  return [
    `Concrete order${c.name ? ` – ${c.name}` : ''}`,
    `Job: ${job.name}${job.address ? `, ${job.address}` : ''}`,
    `${yd.toFixed(2).replace(/\.?0+$/, '')} yd, ${o.psi || '3000'} PSI`,
    PLACE_TEXT[o.place],
    o.when.trim() ? `When: ${o.when.trim()}` : '',
    c.phone ? `Call or text: ${c.phone}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Opens Messages with the order filled in (or the share menu if there's no number or no Messages). */
export async function sendOrder(phone: string, message: string): Promise<void> {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits && Platform.OS !== 'web') {
    const url = `sms:${digits}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(message)}`;
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // no Messages: fall through to the share menu
    }
  }
  if (digits && Platform.OS === 'web') {
    window.location.href = `sms:${digits}&body=${encodeURIComponent(message)}`;
    return;
  }
  await Share.share({ message }).catch(() => {});
}
