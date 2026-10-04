// Easter egg: three calculator errors and a cartoon foreman pops up to (gently) give you a hard time.
// Drawn with plain shapes so it needs nothing extra installed.

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, onThemeChange, themed } from '../theme';

export const ERRORS_FOR_FOREMAN = 3;

export const JOKES = [
  'Three errors? The concrete’s setting faster than your math.',
  'Measure twice, cut once. You’re on measure four.',
  'Even the bubble in the level is laughing.',
  'That’s not a mistake. That’s a “creative estimate.”',
  'Relax, I won’t tell the boss. I’ll just tell everybody else.',
  'You can’t divide by zero. Trust me, I’ve tried. Got written up.',
  'Calculator’s fine. I checked. It’s you, buddy.',
  'Let’s just call it “close enough for grade.”',
];

const BUTTONS = ['I meant to do that', 'Okay, okay', 'Back to work'];

export default function GoofyForeman({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const wobble = useRef(new Animated.Value(0)).current;
  const [joke, setJoke] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setJoke(Math.floor(Math.random() * JOKES.length));
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(wobble, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.timing(wobble, { toValue: -1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.timing(wobble, { toValue: 0, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          ]),
        );
        loop.start();
      });
    return () => {
      loop?.stop();
      wobble.setValue(0);
    };
  }, [visible, wobble]);

  const rotate = wobble.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] });
  const bob = wobble.interpolate({ inputRange: [-1, 0, 1], outputRange: [-4, 4, -4] });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityRole="alert">
          <View style={styles.bubble}>
            <Text style={styles.jokeText}>{JOKES[joke]}</Text>
            <View style={styles.bubbleTail} />
          </View>

          <Animated.View style={[styles.guy, { transform: [{ translateY: bob }, { rotate }] }]} accessibilityLabel="Cartoon foreman laughing">
            {/* hard hat */}
            <View style={styles.hatDome} />
            <View style={styles.hatBrim} />
            {/* head */}
            <View style={styles.head}>
              <View style={styles.eyes}>
                <View style={styles.eye}>
                  <View style={[styles.pupil, { top: 6, left: 4 }]} />
                </View>
                <View style={[styles.eye, styles.eyeBig]}>
                  <View style={[styles.pupil, { top: 16, left: 18 }]} />
                </View>
              </View>
              <View style={styles.nose} />
              <View style={styles.mouth}>
                <View style={styles.tooth} />
              </View>
              <View style={styles.sweat} />
            </View>
            {/* vest */}
            <View style={styles.vest}>
              <View style={styles.stripe} />
            </View>
          </Animated.View>

          <Pressable onPress={onClose} style={styles.btn} accessibilityRole="button">
            <Text style={styles.btnText}>{BUTTONS[joke % BUTTONS.length]}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const SKIN = '#F1C27D';
const HAT = '#FFC300';
const VEST = '#FF7A00';

const getStyles = themed(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.panel, borderRadius: 24, padding: 20, alignItems: 'center' },
  bubble: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 18, alignSelf: 'stretch' },
  bubbleTail: {
    position: 'absolute',
    bottom: -10,
    left: '50%',
    marginLeft: -10,
    width: 20,
    height: 20,
    backgroundColor: '#FFFFFF',
    transform: [{ rotate: '45deg' }],
  },
  jokeText: { fontSize: 19, fontWeight: '700', color: '#000', textAlign: 'center', lineHeight: 25 },

  guy: { alignItems: 'center', marginBottom: 18 },
  hatDome: { width: 118, height: 56, backgroundColor: HAT, borderTopLeftRadius: 60, borderTopRightRadius: 60, zIndex: 2 },
  hatBrim: { width: 150, height: 14, backgroundColor: HAT, borderRadius: 8, marginTop: -2, zIndex: 2 },
  head: { width: 124, height: 118, backgroundColor: SKIN, borderRadius: 60, marginTop: -16, alignItems: 'center', paddingTop: 26 },
  eyes: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eye: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000' },
  eyeBig: { width: 36, height: 36, borderRadius: 18 },
  pupil: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#000' },
  nose: { width: 18, height: 14, borderRadius: 9, backgroundColor: '#E0A060', marginTop: 4 },
  mouth: {
    width: 62,
    height: 30,
    backgroundColor: '#7A1E1E',
    borderBottomLeftRadius: 31,
    borderBottomRightRadius: 31,
    marginTop: 6,
    alignItems: 'center',
    overflow: 'hidden',
  },
  tooth: { width: 16, height: 9, backgroundColor: '#fff', borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  sweat: { position: 'absolute', right: 10, top: 34, width: 10, height: 15, borderRadius: 6, borderTopLeftRadius: 1, backgroundColor: '#7EC8FF' },
  vest: { width: 140, height: 40, backgroundColor: VEST, borderTopLeftRadius: 30, borderTopRightRadius: 30, marginTop: -6, justifyContent: 'center' },
  stripe: { height: 8, backgroundColor: '#E8E8E8' },

  btn: { backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 26 },
  btnText: { fontSize: 18, fontWeight: '800', color: colors.accentText },
}));

// Rebuilt when the colors or text size change in Settings.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
