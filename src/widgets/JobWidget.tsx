// Home Screen / Lock Screen widget: the job you touched last and its order.
// Runs in the widget's own little runtime: everything it uses has to be inside the function.

import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, frame, lineLimit, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export type JobWidgetProps = {
  /** Job name, or '' when there are no jobs yet */
  name: string;
  /** "28.25 yd" or '' */
  yards: string;
  /** "$4,237.50" or '' */
  cost: string;
  /** "192 panels · 20 fillers" or '' */
  forms: string;
  accent: string;
};

const JobWidget = (props: JobWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const BG = '#000000';
  const DIM = '#98989F';
  const accent = props.accent || '#FF9F0A';

  if (environment.widgetFamily === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={2} modifiers={[containerBackground('clear', 'widget')]}>
        <Text modifiers={[font({ weight: 'semibold', size: 14 }), lineLimit(1)]}>{props.name || 'No jobs yet'}</Text>
        <Text modifiers={[font({ weight: 'bold', size: 18 })]}>{props.yards || '—'}</Text>
        {props.forms ? <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>{props.forms}</Text> : null}
      </VStack>
    );
  }

  const small = environment.widgetFamily === 'systemSmall';
  return (
    <VStack
      alignment="leading"
      spacing={4}
      modifiers={[containerBackground(BG, 'widget'), frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }), padding({ all: small ? 2 : 6 })]}>
      <HStack>
        <Text modifiers={[font({ weight: 'semibold', size: 12 }), foregroundStyle(accent)]}>JOB</Text>
        <Spacer />
      </HStack>
      <Text modifiers={[font({ weight: 'bold', size: small ? 16 : 20 }), foregroundStyle('#FFFFFF'), lineLimit(2)]}>
        {props.name || 'No jobs yet'}
      </Text>
      <Spacer />
      {props.yards ? (
        <Text modifiers={[font({ weight: 'light', size: small ? 30 : 36 }), foregroundStyle(accent)]}>{props.yards}</Text>
      ) : (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(DIM)]}>Add a slab or footing to a job</Text>
      )}
      {props.cost ? <Text modifiers={[font({ size: 13 }), foregroundStyle('#FFFFFF')]}>{props.cost}</Text> : null}
      {props.forms ? <Text modifiers={[font({ size: 12 }), foregroundStyle(DIM), lineLimit(1)]}>{props.forms}</Text> : null}
    </VStack>
  );
};

export default createWidget('JobWidget', JobWidget);
