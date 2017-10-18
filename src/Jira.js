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
    this.jira = new JiraApi({
      protocol: 'https',
      host: config.jira.api.host,
      username: config.jira.api.username,
      password: config.jira.api.password,
      apiVersion: 2,
      strictSSL: true
    });
  }

  /**
   * Generate changelog by matching source control commit logs to jiar tickets.
   *
   * @param {String} commitLogs - A list of source control commit logs.
   * @return {Object}
   */
  async generate(commitLogs) {
    const logs = [];
    try {

      const promises = commitLogs.map((commit) => {
        return this.findJiraInCommit(commit).then((log) => { logs.push(log); });
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
   * @return {Promsie} Resolves to an object with a jira array property
   */
  findJiraInCommit(commitLog) {
    const log = Object.assign({tickets: []}, commitLog);
    const ticketPattern = /[a-zA-Z]+\-[0-9]+/;
    const searchPattern = new RegExp(this.config.jira.ticketIDPattern.source, 'g');
    const promises = [Promise.resolve()];
    const found = [];

    // Filter by either the type whitelist or blacklist
    // Returns true if the ticket should be included in the list
    const includeTicket = (ticket) => {
      const type = ticket.fields.issuetype.name;
      if (Array.isArray(this.config.jira.includeIssueTypes) && this.config.jira.includeIssueTypes.length) {
        return this.config.jira.includeIssueTypes.includes(type);
      }
      else if (Array.isArray(this.config.jira.excludeIssueTypes)) {
        return !this.config.jira.excludeIssueTypes.includes(type);
      }
    };

    // Search for jira ticket numbers in the commit text
    const tickets = log.fullText.match(searchPattern) || [];
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
          if (includeTicket(ticket)) {
            log.tickets.push(ticket);
          }
        })
        .catch((err) => {
          console.log('Ticket not found', id);
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
    return this.jira.findIssue(ticketId).then((origTicket) => {
      const ticket = Object.assign({}, origTicket);

      return this.slack.getUserForEmail(ticket.fields.reporter.emailAddress)
      .then((slackUser) => {
        ticket.slackUser = slackUser;
        return ticket;
      })
      .catch(() => ticket);
    });
  }
}
