import { manageOpenTrades } from './manage.js';

const flatten = process.env.FLATTEN_EOD === '1';
await manageOpenTrades({ flatten });
