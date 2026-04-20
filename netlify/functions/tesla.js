exports.handler = async function(event) {
  const TESLA_TOKEN = process.env.TESLA_TOKEN;
  const { endpoint } = event.queryStringParameters || {};

  const res = await fetch(`https://owner-api.teslamotors.com/api/1/${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${TESLA_TOKEN}`,
      'User-Agent': 'TeslaKM/1.0'
    }
  });

  const data = await res.json();
  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data)
  };
};
