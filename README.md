Jira Changelog Generator
------------------------

This script will look at a range of git commits, match them to Jira tickets and output all of it as a change log.

## How it works

If a developer adds the Jira issue ticket key in their message in square brakets, like `[JIRA-123]`, this commit will be associated with that Jira issue ticket when the script runs.

For example, this commit message:
`[DEV-123] Fixed a typo`

Will be associated with the Jira issue `DEV-123`.

## Installation

```bash
npm install -g .
```


## Configuration

You'll need to configure Jira before you can use this effectively. Create a file called `changelog.config.js`, put it at the root of your workspace directory, where you'll call the jira-changelog command from. Here's a basic example with the Jira API values:

```javascript
module.exports = {
  jira: {
    api: {
      host: "myapp.atlassian.net",
      username: "jirauser",
      password: "s00persecurePa55w0rdBr0"
    },
  }
}
```

To see all values suported, look at the `changelog.config.js` file at the root of this repo.

## Usage

```bash
jira-changelog --range origin/prod...origin/master
```

Assuming you deploy from the prod branch, this will generate a changelog with all commits from the last production deploy to the current master version.

## Slack

If you want to post the changelog to slack.

First add slack to your configuration file:

```javascript
module.exports = {
  slack: {
    apiKey: 'asdlfkjasdoifuoiucvlkxjcvoixucvi',
    channel: '#changelogs'
  },
  jira: {
    api: {
      host: "myapp.atlassian.net",
      username: "jirauser",
      password: "s00persecurePa55w0rdBr0"
    },
  }
}
```

Then add `--slack` to the command:
```bash
jira-changelog --range origin/prod...origin/master --slack
```

## API
The code used to generate the changelogs can also be used as modules in your JavaScript.
See the module source for documentation.

For example:

```javascript
const Config = require('jira-changelog').Config;
const SourceControl = require('jira-changelog').SourceControl;
const Jira = require('jira-changelog').Jira;

const gitRepoPath = '/home/user/source/'

// Get configuration
const config = Config.getConfigForPath(gitRepoPath);

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
