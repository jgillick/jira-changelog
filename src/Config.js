/**
 * Manages the command configuration files.
 *
 * If the `changelog.conf.js` file is in the directory the script is run in
 * these returned settings will overwrite the defaults.
 */

import fs from 'fs';
import path from 'path';
import program from 'commander';

/**
 * Default config object
 */
import defaultConfig from '../changelog.config.js';


/**
 * Name of the local config files.
 * Put this file in the directory where you call the jira-changelog command.
 */
export const CONF_FILENAME = 'changelog.config.js';

/**
 * Return the default config object.
 * @return {Object}
 */
export function getDefaultConfig() {
  return defaultConfig;
}

/**
 * Return the path to the config file
 * @param {String} cwd - The current directory
 * @return {String}
 */
export function configFilePath(cwd) {
  // Passed in on the command line
  if (program.config) {
    return path.resolve(program.config);
  }
  return path.join(cwd, CONF_FILENAME);
}

/**
 * Reads the config file, merges it with the default values and returns the object.
 *
 * @param {String} cwd - The current directory
 * @return {Object} Configuration object.
 */
export function readConfigFile(cwd) {
  let localConf = {};
  const configPath = configFilePath(cwd);

  try {
    // Check if file exists
    fs.accessSync(configPath);
    localConf = require(configPath);
  } catch(e) {
    if (e instanceof SyntaxError) {
      console.log('Error reading changelog.config.js:');
      console.log(e.stack);
      console.log(e.message);
    }
  }

  localConf = defaultValues(localConf, defaultConfig);
  return localConf;
}

/**
 * Add the default values into the config object
 *
 * @param {Object} config - The config object to merge with the default values.
 * @param {Object} defaults - The default object
 * @return {Object}
 */
export function defaultValues(config, defaults) {
  const localConf = { ...config };

  Object.entries(defaults).forEach(([key, defVal]) => {
    if (typeof defVal === 'object' && !Array.isArray(defVal)) {
      localConf[key] = Object.assign({}, defVal, localConf[key] || {});
    }
    else if (typeof localConf[key] == 'undefined') {
      localConf[key] = defVal;
    }
  });

  return localConf;
}
