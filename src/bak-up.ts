import { BakUpData, BakUpStep } from '../types/app';
import axios from 'axios';
import { OssClient } from '../lib/oss';
import { DateFormat } from '../lib/utils';
import { AppConfig } from '../app.config';

const TimeMap = {
  [BakUpStep.M1]: 'yyyy/MM/dd/hh:mm',
  [BakUpStep.H1]: 'yyyy/MM/dd/hh',
  [BakUpStep.D1]: 'yyyy/MM/dd',
};
const AliUrl = 'https://' + AppConfig.AliOss.bucket + '.' + AppConfig.AliOss.region + '.aliyuncs.com';

/**
 * 备份基础接口数据
 */
class BakUpHandler {
  OriginCache: { [index: string]: string } = {};
  OriginDataCache: { [index: string]: { url: string; data: any } } = {};
  BakUpData: BakUpData[] = [
    // 【未平仓】
    {
      OriginUrl: 'https://fmex.com/api/contracts/web/v3/public/statistics',
      OssUrl: '/fmex/api/contracts/web/v3/public/statistics',
      OssOptions: {},
      Step: BakUpStep.M1,
      CheckData: (item: BakUpData, res: any, time: Date, timeStr: string) => {
        if (!res.data) return false;
        if (res.data.status !== 0 && res.data.status !== 'ok') return false;
        return true;
      },
      DataFilter: async (item: BakUpData, res: any, time: Date, timeStr: string) => {
        const url = `${item.OssUrl}/${DateFormat(time, TimeMap[BakUpStep.D1])}.json`;
        const cache = this.OriginDataCache[url];
        let req: any;
        if (cache && cache.url === url) {
          req = cache.data;
        } else {
          req = await axios.get(AliUrl + url).catch((e) => Promise.resolve(e && e.response));
          if (req && req.status === 404) req.data = [];
          if (!req || (req.status !== 404 && req.status !== 200)) return null;
          this.OriginDataCache[url] = {
            url,
            data: req,
          };
        }

        res.data.data.ts = time.getTime();
        req.data.push(res.data.data);
        // 过滤重复的Key数据
        const map: any = {};
        const dels: any[] = [];
        req.data.forEach((item: any) => {
          if (map[item.ts]) dels.push(item);
          map[item.ts] = item;
        });
        dels.forEach((item: any) => {
          const index = req.data.indexOf(item);
          if (index === -1) return;
          req.data.splice(index, 1);
        });
        return Promise.resolve({ Url: url, Data: req.data });
      },
    },
    // 【24小时均价、24小时成交量】
    {
      OriginUrl: 'https://api.fmex.com/v2/market/all-tickers',
      OssUrl: '/fmex/v2/market/all-tickers',
      OssOptions: {},
      Step: BakUpStep.H1,
      CheckData: (item: BakUpData, res: any, time: Date, timeStr: string) => {
        if (!res.data) return false;
        if (res.data.status !== 0 && res.data.status !== 'ok') return false;
        if (timeStr !== DateFormat(res.data.data.ts, TimeMap[BakUpStep.H1])) return false;
        return true;
      },
      DataFilter: async (item: BakUpData, res: any, time: Date, timeStr: string) => {
        const url = `${item.OssUrl}/${DateFormat(time, TimeMap[BakUpStep.D1])}.json`;
        const cache = this.OriginDataCache[url];
        let req: any;
        if (cache && cache.url === url) {
          req = cache.data;
        } else {
          req = await axios.get(AliUrl + url).catch((e) => Promise.resolve(e && e.response));
          if (req && req.status === 404) req.data = [];
          if (!req || (req.status !== 404 && req.status !== 200)) return null;
          this.OriginDataCache[url] = {
            url,
            data: req,
          };
        }
        req.data.push(res.data.data);
        // 过滤重复的Key数据
        const map: any = {};
        const dels: any[] = [];
        req.data.forEach((item: any) => {
          if (map[item.ts]) dels.push(item);
          map[item.ts] = item;
        });
        dels.forEach((item: any) => {
          const index = req.data.indexOf(item);
          if (index === -1) return;
          req.data.splice(index, 1);
        });
        return Promise.resolve({ Url: url, Data: req.data });
      },
    },
    // 【BTC资产信息】
    {
      OriginUrl: 'https://fmex.com/api/broker/v3/zkp-assets/platform/snapshot/BTC',
      OssUrl: '/fmex/broker/v3/zkp-assets/platform/snapshot/BTC',
      Step: BakUpStep.D1,
      OssOptions: {
        headers: {
          'Cache-Control': AppConfig.CacheControl,
        },
      },
      CheckData: (item: BakUpData, res: any, time: Date, timeStr: string) => {
        if (!res.data) return false;
        if (res.data.status !== 0 && res.data.status !== 'ok') return false;
        if (timeStr !== DateFormat(res.data.data.snapshot_time, TimeMap[BakUpStep.D1])) return false;
        if (res.data.data.confirm_state !== 2) return false;
        return true;
      },
      DataFilter: (item: BakUpData, res: any, time: Date, timeStr: string) => Promise.resolve({ Url: `${item.OssUrl}/${timeStr}.json`, Data: res.data.data }),
    },

    // 【用户资产信息备份】
    {
      CacheAble: false,
      OriginUrl: 'https://fmex.com/api/broker/v3/zkp-assets/account/snapshot?currencyName=BTC',
      OssUrl: '/fmex/api/broker/v3/zkp-assets/account/snapshot/BTC',
      OssOptions: {},
      Step: BakUpStep.D1,
      CheckData: (item: BakUpData, res: any, time: Date, timeStr: string) => {
        if (!res.data) return false;
        if (res.data.status !== 0 && res.data.status !== 'ok') return false;
        return true;
      },
      DataFilter: async (item: BakUpData, res: any, time: Date, timeStr: string) => {
        // 每小时更新一次
        const cacheKey = `${item.OssUrl}PagesCacheHash`;
        const cahceValue = DateFormat(time, 'yyyy-MM-dd hh');
        const cache = this.OriginCache[cacheKey];
        if (cache && cache === cahceValue) return null;
        const Data = [res.data.data];

        const GetNextPage = async (id: string): Promise<any> => {
          const res = await axios.get(item.OriginUrl, { params: { id } }).catch((e) => Promise.resolve(e && e.response));
          if (!res || res.status !== 200 || !res.data || (res.data.status !== 0 && res.data.status !== 'ok')) return null;
          Data.push(res.data.data);
          if (res.data.data.has_next && res.data.data.next_page_id) return GetNextPage(res.data.data.next_page_id);
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

        return Promise.resolve({ Url: `${item.OssUrl}/${timeStr}.json`, Data: DataContent });
      },
    },
  ];

  Run() {
    this.BakUpData.forEach((item) => {
      this.LoadAndSave(item);
      this.PackageReload(item);
    });
  }

  // 设置昨日的数据为长缓存（不在修改该数据）
  async PackageReload(item: BakUpData): Promise<any> {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const timeStr = DateFormat(yesterday, TimeMap[BakUpStep.D1]); // yyyy-MM-dd
    const fileUrl = `${item.OssUrl}/${timeStr}.json`;
    const fileUrlToday = `${item.OssUrl}/${DateFormat(now, TimeMap[BakUpStep.D1])}.json`;
    const cacheKey = item.OssUrl + 'yesterday';
    const cache = this.OriginCache[cacheKey];
    if (cache && cache === fileUrl) return;

    const req = await axios.get(AliUrl + fileUrl).catch((e) => Promise.resolve(e && e.response));
    if (!req || req.status !== 200) return null;

    // 必须今日的文件已经创建了（昨日的文件不会再被修改了）
    const today = await axios.get(AliUrl + fileUrlToday).catch((e) => Promise.resolve(e && e.response));
    if (!today || today.status !== 200) return null;

    // 已经设置了缓存
    if (req.headers && req.headers['cache-control'] === AppConfig.CacheControl) {
      this.OriginCache[cacheKey] = fileUrl;
      return;
    }
    const bol = await OssClient.Save(fileUrl, req.data, {
      headers: {
        'Cache-Control': AppConfig.CacheControl,
      },
    });

    if (!bol) return null;
    this.OriginCache[cacheKey] = fileUrl;
  }

  async LoadAndSave(item: BakUpData, times = 1): Promise<any> {
    if (times >= 5) return;
    const now = new Date();
    const time = DateFormat(now, TimeMap[item.Step]);
    const cache = this.OriginCache[item.OriginUrl];

    const SaveUrl = `${item.OssUrl}/${time}.json`;
    if (cache === SaveUrl) return Promise.resolve('数据重复');
    const res = await axios.get(item.OriginUrl).catch((e) => Promise.resolve(null));
    if (!res || res.status !== 200) {
      console.error('LoadAndSave error', res && res.status, item.OriginUrl);
      return this.LoadAndSave(item, ++times);
    }
    if (item.CheckData) {
      const bool = item.CheckData(item, res, now, time);
      if (!bool) return this.LoadAndSave(item, ++times);
    }

    const lastData = await item.DataFilter(item, res, now, time);
    if (!lastData) return this.LoadAndSave(item, ++times);
    const bol = await OssClient.Save(lastData.Url, lastData.Data, item.OssOptions);

    if (!bol) return this.LoadAndSave(item, ++times);
    if (item.CacheAble !== false) this.OriginCache[item.OriginUrl] = SaveUrl;
  }
}

export const BakUp = new BakUpHandler();
