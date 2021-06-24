#!/usr/bin/env node

/**
 * The jira-changelog CLI
 */

import "core-js/stable";
import "regenerator-runtime/runtime";
import 'source-map-support/register';
import program from 'commander';
import path from 'path';
import Slack from './Slack';
import { AllHtmlEntities } from 'html-entities';

import { generateTemplateData, renderTemplate } from './template';
import {readConfigFile} from './Config';
import SourceControl from './SourceControl';
import Jira from './Jira';

/**
 * Parse command line arguments
 */
function commandLineArgs() {
  const pkg = require('../../package.json');
  program
    .version(pkg.version)
    .option(
      '-c, --config <filepath>',
      'Path to the config file.'
    )
    .option(
      '-r, --range <from>...<to>',
      'git commit range for changelog',
      parseRange
    )
    .option(
      '-d, --date <date>[...date]',
      'Only include commits after this date',
      parseRange
    )
    .option(
      '-s, --slack',
      'Automatically post changelog to slack (if configured)'
    )
    .option(
      '--release [release]',
      'Assign a release version to these stories'
    )
    .parse(process.argv);
}

/**
 * Run the main program
 */
async function runProgram() {
  try {
    commandLineArgs();

    // Determine the git workspace path
    let gitPath = process.cwd();
    if (program.args.length) {
      gitPath = program.args[0];
    }
    gitPath = path.resolve(gitPath);

    const config = readConfigFile(gitPath);
    const jira = new Jira(config);
    const source = new SourceControl(config);

    // Release flag used, but no name passed
    if (program.release === true) {
      if (typeof config.jira.generateReleaseVersionName !== 'function') {
        console.log("You need to define the jira.generateReleaseVersionName function in your config, if you're not going to pass the release version name in the command.")
        return;
      }
      program.release = await config.jira.generateReleaseVersionName();
    }

    // Get logs
    const range = getRangeObject(config);
    const commitLogs = await source.getCommitLogs(gitPath, range);
    const changelog = await jira.generate(commitLogs, program.release);

    // Render template
    const tmplData = await generateTemplateData(config, changelog, jira.releaseVersions);
    const changelogMessage = renderTemplate(config, tmplData);

    // Output to console
    const entitles = new AllHtmlEntities();
    console.log(entitles.decode(changelogMessage));

    // Post to slack
    if (program.slack) {
      await postToSlack(config, tmplData, changelogMessage);
    }
  } catch(e) {
    console.error(e.stack || e);
    process.exit(1);
  }
}

/**
 * Post the changelog to slack
 *
 * @param {Object} config - The configuration object
 * @param {Object} data - The changelog data object.
 * @param {String} changelogMessage - The changelog message
 */
async function postToSlack(config, data, changelogMessage) {
  const slack = new Slack(config);

  if (!slack.isEnabled() || !config.slack.channel) {
    throw new Error('Error: Slack is not configured.');
    return;
  }

  console.log(`\nPosting changelog message to slack channel: ${config.slack.channel}...`);
  try {

    // Transform for slack
    if (typeof config.transformForSlack == 'function') {
      changelogMessage = await Promise.resolve(config.transformForSlack(changelogMessage, data));
    }

    // Post to slack
    await slack.postMessage(changelogMessage, config.slack.channel);
    console.log('Sent');

  } catch(err) {
    throw new Error(err);
  }
}

/**
 * Convert a range string formatted as "a...b" into an array.
 *
 * @param {String} rangeStr - The range string.
 * @return {Array}
 */
export function parseRange(rangeStr) {
  let parts = [];
  let symmetric = false;
  let rangeError = false;

  if (rangeStr.includes('...')){
    if (rangeStr.length <= 3){rangeError = true;}
    symmetric = true;
    parts = rangeStr.split('...');
  } else if (rangeStr.includes('..')){
    if (rangeStr.length <= 2){rangeError = true;}
    parts = rangeStr.split('..');
  } else if (rangeStr.length > 0){
    parts[0] = rangeStr;
  }

  if(!parts.length || rangeError){
    throw new Error('Invalid Range');
  }

  return {
    symmetric,
    from: parts[0],
    to: parts[1] || '',
  }
}


/**
 * Construct the range object from the CLI arguments and config
 *
 * @param {Object} config - The config object provided by Config.getConfigForPath
 * @return {Object}
 */
function getRangeObject(config) {
  const range = {};
  const defaultRange = (config.sourceControl && config.sourceControl.defaultRange) ? config.sourceControl.defaultRange : {};

  if (program.range && program.range.from) {
    Object.assign(range, program.range);
  }
  if (program.dateRange && program.dateRange.from) {
    range.after = program.dateRange.from;
    if (program.dateRange.to) {
      range.before = program.dateRange.to;
    }
  }

  // Use default range
  if (!Object.keys(range).length && Object.keys(defaultRange).length) {
    Object.assign(range, defaultRange);
  }

  if (!Object.keys(range).length){
      throw new Error('No range defined for the changelog.');
  }

  // Ensure symmetric is explicitly set
  range.symmetric = !!range.symmetric;
  return range;
}

// Run program
if (require.main === module) {
  runProgram();
}
