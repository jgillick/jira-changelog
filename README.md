Jira Changelog Generator
------------------------

Generates a changelog of Jira issues from your git history and, optionally, attach all issues to a release.

For example:

```bash
$ jira-changelog --range origin/prod...origin/master
```

```
Jira Tickets
---------------------

  * <Bug> - Unable to access date widget
    [DEV-1234] https://yoursite.atlassian.net/browse/DEV-1234

  * <Story> - Support left-handed keyboards
    [DEV-5678] https://yoursite.atlassian.net/browse/DEV-5678

  * <Story> - Search by location
    [DEV-8901] https://yoursite.atlassian.net/browse/DEV-8901

Other Commits
---------------------

  * <cd6f512> - Fix typo in welcome message

Pending Approval
---------------------
 ~ None. Yay! ~
```


You can also have it automatically post to slack!

## How it works

The script looks for Jira issue keys, surrounded by square brackets (i.e. `[DEV-123]`), in the git commit logs. When it finds one, it associates that Jira issue ticket with that commit and adds it to the changelog.


## Installation

```bash
npm install -g jira-changelog
```

## Build locally

```bash
npm install
npm run build
npm install -g .
```

### JIRA setup

Before configuring the app, register a new user in Jira for the app to use to retrieve and update tickets. Then create an [Auth Token](https://confluence.atlassian.com/cloud/api-tokens-938839638.html) for this user, which will be used for authentication. Jira no longer supports authenticating with password for API calls.

### Configuration

Create a file called `changelog.config.js` and put it at the root of your git workspace directory. This is also where you'll call the `jira-changelog` command from.

Here's a simple example with sample Jira API values:

```javascript
module.exports = {
  jira: {
    api: {
      host: 'myapp.atlassian.net',
      email: 'jirauser@myapp.com',
      token: 'qWoJBdlEp6pJy15fc9tGpsOOR2L5i35v'
    },
  }
}
```

The token is the [API token](https://confluence.atlassian.com/cloud/api-tokens-938839638.html) assigned to this user. To see all values supported, look at the [changelog.config.js](https://github.com/jgillick/jira-changelog/blob/master/changelog.config.js) file at the root of this repo.

## Usage

```bash
jira-changelog --range origin/prod...origin/master
```

Assuming you deploy from a branch named `prod`, this will generate a changelog with all commits after the last production deploy to the current master version (You can change the default branch names with the [`sourceControl.defaultRange`](https://github.com/jgillick/jira-changelog/blob/master/) object, in your config).

```bash
jira-changelog
```

Alternatively, you can specify a range (using [git commit range](https://git-scm.com/book/en/v2/Git-Tools-Revision-Selection#_commit_ranges) format) in the command:

```bash
jira-changelog --range origin/prod...origin/stage
```


## Releases

You can automatically attach a release to all Jira issues in the changelog with the `--release` flag. For example, let's say we want to add all issues in the changelog to the "sprint-12" release:

```bash
jira-changelog --release sprint-12
```

This will set the `fixVersions` of all issues to "sprint-12" in Jira.

## Slack

The script can also automatically post the changelog to slack.

First, get an API token from Slack for your workspace:
https://api.slack.com/tokens

Then add slack to your configuration file:

```javascript
module.exports = {
  ...
  slack: {
    apiKey: 'asdlfkjasdoifuoiucvlkxjcvoixucvi',
    channel: '#changelogs'
  },
}
```

 * Add your API token to `slack.apiKey`.
 * `slack.channel` is the channel you want the script to send the changelog to.

Then simply add the `--slack` flag to the command:

```bash
jira-changelog --slack
```

## API
The code used to generate the changelogs can also be used as modules in your node app.
See the module source for documentation.

For example:

```bash
npm install -S jira-changelog
```

```javascript
const Config = require('jira-changelog').Config;
const SourceControl = require('jira-changelog').SourceControl;
const Jira = require('jira-changelog').Jira;

const gitRepoPath = '/home/user/source/'

// Get configuration
const confPath = `${gitRepoPath}/changelog.config.js`;
const config = Config.readConfigFile('/Users/jeremygillick/Source/app/changelog.config.js');

// Get commits for a range
const source = new SourceControl(config);
const range = {
  from: "origin/prod",
  to: "origin/master"
};
source.getCommitLogs(gitRepoPath, range).then((commitLogs) => {

  // Associate git commits with jira tickets and output changelog object
  const jira = new Jira(config);
  jira.generate(commitLogs).then((changelog) => {
    console.log(changelog);
  });

});
```
