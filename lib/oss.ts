import * as OSS from 'ali-oss';
import { AppConfig } from '../app.config';

class OssHandler {
  Handler = new OSS(AppConfig.AliOss);

  constructor() {
    this.init();
  }

  async init() {
    this.Handler.useBucket(AppConfig.AliOss.bucket);
  }

  async Save(OssUrl: string, data: any, options: OSS.PutObjectOptions) {
    try {
      console.log('---put', OssUrl);
      const res = await this.Handler.put(OssUrl, Buffer.from(JSON.stringify(data)), options);
      return res;
    } catch (e) {
      console.error('Save error', e);
      return false;
    }
  }
}

export const OssClient = new OssHandler();
