import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { SyncChannel } from './sync/channel';
import { SettingsStore } from './params/store';
import { ControlApp } from './ui/ControlApp';
import { OutputApp } from './ui/OutputApp';
import { isOutputRoute } from './route';
import './ui/styles.css';

const channel = new SyncChannel();
const store = new SettingsStore(channel);
const output = isOutputRoute(location);
document.documentElement.classList.toggle('route-output', output);
if (output) document.title = 'FractalCam Output';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{output ? <OutputApp store={store} channel={channel} /> : <ControlApp store={store} channel={channel} />}</StrictMode>,
);
