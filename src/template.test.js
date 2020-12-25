
import {
  filterRevertedCommits,
  decorateTicketReverts,
  getTicketReporters,
  groupTicketsByStatus,
  transformCommitLogs, generateTemplateData, renderTemplate,
} from './template';
import {getDefaultConfig} from "./Config";

describe('filter reverts', () => {
  test('the revert commit is removed when the original commit is in the list', () => {
    const logs = [
      { revision: 10 },
      { revision: 11, reverted: 10, }, // filter this revert commit out & keep revision 10
      { revision: 12 },
    ];
    const filtered = filterRevertedCommits(logs);
    expect(filtered.length).toBe(2);
    expect(filtered.map(i => i.revision)).toEqual([10, 12]);
    expect(filtered[0].revertedBy).toBe(11);
  });

  test('the revert commit is retained when original commit is not in list', () => {
    const logs = [
      { revision: 10 },
      { revision: 11, reverted: 5, }, // keep revert commit because revision 5 isn't in list
      { revision: 12 },
    ];
    const filtered = filterRevertedCommits(logs);
    expect(filtered.length).toBe(3);
    expect(filtered.map(i => i.revision)).toEqual([10, 11, 12]);
  });
});


describe('Mark tickets as reverted', () => {
  test('out of order commits', () => {
    const tickets = [
      {
        key: 'ENG-123',
        commits: [
          // Not in date order
          { date: '2020-02-02T16:02:36-08:00', reverted: null },
          { date: '2020-02-04T16:02:36-08:00', reverted: 10 },
          { date: '2020-02-03T16:02:36-08:00', reverted: null },
        ]
      }
    ];
    decorateTicketReverts(tickets);
    expect(tickets[0].reverted).toBe(10);
  });

  test('reverted by commit', () => {
    const tickets = [
      {
        key: 'ENG-123',
        commits: [
          { date: '2020-02-04T16:02:36-08:00', revertedBy: 10 },
          { date: '2020-02-02T16:02:36-08:00', reverted: null },
          { date: '2020-02-03T16:02:36-08:00', reverted: null },
        ]
      }
    ];
    decorateTicketReverts(tickets);
    expect(tickets[0].reverted).toBe(10);
  });

  test('no reverts', () => {
    const tickets = [
      {
        key: 'ENG-123',
        commits: [
          { date: '2020-02-03T16:02:36-08:00', reverted: null },
        ]
      }
    ];
    decorateTicketReverts(tickets);
    expect(tickets[0].reverted).toBeFalsy();
  });

  test('no commits', () => {
    // This shouldn't happen, but just in case, it shouldn't fall over.
    const tickets = [
      { key: 'ENG-123' },
    ];
    decorateTicketReverts(tickets);
    expect(tickets[0].reverted).toBe(null);
  });
});

test('Get all ticket reporters', () => {
  const tickets = [
    {
      key: 'ENG-1234',
      slackUser: 'zaSlack',
      fields: {
        reporter: { email: 'za@za.com', displayName: 'Za' },
      }
    },
    {
      key: 'ENG-234',
      slackUser: 'zaSlack',
      fields: {
        reporter: { email: 'za@za.com', displayName: 'Za' },
      }
    },
    {
      key: 'ENG-345',
      slackUser: 'tomsSlack',
      fields: {
        reporter: { email: 'tom@tom.com', displayName: 'Thomas' },
      }
    },
  ];
  const reporters = getTicketReporters(tickets);
  const za = reporters.find(r => r.name === 'Za');
  const tom = reporters.find(r => r.name === 'Thomas');

  expect(reporters.length).toBe(2);
  expect(za.tickets.map(t => t.key)).toEqual(['ENG-1234', 'ENG-234']);
  expect(tom.tickets.map(t => t.key)).toEqual(['ENG-345']);
});

describe('Get pending tickets', () => {
  test('single approval status in config', () => {
    const tickets = [
      {
        key: 'ENG-1234',
        fields: { status: { name: 'Done' } }
      },
      {
        key: 'ENG-234',
        fields: { status: { name: 'Todo' } }
      },
    ];
    const config = { jira: { approvalStatus: 'Done' }};
    const groups = groupTicketsByStatus(config, tickets);

    expect(groups.pending[0].key).toBe('ENG-234');
    expect(groups.approved[0].key).toBe('ENG-1234');
  });

  test('multiple approval statuses in config', () => {
    const tickets = [
      {
        key: 'ENG-1234',
        fields: { status: { name: 'Done' } }
      },
      {
        key: 'ENG-234',
        fields: { status: { name: 'Todo' } }
      },
      {
        key: 'ENG-345',
        fields: { status: { name: 'Closed' } }
      },
    ];
    const config = { jira: { approvalStatus: ['Done', 'Closed'] }};
    const groups = groupTicketsByStatus(config, tickets);

    expect(groups.pending.map(t => t.key)).toEqual(['ENG-234']);
    expect(groups.approved.map(t => t.key)).toEqual(['ENG-1234', 'ENG-345']);
  });

  test('case insensitive', () => {
    const tickets = [
      {
        key: 'ENG-1234',
        fields: { status: { name: 'done' } }
      },
      {
        key: 'ENG-345',
        fields: { status: { name: 'ClOsEd' } }
      },
      {
        key: 'ENG-234',
        fields: { status: { name: 'Todo' } }
      },
    ];
    const config = { jira: { approvalStatus: ['DONE', 'Closed'] }};
    const groups = groupTicketsByStatus(config, tickets);

    expect(groups.pending.map(t => t.key)).toEqual(['ENG-234']);
    expect(groups.approved.map(t => t.key)).toEqual(['ENG-1234', 'ENG-345']);
  });

  test('no approval status in config', () => {
    const tickets = [
      {
        key: 'ENG-1234',
        fields: { status: { name: 'Done' } }
      },
      {
        key: 'ENG-234',
        fields: { status: { name: 'Todo' } }
      },
    ];

    // Undefined
    const config = { jira: { approvalStatus: undefined }};
    let groups = groupTicketsByStatus(config, tickets);
    expect(groups.pending.map(t => t.key)).toEqual(['ENG-1234', 'ENG-234']);
    expect(groups.approved.length).toBe(0);

    // Empty list
    config.jira.approvalStatus = [];
    groups = groupTicketsByStatus(config, tickets);
    expect(groups.pending.map(t => t.key)).toEqual(['ENG-1234', 'ENG-234']);
    expect(groups.approved.length).toBe(0);
  });
});

// Pull it all together
test('transform commit logs into template data', () => {
  const createTicket = (key, reporter, status) => (
    {
      key,
      slackUser: reporter,
      fields: {
        issuetype: { name: 'Story' },
        reporter: { email: reporter, displayName: reporter },
        status: { name: status },
      }
    }
  );
  const commitLogs = [
    {
      revision: 11,
      date: '2020-02-05T16:02:36-08:00',
      tickets: []
    },
    {
      revision: 10,
      date: '2020-02-04T16:02:36-08:00',
      tickets: [
        createTicket('ENG-123', 'za', 'Done'),
      ]
    },
    {
      revision: 9,
      date: '2020-02-03T16:02:36-08:00',
      tickets: [
        createTicket('ENG-234', 'john', 'Todo'),
        createTicket('ENG-345', 'za', 'QA'),
      ]
    },
    {
      revision: 8,
      date: '2020-02-01T16:02:36-08:00',
      reverted: 7,
      tickets: [
        createTicket('ENG-567', 'za', 'QA'),
      ]
    },
    {
      revision: 7,
      date: '2020-02-01T16:00:36-08:00',
      tickets: [
        createTicket('ENG-567', 'za', 'QA'),
      ]
    },
    {
      revision: 6,
      date: '2020-01-29T16:00:36-08:00',
      reverted: 5,
      tickets: [
        createTicket('ENG-987', 'debbie', 'QA'),
      ]
    },
  ];
  const config = { jira: { approvalStatus: ['Done', 'Closed'] }};
  const transformed = transformCommitLogs(config, commitLogs);

  const { commits, tickets } = transformed;

  expect(commits.all.length).toBe(5);
  expect(commits.tickets.length).toBe(4);
  expect(commits.noTickets.length).toBe(1);
  expect(commits.reverted.length).toBe(2);

  expect(tickets.all.length).toBe(5);
  expect(tickets.approved.length).toBe(1);
  expect(tickets.pending.length).toBe(4);
  expect(tickets.pendingByOwner.length).toBe(3);
  expect(tickets.reverted.length).toBe(2);
});

test('hideEmptyBlocks with false', async () => {
  const config = {
    ...getDefaultConfig(),
    hideEmptyBlocks: false,
  };
  const templateData = await generateTemplateData(config, [], []);
  const templateRendered = renderTemplate(config, templateData);

  expect(templateRendered).toContain('~ None ~');
});

test('hideEmptyBlocks with true', async () => {
  const config = {
    ...getDefaultConfig(),
    hideEmptyBlocks: true,
  };
  const templateData = await generateTemplateData(config, [], []);
  const templateRendered = renderTemplate(config, templateData);

  expect(templateRendered).not.toContain('~ None ~');
});
