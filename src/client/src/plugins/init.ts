import { registerClientPlugin } from './registry';
import { jiraClientPlugin } from './jira/index';
import { githubClientPlugin } from './github/index';
import { notionClientPlugin } from './notion/index';
import { gstackClientPlugin } from './gstack/index';

export function initPlugins(): void {
  registerClientPlugin(jiraClientPlugin);
  registerClientPlugin(githubClientPlugin);
  registerClientPlugin(notionClientPlugin);
  registerClientPlugin(gstackClientPlugin);
}
