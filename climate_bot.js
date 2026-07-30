import 'dotenv/config'; //load env variables from codespaces secrets/configuration settings. install npm install dotenv
import axios from 'axios';
import kalshiPkg from 'kalshi-typescript'; //install with npm install 'kalshi-typescript'
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';


// Set global default (applies to all console.log / console.table / util.inspect calls)
util.inspect.defaultOptions.maxArrayLength = null;  // null = unlimited, show all items

//configuration (replace with kalshi credentials)
const kalshiApiKeyId = process.env.KALSHI_API_KEY_ID;
const privateKeyStr = process.env.KALSHI_PRIVATE_KEY; //PEM string

const __filename = fileURLToPath(import.meta.url); //get path that this job was executed from
const __dirname = path.dirname(__filename); //defining the directory variable using the filename variable
const logPath = path.join(__dirname, 'climate_bot.log');

//import classes/constructors from kalshi package
const Configuration = kalshiPkg.Configuration;
const MarketsApi = kalshiPkg.MarketApi;
const PortfolioApi = kalshiPkg.PortfolioApi;
const OrdersApi = kalshiPkg.OrdersApi;
const EventsApi = kalshiPkg.EventsApi;

const currentDay = fetchTodaysDate();
const nextDay = fetchTomorrowsDate();
const nextDayNumeric = fetchTomorrowsDateNumeric();
const currentDayNumeric = fetchTodaysDateNumeric();

const dailyClimateSeries = new Map();
const dailyForecastMap = new Map();

const climateMarkets = new Map([
    ['KXHIGHCHI', { series: 'KXHIGHCHI', city: 'Chicago', nwsOID: 'LOT', nwsZID: 'ILZ014', lon: 88.0962, lat: 41.6073, altLon: 60, altLat: 60, deviation: 4.2, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    //['KXHIGHAUS', { series: 'KXHIGHAUS', city: 'Austin', nwsOID: 'EWX', lon: 98.0286, lat: 29.7036, altLon: 144, altLat: 66, deviation: 3.7, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}], //this one is suspicious
    ['KXHIGHDEN', { series: 'KXHIGHDEN', city: 'Denver', nwsOID: 'BOU', nwsZID: 'COZ039', lon: 105.1158, lat: 39.7747, altLon: 59, altLat: 63, deviation: 5.0, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    ['KXHIGHLAX', { series: 'KXHIGHLAX', city: 'Los Angeles', nwsOID: 'LOX', nwsZID: 'CAZ366', lon: 118.38889, lat: 33.93806, altLon: 148, altLat: 41, deviation: 2.8, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    //['KXHIGHMIA', { series: 'KXHIGHMIA', city: 'Miami', nwsOID: 'MFL', lon: 80.2906, lat: 25.7933, altLon: 109, altLat: 50, deviation: 2.7, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    //['KXHIGHNY', { series: 'KXHIGHNY', city: 'New York', nwsOID: 'OKX', lon: 40.8653, lat: 72.8639, altLon: 72, altLat: 47, deviation: 3.6, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    ['KXHIGHPHIL', { series: 'KXHIGHPHIL', city: 'Philadelphia', nwsOID: 'PHI', nwsZID: 'PAZ071', lon: 75.2408, lat: 39.8722, altLon: 48, altLat: 75, deviation: 3.8, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    ['KXHIGHTSFO', { series: 'KXHIGHTSFO', city: 'San Francisco', nwsOID: 'MTR', nwsZID: 'CAZ508', lon: 122.386, lat: 37.616, altLon: 84, altLat: 98, deviation: 2.8, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    //['KXHIGHTSEA', { series: 'KXHIGHTSEA', city: 'Seattle', nwsOID: 'SEW', lon: 122.3094, lat: 47.4489, altLon: 139, altLat: 64, deviation: 3.4, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    ['KXHIGHTLV', { series: 'KXHIGHTLV', city: 'Las Vegas', nwsOID: 'VEF', nwsZID: 'NVZ020', lon: 115.1522, lat: 36.0800, altLon: 122, altLat: 94, deviation: 4.1, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    ['KXLOWTCHI', { series: 'KXLOWTCHI', city: 'Chicago', nwsOID: 'LOT', nwsZID: 'ILZ014', lon: 88.0962, lat: 41.6073, altLon: 60, altLat: 60, deviation:4.6, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    //['KXLOWTAUS', { series: 'KXLOWTAUS', city: 'Austin', nwsOID: 'EWX', lon: 98.0286, lat: 29.7036, altLon: 144, altLat: 66, deviation:4.0, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}], //this one is suspicious
    ['KXLOWTDEN', { series: 'KXLOWTDEN', city: 'Denver', nwsOID: 'BOU', nwsZID: 'COZ039', lon: 105.1158, lat: 39.7747, altLon: 59, altLat: 63, deviation: 5.7, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    ['KXLOWTLAX', { series: 'KXLOWTLAX', city: 'Los Angeles', nwsOID: 'LOX', nwsZID: 'CAZ368', lon: 118.4085, lat: 33.9416, altLon: 148, altLat: 41, deviation: 3.1, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    //['KXLOWTMIA', { series: 'KXLOWTMIA', city: 'Miami', nwsOID: 'MFL', lon: 80.2906, lat: 25.7933, altLon: 109, altLat: 50, deviation: 2.9, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    //['KXLOWTNYC', { series: 'KXLOWTNYC', city: 'New York', nwsOID: 'OKX', lon: 73.9656, lat: 40.7826, altLon: 72, altLat: 47, deviation: 3.9, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    ['KXLOWTPHIL', { series: 'KXLOWTPHIL', city: 'Philadelphia', nwsOID: 'PHI', nwsZID: 'PAZ071', lon: 75.2408, lat: 39.8722, altLon: 48, altLat: 75, deviation: 4.1, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    //['KXLOWTSFO', { series: 'KXLOWTSFO', city: 'San Francisco', nwsOID: 'MTR', lon: 122.4194, lat: 37.7749, lon: 121.8582083, lat: 36.5928708, deviation: 3.0, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    //['KXLOWTSEA', { series: 'KXLOWTSEA', city: 'Seattle', nwsOID: 'SEW', lon: 122.3094, lat: 47.4489, altLon: 139, altLat: 64, deviation: 3.7, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}],
    //['KXLOWTLV', { series: 'KXLOWTLV', city: 'Las Vegas', nwsOID: 'VEF', lon: 115.1522, lat: 36.0800, altLon: 122, altLat: 94, deviation: 4.5, dfHigh: '0', dfLow: '0', ndfHigh: '0', ndfLow: '0'}]
]);

const debugLvl = 1; //switching from true/false to levels to determine verbosity
const autoExecute = false; //set to true to enable scripted actions

const kellyFraction = 0.5;
const maxRiskPerTrade = 0.1;

const regex = /(\d+(?:\.\d+)?)\s*(?:°)?\s*(?:to|[-–—])\s*(?:°)?\s*(\d+(?:\.\d+)?)/i;

//base URLs
const baseURL = 'https://api.elections.kalshi.com/trade-api/v2';
const nwsURL = 'https://api.weather.gov';
const omURL = 'https://api.open-meteo.com/v1';

const config = new Configuration({
    apiKey: kalshiApiKeyId,
    privateKeyPem: privateKeyStr,
    basePath: baseURL
});

//Polling
const pollInterval = 300000; //e.g. 5 minute polling

//Fees: kalshi - ~0.5-1% per trade, polymarket gas + 0.25%
const kalshiFee = 0.01; //1%

const BANKROLL = 10; // 10 dollars, 100 change max per trade to 1%
const MAX_PER_TRADE = 0.1 // 10% of bankroll, change to 1 if going to 100 for bankroll
let DAILY_TRADE_CAP = 8;
const minProfitThreshold = 0.02; // adjust percentage as needed for arbitrage
const MODEL_WEIGHT = 0.7; //60% model, 40% market for blended weight probabilities

const minFairValueEdge = 0.05; // a.k.a EV/expected value - minimum 5% edge for stat-based trading i.e. fair-value vs. market price
const EV_THRESHOLD = minFairValueEdge;

//init APIs
const marketsApi = new MarketsApi(config);
const portfolioApi = new PortfolioApi(config);
const ordersApi = new OrdersApi(config);

const locationCache = new Map();
let cachedAnomaly = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


///Begin class definition for object type daily_Market
class daily_Market {
    constructor(s_Ticker, mType){
        this.name = s_Ticker,   //can this also then be replaced with something like.. this.name = { series: 'fill', id: 'OID' };
        this.seriesName = s_Ticker,
        this.mType = mType,    //series or market, series is composed of markets, markets are singular events
        this.dfHigh = 0,  // can replace with an array like so?-> this.dailyTemps = { high: 0, low: 0 };
        this.dfLow = 0,
        this.ndfHigh = 0,
        this.ndfLow = 0,
        this.category = null;
        //this.valueCaps = { low: 0, high: 0 },
        //this.potentialWinner = new daily_Market(this.seriesName}-${currentDay}, 'market');
        this.potentialWinner = `${s_Ticker}-${currentDay}`;
    }

    toString(){
        return `${this.seriesName}`;
    }

    updateName(name){
        this.name = name;
        if(debugLvl >= 2)console.log(`Name updated to: ${name}`);
    }

    updateSeriesTicker(newTicker){
        this.seriesName = newTicker;
        if(debugLvl >= 2)console.log(`Series Ticker updated to: ${newTicker}`);
    }

    updateId(id){
        this.mType = id;
        if(debugLvl >= 2)console.log(`ID updated to: ${id}`);
    }

    updateType(newType){
        this.mType = newType;
        if(debugLvl >= 2)console.log(`Type updated to: ${newType}`);
    }

    updateCoordinates(lon, lat){
        this.lon = lon;
        this.lat = lat;
        if(debugLvl >= 2)console.log(`Coordinates updated to: ${lon}, ${lat}`);
    }

    updateDailyTemps(newLow, newHigh){
        this.dfHigh = newHigh;
        this.dfLow = newLow;
        if(debugLvl >= 2)console.log(`Daily temperatures updated to: High: ${newHigh}, Low: ${newLow}`);
    }

    updateNextDayTemps(newLow, newHigh){
        this.ndfHigh = newHigh;
        this.ndfLow = newLow;
        if(debugLvl >= 2)console.log(`Next Day temperatures updated to: High: ${newHigh}, Low: ${newLow}`);
    }

    setMarketCategory(newCat){
    if(newCat.includes("KXHIGH")){
        this.category = "high";
    } 
    if (newCat.includes("KXLOW")){
        this.category = "low";
    }
        if(debugLvl >= 2){console.log(`updated market category to: ${newCat}`);}
    }

    getMarketCategory(){
        return this.category;
    }

    getDailyTicker(){
        return `${this.name}-${currentDay}`;
    }

    getTomorrowsTicker(){
        return `${this.name}-${nextDay}`;
    }

    getDailyTemps(){
        const low = this.dfLow;
        const high = this.dfHigh;
        if(debugLvl >= 2)console.log(`low: ${this.dfLow}, high: ${this.dfHigh}`);
        return { low, high };
    }

    getNextDayTemps(){
        const low = this.ndfLow;
        const high = this.ndfHigh;
        if(debugLvl >= 2)console.log(`low: ${this.ndfLow}, high: ${this.ndfHigh}`);
        return { low, high };
    }
}
///end class definition for object type daily_Market

///Begin Class definition for object type daily_Forecast
class daily_Forecast{
    constructor( forSeries, date, location, nwsOID, coordinates, standardDeviation){
      this.name = forSeries;
      this.date = date;
      this.location = location;
      this.nwsOID = nwsOID;
      this.forecastHigh  = null;
      this.nwsForecastHigh = null;
      this.forecastLow = null;
      this.nwsForecastLow = null;
      this.forecastTemperature = null
      this.nwsForecastTemperature = null;
      this.confidenceHigh = null;
      this.nwsConfidenceHigh = null;
      this.confidenceLow = null;
      this.nwsConfidenceLow = null;
      this.forecastConfidence = null;
      this.nwsForecastConfidence = null;
      this.longitude = coordinates.lon;
      this.latitude = coordinates.lat;
      this.altLongitude = coordinates.altLon;
      this.altLatitude = coordinates.altLat;
      this.deviation = standardDeviation;
    }

    toString(){
        //return `Forecast for: ${this.name}, ${this.location} : ${this.latitude},${this.longitude} on ${this.date}: High: ${this.forecastHigh} - ${this.confidenceHigh}, Low: ${this.forecastLow} - ${this.confidenceLow}`;
        return `Forecast for: ${this.name}, ${this.location} : ${this.latitude},${this.longitude} on ${this.date}: Forecast Temperature(s): ${this.forecastTemperature} - ${this.nwsForecastTemperature}, Forecast Confidence(s): ${this.forecastConfidence} - ${this.nwsForecastConfidence}, Standard Deviation: ${this.standardDeviation}`;
    }

    getDate(){
        return this.date;
    }

    getForecastTemperatures(){
        return { low: this.forecastLow, high: this.forecastHigh, nws_low: this.nwsForecastLow, nws_high: this.nwsForecastHigh };
    }
    
    getForecastTemperature(){
        return this.forecastTemperature;
    }
    
    getNWSForecastTemperature(){
        //return (this.nwsForecastTemperature === null ? this.forecastTemperature : this.nwsForecastTemperature);
        return this.nwsForecastTemperature;
    }

    getCoordinates(){
        return { lat: this.latitude, lon:this.longitude, altLat: this.altLatitude, altLon: this.altLongitude };
    }

    getConfidenceLevels(){
        return { low: this.confidenceLow, high: this.confidenceHigh, nws_low: this.nwsConfidenceLow, nws_high: this.nwsConfidenceHigh };
    }

    getConfidence(){
        return this.forecastConfidence;
    }

    getNWSConfidence(){
        return this.nwsForecastConfidence;
    }

    getSeriesType(){
        if(this.name.includes('KXHIGH')){
            return 'high';
        }
        if(this.name.includes('KXLOW')){
            return 'low';
        }
    }

    isToday(){
        let today = currentDayNumeric.slice(0,4) + "-" + currentDayNumeric.slice(4,6) + "-" + currentDayNumeric.slice(6);
        if(this.date === today){
            return true;
        } else {
             return false;
        }
    }

    isTomorrow(){
        let tomorrow = nextDayNumeric.slice(0,4) + "-" + nextDayNumeric.slice(4,6) + "-" + nextDayNumeric.slice(6);
        if(this.date === tomorrow){
            return true;
        } else {
            return false;
        }
    }

    setDate(newDate){
        this.date = newDate;
        if(debugLvl >= 2){console.log(`Date for Forecast ${this.name} updated to: ${newDate}`);}
    }

    setConfidence(newConf){
        this.forecastConfidence = newConf;
        if(debugLvl >= 2){console.log(`Confidence level for Forecast ${this.name} updated to ${newConf}`);}
    }

    setNWSConfidence(newConf){
        this.nwsForecastConfidence = newConf;
        if(debugLvl >= 2){console.log(`Confidence level for NWS Forecast ${this.name} updated to ${newConf}`);}
    }

    setCoordinates(newLat, newLon){
        this.latitude = newLat;
        this.longitude = newLon;
        if(debugLvl >= 2){console.log(`Coordinates for Forecast ${this.name} updated to: ${newLat},${newLon}`);}
    }

    setNWSCoordinates(newLat, newLon){
        this.altLatitude = newLat;
        this.altLongitude = newLon;
        if(debugLvl >= 2){console.log(`Coordinates for Forecast ${this.name} updated to: ${newLat},${newLon}`);}
    }

    setTemperatures(newLow, newHigh){
        this.forecastLow = newLow;
        this.forecastHigh = newHigh;
        if(debugLvl >= 2){console.log(`Temperatures for Forecast ${this.name} updated to: ${newLow},${newHigh}`);}
    }

    setNWSTemperatures(newLow, newHigh){
        this.nwsForecastLow = newLow;
        this.nwsForecastHigh = newHigh;
        if(debugLvl >= 2){console.log(`Temperatures for Forecast ${this.name} updated to: ${newLow},${newHigh}`);}
    }

    setTemperature(newTemp){
        this.forecastTemperature = newTemp;
        if(debugLvl >= 2){console.log(`Temperatures for Forecast ${this.name} updated to: ${newTemp}`);}
    }

    setNWSTemperature(newTemp){
        this.nwsForecastTemperature = newTemp;
        if(debugLvl >= 2){console.log(`Temperatures for Forecast ${this.name} updated to: ${newTemp}`);}
    }

    setLocation(newLocation){
        this.location = newLocation;
        if(debugLvl >= 2){console.log(`Location for Forecast ${this.name} updated to: ${newLocation}`);}
    }
}

//begin function for createSeries which converts a static map of values into daily_Market objects
function createSeriesMap(seriesMap){ //this works now.
    const temp = [];
    if(debugLvl >= 2){console.log('Creating series from static map..');}
    /* confirmed that this does display the values of the static map
    for (const v of seriesMap.values()){
        console.log(v);
    }*/
    //Now we'll create observation objects out of the map keys which will host child observation objects.
    for( const k of seriesMap.keys()){
        temp.push(new daily_Market(k, 'series'));
    }
    return temp;
}

function createForecastMap(seriesMap){ //this works now.
    const temp = [];
    let tomorrow = nextDayNumeric.slice(0,4) + "-" + nextDayNumeric.slice(4,6) + "-" + nextDayNumeric.slice(6);
    let today = currentDayNumeric.slice(0,4) + "-" + currentDayNumeric.slice(4,6) + "-" + currentDayNumeric.slice(6);
    if(debugLvl >= 2){console.log('Creating series from static map..');}
    /* confirmed that this does display the values of the static map
    for (const v of seriesMap.values()){
        console.log(v);
    }*/
    //Now we'll create observation objects out of the map keys which will host child observation objects.
    for( const k of seriesMap.values()){
        temp.push(new daily_Forecast(`${k.series}-${nextDay}`, tomorrow, k.city, k.nwsOID, { lat: k.lat, lon:k.lon, altLat: k.altLat, altLon: k.altLon }, k.deviation ));
        temp.push(new daily_Forecast(`${k.series}-${currentDay}`, today, k.city, k.nwsOID, { lat: k.lat, lon:k.lon, altLat: k.altLat, altLon: k.altLon }, k.deviation ));
    }
    return temp;
}
//end function for createSeries

/**
 * Convert any input (number, numeric string, etc.) to the integer part.
 * Throws if the input cannot be interpreted as a finite number.
 *
 * @param {unknown} raw - the raw longitude value (e.g. "80.02" or 80.02)
 * @returns {number} - integer part (e.g. 80)
 */
function toInteger(raw) {
  // 1️. Coerce to a Number. `Number()` handles both numbers and numeric strings.
  const num = Number(raw);

  // 2️. Guard against NaN / Infinity – these are not acceptable as integers.
  if (!Number.isFinite(num)) {
    throw new TypeError(`Cannot convert '${raw}' to a finite number`);
  }

  // 3️/ Drop the fractional part. `Math.trunc` works for positive & negative values.
  return Math.trunc(num);
}

function fetchTodaysDate(){

  const now = new Date();                //  current moment
  //const year  = String(now.getFullYear() % 100).padStart(2, '0'); // last 2 digits
  const year = now.toLocaleString('en-US', {timeZone: 'America/Chicago', year: '2-digit' });
  const month = now.toLocaleString('en-US', {timeZone: 'America/Chicago', month: 'short' }).toUpperCase(); // "Jan"…"Dec"'en-US', { timeZone: 'America/Chicago' }
  //const day   = now.getDate();           // 1‑31 (no leading zero)
  //const day = String(now.getDate()).padStart(2, '0'); //with leading zeros
  const day = now.toLocaleString('en-US', { timeZone: 'America/Chicago', day: '2-digit' });

  // Assemble the parts in the order you want:
  return `${year}${month}${day}`;
}
function fetchTodaysDateNumeric(){

  const now = new Date();                //  current moment
  //const year  = String(now.getFullYear()); // last 2 digits
  const year = now.toLocaleString('en-US', {timeZone: 'America/Chicago', year: 'numeric' });
  const month = now.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'numeric' }).padStart(2, '0'); // "Jan"…"Dec"
  //const month = String(now.getMonth());
  //const day   = now.getDate();           // 1‑31 (no leading zero)
  //const day = String(now.getDate()).padStart(2, '0'); //with leading zeros
  const day = now.toLocaleString('en-US', {timeZone: 'America/Chicago', day: '2-digit'});

  // Assemble the parts in the order you want:
  return `${year}${month}${day}`;
}
function fetchTomorrowsDate(){

  const now = new Date();                //  current moment
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  //const year  = String(now.getFullYear() % 100).padStart(2, '0'); // last 2 digits
  const year = tomorrow.toLocaleString('en-US', {timeZone: 'America/Chicago', year: '2-digit' });
  const month = tomorrow.toLocaleString('en-US', {timeZone: 'America/Chicago', month: 'short' }).toUpperCase(); // "Jan"…"Dec"
  //const month = String(now.getMonth());
  //const day   = now.getDate();           // 1‑31 (no leading zero)
  //const day = String(now.getDate() + 1).padStart(2, '0'); //with leading zeros
   const day = tomorrow.toLocaleString('en-US', { timeZone: 'America/Chicago', day: '2-digit' });

  // Assemble the parts in the order you want:
  return `${year}${month}${day}`;
}
function fetchTomorrowsDateNumeric(){

  const now = new Date();                //  current moment
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  //const year  = String(now.getFullYear()); // last 2 digits
  const year = tomorrow.toLocaleString('en-US', {timeZone: 'America/Chicago', year: 'numeric' });
  const month = tomorrow.toLocaleString('en-US', {timeZone: 'America/Chicago', month: 'numeric' }).padStart(2, '0'); // "Jan"…"Dec"
  //const month = String(now.getMonth());
  //const day   = now.getDate();           // 1‑31 (no leading zero)
  //const day = String(now.getDate() + 1).padStart(2, '0'); //with leading zeros
   const day = tomorrow.toLocaleString('en-US', { timeZone: 'America/Chicago', day: '2-digit' });

  // Assemble the parts in the order you want:
  return `${year}${month}${day}`;
}


//parse market title/subtitle to obtain values
/**
 * Parse a string that may contain a numeric range and/or the words
 * “below” / “above”.  The result is an object with the properties
 * `low` and `high`.  Missing bounds are represented by –Infinity / Infinity.
 *
 * Accepted forms (case‑insensitive, optional spaces, optional degree sign):
 *   34° to 35°
 *   34‑35
 *   below 34°
 *   above 45°
 *   below 30° to 40°
 *   34° to above 45°
 *
 * @param {string} str – the title/description to parse
 * @returns {{low:number, high:number}}
 * @throws {Error} if no numbers can be found and no “below/above” keyword is present
 */
function parseTitleSimple(market) {
    let title = '';
    if(market.strike_type === 'greater' || market.strike_type === 'less'){ 
                title = market.subtitle || market.yes_sub_title || market.no_sub_title;
    }
    if(market.strike_type === 'between'){
        title = market.title;
    }
    const cleaned = title.trim();
    // Regex explanation (written inline for clarity)
    //    (\d+(?:\.\d+)?)   – capture an integer or decimal number (group 1)
     //    \s*               – optional spaces
     //    (?:°)?            – optional degree symbol (U+00B0)
     //    \s*               – optional spaces again
     //    (?:to|[-–—])      – literal word “to” OR any dash (hyphen, en‑dash, em‑dash)
     //    \s*               – optional spaces
     //    (?:°)?            – optional second degree symbol
     //    \s*               – optional spaces
     //    (\d+(?:\.\d+)?)   – second number (group 2)

     const hasBelow = /below/i.test(cleaned);
     const hasAbove = /above/i.test(cleaned);

    const numberMatches = cleaned.match(/\d+(?:\.\d+)?/g) || [];
    const numbers = numberMatches.map(Number); // turn into real numbers

    //Derive low / high based on the presence of keywords.
    // -----------------------------------------------------------------
     let low, high;

     // Helper – when we have exactly two numbers we treat them as a normal range.
    const twoNumbers = numbers.length >= 2;

    // ----- “below” ----------------------------------------------------
    if (hasBelow) {
     // If there is a numeric value, treat it as the *upper* bound.
     // If there are two numbers we still honour the first one as the
     // upper bound (the second one is ignored – the wording “below … to …”
     // is ambiguous, so we make a sane choice).
     high = numbers[0] !== undefined ? numbers[0] : Infinity;
     low = -Infinity;
     }

    // ----- “above” ----------------------------------------------------
    if (hasAbove) {
     // If there is a numeric value, treat it as the *lower* bound.
     low = numbers[0] !== undefined ? numbers[0] : -Infinity;
     high = Infinity;
    }

    // ----- No keyword – regular X to Y range -------------------------
    if (!hasBelow && !hasAbove) {
     if (twoNumbers) {
        low = numbers[0];
         high = numbers[1];
        } else if (numbers.length === 1) {
          // Single number alone – we treat it as both bounds (a degenerate range)
          low = high = numbers[0];
        }
    }
    //Final sanity – ensure we have both bounds.
    //    If we still miss one because the string contained no numbers,
    //    we fall back to ±Infinity so the caller still gets a usable object.
    // -----------------------------------------------------------------
    if (low === undefined) low = -Infinity;
    if (high === undefined) high = Infinity;

    // Return them in a predictable order (low ≤ high)
    if(debugLvl >= 2){console.log(`Verification of Title Parse Results Post-Processing. Values to be returned: Low: ${low}, High: ${high}`);}
    return low <= high ? { low, high } : { low: high, high: low };
}


function applyRiskControls(market, confidenceLevel){
    const confidenceModifier = confidenceLevel/100;
    const marketMultiplier = parseFloat((1/market.yes_ask_dollars).toFixed(2));
    let x = 1;
    if(debugLvl >= 2){console.log(`Verification of risk control calculations: confidence modifier: ${confidenceModifier}, market Multiplier: ${marketMultiplier}`);}
    //const betSize = Math.min(BANKROLL * MAX_PER_TRADE, trade.edgeValue > EV_THRESHOLD ? trade.amount : 0);
    if(confidenceLevel >= 65){
        x = Math.max(0.5, 2 - 0.1 * (confidenceLevel - 65));
    } else if(confidenceLevel >= 60){
        x = Math.max(0.5, 3 - 0.1 * (confidenceLevel - 60));
    } else if(confidenceLevel >= 50){
        x = Math.max(0.5, 4 - 0.1 * (confidenceLevel - 50));
    } else {
        x = Math.max(0.5, 5);
    }
    //update to filter out market multipliers @ 100 results
    //fractional factor
    const k = x / 10;
    //Full Kelly = f = (p * (b + 1) -1) / b
    //calculate kelly fraction
    let f = confidenceModifier - (1-confidenceModifier) / (marketMultiplier - 1);
    f = f.toFixed(4);
    if(debugLvl >= 2){console.log(`Verification of Kelly fractional calculation: kelly fraction result: ${f}`);}
    if(f <= 0){ //no bet if no edge
        if(debugLvl >= 1){console.log(`Verification of 'bad bet' result: No edge/Kelly Fraction negative/0!`);}
        return 0; 
    }
    let betSize = k * f * BANKROLL;
    if(debugLvl >= 2){console.log(`Bet Size - initial calculation: ${betSize.toFixed(4)}`);}
    
    betSize = (Math.min(betSize, BANKROLL));
    if(debugLvl >= 2){console.log(`Bet Size - post-insurance bet size does not exceed BANKROLL: ${betSize.toFixed(3)}`);}
    
    if(betSize === 0 || betSize <= 0){
        if(debugLvl >= 2){console.log(`Bet Size - verification of No bet made // Bet Size = 0`);}
        return null;
    } else {
        betSize = Math.round(betSize * 100)/100;
            if(debugLvl >= 2){console.log(`Verification of Trade to execute w/Post-Calc BetSize: ${betSize}`);}
        return Math.ceil(betSize.toFixed(2));
    }
}

function estimateProbability(market, seriesForecast){

    const temps = parseTitleSimple(market);
    if(debugLvl >= 2){console.log(`Verification of Parsed Bracket Values for temperatures:`, temps);}

    const std = dailyForecastMap.get(seriesForecast).deviation;
    const bracketLow = temps.low;
    const bracketHigh = temps.high;
    const forecastHigh = dailyForecastMap.get(seriesForecast).forecastHigh;
    const forecastLow = dailyForecastMap.get(seriesForecast).forecastLow;
    const nwsForecastHigh = dailyForecastMap.get(seriesForecast).nwsForecastHigh;
    const nwsForecastLow = dailyForecastMap.get(seriesForecast).nwsForecastLow;
    let prob = null;
    let nwsProb = null;

    const marketProb = parseFloat(market.yes_ask_dollars); //yes_ask_dollars is a percentage value without formatting, .06 = 6%

    if(debugLvl >= 2){ console.log(`Verification of Series Forecast variable: ${seriesForecast}`);}

    if(dailyForecastMap.get(seriesForecast).getSeriesType() === "high" ){
        if(debugLvl >= 2){ console.log(`Verification of Calculating Probability for HIGH market, using the following values: Market Low: ${bracketLow}, Market High: ${bracketHigh}, Forecast Low: ${forecastLow}, Forecast High: ${forecastHigh}, STD: ${std}`);         }
        
        prob = normalCDF(bracketHigh, forecastHigh, std) - normalCDF(bracketLow, forecastHigh, std);
        nwsProb = normalCDF(bracketHigh, nwsForecastHigh, std) - normalCDF(bracketLow, nwsForecastHigh, std);
        
        if(debugLvl >= 2){console.log(`Verification of Raw Prob for HIGH market calculation using normalCDF: ${prob}`);}
    } 
    if (dailyForecastMap.get(seriesForecast).getSeriesType() === "low" ){
        if(debugLvl >= 2){ console.log(`Verification of Calculating Probability for LOW market, using the following values: Market Low: ${bracketLow}, Market High: ${bracketHigh}, Forecast Low: ${forecastLow}, Forecast High: ${forecastHigh}, STD: ${std}`); }
        
        prob = normalCDF(bracketHigh, forecastLow, std) - normalCDF(bracketLow, forecastLow, std);
        nwsProb = normalCDF(bracketHigh, nwsForecastLow, std) - normalCDF(bracketLow, nwsForecastLow, std);

        if(debugLvl >= 2){console.log(`Verification of Raw Prob for LOW market calculation using normalCDF: ${prob}`);}
    }

    //weighted average for blended probability added
    let blendedProb = (MODEL_WEIGHT * ((prob + nwsProb)/2) + ((1 - MODEL_WEIGHT) * ((prob + nwsProb)/2) ));


    blendedProb = Math.max(0, blendedProb - 0.03);
    if(debugLvl >= 2){ console.log(`Verification of probability values: Model Prob: ${prob.toFixed(4)}, Market Prob: ${marketProb.toFixed(4)}, Blended Prob: ${blendedProb.toFixed(4)}`);}
    if(debugLvl >= 2){ console.log(`Verification of Raw Probability with no adjustments: ${prob}`);}
    
    //Conservative adjustment: subtract 3% for uncertainty inference
    prob = parseFloat(prob.toFixed(5));
    blendedProb = parseFloat(blendedProb.toFixed(5));
    
    if(debugLvl >= 2){ console.log(`Verification of Probability Accuracy of Market and Forecast values after parsing: ${prob}`); }
    
    prob = Math.max(0, prob - 0.03);
    blendedProb = Math.max(0, blendedProb - 0.03);

    if(debugLvl >= 2){ console.log(`Verification of Probability After the -0.03 adjustment for uncertainty: ${prob}`);}
    if(debugLvl >= 2){ console.log(`Verification of Raw Probability with no adjustments: ${prob}, Probability to be returned/used: ${blendedProb}`);}
    
    return blendedProb;
}

function calculateEdge(market, forecastProb){
    if(debugLvl >= 2){ console.log(`Verification of received probability value: ${forecastProb} for market: ${market.ticker}`); }
    
    //this calculation should be taking the current market within a series and evaluating whether the price is over/undervalued based on the expected forecast value. If positive, good. Negative means expect to lose $$
    const marketProb = market.yes_ask_dollars;
    const edge = forecastProb - marketProb - kalshiFee;

    if(debugLvl >= 2){console.log(`Verification of Edge Calculation, using values: Simplified Edge: ${edge}, Forecast Prob: ${forecastProb}, Current Market's Forecast Probability: ${marketProb}, FEE: ${kalshiFee}`);}
    //const ev = (forecastProb * (1 - marketProb) * ( 1 - kalshiFee)) - ((1 - forecastProb) * marketProb);
    const ev = (forecastProb * ( 1 - kalshiFee)) - ((1 - forecastProb) * marketProb);
    
    if(debugLvl >= 2){ console.log(`Verification for Calculated EV pre-parsing: ${ev}`); }

    return ev.toFixed(4);
}

function calculateConfidences(forecast){
    //get forecasted temperature, cap SD at 10 degrees 
    const t50 = forecast.getForecastTemperature();
    const nwsT50 = forecast.getNWSForecastTemperature();
    const sd = Math.min(forecast.deviation, 10);
    
    if(debugLvl >= 2){console.log(`Verification of Confidence Calculation using values: location: ${forecast.location}, mean temperature: ${t50} using deviation: ${sd}`);}

    //Offset for 80% confidence interval, 1.28 is the z-score for 80%
    const offset = sd * 1.28;

    if(debugLvl >= 2){console.log(`Verification of standard deviation post 80% interval adjustment: ${offset}`);}

    //estimated 10th and 90th percentiles rounded to nearest INT
    const t10 = Math.round(t50 - offset);
    const t90 = Math.round(t50 + offset);

    const nwsT10 = Math.round(nwsT50 - offset);
    const nwsT90 = Math.round(nwsT50 + offset);

    if(debugLvl >= 2){console.log(`Verification of 10th: ${t10} and 90th: ${t90} percentile values.`);}

    //spread between 10th and 90th
    const spread = t90 - t10;
    const nwsSpread = nwsT90 - nwsT10;

    const blendedSpread = (spread + nwsSpread)/2;
    
    if(debugLvl >= 2){console.log(`Verification of calculated spread for 10th and 90th percentiles: ${spread}, nws_spread: ${nwsSpread} and blended spread: ${blendedSpread}`);}
    //confidence percentage: Linear scale, deduct 5% per degree fahrenheit of spread, min 0%
    //adjust the multiplier (5) based on your thresholds
    const confidencePct1 = Math.max(0, 100 - (spread * 5));
    const confidencePct2 = Math.max(0, 100 - (nwsSpread * 5));
    
    const blendedConfidencePct = Math.max(0, 100 - (blendedSpread * 5));

    if(debugLvl >= 2){ console.log(`Verification of Confidence PCT = ${confidencePct1}%, ${confidencePct2}, blendedConfidence: ${blendedConfidencePct}%`);}
    
    forecast.setConfidence(confidencePct1);
    forecast.setNWSConfidence(confidencePct2);

    //Example: High (<=5 degree F), Moderate (6-10), Low (>10)
    let confidenceLevel;
    if(blendedSpread <= 2.5){
        confidenceLevel = "Very High";
    } else if(blendedSpread <= 5){
        confidenceLevel = 'High';
    } else if(blendedSpread <= 10){
        confidenceLevel = 'Moderate';
    } else {
        confidenceLevel = 'Low';
    }

    if(debugLvl >= 2){console.log(`Calculated Confidence% value(s): ${confidencePct1}%, ${confidencePct2}%, ${blendedConfidencePct}% with determined ConfidenceLevel: ${confidenceLevel}`);}
    
    return `${confidenceLevel}, ${blendedConfidencePct}%`;
}

async function scanAndSelectMarkets(market, forecastConfidence){
    let outputLine = ``;
    if(debugLvl >= 1){ console.log(`Current forecast confidence: ${forecastConfidence} for market: ${market.ticker}`);}

    sleep(1000);

    if(forecastConfidence >= 65){
        outputLine = `WINNER! - Market: ${market.ticker}, Event: ${market.event_ticker}, Confidence:${forecastConfidence}`;
        //if(debugLvl >= 1){ console.log(`WINNER! - Market: ${market.ticker}, Event: ${market.event_ticker}, Confidence:${forecastConfidence}`);}
        if(debugLvl >= 1){ console.log(outputLine);}
        logLastOutput(outputLine);
        await Promise.all([executeTrade(market, forecastConfidence)]);
    } else {
        outputLine = `Verification of unsure bet/LOSER - Confidence:${forecastConfidence} too low for: ${market.ticker}`;
        //if(debugLvl >= 1){console.log(`Verification of unsure bet/LOSER - Confidence:${forecastConfidence} too low for: ${market.ticker}`);}
        if(debugLvl >= 1){console.log(outputLine);}
        logLastOutput(outputLine);
    }
}

function isMarketMatchWithForecast(bracketRange, forecastTemps){
    const bracketHigh = parseFloat((bracketRange.high-.01).toFixed(2));
    const bracketLow = parseFloat((bracketRange.low-1));
    // if daily forecast low/high is less than or equal to bracket low and also less than bracket high, match is true.
    if(debugLvl >= 2){console.log(`Verification of Matching Values for Market/Forecast: ${bracketLow}, ${bracketHigh}/${forecastTemps.low}, ${forecastTemps.high}`);}
    if(( forecastTemps.low >= bracketLow && forecastTemps.low < bracketHigh ) || ( bracketLow <= forecastTemps.high && bracketHigh > forecastTemps.high)){
        if(debugLvl >= 2){console.log(`Verification of positive match: Match Found`);}
        return true;
    } else {
        if(debugLvl >= 2){console.log(`Verification of negative match: No Match Found`);}
        return false;
    }
}

/*
****************Logging functions******************
 */
async function logLastOutput(line){
    try{
        await fs.appendFile(logPath, line + '\n');
    }catch(error){
        console.error("Error writing to log file.", error);
    }
}

function logTrade(trade, outcome){
    const logEntry = {
        market: trade.ticker,
        entry_prob: trade.yourProb,
        outcome: outcome ? 'win' : 'loss',
        pnl: outcome ? (1 - trade.market.yes_price_dollars - kalshiFee) * trade.betSize : -trade.betSize
    };
    fs.appendFileSync('trades.json', JSON.stringify(logEntry) + '\n');
    BANKROLL += logEntry.pnl; //update Bankroll
}

//performance review
function reviewPerformance(){
    const logs = fs.readFileSync('trades.json', 'utf8').split('\n').filter(l => l.outcome === 'win').length;
    const winRate = wins / logs.length;
    const avgROI = logs.reduce((sum, l) => sum + l.pnl, 0) / logs.length / (BANKROLL / logs.length);

    console.log(`Win rate: ${winRate}, Avg daily ROI: ${avgROI}`);

    //adaptation: Tighten if poor
    if (avgROI < 0.005 || winRate < 0.55){
        EV_THRESHOLD += 0.05;
        console.log('Adapted EV threshold to:', EV_THRESHOLD);
    }

    //growth projection
    const dailyGrowth = 0.007; //assumed from "data"
    const projected = BANKROLL * Math.pow(1 + dailyGrowth, 90); // 3 months
    console.log('Projected 3 month bankroll:', projected);
/*Example: simulate a trade outcome
logTrade(trades[0], true); //win
reviewPerformance();
*/
}

/*
********** NWS functions **************
*/
async function getNWSData(forecast){

    const currentCoords = forecast.getCoordinates();
    const nwsLat = currentCoords.altLat;
    const nwsLon = currentCoords.altLon;
    const nwsOID = forecast.nwsOID;
    const constructedURL = `${nwsURL}/gridpoints/${nwsOID}/${nwsLon},${nwsLat}/forecast?units=us`;
    let outputLine = ``;
    //first is fetching the daily values for today
    try {
        const response = await axios.get(constructedURL, { headers: { 'User-Agent':'Climate_bot', 'Accept':'application/ld+json'}});
        const nwsData = response.data.periods;
        const httpStatus = response.status;

        let tempHigh = null;
        let tempLow = null;
        
        if(forecast.isToday()){
            tempHigh = nwsData[0].temperature;
            tempLow = nwsData[1].temperature;
        } else if(forecast.isTomorrow()){
            tempHigh = nwsData[2].temperature;
            tempLow = nwsData[3].temperature;
        }

        //this current method is dependent on the time of day that the script is run, if run in the evening after the high has passed, it may result in [0] being "today" and [1] being "tomorrow", need to confirm
        const isType = forecast.getSeriesType();
        if(debugLvl >= 2){console.log(`Verification of market type identification: isType result= ${isType}`);}
    
        if(isType === "high"){
            forecast.setNWSTemperature(tempHigh);
            forecast.setNWSTemperatures(tempLow, tempHigh);
            calculateConfidences(forecast);
            const confidenceNum = forecast.getNWSConfidence();
            outputLine = `Forecasted temperatures(NWS) - daily High for ${forecast.name} - ${forecast.location}: ${forecast.getNWSForecastTemperature()}, Confidence: ${confidenceNum}`;
            
            //if(debugLvl >= 1 || confidenceNum >= 60){ console.log(`Forecasted temperatures(OM) - daily High for ${forecast.name} - ${forecast.location}: ${forecast.getForecastTemperature()}, Confidence: ${confidenceNum}`); }
            if(debugLvl >= 1 || confidenceNum >= 60){ console.log(outputLine); }
            logLastOutput(outputLine);
        }
        if(isType === "low"){
            forecast.setNWSTemperature(tempLow);
            forecast.setNWSTemperatures(tempLow, tempHigh);
            calculateConfidences(forecast);
            const confidenceNum = forecast.getNWSConfidence();
            outputLine = `Forecasted temperatures(NWS) - daily Low for ${forecast.name} - ${forecast.location}: ${forecast.getNWSForecastTemperature()}, Confidence: ${confidenceNum}`;
            
            //if(debugLvl >= 1 || confidenceNum >= 60){ console.log(`Forecasted temperatures(OM) - daily Low for ${forecast.name} - ${forecast.location}: ${forecast.getForecastTemperature()}, Confidence: ${confidenceNum}`); }
            if(debugLvl >= 1 || confidenceNum >= 60){ console.log(outputLine); }
            logLastOutput(outputLine);
        }
    } catch (error) {
        console.error('Error fetching series:', error.response?.data || error.message);
        return [];
    }
}

async function getOMWeatherData(forecast){

    const currentCoords = forecast.getCoordinates();
    let outputLine = ``;
    //first is fetching the daily values for today
    try {
        const response = await axios.get(`${omURL}/forecast?latitude=${currentCoords.lat}&longitude=-${currentCoords.lon}&daily=temperature_2m_max,temperature_2m_min&models=gfs_seamless&timezone=America%2FChicago&wind_speed_unit=mph&precipitation_unit=inch&temperature_unit=fahrenheit&start_date=${forecast.date}&end_date=${forecast.date}`, { headers: { 'User-Agent': 'Climate_bot', 'Accept':'application/json'}});
        const data = await response.data;
        
        const tempHigh = parseFloat(data.daily.temperature_2m_max);
        const tempLow = parseFloat(data.daily.temperature_2m_min);

        //this current method is dependent on the time of day that the script is run, if run in the evening after the high has passed, it may result in [0] being "today" and [1] being "tomorrow", need to confirm
        const isType = forecast.getSeriesType();
        if(debugLvl >= 2){console.log(`Verification of market type identification: isType result= ${isType}`);}
    
        if(isType === "high"){
            forecast.setTemperature(tempHigh);
            forecast.setTemperatures(tempLow, tempHigh);
            calculateConfidences(forecast);
            const confidenceNum = forecast.getConfidence();
            outputLine = `Forecasted temperatures(OM) - daily High for ${forecast.name} - ${forecast.location}: ${forecast.getForecastTemperature()}, Confidence: ${confidenceNum}`;
            
            //if(debugLvl >= 1 || confidenceNum >= 60){ console.log(`Forecasted temperatures(OM) - daily High for ${forecast.name} - ${forecast.location}: ${forecast.getForecastTemperature()}, Confidence: ${confidenceNum}`); }
            if(debugLvl >= 1 || confidenceNum >= 60){ console.log(outputLine); }
            logLastOutput(outputLine);
        }
        if(isType === "low"){
            forecast.setTemperature(tempLow);
            forecast.setTemperatures(tempLow, tempHigh);
            calculateConfidences(forecast);
            const confidenceNum = forecast.getConfidence();
            outputLine = `Forecasted temperatures(OM) - daily Low for ${forecast.name} - ${forecast.location}: ${forecast.getForecastTemperature()}, Confidence: ${confidenceNum}`;
            
            //if(debugLvl >= 1 || confidenceNum >= 60){ console.log(`Forecasted temperatures(OM) - daily Low for ${forecast.name} - ${forecast.location}: ${forecast.getForecastTemperature()}, Confidence: ${confidenceNum}`); }
            if(debugLvl >= 1 || confidenceNum >= 60){ console.log(outputLine); }
            logLastOutput(outputLine);
        }
    } catch (error) {
        console.error('Error fetching series:', error.response?.data || error.message);
        return [];
    }
}
/*
*************** END NWS FUNCTIONS ***************
*/

/*
************* BEGIN CLIMA BOT FUNCTIONS*************
*/
function calculateSpread(market, ev){
//spread for contract is calculated as: 'implied yes bid - best yes bid where best yes bid = highest price in the yes array.
//implied yes bid = highest price in the no array. as a whole, (highest price in NO - highest price in YES) = 1.00$ since we are working with cents.
    const mVolume = market.volume_fp;
    const spreadCents2 = (market.yes_ask) - (market.yes_bid);
    const spreadCentsDollars = ((market.yes_ask_dollars) - (market.yes_bid_dollars)).toFixed(4);
    
    if(debugLvl >= 2){ console.log(`Verification of values for spread calculation: Market data: Best Yes Bid: ${market.yes_bid}, ${market.yes_bid_dollars} Best No Bid: ${market.no_bid}, ${market.no_bid_dollars} Implied Yes Ask: ${market.yes_ask}, ${market.yes_ask_dollars} Spread: ${spreadCents2}, ${spreadCentsDollars}, EV: ${ev}`);}
    
    if(mVolume > 500 && (spreadCentsDollars < 0.03) && ev > 0.07){
        console.log('High Volume, Tight Spread - potential winner!', market.ticker);
    }
    return spreadCentsDollars; // converted to cents
    //final step will be to add a condition that if the forecast confidence is high and the spread calc is winner, execute buy order.
}

/**
 * @param {string} eventTicker - ticker passed as string
 * @returns {Promise<kalshiPkg.GetMarketResponse>} - the returned object
 */
async function getMarketTickersFromSeries(eventSeries){
    
    const eventTicker = eventSeries.getDailyTicker();
    const eventTickerNextDay = eventSeries.getTomorrowsTicker();
    const dailyTemps = dailyForecastMap.get(eventTicker).getForecastTemperatures();
    const nextDayTemps = dailyForecastMap.get(eventTickerNextDay).getForecastTemperatures();
    
    if(debugLvl >= 2){ console.log(`Verification for ticker name generation: Event Ticker: ${eventTicker}, Next Day Ticker: ${eventTickerNextDay}, Event Series: ${eventSeries}`); }
    
    const response = await axios.get(`${baseURL}/markets?series_ticker=${eventSeries}&status=open`);
    const responseData = await response.data;

    for(const market of responseData.markets){
      if((market.event_ticker === eventTicker) && market.strike_type === 'between'){
            if(debugLvl >= 2){console.log(`retrieved Market details for Event: ${market.event_ticker}, Market: ${market.ticker}`);}
            //parse out the market title for bracket information 
                const temp = parseTitleSimple(market);
                if(debugLvl >= 2){console.log(`Validating temp values: Daily Low/High: ${dailyTemps.low}/${dailyTemps.high}`);}
                
                const isMMatch = isMarketMatchWithForecast(temp, dailyTemps);
                
                if(debugLvl >= 2){console.log(`Validating Market Match function Results: MMatch: ${isMMatch}`);}
                
                if(isMMatch == true ){
                    if(debugLvl >= 2){console.log(`Matching bracket/Forecast found`);}
                    const prob = estimateProbability(market, eventTicker);
                    const edge = calculateEdge(market, prob);
                    const spread = calculateSpread(market, edge);
                    if(debugLvl >= 2){console.log(`Prob: ${prob}, EV: ${edge}, Spread: ${spread}`);}
                    await scanAndSelectMarkets(market, (dailyForecastMap.get(eventTicker).getConfidence()));
                }
        } else if(( market.event_ticker === eventTickerNextDay) && market.strike_type === 'between'){ //if current ticker's event_ticker value matches the current value we are looking for, then create child_market object and update it with the corresponding forecasts
            if(debugLvl >= 2){console.log(`retrieved Market details for Event: ${market.event_ticker}, Market: ${market.ticker}`);}
            //parse out the market title for bracket information 
                const temp = parseTitleSimple(market);
                if(debugLvl >= 2){console.log(`Validating temp values: Next Day's Low's/High's: ${nextDayTemps.low}/${nextDayTemps.high}`);}
                
                const isNextDayMatch = isMarketMatchWithForecast(temp, nextDayTemps);
                
                if(debugLvl >= 2){console.log(`Validating Market Match function Results: NextDayMatch: ${isNextDayMatch}`);}
                
                if(isNextDayMatch == true){
                    if(debugLvl >= 2){console.log(`Matching bracket/Forecast found`);}
                    const prob = estimateProbability(market, eventTickerNextDay);
                    const edge = calculateEdge(market, prob);
                    const spread = calculateSpread(market, edge);
                    if(debugLvl >= 2){console.log(`Prob: ${prob}, EV: ${edge}, Spread: ${spread}`);}
                    await scanAndSelectMarkets(market, (dailyForecastMap.get(eventTickerNextDay).getConfidence()));
                }
        }
    }
}

//normal CDF approximation - move to general functions section
function erf(x) {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
}

function normalCDF(x, meanTemp, std) { //mean is the expected temperature so either forecast high or low and std is city dependent
    /*const z = (x - mean);
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302744))));
    if(z > 0) prob = 1 - prob;*/
    if( x === Infinity ) { return 1; }
    if( x === -Infinity) { return 0; }
    if(std <= 0) return 0; //safety check

    const z = (x - meanTemp) / (std * Math.sqrt(2));
    return 0.5 * (1 + erf(z));
}

//get current bankroll - move to general functions section
async function getBankroll(){
    try{
        const balanceResponse = await portfolioApi.getBalance();
        console.log('Connected to Kalshi successfully. Balance:', (balanceResponse.data.balance || 0) / 100);
        return balanceResponse.data.balance;
    } catch(error) {
        console.error('Error fetching balance:', error.response?.status, error.message);
        return 0;
    }
}

async function getPositions(){
    try{
        const positionsResponse = await portfolioApi.getPositions();
        if(debugLvl >= 2){
            console.log('Event positions within your profile:', (positionsResponse.data.event_positions));
            console.log('Market positions within your profile:', (positionsResponse.data.market_positions));
        }
        //return positionsResponse.data.market_positions;
        //return positionsResponse.data.event_positions;
        if(positionsResponse?.status === 200 || positionsResponse?.status === 202){
            return positionsResponse.data;
        }
    } catch (error) {
        console.error('Error fetching positions:', error.response?.status || error.message);
        return 0;
    }
}

/**
 * @param {string} eventTicker - ticker passed as string
 */
async function configureTradeToExecute(market, bet){
    sleep(1000);
    const activePositions = await getPositions();

    if(debugLvl >= 2){console.log(`contents of returned positions call: ${JSON.stringify(activePositions, null, 2)}, validation of market ticker: ${market.event_ticker}`);}
    
    const eventTicker = market.ticker;
    const side = 'yes';
    const action = 'buy';
    const type = 'limit';
    const tif = 'fill_or_kill';
    const count = Math.ceil(bet*2);
    const yes_price = ((market.yes_ask_size_fp / 100).toFixed(2));//(((market.yes_ask / 100)*(bet*10)).toFixed(2)).toString(); //this value seems to keep changing, at one time yes_ask gave a good value but now as of 03/16/2026, I had to update it to yes_ask_size_fp

    if(debugLvl >= 1){ console.log(`Validation of order fields: count: ${count}, price: ${yes_price}`);}

    let marketExists = false;
    if(marketExists === false){
        console.log(`No existing trade in active positions confirmed for: ${market.event_ticker}`);
        try{
            const postOrder = {
                ticker: eventTicker,
                side: side,
                action: action,
                count: count,
                type: type,
                yes_price_dollars: yes_price,
                time_in_force: tif
            };
            
            const tradeResponse = await ordersApi.createOrder(postOrder);
            if(tradeResponse.status === 201){ console.log(`Trade executed successfully for ${market.ticker}! - Response:`, tradeResponse.data);} 
            else { console.log(`Trade response code: ${tradeResponse.status}, Data: `, tradeResponse.data); }

        } catch (error){
            if(debugLvl >= 1)console.error(`Error submitting order for ${market.ticker}:`, error.response?.data || error.message);
        }
    }
}

async function executeTrade(market, confidenceLevel){
    //depending on the confidence level of the forecast the bet amound changes 
    const bet = applyRiskControls(market, confidenceLevel);
    sleep(1000);
    try {
        if(DAILY_TRADE_CAP >= 0){
            if(!bet) {
                if(debugLvl >= 1){ console.log(`Verification of trade execution logic safeguard : No Bet value or Bet too risky!: ${bet}`);}
                return;
            }
            //if(isCorrelated(bet.ticker)) bet.hedge = true;
            if(debugLvl >= 1) { console.log(`Executing buy YES on ${market.ticker} for $${bet}`);}
            
            try{
                if(autoExecute === true){
                   await configureTradeToExecute(market, bet);
                } else {
                    console.log(`autoExecute is currently set to false/disable`);
                } 
            } catch (error){
                console.error(`Error submitting order request: `, error.response?.data || error.message);
            }

            if(debugLvl >= 1){ console.log(`Trade execution logic success`);}        

        }
    } catch(error) {
        console.error(`Error executing bet/trade or too risky!`, error.response?.data || error.message);
    }
}


//Mock correlation - added by default
function isCorrelated(ticker){
    return ticker.includes('RAIN') && Math.random() > 0.5;
}

//Mock exit check - added by default
function checkForExit(trade){
    const newProb = Math.random(); //simulate update
    if(newProb - trade.yourProb > 0.05) {
        console.log(`Existing ${trade.ticker} due to prob shift`);
    }
}

//Main func
async function runBot() {
  createSeriesMap(climateMarkets).forEach(t => { 
        dailyClimateSeries.set(t.name, t); 
    }); //populate Map data structure dailyClimateSeries with market data using climateMarkets static map 
  createForecastMap(climateMarkets).forEach(f => {
        dailyForecastMap.set(f.name, f);
    }); //populate Map data structure dailyForecastMap with forecast data from climateMarkets static map
    try {
    //const balanceResponse = await portfolioApi.getBalance();
    //console.log('Connected to Kalshi successfully. Balance:', (balanceResponse.data.balance || 0) / 100);
    await Promise.all([ getBankroll(), getPositions() ])
    } catch (error) {
        console.error('Failed to connect to Kalshi:', error?.status, error.message);
        return;
    }
    try {
        for (const f of dailyForecastMap.values()){ 
            //await Promise.all([ getWeatherData(f), sleep(1000), getOMWeatherData(f), sleep(1000)]);
            await Promise.all([ getNWSData(f), sleep(1000), getOMWeatherData(f), sleep(1000)]);
        }
    } catch(error){
        console.error('Failed to Successfully populate Weather data:', error?.response?.status, error?.message);
        return;
    }
    try{
        for (const t of dailyClimateSeries.values()){ await Promise.all([getMarketTickersFromSeries(t), sleep(1000) ]); }
    } catch (error) {
        console.error('Failed to connect to populate Market data:', error?.response?.status || error.message);
        return;
  }
}

if(debugLvl >= 1){console.log(`validation of dates: Today's date: ${currentDay}/${currentDayNumeric}, Tomorrow's date: ${nextDay}/${nextDayNumeric}`);}

await runBot();
