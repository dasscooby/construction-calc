// The safety net loads first, so even errors while the app starts show on screen instead of closing it.
import { CrashBoundary } from './src/lib/crashGuard';

import { createElement } from 'react';
import { registerRootComponent } from 'expo';

import App from './App';

const Root = () => createElement(CrashBoundary, null, createElement(App));

// registerRootComponent calls AppRegistry.registerComponent('main', () => Root);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Root);
