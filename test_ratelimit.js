const axios = require('axios');
const TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI4QkJBRDkiLCJqdGkiOiI2YWMxMTAxODliZDhmMzEyMTA2YjdlYmIiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzkxMDM3NDY0LCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MjI2MDA4MDB9.hII6uw6jJC6VTUfA0prcgtt9_tjb6KLgnQ6RR2Cra6o";

const instance = axios.create({ headers: { 'Authorization': `Bearer ${TOKEN}`, 'Api-Version': '2.0' }});

async function run() {
  const keys = ['NSE_EQ|INE002A01018', 'NSE_EQ|INE467B01029', 'NSE_EQ|INE040A01034', 'NSE_EQ|INE009A01021', 'NSE_EQ|INE090A01021'];
  for (let i = 0; i < keys.length; i++) {
    try {
      const res = await instance.get(`https://api.upstox.com/v2/historical-candle/${encodeURIComponent(keys[i])}/day/2026-10-03/2025-10-03`);
      console.log(`Req ${i+1}:`, res.status, res.data.data.candles.length, "candles");
    } catch (e) {
      console.error(`Req ${i+1} failed:`, e.response?.status, e.response?.data);
    }
  }
}
run();
