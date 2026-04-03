export const COMMANDS = {
  generate: 'launch-composer.generate',
  init: 'launch-composer.init',
  addTemplate: 'launch-composer.addTemplate',
  addTemplateFile: 'launch-composer.addTemplateFile',
  deleteTemplateFile: 'launch-composer.deleteTemplateFile',
  addTemplateEntry: 'launch-composer.addTemplateEntry',
  addConfigFile: 'launch-composer.addConfigFile',
  deleteConfigFile: 'launch-composer.deleteConfigFile',
  addConfigEntry: 'launch-composer.addConfigEntry',
  editItem: 'launch-composer.editItem',
  deleteItem: 'launch-composer.deleteItem',
  toggleEnabled: 'launch-composer.toggleEnabled',
} as const;

export const CONTRIBUTED_COMMAND_IDS = Object.values(COMMANDS);

export const SINGLE_WORKSPACE_ENABLEMENT = 'workspaceFolderCount == 1';
