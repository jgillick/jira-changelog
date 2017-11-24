import "babel-polyfill";
import JiraApi from 'jira-client';
import Slack from './Slack';

/**
 * Generate changelog by matching source control commit logs to jiar tickets.
 */
export default class Jira {

  constructor(config) {
    this.config = config;
    this.slack = new Slack(config);
    this.jira = undefined;

    if (config.jira.api.host) {
      this.jira = new JiraApi({
        protocol: 'https',
        host: config.jira.api.host,
        username: config.jira.api.username,
        password: config.jira.api.password,
        apiVersion: 2,
        strictSSL: true
      });
    }
  }

  /**
   * Generate changelog by matching source control commit logs to jiar tickets.
   *
   * @param {String} commitLogs - A list of source control commit logs.
   * @return {Object}
   */
  async generate(commitLogs, releaseVersion) {
    const logs = [];
    try {

      const promises = commitLogs.map((commit) => {
        return this.findJiraInCommit(commit, releaseVersion).then((log) => { logs.push(log); });
      });
      promises.push(Promise.resolve());

      return Promise.all(promises).then(() => logs);
    } catch(e) {
      throw new Error(e);
    }
  }

  /**
   * Find JIRA ticket numbers in a commit log, and automatically load the
   * ticket info for it.
   *
   * @param {Object} commitLog - Commit log object
   * @param {String} releaseVersion - Release version eg, mobileweb-1.8.0
   * @return {Promsie} Resolves to an object with a jira array property
   */
  findJiraInCommit(commitLog, releaseVersion) {
    const log = Object.assign({tickets: []}, commitLog);
    const ticketPattern = this.config.jira.ticketIDPattern.source;
    const promises = [Promise.resolve()];
    const found = [];

    // Search for jira ticket numbers in the commit text
    const tickets = this.getTickets(log);
    tickets.forEach((ticketMatch) => {

      // Get the ticket ID, and skip loading if we already found this one
      const id = ticketMatch.match(ticketPattern)[0];
      if (found.includes(id)) {
        return;
      }
      found.push(id);

      // Load JIRA object from the API
      promises.push(
        this.getJiraIssue(id)
        .then((ticket) => {
          if (this.includeTicket(ticket)) {
            log.tickets.push(ticket);
            return ticket;
          }
        })
        .catch((err) => {
          console.log('Ticket not found', id);
        })
        .then((ticket) => {

          // Add release version
          if (ticket && releaseVersion) {
            ticket.fields.fixVersions.push({name: releaseVersion});
            return this.jira.updateIssue(ticket.id, {
              fields: {
                'fixVersions': ticket.fields.fixVersions
              }
            });
          }
        })
        .catch((err) => {
          console.log('Failed to attach release version to ticket: ', id, err.error.errors);
        })
      );
    });

    // Resolve log when all jira promises are done
    return Promise.all(promises).then(() => log);
  }

  /**
   * Retreive the jira issue by ID.
   * Also attempt to match a slack user to the reporter's email address.
   *
   * @param {String} ticketId - The ticket ID of the issue to retrieve.
   * @return {Promise} Resolves a jira issue object, with added `slackUser` property.
   */
  async getJiraIssue(ticketId) {
    if (!this.jira) {
      return Promise.reject('Jira is not configured.');
    }

    return this.jira.findIssue(ticketId).then((origTicket) => {
      const ticket = Object.assign({}, origTicket);

      return this.slack.findUser(ticket.fields.reporter.emailAddress, ticket.fields.reporter.displayName)
      .then((slackUser) => {
        ticket.slackUser = slackUser;
        return ticket;
      })
      .catch(() => ticket);
    });
  }

  /**
   * Should ticket be included in changelog
   * @param   {Object} ticket Jira ticket object
   * @returns {Boolean}
   */
  includeTicket(ticket) {
    const type = ticket.fields.issuetype.name;
    if (Array.isArray(this.config.jira.includeIssueTypes) && this.config.jira.includeIssueTypes.length) {
      return this.config.jira.includeIssueTypes.includes(type);
    }
    else if (Array.isArray(this.config.jira.excludeIssueTypes)) {
      return !this.config.jira.excludeIssueTypes.includes(type);
    }
  }

  /**
   * Gets all tickets associated with a commit
   * @param   {Object} log A commit's log object
   * @returns {Array}      List of tickets in commit
   */
  getTickets(log) {
    const searchPattern = new RegExp(this.config.jira.ticketIDPattern.source, 'g');
    return log.fullText.match(searchPattern) || [];
  }
}
