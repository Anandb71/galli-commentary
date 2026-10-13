'use strict';

const { publicConfig } = require('../lib/languages');
const { sendJson, apiKey } = require('../lib/http');

module.exports = (req, res) => {
  sendJson(res, 200, { ...publicConfig(), keyConfigured: Boolean(apiKey()) });
};
