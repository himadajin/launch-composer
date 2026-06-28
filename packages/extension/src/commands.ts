export const COMMANDS = {
  generate: 'launch-composer.generate',
  init: 'launch-composer.init',
  addProfile: 'launch-composer.addProfile',
  addProfileFile: 'launch-composer.addProfileFile',
  openProfileFileJson: 'launch-composer.openProfileFileJson',
  copyProfileFilePath: 'launch-composer.copyProfileFilePath',
  copyProfileFileRelativePath: 'launch-composer.copyProfileFileRelativePath',
  renameProfileFile: 'launch-composer.renameProfileFile',
  deleteProfileFile: 'launch-composer.deleteProfileFile',
  addProfileEntry: 'launch-composer.addProfileEntry',
  addConfigFile: 'launch-composer.addConfigFile',
  openConfigFileJson: 'launch-composer.openConfigFileJson',
  copyConfigFilePath: 'launch-composer.copyConfigFilePath',
  copyConfigFileRelativePath: 'launch-composer.copyConfigFileRelativePath',
  renameConfigFile: 'launch-composer.renameConfigFile',
  deleteConfigFile: 'launch-composer.deleteConfigFile',
  addConfigEntry: 'launch-composer.addConfigEntry',
  editItem: 'launch-composer.editItem',
  openActiveEditorJson: 'launch-composer.openActiveEditorJson',
  openItemJson: 'launch-composer.openItemJson',
  copyItemFilePath: 'launch-composer.copyItemFilePath',
  copyItemFileRelativePath: 'launch-composer.copyItemFileRelativePath',
  renameItem: 'launch-composer.renameItem',
  deleteItem: 'launch-composer.deleteItem',
  includeConfig: 'launch-composer.includeConfig',
  excludeConfig: 'launch-composer.excludeConfig',
  toggleIncluded: 'launch-composer.toggleIncluded',
} as const;

export const CONTRIBUTED_COMMAND_IDS = Object.values(COMMANDS);

export const SINGLE_WORKSPACE_ENABLEMENT = 'workspaceFolderCount == 1';
