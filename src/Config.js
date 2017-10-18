/**
 * Manages the command configuration files.
 *
 * If the `changelog.conf.js` file is in the directory the script is run in
 * these returned settings will overwrite the defaults.
 */

import fs from 'fs';
import path from 'path';

/**
 * Default config object
 */
import defaultConfig from './changelog.config.js';


/**
 * Name of the local config files.
 * Put this file in the directory where you call the jira-changelog command.
 */
const CONF_FILENAME = 'changelog.config.js';

/**
 * Return the default config object.
 */
export function getDefaultConfig() {
  return defaultConfig;
}

/**
 * Retreives the configuration object defined by `changelog.config.js` at a path.
 * This config module is then merged with the default config object.
 * If the config module does not exists at the path, the default object is returned.
 *
 * @param {String} baseDir - The directory which might contain the changelog config module.
 *
 * @return {Object} Configuration object.
 */
export function getConfigForPath(baseDir) {
  let localConf = {};
  const configPath = path.join(baseDir, CONF_FILENAME);

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

  // Merge first level with default
  Object.keys(defaultConfig).forEach((key) => {
    const defVal = defaultConfig[key];

    if (typeof defVal === 'object' && !Array.isArray(defVal)) {
      localConf[key] = Object.assign({}, defVal, localConf[key] || {});
    }
    else if (typeof localConf[key] == 'undefined') {
      localConf[key] = defVal;
    }
  });

  return localConf;
}


