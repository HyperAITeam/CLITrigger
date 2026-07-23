import { registerClientPlugin } from './registry';
import { harnessClientPlugin } from './harness/index';

export function initPlugins(): void {
  registerClientPlugin(harnessClientPlugin);
}
