// On Footings & Walls, Wall Forms and Slab: "Lay out the whole foundation". It opens the foundation
// layout for the job this came from, or asks which job (or makes a new one).

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { feel } from '../lib/feel';
import { jobStore, useJobs } from '../lib/jobs';
import { nav } from '../lib/nav';
import { colors, onThemeChange, themed } from '../theme';
import PickSheet from './PickSheet';
import type { JobLink } from './ToolsTab';

export const LAYOUT_FROM_TOOLS = ['footings', 'wall-forms', 'slab'];

export default function LayoutLink({ jobLink }: { jobLink?: JobLink }) {
  const jobs = useJobs();
  const [picking, setPicking] = useState(false);
  const go = () => {
    feel.tap();
    if (jobLink && jobs.some((j) => j.id === jobLink.jobId)) nav.openLayout(jobLink.jobId);
    else setPicking(true);
  };
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.title}>Whole foundation?</Text>
          <Text style={styles.sub}>House, add-ons, inside walls and slabs in one layout. Walls, footings, each slab and pour figure themselves.</Text>
        </View>
      </View>
      <Pressable onPress={go} style={styles.btn} accessibilityRole="button">
        <Text style={styles.btnText}>Lay out the whole foundation ›</Text>
      </Pressable>
      <PickSheet
        visible={picking}
        title="Which job?"
        options={[{ key: '+new', label: '+ New job', sub: 'Start a job for this foundation' }, ...jobs.map((j) => ({ key: j.id, label: j.name, sub: j.address || undefined, group: 'Your jobs' }))]}
        onPick={(key) => {
          setPicking(false);
          nav.openLayout(key === '+new' ? jobStore.create('New foundation') : key);
        }}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

const getStyles = themed(() => ({
  card: { backgroundColor: colors.panel, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  sub: { fontSize: 14, color: colors.subtext, marginTop: 2, lineHeight: 19 },
  btn: { marginTop: 10, backgroundColor: colors.accent, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 17, fontWeight: '800', color: colors.accentText },
}));

let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
