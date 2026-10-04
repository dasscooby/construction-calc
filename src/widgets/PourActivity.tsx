// Live Activity for a pour: trucks in, yards in, and a running clock, on the Lock Screen and Dynamic Island.
// Runs in the widget runtime: everything it uses has to be inside the function.

import { HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
  progressViewStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type PourProps = {
  job: string;
  trucksIn: number;
  trucks: number;
  /** "20 of 28.25 yd" */
  yards: string;
  /** Pour start, ms since 1970 (Dates don't cross over to the widget) */
  startEpochMs: number;
  done: boolean;
  accent: string;
};

const PourActivity = (props: PourProps, _env: LiveActivityEnvironment) => {
  'widget';
  const accent = props.accent || '#FF9F0A';
  const started = new Date(props.startEpochMs);
  const progress = props.trucks > 0 ? Math.min(1, props.trucksIn / props.trucks) : 0;
  const truckLine = props.done ? 'Pour done' : `Truck ${Math.min(props.trucksIn + 1, props.trucks)} of ${props.trucks}`;

  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[containerBackground('#000000', 'widget'), padding({ all: 16 })]}>
        <HStack spacing={8}>
          <Image systemName="truck.box.fill" size={16} color={accent} />
          <Text modifiers={[font({ weight: 'semibold', size: 14 }), foregroundStyle('#FFFFFF'), lineLimit(1)]}>{props.job}</Text>
          <Spacer />
          <Text date={started} dateStyle="timer" modifiers={[font({ size: 14 }), monospacedDigit(), foregroundStyle('#FFFFFFCC')]} />
        </HStack>
        <HStack>
          <Text modifiers={[font({ weight: 'bold', size: 20 }), foregroundStyle('#FFFFFF')]}>{truckLine}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 15 }), foregroundStyle(accent)]}>{props.yards}</Text>
        </HStack>
        <ProgressView value={progress} modifiers={[progressViewStyle('linear'), tint(accent), frame({ maxWidth: Infinity })]} />
      </VStack>
    ),
    compactLeading: <Image systemName="truck.box.fill" size={14} color={accent} />,
    compactTrailing: (
      <Text modifiers={[font({ weight: 'semibold', size: 14 }), foregroundStyle('#FFFFFF'), monospacedDigit()]}>
        {props.done ? '✓' : `${props.trucksIn}/${props.trucks}`}
      </Text>
    ),
    minimal: <Image systemName="truck.box.fill" size={14} color={accent} />,
    expandedLeading: (
      <HStack spacing={6} modifiers={[padding({ leading: 6 })]}>
        <Image systemName="truck.box.fill" size={16} color={accent} />
        <Text modifiers={[font({ weight: 'semibold', size: 14 }), foregroundStyle('#FFFFFF'), lineLimit(1)]}>{props.job}</Text>
      </HStack>
    ),
    expandedTrailing: (
      <Text date={started} dateStyle="timer" modifiers={[font({ size: 14 }), monospacedDigit(), foregroundStyle(accent), padding({ trailing: 6 })]} />
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ horizontal: 6, top: 4 })]}>
        <HStack>
          <Text modifiers={[font({ weight: 'bold', size: 17 }), foregroundStyle('#FFFFFF')]}>{truckLine}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 14 }), foregroundStyle('#FFFFFFCC')]}>{props.yards}</Text>
        </HStack>
        <ProgressView value={progress} modifiers={[progressViewStyle('linear'), tint(accent), frame({ maxWidth: Infinity })]} />
      </VStack>
    ),
  };
};

export default createLiveActivity<PourProps>('PourActivity', PourActivity);
