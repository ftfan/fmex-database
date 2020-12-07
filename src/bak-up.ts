import { BakUpData, BakUpStep } from '../types/app';
import axios from 'axios';
import { OssClient } from '../lib/oss';
import { DateFormat, MD5, sleep } from '../lib/utils';
import { AppConfig } from '../app.config';
import { DataFilterSame, DataParse, PageConfigHackFilter, PageDataPush, PageDataPush2, PageDataPush3 } from '../lib/data-parse';

const OneDayTime = 24 * 60 * 60 * 1000;

axios.interceptors.request.use((config) => {
  // console.log(new Date().toISOString(),'axios', config.method, config.url);
  return config;
});
axios.interceptors.response.use((config) => {
  if (config.status !== 200) console.error(new Date().toISOString(), 'axios response', config.status, config.config.url);
  if (config.data && typeof config.data === 'object') {
    if (typeof config.data.status === 'string' && config.data.status !== 'ok') console.error(new Date().toISOString(), 'axios response', config.data.status, config.config.url);
    if (typeof config.data.status === 'number' && config.data.status !== 0) console.error(new Date().toISOString(), 'axios response', config.data.status, config.config.url);
  }
  return config;
});

const TimeMap = {
  [BakUpStep.M1]: 'yyyy/MM/dd/hh:mm',
  [BakUpStep.H1]: 'yyyy/MM/dd/hh',
  [BakUpStep.D1]: 'yyyy/MM/dd',
};
const AliUrl = 'https://' + AppConfig.AliOss.bucket + '.' + AppConfig.AliOss.region + '.aliyuncs.com';

const platformCurrencyUrl = 'https://fmex.com/api/broker/v3/zkp-assets/platform/currency';
let LogTimes = 0;

// 每个备份请求都是单线程，避免上一个未结束，就发起新的备份
const ReqPromiseHandler: any = {};

// 缓存当日的分页请求数据，避免数据重复请求。
const PageCache24H = {
  DateStr: '',
  Data: {} as any,
};
const LastPageDataCache: any = {}; // 备份每一份差异性的资产数据，避免遗漏

let LastUploadStatisticsFile = 0; // 最后一次保存未平仓张数的数据的时间

const YestoryBak = {
  LastTime: {} as any, // 每个备份的最后备份时间，避免频繁检查备份（请求oss资源过多）
  LastData: {} as any, // 如果获取到昨日的数据，就记录下来，避免频繁请求oss
};
const LastBakPageConfig = {} as any;
const OSSErrorUrl = {} as any; // 某个OSS资源请求次数失败过多，直接默认失败。

const timeout = 20000;
/**
 * 备份基础接口数据
 */
class BakUpHandler {
  OriginCache: { [index: string]: string } = {};
  OriginDataCache: { [index: string]: { url: string; data: any } } = {};
  BakUpData: BakUpData[] = [];
  // BakUpData: BakUpData[] = [
  //   // 【未平仓】
  //   {
  //     OriginUrl: 'https://fmex.com/api/contracts/web/v3/public/statistics',
  //     OssUrl: '/fmex/api/contracts/web/v3/public/statistics',
  //     OssOptions: {},
  //     Step: BakUpStep.M1,
  //     CheckData: async (item: BakUpData, res: any, time: Date, timeStr: string, logggg) => {
  //       if (!res.data) return false;
  //       if (res.data.status !== 0 && res.data.status !== 'ok') return false;
  //       return true;
  //     },
  //     DataFilter: async (item: BakUpData, res: any, time: Date, timeStr: string, logggg) => {
  //       const url = `${item.OssUrl}/${DateFormat(time, TimeMap[BakUpStep.D1])}.json`;
  //       const cache = this.OriginDataCache[url];
  //       let req: any;
  //       if (cache && cache.url === url) {
  //         req = cache.data;
  //       } else {
  //         req = await axios.get(AliUrl + url).catch((e) => Promise.resolve(e && e.response));
  //         if (req && req.status === 404) req.data = [];
  //         if (!req || (req.status !== 404 && req.status !== 200)) return null;
  //         req.data = DataParse(req.data); // 解析数据。
  //         this.OriginDataCache[url] = {
  //           url,
  //           data: req,
  //         };
  //       }

  //       res.data.data.ts = time.getTime();
  //       req.data.push(res.data.data);
  //       // 过滤重复的Key数据
  //       const map: any = {};
  //       const dels: any[] = [];
  //       req.data.forEach((item: any) => {
  //         if (map[item.ts]) dels.push(item);
  //         map[item.ts] = item;
  //       });
  //       dels.forEach((item: any) => {
  //         const index = req.data.indexOf(item);
  //         if (index === -1) return;
  //         req.data.splice(index, 1);
  //       });
  //       // 将数据保存
  //       // return Promise.resolve({ Url: url, Data: req.data });

  //       // 短时间内部多次保存数据，避免浪费流量,10分钟保存一次
  //       if (time.getTime() - LastUploadStatisticsFile < 600000) return 'is-end';
  //       LastUploadStatisticsFile = time.getTime();

  //       // 将数据改变结构（压缩了一定的存储空间）再保存
  //       const begin = req.data[0];
  //       if (!begin) return null;
  //       return Promise.resolve({
  //         Url: url,
  //         Data: {
  //           DataParse: 'parse1', // 数据压缩方式，这里主要是让客户端知道怎么解析这个数据
  //           Params: [{ Key: 'BTCUSD_P' }, { Key: 'ts', Add: begin.ts }, { Key: 'ETHUSD_P' }], // 重要信息提取。
  //           Data: req.data.map((i: any) => [i.BTCUSD_P, i.ts - begin.ts, i.ETHUSD_P]),
  //         },
  //       });
  //     },
  //   },
  //   // 【24小时均价、24小时成交量】
  //   {
  //     OriginUrl: 'https://api.fmex.com/v2/market/all-tickers',
  //     OssUrl: '/fmex/v2/market/all-tickers',
  //     OssOptions: {},
  //     Step: BakUpStep.H1,
  //     CheckData: async (item: BakUpData, res: any, time: Date, timeStr: string, logggg) => {
  //       if (!res.data) return false;
  //       if (res.data.status !== 0 && res.data.status !== 'ok') return false;
  //       if (timeStr !== DateFormat(res.data.data.ts, TimeMap[BakUpStep.H1])) return false;
  //       return true;
  //     },
  //     DataFilter: async (item: BakUpData, res: any, time: Date, timeStr: string, logggg) => {
  //       const url = `${item.OssUrl}/${DateFormat(time, TimeMap[BakUpStep.D1])}.json`;
  //       const cache = this.OriginDataCache[url];
  //       let req: any;
  //       if (cache && cache.url === url) {
  //         req = cache.data;
  //       } else {
  //         req = await axios.get(AliUrl + url).catch((e) => Promise.resolve(e && e.response));
  //         if (req && req.status === 404) req.data = [];
  //         if (!req || (req.status !== 404 && req.status !== 200)) return null;
  //         this.OriginDataCache[url] = {
  //           url,
  //           data: req,
  //         };
  //       }
  //       req.data.push(res.data.data);
  //       // 过滤重复的Key数据
  //       const map: any = {};
  //       const dels: any[] = [];
  //       req.data.forEach((item: any) => {
  //         if (map[item.ts]) dels.push(item);
  //         map[item.ts] = item;
  //       });
  //       dels.forEach((item: any) => {
  //         const index = req.data.indexOf(item);
  //         if (index === -1) return;
  //         req.data.splice(index, 1);
  //       });
  //       return Promise.resolve({ Url: url, Data: req.data });
  //     },
  //   },

  //   // 【24小时均价、24小时成交量、现货】
  //   {
  //     OriginUrl: 'https://api.fcoin.pro/v2/market/all-tickers',
  //     OssUrl: '/fcoin/v2/market/all-tickers',
  //     OssOptions: {},
  //     Step: BakUpStep.H1,
  //     CheckData: async (item: BakUpData, res: any, time: Date, timeStr: string, logggg) => {
  //       if (!res.data) return false;
  //       res.data.ts = Date.now();
  //       if (timeStr !== DateFormat(res.data.ts, TimeMap[BakUpStep.H1])) return false;
  //       return true;
  //     },
  //     DataFilter: async (item: BakUpData, res: any, time: Date, timeStr: string, logggg) => {
  //       const url = `${item.OssUrl}/${DateFormat(time, TimeMap[BakUpStep.D1])}.json`;
  //       const cache = this.OriginDataCache[url];
  //       let req: any;
  //       if (cache && cache.url === url) {
  //         req = cache.data;
  //       } else {
  //         req = await axios.get(AliUrl + url).catch((e) => Promise.resolve(e && e.response));
  //         if (req && req.status === 404) req.data = [];
  //         if (!req || (req.status !== 404 && req.status !== 200)) return null;
  //         this.OriginDataCache[url] = {
  //           url,
  //           data: req,
  //         };
  //       }
  //       req.data.push(res.data);
  //       // 过滤重复的Key数据
  //       const map: any = {};
  //       const dels: any[] = [];
  //       req.data.forEach((item: any) => {
  //         if (map[item.ts]) dels.push(item);
  //         map[item.ts] = item;
  //       });
  //       dels.forEach((item: any) => {
  //         const index = req.data.indexOf(item);
  //         if (index === -1) return;
  //         req.data.splice(index, 1);
  //       });
  //       return Promise.resolve({ Url: url, Data: req.data });
  //     },
  //   },

  //   // 平台的零知识证明资产备份
  //   {
  //     OriginUrl: `https://fmex.com/api/broker/v3/zkp-assets/platform/currency`,
  //     OssUrl: `/fmex/api/broker/v3/zkp-assets/platform/currency`,
  //     Step: BakUpStep.D1,
  //     OssOptions: {
  //       headers: {
  //         'Cache-Control': AppConfig.CacheControl,
  //       },
  //     },
  //     CheckData: async (item: BakUpData, res: any, time: Date, timeStr: string, logggg) => {
  //       if (!res.data) return false;
  //       if (res.data.status !== 0 && res.data.status !== 'ok') return false;
  //       return true;
  //     },
  //     DataFilter: (item: BakUpData, res: any, time: Date, timeStr: string, logggg) => Promise.resolve({ Url: `${item.OssUrl}/${timeStr}.json`, Data: res.data.data }),
  //   },
  // ];

  PlatformCurrency: string[] = ['btc', 'usdt'];
  PlatformCurrencyTime = ''; // 该信息的获取时间记录
  // 资产表备份
  BakUpDataAssets: BakUpData[] = [];

  Run() {
    const logggg = ++LogTimes;
    console.log(new Date().toISOString(), logggg, '---------------');
    // 设置需要保存的资产信息
    this.BakUpDataAssets = this.GetBakUpDataAssets(logggg);
    this.BakUpData.concat(this.BakUpDataAssets).forEach(async (item) => {
      // 上一个请求还没处理完。
      if (ReqPromiseHandler[item.OriginUrl]) return;
      ReqPromiseHandler[item.OriginUrl] = this.LoadAndSave(item, 0, logggg).then((res) => {
        delete ReqPromiseHandler[item.OriginUrl];
      });
      this.PackageReload(item, logggg);
    });
    this.BakPageConfig(logggg);
  }

  // 设置昨日的数据为长缓存（不在修改该数据）
  async PackageReload(item: BakUpData, logggg: number): Promise<any> {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const timeStr = DateFormat(yesterday, TimeMap[BakUpStep.D1]); // yyyy-MM-dd
    const fileUrl = `${item.OssUrl}/${timeStr}.json`;
    const fileUrlToday = `${item.OssUrl}/${DateFormat(now, TimeMap[BakUpStep.D1])}.json`;
    const cacheKey = item.OssUrl + 'yesterday'; // 只记录昨日的缓存文件路径。这样内存不会爆炸
    // console.log(new Date().toISOString(),logggg, cacheKey, '尝试设置昨日长缓存');

    // 获取已经缓存的数据，如果该文件已经缓存了。就不需要后面的获取文件。
    const cache = this.OriginCache[cacheKey];
    if (cache && cache === fileUrl) return console.log(new Date().toISOString(), logggg, cacheKey, 'has');

    const lastTime = YestoryBak.LastTime[cacheKey] || 0;
    if (lastTime > Date.now()) return console.log(new Date().toISOString(), logggg, cacheKey, '10分钟内不再判断昨日缓存');
    YestoryBak.LastTime[cacheKey] = Date.now() + 600000;

    let req: any;
    // 获取昨日的数据。
    const bak = YestoryBak.LastData[cacheKey];
    if (bak && bak.timeStr === timeStr && bak.req) {
      req = bak.req;
    } else {
      req = await axios.get(AliUrl + fileUrl).catch((e) => Promise.resolve(e && e.response));
      if (!req || req.status !== 200) return console.log(new Date().toISOString(), logggg, cacheKey, 'error 没获取到昨日的数据');
      YestoryBak.LastData[cacheKey] = {
        timeStr,
        req,
      };
    }

    // 必须今日的文件已经创建了（昨日的文件不会再被修改了）
    const today = await axios.get(AliUrl + fileUrlToday).catch((e) => Promise.resolve(e && e.response));
    if (!today || today.status !== 200) return console.log(new Date().toISOString(), logggg, cacheKey, 'error 今日数据未创建');

    // 已经设置了缓存
    if (req.headers && req.headers['cache-control'] === AppConfig.CacheControl) {
      this.OriginCache[cacheKey] = fileUrl;
      return console.log(new Date().toISOString(), logggg, cacheKey, 'cachedddd');
    }
    const bol = await OssClient.Save(fileUrl, req.data, {
      headers: {
        'Cache-Control': AppConfig.CacheControl,
      },
    });

    if (!bol) return console.log(new Date().toISOString(), logggg, cacheKey, '保存失败~~');

    // 该文件缓存成功，记录下来
    this.OriginCache[cacheKey] = fileUrl;
    console.log(new Date().toISOString(), logggg, cacheKey, '设置缓存成功~');
  }

  async LoadAndSave(item: BakUpData, times: number, logggg: number): Promise<any> {
    if (times >= 5) {
      console.log(new Date().toISOString(), logggg, item.OssUrl, '失败次数大于5，放弃继续');
      return Promise.resolve();
    }
    const now = new Date();
    const time = DateFormat(now, TimeMap[item.Step]);
    const cache = this.OriginCache[item.OriginUrl];

    const SaveUrl = `${item.OssUrl}/${time}.json`;
    if (cache === SaveUrl) {
      console.log(new Date().toISOString(), logggg, SaveUrl, '数据重复');
      return Promise.resolve();
    }
    const res = await axios.get(item.OriginUrl, { timeout, headers: { 'accept-language': 'zh,zh-CN;q=0.9,en;q=0.8' } }).catch((e) => Promise.resolve(null));
    if (!res || res.status !== 200) {
      console.error(new Date().toISOString(), 'LoadAndSave error', res && res.status, item.OriginUrl);
      return this.LoadAndSave(item, ++times, logggg);
    }
    if (item.CheckData) {
      const bool = await item.CheckData(item, res, now, time, logggg);
      if (bool === '数据有效') {
        console.log(new Date().toISOString(), logggg, SaveUrl, '数据有效');
        return;
      }
      if (bool === '这次数据无效，停止') {
        console.log(new Date().toISOString(), logggg, SaveUrl, '这次数据无效，停止');
        return;
      }
      if (!bool) return this.LoadAndSave(item, ++times, logggg);
    }

    const lastData = await item.DataFilter(item, res, now, time, logggg);
    if (lastData === 'is-end') {
      console.log(new Date().toISOString(), logggg, SaveUrl, 'is-end');
      return;
    } // 内部要求结束（数据处理完成，但是不保存最终的数据）
    if (!lastData) return this.LoadAndSave(item, ++times, logggg);
    const bol = await OssClient.Save(lastData.Url, lastData.Data, item.OssOptions);

    if (!bol) {
      const cacheKey = `${item.OssUrl}PagesCacheHash`;
      this.OriginCache[cacheKey] = ''; // 清空资产缓存。因为保存失败了
      return this.LoadAndSave(item, ++times, logggg);
    }

    // 一般数据都可以缓存。比如某个时间点获取的数据就是某个时间点的数据，但是零知识资产貌似有延迟一定时长（fmex目前是人工修改导致）
    if (item.CacheAble !== false) this.OriginCache[item.OriginUrl] = SaveUrl;
    console.log(new Date().toISOString(), logggg, SaveUrl, 'LoadAndSave 完成');
  }

  GetBakUpDataAssets(logggg: number) {
    // 每小时更新一次平台资产币种
    const timestr = DateFormat(new Date(), 'yyyy-MM-dd hh');
    if (this.PlatformCurrencyTime !== timestr) {
      this.PlatformCurrencyTime = timestr;
      axios
        .get(platformCurrencyUrl)
        .then((res) => {
          if (res.data && res.data.status === 'ok') {
            this.PlatformCurrency = res.data.data;
            console.log(new Date().toISOString(), logggg, platformCurrencyUrl, res.data.data);
          }
        })
        .catch((e) => {
          this.PlatformCurrencyTime = ''; // 获取失败，下次继续获取
        });
    }
    const revert: BakUpData[] = [];
    // 长度没变的情况下。默认认为资产信息没发生变化。不再重新计算资产
    if (this.PlatformCurrency.length * 2 === this.BakUpDataAssets.length) return this.BakUpDataAssets;
    this.PlatformCurrency.forEach((item) => {
      const Currency = item.toLocaleUpperCase();
      revert.push(
        // 【BTC资产信息】
        {
          OriginUrl: `https://fmex.com/api/broker/v3/zkp-assets/platform/snapshot/${Currency}`,
          OssUrl: `/fmex/broker/v3/zkp-assets/platform/snapshot/${Currency}`,
          Step: BakUpStep.D1,
          OssOptions: {
            headers: {
              'Cache-Control': AppConfig.CacheControl,
            },
          },
          CheckData: async (item: BakUpData, res: any, time: Date, timeStr: string, logggg) => {
            if (!res.data) return false;
            if (res.data.status !== 0 && res.data.status !== 'ok') return false;
            if (timeStr !== DateFormat(res.data.data.snapshot_time, TimeMap[BakUpStep.D1])) return '这次数据无效，停止';
            if (res.data.data.confirm_state !== 2) return '这次数据无效，停止';
            return true;
          },
          DataFilter: (item: BakUpData, res: any, time: Date, timeStr: string) => {
            this.TotalMoney(logggg, Currency, timeStr, res.data.data);
            return Promise.resolve({ Url: `${item.OssUrl}/${timeStr}.json`, Data: res.data.data });
          },
        },
        // 【用户资产信息备份】
        {
          // 零知识资产的缓存比较特殊，所以这里特殊实现
          CacheAble: false,
          OriginUrl: `https://fmex.com/api/broker/v3/zkp-assets/account/snapshot?currencyName=${Currency}`,
          OssUrl: `/fmex/api/broker/v3/zkp-assets/account/snapshot/${Currency}`,
          OssOptions: {
            timeout: 5 * 60000, // 5分钟超时
          },
          Step: BakUpStep.D1,
          CheckData: async (item: BakUpData, res: any, time: Date, timeStr: string, logggg) => {
            if (!res.data) return false;
            if (res.data.status !== 0 && res.data.status !== 'ok') return false;

            const cacheKey = `${item.OssUrl}PagesCacheHash`;
            const cahceValue = JSON.stringify(res.data.data.content.slice(0, 20)); // 用第一页的数据值作为校验。一样则表示后面数据都一样
            let cache = this.OriginCache[cacheKey];
            // 如果没有缓存。获取前一天的数据作为缓存数据对比
            if (!cache) {
              let cc = await axios.get(`${AliUrl}${item.OssUrl}/${timeStr}.json`).catch((e) => Promise.resolve(e && e.response));
              if (!cc || cc.status !== 200) {
                const olddaystr = new Date(timeStr.replace(/\//g, '-'));
                olddaystr.setDate(olddaystr.getDate() - 1);
                cc = await axios.get(`${AliUrl}${item.OssUrl}/${DateFormat(olddaystr, 'yyyy/MM/dd')}.json`).catch((e) => Promise.resolve(e && e.response));
              }
              if (cc && cc.status === 200 && cc.data) {
                this.OriginCache[cacheKey] = JSON.stringify(cc.data.slice(0, 20));
                cache = this.OriginCache[cacheKey];
              }
            }
            if (cache && cache === cahceValue) return '数据有效';
            return true;
          },
          DataFilter: async (item: BakUpData, res: any, time: Date, timeStr: string) => {
            const cacheKey = `${item.OssUrl}PagesCacheHash`;
            const cahceValue = JSON.stringify(res.data.data.content.slice(0, 20)); // 用第一页的数据值作为校验。一样则表示后面数据都一样

            const Data = [res.data.data];

            const TodayStr = DateFormat(new Date(), 'yyyy-MM-dd');
            if (TodayStr !== PageCache24H.DateStr) {
              PageCache24H.DateStr = TodayStr;
              PageCache24H.Data = {};
            }

            const GetNextPage = async (id: string, times = 0): Promise<any> => {
              if (times > 50) return null; // 因为失败率太高，这里重试次数加大
              console.log(new Date().toISOString(), logggg, 'GetNextPage', Currency, id);

              let resData: any;

              // 有缓存数据
              if (PageCache24H.Data[id]) {
                resData = PageCache24H.Data[id];
              } else {
                const res = await axios
                  .get(item.OriginUrl, { params: { id }, timeout: timeout / 2, headers: { 'accept-language': 'zh,zh-CN;q=0.9,en;q=0.8' } })
                  .catch((e) => Promise.resolve(e && e.response));
                if (!res || res.status !== 200 || !res.data || (res.data.status !== 0 && res.data.status !== 'ok')) return GetNextPage(id, ++times);
                resData = res.data.data;
                PageCache24H.Data[id] = res.data.data;
              }
              const resDataa = resData!;
              Data.push(resDataa);
              console.log(new Date().toISOString(), logggg, 'GetNextPage', Currency, id, resDataa.content.length);
              if (resDataa.has_next && resDataa.next_page_id) return GetNextPage(resDataa.next_page_id);
              return true;
            };
            if (res.data.data.has_next && res.data.data.next_page_id) {
              const success = await GetNextPage(res.data.data.next_page_id);
              if (!success) return null;
            }
            const DataContent: any[] = [];
            Data.forEach((item) => {
              DataContent.push(...item.content);
            });
            this.OriginCache[cacheKey] = cahceValue;
            const revert = { Url: `${item.OssUrl}/${timeStr}.json`, Data: DataContent };

            // 备份数据，避免到时候有追溯历史数据没有。
            // 主要对比某几条数据的id和数据的长度等信息。
            // 等待内部执行完毕，再保存，否则数据太大，同时保存容易接口超时
            await (async () => {
              const last = LastPageDataCache[cacheKey];
              LastPageDataCache[cacheKey] = DataContent;
              if (!last) return;
              const str2 = JSON.stringify(last.slice(0, 100)); // 因为数据量太大，只比对100个
              const hash2 = MD5(str2);
              const llll = `${item.OssUrl}/${timeStr}.${DateFormat(new Date(), 'yyyy-MM-dd-hh-mm')}.${hash2}.json`;
              const str1 = JSON.stringify(DataContent.slice(0, 100));
              const hash1 = MD5(str1);
              if (hash1 !== hash2) return OssClient.Save(llll, revert.Data, item.OssOptions);
            })();
            return Promise.resolve(revert);
          },
        }
      );
    });
    return revert;
  }

  BakPageConfig(logggg: number) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayTime = new Date(DateFormat(yesterday, 'yyyy-MM-dd')).getTime();

    this.PlatformCurrency.forEach(async (item) => {
      const Currency = item.toLocaleUpperCase();
      const RealOssUrl = `/report/account/snapshot/${Currency}.json`;
      const RealOssUrl2 = `/report/platform/snapshot/${Currency}.json`;
      const RealOssUrl3 = `/report/total/${Currency}.json`;
      if (!ReqPromiseHandler[RealOssUrl]) {
        ReqPromiseHandler[RealOssUrl] = this.UpdatePageConfig(logggg, yesterdayTime, Currency, RealOssUrl).finally(() => {
          ReqPromiseHandler[RealOssUrl] = null;
        });
      }
      if (!ReqPromiseHandler[RealOssUrl2]) {
        ReqPromiseHandler[RealOssUrl2] = this.UpdatePageConfig2(logggg, yesterdayTime, Currency, RealOssUrl2).finally(() => {
          ReqPromiseHandler[RealOssUrl2] = null;
        });
      }
      if (!ReqPromiseHandler[RealOssUrl3]) {
        ReqPromiseHandler[RealOssUrl3] = this.UpdatePageConfig3(logggg, yesterdayTime, Currency, RealOssUrl3).finally(() => {
          ReqPromiseHandler[RealOssUrl3] = null;
        });
      }
    });
  }

  // 统计 account/snapshot
  async UpdatePageConfig(logggg: number, yesterdayTime: number, Currency: string, OssUrl: string) {
    let PageConfig = JSON.parse(JSON.stringify(LastBakPageConfig[OssUrl] || null));
    if (!PageConfig) {
      if (OSSErrorUrl[OssUrl] > 10) return console.error(new Date().toISOString(), logggg, OssUrl, 'OSS 请求错误太多，直接异常');
      // 获取已有配置
      const res = await axios.get(`${AliUrl}${OssUrl}`).catch((e) => Promise.resolve(e && e.response));
      if (res && res.status === 404) {
        OSSErrorUrl[OssUrl] = (OSSErrorUrl[OssUrl] || 0) + 1;
        await sleep(10 * 60 * 1000); // 等十分钟
        return console.error(new Date().toISOString(), logggg, OssUrl, 'OSS 404');
      }
      if (!res || res.status !== 200) {
        OSSErrorUrl[OssUrl] = (OSSErrorUrl[OssUrl] || 0) + 1;
        await sleep(60 * 1000); // 等1分钟
        return console.error(new Date().toISOString(), logggg, OssUrl, '未找到OSS配置文件'); // 该文件必须存在。不存在不备份
      }
      PageConfig = res.data;
      LastBakPageConfig[OssUrl] = res.data;
    }

    let EndTime = 0;
    if (PageConfig.EndTime) {
      EndTime = new Date(PageConfig.EndTime).getTime() + OneDayTime;
    } else {
      EndTime = new Date(PageConfig.BeginTime).getTime();
    }
    // 在周期内，不触发更新
    // if (new Date().getDay() % 2 === 1) return console.log(new Date().toISOString(),logggg, OssUrl, `${new Date().getDay()}不是统计时间`);
    if (EndTime > yesterdayTime) return console.log(new Date().toISOString(), logggg, OssUrl, '已经最新'); // 昨日的数据已经更新进去了，没有更多数据可以更新了

    const GetPageData = async (time: number, times: number): Promise<any> => {
      const DateStr = DateFormat(time, 'yyyy/MM/dd');
      const url = `/fmex/api/broker/v3/zkp-assets/account/snapshot/${Currency}/${DateStr}.json`;
      let res = await axios.get(`${AliUrl}${url}`).catch((e) => Promise.resolve(e && e.response));
      if (!res || res.status !== 200) {
        if (times < 3) return GetPageData(time, ++times);
        res = { data: [] };
      }
      DataFilterSame(res.data);
      PageConfig.Version++;
      PageConfig.EndTime = DateFormat(time, 'yyyy-MM-dd');
      PageConfigHackFilter(PageConfig);
      PageDataPush(PageConfig, res.data);
      const next = time + OneDayTime;
      if (next > yesterdayTime) return;
      return GetPageData(next, times);
    };
    const bakVersion = PageConfig.Version;
    await GetPageData(EndTime, 0);
    if (bakVersion === PageConfig.Version) return console.log(new Date().toISOString(), logggg, OssUrl, '版本未发生变化'); // 没有任何变化
    const bol = await OssClient.Save(OssUrl, PageConfig, {
      headers: {
        'Cache-Control': `max-age=${86400000 * 4}`, // 7天
      },
    });
    if (!bol) return console.log(new Date().toISOString(), logggg, OssUrl, '保存失败~~');
    LastBakPageConfig[OssUrl] = PageConfig;
  }

  // 统计 platform/snapshot
  async UpdatePageConfig2(logggg: number, yesterdayTime: number, Currency: string, OssUrl: string) {
    let PageConfig = JSON.parse(JSON.stringify(LastBakPageConfig[OssUrl] || null));
    if (!PageConfig) {
      if (OSSErrorUrl[OssUrl] > 100) return console.error(new Date().toISOString(), logggg, OssUrl, 'OSS 请求错误太多，直接异常');
      // 获取已有配置
      const res = await axios.get(`${AliUrl}${OssUrl}`).catch((e) => Promise.resolve(e && e.response));
      if (res && res.status === 404) {
        OSSErrorUrl[OssUrl] = (OSSErrorUrl[OssUrl] || 0) + 1;
        await sleep(10 * 60 * 1000); // 等十分钟
        return console.error(new Date().toISOString(), logggg, OssUrl, 'OSS 404');
      }
      if (!res || res.status !== 200) {
        OSSErrorUrl[OssUrl] = (OSSErrorUrl[OssUrl] || 0) + 1;
        await sleep(60 * 1000); // 等1分钟
        return console.error(new Date().toISOString(), logggg, OssUrl, '未找到OSS配置文件'); // 该文件必须存在。不存在不备份
      }
      PageConfig = res.data;
      LastBakPageConfig[OssUrl] = res.data;
    }

    let EndTime = 0;
    if (PageConfig.EndTime) {
      EndTime = new Date(PageConfig.EndTime).getTime() + OneDayTime;
    } else {
      EndTime = new Date(PageConfig.BeginTime).getTime();
    }
    // 在周期内，不触发更新
    // const EndDate = new Date(EndTime);
    // 每个周一更新
    // if (new Date().getDay() !== 4) return console.log(new Date().toISOString(),logggg, OssUrl, `${new Date().getDay()}不是周 4 不统计`);
    if (EndTime > yesterdayTime) return console.log(new Date().toISOString(), logggg, OssUrl, '已经最新'); // 昨日的数据已经更新进去了，没有更多数据可以更新了

    const GetPageData = async (time: number, times: number): Promise<any> => {
      const DateStr = DateFormat(time, 'yyyy/MM/dd');
      const url = `/fmex/broker/v3/zkp-assets/platform/snapshot/${Currency}/${DateStr}.json`;
      let res = await axios.get(`${AliUrl}${url}`).catch((e) => Promise.resolve(e && e.response));
      if (!res || res.status !== 200) {
        if (times < 5) return GetPageData(time, ++times);
        res = {
          data: {
            snapshot_time: time,
            platform_total_amount: '',
            user_total_amount: '',
            assets_rate: '',
            platform_wallet_assets: [],
          },
        };
      }
      PageConfig.Version++;
      PageConfig.EndTime = DateFormat(time, 'yyyy-MM-dd');
      PageDataPush2(PageConfig, res.data);
      const next = time + OneDayTime;
      if (next > yesterdayTime) return;
      return GetPageData(next, times);
    };
    const bakVersion = PageConfig.Version;
    await GetPageData(EndTime, 0);
    if (bakVersion === PageConfig.Version) return console.log(new Date().toISOString(), logggg, OssUrl, '版本未发生变化'); // 没有任何变化
    const bol = await OssClient.Save(OssUrl, PageConfig, {
      headers: {
        'Cache-Control': `max-age=${86400000 * 4}`, // 7天
      },
    });
    if (!bol) return console.log(new Date().toISOString(), logggg, OssUrl, '保存失败~~');
    LastBakPageConfig[OssUrl] = PageConfig;
  }

  // 统计 total
  async UpdatePageConfig3(logggg: number, yesterdayTime: number, Currency: string, OssUrl: string) {
    let PageConfig = JSON.parse(JSON.stringify(LastBakPageConfig[OssUrl] || null));
    if (!PageConfig) {
      if (OSSErrorUrl[OssUrl] > 100) return console.error(new Date().toISOString(), logggg, OssUrl, 'OSS 请求错误太多，直接异常');
      // 获取已有配置
      const res = await axios.get(`${AliUrl}${OssUrl}`).catch((e) => Promise.resolve(e && e.response));
      if (res && res.status === 404) {
        OSSErrorUrl[OssUrl] = (OSSErrorUrl[OssUrl] || 0) + 1;
        await sleep(10 * 60 * 1000); // 等十分钟
        return console.error(new Date().toISOString(), logggg, OssUrl, 'OSS 404');
      }
      if (!res || res.status !== 200) {
        OSSErrorUrl[OssUrl] = (OSSErrorUrl[OssUrl] || 0) + 1;
        await sleep(60 * 1000); // 等1分钟
        return console.error(new Date().toISOString(), logggg, OssUrl, '未找到OSS配置文件'); // 该文件必须存在。不存在不备份
      }
      PageConfig = res.data;
      LastBakPageConfig[OssUrl] = res.data;
    }

    let EndTime = 0;
    if (PageConfig.EndTime) {
      EndTime = new Date(PageConfig.EndTime).getTime() + OneDayTime;
    } else {
      EndTime = new Date(PageConfig.BeginTime).getTime();
    }
    // 在周期内，不触发更新
    // const EndDate = new Date(EndTime);
    // 每个周一更新
    // if (new Date().getDay() !== 4) return console.log(new Date().toISOString(),logggg, OssUrl, `${new Date().getDay()}不是周 4 不统计`);
    if (EndTime > yesterdayTime) return console.log(new Date().toISOString(), logggg, OssUrl, '已经最新'); // 昨日的数据已经更新进去了，没有更多数据可以更新了

    const GetPageData = async (time: number, times: number): Promise<any> => {
      const DateStr = DateFormat(time, 'yyyy/MM/dd');
      const url = `/report/total/${Currency}/${DateStr}.json`;
      // 加载当天数据
      let res = await axios.get(`${AliUrl}${url}`).catch((e) => Promise.resolve(e && e.response));
      // 该文件还未创建。这里是因为统计逻辑中途加上的。所以没有该文件。
      if (res && res.status === 404) {
        // 加载当天的资产数据，创建折合数据
        const origin = await axios.get(`${AliUrl}/fmex/broker/v3/zkp-assets/platform/snapshot/${Currency}/${DateStr}.json`).catch((e) => Promise.resolve(e && e.response));
        if (origin && origin.status === 200) {
          const dadadad = await this.TotalMoney(logggg, Currency, DateStr, origin.data);
          // 模拟
          if (dadadad) {
            res = {
              status: 200,
              data: dadadad,
            };
          }
        }
      }
      if (!res || res.status !== 200) {
        if (times < 5) return GetPageData(time, ++times);
        console.error(new Date().toISOString(), logggg, url, '超过5次');
        res = {
          data: {
            snapshot_time: 0,
            Currency,
            kline: {},
            platform_total_amount: '',
            user_total_amount: '',
          },
        };
      }
      PageConfig.Version++;
      PageConfig.EndTime = DateFormat(time, 'yyyy-MM-dd');
      PageDataPush3(PageConfig, res.data);
      const next = time + OneDayTime;
      if (next > yesterdayTime) return;
      return GetPageData(next, times);
    };
    const bakVersion = PageConfig.Version;
    await GetPageData(EndTime, 0);
    if (bakVersion === PageConfig.Version) return console.log(new Date().toISOString(), logggg, OssUrl, '版本未发生变化'); // 没有任何变化
    const bol = await OssClient.Save(OssUrl, PageConfig, {
      headers: {
        'Cache-Control': `max-age=${86400000 * 4}`, // 7天
      },
    });
    if (!bol) return console.log(new Date().toISOString(), logggg, OssUrl, '保存失败~~');
    LastBakPageConfig[OssUrl] = PageConfig;
  }

  async TotalMoney(logggg: number, Currency: string, timeStr: string, data: any, times = 0): Promise<any> {
    if (times > 2) console.error(new Date().toISOString(), logggg, Currency, timeStr);
    if (times > 10) return Promise.resolve(null);
    const time = Math.floor(data.snapshot_time / 1000);
    if (Currency === 'USDT') {
      const savedata = {
        snapshot_time: data.snapshot_time,
        Currency,
        kline: {
          quote_vol: 1,
          base_vol: 1,
        },
        platform_total_amount: data.platform_total_amount,
        user_total_amount: data.user_total_amount,
      };
      const bol = await OssClient.Save(`/report/total/${Currency}/${timeStr}.json`, savedata, {});
      if (!bol) return this.TotalMoney(logggg, Currency, timeStr, data, ++times);
      return Promise.resolve(savedata);
    }
    // 获取当日的K线图
    let kline = await axios
      .get(`https://api.fcoin.pro/v2/market/candles/D1/${Currency.toLocaleLowerCase()}usdt?limit=1&before=${time}`)
      .then((res) => res.data)
      .catch((e) => Promise.resolve(e && e.response));
    if (!kline || !kline.data || (kline.status !== 0 && kline.status !== 'ok')) {
      const tryy = await axios
        .get(`https://api.cococoin.com/openapi/quote/v1/klines?symbol=${Currency.toLocaleUpperCase()}USDT&interval=1d&limit=1&endTime=${data.snapshot_time}`)
        .then((res) => res.data)
        .catch((e) => Promise.resolve(e && e.response));
      if (!tryy || !tryy[0]) return this.TotalMoney(logggg, Currency, timeStr, data, ++times);
      const tdd = tryy[0];
      kline = {
        status: 0,
        data: [
          {
            open: tdd[1],
            close: tdd[4],
            high: tdd[2],
            quote_vol: tdd[7],
            id: tdd[0],
            count: tdd[8],
            low: tdd[3],
            seq: tdd[0],
            base_vol: tdd[5],
          },
        ],
      };
    }
    const savedata = {
      snapshot_time: data.snapshot_time,
      Currency,
      kline: kline.data[0],
      platform_total_amount: data.platform_total_amount,
      user_total_amount: data.user_total_amount,
    };
    const bol = await OssClient.Save(`/report/total/${Currency}/${timeStr}.json`, savedata, {});
    if (!bol) return this.TotalMoney(logggg, Currency, timeStr, data, ++times);
    console.log(new Date().toISOString(), logggg, 'TotalMoney', Currency, timeStr, times);
    return Promise.resolve(savedata);
  }
}

export const BakUp = new BakUpHandler();
