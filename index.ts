import { BakUp } from './src/bak-up';
import { OssClient } from './lib/oss';

function Run() {
  BakUp.Run();
}

// 启动时立即执行一次
Run();

OssClient;

// 半分钟检查一次
setInterval(Run, 30000);
