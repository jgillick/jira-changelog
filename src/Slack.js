import fetch from 'node-fetch';
import urlencoded from 'form-urlencoded';

const API_ROOT = 'https://slack.com/api/';
const MSG_SIZE_LIMIT = 4000;

// Cache of GET requests
const cache = {};

/**
 * Manages the slack integration.
 */
export default class Slack {

  constructor(config) {
    this.config = config;
    this.slackUsers = false;
  }

  /**
   * Is the slack integration enabled
   */
  isEnabled() {
    return (this.config.slack && this.config.slack.apiKey);
  }

  /**
   * Make an API call and return the repsponse
   *
   * @param {String} endpoint - The API endpoint name. (i.e 'users.list')
   * @param {String} method - The HTTP method to use (i.e. GET)
   * @param {Object} body - The request body for POST or PUT. This will be serialized to application/x-www-form-urlencoded
   *
   * @return {Promise}
   */
  api(endpoint, method='GET', body=undefined) {
    const headers = {};
    const cachable = (method.toUpperCase() == 'GET');
    const url = `${API_ROOT}/${endpoint}?token=${this.config.slack.apiKey}`;

    if (!this.isEnabled()) {
      return Promise.reject('The slack API is not configured.');
    }

    if (typeof body === 'object') {
      body = urlencoded(body);
    }
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    else if (cachable && cache[url]) {
      return Promise.resolve(cache[url]);
    }

    return fetch(url, { method, body, headers })
    .then(res => res.json())
    .then((data) => {
      // Cache result
      if (cachable && data && data.ok) {
        cache[url] = data;
      }
    });
  }

  /**
   * Load all the slack users.
   *
   * @returns {Promise} Resolves to the user object list
   */
  getSlackUsers() {

    // No slack integration
    if (!this.isEnabled()) {
      return Promise.resolve([]);
    }

    // Already loaded users
    if (this.slackUsers) {
      return Promise.resolve(this.slackUsers);
    }

    // Get users
    return this.api("users.list").then((response) => {
      if (response.error) {
        console.error('Could not load slack users:', response.error);
        return Promise.reject(response.error);
      }

      this.slackUsers = response.members;
      return this.slackUsers;
    });
  }

  /**
   * Return a slack user object for an email address.
   *
   * @param {String} email - The email address to use to lookup the slack user.
   * @return {Promise} Resolves to the slack user object or undefined
   */
  getUserForEmail(email) {
    return this.getSlackUsers()
    .then((users) => users.find(
      user => (user.profile.email && user.profile.email.toLowerCase() === email.toLowerCase())
    ));
  }

  /**
   * Post a message to a slack channel.
   * If the message is longer than slack's limit, it will be cut into multiple messages.
   *
   * @param {String} text - The message to send to slack
   * @param {String} channel - The slack channel ID to send the message to. (i.e. `#engineering`)
   *
   * @return {Promise} Resolves when message has sent
   */
  postMessage(text, channel) {

    // No message
    if (!text || !text.length) {
      return Promise.reject('No text to send to slack.');
    }

    // No slack integration
    if (!this.isEnabled()) {
      return Promise.resolve({});
    }

    const chunks = this.splitUpMessage(text);

    // Send all message chunks
    const sendPromise = chunks.reduce((promise, text) => {
      return promise.then(() => sendChunk(text));
    }, Promise.resolve());

    // Sends a single message to the channel and returns a promise
    const self = this;
    function sendChunk(text) {
      return self.api('chat.postMessage', 'POST',
        {
          text,
          channel,
          username: self.config.slack.username,
          icon_emoji: self.config.slack.icon_emoji,
          icon_url: self.config.slack.icon_url
        }).then((response) => {
          if (response && !response.ok) {
            throw response.error;
          }
          return response;
        }
      );
    }

    return sendPromise;
  }

  /**
   * Cut a message into chunks that fit Slack's message length limits.
   * The text will be divided by newline characters, where possible.
   *
   * @param {String} text - The message text to split up.
   *
   * @return {Array}
   */
  splitUpMessage(text) {
    if (text.length <= MSG_SIZE_LIMIT) {
      return [text];
    }

    const lines = text.split('\n');
    const messages = [];
    const continuation = '...';
    const limit = MSG_SIZE_LIMIT - continuation.length;
    let block = '';

    lines.forEach((line) => {
      const tmpBlock = `${block}${line}\n`;

      // Within size limit
      if (tmpBlock.length <= MSG_SIZE_LIMIT) {
        block = tmpBlock;
      }
      // Bigger than size limit
      else {

        // Add last block and start new one
        if (block.length) {
          block = line;
          messages.push(block);
        }

        // No existing block, this line must be loner than the limit
        else {
          while (line.length > 0) {
            let last = line.substr(0, limit).trim();
            line = line.substr(limit).trim();

            // Add continuation characters
            if (line.length) {
              last += continuation;
              line = `${continuation}${line}`;
            }
            messages.push(last);
          }
        }
      }
    });

    return messages;
  }
}
