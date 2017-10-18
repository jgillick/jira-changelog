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
   * Return commit logs for a range.
   *
   * @param {String} dir The source control workspace directory.
   * @param {Object} range An object defining the range boundaries (see above)
   *
   * @return {Promsie} Resolves to a list of commit objects
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
          authorEmail: '%ae'
        },
        '--no-merges': true,
        ...range
      }

      workspace.log(opts, (err, response) => {
        if (err) {
          return reject(err);
        }

        const logs = response.all;

        // Add slack users to commit logs
        const promises = logs.map((log) => {
          return this.slack.getUserForEmail(log.authorEmail)
            .catch(() => {}) // ignore errors
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
}
