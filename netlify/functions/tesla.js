const https = require('https');

exports.handler = async function(event) {
  const TESLA_TOKEN = process.env.TESLA_TOKEN;
  const { endpoint } = event.queryStringParameters || {};

  return new Promise((resolve) => {
    const options = {
      hostname: 'owner-api.teslamotors.com',
      path: `/api/1/${endpoint}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TESLA_TOKEN}`,
        'User-Agent': 'TeslaKM/1.0',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: data
        });
      });
    });

    req.on('error', (e) => {
      resolve({
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: e.message })
      });
    });

    req.end();
  });
};
