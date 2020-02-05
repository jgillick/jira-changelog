import Jira from './Jira';
import {getDefaultConfig} from './Config';

const DEFAULT_TICKET = () => ({
  fields: {
    issuetype: {
      name: 'story'
    },
    project: {
      key: 'proj1',
    },
    fixVersions: [],
  },
});

let config;
let jira;
beforeEach(() => {
  config = getDefaultConfig();
  config.jira.api = {
    host: '-',
    email: '-',
    token: '-',
  };
  jira = new Jira(config);
});

// Mock jira functions
let tixInJira = [];
let jiraVersions = [];
beforeEach(() => {
  tixInJira = [];
  jiraVersions = [];

  jira.fetchJiraTicket = jest.fn((key) => {
    if (tixInJira.includes(key)) {
      return Promise.resolve({key, ...DEFAULT_TICKET() });
    }
    return Promise.reject();
  });

  jira.jira.getVersions = jest.fn((project) => Promise.resolve(jiraVersions));
  jira.jira.createVersion = jest.fn((data) => Promise.resolve(data));
  jira.jira.updateIssue = jest.fn((key, data) => Promise.resolve(data));
});

describe('Extract ticket keys from a string', () => {
  test('Parse tickets out of a commit message', () => {
    const tickets = jira.parseTicketsFromString('Foo bar [ENG-123] [ABC-1]nospace');
    expect(tickets).toEqual(['ENG-123', 'ABC-1']);
  });

  test('no capture group in regexp', () => {
    config.jira.ticketIDPattern = /[A-Z]+\-[0-9]+/i;
    jira = new Jira(config);
    const tickets = jira.parseTicketsFromString('Foo bar ENG-123 ABC-1nospace');
    expect(tickets).toEqual(['ENG-123', 'ABC-1']);
  });
});

describe('Fetch ticket objects from Jira', () => {
  test('Get tickets from jira', async () => {
    tixInJira = ['ENG-123', 'ABC-1'];

    const commit = await jira.findJiraInCommit({
      fullText: 'Foo bar [ENG-123] [ABC-1] [NOOP-345]',
    });
    const tix = commit.tickets.map(t => t.key);

    expect(tix).toEqual(['ENG-123', 'ABC-1']);
    expect(tix).not.toEqual(expect.arrayContaining(['NOOP-345']));
  });

  test('Cache jira requests', async () => {
    tixInJira = ['ENG-123', 'ABC-1'];

    const commit = await jira.findJiraInCommit({
      fullText: '[ENG-123] [ABC-1] [ENG-123]',
    });
    const tix = commit.tickets.map(t => t.key);

    expect(tix).toEqual(['ENG-123', 'ABC-1']);
    expect(jira.fetchJiraTicket).toBeCalledTimes(2);
  });
});

describe('Filtering by ticket type', () => {
  const fooTicket = {
    ...DEFAULT_TICKET(),
    fields: {
      issuetype: {
        name: 'foo'
      },
    },
  };
  const barTicket = {
    ...DEFAULT_TICKET(),
    fields: {
      issuetype: {
        name: 'bar'
      },
    },
  };

  test('Has include list', () => {
    config.jira.includeIssueTypes = ['foo', 'boo'];
    jira = new Jira(config);
    expect(jira.includeTicket(fooTicket)).toBe(true);
    expect(jira.includeTicket(barTicket)).toBe(false);
  });

  test('Does not have include list', () => {
    config.jira.includeIssueTypes = [];
    jira = new Jira(config);
    expect(jira.includeTicket(fooTicket)).toBe(true);
    expect(jira.includeTicket(barTicket)).toBe(true);
  });

  test('Has exclude list', () => {
    config.jira.excludeIssueTypes = ['foo', 'boo'];
    jira = new Jira(config);
    expect(jira.includeTicket(fooTicket)).toBe(false);
    expect(jira.includeTicket(barTicket)).toBe(true);
  });

  test('Has conflicting include/exclude lists', () => {
    // Includes list is used, if it exists
    config.jira.includeIssueTypes = ['foo', 'boo'];
    config.jira.excludeIssueTypes = ['foo', 'boo'];
    jira = new Jira(config);
    expect(jira.includeTicket(fooTicket)).toBe(true);
    expect(jira.includeTicket(barTicket)).toBe(false);
  });

  test('Has neither include/exclude lists', () => {
    config.jira.includeIssueTypes = null;
    config.jira.excludeIssueTypes = null;
    jira = new Jira(config);
    expect(jira.includeTicket(fooTicket)).toBe(true);
    expect(jira.includeTicket(barTicket)).toBe(true);
  })
});

describe('Release version', () => {
  test('create new project version', async () => {
    const ver = await jira.createProjectVersion('test-version-1', 'project1');
    expect(ver.name).toBe('test-version-1');
    expect(ver.project).toBe('project1');
    expect(jira.jira.createVersion).toHaveBeenCalled();
  });

  test('reuse existing proejct version', async () => {
    jiraVersions = [{
      name: 'test-version-1',
      project: 'project1',
    }];
    const ver = await jira.createProjectVersion('test-version-1', 'project1');
    expect(ver.name).toBe('test-version-1');
    expect(ver.project).toBe('project1');
    expect(jira.jira.createVersion).not.toHaveBeenCalled();
  });

  test('add release to tickets', async () => {
    const tickets = [
      {id: 987, key: 'ENG-123', ...DEFAULT_TICKET()},
      {id: 876, key: 'BAR-234', ...DEFAULT_TICKET()},
    ]
    await jira.addTicketsToReleaseVersion(tickets, 'test-release-1');

    expect(jira.jira.createVersion).toBeCalledTimes(1);

    const mockUpdateIssue = jira.jira.updateIssue;
    expect(mockUpdateIssue).toBeCalledTimes(2);
    expect(mockUpdateIssue.mock.calls[0][0]).toBe(987);
    expect(mockUpdateIssue.mock.calls[0][1].fields.fixVersions).toEqual([{ name: 'test-release-1'}]);
    expect(mockUpdateIssue.mock.calls[1][0]).toBe(876);
    expect(mockUpdateIssue.mock.calls[1][1].fields.fixVersions).toEqual([{ name: 'test-release-1'}]);
  });
});

// Pull it all together
describe('Generate changelog', () => {
  const commits = [
    {
      revision: '1',
      fullText: 'Testing [ENG-123][BAR-234]',
    },
    {
      revision: '2',
      fullText: 'Hello world [ENG-123]',
    },
    {
      revision: '4',
      fullText: '[BOO-345] The quick brown fox',
    },
  ];

  beforeEach(() => {
    tixInJira = ['ENG-123', 'BAR-234', 'BOO-345'];
  });

  test('Tickets are attached to commits', async () => {
    const changelog = await jira.generate(commits);
    expect(changelog[0].tickets.map(t => t.key)).toEqual(['ENG-123', 'BAR-234']);
    expect(changelog[1].tickets.map(t => t.key)).toEqual(['ENG-123']);
    expect(changelog[2].tickets.map(t => t.key)).toEqual(['BOO-345']);
  });
});
