export const COMMANDS = {
  generate: 'launch-composer.generate',
  init: 'launch-composer.init',
  addTemplate: 'launch-composer.addTemplate',
  addTemplateFile: 'launch-composer.addTemplateFile',
  openTemplateFileJson: 'launch-composer.openTemplateFileJson',
  copyTemplateFilePath: 'launch-composer.copyTemplateFilePath',
  copyTemplateFileRelativePath: 'launch-composer.copyTemplateFileRelativePath',
  renameTemplateFile: 'launch-composer.renameTemplateFile',
  deleteTemplateFile: 'launch-composer.deleteTemplateFile',
  addTemplateEntry: 'launch-composer.addTemplateEntry',
  addConfigFile: 'launch-composer.addConfigFile',
  openConfigFileJson: 'launch-composer.openConfigFileJson',
  copyConfigFilePath: 'launch-composer.copyConfigFilePath',
  copyConfigFileRelativePath: 'launch-composer.copyConfigFileRelativePath',
  renameConfigFile: 'launch-composer.renameConfigFile',
  deleteConfigFile: 'launch-composer.deleteConfigFile',
  addConfigEntry: 'launch-composer.addConfigEntry',
  editItem: 'launch-composer.editItem',
  openItemJson: 'launch-composer.openItemJson',
  copyItemFilePath: 'launch-composer.copyItemFilePath',
  copyItemFileRelativePath: 'launch-composer.copyItemFileRelativePath',
  renameItem: 'launch-composer.renameItem',
  deleteItem: 'launch-composer.deleteItem',
  enableConfig: 'launch-composer.enableConfig',
  disableConfig: 'launch-composer.disableConfig',
  toggleEnabled: 'launch-composer.toggleEnabled',
} as const;

export const CONTRIBUTED_COMMAND_IDS = Object.values(COMMANDS);

export const SINGLE_WORKSPACE_ENABLEMENT = 'workspaceFolderCount == 1';
