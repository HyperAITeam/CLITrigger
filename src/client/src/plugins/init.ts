import { registerClientPlugin } from './registry';
import { jiraClientPlugin } from './jira/index';
import { githubClientPlugin } from './github/index';
import { notionClientPlugin } from './notion/index';
import { harnessClientPlugin } from './harness/index';

export function initPlugins(): void {
  registerClientPlugin(jiraClientPlugin);
  registerClientPlugin(githubClientPlugin);
  registerClientPlugin(notionClientPlugin);
  registerClientPlugin(harnessClientPlugin);
}
