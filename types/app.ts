import * as OSS from 'ali-oss';
export enum BakUpStep {
  M1 = 60000,
  H1 = 3600000,
  D1 = 86400000,
}

export interface BakUpData {
  OriginUrl: string;
  OssUrl: string;
  Step: BakUpStep; // 时间周期：一分钟备份一次，还是一天备份一次。
  CheckData?: (item: BakUpData, res: any, time: Date, timeStr: string) => boolean; // 检查返回的数据是否是合格的数据
  DataFilter: (item: BakUpData, res: any, time: Date, timeStr: string) => Promise<any>; // 最终存储的数据
  OssOptions: OSS.PutObjectOptions;

  CacheAble?: boolean; // 设置为false，才不缓存
}
