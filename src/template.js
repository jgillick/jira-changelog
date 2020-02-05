
import ejs from 'ejs';
import _ from 'lodash';


/**
 * Filter revert commits out of a commit log list, if the original commit is present.
 * i.e. for each revert there are 2 commits: the original commit & the commit which was reverted.
 * We only need to keep one of them.
 *
 * For example input:
 * ```
 *    const logs = [
 *      { revision: 10 },
 *      { revision: 11, reverted: 5, }, // original commit not present
 *      { revision: 12 },
 *      { revision: 13, reverted: 10 }, // original commit is present
 *    ];
 * ```
 *
 * Will create this output:
 * ```
 *    {
 *      { revision: 10, reverted: 13 } // reverted BY 13
 *      { revision: 11, reverted: 5, } // reverted 5, which is not present
 *      { revision: 12 },
 *    }
 * ```
 *  + Revision 13 is removed because it merely reverts revision 10
 *  + Revision 11 remains because the commit is reverts is not in the list.
 *
 * @param {Array} logs - List of commit logs
 * @return {Object} containing: reverted, current
 */
export function filterRevertedCommits(logs) {
  // Convenient commit lookup
  const commitHash = {};
  logs.forEach(l => commitHash[l.revision] = l);

  // Track reverted commits, and only keep one of the commits (orig or reverter)
  const reduced = logs.reduce((acc, log) => {
    if (log.reverted) {
      // If the commit we're reverting is in the list, remove the revert commit
      const revertedCommit = commitHash[log.reverted]
      if (revertedCommit) {
        revertedCommit.revertedBy = log.revision;
        acc.add(revertedCommit);
      } else {
        acc.add(log);
      }
    } else {
      acc.add(log);
    }
    return acc;
  }, new Set());

  return Array.from(reduced);
}

/**
 * Mark tickets as reverted, if their latest git commit was a commit.
 *
 * @param {Array} tickets - Array of jira ticket objects, each with a commit list
 * @return {Array}
 */
export function decorateTicketReverts(tickets) {
  tickets.forEach((ticket) => {
    if (!ticket.commits || !ticket.commits.length) {
      ticket.reverted = null;
      return;
    }
    const commits = _.sortBy(ticket.commits, commit => commit.date).reverse();
    const lastCommit = commits[0];
    ticket.reverted = lastCommit.reverted || lastCommit.revertedBy;
  });
  return tickets;
}

/**
 * Fetch the contact information of the reporters of a list of tickets.
 *
 * @param {Array} tickets
 * @return {Object}
 */
export function getTicketReporters(tickets) {
  const reporters = {};

  tickets.forEach((ticket) => {
    const { email, displayName } = ticket.fields.reporter;
    if (!reporters[email]) {
      reporters[email] = {
        email,
        name: displayName,
        slackUser: ticket.slackUser,
        tickets: [ticket]
      };
    } else {
      reporters[email].tickets.push(ticket);
    }
  });

  // Sort list by name
  return _.sortBy(Object.values(reporters), item => item.name);
}

/**
 * Return the Jira tickets who's status does not match the possible "approvalStatus" values
 * in the config.
 * @param {Object} config - The config object provided by Config.getConfigForPath
 * @param {Array} tickets - List of Jira tickets
 * @param {Array}
 */
export function groupTicketsByStatus(config, tickets) {
  let { approvalStatus } = config.jira;
  if (!approvalStatus) {
    return {
      approved: [],
      pending: tickets,
    };
  }

  if (!Array.isArray(approvalStatus)) {
    approvalStatus = [approvalStatus];
  }

  const out = {
    approved: [],
    pending: [],
  };
  const statusMatch = approvalStatus.map(s => s.toLowerCase());
  tickets.forEach((ticket) => {
    const name = ticket.fields.status.name.toLowerCase();
    if (statusMatch.includes(name)) {
      out.approved.push(ticket);
    } else {
      out.pending.push(ticket);
    }
  });

  return out;
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
 *      noTickets: [], // commits not associated with jira tickets
 *    },
 *    tickets: {
 *      all: [],       // all tickets
 *      approved: [],  // tickets marked as approved
 *      pending: [],   // tickets not marked as approved
 *      pendingByOwner: [], // pending tickets arranged under ticket reporters.
 *    }
 *  }
 *
 * @param {Object} config - The config object provided by Config.getConfigForPath
 * @param {Array} logs - List of commit logs and their jira tickets.
 *
 * @return {Promise} Resolves to an object with filtered commit/ticket data
 */
export function transformCommitLogs(config, logs) {
  // Filter reverts
  const reducedLogs = filterRevertedCommits(logs);

  // Organize logs by jira ticket keys
  const ticketHash = reducedLogs.reduce((all, log) => {
    log.tickets.forEach((ticket) => {
      all[ticket.key] = all[ticket.key] || ticket;
      all[ticket.key].commits = all[ticket.key].commits || [];
      all[ticket.key].commits.push(log);
    });
    return all;
  }, {});

  // Mark tickets as reverted
  decorateTicketReverts(Object.values(ticketHash));

  // Sort tickets by type name and get pending tickets
  let ticketList = _.sortBy(Object.values(ticketHash), ticket => ticket.fields.issuetype.name);
  let tixByStatus = groupTicketsByStatus(config, ticketList);
  const pendingByOwner = getTicketReporters(tixByStatus.pending);

  // Output filtered data
  return {
    commits: {
      all: reducedLogs,
      tickets: reducedLogs.filter(commit => commit.tickets.length),
      noTickets: reducedLogs.filter(commit => !commit.tickets.length),
      reverted: reducedLogs.filter(l => l.reverted || l.revertedBy),
    },
    tickets: {
      pendingByOwner,
      all: ticketList,
      approved: tixByStatus.approved,
      pending: tixByStatus.pending,
      reverted: ticketList.filter(t => t.reverted),
    }
  }
}

/**
 * Render the changelog template
 *
 * @param {Object} config - The configuration object
 * @param {Array} changelog - The changelog list.
 * @param {Array} releaseVersions - Jira release versions for this changelog.
 */
export async function renderTemplate(config, changelog, releaseVersions) {
  // Template data template
  let data = await transformCommitLogs(config, changelog);
  if (typeof config.transformData == 'function') {
    data = await Promise.resolve(config.transformData(data));
  }
  data.jira = {
    baseUrl: config.jira.baseUrl,
    releaseVersions: releaseVersions,
  };

  // Render
  return ejs.render(config.template, data);
}
