import Slack from './Slack';
import git from 'simple-git';

/**
 * Connect to the source control system and return commit logs for a range.
 * Currenty this only connects to git.
 *
 * Range Object
 * ------------
 * The range object should contain at least one of the following properties:
 * ```
 * {
 *   from:   {String}  The commit revision or branch name to start from, inclusive.
 *   to:     {String}  The commit revision or branch name to go to, inclusive.
 *   after:  {DateStr} Only commits after this date.
 *   before: {DateStr} Only comits before this date.
 * }
 * ```
 *
 *
 * Commit Log Object
 * ------------------
 * Each commit log object will look like the following:
 *
 * ```
 * {
 *   revision: <commit revision hash>,
 *   date: <date>,
 *   summary: <short commit message>,
 *   fullText: <full commit message>,
 *   authorName: <name of commit author>,
 *   authorEmail: <email of commit author>,
 *   slackUser: <object of slack user, as matched by authorEmail>
 * }
 * ```
 *
 */
export default class SourceControl {

  constructor(config) {
    this.slack = new Slack(config);
  }

  /**
   * Return top-level commit logs for a range.
   * Commits which were the result of a merge are nested under `<log>.graph.merged`.
   *
   * @param {String} dir The source control workspace directory.
   * @param {Object} range An object defining the range boundaries (see above)
   *
   * @return {Promsie} Resolves to a list of top-level commit objects
   */
  getCommitLogs(workspaceDir, range) {
    const workspace = git(workspaceDir);

    return new Promise((resolve, reject) => {

      const opts = {
        format: {
          revision: '%H',
          date: '%ai',
          summary: '%s%d',
          fullText: '%s%d%b',
          authorName: '%aN',
          authorEmail: '%ae',
          parents: '%P'
        },
        ...range,
      }

      workspace.log(opts, (err, response) => {
        if (err) {
          return reject(err);
        }

        // Organize commits
        const graph = this.simpleTopLevelGraph(response.all);
        const logs = this.consolodateCommitMessages(graph);

        // Add slack users to commit logs
        const promises = logs.map((log) => {
          return this.slack.findUser(log.authorEmail, log.authorName)
            .catch((err) => { console.log(err); }) // ignore errors
            .then((slackUser) => {
              log.slackUser = slackUser;
              return log;
            });
        });
        promises.push(Promise.resolve());

        Promise.all(promises).then(() => {
          resolve(logs);
        });
      });
    });
  }

  /**
   * Create a simple 1-level-deep graph of commit logs.
   * Returns an array of top-level commits, each which contains
   * any merged commits inside of it's `.graph.merged` property array.
   *
   * For example, with this git graph:
   *    1
   *    2
   *    3 ⟍
   *    4   2a
   *    5   2b
   *    6 ⟋
   *    7 ⟍
   *    8   6a
   *    9   6b ⟍
   *    10       6b1
   *    11       6b2
   *    12  6c ⟋
   *    13  6d
   *    14 ⟋
   *    15
   *
   * The simplfied graph would look like:
   *
   *    - 1
   *    - 2
   *        ↳ 2a
   *        ↳ 2b
   *    - 3
   *    - 4
   *    - 5
   *    - 6
   *        ↳ 6a
   *        ↳ 6b
   *        ↳ 6b1
   *        ↳ 6b2
   *        ↳ 6c
   *        ↳ 2d
   *    - 7
   *    - 8
   *    - 9
   *    - 10
   *    - 11
   *    - 12
   *    - 13
   *    - 14
   *
   * @param {Array} logs
   * @return {Array}
   */
  simpleTopLevelGraph(logs) {
    const hashes = {};
    const graph = [];

    // First get the hashes from all commits and turn parents into an array
    const logObjs = logs.map((l) => {
      const log = { ...l };
      const parents = log.parents.split(' ');

      // Create log object
      log.graph = {
        prev: parents[0],
        parents: parents.slice(1),
        merged: [],
      };

      hashes[log.revision] = log;
      return log;
    });

    // Get mainline commits (not commits merged in from other branches)
    let log = logObjs[0];
    while (log) {
      graph.push(log);
      delete hashes[log.revision];
      log = hashes[log.graph.prev];
    }

    // Add all merged commits under mainline
    function relatedLogs(logItem) {
      let out = [];
      if (!logItem || !logItem.graph) {
        return;
      }
      const related = [
        logItem.graph.prev,
        logItem.graph.parents
      ];

      related.forEach((hash) => {
        const relatedObj = hashes[hash];
        if (relatedObj) {
          delete hashes[hash];
          out = out.concat(relatedObj);
          out = out.concat(relatedLogs(relatedObj));
        }
      });

      return out;
    }
    graph.forEach((topLevelLog) => {
      topLevelLog.graph.merged = relatedLogs(topLevelLog);
    });

    return graph;
  }

  /**
   * Given the commit graph (see simpleTopLevelGraph), combine all merged commit
   * messages (summary/fullText) strings into a single string at the merge commit.
   *
   * For example, with this git graph:
   *    1
   *    2
   *    3 ⟍
   *    4   2a
   *    5   2b
   *    6 ⟋
   *
   * Revision 6 would contain the commit messages from revision 6, 2a, and 2b.
   *
   * @param {Array} graph - Commit history graph
   * @return {Array}
   */
  consolodateCommitMessages(graph) {
    const commits = [ ...graph ];

    commits.forEach((item) => {
      let { summary, fullText } = item;

      item.graph.merged.forEach((merged) => {
        summary += `\n${merged.summary.trim()}`;
        fullText += `\n${merged.fullText.trim()}`;
      });

      item.summary = summary.trim();
      item.fullText = fullText.trim();
    });

    return commits;
  }
}
