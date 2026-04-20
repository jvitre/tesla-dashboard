const https = require('https');

exports.handler = async function(event) {
  const { endpoint } = event.queryStringParameters || {};
  const headers = { 'Access-Control-Allow-Origin': '*' };

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'owner-api.teslamotors.com',
      path: `/api/1/${endpoint}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.TESLA_TOKEN}`,
        'User-Agent': 'TeslaKM/1.0'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ statusCode: 200, headers, body: d }));
    });
    req.on('error', e => resolve({ statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }));
    req.end();
  });
};
