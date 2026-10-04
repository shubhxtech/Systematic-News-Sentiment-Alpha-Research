import axios from 'axios';
async function run() {
  const res = await axios.get("https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz");
  console.log(typeof res.data);
  if (Array.isArray(res.data)) {
    console.log(res.data[0]);
  } else {
    console.log(Object.keys(res.data).slice(0, 5));
    console.log(res.data[Object.keys(res.data)[0]]);
  }
}
run();
