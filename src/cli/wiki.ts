import { Command } from 'commander';
import { WikiStore } from '../knowledge/wiki.js';
import { parseJsonValue, printJson } from '../utils/json.js';

export function wikiCommand(): Command {
  const command = new Command('wiki')
    .description('Read and write kch wiki entries');

  command
    .command('get <namespace> <key>')
    .action((namespace: string, key: string) => {
      printJson({ namespace, key, value: new WikiStore(namespace).get(key) });
    });

  command
    .command('set <namespace> <key> <value...>')
    .action((namespace: string, key: string, value: string[]) => {
      const store = new WikiStore(namespace);
      store.set(key, parseJsonValue(value.join(' ')));
      printJson({ ok: true, namespace, key });
    });

  command
    .command('search <namespace> <query>')
    .action((namespace: string, query: string) => {
      printJson({ namespace, query, results: new WikiStore(namespace).search(query) });
    });

  command
    .command('list <namespace>')
    .action((namespace: string) => {
      printJson({ namespace, keys: new WikiStore(namespace).listKeys() });
    });

  command
    .command('clear <namespace>')
    .action((namespace: string) => {
      new WikiStore(namespace).cleanup();
      printJson({ ok: true, namespace });
    });

  return command;
}
