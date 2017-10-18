module.exports = {

  // Jira integration
  jira: {

    // API
    api: {
      host: undefined,
      username: undefined,
      password: undefined
    },

    // Regex used to match the issue ticket key
    ticketIDPattern: /\[[a-zA-Z]+\-[0-9]+\]/,

    // Status names that mean the ticket is approved.
    approvalStatus: ['Done', 'Closed', 'Accepted'],

    // Tickets to exclude from the changelog, by type name
    excludeIssueTypes: ['Sub-task'],

    // Tickets to include in changelog, by type name.
    // If this is defined, `excludeIssueTypes` is ignored.
    includeIssueTypes: []
  },

  // Slack API integration
  slack: {

    // API key string
    apiKey: undefined,

    // The channel that the changelog will be posted in, when you use the `--slack` flag.
    // This can be a channel string ('#mychannel`) or a channel ID.
    channel: undefined,

    // The name to give the slack bot user, when posting the changelog
    username: "Changelog Bot",

    // Emoji to use for the bot icon.
    // Cannot be used at the same time as `icon_url`
    icon_emoji: ":clipboard:",

    // URL to an image to use as the icon for the bot.
    // Cannot be used at the same time as `icon_emoji`
    icon_url: undefined
  },

  // Github settings
  sourceControl: {

    // Default range for commits.
    // This can include from/to git commit references
    // and or after/before datestamps.
    defaultRange: {
      from: "origin/prod",
      to: "origin/stage"
    }
  },

  // Transforms the basic changelog data before it goes to the template.
  //  data - The changlelog data.
  transformData(data) {
    return Promise.resolve(data);
  },

  // Transform the changelog before posting to slack
  //  content - The changelog content which was output by the command
  //  data - The data which generated the changelog content.
  transformForSlack(content, data) {
    return Promise.resolve(content);
  },

  // The template that generates the output, as an ejs template.
  // Learn more: http://ejs.co/
  template: `
Jira Tickets
--------------
<% tickets.all.forEach((ticket) => { %>
  * <<%= ticket.fields.issuetype.name %>> - <%- ticket.fields.summary %>
    [<%= ticket.key %>] https://styleseat.atlassian.net/browse/<%= ticket.key %>
<% }); -%>
<% if (!tickets.all.length) {%> ~ None ~ <% } -%>

Other Commits
-------------------
<% commits.noTickets.forEach((commit) => { %>
  * <<%= commit.revision.substr(0, 7) %>> - <%= commit.summary -%>
<% }); %>
<% if (!commits.noTickets.length) {%> ~ None ~ <% } -%>

Pending Approval
---------------------
<% tickets.pendingByOwner.forEach((owner) => { %>
@<%= (owner.slackUser) ? owner.slackUser.name : owner.email %>
<% owner.tickets.forEach((ticket) => { -%>
  * https://styleseat.atlassian.net/browse/<%= ticket.key %>
<% }); -%>
<% }); -%>
<% if (!tickets.pendingByOwner.length) {%> ~ None. Yay! ~ <% } -%>
`
};
