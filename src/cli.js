#!/usr/bin/env node

/**
 * The jira-changelog CLI
 */

import "@babel/polyfill";
import 'source-map-support/register';
import program from 'commander';
import _ from 'lodash';
import ejs from 'ejs'
import path from 'path';
import Slack from './Slack';
import Entities from 'html-entities';

import {readConfigFile, CONF_FILENAME} from './Config';
import SourceControl from './SourceControl';
import Jira from './Jira';

runProgram();

/**
 * Parse command line arguments
 */
function commandLineArgs() {
  const pkg = require('../package.json');
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

    // Config file path
    var configPath;
    if (program.config) {
      configPath = path.resolve(program.config);
    } else {
      configPath = path.join(gitPath, CONF_FILENAME);
    }

    const config = readConfigFile(configPath);
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

    // Template data template
    let data = await transformCommitLogs(config, changelog);
    if (typeof config.transformData == 'function') {
      data = await Promise.resolve(config.transformData(data));
    }
    data.jira = {
      baseUrl: config.jira.baseUrl,
      releaseVersions: jira.releaseVersions,
    };

    // Render and output template
    const entitles = new Entities.AllHtmlEntities();
    const changelogMessage = ejs.render(config.template, data);
    console.log(entitles.decode(changelogMessage));

    // Post to slack
    if (program.slack) {
      postToSlack(config, data, changelogMessage);
    }
  } catch(e) {
    console.error('Error: ', e.stack);
    console.log(e.message);
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
    console.error('Error: Slack is not configured.');
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
    console.log('Done');

  } catch(e) {
    console.log('Error: ', e.stack);
  }
}

/**
 * Convert a range string formatted as "a...b" into an array.
 *
 * @param {String} rangeStr - The range string.
 * @return {Array}
 */
function parseRange(rangeStr) {
  return rangeStr.split(/\.{3,3}/);
}

/**
 * Filter commit logs into template data.
 *
 * Data:
 * -----
 *  {
 *    commits: {
 *      all: [],       // all commits
 *      tickets: [],   // commits associated with jira tickets
 *      noTickets: []  // commits not associated with jira tickets
 *    },
 *    tickets: {
 *      all: [],       // all tickets
 *      approved: [],  // tickets marked as approved
 *      pending: [],   // tickets not marked as approved
 *      pendingByOwner: [] // pending tickets arranged under ticket reporters.
 *    }
 *  }
 *
 * @param {Object} config - The config object provided by Config.getConfigForPath
 * @param {Array} logs - List of commit logs and their jira tickets.
 *
 * @return {Promise} Resolves to an object with filtered commit/ticket data
 */
function transformCommitLogs(config, logs) {
  let approvalStatus = config.jira.approvalStatus;
  if (!Array.isArray(approvalStatus)) {
    approvalStatus = [approvalStatus];
  }

  // Tickets and their commits
  const ticketHash = logs.reduce((all, log) => {
    log.tickets.forEach((ticket) => {
      all[ticket.key] = all[ticket.key] || ticket;
      all[ticket.key].commits = all[ticket.key].commits || [];
      all[ticket.key].commits.push(log);
    });
    return all;
  }, {});
  let ticektList = _.sortBy(Object.values(ticketHash), ticket => ticket.fields.issuetype.name);
  let pendingTickets = ticektList.filter(ticket => !approvalStatus.includes(ticket.fields.status.name));

  // Pending ticket owners and their tickets/commits
  const reporters = {};
  pendingTickets.forEach((ticket) => {
    const email = ticket.fields.reporter.emailAddress;
    if (!reporters[email]) {
      reporters[email] = {
        email,
        name: ticket.fields.reporter.displayName,
        slackUser: ticket.slackUser,
        tickets: [ticket]
      };
    } else {
      reporters[email].tickets.push(ticket);
    }
  });
  const pendingByOwner = _.sortBy(Object.values(reporters), item => item.user);


  // Output filtered data
  return {
    commits: {
      all: logs,
      tickets: logs.filter(commit => commit.tickets.length),
      noTickets: logs.filter(commit => !commit.tickets.length)
    },
    tickets: {
      pendingByOwner,
      all: ticektList,
      approved: ticektList.filter(ticket => approvalStatus.includes(ticket.fields.status.name)),
      pending: pendingTickets
    }
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

  if (program.range && program.range.length) {
    range.from = program.range[0];
    range.to = program.range[1];
  }
  if (program.dateRange && program.dateRange.length) {
    range.after = program.dateRange[0];
    if (program.dateRange.length > 1) {
      range.before = program.dateRange[1];
    }
  }

  // Use default range
  if (!Object.keys(range).length && Object.keys(defaultRange).length) {
    Object.assign(range, defaultRange);
  }

  if (!Object.keys(range).length){
      throw new Error('No range defined for the changelog.');
  }
  return range;
}
